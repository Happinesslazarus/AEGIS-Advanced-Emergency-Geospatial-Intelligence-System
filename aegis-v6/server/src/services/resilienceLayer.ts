/**
 * File: resilienceLayer.ts
 *
 * Three-in-one resilience module — LRU caches with TTL (for API, embedding,
 * and LLM responses), token-bucket rate limiters for 8 external providers,
 * and a circuit breaker. Exports resilientFetch which wraps HTTP calls with
 * all three protections.
 *
 * How it connects:
 * - Used by llmRouter, embeddingRouter, and external API wrappers
 * - Rate limits pre-configured for Gemini, Groq, HuggingFace, etc.
 * - selfHealing reads circuit breaker state for health scoring
 *
 * Simple explanation:
 * Prevents cascading failures when external services go down.
 */

import { logger } from './logger.js'

// -1  LRU CACHE WITH TTL

interface CacheEntry<T> {
  value: T
  expiresAt: number
  key: string
}

class LRUCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number
  private hitCount = 0
  private missCount = 0

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) { this.missCount++; return undefined }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.missCount++
      return undefined
    }
    // Move to front (delete + re-add)
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.hitCount++
    return entry.value
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs, key })
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) { this.cache.delete(key); return false }
    return true
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const size = this.cache.size
      this.cache.clear()
      return size
    }
    let removed = 0
    for (const key of [...this.cache.keys()]) {
      if (key.includes(pattern)) { this.cache.delete(key); removed++ }
    }
    return removed
  }

  stats() {
    const total = this.hitCount + this.missCount
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? (this.hitCount / total * 100).toFixed(1) + '%' : 'N/A',
    }
  }
}

// Global cache instances
export const apiCache = new LRUCache(500)       // API response cache
export const embeddingCache = new LRUCache(200)  // Embedding vector cache
export const llmCache = new LRUCache(100)        // LLM response cache

// -2  RATE LIMITER

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>()
  private configs = new Map<string, RateLimitConfig>()

  configure(provider: string, config: RateLimitConfig): void {
    this.configs.set(provider, config)
  }

  /* Returns true if request is allowed, false if rate limited */
  acquire(provider: string): boolean {
    const config = this.configs.get(provider) || { maxRequests: 30, windowMs: 60000 }
    const now = Date.now()
    let window = this.windows.get(provider)

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + config.windowMs }
      this.windows.set(provider, window)
    }

    if (window.count >= config.maxRequests) return false
    window.count++
    return true
  }

  /* Wait until rate limit allows a request */
  async waitForSlot(provider: string): Promise<void> {
    while (!this.acquire(provider)) {
      const window = this.windows.get(provider)
      const waitMs = window ? Math.max(0, window.resetAt - Date.now()) : 1000
      await new Promise(r => setTimeout(r, Math.min(waitMs + 100, 5000)))
    }
  }

  status(): Record<string, { count: number; limit: number; resetIn: number }> {
    const result: Record<string, any> = {}
    for (const [provider, window] of this.windows) {
      const config = this.configs.get(provider) || { maxRequests: 30, windowMs: 60000 }
      result[provider] = {
        count: window.count,
        limit: config.maxRequests,
        resetIn: Math.max(0, window.resetAt - Date.now()),
      }
    }
    return result
  }
}

export const rateLimiter = new RateLimiter()

// Configure known providers
rateLimiter.configure('gemini', { maxRequests: 15, windowMs: 60000 })
rateLimiter.configure('groq', { maxRequests: 30, windowMs: 60000 })
rateLimiter.configure('huggingface', { maxRequests: 30, windowMs: 60000 })
rateLimiter.configure('openrouter', { maxRequests: 20, windowMs: 60000 })
rateLimiter.configure('ea_api', { maxRequests: 30, windowMs: 60000 })
rateLimiter.configure('sepa_api', { maxRequests: 20, windowMs: 60000 })
rateLimiter.configure('openweather', { maxRequests: 60, windowMs: 60000 })
rateLimiter.configure('nasa_power', { maxRequests: 10, windowMs: 60000 })
rateLimiter.configure('open_meteo', { maxRequests: 30, windowMs: 60000 })
rateLimiter.configure('newsapi', { maxRequests: 5, windowMs: 60000 })
rateLimiter.configure('wikipedia', { maxRequests: 10, windowMs: 60000 })
rateLimiter.configure('nominatim', { maxRequests: 1, windowMs: 1000 }) // Strict 1/sec

