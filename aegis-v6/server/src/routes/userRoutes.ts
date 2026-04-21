/**
 * Super-admin user management: list, view, update, suspend, activate,
 * and delete operator accounts. Only super-admins can access these.
 *
 * - Mounted at /api/users in index.ts
 * - Manages the operators table
 * - Used by the admin user management panel in the frontend
 *
 * GET    /api/users         -- List all operators
 * GET    /api/users/:id     -- Get operator details
 * PUT    /api/users/:id     -- Update operator
 * PUT    /api/users/:id/suspend   -- Suspend account
 * PUT    /api/users/:id/activate  -- Reactivate account
 * DELETE /api/users/:id     -- Soft-delete operator
 * */

import { Router, Response, NextFunction } from 'express'
import crypto from 'crypto'
import pool from '../models/db.js'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { devLog } from '../utils/logger.js'
import * as notificationService from '../services/notificationService.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()

//Middleware to check Super Admin role
const requireSuperAdmin = (req: AuthRequest, res: Response, next: Function) => {
  const role = req.user?.role?.toLowerCase()
  const isSuperAdmin = role === 'admin'
  if (!isSuperAdmin) {
    //For non-admin operators, allow read-only access to user list
    //but block mutations (handled per-route)
    if (req.method === 'GET') {
      return next()
    }
    throw AppError.forbidden('Super Admin access required for this action.')
  }
  next()
}

/*
 * GET /api/users - List operators with pagination + server-side search/filter (M9+M10)
 */
router.get('/', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50)
    const offset = (page - 1) * limit
    const search = (req.query.search as string || '').trim()
    const role = req.query.role as string | undefined
    const status = req.query.status as string | undefined

    const params: any[] = []
    const conditions: string[] = ['deleted_at IS NULL']

    if (search) {
      params.push(`%${search.toLowerCase()}%`)
      conditions.push(`(LOWER(display_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`)
    }
    if (role && ['admin', 'operator', 'viewer'].includes(role)) {
      params.push(role)
      conditions.push(`role = $${params.length}`)
    }
    if (status === 'suspended') conditions.push('is_suspended = true')
    else if (status === 'active') conditions.push('is_suspended = false AND is_active = true')
    else if (status === 'inactive') conditions.push('is_active = false AND is_suspended = false')

    const where = conditions.join(' AND ')

    const countResult = await pool.query(`SELECT COUNT(*) FROM operators WHERE ${where}`, params)
    const total = parseInt(countResult.rows[0].count)

    params.push(limit, offset)
    const result = await pool.query(`
      SELECT id, email, display_name, role, avatar_url, department, phone,
             is_active, is_suspended, suspended_until, last_login,
             created_at, updated_at
      FROM operators
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params)

    res.json({ users: result.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

/*
 * GET /api/users/:id - Get single operator details
 */
router.get('/:id', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params

    const result = await pool.query(`
      SELECT 
        id, email, display_name, role, avatar_url, department, phone,
        is_active, is_suspended, suspended_until, suspended_by, last_login,
        created_at, updated_at
      FROM operators
      WHERE id = $1 AND deleted_at IS NULL
    `, [id])

    if (result.rows.length === 0) {
      throw AppError.notFound('User not found.')
    }

    res.json({ user: result.rows[0] })
})

/*
 * PUT /api/users/:id - Update operator profile
 * Allows changing: role, department, phone, display_name
 */
router.put('/:id', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params
    const { role, department, phone, displayName } = req.body

    const VALID_ROLES = ['admin', 'operator', 'viewer']
    if (role !== undefined && role !== null && !VALID_ROLES.includes(role)) {
      throw AppError.badRequest(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`)
    }
    //Prevent non-super-admin from changing their own role
    if (role !== undefined && req.user?.id === id && req.user?.role !== 'admin') {
      throw AppError.forbidden('Cannot change your own role.')
    }

    //Fetch current state for audit log
    const before = await pool.query('SELECT id, email, display_name, role, department, phone FROM operators WHERE id = $1', [id])
    if (before.rows.length === 0) {
      throw AppError.notFound('User not found.')
    }

    //Update operator
    const result = await pool.query(`
      UPDATE operators
      SET 
        role = COALESCE($1, role),
        department = COALESCE($2, department),
        phone = COALESCE($3, phone),
        display_name = COALESCE($4, display_name),
        updated_at = now()
      WHERE id = $5 AND deleted_at IS NULL
      RETURNING id, email, display_name, role, department, phone, updated_at
    `, [role, department, phone, displayName, id])

    const after = result.rows[0]

    //Log to audit_log
    await pool.query(`
      INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      req.user?.id,
      req.user?.displayName,
      `Updated user ${after.display_name}`,
      'user_update',
      'operator',
      id,
      JSON.stringify(before.rows[0]),
      JSON.stringify(after)
    ])

    res.json({ user: after, message: 'User updated successfully.' })
})

/*
 * PUT /api/users/:id/suspend - Suspend operator account
 * Body: { until?: string (ISO date), reason: string }
 */
router.put('/:id/suspend', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params
    const { until, reason } = req.body

    //Prevent self-suspension
    if (id === req.user?.id) {
      throw AppError.badRequest('Cannot suspend your own account.')
    }

    //Fetch current state
    const before = await pool.query('SELECT id, email, display_name, is_suspended, suspended_until FROM operators WHERE id = $1', [id])
    if (before.rows.length === 0) {
      throw AppError.notFound('User not found.')
    }

    //Suspend account
    const result = await pool.query(`
      UPDATE operators
      SET 
        is_suspended = true,
        suspended_until = $1,
        suspended_by = $2,
        updated_at = now()
      WHERE id = $3 AND deleted_at IS NULL
      RETURNING id, email, display_name, is_suspended, suspended_until
    `, [until || null, req.user?.id, id])

    const after = result.rows[0]

    //Log to audit_log
    await pool.query(`
      INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      req.user?.id,
      req.user?.displayName,
      `Suspended user ${after.display_name}${until ? ` until ${new Date(until).toLocaleDateString()}` : ' indefinitely'}`,
      'user_suspend',
      'operator',
      id,
      JSON.stringify(before.rows[0]),
      JSON.stringify(after),
      reason || 'No reason provided'
    ])

    //Emit real-time event so other admin views update immediately (M12)
    const io = req.app.get('io')
    if (io) io.to('admins').emit('user:suspended', { id, until: until || null, reason })

    res.json({ user: after, message: 'User suspended successfully.' })
})

