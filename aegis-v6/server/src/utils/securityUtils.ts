/*
 * securityUtils.ts - Enterprise Security Utilities
 *
 * Centralised helpers for:
 * Password strength validation (12-char min, complexity, common password check)
 * Password history enforcement (prevent reuse of last N passwords)
 * Cryptographic token hashing (SHA-256 for verification / reset tokens)
 * Account lockout helpers (threshold, duration, reset)
 * IP extraction from proxied requests
 */

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import pool from '../models/db.js'

// Configuration

/* Minimum password length */
export const MIN_PASSWORD_LENGTH = 12

/* Number of past passwords to check against for reuse prevention */
export const PASSWORD_HISTORY_DEPTH = 5

/* Max failed login attempts before account lockout */
export const MAX_LOGIN_ATTEMPTS = 5

/* Lockout duration in minutes */
export const LOCKOUT_DURATION_MINUTES = 15

// Common Passwords (top 100 - reject these outright)

const COMMON_PASSWORDS = new Set([
  'password', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'abc123', 'password1', 'iloveyou', 'admin',
  'letmein', 'welcome', 'monkey', 'dragon', 'master',
  'login', 'princess', 'football', 'shadow', 'sunshine',
  'trustno1', 'passw0rd', 'whatever', 'password123', 'admin123',
])

// Password Validation

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

 /**
 * Validates password against enterprise security policy:
 * Minimum 12 characters
 * At least 1 uppercase letter
 * At least 1 lowercase letter
 * At least 1 digit
 * At least 1 special character
 * Not in common password list
 * Not containing the user's email prefix
 */
export function validatePasswordStrength(password: string, email?: string): PasswordValidationResult {
  const errors: string[] = []

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.')
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.')
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number.')
  }

  if (!/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push('Password must contain at least one special character.')
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password is too common. Please choose a more unique password.')
  }

  // Check that password doesn't contain the email prefix (before @)
  if (email) {
    const emailPrefix = email.split('@')[0].toLowerCase()
    if (emailPrefix.length >= 3 && password.toLowerCase().includes(emailPrefix)) {
      errors.push('Password must not contain your email address.')
    }
  }

  return { valid: errors.length === 0, errors }
}

// Cryptographic Token Hashing

/* SHA-256 hash a token (for storing verification/reset tokens) */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/* Generate a cryptographically secure random token (hex-encoded) */
export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}

/* Timing-safe comparison of two hex strings */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

// Password History

 /**
 * Check if a new password matches any of the user's last N passwords.
 * Returns true if the password was recently used (i.e. should be rejected).
 */
export async function isPasswordReused(
  newPassword: string,
  userId: string,
  userType: 'citizen' | 'operator'
): Promise<boolean> {
  const result = await pool.query(
    `SELECT password_hash FROM password_history
     WHERE user_id = $1 AND user_type = $2
     ORDER BY created_at DESC LIMIT $3`,
    [userId, userType, PASSWORD_HISTORY_DEPTH]
  )

  for (const row of result.rows) {
    if (await bcrypt.compare(newPassword, row.password_hash)) {
      return true
    }
  }
  return false
}

 /**
 * Record the current password hash in the history table.
 * Call this AFTER updating the user's password.
 */
export async function recordPasswordHistory(
  userId: string,
  userType: 'citizen' | 'operator',
  passwordHash: string
): Promise<void> {
  await pool.query(
    `INSERT INTO password_history (user_id, user_type, password_hash)
     VALUES ($1, $2, $3)`,
    [userId, userType, passwordHash]
  )
}

// Account Lockout

export interface LockoutStatus {
  locked: boolean
  remainingMinutes: number
  attempts: number
}

 /**
 * Check if an account is currently locked out.
 */
export function checkLockout(failedAttempts: number, lockedUntil: Date | null): LockoutStatus {
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    const remainingMs = new Date(lockedUntil).getTime() - Date.now()
    return {
      locked: true,
      remainingMinutes: Math.ceil(remainingMs / 60000),
      attempts: failedAttempts,
    }
  }
  return { locked: false, remainingMinutes: 0, attempts: failedAttempts }
}

 /**
 * Increment failed login attempts. If threshold reached, lock the account.
 * Returns the new lockout status.
 */
export async function recordFailedLogin(
  table: 'citizens' | 'operators',
  userId: string
): Promise<LockoutStatus> {
  const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)

  const result = await pool.query(
    `UPDATE ${table}
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2 THEN $3::timestamptz
           ELSE locked_until
         END
     WHERE id = $1
     RETURNING failed_login_attempts, locked_until`,
    [userId, MAX_LOGIN_ATTEMPTS, lockUntil.toISOString()]
  )

  const row = result.rows[0]
  return checkLockout(row.failed_login_attempts, row.locked_until)
}

 /**
 * Reset failed login attempts after a successful login.
 */
export async function resetFailedLogins(
  table: 'citizens' | 'operators',
  userId: string
): Promise<void> {
  await pool.query(
    `UPDATE ${table}
     SET failed_login_attempts = 0, locked_until = NULL
     WHERE id = $1`,
    [userId]
  )
}

// IP Extraction

/* Extract client IP from request, respecting X-Forwarded-For behind proxies */
export function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]
    return first.trim()
  }
  return req.ip || '0.0.0.0'
}
