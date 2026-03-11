/*
 * authRoutes.ts - Authentication and operator management API
 *
 * Handles all auth-related endpoints:
 *   POST /api/auth/register  - Create new operator account (with optional avatar)
 *   POST /api/auth/login     - Authenticate and receive JWT token
 *   GET  /api/auth/me        - Get current operator profile
 *   PUT  /api/auth/profile   - Update profile (name, avatar, etc.)
 *
 * Passwords are hashed with bcrypt (12 rounds) before storage.
 * JWTs are issued on successful login and expire after 24 hours.
 */

import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, generateToken, generateRefreshToken, verifyRefreshToken, AuthRequest } from '../middleware/auth.js'
import { uploadAvatar } from '../middleware/upload.js'

const router = Router()

// Rate limiter for login attempts only (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 login attempts per hour
  message: { error: 'Too many login attempts. Please try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
})

/*
 * POST /api/auth/register
 * Creates a new operator account in the database.
 * Accepts multipart form data to allow avatar upload during registration.
 * Returns a JWT token so the user is immediately logged in.
 */
router.post('/register', uploadAvatar, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password, displayName, department, phone } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()

    // Validate required fields
    if (!email || !password || !displayName) {
      res.status(400).json({ error: 'Email, password, and display name are required.' })
      return
    }

    // Check password strength (minimum 8 characters)
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' })
      return
    }

    // Check if email is already registered
    const exists = await pool.query(
      `SELECT id FROM operators WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
       UNION ALL
       SELECT id FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail]
    )
    if (exists.rows.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' })
      return
    }

    // Hash password with bcrypt (12 rounds for strong security)
    const passwordHash = await bcrypt.hash(password, 12)

    // Build avatar URL if a file was uploaded
    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : null

    const assignedRole = String(department || '').trim().toLowerCase() === 'command & control'
      ? 'admin'
      : 'operator'

    // Insert new operator into the database
    const result = await pool.query(
      `INSERT INTO operators (email, password_hash, display_name, role, department, phone, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, display_name, role, avatar_url, department`,
      [normalizedEmail, passwordHash, displayName, assignedRole, department || null, phone || null, avatarUrl]
    )

    const user = result.rows[0]

    // Log the registration in the activity log
    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      [`New operator registered: ${displayName}`, 'register', user.id, displayName]
    )

    // Generate JWT and return it with the user profile
    const token = generateToken({
      id: user.id, email: user.email,
      role: user.role, displayName: user.display_name,
      department: user.department,
    })

    res.status(201).json({
      token,
      user: {
        id: user.id, email: user.email,
        displayName: user.display_name, role: user.role,
        avatarUrl: user.avatar_url, department: user.department,
      },
    })
  } catch (err: any) {
    console.error('[Auth] Register error:', err.message)
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  }
})

/*
 * POST /api/auth/login
 * Authenticates an operator with email and password.
 * Returns a JWT token valid for 24 hours.
 */
router.post('/login', loginLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' })
      return
    }

    // Look up the operator by email
    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, role, avatar_url, department, is_active, is_suspended, suspended_until
       FROM operators WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail]
    )

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'This account does not exist.' })
      return
    }

    const user = result.rows[0]

    // Check if account is suspended
    if (user.is_suspended) {
      if (!user.suspended_until) {
        res.status(403).json({ error: 'Account is suspended indefinitely. Contact system administrator.' })
        return
      }
      if (new Date(user.suspended_until) > new Date()) {
        res.status(403).json({ error: `Account is suspended until ${new Date(user.suspended_until).toUTCString()}. Contact system administrator.` })
        return
      }
      // Suspension expired — auto-lift it
      await pool.query('UPDATE operators SET is_suspended = false, suspended_until = NULL WHERE id = $1', [user.id])
    }

    // Check if account is active
    if (!user.is_active) {
      res.status(403).json({ error: 'Account is deactivated. Contact system administrator.' })
      return
    }

    // Verify password against stored hash
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' })
      return
    }

    // Update last login timestamp
    await pool.query('UPDATE operators SET last_login = NOW() WHERE id = $1', [user.id])

    // Log the login event
    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      ['Logged in to AEGIS Admin', 'login', user.id, user.display_name]
    )

    // Generate access token (8h) + refresh token (30d)
    const token = generateToken({
      id: user.id, email: user.email,
      role: user.role, displayName: user.display_name,
      department: user.department,
    })
    const refreshToken = generateRefreshToken({ id: user.id, role: user.role })

    // Refresh token lives in an httpOnly cookie — JS cannot read or steal it
    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
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
  } catch (err: any) {
    console.error('[Auth] Login error:', err.message)
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
})

/*
 * POST /api/auth/forgot-password
 * Generates password reset token and records reset attempt.
 */
router.post('/forgot-password', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.body
    if (!email) {
      res.status(400).json({ error: 'Email is required.' })
      return
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
      const resetLink = `${resetBase}?token=${rawToken}`

      res.json({
        success: true,
        message: 'If the email exists, a reset link has been generated.',
        resetLink
      })
      return
    }

    res.json({ success: true, message: 'If the email exists, a reset link has been generated.' })
  } catch (err: any) {
    console.error('[Auth] Forgot password error:', err.message)
    res.status(500).json({ error: 'Failed to process password reset request.' })
  }
})

/*
 * POST /api/auth/reset-password
 * Resets password using one-time token.
 */
router.post('/reset-password', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body
    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required.' })
      return
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' })
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
      res.status(400).json({ error: 'Invalid or expired reset token.' })
      return
    }

    const resetToken = tokenResult.rows[0]

    // Check if the operator is banned (permanently suspended)
    const opCheck = await pool.query(
      `SELECT is_active, is_suspended, suspended_until, banned_at FROM operators WHERE id = $1`,
      [resetToken.operator_id]
    )
    if (opCheck.rows.length > 0) {
      const op = opCheck.rows[0]
      if (op.banned_at) {
        res.status(403).json({ error: 'Account is permanently banned.' })
        return
      }
      if (op.is_suspended && op.suspended_until && new Date(op.suspended_until) > new Date()) {
        res.status(403).json({ error: 'Account is suspended. Password reset is not available during suspension.' })
        return
      }
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await pool.query('UPDATE operators SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, resetToken.operator_id])
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [resetToken.id])

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, metadata)
       VALUES ($1, $2, $3, $4)`,
      ['Password reset completed', 'note', resetToken.operator_id, JSON.stringify({ ip: req.ip || null })]
    ).catch(() => {})

    res.json({ success: true, message: 'Password reset successful. You can now log in.' })
  } catch (err: any) {
    console.error('[Auth] Reset password error:', err.message)
    res.status(500).json({ error: 'Failed to reset password.' })
  }
})

