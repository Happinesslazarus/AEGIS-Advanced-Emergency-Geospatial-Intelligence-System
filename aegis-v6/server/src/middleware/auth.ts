/**
 * JWT authentication and session management for the AEGIS API.
 * Verifies access tokens, enforces role-based permissions, and manages
 * refresh token sessions with rotation and revocation.
 *
 * - Every protected route uses authMiddleware to verify the caller's identity
 * - requireRole() gates admin, operator, and citizen-specific endpoints
 * - Session functions (createSession, validateSession, rotateRefreshToken)
 *   are called by authRoutes.ts and citizenAuthRoutes.ts during login/refresh
 * - Tokens are generated here and returned to clients via auth route handlers
 *
 * - authMiddleware -- verifies Bearer token on each request
 * - requireRole() / adminOnly / operatorOnly / citizenOnly -- role gates
 * - generateToken() / generateRefreshToken() -- issue JWTs
 * - createSession() / validateSession() / rotateRefreshToken() -- session lifecycle
 * */

import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from '../services/logger.js'

//Extend Express Request to include the authenticated user data
export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; displayName: string; department?: string | null }
}

//Never use a hardcoded fallback secret. Generate random for dev, crash in production.
const JWT_SECRET: string = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('[FATAL] JWT_SECRET env variable is not set. Cannot start in production without it.')
    process.exit(1)
  }
  //Dev / test: generate a random secret per process. Tokens won't survive restarts -- that's fine.
  const devSecret = crypto.randomBytes(64).toString('hex')
  logger.warn('[SECURITY] JWT_SECRET not set -- using random secret (dev only). Tokens invalidate on restart.')
  return devSecret
})()

//Separate secret for refresh tokens -- prevents access token secret compromise from forging refresh tokens.
//In production, REFRESH_TOKEN_SECRET must be a distinct key.
const REFRESH_SECRET: string = (() => {
  if (process.env.REFRESH_TOKEN_SECRET) return process.env.REFRESH_TOKEN_SECRET
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('[FATAL] REFRESH_TOKEN_SECRET must be set separately from JWT_SECRET in production.')
    process.exit(1)
  }
  //Dev: fall back to JWT_SECRET (acceptable for development only)
  return JWT_SECRET
})()

/*
 * Middleware function that checks for a valid JWT in the Authorization header.
 * Expects format: "Bearer <token>"
 * On success: attaches decoded user to req.user and calls next()
 * On failure: returns 401 Unauthorized
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please log in.' })
    return
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string; email: string; role: string; displayName: string; department?: string | null
    }
    req.user = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token. Please log in again.' })
  }
}

/*
 * Role-based authorization middleware factory.
 * Usage: router.get('/admin-only', authMiddleware, requireRole('admin', 'operator'), handler)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions for this action.' })
      return
    }
    next()
  }
}

/* Shorthand: only admins can access */
export const adminOnly = requireRole('admin')

/* Shorthand: only citizens can access (includes verified_citizen, community_leader) */
export const citizenOnly = requireRole('citizen', 'verified_citizen', 'community_leader')

/* Shorthand: only operators/admins can access */
export const operatorOnly = requireRole('admin', 'operator', 'manager')

/*
 * Helper to generate a signed JWT for a given user (operator or citizen).
 * Access tokens have short expiry (15 min); refresh tokens last 7--30 days.
 */
export function generateToken(user: { id: string; email: string; role: string; displayName: string; department?: string | null }): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '15m' })
}

/* Generate a long-lived refresh token (7 days for citizens, 30 days for operators) */
export function generateRefreshToken(user: { id: string; role: string }): string {
  const ttl = user.role === 'citizen' ? '7d' : '30d'
  return jwt.sign({ id: user.id, role: user.role, type: 'refresh' }, REFRESH_SECRET, { expiresIn: ttl })
}

/**
 * Verify any JWT (access or refresh) and return the decoded payload.
 * Use this instead of importing jsonwebtoken + JWT_SECRET elsewhere.
 */
export function verifyToken<T = Record<string, unknown>>(token: string): T {
  return jwt.verify(token, JWT_SECRET) as T
}

