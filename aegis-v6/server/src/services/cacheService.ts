/**
 * Enterprise cache abstraction -- namespace-scoped, versioned keys with
 * stale-while-revalidate grace periods and LRU eviction (5000 entries).
 * Full Prometheus instrumentation via cacheMetrics. Exports the shared
 * Redis instance and redisReady flag for other services.
 *
 * - Imports cache metric counters/histograms from cacheMetrics.ts
 * - Exports the shared redis client and redisReady flag
 * - Used by socket.ts, cronJobs, and route handlers
 * */

import Redis from 'ioredis'
import crypto from 'crypto'
import { auditLog } from '../utils/logger.js'
import {
  cacheHitsTotal,
  cacheMissesTotal,
  cacheSetsTotal,
  cacheInvalidationsTotal,
  cacheErrorsTotal,
  cacheStaleServedTotal,
  cacheOperationDuration,
  cacheNamespaceHitsTotal,
  cacheNamespaceMissesTotal,
} from './cacheMetrics.js'

//Configuration

const REDIS_URL = process.env.REDIS_URL || ''
const REDIS_ENABLED = (process.env.REDIS_ENABLED ?? 'true') !== 'false'
const DEFAULT_TTL = parseInt(process.env.REDIS_DEFAULT_TTL_SECONDS || '300', 10)
const STALE_GRACE = parseInt(process.env.REDIS_STALE_GRACE_SECONDS || '600', 10)
const CONNECT_TIMEOUT = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '5000', 10)
const OP_TIMEOUT_MS = 2000 // Internal per-operation timeout

/* Version prefix for cache key schema evolution */
const KEY_VERSION = 'v1'

//Redis connection

let redis: Redis | null = null
let redisReady = false

if (REDIS_URL && REDIS_ENABLED) {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: CONNECT_TIMEOUT,
    commandTimeout: OP_TIMEOUT_MS,
    retryStrategy(times) {
      if (times > 10) return null
      return Math.min(times * 500, 5000)
    },
    lazyConnect: true,
    enableReadyCheck: true,
  })

  redis.on('ready', () => {
    redisReady = true
    auditLog('cache', 'Redis connected and ready')
  })

  redis.on('error', (err) => {
    redisReady = false
    cacheErrorsTotal.inc({ operation: 'connection' })
    auditLog('cache', 'Redis connection error', { error: err.message })
  })

  redis.on('close', () => {
    redisReady = false
  })

  redis.connect().catch((err) => {
    auditLog('cache', 'Redis unavailable at startup - using in-memory fallback', { error: err?.message })
    redis = null
    redisReady = false
  })
} else {
  auditLog('cache', REDIS_ENABLED ? 'No REDIS_URL - using in-memory fallback' : 'Redis disabled via REDIS_ENABLED=false')
}

//In-memory fallback (LRU-style eviction at 5000 entries)

interface MemEntry {
  value: string
  expiresAt: number
  staleUntil: number
  setAt: number
}

const MEM_MAX = 5000
const memStore = new Map<string, MemEntry>()

function pruneMemStore(): void {
  if (memStore.size <= MEM_MAX) return
  const now = Date.now()
  //First pass: remove fully expired entries
  for (const [key, entry] of memStore) {
    if (now > entry.staleUntil) memStore.delete(key)
  }
  //Second pass: if still over limit, evict oldest
  if (memStore.size > MEM_MAX) {
    const sorted = [...memStore.entries()].sort((a, b) => a[1].setAt - b[1].setAt)
    const toRemove = sorted.slice(0, memStore.size - MEM_MAX + 500)
    for (const [key] of toRemove) memStore.delete(key)
  }
}

//Timeout wrapper

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cache operation timeout')), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

//Cache key builder

/**
 * Build a deterministic, collision-safe cache key.
 *
 * Format: aegis:v1:{namespace}:{parts joined by ':'}:{hash of params}
 *
 * @param namespace - Logical grouping (weather, river, flood, spatial, news, alerts)
 * @param parts     - Hierarchical key segments [region, resource, ...]
 * @param params    - Query/input parameters to hash (ensures uniqueness)
 *
 * @example
 *   buildCacheKey('weather', ['uk-default', 'forecast'], { lat: 55.9, lng: -3.2 })
 *   // => "aegis:v1:weather:uk-default:forecast:a1b2c3d4"
 */
