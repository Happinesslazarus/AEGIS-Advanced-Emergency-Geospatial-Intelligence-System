/**
 * Circuit breaker for external service calls -- CLOSED / OPEN / HALF_OPEN
 * state machine, based on the stability pattern in Nygard (2007) "Release It!"
 * Ch.5 and Fowler's write-up: https://martinfowler.com/bliki/CircuitBreaker.html
 *
 * Once the failure threshold is exceeded the circuit opens and rejects all calls
 * for resetTimeout ms. After that window a single HALF_OPEN probe is allowed;
 * success closes the circuit, another failure re-opens it. Every transition is
 * recorded as a Prometheus gauge so the ops dashboard shows live circuit state.
 *
 * initCircuits() registers the default set (DB, AI engine, external APIs) and is
 * called from index.ts at startup. externalApiWrapper.ts routes every outbound
 * HTTP call through a circuit; resilienceLayer.ts wraps DB and AI engine calls.
 * GET /api/internal/circuits exposes getAllStatus() for admin introspection.
 *
 * Azure pattern reference:
 * https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
 */

import client from 'prom-client'
import { logger } from './logger.js'

// Prometheus metrics
const circuitState = new client.Gauge({
  name: 'aegis_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half_open, 2=open)',
  labelNames: ['circuit'] as const,
})

const circuitFailures = new client.Counter({
  name: 'aegis_circuit_breaker_failures_total',
  help: 'Total failures recorded by circuit breaker',
  labelNames: ['circuit'] as const,
})

const circuitSuccesses = new client.Counter({
  name: 'aegis_circuit_breaker_successes_total',
  help: 'Total successes after circuit half-open',
  labelNames: ['circuit'] as const,
})

const circuitTripped = new client.Counter({
  name: 'aegis_circuit_breaker_tripped_total',
  help: 'Total times circuit breaker tripped',
  labelNames: ['circuit'] as const,
})

const circuitRejected = new client.Counter({
  name: 'aegis_circuit_breaker_rejected_total',
  help: 'Total requests rejected by open circuit',
  labelNames: ['circuit'] as const,
})

// Circuit states
export enum CircuitState {
  CLOSED = 0,      // Normal operation
  HALF_OPEN = 1,   // Testing if service recovered
  OPEN = 2,        // Service failing, rejecting requests
}

interface CircuitConfig {
  failureThreshold: number          // Failures before opening
  successThreshold: number          // Successes to close from half-open
  timeout: number                   // ms before trying half-open
  halfOpenRequests: number          // Requests to allow in half-open
  volumeThreshold: number           // Min requests before opening
  errorPercentageThreshold: number  // Error % to trigger open
  resetTimeout: number              // ms to reset failure counter
}

interface CircuitStats {
  failures: number
  successes: number
  totalRequests: number
  lastFailure: number
  lastSuccess: number
  openedAt: number
  halfOpenRequests: number
}

interface Circuit {
  name: string
  state: CircuitState
  config: CircuitConfig
  stats: CircuitStats
  fallback?: () => Promise<any>
}

// Registry of all circuits
const circuits: Map<string, Circuit> = new Map()

// Default configuration
const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,              // 30 seconds
  halfOpenRequests: 3,
  volumeThreshold: 10,
  errorPercentageThreshold: 50,
  resetTimeout: 60000,         // 1 minute
}

/**
 * Create or get a circuit breaker
 */
export function getCircuit(
  name: string,
  config: Partial<CircuitConfig> = {},
  fallback?: () => Promise<any>
): Circuit {
  if (circuits.has(name)) {
    return circuits.get(name)!
  }

  const circuit: Circuit = {
    name,
    state: CircuitState.CLOSED,
    config: { ...DEFAULT_CONFIG, ...config },
    stats: {
      failures: 0,
      successes: 0,
      totalRequests: 0,
      lastFailure: 0,
      lastSuccess: 0,
      openedAt: 0,
      halfOpenRequests: 0,
    },
    fallback,
  }

  circuits.set(name, circuit)
  circuitState.labels(name).set(CircuitState.CLOSED)

  logger.info({ circuit: name, config: circuit.config }, '[CircuitBreaker] Created')

  return circuit
}

