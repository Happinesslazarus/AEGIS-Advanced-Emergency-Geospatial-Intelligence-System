/**
 * OAuth 2.0 social login (Google). Redirects users to Google's consent
 * screen, handles the callback, and exchanges the auth code for AEGIS
 * JWT tokens using a secure code-exchange pattern.
 *
 * - Mounted at /api/auth in index.ts (adds Google OAuth sub-routes)
 * - Uses Passport.js with the Google OAuth2 strategy
 * - Logs in existing citizens and links Google ID when needed
 * - Returns JWT + refresh token like the regular login flow
 *
 * GET  /api/auth/google          -- Redirect to Google consent
 * GET  /api/auth/google/callback -- Google callback handler
 * POST /api/auth/oauth/exchange  -- Exchange code for JWT
 * */

import { Router, Request, Response, NextFunction } from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import pool from '../models/db.js'
import { generateToken, generateRefreshToken, createSession } from '../middleware/auth.js'
import { getClientIp } from '../utils/securityUtils.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()

/**
 * Short-lived map: OAuth state -> return base URL
 * Allows OAuth flows initiated from a LAN IP (e.g. phone via Vite proxy)
 * to redirect back to that LAN IP after auth completes.
 */
const pendingReturnUrls = new Map<string, string>()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pendingReturnUrls) {
    //Entries are keyed to a state that lasts ~2 min at most
    //We don't store expiry separately; just keep max 200 entries
    if (pendingReturnUrls.size > 200) pendingReturnUrls.delete(k)
    else break
  }
}, 60_000)

/** Allow redirect only to localhost or RFC 1918 LAN addresses (dev-safe) */
function isAllowedOrigin(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return (
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)
    )
  } catch { return false }
}

//Secure token exchange storage (short-lived, one-time codes)
//In production with multiple instances, use Redis instead
interface PendingOAuthExchange {
  userId: string
  email: string
  role: string
  displayName: string
  avatarUrl: string | null
  expiresAt: number
}
const pendingExchanges = new Map<string, PendingOAuthExchange>()

//Clean expired codes every 30 seconds
setInterval(() => {
  const now = Date.now()
  for (const [code, data] of pendingExchanges) {
    if (data.expiresAt < now) {
      pendingExchanges.delete(code)
    }
  }
}, 30 * 1000)

/**
 * Generate a secure one-time exchange code
 */
function generateOAuthCode(): string {
  return crypto.randomBytes(32).toString('base64url')
}

//Configure Passport Google Strategy (only when env vars present)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || '/api/auth/google/callback'
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'
const oauthEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)

if (oauthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (err: any, user?: any, info?: any) => void,
      ) => {
        try {
          const rawEmail = profile.emails?.find((entry: any) => entry?.verified)?.value
            || profile.emails?.[0]?.value
          if (!rawEmail) return done(new Error('Google account has no email'))
          const email = String(rawEmail).trim().toLowerCase()

          const googleId = profile.id
          const displayName = profile.displayName || email.split('@')[0]
          const avatarUrl = profile.photos?.[0]?.value || null

          //1. Check if a user already exists (by google_id or email)
          let result = await pool.query(
            `SELECT id, email, display_name, role, avatar_url, preferred_region,
                    email_verified, is_active, google_id, deleted_at
             FROM citizens
             WHERE (google_id = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($2)))
             LIMIT 1`,
            [googleId, email],
          )

          const citizen = result.rows[0]

          //No account found -- require manual registration first.
          //Redirect to registration page with email pre-filled.
          if (!citizen) {
            return done(null, false, { code: 'ACCOUNT_NOT_FOUND', email })
          }

          //Account exists but soft-deleted or inactive -- reject.
          if (!citizen.is_active || citizen.deleted_at) {
            return done(null, false, { code: 'ACCOUNT_NOT_FOUND', email })
          }

          //Link Google ID if not yet linked (user registered first, now signing in with Google)
          if (!citizen.google_id) {
            await pool.query(
              `UPDATE citizens SET google_id = $1, oauth_provider = 'google', email_verified = true WHERE id = $2`,
              [googleId, citizen.id],
            )
          }
          //Update avatar if missing
          if (!citizen.avatar_url && avatarUrl) {
            await pool.query(
              `UPDATE citizens SET avatar_url = $1 WHERE id = $2`,
              [avatarUrl, citizen.id],
            )
          }
          //Update last login
          await pool.query(
            `UPDATE citizens SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1`,
            [citizen.id],
          )

          done(null, citizen)
        } catch (err) {
          done(err)
        }
      },
    ),
  )

  //Serialize / deserialize (session-less -- we use JWT)
  passport.serializeUser((user: any, done) => done(null, user))
  passport.deserializeUser((user: any, done) => done(null, user))
}

//Middleware guard -- returns 501 when OAuth is not configured

function requireOAuthConfigured(_req: Request, res: Response, next: NextFunction): void {
  if (!oauthEnabled) {
    res.status(501).json({
      error: 'OAuth not configured',
      message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables to enable social login.',
    })
    return
  }
  next()
}