export function buildCacheKey(
  namespace: string,
  parts: string[],
  params?: Record<string, unknown>,
): string {
  const base = `aegis:${KEY_VERSION}:${namespace}:${parts.join(':')}`
  if (!params || Object.keys(params).length === 0) return base
  //Deterministic hash: sort keys, JSON encode, SHA-256 truncated
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k]
    return acc
  }, {} as Record<string, unknown>)
  const hash = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 12)
  return `${base}:${hash}`
}

//Stale metadata encoding
//Redis stores: JSON-encoded CacheEnvelope as the value
//TTL is set to (ttlSeconds + staleGrace) so stale data survives in Redis
//Freshness is tracked by the `expiresAt` field inside the envelope

interface CacheEnvelope<T = unknown> {
  data: T
  setAt: number
  expiresAt: number
  namespace: string
}

//Public API

/**
 * Get a cached value. Returns null on miss.
 * If the item exists but is expired, it returns null (stale lookup is separate).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const timer = cacheOperationDuration.startTimer({ operation: 'get' })
  const ns = extractNamespace(key)
  try {
    const envelope = await rawGet<T>(key)
    if (!envelope) {
      cacheMissesTotal.inc()
      cacheNamespaceMissesTotal.inc({ namespace: ns })
      timer()
      return null
    }
    if (Date.now() > envelope.expiresAt) {
      //Expired but data may exist for stale-if-error - return null for fresh reads
      cacheMissesTotal.inc()
      cacheNamespaceMissesTotal.inc({ namespace: ns })
      timer()
      return null
    }
    cacheHitsTotal.inc()
    cacheNamespaceHitsTotal.inc({ namespace: ns })
    timer()
    return envelope.data
  } catch (err: any) {
    cacheErrorsTotal.inc({ operation: 'get' })
    auditLog('cache', 'get error', { key, error: err.message })
    timer()
    return null
  }
}

/**
 * Get stale data for a key (expired but within grace window).
 * Used by stale-if-error fallback.
 */
export async function cacheGetStale<T>(key: string): Promise<{ data: T; stale: boolean; setAt: number } | null> {
  try {
    const envelope = await rawGet<T>(key)
    if (!envelope) return null
    const now = Date.now()
    const staleUntil = envelope.expiresAt + STALE_GRACE * 1000
    if (now > staleUntil) return null // Beyond grace window
    return {
      data: envelope.data,
      stale: now > envelope.expiresAt,
      setAt: envelope.setAt,
    }
  } catch {
    return null
  }
}

/**
 * Set a cache value with TTL in seconds.
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const ttl = ttlSeconds ?? DEFAULT_TTL
  const timer = cacheOperationDuration.startTimer({ operation: 'set' })
  const ns = extractNamespace(key)
  const now = Date.now()
  const envelope: CacheEnvelope<T> = {
    data: value,
    setAt: now,
    expiresAt: now + ttl * 1000,
    namespace: ns,
  }
  const json = JSON.stringify(envelope)

  try {
    if (redis && redisReady) {
      //Store with extended TTL so stale data persists for grace window
      const redisTtl = ttl + STALE_GRACE
      await withTimeout(redis.set(key, json, 'EX', redisTtl), OP_TIMEOUT_MS)
      cacheSetsTotal.inc({ namespace: ns })
      timer()
      return
    }
  } catch (err: any) {
    cacheErrorsTotal.inc({ operation: 'set' })
    auditLog('cache', 'set error - falling back to memory', { key, error: err.message })
  }

  //In-memory fallback
  memStore.set(key, {
    value: json,
    expiresAt: now + ttl * 1000,
    staleUntil: now + (ttl + STALE_GRACE) * 1000,
    setAt: now,
  })
  cacheSetsTotal.inc({ namespace: ns })
  pruneMemStore()
  timer()
}

/**
 * Delete a single cached key.
 */
