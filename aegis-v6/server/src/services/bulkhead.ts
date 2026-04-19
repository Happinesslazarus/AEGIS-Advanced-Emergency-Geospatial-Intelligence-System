/**
 * Bulkhead concurrency isolator -- caps concurrent executions per named
 * compartment with priority-based queuing and per-call timeouts. Based on
 * the ship-bulkhead stability pattern from Nygard (2007) "Release It!" Ch.4:
 * a burst in one subsystem (e.g. AI predictions) cannot starve another
 * (e.g. alert broadcasting).
 * https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead
 *
 * Each compartment has a fixed slot pool and a bounded wait queue. When all
 * slots are occupied, lower-priority calls queue; if the queue is also full
 * they are rejected immediately with a 503. Active count, queue depth, and
 * cumulative rejections are tracked as Prometheus gauges.
 *
 * Pre-configured compartments are registered by initBulkheads() at startup.
 */

import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const bulkheadActive = new client.Gauge({
  name: 'aegis_bulkhead_active',
  help: 'Currently active executions per bulkhead',
  labelNames: ['bulkhead'] as const,
})

const bulkheadQueue = new client.Gauge({
  name: 'aegis_bulkhead_queue_size',
  help: 'Current queue size per bulkhead',
  labelNames: ['bulkhead'] as const,
})

const bulkheadRejections = new client.Counter({
  name: 'aegis_bulkhead_rejections_total',
  help: 'Total rejections due to bulkhead full',
  labelNames: ['bulkhead'] as const,
})

const bulkheadWaitTime = new client.Histogram({
  name: 'aegis_bulkhead_wait_seconds',
  help: 'Time spent waiting in bulkhead queue',
  labelNames: ['bulkhead'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
})

interface BulkheadConfig {
  maxConcurrent: number      // Max concurrent executions
  maxQueue: number           // Max waiting in queue
  queueTimeoutMs: number     // Max time to wait in queue
  fairQueuing: boolean       // FIFO vs priority queuing
}

interface QueueEntry {
  priority: number
  timestamp: number
  resolve: () => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface Bulkhead {
  name: string
  config: BulkheadConfig
  active: number
  queue: QueueEntry[]
}

// Registry of bulkheads
const bulkheads = new Map<string, Bulkhead>()

// Default configuration
const DEFAULT_CONFIG: BulkheadConfig = {
  maxConcurrent: 25,
  maxQueue: 50,
  queueTimeoutMs: 30_000,
  fairQueuing: true,
}

/**
 * Create or get a bulkhead
 */
export function getBulkhead(name: string, config: Partial<BulkheadConfig> = {}): Bulkhead {
  if (bulkheads.has(name)) {
    return bulkheads.get(name)!
  }

  const bulkhead: Bulkhead = {
    name,
    config: { ...DEFAULT_CONFIG, ...config },
    active: 0,
    queue: [],
  }

  bulkheads.set(name, bulkhead)

  logger.info({ bulkhead: name, config: bulkhead.config }, '[Bulkhead] Created')

  return bulkhead
}

/**
 * Execute function with bulkhead protection
 */
export async function execute<T>(
  bulkheadName: string,
  fn: () => Promise<T>,
  options: { priority?: number } = {}
): Promise<T> {
  const bulkhead = bulkheads.get(bulkheadName)
  if (!bulkhead) {
    throw new Error(`Bulkhead "${bulkheadName}" not found. Create it first with getBulkhead().`)
  }

  const { config } = bulkhead

  // Fast path: slot available
  if (bulkhead.active < config.maxConcurrent) {
    return executeWithTracking(bulkhead, fn)
  }

  // Check queue capacity
  if (bulkhead.queue.length >= config.maxQueue) {
    bulkheadRejections.labels(bulkheadName).inc()
    throw new BulkheadFullError(bulkheadName, 'Queue full')
  }

  // Queue the request
  const startWait = Date.now()

  const permit = await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      // Remove from queue
      const idx = bulkhead.queue.findIndex(e => e.resolve === resolve)
      if (idx !== -1) {
        bulkhead.queue.splice(idx, 1)
        bulkheadQueue.labels(bulkheadName).set(bulkhead.queue.length)
      }
      reject(new BulkheadFullError(bulkheadName, 'Queue timeout'))
    }, config.queueTimeoutMs)

    const entry: QueueEntry = {
      priority: options.priority ?? 0,
      timestamp: Date.now(),
      resolve,
      reject,
      timeoutId,
    }

    // Insert by priority (higher priority first)
    if (config.fairQueuing || options.priority === undefined) {
      bulkhead.queue.push(entry)
    } else {
      const insertIdx = bulkhead.queue.findIndex(e => e.priority < entry.priority)
      if (insertIdx === -1) {
        bulkhead.queue.push(entry)
      } else {
        bulkhead.queue.splice(insertIdx, 0, entry)
      }
    }

    bulkheadQueue.labels(bulkheadName).set(bulkhead.queue.length)
  })

  const waitTime = (Date.now() - startWait) / 1000
  bulkheadWaitTime.labels(bulkheadName).observe(waitTime)

  return executeWithTracking(bulkhead, fn)
}

/**
 * Execute with active count tracking
 */
async function executeWithTracking<T>(bulkhead: Bulkhead, fn: () => Promise<T>): Promise<T> {
  bulkhead.active++
  bulkheadActive.labels(bulkhead.name).set(bulkhead.active)

  try {
    return await fn()
  } finally {
    bulkhead.active--
    bulkheadActive.labels(bulkhead.name).set(bulkhead.active)

    // Release next in queue
    releaseNext(bulkhead)
  }
}

/**
 * Release next waiting request
 */
