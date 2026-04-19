/**
 * Graceful deployment lifecycle manager — handles STARTING → HEALTHY →
 * DRAINING → TERMINATING → TERMINATED transitions with connection draining,
 * priority-ordered shutdown hooks, and Kubernetes health endpoints.
 *
 * - Registers SIGTERM/SIGINT handlers for graceful shutdown
 * - Provides liveness, readiness, and startup probe handlers
 * - Tracks active connections to drain before terminating
 * */

import { Server } from 'http'
import { Pool } from 'pg'
import { Redis } from 'ioredis'
import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const shutdownDurationHistogram = new client.Histogram({
  name: 'aegis_shutdown_duration_seconds',
  help: 'Time taken for graceful shutdown',
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
})

const activeConnectionsGauge = new client.Gauge({
  name: 'aegis_active_connections',
  help: 'Current number of active connections',
})

const drainedConnectionsCounter = new client.Counter({
  name: 'aegis_drained_connections_total',
  help: 'Total connections drained during shutdown',
})

// Deployment states
export enum DeploymentState {
  STARTING = 'starting',
  HEALTHY = 'healthy',
  DRAINING = 'draining',     // Stop accepting new requests
  TERMINATING = 'terminating', // Cleaning up
  TERMINATED = 'terminated',
}

// Instance states
export enum HealthState {
  UNKNOWN = 'unknown',
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

interface ServerInstance {
  server: Server | null
  dbPool: Pool | null
  redisClient: Redis | null
  state: DeploymentState
  healthState: HealthState
  startedAt: Date
  activeConnections: number
  version: string
}

interface ShutdownHook {
  name: string
  priority: number  // Higher = run first
  fn: () => Promise<void>
}

interface HealthCheck {
  name: string
  check: () => Promise<{ healthy: boolean; message?: string }>
  critical: boolean  // If critical check fails, instance is unhealthy
}

// Instance state
const instance: ServerInstance = {
  server: null,
  dbPool: null,
  redisClient: null,
  state: DeploymentState.STARTING,
  healthState: HealthState.UNKNOWN,
  startedAt: new Date(),
  activeConnections: 0,
  version: process.env.APP_VERSION || 'unknown',
}

// Hooks and checks
const shutdownHooks: ShutdownHook[] = []
const healthChecks: HealthCheck[] = []

// Configuration
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10)
const DRAIN_TIMEOUT_MS = parseInt(process.env.DRAIN_TIMEOUT_MS || '15000', 10)
const HEALTH_CHECK_INTERVAL_MS = 5000

let healthCheckInterval: ReturnType<typeof setInterval> | null = null

/**
 * Initialize zero-downtime deployment support
 */
export function initZeroDowntime(options: {
  server?: Server
  dbPool?: Pool
  redisClient?: Redis
  version?: string
}): void {
  instance.server = options.server || null
  instance.dbPool = options.dbPool || null
  instance.redisClient = options.redisClient || null
  instance.version = options.version || instance.version

  // Register default health checks
  registerHealthCheck({
    name: 'database',
    critical: true,
    check: async () => {
      if (!instance.dbPool) return { healthy: true, message: 'No pool configured' }
      try {
        await instance.dbPool.query('SELECT 1')
        return { healthy: true }
      } catch (err) {
        return { healthy: false, message: (err as Error).message }
      }
    },
  })

  registerHealthCheck({
    name: 'redis',
    critical: false,
    check: async () => {
      if (!instance.redisClient) return { healthy: true, message: 'No Redis configured' }
      try {
        await instance.redisClient.ping()
        return { healthy: true }
      } catch (err) {
        return { healthy: false, message: (err as Error).message }
      }
    },
  })

  // Start health check loop
  healthCheckInterval = setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL_MS)

  // Register signal handlers
  registerSignalHandlers()

  // Transition to healthy after initial checks
  setTimeout(async () => {
    await runHealthChecks()
    if (instance.state === DeploymentState.STARTING) {
      instance.state = DeploymentState.HEALTHY
      logger.info({
        version: instance.version,
        pid: process.pid,
      }, '[ZeroDowntime] Server ready')
    }
  }, 1000)

  logger.info('[ZeroDowntime] Initialized')
}

/**
 * Register signal handlers for graceful shutdown
 */
function registerSignalHandlers(): void {
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP']

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info({ signal }, '[ZeroDowntime] Shutdown signal received')
      await gracefulShutdown()
    })
  }

  // Handle uncaught errors
  process.on('uncaughtException', async (err) => {
    logger.fatal({ err }, '[ZeroDowntime] Uncaught exception')
    await gracefulShutdown(1)
  })

  process.on('unhandledRejection', async (reason) => {
    logger.fatal({ reason }, '[ZeroDowntime] Unhandled rejection')
    await gracefulShutdown(1)
  })
}