export async function cacheDel(key: string): Promise<void> {
  const ns = extractNamespace(key)
  try {
    if (redis && redisReady) {
      await withTimeout(redis.del(key), OP_TIMEOUT_MS)
    }
  } catch (err: any) {
    cacheErrorsTotal.inc({ operation: 'del' })
    auditLog('cache', 'del error', { key, error: err.message })
  }
  memStore.delete(key)
  cacheInvalidationsTotal.inc({ namespace: ns })
}

/**
 * Invalidate a single key (alias for del with logging).
 */
export async function cacheInvalidate(key: string): Promise<void> {
  auditLog('cache', 'invalidate', { key })
  return cacheDel(key)
}

/**
 * Invalidate all keys matching a glob pattern (e.g. "aegis:v1:weather:*").
 * Uses SCAN instead of KEYS for production safety.
 * Returns the number of keys deleted.
 */
export async function cacheInvalidatePattern(pattern: string, dryRun = false): Promise<number> {
  const timer = cacheOperationDuration.startTimer({ operation: 'invalidatePattern' })
  let removed = 0

  try {
    if (redis && redisReady) {
      const keys: string[] = []
      let cursor = '0'
      //Use SCAN for production safety (non-blocking)
      do {
        const [nextCursor, batch] = await withTimeout(
          redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200),
          OP_TIMEOUT_MS * 2,
        )
        cursor = nextCursor
        keys.push(...batch)
      } while (cursor !== '0')

      if (keys.length > 0 && !dryRun) {
        //Pipeline deletes in batches of 100
        for (let i = 0; i < keys.length; i += 100) {
          const batch = keys.slice(i, i + 100)
          await withTimeout(redis.del(...batch), OP_TIMEOUT_MS)
        }
      }
      removed = keys.length
    }
  } catch (err: any) {
    cacheErrorsTotal.inc({ operation: 'invalidatePattern' })
    auditLog('cache', 'invalidatePattern error', { pattern, error: err.message })
  }

  //Also clear in-memory
  const search = pattern.replace(/\*/g, '')
  for (const key of [...memStore.keys()]) {
    if (key.includes(search)) {
      if (!dryRun) memStore.delete(key)
      removed++
    }
  }

  if (!dryRun) {
    const ns = extractNamespace(pattern)
    cacheInvalidationsTotal.inc({ namespace: ns })
  }

  auditLog('cache', dryRun ? 'invalidatePattern (dry-run)' : 'invalidatePattern', {
    pattern,
    keysFound: removed,
    dryRun,
  })

  timer()
  return removed
}

/**
 * Cache-aside with producer function.
 *
 * 1. Try cache hit ? return cached data
 * 2. Cache miss ? call producer ? cache result ? return
 * 3. Producer fails + stale data available ? serve stale (if staleOnError enabled)
 * 4. Producer fails + no stale data ? throw
 *
 * @param key         - Full cache key (use buildCacheKey)
 * @param ttlSeconds  - Fresh TTL
 * @param producer    - Async function that fetches fresh data
 * @param options     - staleOnError (enable stale fallback), negativeTtl (cache "no data" for N seconds)
 */
export async function remember<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
  options?: {
    staleOnError?: boolean
    negativeTtl?: number
    provider?: string
  },
): Promise<{ data: T; meta: CacheResponseMeta }> {
  const ns = extractNamespace(key)

  //1. Try fresh cache hit
  const cached = await cacheGet<T>(key)
  if (cached !== null) {
    return { data: cached, meta: { source: 'cache', stale: false, namespace: ns } }
  }

  //2. Cache miss - call producer
  try {
    const freshData = await producer()

    //Cache the result (only successful responses)
    if (freshData !== null && freshData !== undefined) {
      await cacheSet(key, freshData, ttlSeconds)
    } else if (options?.negativeTtl) {
      //Negative caching: "no data" marker with short TTL
      await cacheSet(key, null as unknown as T, options.negativeTtl)
    }

    return { data: freshData, meta: { source: 'origin', stale: false, namespace: ns } }
  } catch (producerError) {
    //3. Producer failed - try stale-if-error
    if (options?.staleOnError) {
      const stale = await cacheGetStale<T>(key)
      if (stale && stale.data !== null) {
        cacheStaleServedTotal.inc({ namespace: ns, provider: options.provider || 'unknown' })
        auditLog('cache', 'serving stale data after upstream failure', {
          key,
          provider: options.provider,
          staleAge: Math.round((Date.now() - stale.setAt) / 1000),
        })
        return {
          data: stale.data,
          meta: { source: 'cache', stale: true, staleSince: stale.setAt, namespace: ns },
        }
      }
    }

    //4. No stale data available - propagate the error
    throw producerError
  }
}

