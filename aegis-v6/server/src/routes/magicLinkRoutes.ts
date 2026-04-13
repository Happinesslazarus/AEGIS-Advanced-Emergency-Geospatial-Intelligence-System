/**
 * magicLinkRoutes.ts — Passwordless Magic Link Authentication
 *
 * Endpoints:
 *   POST /api/auth/magic-link/send     — Send magic link email
 *   GET  /api/auth/magic-link/verify   — Verify token & return JWT
 *
 * Flow:
 *   1. User enters email → server sends link with secure token
 *   2. User clicks link → token verified → JWT issued
 *   3. Works for both citizens and operators
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import pool from '../models/db.js'
import { generateToken, generateRefreshToken } from '../middleware/auth.js'
import { logger } from '../services/logger.js'
import rateLimit from 'express-rate-limit'

const router = Router()

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// In-memory store (use Redis in production)
interface PendingMagicLink {
  email: string
  expiresAt: number
  used: boolean
}
const pendingLinks = new Map<string, PendingMagicLink>()

// Clean expired links every 60s
setInterval(() => {
  const now = Date.now()
  for (const [token, data] of pendingLinks) {
    if (data.expiresAt < now || data.used) pendingLinks.delete(token)
  }
}, 60_000)

// Rate limit: 3 magic link requests per email per 5 minutes
const magicLinkLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.body?.email || req.ip || 'unknown',
  message: { success: false, error: 'Too many magic link requests. Try again in 5 minutes.' },
})

/**
 * POST /api/auth/magic-link/send
 * Send a magic link email to the user
 */
router.post('/send', magicLinkLimiter, async (req: Request, res: Response) => {
  const { email } = req.body
  if (!email || typeof email !== 'string') {
    res.status(400).json({ success: false, error: 'Email is required' })
    return
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Check if user exists (citizen or operator)
  const citizenResult = await pool.query(
    `SELECT id, email, display_name, role FROM citizens WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
    [normalizedEmail],
  )
  const operatorResult = await pool.query(
    `SELECT id, email, display_name, role FROM operators WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
    [normalizedEmail],
  )

  const user = citizenResult.rows[0] || operatorResult.rows[0]
  const userType = citizenResult.rows[0] ? 'citizen' : operatorResult.rows[0] ? 'operator' : null

  // Always respond with success (prevent email enumeration)
  if (!user) {
    logger.info({ email: normalizedEmail }, '[MagicLink] Request for unregistered email (silent)')
    res.json({ success: true, message: 'If this email is registered, a magic link has been sent.' })
    return
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString('base64url')
  pendingLinks.set(token, {
    email: normalizedEmail,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    used: false,
  })

  // Build magic link URL
  const portalPath = userType === 'operator' ? '/admin' : '/citizen/magic-link'
  const magicUrl = `${CLIENT_URL}${portalPath}?token=${token}`

  // Send email (use existing email service if available, otherwise log)
  try {
    const emailService = await import('../services/emailService.js') as any
    if (typeof emailService.sendMagicLinkEmail === 'function') {
      await emailService.sendMagicLinkEmail(normalizedEmail, magicUrl, user.display_name)
    } else {
      // Fallback: send via nodemailer directly
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.SMTP_USER || process.env.EMAIL_USER,
          pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
        },
      })
      await transporter.sendMail({
        from: `"AEGIS" <${process.env.SMTP_USER || process.env.EMAIL_USER || 'noreply@aegis.app'}>`,
        to: normalizedEmail,
        subject: '🔑 AEGIS Magic Link — Sign in securely',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#0ea5e9;margin:0 0 16px">AEGIS — Secure Sign-In</h2>
            <p>Hello ${user.display_name || 'there'},</p>
            <p>Click below to sign in instantly — no password needed:</p>
            <a href="${magicUrl}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#eab308);color:#000;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;margin:16px 0">
              🔐 Sign In to AEGIS
            </a>
            <p style="color:#9ca3af;font-size:13px;margin-top:16px">This link expires in 10 minutes. If you didn't request this, ignore this email.</p>
          </div>
        `,
      })
    }
    logger.info({ email: normalizedEmail, userType }, '[MagicLink] Email sent')
  } catch (err) {
    logger.warn({ err, email: normalizedEmail }, '[MagicLink] Email send failed — link still valid via URL')
  }

  res.json({ success: true, message: 'If this email is registered, a magic link has been sent.' })
})

/**
 * POST /api/auth/magic-link/verify
 * Verify magic link token and return JWT
 */
router.post('/verify', async (req: Request, res: Response) => {
  const { token } = req.body
  if (!token || typeof token !== 'string') {
    res.status(400).json({ success: false, error: 'Token is required' })
    return
  }

  const pending = pendingLinks.get(token)
  if (!pending || pending.used || Date.now() > pending.expiresAt) {
    res.status(400).json({ success: false, error: 'Invalid or expired magic link' })
    return
  }

  // Mark as used immediately (one-time)
  pending.used = true
  pendingLinks.delete(token)

  // Look up user
  const citizenResult = await pool.query(
    `SELECT id, email, display_name, role, avatar_url FROM citizens WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
    [pending.email],
  )
  const operatorResult = await pool.query(
    `SELECT id, email, display_name, role, avatar_url FROM operators WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
    [pending.email],
  )

  const user = citizenResult.rows[0] || operatorResult.rows[0]
  if (!user) {
    res.status(400).json({ success: false, error: 'Account not found' })
    return
  }

  // Generate JWT
  const jwtToken = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
  })
  const refreshToken = generateRefreshToken({ id: user.id, role: user.role })

  // Set refresh cookie
  const cookiePath = user.role === 'citizen' ? '/api/citizen-auth' : '/api/auth'
  res.cookie('aegis_refresh', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: cookiePath,
  })

  // Update last login
  const table = citizenResult.rows[0] ? 'citizens' : 'operators'
  await pool.query(`UPDATE ${table} SET last_login = NOW() WHERE id = $1`, [user.id])

  logger.info({ userId: user.id, email: user.email }, '[MagicLink] Login successful')

  res.json({
    success: true,
    data: {
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    },
  })
})

export default router
