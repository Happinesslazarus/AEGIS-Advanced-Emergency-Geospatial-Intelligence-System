 /*
 * routes/oauthRoutes.ts — Social login via Passport.js
 * Endpoints:
 *   GET  /api/auth/google          — Redirect to Google consent screen
 *   GET  /api/auth/google/callback — Google callback → JWT + redirect
 * Environment variables required:
 *   GOOGLE_CLIENT_ID       — Google Cloud OAuth client ID
 *   GOOGLE_CLIENT_SECRET   — Google Cloud OAuth client secret
 *   OAUTH_CALLBACK_URL     — e.g. https://yoursite.com/api/auth/google/callback
 *   CLIENT_URL             — e.g. https://yoursite.com (for redirect after login)
 * If GOOGLE_CLIENT_ID is not set, the routes are still mounted but return a
 * 501 "OAuth not configured" response, so the server always starts cleanly.
  */

import { Router, Request, Response, NextFunction } from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20'
import pool from '../models/db.js'
import { generateToken, generateRefreshToken } from '../middleware/auth.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()

// Configure Passport Google Strategy (only when env vars present)

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
        done: (err: any, user?: any) => void,
      ) => {
        try {
          const email = profile.emails?.[0]?.value
          if (!email) return done(new Error('Google account has no email'))

          const googleId = profile.id
          const displayName = profile.displayName || email.split('@')[0]
          const avatarUrl = profile.photos?.[0]?.value || null

          // 1. Check if user already exists (by google_id or email)
          let result = await pool.query(
            `SELECT id, email, display_name, role, avatar_url, preferred_region,
                    email_verified, is_active, google_id
             FROM citizens WHERE google_id = $1 OR LOWER(email) = LOWER($2)
             LIMIT 1`,
            [googleId, email],
          )

          let citizen = result.rows[0]

          if (citizen) {
            // Link Google ID if not yet linked
            if (!citizen.google_id) {
              await pool.query(
                `UPDATE citizens SET google_id = $1, email_verified = true WHERE id = $2`,
                [googleId, citizen.id],
              )
            }
            // Update avatar if missing
            if (!citizen.avatar_url && avatarUrl) {
              await pool.query(
                `UPDATE citizens SET avatar_url = $1 WHERE id = $2`,
                [avatarUrl, citizen.id],
              )
            }
            // Update last login
            await pool.query(
              `UPDATE citizens SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1`,
              [citizen.id],
            )
          } else {
            // 2. Create new citizen from Google profile
            const insertResult = await pool.query(
              `INSERT INTO citizens (email, display_name, password_hash, avatar_url, google_id, email_verified, is_active, role)
               VALUES ($1, $2, $3, $4, $5, true, true, 'citizen')
               RETURNING id, email, display_name, role, avatar_url, preferred_region, email_verified`,
              [email, displayName, 'OAUTH_NO_PASSWORD', avatarUrl, googleId],
            )
            citizen = insertResult.rows[0]

            // Create default preferences
            await pool.query(
              `INSERT INTO citizen_preferences (citizen_id) VALUES ($1) ON CONFLICT DO NOTHING`,
              [citizen.id],
            )
          }

          done(null, citizen)
        } catch (err) {
          done(err)
        }
      },
    ),
  )

  // Serialize / deserialize (session-less — we use JWT)
  passport.serializeUser((user: any, done) => done(null, user))
  passport.deserializeUser((user: any, done) => done(null, user))
}

// Middleware guard — returns 501 when OAuth is not configured

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

// GET /api/auth/google — Initiate Google OAuth flow

router.get(
  '/google',
  requireOAuthConfigured,
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account',
  }),
)

// GET /api/auth/google/callback — Handle Google redirect

router.get(
  '/google/callback',
  requireOAuthConfigured,
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('google', { session: false, failureRedirect: `${CLIENT_URL}/citizen/login?error=oauth_failed` }, (err: any, user: any) => {
      if (err || !user) {
        logger.error({ err }, '[OAuth] Google callback error')
        return res.redirect(`${CLIENT_URL}/citizen/login?error=oauth_failed`)
      }

      // Generate JWT tokens (same pattern as regular login)
      const token = generateToken({
        id: user.id,
        email: user.email,
        role: user.role || 'citizen',
        displayName: user.display_name,
      })
      const refreshToken = generateRefreshToken({ id: user.id, role: user.role || 'citizen' })

      // Set refresh cookie
      res.cookie('aegis_refresh', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/citizen-auth',
      })

      // Redirect to client with token in URL hash (short-lived, read once by client JS)
      // The client reads the token from the hash fragment, stores it, and clears the hash.
      res.redirect(`${CLIENT_URL}/citizen/dashboard#oauth_token=${token}`)
    })(req, res, next)
  },
)

// GET /api/auth/status — Check which OAuth providers are enabled

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    google: oauthEnabled,
    // Future: facebook, github, apple
  })
})

export default router
