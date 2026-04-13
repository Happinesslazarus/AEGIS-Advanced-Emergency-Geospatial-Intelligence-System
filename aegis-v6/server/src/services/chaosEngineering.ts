/**
 * File: chaosEngineering.ts
 *
 * Controlled fault injection middleware — injects latency, errors, memory
 * pressure, CPU burn, or circuit trips when experiments are active. Gated by
 * CHAOS_ENGINEERING_ENABLED and restricted to dev/staging/chaos environments.
 *
 * How it connects:
 * - Express middleware that intercepts requests when experiments are active
 * - Tracks experiments with Prometheus metrics
 * - Never enabled by default in production
 *
 * Simple explanation:
 * Breaks things on purpose (safely) so we can find weaknesses before users do.
 */

import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { logger } from './logger.js'
import client from 'prom-client'

// Prometheus metrics
const chaosInjections = new client.Counter({
  name: 'aegis_chaos_injections_total',
  help: 'Total chaos faults injected',
  labelNames: ['type', 'target'] as const,
})

const activeExperiments = new client.Gauge({
  name: 'aegis_chaos_active_experiments',
  help: 'Number of currently active chaos experiments',
})

// Safety check: NEVER enable chaos in production unless explicitly allowed
const CHAOS_ENABLED = process.env.CHAOS_ENGINEERING_ENABLED === 'true'
const CHAOS_ALLOWED_ENVS = ['development', 'staging', 'chaos']

function isChaosAllowed(): boolean {
  if (!CHAOS_ENABLED) return false
  const env = process.env.NODE_ENV || 'development'
  return CHAOS_ALLOWED_ENVS.includes(env)
}

// Experiment types
export type ChaosType = 
  | 'latency'           // Add artificial delay
  | 'error'             // Return error responses
  | 'memory'            // Allocate memory
  | 'cpu'               // CPU burn
  | 'exception'         // Throw exceptions
  | 'timeout'           // Force request timeout
  | 'circuit_trip'      // Trip circuit breakers

interface ChaosExperiment {
  id: string
  type: ChaosType
  name: string
  description?: string
  config: ChaosConfig
  startTime: number
  endTime: number
  affectedRequests: number
  triggered: number
  status: 'active' | 'completed' | 'terminated'
}

interface ChaosConfig {
  // Target selection
  targetPaths?: RegExp[]       // Paths to affect
  targetMethods?: string[]     // HTTP methods to affect
  targetUsers?: string[]       // Specific user IDs
  excludePaths?: RegExp[]      // Paths to never affect
  sampleRate?: number          // 0-1, probability of affecting a request (default: 0.1)

  // Fault parameters
  latencyMs?: number           // For latency injection
  latencyJitterMs?: number     // Random variance
  errorCode?: number           // For error injection
  errorMessage?: string
  memoryMb?: number            // For memory pressure
  cpuDurationMs?: number       // For CPU burn
  circuitTarget?: string       // For circuit trip
}

// Active experiments
const experiments = new Map<string, ChaosExperiment>()

// Memory allocations for memory chaos (to prevent GC)
const memoryPools: Buffer[] = []

/**
 * Create a new chaos experiment
 */
export function createExperiment(
  type: ChaosType,
  name: string,
  config: ChaosConfig,
  durationMs: number
): ChaosExperiment | null {
  if (!isChaosAllowed()) {
    logger.warn('[Chaos] Attempted to create experiment but chaos is disabled')
    return null
  }

  const experiment: ChaosExperiment = {
    id: crypto.randomUUID(),
    type,
    name,
    config: {
      sampleRate: config.sampleRate ?? 0.1, // Default 10% if not provided
      ...config,
    },
    startTime: Date.now(),
    endTime: Date.now() + durationMs,
    affectedRequests: 0,
    triggered: 0,
    status: 'active',
  }

  experiments.set(experiment.id, experiment)
  activeExperiments.set(experiments.size)

  logger.warn({
    experimentId: experiment.id,
    type,
    name,
    durationMs,
    config,
  }, '[Chaos] Experiment STARTED')

  // Auto-terminate after duration
  setTimeout(() => terminateExperiment(experiment.id), durationMs)

  return experiment
}

/**
 * Terminate an experiment
 */
export function terminateExperiment(id: string): ChaosExperiment | null {
  const experiment = experiments.get(id)
  if (!experiment) return null

  experiment.status = 'completed'
  experiment.endTime = Date.now()
  experiments.delete(id)
  activeExperiments.set(experiments.size)

  logger.warn({
    experimentId: id,
    triggered: experiment.triggered,
    affectedRequests: experiment.affectedRequests,
  }, '[Chaos] Experiment TERMINATED')

  return experiment
}

/**
 * Emergency kill switch - terminates ALL experiments
 */
export function killAllExperiments(): number {
  const count = experiments.size
  for (const id of experiments.keys()) {
    terminateExperiment(id)
  }

  // Clear memory allocations
  memoryPools.length = 0

  logger.warn({ count }, '[Chaos] KILL SWITCH activated - all experiments terminated')
  return count
}

/**
 * Check if a request matches experiment targeting
 */