/**
 * Graceful shutdown procedure
 */
export async function gracefulShutdown(exitCode = 0): Promise<void> {
  if (instance.state === DeploymentState.TERMINATED) return

  const startTime = Date.now()
  logger.info('[ZeroDowntime] Starting graceful shutdown')

  // Phase 1: Stop accepting new connections
  instance.state = DeploymentState.DRAINING

  // Stop health check loop
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }

  // Stop HTTP server from accepting new connections
  if (instance.server) {
    await new Promise<void>((resolve) => {
      instance.server!.close(() => {
        logger.info('[ZeroDowntime] HTTP server closed')
        resolve()
      })
    })
  }

  // Phase 2: Wait for active connections to drain
  await drainConnections()

  // Phase 3: Run shutdown hooks
  instance.state = DeploymentState.TERMINATING
  await runShutdownHooks()

  // Phase 4: Close resources
  await closeResources()

  // Record shutdown duration
  const duration = (Date.now() - startTime) / 1000
  shutdownDurationHistogram.observe(duration)

  instance.state = DeploymentState.TERMINATED
  logger.info({ durationSec: duration, exitCode }, '[ZeroDowntime] Shutdown complete')

  process.exit(exitCode)
}

/**
 * Wait for active connections to drain
 */
async function drainConnections(): Promise<void> {
  const startTime = Date.now()

  while (instance.activeConnections > 0) {
    const elapsed = Date.now() - startTime

    if (elapsed > DRAIN_TIMEOUT_MS) {
      logger.warn({
        remaining: instance.activeConnections,
      }, '[ZeroDowntime] Drain timeout, forcing closure')
      break
    }

    logger.debug({
      remaining: instance.activeConnections,
      elapsedMs: elapsed,
    }, '[ZeroDowntime] Draining connections')

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  drainedConnectionsCounter.inc(instance.activeConnections)
}

/**
 * Run registered shutdown hooks in priority order
 */
async function runShutdownHooks(): Promise<void> {
  // Sort by priority (higher first)
  const sorted = [...shutdownHooks].sort((a, b) => b.priority - a.priority)

  for (const hook of sorted) {
    try {
      logger.debug({ hook: hook.name }, '[ZeroDowntime] Running shutdown hook')
      await Promise.race([
        hook.fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Hook timeout')), 5000)
        ),
      ])
    } catch (err) {
      logger.error({ err, hook: hook.name }, '[ZeroDowntime] Shutdown hook failed')
    }
  }
}

/**
 * Close resources (DB, Redis, etc.)
 */
async function closeResources(): Promise<void> {
  // Close Redis
  if (instance.redisClient) {
    try {
      await instance.redisClient.quit()
      logger.info('[ZeroDowntime] Redis connection closed')
    } catch (err) {
      logger.error({ err }, '[ZeroDowntime] Redis close failed')
    }
  }

  // Close database pool
  if (instance.dbPool) {
    try {
      await instance.dbPool.end()
      logger.info('[ZeroDowntime] Database pool closed')
    } catch (err) {
      logger.error({ err }, '[ZeroDowntime] Database close failed')
    }
  }
}

/**
 * Register a shutdown hook
 */
export function registerShutdownHook(
  name: string,
  fn: () => Promise<void>,
  priority = 50
): void {
  shutdownHooks.push({ name, fn, priority })
  logger.debug({ hook: name, priority }, '[ZeroDowntime] Shutdown hook registered')
}

/**
 * Register a health check
 */
export function registerHealthCheck(check: HealthCheck): void {
  healthChecks.push(check)
  logger.debug({ check: check.name, critical: check.critical }, '[ZeroDowntime] Health check registered')
}

/**
 * Run all health checks
 */
async function runHealthChecks(): Promise<void> {
  const results: Array<{ name: string; healthy: boolean; message?: string }> = []
  let criticalFailure = false

  for (const check of healthChecks) {
    try {
      const result = await Promise.race([
        check.check(),
        new Promise<{ healthy: false; message: string }>((resolve) =>
          setTimeout(() => resolve({ healthy: false, message: 'Timeout' }), 5000)
        ),
      ])

      results.push({ name: check.name, ...result })

      if (!result.healthy && check.critical) {
        criticalFailure = true
      }
    } catch (err) {
      results.push({
        name: check.name,
        healthy: false,
        message: (err as Error).message,
      })

      if (check.critical) {
        criticalFailure = true
      }
    }
  }

  // Update health state
  if (criticalFailure) {
    instance.healthState = HealthState.UNHEALTHY
  } else if (results.some(r => !r.healthy)) {
    instance.healthState = HealthState.DEGRADED
  } else {
    instance.healthState = HealthState.HEALTHY
  }
}