/* Metadata attached to cache-served responses */
export interface CacheResponseMeta {
  source: 'cache' | 'origin'
  stale: boolean
  staleSince?: number
  namespace: string
}

//Diagnostic & Admin

/* Check if Redis is connected and accepting commands */
export function isRedisConnected(): boolean {
  return redis !== null && redisReady
}

/* Get basic cache statistics */
export async function getCacheStats(): Promise<Record<string, unknown>> {
  const stats: Record<string, unknown> = {
    redisConnected: isRedisConnected(),
    memoryEntries: memStore.size,
    redisEnabled: REDIS_ENABLED,
  }

  if (redis && redisReady) {
    try {
      const info = await withTimeout(redis.info('memory'), OP_TIMEOUT_MS)
      const usedMemMatch = info.match(/used_memory_human:(.+)/)
      const keysMatch = info.match(/keys=(\d+)/)
      stats.redisUsedMemory = usedMemMatch?.[1]?.trim()
      stats.redisKeys = keysMatch ? parseInt(keysMatch[1], 10) : undefined
    } catch {
      //ignore
    }
  }

  return stats
}

/* Export redis instance for admin operations (health check) */
export { redis, redisReady }

//Internal helpers

/* Read raw envelope from Redis or in-memory store */
async function rawGet<T>(key: string): Promise<CacheEnvelope<T> | null> {
  //Try Redis first
  try {
    if (redis && redisReady) {
      const raw = await withTimeout(redis.get(key), OP_TIMEOUT_MS)
      if (!raw) return null
      return JSON.parse(raw) as CacheEnvelope<T>
    }
  } catch {
    //fall through to memory
  }

  //In-memory fallback
  const entry = memStore.get(key)
  if (!entry) return null
  if (Date.now() > entry.staleUntil) {
    memStore.delete(key)
    return null
  }
  return JSON.parse(entry.value) as CacheEnvelope<T>
}

/* Extract namespace from a cache key for metrics labeling */
function extractNamespace(key: string): string {
  //Key format: aegis:v1:{namespace}:...
  const parts = key.split(':')
  return parts.length >= 3 ? parts[2] : 'unknown'
}

//Cache TTL Constants (centralized for documentation)

export const CACHE_TTL = {
  /* Weather data: live conditions + 24h forecast */
  WEATHER: 15 * 60,           // 15 minutes
  /* River levels: updated every 15 min by EA/SEPA */
  RIVER_LEVELS: 5 * 60,      // 5 minutes
  /* Flood warnings: severity can escalate quickly */
  FLOOD_WARNINGS: 5 * 60,    // 5 minutes
  /* Flood prediction models: computationally expensive */
  FLOOD_PREDICTIONS: 10 * 60, // 10 minutes
  /* GeoJSON flood extents: rarely change */
  FLOOD_ZONES: 24 * 60 * 60, // 24 hours
  /* Spatial queries: shelters, risk zones */
  SPATIAL: 60 * 60,          // 1 hour
  /* RSS / emergency news feeds */
  NEWS: 10 * 60,             // 10 minutes (was 30 -- more feeds now so fresher data)
  /* Flood data from EA/SEPA/NRW APIs */
  FLOOD_DATA: 10 * 60,       // 10 minutes
  /* Alert list (short because alerts are time-sensitive) */
  ALERT_LIST: 60,            // 1 minute
  /* Negative cache: "no data available" responses */
  NEGATIVE: 120,             // 2 minutes
  /* River config: rarely changes */
  RIVER_CONFIG: 60 * 60,     // 1 hour
} as const
