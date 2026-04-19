/**
 * Security helper functions: password strength validation (enterprise policy),
 * account lockout tracking, password history to prevent reuse, secure token
 * generation, timing-safe comparisons, and client IP extraction.
 *
 * - Used by authRoutes.ts and citizenAuthRoutes.ts for login/registration
 * - Password policy enforces 12+ chars, mixed case, digits, symbols, entropy
 * - Lockout state stored in the operators/citizens tables
 * - Password history checked against the last 5 hashes
 * */

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import pool from '../models/db.js'

// Configuration

/* Minimum password length */
export const MIN_PASSWORD_LENGTH = 12

/* Number of past passwords to check against for reuse prevention */
export const PASSWORD_HISTORY_DEPTH = 5

/* Max failed login attempts before account lockout */
export const MAX_LOGIN_ATTEMPTS = 10

/* Lockout duration in minutes */
export const LOCKOUT_DURATION_MINUTES = 15

const COMMON_PASSWORDS = new Set([
  '123456','password','12345678','qwerty','123456789','12345','1234567','1234567890',
  'abc123','football','iloveyou','admin','welcome','monkey','login','shadow','master',
  'dragon','passw0rd','letmein','password1','princess','sunshine','trustno1','whatever',
  'password123','admin123','letmein123','qwerty123','1q2w3e4r','pass','test','test1',
  'qwertyuiop','superman','batman','michael','jessica','hunter','696969','mustang',
  'baseball','soccer','charlie','thomas','tiger','ranger','joshua','robert','daniel',
  'george','jennifer','access','777777','donald','123123','pass123','1234','11111',
  '555555','654321','666666','7777777','8675309','pass@123','Admin123','P@ssw0rd',
  'P@ssword','Password1','Password!','Password1!','Passw0rd!','Admin@123','Hello123',
  'hello','hello123','welcome1','welcome123','secret','qwert','asdf','zxcv','asdfgh',
  'azerty','pokepoke','pokemon','starwars','superman1','batman1','spiderman','captain',
  'yankees','chicago','dallas','lakers','jordan','harley','ranger1','buster','hockey',
  'biteme','matrix','orange','banana','summer','winter','spring','autumn','pokemon1',
  'nintendo','computer','internet','security','freedom','america','cheese','coffee',
  'cookie','maggie','loveyou','baby','angel','killer','naughty','tennis','soccer1',
  'hockey1','baseball1','basketball','football1','liverpool','chelsea','arsenal','madrid',
  'barcelona','milan','juventus','cowboys','nfl','nba','mlb','nhl','golf','bowling',
  'sailing','cycling','surfing','skateboard','snowboard','thunder','lightning','storm',
  'rainbow','dragon1','unicorn','phoenix','titan','warrior','gladiator','spartan',
  'viking','ninja','samurai','pirate','cowboy','soldier','officer','captain1','general',
  'admiral','colonel','sergeant','corporal','private1','justice','liberty','patriot',
  'eagle','falcon','hawk','raven','cobra','viper','panther','jaguar','cougar','puma',
  '0000','1111','2222','3333','4444','6666','8888','9999','00000','11111','22222',
  '33333','44444','55555','66666','77777','88888','99999','000000','111111','222222',
  '333333','444444','555555','666666','777777','888888','999999','1234567890','0987654321',
  'qazwsx','qazwsxedc','!@#$%^','!@#$%^&*','p@ssw0rd','pa$$w0rd','p@$$word','p@$$w0rd',
  'passpasspass','passwordpassword','passwordd','passwrod','pasword','pssword','passsword',
  'passworrd','passwoord','psswd','passwd','pwd','passwrd','paswd','pswrd','ppass',
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
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  return -[...freq.values()].reduce((sum, f) => sum + (f / s.length) * Math.log2(f / s.length), 0)
}

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

  if (password.length >= MIN_PASSWORD_LENGTH && shannonEntropy(password) < 3.0) {
    errors.push('Password is too repetitive. Use a greater variety of characters.')
  }

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

/* Extract client IP from request.
 * Relies on Express's built-in req.ip which respects the `trust proxy` setting.
 * With `app.set('trust proxy', 1)` Express correctly resolves the leftmost
 * X-Forwarded-For hop, preventing IP spoofing via injected header values. */
export function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  return req.ip || '0.0.0.0'
}