function releaseNext(bulkhead: Bulkhead): void {
  if (bulkhead.queue.length === 0) return
  if (bulkhead.active >= bulkhead.config.maxConcurrent) return

  const next = bulkhead.queue.shift()!
  clearTimeout(next.timeoutId)
  bulkheadQueue.labels(bulkhead.name).set(bulkhead.queue.length)
  next.resolve()
}

/**
 * Get bulkhead status
 */
export function getStatus(bulkheadName: string): {
  name: string
  active: number
  maxConcurrent: number
  queued: number
  maxQueue: number
  utilization: number
} | null {
  const bulkhead = bulkheads.get(bulkheadName)
  if (!bulkhead) return null

  return {
    name: bulkhead.name,
    active: bulkhead.active,
    maxConcurrent: bulkhead.config.maxConcurrent,
    queued: bulkhead.queue.length,
    maxQueue: bulkhead.config.maxQueue,
    utilization: bulkhead.active / bulkhead.config.maxConcurrent,
  }
}

/**
 * Get all bulkheads status
 */
export function getAllStatus(): ReturnType<typeof getStatus>[] {
  return Array.from(bulkheads.keys())
    .map(name => getStatus(name))
    .filter((s): s is NonNullable<typeof s> => s !== null)
}

/**
 * Check if bulkhead has capacity
 */
export function hasCapacity(bulkheadName: string): boolean {
  const bulkhead = bulkheads.get(bulkheadName)
  if (!bulkhead) return false

  return (
    bulkhead.active < bulkhead.config.maxConcurrent ||
    bulkhead.queue.length < bulkhead.config.maxQueue
  )
}

/**
 * Get available permits
 */
export function availablePermits(bulkheadName: string): number {
  const bulkhead = bulkheads.get(bulkheadName)
  if (!bulkhead) return 0

  return Math.max(0, bulkhead.config.maxConcurrent - bulkhead.active)
}

/**
 * Decorator for bulkhead protection
 */
export function WithBulkhead(bulkheadName: string, priority?: number) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      return execute(bulkheadName, () => originalMethod.apply(this, args), { priority })
    }

    return descriptor
  }
}

/**
 * Wrap function with bulkhead
 */
export function withBulkhead<T extends (...args: any[]) => Promise<any>>(
  bulkheadName: string,
  fn: T,
  priority?: number
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return execute(bulkheadName, () => fn(...args), { priority })
  }) as T
}

/**
 * Bulkhead full error
 */
export class BulkheadFullError extends Error {
  readonly bulkheadName: string
  readonly reason: string

  constructor(bulkheadName: string, reason: string) {
    super(`Bulkhead "${bulkheadName}" is full: ${reason}`)
    this.name = 'BulkheadFullError'
    this.bulkheadName = bulkheadName
    this.reason = reason
  }
}

// Pre-configured bulkheads for AEGIS services
export const Bulkheads = {
  DATABASE_QUERIES: 'database_queries',
  DATABASE_WRITES: 'database_writes',
  AI_ENGINE: 'ai_engine',
  EXTERNAL_APIS: 'external_apis',
  FILE_UPLOADS: 'file_uploads',
  WEBSOCKET_BROADCAST: 'websocket_broadcast',
  REPORT_PROCESSING: 'report_processing',
  CHAT_MESSAGES: 'chat_messages',
} as const

/**
 * Initialize default bulkheads
 */
export function initBulkheads(): void {
  // Database queries - high concurrency, critical
  getBulkhead(Bulkheads.DATABASE_QUERIES, {
    maxConcurrent: 50,
    maxQueue: 100,
    queueTimeoutMs: 15_000,
  })

  // Database writes - lower concurrency to prevent contention
  getBulkhead(Bulkheads.DATABASE_WRITES, {
    maxConcurrent: 20,
    maxQueue: 50,
    queueTimeoutMs: 30_000,
  })

  // AI Engine - limited by external service capacity
  getBulkhead(Bulkheads.AI_ENGINE, {
    maxConcurrent: 10,
    maxQueue: 25,
    queueTimeoutMs: 60_000,
  })

  // External APIs - prevent overloading external services
  getBulkhead(Bulkheads.EXTERNAL_APIS, {
    maxConcurrent: 15,
    maxQueue: 30,
    queueTimeoutMs: 45_000,
  })

  // File uploads - memory intensive
  getBulkhead(Bulkheads.FILE_UPLOADS, {
    maxConcurrent: 5,
    maxQueue: 20,
    queueTimeoutMs: 120_000, // Longer timeout for large files
  })

  // WebSocket broadcasts - fast, but limit to prevent CPU spikes
  getBulkhead(Bulkheads.WEBSOCKET_BROADCAST, {
    maxConcurrent: 100,
    maxQueue: 200,
    queueTimeoutMs: 5_000,
  })

  // Report processing - moderate, verification pipeline
  getBulkhead(Bulkheads.REPORT_PROCESSING, {
    maxConcurrent: 15,
    maxQueue: 50,
    queueTimeoutMs: 30_000,
  })

  // Chat messages - high priority, low latency required
  getBulkhead(Bulkheads.CHAT_MESSAGES, {
    maxConcurrent: 30,
    maxQueue: 100,
    queueTimeoutMs: 10_000,
    fairQueuing: true, // FIFO for chat fairness
  })

  logger.info('[Bulkhead] Initialized default bulkheads')
}

export default {
  getBulkhead,
  execute,
  getStatus,
  getAllStatus,
  hasCapacity,
  availablePermits,
  WithBulkhead,
  withBulkhead,
  BulkheadFullError,
  Bulkheads,
  initBulkheads,
}
