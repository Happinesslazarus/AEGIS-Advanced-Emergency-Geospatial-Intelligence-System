/**
 * Load-aware rate limiter -- Express middleware that dynamically adjusts
 * per-tier rate limits (internal, admin, operator, citizen) based on
 * real-time CPU, memory, and event loop lag.
 *
 * - Express middleware applied in the global middleware stack
 * - Exposes Prometheus counters/gauges for limit hits and effective limits
 * - Tiers configured per user role with baseline and minimum rates
 * */

import { Request, Response, NextFunction } from 'express'
import client from 'prom-client'
import { logger } from './logger.js'
import pool from '../models/db.js'

//Prometheus metrics
const rateLimitHits = new client.Counter({
  name: 'aegis_rate_limit_hits_total',
  help: 'Total rate limit rejections',
  labelNames: ['tier', 'reason'] as const,
})

const currentLoadGauge = new client.Gauge({
  name: 'aegis_system_load_factor',
  help: 'Current system load factor (0-1)',
})

const effectiveLimitGauge = new client.Gauge({
  name: 'aegis_effective_rate_limit',
  help: 'Current effective rate limit per minute',
  labelNames: ['tier'] as const,
})

//Configuration
interface RateLimitTier {
  name: string
  baseLimit: number      // Requests per minute at 0% load
  minLimit: number       // Minimum limit at 100% load
  burstMultiplier: number // Allow burst up to this multiplier
  priority: number       // Higher = more priority (1-10)
  matcher: (req: Request) => boolean
}

const TIERS: RateLimitTier[] = [
  {
    name: 'internal',
    baseLimit: 10000,
    minLimit: 5000,
    burstMultiplier: 2.0,
    priority: 10,
    matcher: (req) => req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY,
  },
  {
    name: 'admin',
    baseLimit: 3000,
    minLimit: 1000,
    burstMultiplier: 1.5,
    priority: 9,
    matcher: (req) => (req as any).user?.role === 'admin',
  },
  {
    name: 'operator',
    baseLimit: 1000,
    minLimit: 300,
    burstMultiplier: 1.3,
    priority: 8,
    matcher: (req) => ['operator', 'manager'].includes((req as any).user?.role),
  },
  {
    name: 'authenticated',
    baseLimit: 600,
    minLimit: 200,
    burstMultiplier: 1.2,
    priority: 5,
    matcher: (req) => !!(req as any).user,
  },
  {
    name: 'anonymous',
    baseLimit: 100,
    minLimit: 30,
    burstMultiplier: 1.0,
    priority: 1,
    matcher: () => true, // Default tier
  },
]

//Token bucket state per identifier
interface TokenBucket {
  tokens: number
  lastRefill: number
  tier: string
}

const buckets = new Map<string, TokenBucket>()

//System load monitoring
interface SystemLoad {
  cpuUsage: number        // 0-1
  memoryUsage: number     // 0-1
  eventLoopLag: number    // ms
  dbPoolUsage: number     // 0-1
  errorRate: number       // errors per minute
  requestQueueDepth: number
}

let currentLoad: SystemLoad = {
  cpuUsage: 0,
  memoryUsage: 0,
  eventLoopLag: 0,
  dbPoolUsage: 0,
  errorRate: 0,
  requestQueueDepth: 0,
}

//Error tracking for adaptive response
const recentErrors: number[] = []
const ERROR_WINDOW_MS = 60_000

/**
 * Calculate composite load factor (0-1)
 */
function calculateLoadFactor(): number {
  //Weighted average of load indicators
  const weights = {
    cpu: 0.25,
    memory: 0.20,
    eventLoop: 0.20,
    dbPool: 0.25,
    errorRate: 0.10,
  }

  //Normalize event loop lag (target: <50ms is healthy)
  const normalizedLag = Math.min(currentLoad.eventLoopLag / 200, 1)

  //Normalize error rate (target: <10/min is healthy)
  const normalizedErrors = Math.min(currentLoad.errorRate / 50, 1)

  const composite = 
    currentLoad.cpuUsage * weights.cpu +
    currentLoad.memoryUsage * weights.memory +
    normalizedLag * weights.eventLoop +
    currentLoad.dbPoolUsage * weights.dbPool +
    normalizedErrors * weights.errorRate

  return Math.min(Math.max(composite, 0), 1)
}

