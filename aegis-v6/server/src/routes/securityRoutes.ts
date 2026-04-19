/**
 * Security management endpoints: trusted devices, passkey registration,
 * IP allow/deny lists, security event logs, and per-operator security
 * dashboards.
 *
 * - Mounted at /api/security in index.ts
 * - Uses deviceTrustService, riskAuthService, and securityAlertService
 * - Requires authentication (operator/admin)
 * */

import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, AuthRequest, generateToken, generateRefreshToken, createSession } from '../middleware/auth.js'
import { listTrustedDevices, revokeDevice, revokeAllDevices } from '../services/deviceTrustService.js'
import { getOperatorSecuritySummary } from '../services/riskAuthService.js'
import {
  getRecentSecurityAlerts, getSecurityEventStats, getMostFailedOperators,
} from '../services/securityAlertService.js'
import { getClientIp } from '../utils/securityUtils.js'
import { AppError } from '../utils/AppError.js'
import { checkPasswordBreached, getHIBPStats } from '../services/hibpService.js'
import passkeysService from '../services/passkeysService.js'
import ipSecurity from '../services/ipSecurityService.js'
import deviceManagement from '../services/deviceManagementService.js'

const router = Router()

// 100 requests/15 min: generous enough for dashboard refreshes, device
// management, and passkey auth attempts without blocking legitimate users.
const securityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Device Trust Management (authenticated operator)

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

// Operator Security Summary

router.get('/summary', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const summary = await getOperatorSecuritySummary(req.user!.id)
    res.json(summary)
  } catch (err) {
    next(err)
  }
})

// Alert Preferences

router.get('/preferences', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM operator_security_preferences WHERE operator_id = $1',
      [req.user!.id]
    )

    if (result.rows.length === 0) {
      // No preferences row yet: return safe defaults rather than 404.
      // Row is only created on first PUT, keeping the table sparse until
      // the operator explicitly changes their settings.
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
      // UPSERT: COALESCE keeps the existing column value when the request body
      // omits a field (null), enabling partial updates without a full replace.
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

// Admin Security Dashboard

// Inline guard middleware instead of a separate service or extending authMiddleware.
// Keeps admin-only logic local to this router without polluting shared middleware.
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

// Password Breach Checking (HIBP Integration)

// No authMiddleware on password breach check: users should be able to verify
// a proposed password before account creation or from a password reset flow.
// The securityLimiter still guards against enumeration abuse.
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

// Passkeys/WebAuthn Endpoints

router.get('/passkeys', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const credentials = await passkeysService.getUserCredentials(req.user!.id)
    
    // Strip raw public key material before sending to the client:
    // only the ID and display metadata are needed for the management UI.
    const safeCredentials = credentials.map(c => ({
      id: c.id,
      deviceName: c.deviceName,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    }))
    
    res.json({ passkeys: safeCredentials })
  } catch (err) {
    next(err)
  }
})

// Two-step WebAuthn registration ceremony:
// 1. GET /passkeys/register — generates a challenge + allowed credentials
//    and stores the pending challenge server-side.
// 2. POST /passkeys/verify — verifies the signed response and saves the
//    new credential to the database.
router.post('/passkeys/register', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const options = await passkeysService.generateRegistrationOptions(
      req.user!.id,
      req.user!.email,
      req.user!.displayName || req.user!.email
    )
    
    res.json({ options })
  } catch (err) {
    next(err)
  }
})

router.post('/passkeys/verify', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { credential, deviceName } = req.body
    
    if (!credential) {
      throw AppError.badRequest('Credential response required.')
    }
    
    const result = await passkeysService.verifyRegistration(req.user!.id, credential, deviceName)
    
    if (!result.success) {
      throw AppError.badRequest(result.error || 'Registration failed.')
    }
    
    res.json({ success: true, credentialId: result.credentialId })
  } catch (err) {
    next(err)
  }
})

router.delete('/passkeys/:id', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const deleted = await passkeysService.deleteCredential(req.params.id, req.user!.id)
    
    if (!deleted) {
      throw AppError.notFound('Passkey not found.')
    }
    
    res.json({ success: true, message: 'Passkey removed.' })
  } catch (err) {
    next(err)
  }
})

/**
 * Passkey Authentication (no auth required — user is logging in)
 * POST /passkeys/auth-options  — Generate challenge for passkey login
 * POST /passkeys/auth-verify   — Verify signed challenge and return JWT
 */
