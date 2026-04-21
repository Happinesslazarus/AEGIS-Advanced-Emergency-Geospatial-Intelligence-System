/**
 * Operator/admin authentication: invite-based registration, login with
 * lockout protection, JWT token refresh with rotation, password reset
 * via email, profile management, and email verification.
 *
 * - Mounted at /api/auth in index.ts
 * - Uses auth.ts middleware for JWT verification and session management
 * - Passwords hashed with bcrypt (12 rounds)
 * - Login triggers risk assessment and device trust checks
 * - Security events logged to securityLogger for audit trail
 *
 * Endpoints:
 * POST /api/auth/invite    -- Create operator account (admin-only)
 * POST /api/auth/login     -- Authenticate and get JWT + refresh token
 * POST /api/auth/refresh   -- Rotate refresh token
 * GET  /api/auth/me        -- Current operator profile
 * PUT  /api/auth/profile   -- Update profile
 * POST /api/auth/forgot-password   -- Request password reset email
 * POST /api/auth/reset-password    -- Reset password with token
 * */

import { Router, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, adminOnly, generateToken, generateRefreshToken, verifyRefreshToken, AuthRequest, createSession, validateSession, rotateRefreshToken, revokeAllSessions } from '../middleware/auth.js'
import { uploadAvatar, validateMagicBytes } from '../middleware/upload.js'
import * as notificationService from '../services/notificationService.js'
import {
  validatePasswordStrength, hashToken, generateSecureToken,
  checkLockout, recordFailedLogin, resetFailedLogins, recordPasswordHistory,
  isPasswordReused, getClientIp, LOCKOUT_DURATION_MINUTES } from '../utils/securityUtils.js'
import { generateTempToken, hashTempToken } from '../utils/twoFactorCrypto.js'
import { sendVerificationEmail, sendLockoutNotification} from '../services/emailService.js'
import { logSecurityEvent, checkSuspiciousActivity } from '../services/securityLogger.js'
import { isDeviceTrusted } from '../services/deviceTrustService.js'
import { assessLoginRisk } from '../services/riskAuthService.js'
import { alertAccountLocked, alertRepeatedFailures, alertSuspiciousAccess } from '../services/securityAlertService.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'
import { authFailuresTotal, accountLockoutsTotal, riskAssessmentTotal } from '../services/metrics.js'

const router = Router()

