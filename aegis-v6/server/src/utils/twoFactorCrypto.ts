/**
 * Cryptographic functions for TOTP 2FA: encrypts/decrypts TOTP secrets
 * at rest using AES-256-GCM, generates human-readable backup recovery
 * codes, and provides temp token and TOTP code hashing for replay
 * prevention.
 *
 * - Used by twoFactorRoutes.ts and citizenTwoFactorRoutes.ts
 * - Encryption key comes from TWO_FACTOR_ENCRYPTION_KEY env variable
 * - In dev, falls back to a key derived from JWT_SECRET
 * - TOTP secrets are stored encrypted in the database
 * */

import crypto from 'crypto'
import { logger } from '../services/logger.js'

// Encryption Key

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // 128-bit IV for AES-GCM
const AUTH_TAG_LENGTH = 16 // 128-bit authentication tag
const BACKUP_CODE_COUNT = 10
const BACKUP_CODE_SEGMENT_LENGTH = 4

function getEncryptionKey(): Buffer {
  const keyHex = process.env.TWO_FACTOR_ENCRYPTION_KEY
  if (!keyHex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] TWO_FACTOR_ENCRYPTION_KEY is not set. Cannot operate 2FA in production without it.')
    }
    // Dev fallback: deterministic key derived from JWT_SECRET so secrets survive restarts
    const fallback = process.env.JWT_SECRET || 'aegis-dev-2fa-key-not-for-production'
    logger.warn('[2FA] TWO_FACTOR_ENCRYPTION_KEY not set — deriving from JWT_SECRET (dev only)')
    return crypto.createHash('sha256').update(fallback).digest()
  }
  if (keyHex.length !== 64) {
    throw new Error('[FATAL] TWO_FACTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).')
  }
  return Buffer.from(keyHex, 'hex')
}

// AES-256-GCM Encrypt / Decrypt

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a compact string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encrypt2FASecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Input format: iv:authTag:ciphertext (all hex-encoded).
 */
export function decrypt2FASecret(encryptedStr: string): string {
  const key = getEncryptionKey()
  const parts = encryptedStr.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted 2FA secret format.')
  }
  const [ivHex, authTagHex, ciphertext] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// Backup Code Generation & Hashing

/**
 * Generate a single human-readable backup code: XXXX-XXXX (uppercase alphanumeric).
 * Uses a character set that avoids ambiguous characters (0/O, 1/I/L).
 */
function generateSingleBackupCode(): string {
  const charset = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0,O,1,I,L
  const segments: string[] = []
  for (let s = 0; s < 2; s++) {
    let segment = ''
    const bytes = crypto.randomBytes(BACKUP_CODE_SEGMENT_LENGTH)
    for (let i = 0; i < BACKUP_CODE_SEGMENT_LENGTH; i++) {
      segment += charset[bytes[i] % charset.length]
    }
    segments.push(segment)
  }
  return segments.join('-')
}

/**
 * Generate a set of backup codes.
 * Returns { plainCodes, hashedCodes } — plainCodes shown once to user,
 * hashedCodes stored in the database.
 */
export function generateBackupCodes(): { plainCodes: string[]; hashedCodes: string[] } {
  const plainCodes: string[] = []
  const hashedCodes: string[] = []
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateSingleBackupCode()
    plainCodes.push(code)
    hashedCodes.push(hashBackupCode(code))
  }
  return { plainCodes, hashedCodes }
}

/**
 * Hash a backup code for secure storage (SHA-256).
 * Normalises to uppercase and strips dashes before hashing.
 */
export function hashBackupCode(code: string): string {
  const normalised = code.toUpperCase().replace(/-/g, '')
  return crypto.createHash('sha256').update(normalised).digest('hex')
}

/**
 * Verify a user-submitted backup code against the stored hashed codes.
 * Returns the index of the matching code, or -1 if none match.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyBackupCode(submittedCode: string, hashedCodes: string[]): number {
  const submittedHash = hashBackupCode(submittedCode)
  const submittedBuf = Buffer.from(submittedHash, 'hex')
  for (let i = 0; i < hashedCodes.length; i++) {
    const storedBuf = Buffer.from(hashedCodes[i], 'hex')
    if (submittedBuf.length === storedBuf.length && crypto.timingSafeEqual(submittedBuf, storedBuf)) {
      return i
    }
  }
  return -1
}

// Temp Token for 2FA Login Flow

/**
 * Generate a cryptographically secure one-time temp token for the 2FA login step.
 * Returns a 48-byte hex string (384 bits of entropy).
 */
export function generateTempToken(): string {
  return crypto.randomBytes(48).toString('hex')
}

/**
 * Hash a temp token for storage (SHA-256).
 */
export function hashTempToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// TOTP Replay Protection

/**
 * Hash a TOTP code for replay detection (SHA-256).
 * We hash the code so we never store raw TOTP values in the DB.
 */
export function hashTOTPCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

/**
 * Check if a TOTP code is a replay (same code used within the TOTP window).
 * Returns true if the code should be REJECTED (is a replay).
 */
export function isTOTPReplay(
  codeHash: string,
  lastTOTPHash: string | null,
  lastTOTPAt: Date | null,
  windowSeconds: number = 90 // 3 TOTP periods (30s each) to cover —1 window
): boolean {
  if (!lastTOTPHash || !lastTOTPAt) return false
  const elapsed = Date.now() - new Date(lastTOTPAt).getTime()
  if (elapsed > windowSeconds * 1000) return false
  // Timing-safe comparison
  const a = Buffer.from(codeHash, 'hex')
  const b = Buffer.from(lastTOTPHash, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Brute-Force Protection Helpers

const TWO_FA_MAX_ATTEMPTS = 5
const TWO_FA_LOCKOUT_MINUTES = 10

/**
 * Check if the operator's 2FA is currently locked out due to too many failed attempts.
 * Returns { locked, remainingMinutes }.
 */
export function check2FALockout(
  failedAttempts: number,
  lockedUntil: Date | string | null
): { locked: boolean; remainingMinutes: number } {
  if (lockedUntil) {
    const until = new Date(lockedUntil)
    if (until > new Date()) {
      const remaining = Math.ceil((until.getTime() - Date.now()) / 60000)
      return { locked: true, remainingMinutes: remaining }
    }
  }
  return { locked: false, remainingMinutes: 0 }
}

/**
 * Determine if the operator should be locked out after a failed 2FA attempt.
 * Returns the new attempt count and whether a lockout should be applied.
 */
export function should2FALockout(currentAttempts: number): {
  newAttempts: number
  shouldLock: boolean
  lockoutMinutes: number
} {
  const newAttempts = currentAttempts + 1
  return {
    newAttempts,
    shouldLock: newAttempts >= TWO_FA_MAX_ATTEMPTS,
    lockoutMinutes: TWO_FA_LOCKOUT_MINUTES,
  }
}
