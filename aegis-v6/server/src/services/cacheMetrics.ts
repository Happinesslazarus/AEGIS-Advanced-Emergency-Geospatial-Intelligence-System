/**
 * File: cacheMetrics.ts
 *
 * Prometheus metric definitions for the caching layer — counters for hits,
 * misses, sets, invalidations, errors, and stale serves, plus a histogram
 * for operation duration. Pure definitions, no business logic.
 *
 * How it connects:
 * - Imported by cacheService.ts to instrument cache operations
 * - Scraped by Prometheus alongside other metrics
 * - Separated from metrics.ts to avoid circular imports
 *
 * Simple explanation:
 * Defines the numbers Prometheus tracks about cache performance.
 */

import client from 'prom-client'

// Counters

export const cacheHitsTotal = new client.Counter({
  name: 'aegis_cache_hits_total',
  help: 'Total cache hits (key found and fresh)',
})

export const cacheMissesTotal = new client.Counter({
  name: 'aegis_cache_misses_total',
  help: 'Total cache misses (key not found or expired)',
})

export const cacheSetsTotal = new client.Counter({
  name: 'aegis_cache_sets_total',
  help: 'Total cache set operations',
  labelNames: ['namespace'] as const,
})

export const cacheInvalidationsTotal = new client.Counter({
  name: 'aegis_cache_invalidations_total',
  help: 'Total cache invalidation operations',
  labelNames: ['namespace'] as const,
})

export const cacheErrorsTotal = new client.Counter({
  name: 'aegis_cache_errors_total',
  help: 'Total cache errors (Redis failures, timeouts)',
  labelNames: ['operation'] as const,
})

export const cacheStaleServedTotal = new client.Counter({
  name: 'aegis_cache_stale_served_total',
  help: 'Total times stale cached data was served due to upstream failure',
  labelNames: ['namespace', 'provider'] as const,
})

// Namespace-level counters

export const cacheNamespaceHitsTotal = new client.Counter({
  name: 'aegis_cache_namespace_hits_total',
  help: 'Cache hits by namespace',
  labelNames: ['namespace'] as const,
})

export const cacheNamespaceMissesTotal = new client.Counter({
  name: 'aegis_cache_namespace_misses_total',
  help: 'Cache misses by namespace',
  labelNames: ['namespace'] as const,
})

// Histograms

export const cacheOperationDuration = new client.Histogram({
  name: 'aegis_cache_operation_duration_ms',
  help: 'Cache operation duration in milliseconds',
  labelNames: ['operation'] as const,
  buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
})