/**
 * Track connection start
 */
export function trackConnectionStart(): void {
  instance.activeConnections++
  activeConnectionsGauge.set(instance.activeConnections)
}

/**
 * Track connection end
 */
export function trackConnectionEnd(): void {
  instance.activeConnections = Math.max(0, instance.activeConnections - 1)
  activeConnectionsGauge.set(instance.activeConnections)
}

/**
 * Kubernetes liveness probe endpoint handler
 * Returns 200 if process is alive (not in terminated state)
 */
export function livenessHandler(req: any, res: any): void {
  if (instance.state === DeploymentState.TERMINATED) {
    res.status(503).json({ status: 'terminated' })
  } else {
    res.status(200).json({ status: 'alive' })
  }
}

/**
 * Kubernetes readiness probe endpoint handler
 * Returns 200 only if ready to serve traffic
 */
export function readinessHandler(req: any, res: any): void {
  const isReady = (
    instance.state === DeploymentState.HEALTHY &&
    instance.healthState !== HealthState.UNHEALTHY
  )

  if (isReady) {
    res.status(200).json({
      status: 'ready',
      state: instance.state,
      health: instance.healthState,
      version: instance.version,
    })
  } else {
    res.status(503).json({
      status: 'not_ready',
      state: instance.state,
      health: instance.healthState,
      reason: getReadinessReason(),
    })
  }
}

/**
 * Startup probe - returns 200 once initialization is complete
 */
export function startupHandler(req: any, res: any): void {
  const isStarted = instance.state !== DeploymentState.STARTING

  if (isStarted) {
    res.status(200).json({ status: 'started', version: instance.version })
  } else {
    res.status(503).json({ status: 'starting' })
  }
}

/**
 * Full health check endpoint with details
 */
export async function healthHandler(req: any, res: any): Promise<void> {
  await runHealthChecks()

  const checks: Record<string, any> = {}
  for (const check of healthChecks) {
    try {
      checks[check.name] = await check.check()
    } catch (err) {
      checks[check.name] = { healthy: false, message: (err as Error).message }
    }
  }

  const response = {
    status: instance.healthState,
    state: instance.state,
    version: instance.version,
    uptime: Math.floor((Date.now() - instance.startedAt.getTime()) / 1000),
    activeConnections: instance.activeConnections,
    checks,
  }

  const statusCode = instance.healthState === HealthState.HEALTHY ? 200 : 503

  res.status(statusCode).json(response)
}

function getReadinessReason(): string {
  switch (instance.state) {
    case DeploymentState.STARTING:
      return 'Server is starting'
    case DeploymentState.DRAINING:
      return 'Server is draining connections'
    case DeploymentState.TERMINATING:
      return 'Server is terminating'
    case DeploymentState.TERMINATED:
      return 'Server has terminated'
    default:
      if (instance.healthState === HealthState.UNHEALTHY) {
        return 'Critical health check failed'
      }
      return 'Unknown'
  }
}

/**
 * Get current instance state
 */
export function getInstanceState(): {
  state: DeploymentState
  health: HealthState
  version: string
  uptime: number
  activeConnections: number
} {
  return {
    state: instance.state,
    health: instance.healthState,
    version: instance.version,
    uptime: Math.floor((Date.now() - instance.startedAt.getTime()) / 1000),
    activeConnections: instance.activeConnections,
  }
}

/**
 * Check if instance is ready for traffic
 */
export function isReady(): boolean {
  return (
    instance.state === DeploymentState.HEALTHY &&
    instance.healthState !== HealthState.UNHEALTHY
  )
}

/**
 * Check if instance should be terminated
 */
export function shouldTerminate(): boolean {
  return (
    instance.state === DeploymentState.DRAINING ||
    instance.state === DeploymentState.TERMINATING ||
    instance.state === DeploymentState.TERMINATED
  )
}

export default {
  initZeroDowntime,
  gracefulShutdown,
  registerShutdownHook,
  registerHealthCheck,
  trackConnectionStart,
  trackConnectionEnd,
  livenessHandler,
  readinessHandler,
  startupHandler,
  healthHandler,
  getInstanceState,
  isReady,
  shouldTerminate,
  DeploymentState,
  HealthState,
}
