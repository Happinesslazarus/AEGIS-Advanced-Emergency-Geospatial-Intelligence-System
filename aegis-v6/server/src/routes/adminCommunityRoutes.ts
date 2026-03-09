import { Router, Response } from 'express'
import pool from '../models/db.js'
import { authMiddleware, operatorOnly, AuthRequest } from '../middleware/auth.js'
import { v4 as uuid } from 'uuid'
import { emitCommunityEvent } from '../services/communityRealtime.js'

const router = Router()

function isSuperAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'admin' || req.user?.department === 'Command & Control'
}

async function findUserById(userId: string): Promise<{ table: 'citizens' | 'operators'; id: string; display_name: string } | null> {
  const c = await pool.query('SELECT id, display_name FROM citizens WHERE id = $1 AND deleted_at IS NULL', [userId])
  if (c.rows[0]) return { table: 'citizens', ...c.rows[0] }
  const o = await pool.query('SELECT id, display_name FROM operators WHERE id = $1 AND deleted_at IS NULL', [userId])
  if (o.rows[0]) return { table: 'operators', ...o.rows[0] }
  return null
}

router.post('/users/:id/suspend', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Admin access required.' })

    const targetId = req.params.id
    const until = req.body?.until ? new Date(req.body.until) : null
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : null

    const target = await findUserById(targetId)
    if (!target) return res.status(404).json({ error: 'User not found.' })

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
  } catch (err: any) {
    console.error('[AdminCommunity] suspend error:', err.message)
    res.status(500).json({ error: 'Failed to suspend user.' })
  }
})

router.post('/users/:id/ban', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Admin access required.' })

    const targetId = req.params.id
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : null

    const target = await findUserById(targetId)
    if (!target) return res.status(404).json({ error: 'User not found.' })

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
  } catch (err: any) {
    console.error('[AdminCommunity] ban error:', err.message)
    res.status(500).json({ error: 'Failed to ban user.' })
  }
})

// ─── POST /users/bulk-ban — Bulk ban multiple users (M7) ─────────────────────
router.post('/users/bulk-ban', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Admin access required.' })

    const { userIds, reason } = req.body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required.' })
    }
    if (userIds.length > 50) {
      return res.status(400).json({ error: 'Cannot bulk-ban more than 50 users at once.' })
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 240) : null

    const banned: string[] = []
    const failed: string[] = []

    for (const targetId of userIds) {
      try {
        const target = await findUserById(targetId)
        if (!target) { failed.push(targetId); continue }

        await pool.query(
          `UPDATE ${target.table}
           SET banned_at = NOW(), ban_reason = $2, is_active = false,
               is_suspended = true, suspended_until = NULL, updated_at = NOW()
           WHERE id = $1`,
          [targetId, trimmedReason]
        )
        await pool.query(
          `INSERT INTO community_moderation_logs (id, admin_id, action, target_type, target_id, target_user_id, reason, metadata, created_at)
           VALUES ($1, $2, 'bulk_ban', 'user', $3, $3, $4, $5::jsonb, NOW())`,
          [uuid(), req.user!.id, targetId, trimmedReason, JSON.stringify({ table: target.table, bulk: true })]
        )
        banned.push(targetId)
      } catch { failed.push(targetId) }
    }

    emitCommunityEvent('community:user:bulk_moderated', { action: 'banned', count: banned.length })
    res.json({ success: true, banned: banned.length, failed: failed.length, failedIds: failed })
  } catch (err: any) {
    console.error('[AdminCommunity] bulk-ban error:', err.message)
    res.status(500).json({ error: 'Failed to bulk ban users.' })
  }
})

export default router
