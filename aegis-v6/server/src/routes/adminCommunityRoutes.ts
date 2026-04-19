/**
 * Admin moderation endpoints for community content. Admins and operators
 * can review flagged posts, ban users, and manage community guidelines.
 *
 * - Mounted at /api/admin/community in index.ts
 * - Reads from the same community tables as communityRoutes.ts
 * - Emits real-time moderation events via communityRealtime service
 * - Requires admin or operator authentication
 * */
import { Router, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { authMiddleware, operatorOnly, AuthRequest } from '../middleware/auth.js'
import { v4 as uuid } from 'uuid'
import { emitCommunityEvent } from '../services/communityRealtime.js'
import { AppError } from '../utils/AppError.js'

const router = Router()

/** Explicit whitelist for user tables - prevents SQL injection if findUserById is ever modified */
const VALID_USER_TABLES = ['citizens', 'operators'] as const
type UserTable = typeof VALID_USER_TABLES[number]

function isValidUserTable(table: string): table is UserTable {
  return VALID_USER_TABLES.includes(table as UserTable)
}

function isSuperAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'admin'
}

async function findUserById(userId: string): Promise<{ table: UserTable; id: string; display_name: string } | null> {
  const c = await pool.query('SELECT id, display_name FROM citizens WHERE id = $1 AND deleted_at IS NULL', [userId])
  if (c.rows[0]) return { table: 'citizens', ...c.rows[0] }
  const o = await pool.query('SELECT id, display_name FROM operators WHERE id = $1 AND deleted_at IS NULL', [userId])
  if (o.rows[0]) return { table: 'operators', ...o.rows[0] }
  return null
}

router.post('/users/:id/suspend', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req)) throw AppError.forbidden('Admin access required.')

    const targetId = req.params.id
    const until = req.body?.until ? new Date(req.body.until) : null
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : null

    const target = await findUserById(targetId)
    if (!target) throw AppError.notFound('User not found.')
    
    // Validate table name against whitelist (defense-in-depth)
    if (!isValidUserTable(target.table)) {
      throw AppError.internal('Invalid user table')
    }

    await pool.query(
      `UPDATE ${target.table}
       SET is_suspended = true,
           suspended_until = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [targetId, until && !Number.isNaN(until.getTime()) ? until.toISOString() : null]
    )

    await pool.query(
      `INSERT INTO community_moderation_logs (id, admin_id, action, target_type, target_id, target_user_id, reason, metadata, created_at)
       VALUES ($1, $2, 'suspend_user', 'user', $3, $3, $4, $5::jsonb, NOW())`,
      [uuid(), req.user!.id, targetId, reason, JSON.stringify({ table: target.table, until: until?.toISOString() || null })]
    )

    emitCommunityEvent('community:user:moderated', { userId: targetId, action: 'suspended', until: until?.toISOString() || null })

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

router.post('/users/:id/ban', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req)) throw AppError.forbidden('Admin access required.')

    const targetId = req.params.id
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : null

    const target = await findUserById(targetId)
    if (!target) throw AppError.notFound('User not found.')
    
    // Validate table name against whitelist (defense-in-depth)
    if (!isValidUserTable(target.table)) {
      throw AppError.internal('Invalid user table')
    }

    await pool.query(
      `UPDATE ${target.table}
       SET banned_at = NOW(),
           ban_reason = $2,
           is_active = false,
           is_suspended = true,
           suspended_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [targetId, reason]
    )

    await pool.query(
      `INSERT INTO community_moderation_logs (id, admin_id, action, target_type, target_id, target_user_id, reason, metadata, created_at)
       VALUES ($1, $2, 'ban_user', 'user', $3, $3, $4, $5::jsonb, NOW())`,
      [uuid(), req.user!.id, targetId, reason, JSON.stringify({ table: target.table })]
    )

    emitCommunityEvent('community:user:moderated', { userId: targetId, action: 'banned' })

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// POST /users/bulk-ban — Bulk ban multiple users (M7)
router.post('/users/bulk-ban', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req)) throw AppError.forbidden('Admin access required.')

    const { userIds, reason } = req.body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw AppError.badRequest('userIds array is required.')
    }
    if (userIds.length > 50) {
      throw AppError.badRequest('Cannot bulk-ban more than 50 users at once.')
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 240) : null

    const banned: string[] = []
    const failed: string[] = []
    const logEntries: { id: string; table: string; targetId: string }[] = []

    for (const targetId of userIds) {
      try {
        const target = await findUserById(targetId)
        if (!target) { failed.push(targetId); continue }
        
        // Validate table name against whitelist (defense-in-depth)
        if (!isValidUserTable(target.table)) { failed.push(targetId); continue }

        await pool.query(
          `UPDATE ${target.table}
           SET banned_at = NOW(), ban_reason = $2, is_active = false,
               is_suspended = true, suspended_until = NULL, updated_at = NOW()
           WHERE id = $1`,
          [targetId, trimmedReason]
        )
        banned.push(targetId)
        logEntries.push({ id: uuid(), table: target.table, targetId })
      } catch { failed.push(targetId) }
    }

    // Batch-insert all moderation log entries in a single query (eliminates N+1)
    if (logEntries.length > 0) {
      const values: any[] = []
      const placeholders = logEntries.map((entry, i) => {
        const base = i * 5
        values.push(entry.id, req.user!.id, entry.targetId, trimmedReason, JSON.stringify({ table: entry.table, bulk: true }))
        return `($${base + 1}, $${base + 2}, 'bulk_ban', 'user', $${base + 3}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, NOW())`
      })
      await pool.query(
        `INSERT INTO community_moderation_logs (id, admin_id, action, target_type, target_id, target_user_id, reason, metadata, created_at)
         VALUES ${placeholders.join(', ')}`,
        values
      )
    }

    emitCommunityEvent('community:user:bulk_moderated', { action: 'banned', count: banned.length })
    res.json({ success: true, banned: banned.length, failed: failed.length, failedIds: failed })
  } catch (err) {
    next(err)
  }
})

export default router