//Rate limiter for login attempts only (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes per IP
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts toward the limit
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 registrations per hour
  message: { error: 'Too many registration attempts. Please try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { error: 'Too many password reset attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

/*
 * POST /api/auth/invite
 * Creates a new operator account (admin-only invite flow).
 * Only authenticated admins can create new operator accounts.
 * The invited operator receives a verification email to set up their account.
 * Role is always 'operator' - admin promotion requires a separate super-admin action.
 */
router.post('/invite', authMiddleware, adminOnly, registerLimiter, uploadAvatar, validateMagicBytes, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { email, password, displayName, department, phone, role } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()

    //Validate required fields
    if (!email || !password || !displayName) {
      throw AppError.badRequest('Email, password, and display name are required.')
    }

    //Check password strength (enterprise policy: 12 chars, complexity)
    const pwResult = validatePasswordStrength(password, email)
    if (!pwResult.valid) {
      res.status(400).json({ error: pwResult.errors[0] })
      return
    }

    //Check if email is already registered
    const exists = await pool.query(
      `SELECT id FROM operators WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
       UNION ALL
       SELECT id FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail]
    )
    if (exists.rows.length > 0) {
      throw AppError.conflict('An account with this email already exists.')
    }

    //Hash password with bcrypt (12 rounds for strong security)
    const passwordHash = await bcrypt.hash(password, 12)

    //Build avatar URL if a file was uploaded
    const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : null

    //Only allow 'operator' or 'manager' roles via invite. Admin promotion is a separate action.
    const allowedRoles = ['operator', 'manager']
    const assignedRole = allowedRoles.includes(String(role || '').trim().toLowerCase())
      ? String(role).trim().toLowerCase()
      : 'operator'

    //Generate email verification token (store HASH, send raw)
    const rawVerificationToken = generateSecureToken()
    const verificationTokenHash = hashToken(rawVerificationToken)
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    //Insert new operator into the database
    const result = await pool.query(
      `INSERT INTO operators (email, password_hash, display_name, role, department, phone, avatar_url,
                              verification_token_hash, verification_expires, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id, email, display_name, role, avatar_url, department`,
      [normalizedEmail, passwordHash, displayName, assignedRole, department || null, phone || null, avatarUrl,
       verificationTokenHash, verificationExpires]
    )

    const user = result.rows[0]

    //Log the registration in the activity log
    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      [`New operator invited by ${req.user!.displayName}: ${displayName} (${assignedRole})`, 'register', user.id, displayName]
    )

    //Record initial password in history
    await recordPasswordHistory(user.id, 'operator', passwordHash)

    //Send verification email
    try {
      await sendVerificationEmail(normalizedEmail, rawVerificationToken, 'operator')
    } catch (emailErr: any) {
      logger.error({ err: emailErr }, '[Auth] Failed to send verification email')
    }

    //Log security event
    const clientIp = getClientIp(req)
    await logSecurityEvent({
      userId: user.id, userType: 'operator', eventType: 'register',
      ipAddress: clientIp, userAgent: req.headers['user-agent'] as string,
      metadata: { email: normalizedEmail, role: assignedRole, invitedBy: req.user!.id },
    })

    res.status(201).json({
      user: {
        id: user.id, email: user.email,
        displayName: user.display_name, role: user.role,
        avatarUrl: user.avatar_url, department: user.department,
      },
      message: 'Operator account created. Verification email sent.',
    })
})

/*
 * POST /api/auth/login
 * Authenticates an operator with email and password.
 * Returns a JWT token valid for 24 hours.
 */
router.post('/login', loginLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { email, password } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!email || !password) {
      throw AppError.badRequest('Email and password are required.')
    }

    //Look up the operator by email (include 2FA status)
    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, role, avatar_url, department,
              is_active, is_suspended, suspended_until, failed_login_attempts, locked_until,
              two_factor_enabled
       FROM operators WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail]
    )

    if (result.rows.length === 0) {
      await logSecurityEvent({ eventType: 'login_failed', ipAddress: clientIp, userAgent, metadata: { reason: 'unknown_email' } })
      authFailuresTotal.inc({ failure_type: 'unknown_email', user_type: 'operator' })
      throw AppError.unauthorized('Invalid email or password.')
    }

    const user = result.rows[0]

    //Check account lockout
    const lockoutStatus = checkLockout(user.failed_login_attempts, user.locked_until)
    if (lockoutStatus.locked) {
      await logSecurityEvent({
        userId: user.id, userType: 'operator', eventType: 'login_failed',
        ipAddress: clientIp, userAgent, metadata: { reason: 'account_locked', remaining_minutes: lockoutStatus.remainingMinutes },
      })
      authFailuresTotal.inc({ failure_type: 'account_locked', user_type: 'operator' })
      res.status(423).json({
        error: `Account is temporarily locked. Try again in ${lockoutStatus.remainingMinutes} minute(s).`,
        code: 'ACCOUNT_LOCKED',
        retryAfterMinutes: lockoutStatus.remainingMinutes,
      })
      return
    }

    //Check if account is suspended
    if (user.is_suspended) {
      if (!user.suspended_until) {
        throw AppError.forbidden('Account is suspended indefinitely. Contact system administrator.')
      }
      if (new Date(user.suspended_until) > new Date()) {
        throw AppError.forbidden(`Account is suspended until ${new Date(user.suspended_until).toUTCString()}. Contact system administrator.`)
      }
      //Suspension expired - auto-lift it
      await pool.query('UPDATE operators SET is_suspended = false, suspended_until = NULL WHERE id = $1', [user.id])
    }

    //Check if account is active
    if (!user.is_active) {
      throw AppError.forbidden('Account is deactivated. Contact system administrator.')
    }

    //Verify password against stored hash
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      const newLockout = await recordFailedLogin('operators', user.id)

      await logSecurityEvent({
        userId: user.id, userType: 'operator', eventType: 'login_failed',
        ipAddress: clientIp, userAgent, metadata: { attempts: newLockout.attempts },
      })

      authFailuresTotal.inc({ failure_type: 'invalid_password', user_type: 'operator' })
      await checkSuspiciousActivity(user.id, 'operator', clientIp)

      if (newLockout.locked) {
        await logSecurityEvent({
          userId: user.id, userType: 'operator', eventType: 'account_locked',
          ipAddress: clientIp, userAgent, metadata: { duration_minutes: LOCKOUT_DURATION_MINUTES },
        })
        accountLockoutsTotal.inc({ user_type: 'operator' })
        sendLockoutNotification(user.email, LOCKOUT_DURATION_MINUTES).catch(() => {})
        alertAccountLocked(user.id, LOCKOUT_DURATION_MINUTES, clientIp).catch(() => {})
        res.status(423).json({
          error: `Account locked for ${LOCKOUT_DURATION_MINUTES} minutes due to too many failed attempts.`,
          code: 'ACCOUNT_LOCKED',
          retryAfterMinutes: LOCKOUT_DURATION_MINUTES,
        })
        return
      }

      //Alert on repeated failures (5+ attempts)
      if (newLockout.attempts >= 5) {
        alertRepeatedFailures(user.id, newLockout.attempts, clientIp).catch(() => {})
      }

      throw AppError.unauthorized('Invalid email or password.')
    }

    //Successful password verification - reset failed attempts
    await resetFailedLogins('operators', user.id)

    //2FA Gate
    //If operator has 2FA enabled, check trusted device first.
    //Trusted device ? skip 2FA challenge. Otherwise issue a temp token.
    if (user.two_factor_enabled) {
      //Check if this device is already trusted (30-day remember-me)
      const trustedDevice = await isDeviceTrusted(user.id, userAgent || '', clientIp).catch(() => null)

      if (trustedDevice) {
        //Trusted device - skip 2FA, issue full JWT
        await pool.query('UPDATE operators SET last_login = NOW() WHERE id = $1', [user.id])

        await logSecurityEvent({
          userId: user.id, userType: 'operator', eventType: 'login_success',
          ipAddress: clientIp, userAgent,
          metadata: { two_fa_skipped: true, trusted_device: trustedDevice.deviceName },
        })

        await pool.query(
          `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
           VALUES ($1, $2, $3, $4)`,
          ['Logged in to AEGIS Admin (trusted device)', 'login', user.id, user.display_name]
        )

        const token = generateToken({
          id: user.id, email: user.email,
          role: user.role, displayName: user.display_name,
          department: user.department,
        })
        const refreshToken = generateRefreshToken({ id: user.id, role: user.role })
        await createSession({
          userId: user.id, userType: 'operator', refreshToken,
          ipAddress: clientIp, userAgent, ttlDays: 30,
        }).catch(() => {})

        res.cookie('aegis_refresh', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 30 * 24 * 60 * 60 * 1000,
          path: '/api/auth',
        })

        res.json({
          token,
          user: {
            id: user.id, email: user.email,
            displayName: user.display_name, role: user.role,
            avatarUrl: user.avatar_url, department: user.department,
          },
          trustedDevice: true,
        })
        return
      }

      //Not a trusted device - issue temp token for 2FA challenge
      const tempTokenRaw = generateTempToken()
      const tempTokenHash = hashTempToken(tempTokenRaw)
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

      //Use a transaction to atomically invalidate old tokens and create new one
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        //Invalidate any existing unconsumed temp tokens for this user
        await client.query(
          `UPDATE two_factor_temp_tokens SET consumed = true
           WHERE user_id = $1 AND consumed = false`,
          [user.id]
        )

        //Store new temp token bound to IP + User-Agent (anti-hijacking)
        await client.query(
          `INSERT INTO two_factor_temp_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, tempTokenHash, expiresAt, clientIp, userAgent || null]
        )

        await client.query('COMMIT')
      } catch (txErr) {
        await client.query('ROLLBACK')
        throw txErr
      } finally {
        client.release()
      }

      //Assess login risk for the dashboard
      const risk = await assessLoginRisk(user.id, clientIp, userAgent || '').catch(() => null)
      if (risk) {
        riskAssessmentTotal.inc({ level: risk.level })
      }
      if (risk?.alertAdmin) {
        alertSuspiciousAccess(user.id, `High-risk login attempt (score: ${risk.score})`, clientIp).catch(() => {})
      }

      await logSecurityEvent({
        userId: user.id, userType: 'operator', eventType: 'login_success',
        ipAddress: clientIp, userAgent, metadata: { requires_2fa: true, risk_score: risk?.score },
      })

      res.json({
        requires2FA: true,
        tempToken: tempTokenRaw,
      })
      return
    }

    //Standard login (no 2FA)

    //Update last login timestamp
    await pool.query('UPDATE operators SET last_login = NOW() WHERE id = $1', [user.id])

    //Log the login event
    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      ['Logged in to AEGIS Admin', 'login', user.id, user.display_name]
    )

    //Generate access token (15min) + refresh token (30d)
    const token = generateToken({
      id: user.id, email: user.email,
      role: user.role, displayName: user.display_name,
      department: user.department,
    })
    const refreshToken = generateRefreshToken({ id: user.id, role: user.role })

    //Create session
    await createSession({
      userId: user.id, userType: 'operator', refreshToken,
      ipAddress: clientIp, userAgent, ttlDays: 30,
    }).catch(() => {})

    //Log successful login
    await logSecurityEvent({
      userId: user.id, userType: 'operator', eventType: 'login_success',
      ipAddress: clientIp, userAgent,
    })

    //Refresh token lives in an httpOnly cookie - JS cannot read or steal it
    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/auth',
    })

    res.json({
      token,
      user: {
        id: user.id, email: user.email,
        displayName: user.display_name, role: user.role,
        avatarUrl: user.avatar_url, department: user.department,
      },
    })
})