/**
 * Calculate effective rate limit for a tier based on current load
 */
function getEffectiveLimit(tier: RateLimitTier): number {
  const loadFactor = calculateLoadFactor()
  currentLoadGauge.set(loadFactor)

  //Linear interpolation between base and min limit
  const effectiveLimit = Math.round(
    tier.baseLimit - (tier.baseLimit - tier.minLimit) * loadFactor
  )

  effectiveLimitGauge.labels(tier.name).set(effectiveLimit)
  return effectiveLimit
}

/**
 * Get identifier for rate limiting (user ID > IP)
 */
function getIdentifier(req: Request): string {
  const userId = (req as any).user?.id
  if (userId) return `user:${userId}`
  return `ip:${req.ip || 'unknown'}`
}

/**
 * Get applicable tier for request
 */
function getTier(req: Request): RateLimitTier {
  for (const tier of TIERS) {
    if (tier.matcher(req)) return tier
  }
  return TIERS[TIERS.length - 1] // Default to anonymous
}

/**
 * Token bucket rate limiting with adaptive limits
 */
function checkRateLimit(identifier: string, tier: RateLimitTier): {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number
} {
  const now = Date.now()
  const effectiveLimit = getEffectiveLimit(tier)
  const burstLimit = Math.floor(effectiveLimit * tier.burstMultiplier)

  let bucket = buckets.get(identifier)

  if (!bucket) {
    bucket = {
      tokens: burstLimit,
      lastRefill: now,
      tier: tier.name,
    }
    buckets.set(identifier, bucket)
  }

  //Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill
  const refillRate = effectiveLimit / 60_000 // tokens per ms
  const tokensToAdd = elapsed * refillRate

  bucket.tokens = Math.min(bucket.tokens + tokensToAdd, burstLimit)
  bucket.lastRefill = now

  //Check if request can proceed
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + Math.ceil((burstLimit - bucket.tokens) / refillRate),
    }
  }

  //Rate limited
  const tokensNeeded = 1 - bucket.tokens
  const waitTime = Math.ceil(tokensNeeded / refillRate)

  rateLimitHits.labels(tier.name, 'token_exhausted').inc()

  return {
    allowed: false,
    remaining: 0,
    resetAt: now + waitTime,
    retryAfter: Math.ceil(waitTime / 1000),
  }
}

/**
 * Priority-aware request queuing
 * Higher priority requests preempt lower priority when system is overloaded
 */
const requestQueue: Array<{
  priority: number
  timestamp: number
  resolve: () => void
  reject: (err: Error) => void
}> = []

const MAX_QUEUE_SIZE = 100
const MAX_QUEUE_WAIT_MS = 5000

async function enqueue(priority: number): Promise<void> {
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    //Reject lowest priority request to make room
    const lowestIdx = requestQueue.reduce((minIdx, item, idx, arr) => 
      item.priority < arr[minIdx].priority ? idx : minIdx
    , 0)

    if (requestQueue[lowestIdx].priority < priority) {
      const evicted = requestQueue.splice(lowestIdx, 1)[0]
      evicted.reject(new Error('Preempted by higher priority request'))
    } else {
      throw new Error('Request queue full')
    }
  }

  return new Promise((resolve, reject) => {
    const entry = { priority, timestamp: Date.now(), resolve, reject }

    //Insert sorted by priority (highest first)
    let insertIdx = requestQueue.findIndex(item => item.priority < priority)
    if (insertIdx === -1) insertIdx = requestQueue.length
    requestQueue.splice(insertIdx, 0, entry)

    //Timeout after MAX_QUEUE_WAIT_MS
    setTimeout(() => {
      const idx = requestQueue.indexOf(entry)
      if (idx !== -1) {
        requestQueue.splice(idx, 1)
        reject(new Error('Request queue timeout'))
      }
    }, MAX_QUEUE_WAIT_MS)
  })
}