// -3  CIRCUIT BREAKER

interface CircuitState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
  successesSinceHalfOpen: number
}

class CircuitBreaker {
  private circuits = new Map<string, CircuitState>()
  private failureThreshold = 5
  private resetTimeout = 60000  // 1 minute
  private halfOpenSuccesses = 2

  isOpen(provider: string): boolean {
    const circuit = this.circuits.get(provider)
    if (!circuit) return false

    if (circuit.state === 'open') {
      // Check if reset timeout has elapsed
      if (Date.now() - circuit.lastFailure > this.resetTimeout) {
        circuit.state = 'half-open'
        circuit.successesSinceHalfOpen = 0
        return false
      }
      return true
    }
    return false
  }

  recordSuccess(provider: string): void {
    const circuit = this.circuits.get(provider)
    if (!circuit) return

    if (circuit.state === 'half-open') {
      circuit.successesSinceHalfOpen++
      if (circuit.successesSinceHalfOpen >= this.halfOpenSuccesses) {
        circuit.state = 'closed'
        circuit.failures = 0
      }
    } else {
      circuit.failures = Math.max(0, circuit.failures - 1)
    }
  }

  recordFailure(provider: string): void {
    let circuit = this.circuits.get(provider)
    if (!circuit) {
      circuit = { failures: 0, lastFailure: 0, state: 'closed', successesSinceHalfOpen: 0 }
      this.circuits.set(provider, circuit)
    }

    circuit.failures++
    circuit.lastFailure = Date.now()

    if (circuit.failures >= this.failureThreshold) {
      circuit.state = 'open'
      logger.warn({ provider, failures: circuit.failures }, '[CircuitBreaker] Circuit OPENED')
    }
  }

  status(): Record<string, { state: string; failures: number }> {
    const result: Record<string, any> = {}
    for (const [provider, circuit] of this.circuits) {
      result[provider] = { state: circuit.state, failures: circuit.failures }
    }
    return result
  }
}

export const circuitBreaker = new CircuitBreaker()

// -4  RESILIENT FETCH - Combines all layers

interface ResilientFetchOptions {
  provider: string
  cacheKey?: string
  cacheTtlMs?: number
  maxRetries?: number
  timeoutMs?: number
}

 /*
 * Fetch with full resilience: cache check ? rate limit ? circuit breaker ? retry ? cache store
  */
export async function resilientFetch<T = any>(
  url: string,
  fetchOpts: RequestInit = {},
  opts: ResilientFetchOptions,
): Promise<T> {
  const {
    provider,
    cacheKey,
    cacheTtlMs = 300_000, // 5 min default
    maxRetries = 3,
    timeoutMs = 15_000,
  } = opts

  // 1. Cache check
  if (cacheKey) {
    const cached = apiCache.get(cacheKey) as T | undefined
    if (cached) return cached
  }

  // 2. Circuit breaker
  if (circuitBreaker.isOpen(provider)) {
    throw new Error(`[Resilience] ${provider} circuit is open - service temporarily unavailable`)
  }

  // 3. Rate limit
  await rateLimiter.waitForSlot(provider)

  // 4. Fetch with retry
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5')
        logger.warn({ provider, retryAfter }, '[Resilience] Provider rate limited')
        await new Promise(r => setTimeout(r, retryAfter * 1000))
        continue
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json() as T

      // 5. Record success + cache
      circuitBreaker.recordSuccess(provider)
      if (cacheKey) {
        apiCache.set(cacheKey, data, cacheTtlMs)
      }

      return data
    } catch (err: any) {
      lastError = err
      circuitBreaker.recordFailure(provider)

      if (attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 1000
        logger.warn({ provider, attempt: attempt + 1, backoffMs: backoff, error: err.message }, '[Resilience] Attempt failed, retrying')
        await new Promise(r => setTimeout(r, backoff))
      }
    }
  }

  throw lastError || new Error(`[Resilience] ${provider}: all retries exhausted`)
}

// -5  HEALTH MONITORING

export function getResilienceStatus() {
  return {
    cache: {
      api: apiCache.stats(),
      embedding: embeddingCache.stats(),
      llm: llmCache.stats(),
    },
    rateLimits: rateLimiter.status(),
    circuitBreakers: circuitBreaker.status(),
  }
}

