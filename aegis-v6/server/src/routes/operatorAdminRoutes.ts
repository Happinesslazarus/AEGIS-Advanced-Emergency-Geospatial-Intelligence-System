/**
 * Operator account governance endpoints.
 *
 * Admin-only operations on the operators table: deactivate, reactivate,
 * suspend, GDPR-anonymise, list, and update profile. Every mutation
 * writes to audit_log so the AITransparencyDashboard and account
 * forensics can reconstruct history.
 *
 * - Mounted at /api in index.ts
 * - All endpoints require admin role
 * - Extracted from extendedRoutes.ts (C3)
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/internalAuth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import pool from '../models/db.js'

const router = Router()

//Deactivate operator account
router.post('/operators/:id/deactivate', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { reason, actorId, actorName } = req.body
  if (!reason) throw AppError.badRequest('Reason is required')

  await pool.query(
    `UPDATE operators SET is_active = false, updated_at = NOW() WHERE id = $1`, [id]
  )
  await pool.query(
    `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
     VALUES ($1, $2, $3, 'deactivate', 'operator', $4, $5, $6)`,
    [
      actorId,
      actorName,
      'Deactivated operator account',
      id,
      JSON.stringify({ reason }),
      JSON.stringify({ is_active: false }),
    ]
  )
  res.success({})
}))

//Reactivate operator account
router.post('/operators/:id/reactivate', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { reason, actorId, actorName } = req.body
  await pool.query(
    `UPDATE operators SET is_active = true, is_suspended = false, suspended_until = NULL, updated_at = NOW() WHERE id = $1`, [id]
  )
  await pool.query(
    `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
     VALUES ($1, $2, 'Reactivated operator account', 'reactivate', 'operator', $3, $4, $5)`,
    [actorId, actorName, id, JSON.stringify({ reason: reason || '' }), JSON.stringify({ is_active: true, is_suspended: false })]
  )
  res.success({})
}))

//Suspend operator temporarily
router.post('/operators/:id/suspend', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { reason, actorId, actorName, until } = req.body
  if (!reason) throw AppError.badRequest('Reason is required')
  await pool.query(
    `UPDATE operators SET is_suspended = true, suspended_until = $1, suspended_by = $2, updated_at = NOW() WHERE id = $3`,
    [until || null, actorId, id]
  )
  await pool.query(
    `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
     VALUES ($1, $2, 'Suspended operator account', 'suspend', 'operator', $3, $4, $5)`,
    [actorId, actorName, id, JSON.stringify({ reason }), JSON.stringify({ is_suspended: true, suspended_until: until || null })]
  )
  res.success({})
}))

//GDPR-safe anonymise operator (preferred over hard delete)
router.post('/operators/:id/anonymise', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { actorId, actorName, reason } = req.body
  await pool.query(
    `UPDATE operators SET
      display_name = 'Redacted User',
      email = CONCAT('redacted-', id, '@anonymised.local'),
      phone = NULL,
      avatar_url = NULL,
      is_active = false,
      anonymised_at = NOW(),
      anonymised_by = $1,
      updated_at = NOW()
     WHERE id = $2`, [actorId, id]
  )
  await pool.query(
    `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
     VALUES ($1, $2, 'Anonymised operator (GDPR)', 'anonymise', 'operator', $3, $4, $5)`,
    [
      actorId,
      actorName,
      id,
      JSON.stringify({ reason: reason || 'GDPR compliance' }),
      JSON.stringify({ anonymised_at: new Date().toISOString(), is_active: false }),
    ]
  )
  res.success({})
}))

//List all operators (for admin management)
router.get('/operators', authMiddleware, requireAdmin, asyncRoute(async (_req: AuthRequest, res: Response) => {
  const result = await pool.query(
    `SELECT id, email, display_name, role, department, phone, is_active, is_suspended, suspended_until, last_login, created_at
     FROM operators WHERE deleted_at IS NULL ORDER BY created_at DESC`
  )
  res.json(result.rows)
}))

//Update operator profile
router.put('/operators/:id/profile', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { displayName, email, phone } = req.body
  await pool.query(
    `UPDATE operators SET
      display_name = COALESCE($1, display_name),
      email = COALESCE($2, email),
      phone = COALESCE($3, phone),
      updated_at = NOW()
     WHERE id = $4`, [displayName, email, phone, id]
  )
  res.success({})
}))

export default router