/*
 * POST /api/auth/forgot-password
 * Generates password reset token and records reset attempt.
 */
router.post('/forgot-password', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { email } = req.body
    if (!email) {
      throw AppError.badRequest('Email is required.')
    }

    const userResult = await pool.query(
      'SELECT id, email, display_name FROM operators WHERE email = $1 AND deleted_at IS NULL',
      [email]
    )

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0]
      const rawToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

      await pool.query(
        `INSERT INTO password_reset_tokens (operator_id, token, expires_at, ip_address)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes', $3)`,
        [user.id, tokenHash, req.ip || null]
      )

      await pool.query(
        `INSERT INTO activity_log (action, action_type, operator_id, operator_name, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Password reset requested', 'note', user.id, user.display_name, JSON.stringify({ email: user.email })]
      ).catch(() => {})

      const resetBase = process.env.RESET_PASSWORD_URL || `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password`
      //Enforce HTTPS for password reset links in production to prevent token interception
      if (process.env.NODE_ENV === 'production' && !resetBase.startsWith('https://')) {
        logger.error('[SECURITY] RESET_PASSWORD_URL or CLIENT_URL must use HTTPS in production. Set RESET_PASSWORD_URL env var.')
        throw AppError.internal('The password reset service is not properly configured. Please contact your system administrator.')
      }
      const resetLink = `${resetBase}?token=${rawToken}`

      //SECURITY: Send reset link via email only, never return it in the response
      try {
        await notificationService.sendEmailAlert(user.email, {
          id: `reset-${Date.now()}`,
          type: 'general',
          severity: 'info',
          title: 'Password Reset Request',
          message: `Click the link below to reset your password. This link expires in 30 minutes.\n\n${resetLink}\n\nIf you did not request this reset, please ignore this email.`,
          area: 'AEGIS Security',
        })
        logger.info({ email: user.email }, '[Auth] Password reset email sent')
      } catch (emailErr: any) {
        logger.error({ err: emailErr, email: user.email }, '[Auth] Failed to send reset email')
        //Don't fail the request - user will see generic success message
      }

      //Return generic success message (never expose token or link)
      res.success({ message: 'If the email exists in our system, a password reset link has been sent.' })
      return
    }

    //Same response for non-existent accounts (prevents user enumeration)
    res.success({ message: 'If the email exists in our system, a password reset link has been sent.' })
})

/*
 * POST /api/auth/reset-password
 * Resets password using one-time token.
 */
router.post('/reset-password', resetPasswordLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { token, password } = req.body
    if (!token || !password) {
      throw AppError.badRequest('Token and new password are required.')
    }

    if (password.length < 12) {
      throw AppError.badRequest('Password must be at least 12 characters.')
    }
    const pwResult = validatePasswordStrength(password)
    if (!pwResult.valid) {
      res.status(400).json({ error: pwResult.errors[0] })
      return
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const tokenResult = await pool.query(
      `SELECT id, operator_id
       FROM password_reset_tokens
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [tokenHash]
    )

    if (tokenResult.rows.length === 0) {
      throw AppError.badRequest('Invalid or expired reset token.')
    }

    const resetToken = tokenResult.rows[0]

    //Check if the operator is banned (permanently suspended)
    const opCheck = await pool.query(
      `SELECT is_active, is_suspended, suspended_until, banned_at FROM operators WHERE id = $1`,
      [resetToken.operator_id]
    )
    if (opCheck.rows.length > 0) {
      const op = opCheck.rows[0]
      if (op.banned_at) {
        throw AppError.forbidden('Account is permanently banned.')
      }
      if (op.is_suspended && op.suspended_until && new Date(op.suspended_until) > new Date()) {
        throw AppError.forbidden('Account is suspended. Password reset is not available during suspension.')
      }
    }

    //Prevent reuse of last 5 passwords
    const reused = await isPasswordReused(password, resetToken.operator_id, 'operator')
    if (reused) {
      throw AppError.badRequest('You cannot reuse any of your last 5 passwords.')
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await pool.query('UPDATE operators SET password_hash = $1, updated_at = NOW(), password_changed_at = NOW() WHERE id = $2', [passwordHash, resetToken.operator_id])
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [resetToken.id])

    //Record in password history & revoke all sessions
    await recordPasswordHistory(resetToken.operator_id, 'operator', passwordHash)
    await revokeAllSessions(resetToken.operator_id, 'password_reset')

    await logSecurityEvent({
      userId: resetToken.operator_id, userType: 'operator', eventType: 'password_reset_completed',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, metadata)
       VALUES ($1, $2, $3, $4)`,
      ['Password reset completed', 'note', resetToken.operator_id, JSON.stringify({ ip: req.ip || null })]
    ).catch(() => {})

    res.success({ message: 'Password reset successful. You can now log in.' })
})

/*
 * GET /api/auth/me
 * Returns the current operator's profile (requires authentication).
 */
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const result = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, department, phone, created_at, last_login,
              two_factor_enabled
       FROM operators WHERE id = $1`,
      [req.user!.id]
    )
    if (result.rows.length === 0) {
      throw AppError.notFound('Operator not found.')
    }
    const u = result.rows[0]
    res.json({
      id: u.id, email: u.email, displayName: u.display_name,
      role: u.role, avatarUrl: u.avatar_url, department: u.department,
      phone: u.phone, createdAt: u.created_at, lastLogin: u.last_login,
      twoFactorEnabled: u.two_factor_enabled,
    })
})

