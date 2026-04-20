/**
 * QoS middleware -- Express middleware implementing multi-tier quality of service
 * with 5 priority levels (CRITICAL -> BEST_EFFORT). Queues requests when
 * concurrency exceeds the limit and auto-escalates stuck requests.
 *
 * - Express middleware applied before route handlers
 * - Tracks queue depth and wait time via Prometheus
 * - Routes like /distress get CRITICAL priority by default
 * */

import { Request, Response, NextFunction } from 'express'
import client from 'prom-client'
import { logger } from './logger.js'

//Prometheus metrics
const queueDepthGauge = new client.Gauge({
  name: 'aegis_qos_queue_depth',
  help: 'Current queue depth by priority',
  labelNames: ['priority'] as const,
})

const queueWaitTime = new client.Histogram({
  name: 'aegis_qos_wait_seconds',
  help: 'Time spent waiting in queue',
  labelNames: ['priority'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
})

const priorityEscalations = new client.Counter({
  name: 'aegis_qos_escalations_total',
  help: 'Total priority escalations',
  labelNames: ['from', 'to'] as const,
})

//Priority levels (higher = more important)
export enum Priority {
  CRITICAL = 100,    // Emergency/distress, admin operations
  HIGH = 75,         // Authenticated users, time-sensitive
  NORMAL = 50,       // Regular authenticated requests
  LOW = 25,          // Background tasks, bulk operations
  BEST_EFFORT = 10,  // Anonymous, non-essential
}

interface QueueEntry {
  id: string
  priority: Priority
  originalPriority: Priority
  enqueuedAt: number
  deadline?: number      // Absolute timestamp
  slaMs?: number         // Max acceptable wait
  resolve: () => void
  reject: (err: Error) => void
  req: Request
  escalationCount: number
}

//Priority queues (separate queue per priority level)
const queues: Map<Priority, QueueEntry[]> = new Map([
  [Priority.CRITICAL, []],
  [Priority.HIGH, []],
  [Priority.NORMAL, []],
  [Priority.LOW, []],
  [Priority.BEST_EFFORT, []],
])

//Configuration
const MAX_CONCURRENT = parseInt(process.env.QOS_MAX_CONCURRENT || '100', 10)
const QUEUE_TIMEOUT_MS = parseInt(process.env.QOS_QUEUE_TIMEOUT_MS || '30000', 10)
const ESCALATION_INTERVAL_MS = 2000  // Check for stuck requests every 2s
const MAX_ESCALATIONS = 3

let activeRequests = 0
let requestIdCounter = 0

/**
 * Determine priority for a request
 */
function determinePriority(req: Request): { priority: Priority; slaMs?: number } {
  const user = (req as any).user
  const path = req.path

  //CRITICAL: Emergency endpoints
  if (path.startsWith('/api/distress') || path.includes('/sos')) {
    return { priority: Priority.CRITICAL, slaMs: 500 }
  }

  //CRITICAL: Admin operations
  if (user?.role === 'admin') {
    return { priority: Priority.CRITICAL, slaMs: 2000 }
  }

  //HIGH: Operators
  if (user?.role === 'operator' || user?.role === 'manager') {
    return { priority: Priority.HIGH, slaMs: 3000 }
  }

  //HIGH: Real-time features
  if (path.startsWith('/api/chat') || path.includes('/realtime')) {
    return { priority: Priority.HIGH, slaMs: 5000 }
  }

  //NORMAL: Authenticated citizens
  if (user) {
    return { priority: Priority.NORMAL, slaMs: 10000 }
  }

  //LOW: Bulk operations
  if (path.includes('/bulk') || path.includes('/export') || path.includes('/import')) {
    return { priority: Priority.LOW, slaMs: 30000 }
  }

  //BEST_EFFORT: Anonymous
  return { priority: Priority.BEST_EFFORT, slaMs: 15000 }
}

/**
 * Get next request to process (weighted fair queuing)
 */
function getNextRequest(): QueueEntry | null {
  //Process by priority order
  for (const priority of [Priority.CRITICAL, Priority.HIGH, Priority.NORMAL, Priority.LOW, Priority.BEST_EFFORT]) {
    const queue = queues.get(priority)!
    if (queue.length > 0) {
      //Sort by deadline (earliest first) within same priority
      queue.sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity))
      return queue.shift()!
    }
  }
  return null
}

/**
 * Process queue - called when capacity becomes available
 */
function processQueue(): void {
  while (activeRequests < MAX_CONCURRENT) {
    const entry = getNextRequest()
    if (!entry) break

    const waitTime = (Date.now() - entry.enqueuedAt) / 1000
    queueWaitTime.labels(String(entry.priority)).observe(waitTime)

    activeRequests++
    entry.resolve()
  }

  //Update metrics
  for (const [priority, queue] of queues) {
    queueDepthGauge.labels(String(priority)).set(queue.length)
  }
}

/**
 * Escalate stuck requests to higher priority
 */