function matchesTarget(req: Request, config: ChaosConfig): boolean {
  // Check exclusions first
  if (config.excludePaths) {
    for (const pattern of config.excludePaths) {
      if (pattern.test(req.path)) return false
    }
  }

  // Always exclude health checks
  if (req.path === '/api/health' || req.path === '/metrics') return false

  // Check path patterns
  if (config.targetPaths && config.targetPaths.length > 0) {
    const matches = config.targetPaths.some(p => p.test(req.path))
    if (!matches) return false
  }

  // Check methods
  if (config.targetMethods && config.targetMethods.length > 0) {
    if (!config.targetMethods.includes(req.method)) return false
  }

  // Check users
  if (config.targetUsers && config.targetUsers.length > 0) {
    const userId = (req as any).user?.id
    if (!userId || !config.targetUsers.includes(userId)) return false
  }

  // Sample rate check (default to 10% if not specified)
  return Math.random() < (config.sampleRate ?? 0.1)
}

/**
 * Apply chaos effect to request
 */
async function applyChaos(
  experiment: ChaosExperiment,
  req: Request,
  res: Response
): Promise<'continue' | 'handled'> {
  experiment.triggered++
  chaosInjections.labels(experiment.type, experiment.name).inc()

  switch (experiment.type) {
    case 'latency': {
      const baseLatency = experiment.config.latencyMs || 1000
      const jitter = experiment.config.latencyJitterMs || 0
      const delay = baseLatency + Math.random() * jitter
      await new Promise(resolve => setTimeout(resolve, delay))
      return 'continue'
    }

    case 'error': {
      const code = experiment.config.errorCode || 500
      const message = experiment.config.errorMessage || 'Chaos-injected failure'
      res.status(code).json({
        success: false,
        error: {
          code: 'CHAOS_INJECTION',
          message,
          _chaos: { experimentId: experiment.id, type: experiment.type },
        },
      })
      return 'handled'
    }

    case 'timeout': {
      // Never respond - let request timeout
      await new Promise(() => {}) // Infinite wait
      return 'handled'
    }

    case 'exception': {
      throw new Error(`[Chaos] Injected exception from experiment ${experiment.id}`)
    }

    case 'memory': {
      const mb = experiment.config.memoryMb || 100
      const buffer = Buffer.alloc(mb * 1024 * 1024)
      memoryPools.push(buffer)

      // Release after 30 seconds
      setTimeout(() => {
        const idx = memoryPools.indexOf(buffer)
        if (idx !== -1) memoryPools.splice(idx, 1)
      }, 30_000)

      return 'continue'
    }

    case 'cpu': {
      const duration = experiment.config.cpuDurationMs || 100
      const end = Date.now() + duration
      while (Date.now() < end) {
        // CPU burn
        Math.random() * Math.random()
      }
      return 'continue'
    }

    default:
      return 'continue'
  }
}

/**
 * Chaos engineering middleware
 */
export function chaosMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isChaosAllowed() || experiments.size === 0) {
    next()
    return
  }

  // Find matching active experiments
  const matches: ChaosExperiment[] = []
  const now = Date.now()

  for (const experiment of experiments.values()) {
    if (experiment.status !== 'active') continue
    if (now > experiment.endTime) {
      terminateExperiment(experiment.id)
      continue
    }
    if (matchesTarget(req, experiment.config)) {
      experiment.affectedRequests++
      matches.push(experiment)
    }
  }

  if (matches.length === 0) {
    next()
    return
  }

  // Apply first matching experiment (could be extended to apply multiple)
  const experiment = matches[0]

  applyChaos(experiment, req, res)
    .then(result => {
      if (result === 'continue') next()
      // 'handled' means response already sent
    })
    .catch(err => {
      next(err)
    })
}

/**
 * Get all experiments (active and recent)
 */
export function getExperiments(): ChaosExperiment[] {
  return Array.from(experiments.values())
}

/**
 * Get chaos engineering status
 */
export function getChaosStatus(): {
  enabled: boolean
  allowed: boolean
  activeExperiments: number
  experiments: ChaosExperiment[]
} {
  return {
    enabled: CHAOS_ENABLED,
    allowed: isChaosAllowed(),
    activeExperiments: experiments.size,
    experiments: Array.from(experiments.values()),
  }
}

// Pre-defined experiment templates
export const EXPERIMENT_TEMPLATES = {
  slowDatabase: () => createExperiment(
    'latency',
    'Slow database simulation',
    {
      targetPaths: [/^\/api\/reports/, /^\/api\/users/],
      sampleRate: 0.3,
      latencyMs: 2000,
      latencyJitterMs: 500,
    },
    60_000 // 1 minute
  ),

  aiEngineDown: () => createExperiment(
    'error',
    'AI engine failure',
    {
      targetPaths: [/^\/api\/ai/, /^\/api\/chat/],
      sampleRate: 1.0,
      errorCode: 503,
      errorMessage: 'AI engine unavailable',
    },
    30_000
  ),

  highLoad: () => createExperiment(
    'latency',
    'High load simulation',
    {
      sampleRate: 0.5,
      latencyMs: 500,
      latencyJitterMs: 300,
    },
    120_000 // 2 minutes
  ),

  memoryPressure: () => createExperiment(
    'memory',
    'Memory pressure test',
    {
      sampleRate: 0.1,
      memoryMb: 50,
    },
    60_000
  ),
}

export default {
  createExperiment,
  terminateExperiment,
  killAllExperiments,
  chaosMiddleware,
  getExperiments,
  getChaosStatus,
  EXPERIMENT_TEMPLATES,
}