/*
 * PUT /api/users/:id/activate - Activate suspended account
 */
router.put('/:id/activate', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params

    //Fetch current state
    const before = await pool.query('SELECT id, email, display_name, is_suspended, suspended_until FROM operators WHERE id = $1', [id])
    if (before.rows.length === 0) {
      throw AppError.notFound('User not found.')
    }

    //Activate account
    const result = await pool.query(`
      UPDATE operators
      SET 
        is_suspended = false,
        suspended_until = NULL,
        suspended_by = NULL,
        updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, email, display_name, is_suspended, is_active
    `, [id])

    const after = result.rows[0]

    //Log to audit_log
    await pool.query(`
      INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      req.user?.id,
      req.user?.displayName,
      `Activated user ${after.display_name}`,
      'user_activate',
      'operator',
      id,
      JSON.stringify(before.rows[0]),
      JSON.stringify(after)
    ])

    const io = req.app.get('io')
    if (io) io.to('admins').emit('user:activated', { id })

    res.json({ user: after, message: 'User activated successfully.' })
})

/*
 * POST /api/users/:id/reset-password - Generate password reset token
 * Admin can force password reset for any user
 */
router.post('/:id/reset-password', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params

    //Check user exists
    const userCheck = await pool.query('SELECT id, email, display_name FROM operators WHERE id = $1 AND deleted_at IS NULL', [id])
    if (userCheck.rows.length === 0) {
      throw AppError.notFound('User not found.')
    }

    const targetUser = userCheck.rows[0]

    //Generate reset token
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    //Store hashed token (matches authRoutes reset-password lookup which hashes submitted token)
    await pool.query(`
      INSERT INTO password_reset_tokens (operator_id, token, expires_at)
      VALUES ($1, $2, $3)
    `, [id, tokenHash, expiresAt])

    //Log to audit_log
    await pool.query(`
      INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      req.user?.id,
      req.user?.displayName,
      `Generated password reset token for ${targetUser.display_name}`,
      'password_reset_generate',
      'operator',
      id
    ])

    //Send password reset email
    const resetLink = `${process.env.RESET_PASSWORD_URL || 'http://localhost:5173/reset-password'}?token=${rawToken}`
    
    try {
      const resetAlert: notificationService.Alert = {
        id: 'reset-' + id,
        type: 'general',
        severity: 'info',
        title: 'Password Reset Request',
        message: `A password reset has been requested for your AEGIS account. Click the link below to reset your password:\n\n${resetLink}\n\nThis link will expire in 24 hours. If you did not request this reset, please contact your administrator immediately.`,
        area: 'Account Security',
        actionRequired: 'Click the link above to set a new password.',
      }

      const emailResult = await notificationService.sendEmailAlert(targetUser.email, resetAlert)
      
      if (emailResult.success) {
        devLog(`✉️  Password reset email sent to ${targetUser.email}`)
        res.json({ 
          message: 'Password reset email sent successfully.',
          email: targetUser.email,
          expiresAt 
        })
      } else {
        //Email failed but token was created -- never leak raw token in response
        logger.warn({ error: emailResult.error }, 'Email delivery failed')
        res.json({ 
          message: 'Password reset token generated but email delivery failed. Check server logs.',
          expiresAt,
          warning: 'Email service unavailable. Administrator must check server logs for the reset link.'
        })
      }
    } catch (emailError: any) {
      //Email failed but token was created -- never leak raw token in response
      logger.error({ err: emailError }, 'Failed to send password reset email')
      res.json({ 
        message: 'Password reset token generated but email delivery failed. Check server logs.',
        expiresAt,
        warning: 'Email service unavailable. Administrator must check server logs for the reset link.'
      })
    }
})

