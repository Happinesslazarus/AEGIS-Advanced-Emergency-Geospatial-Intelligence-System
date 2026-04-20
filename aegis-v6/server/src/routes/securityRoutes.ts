/**
 * Security management endpoints: trusted devices, security event logs,
 * and per-operator security dashboards.
 *
 * - Mounted at /api/security in index.ts
 * - Uses deviceTrustService, riskAuthService, and securityAlertService
 * - Requires authentication (operator/admin)
 * */

import { Router, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { listTrustedDevices, revokeDevice, revokeAllDevices } from '../services/deviceTrustService.js'
import { getOperatorSecuritySummary } from '../services/riskAuthService.js'
import {
  getRecentSecurityAlerts, getSecurityEventStats, getMostFailedOperators,
} from '../services/securityAlertService.js'
import { getClientIp } from '../utils/securityUtils.js'
import { AppError } from '../utils/AppError.js'
import { checkPasswordBreached, getHIBPStats } from '../services/hibpService.js'

const router = Router()

//100 requests/15 min: generous enough for dashboard refreshes and device
//management without blocking legitimate users.
const securityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

//Device Trust Management (authenticated operator)

router.get('/devices', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const devices = await listTrustedDevices(req.user!.id)
    res.json({ devices })
  } catch (err) {
    next(err)
  }
})

router.delete('/devices/:id', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!id) throw AppError.badRequest('Device ID is required.')

    const revoked = await revokeDevice(
      req.user!.id, id,
      getClientIp(req), req.headers['user-agent'] as string
    )

    if (!revoked) {
      throw AppError.notFound('Device not found or already revoked.')
    }

    res.json({ success: true, message: 'Device trust revoked.' })
  } catch (err) {
    next(err)
  }
})

router.delete('/devices', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const count = await revokeAllDevices(
      req.user!.id,
      getClientIp(req), req.headers['user-agent'] as string
    )
    res.json({ success: true, devicesRevoked: count })
  } catch (err) {
    next(err)
  }
})

//Operator Security Summary

router.get('/summary', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const summary = await getOperatorSecuritySummary(req.user!.id)
    res.json(summary)
  } catch (err) {
    next(err)
  }
})

//Alert Preferences

router.get('/preferences', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM operator_security_preferences WHERE operator_id = $1',
      [req.user!.id]
    )

    if (result.rows.length === 0) {
      //No preferences row yet: return safe defaults rather than 404.
      //Row is only created on first PUT, keeping the table sparse until
      //the operator explicitly changes their settings.
      res.json({
        alert_on_2fa_disabled: true,
        alert_on_backup_code_used: true,
        alert_on_new_device_login: true,
        alert_on_suspicious_access: true,
        alert_on_lockout: true,
      })
      return
    }

    const prefs = result.rows[0]
    res.json({
      alert_on_2fa_disabled: prefs.alert_on_2fa_disabled,
      alert_on_backup_code_used: prefs.alert_on_backup_code_used,
      alert_on_new_device_login: prefs.alert_on_new_device_login,
      alert_on_suspicious_access: prefs.alert_on_suspicious_access,
      alert_on_lockout: prefs.alert_on_lockout,
    })
  } catch (err) {
    next(err)
  }
})

router.put('/preferences', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.user!.id
    const {
      alert_on_2fa_disabled,
      alert_on_backup_code_used,
      alert_on_new_device_login,
      alert_on_suspicious_access,
      alert_on_lockout,
    } = req.body

    await pool.query(
      //UPSERT: COALESCE keeps the existing column value when the request body
      //omits a field (null), enabling partial updates without a full replace.
      `INSERT INTO operator_security_preferences
         (operator_id, alert_on_2fa_disabled, alert_on_backup_code_used,
          alert_on_new_device_login, alert_on_suspicious_access, alert_on_lockout, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (operator_id)
       DO UPDATE SET
         alert_on_2fa_disabled = COALESCE($2, operator_security_preferences.alert_on_2fa_disabled),
         alert_on_backup_code_used = COALESCE($3, operator_security_preferences.alert_on_backup_code_used),
         alert_on_new_device_login = COALESCE($4, operator_security_preferences.alert_on_new_device_login),
         alert_on_suspicious_access = COALESCE($5, operator_security_preferences.alert_on_suspicious_access),
         alert_on_lockout = COALESCE($6, operator_security_preferences.alert_on_lockout),
         updated_at = NOW()`,
      [
        operatorId,
        alert_on_2fa_disabled ?? true,
        alert_on_backup_code_used ?? true,
        alert_on_new_device_login ?? true,
        alert_on_suspicious_access ?? true,
        alert_on_lockout ?? true,
      ]
    )

    res.json({ success: true, message: 'Security preferences updated.' })
  } catch (err) {
    next(err)
  }
})

//Admin Security Dashboard

//Inline guard middleware instead of a separate service or extending authMiddleware.
//Keeps admin-only logic local to this router without polluting shared middleware.
function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    next(AppError.forbidden('Admin access required.'))
    return
  }
  next()
}

router.get('/dashboard/alerts', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const alerts = await getRecentSecurityAlerts(limit)
    res.json({ alerts })
  } catch (err) {
    next(err)
  }
})

router.get('/dashboard/stats', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 720) // max 30 days
    const stats = await getSecurityEventStats(hours)
    res.json({ stats, hours })
  } catch (err) {
    next(err)
  }
})

router.get('/dashboard/failures', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)
    const operators = await getMostFailedOperators(limit)
    res.json({ operators })
  } catch (err) {
    next(err)
  }
})

//Password Breach Checking (HIBP Integration)

//No authMiddleware on password breach check: users should be able to verify
//a proposed password before account creation or from a password reset flow.
//The securityLimiter still guards against enumeration abuse.
router.post('/check-password', securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { password } = req.body
    
    if (!password || typeof password !== 'string') {
      throw AppError.badRequest('Password is required.')
    }
    
    const result = await checkPasswordBreached(password)
    
    res.json({
      breached: result.isPwned,
      count: result.count,
      message: result.isPwned
        ? `This password has appeared in ${result.count > 1000 ? result.count.toLocaleString() : 'multiple'} data breaches. Choose a different password.`
        : 'This password has not been found in known data breaches.',
    })
  } catch (err) {
    next(err)
  }
})

//Admin Security Stats

router.get('/admin/security-stats', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hibpStats = getHIBPStats()
    
    res.json({
      hibp: hibpStats,
    })
  } catch (err) {
    next(err)
  }
})

export default router