//GET /api/auth/google -- Initiate Google OAuth flow
//Optional ?next=<url> param: if the request comes from a LAN IP (e.g. a phone
//on the local network), pass the current page URL so the OAuth callback can
//redirect back to that LAN address rather than hardcoded localhost:5173.

router.get(
  '/google',
  requireOAuthConfigured,
  (req: Request, res: Response, next: NextFunction) => {
    const nextParam = req.query.next as string | undefined
    let customState: string | undefined
    if (nextParam) {
      try {
        const origin = new URL(nextParam).origin
        if (isAllowedOrigin(origin)) {
          customState = crypto.randomBytes(16).toString('hex')
          pendingReturnUrls.set(customState, origin)
        }
      } catch { /* invalid URL -- ignore */ }
    }
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
      prompt: 'select_account',
      ...(customState ? { state: customState } : {}),
    } as any)(req, res, next)
  },
)

//GET /api/auth/google/callback -- Handle Google redirect

router.get(
  '/google/callback',
  requireOAuthConfigured,
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('google', { session: false, failureRedirect: `${CLIENT_URL}/citizen/login?error=oauth_failed` }, (err: any, user: any, info: any) => {
      if (err || !user) {
        if (info?.code === 'ACCOUNT_NOT_FOUND') {
          logger.info({ info }, '[OAuth] Account not found for Google login')
          const params = new URLSearchParams({ error: 'oauth_account_not_found' })
          if (typeof info?.email === 'string' && info.email) {
            params.set('social_email', info.email)
          }
          return res.redirect(`${CLIENT_URL}/citizen/login?${params.toString()}`)
        }
        logger.error({ err, info }, '[OAuth] Google callback error')
        return res.redirect(`${CLIENT_URL}/citizen/login?error=oauth_failed`)
      }

      //Generate JWT tokens (same pattern as regular login)
      const token = generateToken({
        id: user.id,
        email: user.email,
        role: user.role || 'citizen',
        displayName: user.display_name,
      })
      //Generate secure one-time exchange code (NEVER put tokens in URLs)
      //Code expires in 60 seconds and can only be used once
      const exchangeCode = generateOAuthCode()
      pendingExchanges.set(exchangeCode, {
        userId: user.id,
        email: user.email,
        role: user.role || 'citizen',
        displayName: user.display_name,
        avatarUrl: user.avatar_url || null,
        expiresAt: Date.now() + 60 * 1000, // 60 second expiry
      })

      //Redirect to client with code (client exchanges for token via POST)
      //This is secure because:
      //1. Code is one-time use (deleted after exchange)
      //2. Code expires in 60 seconds
      //3. Token is returned via POST response body, not URL

      //Use LAN-aware redirect base: if this OAuth flow was started with a
      // ?next=<lan-url> param (e.g. from a phone on the same WiFi), redirect
      //back to that address so the phone can receive the exchange callback.
      const returnedState = req.query.state as string | undefined
      const lanOrigin = returnedState ? pendingReturnUrls.get(returnedState) : undefined
      if (returnedState && lanOrigin) pendingReturnUrls.delete(returnedState)
      const redirectBase = lanOrigin || CLIENT_URL

      res.redirect(`${redirectBase}/citizen/oauth/callback?code=${exchangeCode}`)
    })(req, res, next)
  },
)

//POST /api/auth/oauth/exchange -- Exchange one-time code for JWT tokens
//This is the secure token exchange endpoint

router.post('/oauth/exchange', async (req: Request, res: Response) => {
  const { code } = req.body
  
  if (!code || typeof code !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_CODE', message: 'Exchange code is required' },
    })
    return
  }
  
  const pending = pendingExchanges.get(code)
  
  if (!pending) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_CODE', message: 'Invalid or expired exchange code' },
    })
    return
  }
  
  //Delete code immediately (one-time use)
  pendingExchanges.delete(code)
  
  //Check expiry
  if (Date.now() > pending.expiresAt) {
    res.status(400).json({
      success: false,
      error: { code: 'CODE_EXPIRED', message: 'Exchange code has expired' },
    })
    return
  }
  
  //Generate tokens (same as regular login)
  const token = generateToken({
    id: pending.userId,
    email: pending.email,
    role: pending.role,
    displayName: pending.displayName,
  })
  const refreshToken = generateRefreshToken({ id: pending.userId, role: pending.role })
  
  //Store session in DB so refresh tokens can be validated later
  await createSession({
    userId: pending.userId,
    userType: 'citizen',
    refreshToken,
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] as string,
    ttlDays: 7,
  })
  
  //Set refresh cookie
  res.cookie('aegis_refresh', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', // Changed from 'lax' for better security
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/citizen-auth',
  })
  
  //Return access token in response body (secure - not in URL)
  res.json({
    success: true,
    data: {
      token,
      user: {
        id: pending.userId,
        email: pending.email,
        role: pending.role,
        displayName: pending.displayName,
        avatarUrl: pending.avatarUrl,
      },
    },
  })
  
  logger.info({ userId: pending.userId }, '[OAuth] Token exchange successful')
})

//GET /api/auth/status -- Check which OAuth providers are enabled

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    google: oauthEnabled,
    //Future: facebook, github, apple
  })
})

export default router