/**
 * Execute function with circuit breaker protection
 */
export async function execute<T>(
  circuitName: string,
  fn: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  const circuit = circuits.get(circuitName)
  if (!circuit) {
    throw new Error(`Circuit "${circuitName}" not found`)
  }

  const effectiveFallback = fallback || circuit.fallback

  // Check state transitions
  checkStateTransition(circuit)

  // If open, reject immediately (fail fast)
  if (circuit.state === CircuitState.OPEN) {
    circuitRejected.labels(circuitName).inc()

    if (effectiveFallback) {
      logger.debug({ circuit: circuitName }, '[CircuitBreaker] Open, using fallback')
      return effectiveFallback()
    }

    throw new CircuitOpenError(circuitName)
  }

  // If half-open, check if we can try
  if (circuit.state === CircuitState.HALF_OPEN) {
    if (circuit.stats.halfOpenRequests >= circuit.config.halfOpenRequests) {
      circuitRejected.labels(circuitName).inc()

      if (effectiveFallback) {
        return effectiveFallback()
      }

      throw new CircuitOpenError(circuitName)
    }
    circuit.stats.halfOpenRequests++
  }

  // Execute the function
  circuit.stats.totalRequests++

  try {
    const result = await fn()
    recordSuccess(circuit)
    return result
  } catch (err) {
    recordFailure(circuit)
    throw err
  }
}

/**
 * Record successful execution
 */
function recordSuccess(circuit: Circuit): void {
  circuit.stats.successes++
  circuit.stats.lastSuccess = Date.now()

  if (circuit.state === CircuitState.HALF_OPEN) {
    circuitSuccesses.labels(circuit.name).inc()

    if (circuit.stats.successes >= circuit.config.successThreshold) {
      // Recovery confirmed, close circuit
      transitionTo(circuit, CircuitState.CLOSED)
      resetStats(circuit)
    }
  }
}

/**
 * Record failed execution
 */
function recordFailure(circuit: Circuit): void {
  circuit.stats.failures++
  circuit.stats.lastFailure = Date.now()
  circuitFailures.labels(circuit.name).inc()

  if (circuit.state === CircuitState.HALF_OPEN) {
    // Failure in half-open means service still failing
    transitionTo(circuit, CircuitState.OPEN)
    return
  }

  // Check if should open
  const { config, stats } = circuit

  // Need minimum volume before opening
  if (stats.totalRequests < config.volumeThreshold) return

  // Check failure percentage
  const errorPercentage = (stats.failures / stats.totalRequests) * 100

  if (errorPercentage >= config.errorPercentageThreshold) {
    transitionTo(circuit, CircuitState.OPEN)
    return
  }

  // Check absolute threshold
  if (stats.failures >= config.failureThreshold) {
    transitionTo(circuit, CircuitState.OPEN)
  }
}

/**
 * Check if state should transition
 */
function checkStateTransition(circuit: Circuit): void {
  const now = Date.now()

  // Reset failure counter if old failures expired
  if (
    circuit.state === CircuitState.CLOSED &&
    circuit.stats.lastFailure > 0 &&
    now - circuit.stats.lastFailure > circuit.config.resetTimeout
  ) {
    resetStats(circuit)
  }

  // Transition from open to half-open after timeout
  if (
    circuit.state === CircuitState.OPEN &&
    now - circuit.stats.openedAt > circuit.config.timeout
  ) {
    transitionTo(circuit, CircuitState.HALF_OPEN)
    circuit.stats.halfOpenRequests = 0
    circuit.stats.successes = 0
    circuit.stats.failures = 0
  }
}

/**
 * Transition to new state
 */
function transitionTo(circuit: Circuit, newState: CircuitState): void {
  const oldState = circuit.state
  circuit.state = newState
  circuitState.labels(circuit.name).set(newState)

  if (newState === CircuitState.OPEN) {
    circuit.stats.openedAt = Date.now()
    circuitTripped.labels(circuit.name).inc()
  }

  logger.info({
    circuit: circuit.name,
    from: CircuitState[oldState],
    to: CircuitState[newState],
    failures: circuit.stats.failures,
    successes: circuit.stats.successes,
  }, '[CircuitBreaker] State transition')
}