/*
 * PUT /api/auth/profile
 * Updates operator profile including avatar upload.
 */
router.put('/profile', authMiddleware, uploadAvatar, validateMagicBytes, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { displayName, department, phone } = req.body
    const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : undefined

    //Build dynamic update query based on which fields were provided
    const sets: string[] = []
    const vals: any[] = []
    let idx = 1

    if (displayName) { sets.push(`display_name = $${idx++}`); vals.push(displayName) }
    if (department !== undefined) { sets.push(`department = $${idx++}`); vals.push(department) }
    if (phone !== undefined) { sets.push(`phone = $${idx++}`); vals.push(phone) }
    if (avatarUrl) { sets.push(`avatar_url = $${idx++}`); vals.push(avatarUrl) }

    if (sets.length === 0) {
      throw AppError.badRequest('No fields to update.')
    }

    vals.push(req.user!.id)
    const result = await pool.query(
      `UPDATE operators SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, email, display_name, role, avatar_url, department, phone`,
      vals
    )

    const u = result.rows[0]
    res.json({
      id: u.id, email: u.email, displayName: u.display_name,
      role: u.role, avatarUrl: u.avatar_url, department: u.department,
    })
})

/*
 * POST /api/auth/refresh
 * Issues a new 15min access token using the httpOnly refresh cookie.
 * Validates the session in DB and rotates the refresh token.
 */
