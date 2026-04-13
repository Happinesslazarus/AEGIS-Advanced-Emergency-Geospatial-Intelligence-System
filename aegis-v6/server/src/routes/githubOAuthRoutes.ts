/**
 * githubOAuthRoutes.ts — GitHub OAuth2 Authentication
 *
 * Endpoints:
 *   GET  /api/auth/github          — Redirect to GitHub consent
 *   GET  /api/auth/github/callback — Handle GitHub callback → JWT
 *
 * Environment variables:
 *   GITHUB_CLIENT_ID      — GitHub OAuth App client ID
 *   GITHUB_CLIENT_SECRET   — GitHub OAuth App client secret
 *
 * Works for citizens. If the email matches an operator, links that too.
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import pool from '../models/db.js'
import { generateToken, generateRefreshToken } from '../middleware/auth.js'
import { logger } from '../services/logger.js'

const router = Router()

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'
const githubEnabled = !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)

// In-memory state store for CSRF protection
const oauthStates = new Map<string, { expiresAt: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [state, data] of oauthStates) {
    if (data.expiresAt < now) oauthStates.delete(state)
  }
}, 30_000)

// Secure code exchange (same pattern as Google OAuth)
interface PendingExchange {
  userId: string
  email: string
  role: string
  displayName: string
  expiresAt: number
}
const pendingExchanges = new Map<string, PendingExchange>()
setInterval(() => {
  const now = Date.now()
  for (const [code, data] of pendingExchanges) {
    if (data.expiresAt < now) pendingExchanges.delete(code)
  }
}, 30_000)


/**
 * GET /api/auth/github — Redirect to GitHub authorization
 */
router.get('/github', (req: Request, res: Response) => {
  if (!githubEnabled) {
    res.status(501).json({ error: 'GitHub OAuth not configured' })
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  oauthStates.set(state, { expiresAt: Date.now() + 5 * 60 * 1000 })

  const callbackUrl = `${process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/github/callback`}`
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: 'read:user user:email',
    state,
  })
  res.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

/**
 * GET /api/auth/github/callback — Handle GitHub redirect
 */
router.get('/github/callback', async (req: Request, res: Response) => {
  if (!githubEnabled) {
    res.redirect(`${CLIENT_URL}/citizen/login?error=oauth_not_configured`)
    return
  }

  const { code, state } = req.query
  if (!code || !state || !oauthStates.has(state as string)) {
    res.redirect(`${CLIENT_URL}/citizen/login?error=oauth_failed`)
    return
  }
  oauthStates.delete(state as string)

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    })
    const tokenData = await tokenResponse.json() as any
    if (!tokenData.access_token) throw new Error('No access token from GitHub')

    // Get user profile
    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
      }),
    ])
    const profile = await userRes.json() as any
    const emails = await emailsRes.json() as any[]

    // Get primary verified email
    const primaryEmail = emails?.find((e: any) => e.primary && e.verified)?.email
      || emails?.find((e: any) => e.verified)?.email
      || profile.email
    if (!primaryEmail) throw new Error('No verified email from GitHub')

    const githubId = String(profile.id)
    const displayName = profile.name || profile.login || primaryEmail.split('@')[0]
    const avatarUrl = profile.avatar_url || null

    // Find or create citizen
    let result = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, github_id
       FROM citizens WHERE github_id = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
      [githubId, primaryEmail],
    )
    let citizen = result.rows[0]

    if (citizen) {
      if (!citizen.github_id) {
        await pool.query(`UPDATE citizens SET github_id = $1, email_verified = true WHERE id = $2`, [githubId, citizen.id])
      }
      if (!citizen.avatar_url && avatarUrl) {
        await pool.query(`UPDATE citizens SET avatar_url = $1 WHERE id = $2`, [avatarUrl, citizen.id])
      }
      await pool.query(`UPDATE citizens SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1`, [citizen.id])
    } else {
      const insertResult = await pool.query(
        `INSERT INTO citizens (email, display_name, password_hash, avatar_url, github_id, email_verified, is_active, role)
         VALUES ($1, $2, 'OAUTH_NO_PASSWORD', $3, $4, true, true, 'citizen')
         RETURNING id, email, display_name, role, avatar_url`,
        [primaryEmail, displayName, avatarUrl, githubId],
      )
      citizen = insertResult.rows[0]
      await pool.query(`INSERT INTO citizen_preferences (citizen_id) VALUES ($1) ON CONFLICT DO NOTHING`, [citizen.id])
    }

    // Generate exchange code
    const exchangeCode = crypto.randomBytes(32).toString('base64url')
    pendingExchanges.set(exchangeCode, {
      userId: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
      expiresAt: Date.now() + 60_000,
    })

    logger.info({ userId: citizen.id, email: citizen.email }, '[GitHub OAuth] Login successful')
    res.redirect(`${CLIENT_URL}/citizen/oauth/callback?code=${exchangeCode}&provider=github`)
  } catch (err) {
    logger.error({ err }, '[GitHub OAuth] Callback error')
    res.redirect(`${CLIENT_URL}/citizen/login?error=oauth_failed`)
  }
})

/**
 * POST /api/auth/github/exchange — Exchange code for JWT
 */
router.post('/github/exchange', (req: Request, res: Response) => {
  const { code } = req.body
  if (!code) { res.status(400).json({ success: false, error: 'Code required' }); return }

  const pending = pendingExchanges.get(code as string)
  if (!pending || Date.now() > pending.expiresAt) {
    res.status(400).json({ success: false, error: 'Invalid or expired code' })
    return
  }
  pendingExchanges.delete(code as string)

  const token = generateToken({
    id: pending.userId, email: pending.email,
    role: pending.role, displayName: pending.displayName,
  })
  const refreshToken = generateRefreshToken({ id: pending.userId, role: pending.role })

  res.cookie('aegis_refresh', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/citizen-auth',
  })

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: pending.userId, email: pending.email,
        role: pending.role, displayName: pending.displayName,
      },
    },
  })
})

// Status endpoint
router.get('/github/status', (_req: Request, res: Response) => {
  res.json({ github: githubEnabled })
})

export default router
