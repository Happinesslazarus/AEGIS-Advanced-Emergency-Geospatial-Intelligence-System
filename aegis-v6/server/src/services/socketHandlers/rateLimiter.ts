import { redis, redisReady } from '../cacheService.js'

const connectionRateLimits = new Map<string, { count: number; resetAt: number }>()
const MAX_CONNECTIONS_PER_IP = 10
const CONNECTION_WINDOW_MS = 60_000

//Per-user message rate limiting (in-memory fallback, clears on restart)
const messageRateLimits = new Map<string, { count: number; resetAt: number }>()

//Periodically evict expired entries from rate-limit maps to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of connectionRateLimits) {
    if (now > entry.resetAt) connectionRateLimits.delete(key)
  }
  for (const [key, entry] of messageRateLimits) {
    if (now > entry.resetAt) messageRateLimits.delete(key)
  }
}, 5 * 60_000)

export function checkConnectionRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = connectionRateLimits.get(ip) ?? { count: 0, resetAt: now + CONNECTION_WINDOW_MS }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + CONNECTION_WINDOW_MS
  }
  entry.count++
  connectionRateLimits.set(ip, entry)
  return entry.count <= MAX_CONNECTIONS_PER_IP
}

/**
 * Check socket message rate limit for a user.
 * Uses Redis when available for cross-instance consistency; falls back to
 * the in-memory Map when Redis is down or disabled.
 *
 * @returns true if the message is allowed, false if rate-limited.
 */
export async function checkSocketRateLimit(
  userId: string,
  maxPerWindow: number = 15,
  windowMs: number = 60000,
): Promise<boolean> {
  //Try Redis first
  try {
    if (redis && redisReady) {
      const key = `aegis:socket:ratelimit:${userId}`
      const count = await redis.incr(key)
      if (count === 1) {
        //First message in the window -- set expiry
        await redis.pexpire(key, windowMs)
      }
      return count <= maxPerWindow
    }
  } catch {
    //Redis unavailable -- fall through to in-memory
  }

  //In-memory fallback
  const now = Date.now()
  const limiter = messageRateLimits.get(userId) || { count: 0, resetAt: now + windowMs }
  if (now > limiter.resetAt) {
    limiter.count = 0
    limiter.resetAt = now + windowMs
  }
  limiter.count++
  messageRateLimits.set(userId, limiter)
  return limiter.count <= maxPerWindow
}

/**
 * Clean up rate-limit state for a disconnecting user.
 * Removes the in-memory entry and (best-effort) the Redis key.
 */
export async function clearSocketRateLimit(userId: string): Promise<void> {
  messageRateLimits.delete(userId)
  try {
    if (redis && redisReady) {
      await redis.del(`aegis:socket:ratelimit:${userId}`)
    }
  } catch {
    //non-critical -- key will expire on its own
  }
}
