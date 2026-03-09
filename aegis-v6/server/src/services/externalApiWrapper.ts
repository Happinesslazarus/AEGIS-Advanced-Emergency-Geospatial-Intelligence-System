/**
 * services/externalApiWrapper.ts — Resilient external API caller
 *
 * Every external API call (SEPA, Met Office, OpenWeatherMap, HuggingFace, LLM)
 * goes through this wrapper which provides:
 *   - Configurable timeout (default 10s)
 *   - Retry with exponential backoff (default 3 attempts)
 *   - Cache fallback when all retries fail
 *   - Structured error logging to external_api_errors table
 *   - Circuit breaker: stop calling after 10 consecutive failures for 5 minutes
 */

import pool from '../models/db.js'

interface CacheEntry<T> {
  data: T
  cachedAt: Date
}

interface CallResult<T> {
  data: T
  source: 'live' | 'cache'
  stale: boolean
  cachedAt?: string
}

// In-memory circuit breaker state
const circuitState: Record<string, { failures: number; openUntil: number }> = {}
const CIRCUIT_THRESHOLD = 10
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Call an external API with retry + cache fallback.
 *
 * @param name       Human-readable service name (e.g., 'sepa_gauge', 'openweathermap')
 * @param fetchFn    Async function that performs the actual HTTP call and returns parsed data
 * @param cacheKey   Unique key for caching the response in PostgreSQL
 * @param timeoutMs  Maximum time per attempt (default 10000ms)
 * @param maxRetries Maximum number of retry attempts (default 3)
 */
export async function callExternalAPI<T>(
  name: string,
  fetchFn: () => Promise<T>,
  cacheKey: string,
  timeoutMs: number = 10000,
  maxRetries: number = 3,
): Promise<CallResult<T>> {

  // Circuit breaker check
  const circuit = circuitState[name]
  if (circuit && circuit.failures >= CIRCUIT_THRESHOLD && Date.now() < circuit.openUntil) {
    console.warn(`[ExternalAPI] Circuit OPEN for ${name} — serving cache only (${circuit.failures} consecutive failures)`)
    const cached = await getCache<T>(cacheKey)
    if (cached) {
      return { data: cached.data, source: 'cache', stale: true, cachedAt: cached.cachedAt.toISOString() }
    }
    throw new ExternalAPIError(name, `Circuit breaker open and no cache available`)
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await withTimeout(fetchFn(), timeoutMs)

      // Success — reset circuit breaker
      if (circuitState[name]) {
        circuitState[name].failures = 0
      }

      // Update cache
      await updateCache(cacheKey, data)

      return { data, source: 'live', stale: false }
    } catch (error: any) {
      await logExternalAPIError(name, attempt, error, attempt === maxRetries)

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
        await sleep(delay)
      }
    }
  }

  // All retries failed — increment circuit breaker
  if (!circuitState[name]) {
    circuitState[name] = { failures: 0, openUntil: 0 }
  }
  circuitState[name].failures++
  if (circuitState[name].failures >= CIRCUIT_THRESHOLD) {
    circuitState[name].openUntil = Date.now() + CIRCUIT_COOLDOWN_MS
    console.error(`[ExternalAPI] Circuit breaker OPENED for ${name} after ${CIRCUIT_THRESHOLD} failures — cooling down ${CIRCUIT_COOLDOWN_MS / 1000}s`)
  }

  // Try cache fallback
  const cached = await getCache<T>(cacheKey)
  if (cached) {
    console.warn(`[ExternalAPI] ${name}: serving stale cached data from ${cached.cachedAt.toISOString()}`)
    return { data: cached.data, source: 'cache', stale: true, cachedAt: cached.cachedAt.toISOString() }
  }

  // No cache either — hard failure
  console.error(`[ExternalAPI] ${name}: no live data and no cache available`)
  throw new ExternalAPIError(name, 'All retries failed and no cache available')
}

/**
 * Reset a service's circuit breaker (e.g., when n8n recovers)
 */
export function resetCircuitBreaker(name: string): void {
  if (circuitState[name]) {
    circuitState[name].failures = 0
    circuitState[name].openUntil = 0
  }
}

/**
 * Get all circuit breaker states for the System Health panel
 */
export function getCircuitBreakerStates(): Record<string, { failures: number; isOpen: boolean }> {
  const result: Record<string, { failures: number; isOpen: boolean }> = {}
  for (const [name, state] of Object.entries(circuitState)) {
    result[name] = {
      failures: state.failures,
      isOpen: state.failures >= CIRCUIT_THRESHOLD && Date.now() < state.openUntil,
    }
  }
  return result
}

// ── Helpers ──

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    promise
      .then((v) => { clearTimeout(timer); resolve(v) })
      .catch((e) => { clearTimeout(timer); reject(e) })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function updateCache<T>(key: string, data: T): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO api_response_cache (cache_key, data, source, cached_at, expires_at)
       VALUES ($1, $2, 'live', now(), now() + interval '1 hour')
       ON CONFLICT (cache_key) DO UPDATE SET data = $2, source = 'live', cached_at = now(), expires_at = now() + interval '1 hour'`,
      [key, JSON.stringify(data)],
    )
  } catch (err: any) {
    console.warn(`[ExternalAPI] Cache write failed for ${key}: ${err.message}`)
  }
}

async function getCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const result = await pool.query(
      `SELECT data, cached_at FROM api_response_cache WHERE cache_key = $1`,
      [key],
    )
    if (result.rows.length === 0) return null
    return {
      data: result.rows[0].data as T,
      cachedAt: new Date(result.rows[0].cached_at),
    }
  } catch {
    return null
  }
}

async function logExternalAPIError(
  name: string, attempt: number, error: any, isFinalAttempt: boolean,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO external_api_errors (service_name, endpoint_url, attempt_number, error_message, response_status, fallback_used)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        name,
        error.url || null,
        attempt,
        error.message || String(error),
        error.status || null,
        isFinalAttempt,
      ],
    )
  } catch {
    // Don't fail the caller if error logging fails
  }
}

export class ExternalAPIError extends Error {
  constructor(public service: string, message: string) {
    super(`[${service}] ${message}`)
    this.name = 'ExternalAPIError'
  }
}