router.post('/passkeys/auth-options', securityLimiter, async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Check if any passkeys have been registered at all
    const countResult = await pool.query('SELECT COUNT(*) FROM passkey_credentials')
    if (parseInt(countResult.rows[0].count) === 0) {
      res.status(404).json({ success: false, error: 'No passkeys registered yet. Sign in first (via Google or any method), then go to Security settings to add a passkey.' })
      return
    }
    const options = await passkeysService.generateAuthenticationOptions()
    res.json({ success: true, data: options })
  } catch (err) {
    next(err)
  }
})

router.post('/passkeys/auth-verify', securityLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await passkeysService.verifyAuthentication(req.body)
    if (!result.success || !result.userId) {
      res.status(401).json({ success: false, error: result.error || 'Authentication failed' })
      return
    }
    // Look up user — try citizens first, then operators/users
    let user: any = null
    const citizenResult = await pool.query(
      `SELECT id, email, display_name, role, avatar_url FROM citizens WHERE id = $1 AND deleted_at IS NULL`,
      [result.userId]
    )
    if (citizenResult.rows.length > 0) {
      user = citizenResult.rows[0]
    } else {
      const userResult = await pool.query(
        `SELECT id, email, display_name, role, department FROM users WHERE id = $1`,
        [result.userId]
      )
      if (userResult.rows.length > 0) {
        user = userResult.rows[0]
      }
    }
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' })
      return
    }
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      department: user.department,
    })
    const userType = user.department ? 'operator' : 'citizen'
    const refreshToken = generateRefreshToken({ id: user.id, role: user.role })
    await createSession({
      userId: user.id,
      userType: userType as 'citizen' | 'operator',
      refreshToken,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string,
      ttlDays: 7,
    })
    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: userType === 'citizen' ? '/api/citizen-auth' : '/api/auth',
    })
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, role: user.role, displayName: user.display_name, department: user.department },
    })
  } catch (err) {
    next(err)
  }
})

// Login History

router.get('/login-history', authMiddleware, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    const history = await deviceManagement.getLoginHistory(req.user!.id, limit)
    res.json({ history })
  } catch (err) {
    next(err)
  }
})

// Admin IP Security Endpoints

router.get('/admin/ip-blocklist', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const blocklist = ipSecurity.getBlocklist()
    res.json({ blocklist })
  } catch (err) {
    next(err)
  }
})

router.post('/admin/ip-block', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ip, reason, durationMs } = req.body
    
    if (!ip || typeof ip !== 'string') {
      throw AppError.badRequest('IP address is required.')
    }
    
    if (!reason || typeof reason !== 'string') {
      throw AppError.badRequest('Block reason is required.')
    }
    
    // autoBlocked: false marks this as a human-initiated block (vs automatic
    // blocks triggered by the rate-limit / anomaly detection system), so the
    // audit log and UI can distinguish manual operator actions.
    await ipSecurity.blockIP(ip, reason, {
      durationMs: durationMs || undefined,
      blockedBy: req.user!.id,
      autoBlocked: false,
    })
    
    res.json({ success: true, message: `IP ${ip} blocked.` })
  } catch (err) {
    next(err)
  }
})

router.delete('/admin/ip-block/:ip', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await ipSecurity.unblockIP(req.params.ip)
    res.json({ success: true, message: `IP ${req.params.ip} unblocked.` })
  } catch (err) {
    next(err)
  }
})

router.get('/admin/ip-allowlist', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const allowlist = ipSecurity.getAllowlist()
    res.json({ allowlist })
  } catch (err) {
    next(err)
  }
})

router.post('/admin/ip-allowlist', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ip, description, scope } = req.body
    
    if (!ip || typeof ip !== 'string') {
      throw AppError.badRequest('IP address is required.')
    }
    
    await ipSecurity.addToAllowlist(ip, description || 'Admin added', {
      scope: scope || 'all',
      addedBy: req.user!.id,
    })
    
    res.json({ success: true, message: `IP ${ip} added to allowlist.` })
  } catch (err) {
    next(err)
  }
})

router.delete('/admin/ip-allowlist/:ip', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await ipSecurity.removeFromAllowlist(req.params.ip)
    res.json({ success: true, message: `IP ${req.params.ip} removed from allowlist.` })
  } catch (err) {
    next(err)
  }
})

router.get('/admin/security-stats', authMiddleware, requireAdmin, securityLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ipStats = ipSecurity.getIPSecurityStats()
    const deviceStats = await deviceManagement.getDeviceStats()
    const passkeyStats = await passkeysService.getPasskeyStats()
    const hibpStats = getHIBPStats()
    
    res.json({
      ip: ipStats,
      devices: deviceStats,
      passkeys: passkeyStats,
      hibp: hibpStats,
    })
  } catch (err) {
    next(err)
  }
})

export default router
