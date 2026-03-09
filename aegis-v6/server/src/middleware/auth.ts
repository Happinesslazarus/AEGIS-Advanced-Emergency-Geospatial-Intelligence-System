/*
 * auth.ts - JWT authentication middleware
 *
 * Protects admin-only API routes by verifying JSON Web Tokens.
 * When an operator logs in, the server issues a signed JWT containing
 * their user ID and role. This middleware extracts the token from the
 * Authorization header, verifies its signature, and attaches the
 * decoded payload to the request object for downstream handlers.
 *
 * Routes that require authentication use this as middleware:
 *   router.get('/protected', authMiddleware, handler)
 */

import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

// Extend Express Request to include the authenticated user data
export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; displayName: string; department?: string | null }
}

// #1 — Never use a hardcoded fallback secret. Generate random for dev, crash in production.
const JWT_SECRET: string = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET env variable is not set. Cannot start in production without it.')
    process.exit(1)
  }
  // Dev / test: generate a random secret per process. Tokens won't survive restarts — that's fine.
  const crypto = require('crypto') as typeof import('crypto')
  const devSecret = crypto.randomBytes(64).toString('hex')
  console.warn('[SECURITY] JWT_SECRET not set — using random secret (dev only). Tokens invalidate on restart.')
  return devSecret
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

/** Shorthand: only citizens can access */
export const citizenOnly = requireRole('citizen')

/** Shorthand: only operators/admins can access */
export const operatorOnly = requireRole('admin', 'operator', 'manager')

/*
 * Helper to generate a signed JWT for a given user (operator or citizen).
 * Access tokens have short expiry (15 min); refresh tokens last 7 days.
 */
export function generateToken(user: { id: string; email: string; role: string; displayName: string; department?: string | null }): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '15m' })
}

/** Generate a long-lived refresh token (7 days) containing only the user id + role */
export function generateRefreshToken(user: { id: string; role: string }): string {
  return jwt.sign({ id: user.id, role: user.role, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' })
}

/** Verify a refresh token and return payload (throws on invalid/expired) */
export function verifyRefreshToken(token: string): { id: string; role: string; type: string } {
  const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string; type: string }
  if (decoded.type !== 'refresh') throw new Error('Not a refresh token')
  return decoded
}