router.post('/refresh', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshCookie = req.cookies?.aegis_refresh
    if (!refreshCookie) {
      throw AppError.unauthorized('No refresh token.')
    }

    let payload: { id: string; role: string }
    try {
      payload = verifyRefreshToken(refreshCookie) as { id: string; role: string }
    } catch {
      res.clearCookie('aegis_refresh', { path: '/api/auth' })
      throw AppError.unauthorized('Invalid or expired refresh token. Please log in again.')
    }

    //Validate session exists in DB and is not revoked
    const session = await validateSession(refreshCookie)
    if (!session) {
      res.clearCookie('aegis_refresh', { path: '/api/auth' })
      throw AppError.unauthorized('Session expired or revoked. Please log in again.')
    }

    //Fetch fresh user data
    const result = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, department, is_active, is_suspended
       FROM operators WHERE id = $1 AND deleted_at IS NULL`,
      [payload.id]
    )
    if (result.rows.length === 0 || !result.rows[0].is_active || result.rows[0].is_suspended) {
      res.clearCookie('aegis_refresh', { path: '/api/auth' })
      throw AppError.unauthorized('Account is inactive or suspended.')
    }

    const user = result.rows[0]
    const newAccessToken = generateToken({
      id: user.id, email: user.email,
      role: user.role, displayName: user.display_name,
      department: user.department,
    })

    //Rotate refresh token (revoke old, issue new)
    const newRefreshToken = generateRefreshToken({ id: user.id, role: user.role })
    const clientIp = getClientIp(req)
    await rotateRefreshToken({
      oldToken: refreshCookie, newToken: newRefreshToken,
      userId: user.id, userType: 'operator',
      ipAddress: clientIp, userAgent: req.headers['user-agent'] as string,
      ttlDays: 30,
    }).catch(() => {})

    res.cookie('aegis_refresh', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    })

    res.json({ token: newAccessToken })
  } catch (err) {
    res.clearCookie('aegis_refresh', { path: '/api/auth' })
    next(err)
  }
})

/*
 * POST /api/auth/logout
 * Clears the refresh token cookie and revokes the session.
 */
router.post('/logout', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const refreshCookie = req.cookies?.aegis_refresh
  if (refreshCookie) {
    const { hashRefreshToken } = await import('../middleware/auth.js')
    const tokenHash = hashRefreshToken(refreshCookie)
    await pool.query(
      `UPDATE user_sessions SET revoked = true, revoked_reason = 'logout'
       WHERE refresh_token_hash = $1`,
      [tokenHash]
    ).catch(() => {})
  }
  res.clearCookie('aegis_refresh', { path: '/api/auth' })
  res.json({ ok: true })
})

/*
 * GET /api/auth/verify-email?token=xxx
 * Verify operator email address using hashed token.
 */
router.get('/verify-email', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { token } = req.query
    if (!token || typeof token !== 'string' || token.length !== 64) {
      throw AppError.badRequest('Invalid verification token.')
    }

    const tokenHash = hashToken(token)

    const result = await pool.query(
      `UPDATE operators SET email_verified = true, verification_token_hash = NULL, verification_expires = NULL
       WHERE verification_token_hash = $1 AND email_verified = false
       AND (verification_expires IS NULL OR verification_expires > NOW())
       RETURNING id, email, display_name`,
      [tokenHash]
    )

    if (result.rows.length === 0) {
      throw AppError.badRequest('Invalid, expired, or already-used verification token.')
    }

    await logSecurityEvent({
      userId: result.rows[0].id, userType: 'operator', eventType: 'email_verified',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    res.success({ message: 'Email verified successfully!' })
})

/*
 * POST /api/auth/resend-verification
 * Resend email verification for operators (rate-limited).
 */
const operatorResendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many verification emails requested. Please try again later.' },
})

router.post('/resend-verification', authMiddleware, operatorResendLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id

    const op = await pool.query(
      'SELECT id, email, email_verified FROM operators WHERE id = $1',
      [userId]
    )

    if (op.rows.length === 0) {
      throw AppError.notFound('Account not found.')
    }

    if (op.rows[0].email_verified) {
      res.success({ message: 'Email is already verified.' })
      return
    }

    const rawToken = generateSecureToken()
    const tokenHash = hashToken(rawToken)
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await pool.query(
      'UPDATE operators SET verification_token_hash = $1, verification_expires = $2 WHERE id = $3',
      [tokenHash, expires, userId]
    )

    try {
      await sendVerificationEmail(op.rows[0].email, rawToken, 'operator')
    } catch (emailErr: any) {
      logger.error({ err: emailErr }, '[Auth] Failed to send verification email')
    }

    await logSecurityEvent({
      userId, userType: 'operator', eventType: 'email_verification_sent',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    res.success({ message: 'Verification email has been sent.' })
})

//POST /api/auth/bootstrap
//Creates the very first admin account on fresh installs -- no auth required.
//Self-locking: returns 403 the instant any admin exists in the database.
//Rate-limited aggressively to prevent brute-force on first-boot window.
const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many bootstrap attempts. Please try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
})

router.post('/bootstrap', bootstrapLimiter, async (req: any, res: Response, next: NextFunction): Promise<void> => {
    //Hard gate: only works when zero admins exist
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM operators WHERE role = 'admin' AND deleted_at IS NULL`,
    )
    if ((rows[0]?.c || 0) > 0) {
      res.fail('An admin account already exists. Use the login page.', 403)
      return
    }

    const { email, password, displayName } = req.body

    if (!email || !password || !displayName) {
      res.fail('Email, password, and your name are required.', 400)
      return
    }

    const normalizedEmail = String(email).trim().toLowerCase()

    const emailErr = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      ? null : 'Please enter a valid email address.'
    if (emailErr) { res.status(400).json({ error: emailErr }); return }

    const pwResult = validatePasswordStrength(password, normalizedEmail)
    if (!pwResult.valid) {
      res.status(400).json({ error: pwResult.errors[0] })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const insert = await pool.query(
      `INSERT INTO operators (email, password_hash, display_name, role, department, is_active, email_verified)
       VALUES ($1, $2, $3, 'admin', 'Command', true, true)
       RETURNING id, email, display_name, role, department, avatar_url`,
      [normalizedEmail, passwordHash, String(displayName).trim()],
    )
    const newAdmin = insert.rows[0]

    //Log the bootstrap event
    try {
      await pool.query(
        `INSERT INTO activity_log (action, action_type, operator_name)
         VALUES ($1, $2, $3)`,
        ['First admin account created via setup wizard', 'bootstrap', newAdmin.display_name],
      )
    } catch { /* activity_log not critical */ }

    //Issue a JWT so the user is immediately logged in
    const token = generateToken({
      id: newAdmin.id,
      email: newAdmin.email,
      role: newAdmin.role,
      displayName: newAdmin.display_name,
      department: newAdmin.department,
    })
    const refreshToken = generateRefreshToken({ id: newAdmin.id, role: newAdmin.role })
    await createSession({
      userId: newAdmin.id,
      userType: 'operator',
      refreshToken,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string,
      ttlDays: 30,
    }).catch(() => {})

    logger.info(`[bootstrap] First admin created: ${newAdmin.email}`)

    //Set refresh token as httpOnly cookie (matches the login endpoint)
    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    })

    res.status(201).json({
      token,
      user: {
        id: newAdmin.id,
        email: newAdmin.email,
        displayName: newAdmin.display_name,
        role: newAdmin.role,
        department: newAdmin.department,
        avatarUrl: newAdmin.avatar_url ?? null,
      },
    })
})

export default router
