/**
 * File: requestCoalescing.ts
 *
 * Request de-duplication — if multiple callers request the same data
 * simultaneously, only one query runs and all callers share the result.
 * Also provides a DataLoader for batching individual lookups into bulk queries.
 *
 * How it connects:
 * - Wraps service/database calls with coalescing logic (keyed by MD5)
 * - Exposes Prometheus counters for coalesced request tracking
 * - Pre-built loaders available for users and reports tables
 *
 * Simple explanation:
 * If 100 users ask for the same thing at once, only one query runs.
 */

import crypto from 'crypto'
import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const coalescedRequests = new client.Counter({
  name: 'aegis_coalesced_requests_total',
  help: 'Total requests coalesced',
  labelNames: ['operation'] as const,
})

const coalescingHits = new client.Counter({
  name: 'aegis_coalescing_hits_total',
  help: 'Total coalescing cache hits (avoided duplicate work)',
  labelNames: ['operation'] as const,
})

const batchSize = new client.Histogram({
  name: 'aegis_batch_size',
  help: 'Size of batched operations',
  labelNames: ['operation'] as const,
  buckets: [1, 2, 5, 10, 25, 50, 100],
})

// In-flight request tracking
interface InflightRequest<T> {
  promise: Promise<T>
  timestamp: number
  refCount: number
}

const inflightRequests = new Map<string, InflightRequest<any>>()

// Batching
interface BatchEntry<K, V> {
  key: K
  resolve: (value: V) => void
  reject: (error: Error) => void
}

interface BatchConfig<K, V> {
  maxBatchSize: number
  batchDelayMs: number
  batchFn: (keys: K[]) => Promise<Map<K, V>>
}

const batchers = new Map<string, DataLoader<any, any>>()

/**
 * Generate cache key from function arguments
 */
function generateKey(operation: string, args: any[]): string {
  const argsHash = crypto
    .createHash('md5')
    .update(JSON.stringify(args))
    .digest('hex')
  return `${operation}:${argsHash}`
}

/**
 * Coalesce identical concurrent requests
 * If an identical request is already in flight, wait for its result instead of executing again
 */
export async function coalesce<T>(
  operation: string,
  args: any[],
  fn: () => Promise<T>,
  options: { ttlMs?: number } = {}
): Promise<T> {
  const key = generateKey(operation, args)
  const ttlMs = options.ttlMs ?? 100 // Short TTL for coalescing
  const now = Date.now()

  // Check for in-flight request
  const inflight = inflightRequests.get(key)
  if (inflight && now - inflight.timestamp < ttlMs) {
    inflight.refCount++
    coalescingHits.labels(operation).inc()
    logger.debug({ operation, key, refCount: inflight.refCount }, '[Coalescing] Hit')
    return inflight.promise
  }

  // Execute new request
  coalescedRequests.labels(operation).inc()

  const promise = fn()
    .finally(() => {
      // Clean up after TTL
      setTimeout(() => {
        const current = inflightRequests.get(key)
        if (current?.promise === promise) {
          inflightRequests.delete(key)
        }
      }, ttlMs)
    })

  inflightRequests.set(key, {
    promise,
    timestamp: now,
    refCount: 1,
  })

  return promise
}

/**
 * DataLoader class — batches individual requests into batch queries
 */
export class DataLoader<K, V> {
  private queue: BatchEntry<K, V>[] = []
  private scheduled = false
  private readonly config: BatchConfig<K, V>
  private readonly name: string

  constructor(name: string, config: BatchConfig<K, V>) {
    this.name = name
    this.config = config
  }

  /**
   * Load a single key — will be batched with other concurrent loads
   */
  async load(key: K): Promise<V> {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject })

      if (!this.scheduled) {
        this.scheduled = true
        setTimeout(() => this.dispatch(), this.config.batchDelayMs)
      }

      // Dispatch immediately if batch is full
      if (this.queue.length >= this.config.maxBatchSize) {
        this.dispatch()
      }
    })
  }

  /**
   * Load multiple keys at once
   */
  async loadMany(keys: K[]): Promise<(V | Error)[]> {
    return Promise.all(
      keys.map(key =>
        this.load(key).catch(err => err as Error)
      )
    )
  }

  /**
   * Dispatch the current batch
   */
  private async dispatch(): Promise<void> {
    this.scheduled = false

    if (this.queue.length === 0) return

    const batch = this.queue.splice(0, this.config.maxBatchSize)
    const keys = batch.map(entry => entry.key)

    batchSize.labels(this.name).observe(keys.length)

    try {
      const results = await this.config.batchFn(keys)

      for (const entry of batch) {
        const result = results.get(entry.key)
        if (result !== undefined) {
          entry.resolve(result)
        } else {
          entry.reject(new Error(`No result for key: ${entry.key}`))
        }
      }
    } catch (err) {
      // Reject all entries in batch
      for (const entry of batch) {
        entry.reject(err as Error)
      }
    }

    // Dispatch remaining if any
    if (this.queue.length > 0) {
      this.scheduled = true
      setTimeout(() => this.dispatch(), this.config.batchDelayMs)
    }
  }

  /**
   * Clear the loader cache
   */
  clear(): void {
    this.queue = []
    this.scheduled = false
  }
}

/**
 * Create or get a named DataLoader instance
 */
export function getDataLoader<K, V>(
  name: string,
  batchFn: (keys: K[]) => Promise<Map<K, V>>,
  options: { maxBatchSize?: number; batchDelayMs?: number } = {}
): DataLoader<K, V> {
  if (batchers.has(name)) {
    return batchers.get(name)!
  }

  const loader = new DataLoader<K, V>(name, {
    maxBatchSize: options.maxBatchSize ?? 100,
    batchDelayMs: options.batchDelayMs ?? 10,
    batchFn,
  })

  batchers.set(name, loader)
  return loader
}

/**
 * Coalescing decorator for functions
 */
export function Coalesce(operation: string, ttlMs = 100) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      return coalesce(operation, args, () => originalMethod.apply(this, args), { ttlMs })
    }

    return descriptor
  }
}

/**
 * Wrap function with coalescing
 */
export function withCoalescing<T extends (...args: any[]) => Promise<any>>(
  operation: string,
  fn: T,
  ttlMs = 100
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return coalesce(operation, args, () => fn(...args), { ttlMs })
  }) as T
}

/**
 * Get coalescing statistics
 */
export function getCoalescingStats(): {
  inflightRequests: number
  activeBatchers: number
} {
  return {
    inflightRequests: inflightRequests.size,
    activeBatchers: batchers.size,
  }
}

// Pre-built DataLoaders for common AEGIS operations
export function createUserLoader(pool: any): DataLoader<string, any> {
  return getDataLoader<string, any>('users', async (userIds) => {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = ANY($1::uuid[])`,
      [userIds]
    )
    const map = new Map<string, any>()
    for (const row of result.rows) {
      map.set(row.id, row)
    }
    return map
  })
}

export function createReportLoader(pool: any): DataLoader<string, any> {
  return getDataLoader<string, any>('reports', async (reportIds) => {
    const result = await pool.query(
      `SELECT * FROM reports WHERE id = ANY($1::uuid[])`,
      [reportIds]
    )
    const map = new Map<string, any>()
    for (const row of result.rows) {
      map.set(row.id, row)
    }
    return map
  })
}

export default {
  coalesce,
  DataLoader,
  getDataLoader,
  Coalesce,
  withCoalescing,
  getCoalescingStats,
  createUserLoader,
  createReportLoader,
}