/**
 * Reset circuit statistics
 */
function resetStats(circuit: Circuit): void {
  circuit.stats = {
    failures: 0,
    successes: 0,
    totalRequests: 0,
    lastFailure: 0,
    lastSuccess: 0,
    openedAt: circuit.stats.openedAt,
    halfOpenRequests: 0,
  }
}

/**
 * Force circuit state (for testing/admin)
 */
export function forceState(circuitName: string, state: CircuitState): void {
  const circuit = circuits.get(circuitName)
  if (!circuit) return

  transitionTo(circuit, state)
  if (state === CircuitState.CLOSED) {
    resetStats(circuit)
  }

  logger.warn({
    circuit: circuitName,
    state: CircuitState[state],
  }, '[CircuitBreaker] State forced')
}

/**
 * Get circuit status
 */
export function getStatus(circuitName: string): {
  name: string
  state: string
  isOpen: boolean
  stats: CircuitStats
  config: CircuitConfig
} | null {
  const circuit = circuits.get(circuitName)
  if (!circuit) return null

  return {
    name: circuit.name,
    state: CircuitState[circuit.state],
    isOpen: circuit.state === CircuitState.OPEN,
    stats: { ...circuit.stats },
    config: { ...circuit.config },
  }
}

/**
 * Get all circuits status
 */
export function getAllStatus(): ReturnType<typeof getStatus>[] {
  return Array.from(circuits.values()).map(c => getStatus(c.name)!)
}

/**
 * Clear all circuits (for testing)
 */
export function clearAll(): void {
  circuits.clear()
}

/**
 * Circuit breaker decorator for classes
 */
export function Circuitbreaker(
  circuitName: string,
  config?: Partial<CircuitConfig>
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    getCircuit(circuitName, config)

    descriptor.value = async function (...args: any[]) {
      return execute(circuitName, () => originalMethod.apply(this, args))
    }

    return descriptor
  }
}

/**
 * Wrap async function with circuit breaker
 */
export function withCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  circuitName: string,
  fn: T,
  config?: Partial<CircuitConfig>
): T {
  getCircuit(circuitName, config)

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return execute(circuitName, () => fn(...args))
  }) as T
}

/**
 * Circuit open error
 */
export class CircuitOpenError extends Error {
  readonly circuitName: string

  constructor(circuitName: string) {
    super(`Circuit "${circuitName}" is OPEN - service unavailable`)
    this.name = 'CircuitOpenError'
    this.circuitName = circuitName
  }
}

// Pre-configured circuits for AEGIS services
export const Circuits = {
  DATABASE: 'database',
  REDIS: 'redis',
  AI_ENGINE: 'ai_engine',
  EXTERNAL_WEATHER: 'external_weather',
  EXTERNAL_FLOOD: 'external_flood',
  EMAIL_SERVICE: 'email_service',
  SMS_SERVICE: 'sms_service',
  PUSH_NOTIFICATION: 'push_notification',
} as const

// Initialize common circuits
export function initCircuits(): void {
  // Database: high threshold, fast recovery
  getCircuit(Circuits.DATABASE, {
    failureThreshold: 10,
    successThreshold: 5,
    timeout: 15000,
    volumeThreshold: 20,
  })

  // Redis: moderate tolerance
  getCircuit(Circuits.REDIS, {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 10000,
  })

  // AI Engine: higher tolerance (can be slow)
  getCircuit(Circuits.AI_ENGINE, {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 60000,
    errorPercentageThreshold: 30,
  })

  // External APIs: lower tolerance
  getCircuit(Circuits.EXTERNAL_WEATHER, {
    failureThreshold: 3,
    timeout: 45000,
    errorPercentageThreshold: 40,
  })

  getCircuit(Circuits.EXTERNAL_FLOOD, {
    failureThreshold: 3,
    timeout: 45000,
    errorPercentageThreshold: 40,
  })

  logger.info('[CircuitBreaker] Initialized default circuits')
}

export default {
  getCircuit,
  execute,
  forceState,
  getStatus,
  getAllStatus,
  clearAll,
  withCircuitBreaker,
  Circuitbreaker,
  CircuitState,
  CircuitOpenError,
  Circuits,
  initCircuits,
}
