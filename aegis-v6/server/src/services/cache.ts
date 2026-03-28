/*
 * services/cache.ts — Redis-backed distributed cache
 *
 * Wraps ioredis with TTL-based get/set, JSON serialization, and
 * pattern-based invalidation. Falls back to in-memory LRU if Redis
 * is unavailable (development / single-node deploys).
 */

import Redis from 'ioredis'
import { auditLog } from '../utils/logger'

const REDIS_URL = process.env.REDIS_URL || ''

let redis: Redis | null = null

if (REDIS_URL) {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null // stop retrying after 5 attempts
      return Math.min(times * 200, 2000)
    },
    lazyConnect: true,
  })

  redis.on('error', (err) => {
    auditLog('cache', 'Redis connection error — falling back to in-memory', { error: err.message })
  })

  redis.connect().catch(() => {
    auditLog('cache', 'Redis unavailable at startup — using in-memory fallback')
    redis = null
  })
}

// In-memory fallback map
const memFallback = new Map<string, { value: string; expiresAt: number }>()

function pruneMemFallback() {
  const now = Date.now()
  for (const [key, entry] of memFallback) {
    if (now > entry.expiresAt) memFallback.delete(key)
  }
}

// Public API

/* Get a cached value (returns null on miss). */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  try {
    if (redis) {
      const raw = await redis.get(key)
      return raw ? (JSON.parse(raw) as T) : null
    }
  } catch { /* fall through to in-memory */ }

  const entry = memFallback.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { memFallback.delete(key); return null }
  return JSON.parse(entry.value) as T
}

/* Set a cache value with TTL in seconds. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const json = JSON.stringify(value)
  try {
    if (redis) {
      await redis.set(key, json, 'EX', ttlSeconds)
      return
    }
  } catch { /* fall through */ }

  memFallback.set(key, { value: json, expiresAt: Date.now() + ttlSeconds * 1000 })
  if (memFallback.size > 5000) pruneMemFallback()
}

/* Delete a single key. */
export async function cacheDel(key: string): Promise<void> {
  try { if (redis) { await redis.del(key); return } } catch { /* fall through */ }
  memFallback.delete(key)
}

/* Invalidate all keys matching a pattern (e.g. "drought:*"). */
export async function cacheInvalidatePattern(pattern: string): Promise<number> {
  try {
    if (redis) {
      const keys = await redis.keys(pattern)
      if (keys.length > 0) {
        await redis.del(...keys)
      }
      return keys.length
    }
  } catch { /* fall through */ }

  let removed = 0
  const search = pattern.replace(/\*/g, '')
  for (const key of [...memFallback.keys()]) {
    if (key.includes(search)) { memFallback.delete(key); removed++ }
  }
  return removed
}

/* Check if Redis is connected. */
export function cacheIsConnected(): boolean {
  return redis?.status === 'ready'
}

export { redis }