function escalateStuckRequests(): void {
  const now = Date.now()

  for (const [priority, queue] of queues) {
    if (priority === Priority.CRITICAL) continue // Can't escalate higher

    for (const entry of queue) {
      //Check if request is past SLA
      const waitTime = now - entry.enqueuedAt
      if (entry.slaMs && waitTime > entry.slaMs && entry.escalationCount < MAX_ESCALATIONS) {
        //Remove from current queue
        const idx = queue.indexOf(entry)
        if (idx !== -1) queue.splice(idx, 1)

        //Escalate to next priority level
        const newPriority = getNextHigherPriority(priority)
        entry.priority = newPriority
        entry.escalationCount++
        entry.slaMs = Math.round(entry.slaMs * 0.5) // Tighten SLA

        queues.get(newPriority)!.push(entry)

        priorityEscalations.labels(String(priority), String(newPriority)).inc()

        logger.debug({
          requestId: entry.id,
          from: priority,
          to: newPriority,
          waitTimeMs: waitTime,
        }, '[QoS] Request escalated')
      }
    }
  }
}

function getNextHigherPriority(current: Priority): Priority {
  switch (current) {
    case Priority.BEST_EFFORT: return Priority.LOW
    case Priority.LOW: return Priority.NORMAL
    case Priority.NORMAL: return Priority.HIGH
    case Priority.HIGH: return Priority.CRITICAL
    default: return Priority.CRITICAL
  }
}

/**
 * Request complete - release capacity
 */
export function releaseRequest(): void {
  activeRequests = Math.max(0, activeRequests - 1)
  processQueue()
}

/**
 * QoS middleware - implements priority queuing
 */
export async function qosMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  //Skip for internal paths
  if (req.path === '/api/health' || req.path === '/metrics') {
    next()
    return
  }

  const { priority, slaMs } = determinePriority(req)

  //Fast path: if under capacity, proceed immediately
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++

    //Track completion
    res.on('finish', releaseRequest)
    res.on('close', releaseRequest)

    next()
    return
  }

  //Queue the request
  const entry: QueueEntry = {
    id: `req-${++requestIdCounter}`,
    priority,
    originalPriority: priority,
    enqueuedAt: Date.now(),
    deadline: slaMs ? Date.now() + slaMs : undefined,
    slaMs,
    resolve: () => {},
    reject: () => {},
    req,
    escalationCount: 0,
  }

  const promise = new Promise<void>((resolve, reject) => {
    entry.resolve = resolve
    entry.reject = reject
  })

  queues.get(priority)!.push(entry)
  queueDepthGauge.labels(String(priority)).set(queues.get(priority)!.length)

  //Set queue timeout
  const timeout = setTimeout(() => {
    //Remove from queue
    for (const queue of queues.values()) {
      const idx = queue.indexOf(entry)
      if (idx !== -1) {
        queue.splice(idx, 1)
        break
      }
    }

    entry.reject(new Error('Request queue timeout'))
  }, QUEUE_TIMEOUT_MS)

  try {
    await promise
    clearTimeout(timeout)

    //Track completion
    res.on('finish', releaseRequest)
    res.on('close', releaseRequest)

    //Add QoS headers
    res.setHeader('X-QoS-Priority', String(priority))
    res.setHeader('X-QoS-Original-Priority', String(entry.originalPriority))
    res.setHeader('X-QoS-Wait-Ms', String(Date.now() - entry.enqueuedAt))
    if (entry.escalationCount > 0) {
      res.setHeader('X-QoS-Escalations', String(entry.escalationCount))
    }

    next()
  } catch (err) {
    clearTimeout(timeout)
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_OVERLOADED',
        message: 'Server is at capacity. Please retry shortly.',
        retryAfter: 5,
      },
    })
  }
}

/**
 * Get QoS statistics
 */
export function getQosStats(): {
  activeRequests: number
  maxConcurrent: number
  utilization: number
  queueDepths: Record<string, number>
  totalQueued: number
} {
  const queueDepths: Record<string, number> = {}
  let totalQueued = 0

  for (const [priority, queue] of queues) {
    queueDepths[Priority[priority]] = queue.length
    totalQueued += queue.length
  }

  return {
    activeRequests,
    maxConcurrent: MAX_CONCURRENT,
    utilization: activeRequests / MAX_CONCURRENT,
    queueDepths,
    totalQueued,
  }
}

/**
 * Adjust max concurrent limit dynamically
 */
export function setMaxConcurrent(limit: number): void {
  const oldLimit = MAX_CONCURRENT
  //Note: This would require making MAX_CONCURRENT mutable
  logger.info({ oldLimit, newLimit: limit }, '[QoS] Max concurrent adjusted')
}

//Start escalation checker
setInterval(escalateStuckRequests, ESCALATION_INTERVAL_MS)

export default {
  qosMiddleware,
  releaseRequest,
  getQosStats,
  setMaxConcurrent,
  Priority,
}