function dequeue(): void {
  if (requestQueue.length > 0) {
    const next = requestQueue.shift()
    next?.resolve()
  }
}

/**
 * Express middleware for adaptive rate limiting
 */
export function adaptiveRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  //Skip critical bootstrap/auth routes so sign-in and socket handshake
  //are not blocked by load-adaptive throttling.
  const skipPrefixes = [
    '/api/health',
    '/metrics',
    '/api/auth/',
    '/api/citizen-auth/',
    '/socket.io/',
  ]

  if (skipPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    next()
    return
  }

  const identifier = getIdentifier(req)
  const tier = getTier(req)
  const result = checkRateLimit(identifier, tier)

  //Set rate limit headers
  res.setHeader('X-RateLimit-Limit', getEffectiveLimit(tier))
  res.setHeader('X-RateLimit-Remaining', result.remaining)
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000))
  res.setHeader('X-RateLimit-Tier', tier.name)

  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter || 1)
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Retry after ${result.retryAfter} seconds.`,
        details: {
          tier: tier.name,
          limit: getEffectiveLimit(tier),
          retryAfter: result.retryAfter,
        },
      },
    })
    return
  }

  next()
}

/**
 * Record an error for adaptive limiting
 */
export function recordError(): void {
  const now = Date.now()
  recentErrors.push(now)

  //Clean old errors
  while (recentErrors.length > 0 && recentErrors[0] < now - ERROR_WINDOW_MS) {
    recentErrors.shift()
  }

  currentLoad.errorRate = recentErrors.length
}

/**
 * Update system load metrics
 */
function updateLoadMetrics(): void {
  //Memory usage
  const mem = process.memoryUsage()
  const totalMem = require('os').totalmem()
  currentLoad.memoryUsage = mem.heapUsed / totalMem

  //CPU usage (sampled)
  const cpus = require('os').cpus()
  if (cpus.length > 0) {
    const cpu = cpus[0]
    const total = Object.values(cpu.times).reduce((a: number, b: unknown) => a + (b as number), 0)
    const idle = cpu.times.idle
    currentLoad.cpuUsage = 1 - (idle / total)
  }

  //Event loop lag
  const start = process.hrtime.bigint()
  setImmediate(() => {
    const lag = Number(process.hrtime.bigint() - start) / 1_000_000
    currentLoad.eventLoopLag = lag
  })

  //DB pool usage
  const poolTotal = (pool as any).totalCount || 20
  const poolIdle = (pool as any).idleCount || 0
  currentLoad.dbPoolUsage = (poolTotal - poolIdle) / poolTotal

  //Request queue depth
  currentLoad.requestQueueDepth = requestQueue.length
}

//Update load metrics every second
setInterval(updateLoadMetrics, 1000)

//Clean old buckets every minute
setInterval(() => {
  const now = Date.now()
  const staleThreshold = 5 * 60 * 1000 // 5 minutes

  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > staleThreshold) {
      buckets.delete(key)
    }
  }
}, 60_000)

/**
 * Get current rate limiting stats
 */
export function getRateLimitStats(): {
  load: SystemLoad
  loadFactor: number
  effectiveLimits: Record<string, number>
  activeBuckets: number
  queueDepth: number
} {
  return {
    load: { ...currentLoad },
    loadFactor: calculateLoadFactor(),
    effectiveLimits: Object.fromEntries(
      TIERS.map(tier => [tier.name, getEffectiveLimit(tier)])
    ),
    activeBuckets: buckets.size,
    queueDepth: requestQueue.length,
  }
}

export default adaptiveRateLimitMiddleware
