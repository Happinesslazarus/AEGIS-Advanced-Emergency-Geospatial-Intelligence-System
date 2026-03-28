/*
 * routes/adminCacheRoutes.ts — Admin cache management endpoints
 *   POST /api/admin/cache/clear            — Flush entire cache
 *   POST /api/admin/cache/clear-namespace  — Flush one namespace
 *   POST /api/admin/cache/clear-key        — Delete a single key
 *   GET  /api/admin/cache/stats            — Cache diagnostics
 */

import { Router, Response, NextFunction } from 'express'
import { authMiddleware, adminOnly, AuthRequest } from '../middleware/auth.js'
import { cacheInvalidatePattern, getCacheStats, cacheDel } from '../services/cacheService.js'
import { auditLog } from '../utils/logger.js'

const router = Router()

// All admin cache routes require admin authentication
router.use(authMiddleware, adminOnly)

 /**
 * POST /api/admin/cache/clear
 * Flush the entire aegis cache.
 * Body: { dryRun?: boolean }
 */
router.post('/clear', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dryRun = req.body.dryRun === true
    const removed = await cacheInvalidatePattern('aegis:v1:*', dryRun)
    auditLog('admin-cache', dryRun ? 'flush-all (dry-run)' : 'flush-all', {
      removedKeys: removed,
      operator: req.user?.displayName ?? req.user?.id,
    })
    res.json({ ok: true, dryRun, keysRemoved: removed })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/admin/cache/clear-namespace
 * Flush all keys within a single namespace (e.g. "weather", "river_levels").
 * Body: { namespace: string, dryRun?: boolean }
 */
router.post('/clear-namespace', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { namespace, dryRun } = req.body
    if (!namespace || typeof namespace !== 'string') {
      return res.status(400).json({ error: 'namespace is required (string)' })
    }
    // Sanitise namespace: allow only alphanumeric, underscore, hyphen
    if (!/^[a-z0-9_-]{1,64}$/i.test(namespace)) {
      return res.status(400).json({ error: 'Invalid namespace format' })
    }
    const pattern = `aegis:v1:${namespace}:*`
    const isDry = dryRun === true
    const removed = await cacheInvalidatePattern(pattern, isDry)
    auditLog('admin-cache', isDry ? 'flush-namespace (dry-run)' : 'flush-namespace', {
      namespace,
      removedKeys: removed,
      operator: req.user?.displayName ?? req.user?.id,
    })
    res.json({ ok: true, namespace, dryRun: isDry, keysRemoved: removed })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/admin/cache/clear-key
 * Delete a single cache key.
 * Body: { key: string, dryRun?: boolean }
 */
router.post('/clear-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { key, dryRun } = req.body
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'key is required (string)' })
    }
    // Only allow keys within our namespace prefix
    if (!key.startsWith('aegis:v1:')) {
      return res.status(400).json({ error: 'Key must start with aegis:v1:' })
    }
    const isDry = dryRun === true
    if (!isDry) {
      await cacheDel(key)
    }
    auditLog('admin-cache', isDry ? 'delete-key (dry-run)' : 'delete-key', {
      key,
      operator: req.user?.displayName ?? req.user?.id,
    })
    res.json({ ok: true, key, dryRun: isDry, deleted: !isDry })
  } catch (err) {
    next(err)
  }
})

 /**
 * GET /api/admin/cache/stats
 * Return cache connection status, memory usage, and keyspace info.
 */
router.get('/stats', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stats = await getCacheStats()
    res.json(stats)
  } catch (err) {
    next(err)
  }
})

export default router