/*
 * DELETE /api/users/:id - Soft-delete operator account
 */
router.delete('/:id', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params

    //Prevent self-deletion
    if (id === req.user?.id) {
      throw AppError.badRequest('Cannot delete your own account.')
    }

    //Fetch current state
    const before = await pool.query('SELECT id, email, display_name, role FROM operators WHERE id = $1 AND deleted_at IS NULL', [id])
    if (before.rows.length === 0) {
      throw AppError.notFound('User not found.')
    }

    //Soft delete
    await pool.query(`
      UPDATE operators
      SET 
        deleted_at = now(),
        deleted_by = $1,
        updated_at = now()
      WHERE id = $2
    `, [req.user?.id, id])

    //Log to audit_log
    await pool.query(`
      INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      req.user?.id,
      req.user?.displayName,
      `Deleted user ${before.rows[0].display_name}`,
      'user_delete',
      'operator',
      id,
      JSON.stringify(before.rows[0])
    ])

    res.fail('User deleted successfully.')
})

/*
 * POST /api/users/bulk -- Bulk suspend / activate / delete operators (M11)
 * Body: { userIds: string[], action: 'suspend'|'activate'|'delete', until?: string, reason?: string }
 */
router.post('/bulk', authMiddleware, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { userIds, action, until, reason } = req.body

    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.fail('userIds array is required.', 400); return
    }
    if (userIds.length > 50) {
      res.fail('Cannot perform bulk operations on more than 50 users at once.', 400); return
    }
    if (!['suspend', 'activate', 'delete'].includes(action)) {
      res.fail('action must be: suspend, activate, or delete', 400); return
    }
    if (userIds.includes(req.user!.id)) {
      res.fail('Cannot perform bulk operations on your own account.', 400); return
    }

    const processed: string[] = []
    const failed: string[] = []

    for (const userId of userIds) {
      try {
        if (action === 'suspend') {
          const suspendUntil = until ? new Date(until) : null
          await pool.query(
            `UPDATE operators SET is_suspended = true, suspended_until = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
            [userId, suspendUntil && !isNaN(suspendUntil.getTime()) ? suspendUntil.toISOString() : null]
          )
        } else if (action === 'activate') {
          await pool.query(
            `UPDATE operators SET is_suspended = false, suspended_until = NULL, is_active = true, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
            [userId]
          )
        } else if (action === 'delete') {
          await pool.query(
            `UPDATE operators SET deleted_at = NOW(), is_active = false, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
            [userId]
          )
        }
        processed.push(userId)
      } catch { failed.push(userId) }
    }

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, before_state, after_state)
       VALUES ($1, $2, $3, $4, 'operator', $5, $6)`,
      [
        req.user!.id, req.user!.displayName,
        `Bulk ${action}: ${processed.length} users${reason ? ` -- ${reason}` : ''}`,
        `bulk_${action}`,
        JSON.stringify({ userIds, action }),
        JSON.stringify({ processed, failed, reason })
      ]
    ).catch(() => {})

    const io = req.app.get('io')
    if (io) io.to('admins').emit('users:bulk_updated', { action, count: processed.length })

    res.success({ processed: processed.length, failed: failed.length, failedIds: failed })
})

export default router
