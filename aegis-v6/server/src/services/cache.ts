/**
 * DEPRECATED — All cache operations now go through cacheService.ts, which
 * provides namespacing, metrics, stale-while-revalidate, and LRU eviction.
 *
 * This file previously created a SEPARATE Redis connection from the one in
 * cacheService.ts. Since no module imports from this file, it has been emptied
 * to eliminate the duplicate connection.
 *
 * If you need cache operations, import from './cacheService.js' instead.
 */

// Intentionally empty — see cacheService.ts