/*
 * GET /api/auth/me
 * Returns the current operator's profile (requires authentication).
 */
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, department, phone, created_at, last_login
       FROM operators WHERE id = $1`,
      [req.user!.id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Operator not found.' })
      return
    }
    const u = result.rows[0]
    res.json({
      id: u.id, email: u.email, displayName: u.display_name,
      role: u.role, avatarUrl: u.avatar_url, department: u.department,
      phone: u.phone, createdAt: u.created_at, lastLogin: u.last_login,
    })
  } catch (err: any) {
    console.error('[Auth] Profile error:', err.message)
    res.status(500).json({ error: 'Failed to load profile.' })
  }
})

/*
 * PUT /api/auth/profile
 * Updates operator profile including avatar upload.
 */
router.put('/profile', authMiddleware, uploadAvatar, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { displayName, department, phone } = req.body
    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : undefined

    // Build dynamic update query based on which fields were provided
    const sets: string[] = []
    const vals: any[] = []
    let idx = 1

    if (displayName) { sets.push(`display_name = $${idx++}`); vals.push(displayName) }
    if (department !== undefined) { sets.push(`department = $${idx++}`); vals.push(department) }
    if (phone !== undefined) { sets.push(`phone = $${idx++}`); vals.push(phone) }
    if (avatarUrl) { sets.push(`avatar_url = $${idx++}`); vals.push(avatarUrl) }

    if (sets.length === 0) {
      res.status(400).json({ error: 'No fields to update.' })
      return
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
  } catch (err: any) {
    console.error('[Auth] Profile update error:', err.message)
    res.status(500).json({ error: 'Failed to update profile.' })
  }
})

/*
 * POST /api/auth/refresh
 * Issues a new 8h access token using the httpOnly refresh cookie.
 * Also rotates the refresh token (new 30d cookie) to extend the session.
 */
router.post('/refresh', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.aegis_refresh
    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token.' })
      return
    }

    let payload: { id: string; role: string }
    try {
      payload = verifyRefreshToken(refreshToken) as { id: string; role: string }
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token. Please log in again.' })
      return
    }

    // Fetch fresh user data
    const result = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, department, is_active, is_suspended
       FROM operators WHERE id = $1 AND deleted_at IS NULL`,
      [payload.id]
    )
    if (result.rows.length === 0 || !result.rows[0].is_active || result.rows[0].is_suspended) {
      res.status(401).json({ error: 'Account is inactive or suspended.' })
      return
    }

    const user = result.rows[0]
    const newAccessToken = generateToken({
      id: user.id, email: user.email,
      role: user.role, displayName: user.display_name,
      department: user.department,
    })
    // Rotate refresh token
    const newRefreshToken = generateRefreshToken({ id: user.id, role: user.role })
    res.cookie('aegis_refresh', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    })

    res.json({ token: newAccessToken })
  } catch (err: any) {
    console.error('[Auth] Refresh error:', err.message)
    res.status(500).json({ error: 'Token refresh failed.' })
  }
})

/*
 * POST /api/auth/logout
 * Clears the refresh token cookie.
 */
router.post('/logout', (_req, res: Response) => {
  res.clearCookie('aegis_refresh', { path: '/api/auth' })
  res.json({ ok: true })
})

export default router