/* Verify a refresh token and return payload (throws on invalid/expired) */
export function verifyRefreshToken(token: string): { id: string; role: string; type: string } {
  const decoded = jwt.verify(token, REFRESH_SECRET) as { id: string; role: string; type: string }
  if (decoded.type !== 'refresh') throw new Error('Not a refresh token')
  return decoded
}

/**
 * Middleware that requires the authenticated user to have a verified email.
 * Must be used AFTER authMiddleware.
 * Checks the appropriate table (citizens or operators) based on the user's role.
 */
export function requireVerifiedEmail(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' })
    return
  }

  const table = req.user.role === 'citizen' ? 'citizens' : 'operators'

  pool.query(
    `SELECT email_verified FROM ${table} WHERE id = $1`,
    [req.user.id]
  ).then(result => {
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Account not found.' })
      return
    }
    if (!result.rows[0].email_verified) {
      res.status(403).json({
        error: 'Email verification required. Please verify your email address to access this feature.',
        code: 'EMAIL_NOT_VERIFIED',
      })
      return
    }
    next()
  }).catch((err) => {
    logger.error({ err, userId: req.user?.id }, '[Auth] Failed to check email verification status')
    res.status(500).json({ error: 'Failed to check email verification status.' })
  })
}

//Hash a refresh token for storage in user_sessions
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Create a session record for a refresh token.
 * Returns the session ID.
 */
export async function createSession(options: {
  userId: string
  userType: 'citizen' | 'operator'
  refreshToken: string
  ipAddress?: string
  userAgent?: string
  ttlDays: number
}): Promise<string> {
  const tokenHash = hashRefreshToken(options.refreshToken)
  const expiresAt = new Date(Date.now() + options.ttlDays * 24 * 60 * 60 * 1000)

  const result = await pool.query(
    `INSERT INTO user_sessions (user_id, user_type, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4::inet, $5, $6)
     RETURNING id`,
    [options.userId, options.userType, tokenHash, options.ipAddress || null, options.userAgent || null, expiresAt]
  )
  return result.rows[0].id
}

/**
 * Validate a refresh token against the sessions table.
 * Returns the session if found and not revoked/expired, null otherwise.
 */
export async function validateSession(refreshToken: string): Promise<{
  id: string; userId: string; userType: string
} | null> {
  const tokenHash = hashRefreshToken(refreshToken)

  const result = await pool.query(
    `SELECT id, user_id, user_type FROM user_sessions
     WHERE refresh_token_hash = $1 AND revoked = false AND expires_at > NOW()`,
    [tokenHash]
  )

  if (result.rows.length === 0) return null

  //Update last_used_at
  await pool.query('UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1', [result.rows[0].id])

  return {
    id: result.rows[0].id,
    userId: result.rows[0].user_id,
    userType: result.rows[0].user_type,
  }
}

/**
 * Rotate a refresh token: revoke the old session and create a new one.
 * This prevents token replay attacks.
 */
export async function rotateRefreshToken(options: {
  oldToken: string
  newToken: string
  userId: string
  userType: 'citizen' | 'operator'
  ipAddress?: string
  userAgent?: string
  ttlDays: number
}): Promise<string> {
  const oldHash = hashRefreshToken(options.oldToken)

  //Revoke old session
  await pool.query(
    `UPDATE user_sessions SET revoked = true, revoked_reason = 'rotated'
     WHERE refresh_token_hash = $1`,
    [oldHash]
  )

  //Create new session
  return createSession({
    userId: options.userId,
    userType: options.userType,
    refreshToken: options.newToken,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    ttlDays: options.ttlDays,
  })
}

/**
 * Revoke all sessions for a user (e.g. password change, security event).
 */
export async function revokeAllSessions(
  userId: string,
  reason: string = 'manual_revoke'
): Promise<number> {
  const result = await pool.query(
    `UPDATE user_sessions SET revoked = true, revoked_reason = $2
     WHERE user_id = $1 AND revoked = false
     RETURNING id`,
    [userId, reason]
  )
  return result.rowCount || 0
}
