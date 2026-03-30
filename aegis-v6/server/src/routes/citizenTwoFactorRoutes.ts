/*
 * citizenTwoFactorRoutes.ts — TOTP-based Two-Factor Authentication for Citizens
 *
 * Mirrors the operator 2FA system with the same zero-trust protections:
 * AES-256-GCM encrypted secrets, replay protection, brute-force lockout,
 * SHA-256 hashed backup codes, IP + User-Agent binding.
 *
 * Endpoints:
 *   POST /api/citizen-auth/2fa/setup              — Generate TOTP secret + QR code
 *   POST /api/citizen-auth/2fa/verify             — Confirm first TOTP code, enable 2FA
 *   POST /api/citizen-auth/2fa/authenticate       — Complete login with TOTP/backup code
 *   POST /api/citizen-auth/2fa/disable            — Disable 2FA (requires password + code)
 *   POST /api/citizen-auth/2fa/regenerate-backup-codes — Regenerate recovery codes
 *   GET  /api/citizen-auth/2fa/status             — Check 2FA status for current citizen
 */

import { Router, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { generateSecret, verifySync } from 'otplib'
import * as QRCode from 'qrcode'
import pool from '../models/db.js'
import { authMiddleware, generateToken, generateRefreshToken, createSession, AuthRequest } from '../middleware/auth.js'
import {
  encrypt2FASecret, decrypt2FASecret, generateBackupCodes,
  verifyBackupCode, hashTempToken, hashTOTPCode, isTOTPReplay,
  check2FALockout, should2FALockout,
} from '../utils/twoFactorCrypto.js'
import { getClientIp } from '../utils/securityUtils.js'
import { logSecurityEvent } from '../services/securityLogger.js'
import { AppError } from '../utils/AppError.js'

const router = Router()

// TOTP Configuration
const ISSUER = 'AEGIS'
const TOTP_DIGITS = 6
const TOTP_PERIOD = 30
const TOTP_WINDOW = 1

function verifyTOTP(token: string, secret: string): boolean {
  const result = verifySync({ token, secret, digits: TOTP_DIGITS, period: TOTP_PERIOD, window: TOTP_WINDOW } as any)
  return result.valid
}

function generateOTPAuthURI(email: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`
}

// Rate Limiters
const setupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many 2FA setup attempts. Please try again later.' }, standardHeaders: true, legacyHeaders: false })
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many 2FA verification attempts. Please try again later.' }, standardHeaders: true, legacyHeaders: false })
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many 2FA authentication attempts. Please try again later.' }, standardHeaders: true, legacyHeaders: false })
const disableLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3, message: { error: 'Too many 2FA disable attempts. Please try again later.' }, standardHeaders: true, legacyHeaders: false })
const regenLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { error: 'Too many backup code regeneration attempts. Please try again later.' }, standardHeaders: true, legacyHeaders: false })

// Helpers

async function record2FAFailure(
  citizenId: string, clientIp: string, userAgent: string, metadata: Record<string, any>
): Promise<{ locked: boolean; lockoutMinutes: number }> {
  const result = await pool.query(
    `UPDATE citizens SET two_factor_failed_attempts = two_factor_failed_attempts + 1 WHERE id = $1 RETURNING two_factor_failed_attempts`,
    [citizenId]
  )
  const attempts = result.rows[0]?.two_factor_failed_attempts || 0
  const { shouldLock, lockoutMinutes } = should2FALockout(attempts - 1)

  if (shouldLock) {
    const lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000)
    await pool.query('UPDATE citizens SET two_factor_locked_until = $1 WHERE id = $2', [lockedUntil, citizenId])
    await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_auth_failed', ipAddress: clientIp, userAgent, metadata: { ...metadata, locked: true, lockout_minutes: lockoutMinutes, attempts } })
    return { locked: true, lockoutMinutes }
  }

  await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_auth_failed', ipAddress: clientIp, userAgent, metadata: { ...metadata, attempts } })
  return { locked: false, lockoutMinutes: 0 }
}

async function reset2FAFailures(citizenId: string): Promise<void> {
  await pool.query('UPDATE citizens SET two_factor_failed_attempts = 0, two_factor_locked_until = NULL WHERE id = $1', [citizenId])
}

async function enforce2FALockout(citizenId: string): Promise<void> {
  const result = await pool.query('SELECT two_factor_failed_attempts, two_factor_locked_until FROM citizens WHERE id = $1', [citizenId])
  if (result.rows.length === 0) return
  const { two_factor_failed_attempts, two_factor_locked_until } = result.rows[0]
  const lockout = check2FALockout(two_factor_failed_attempts, two_factor_locked_until)
  if (lockout.locked) {
    throw AppError.tooMany(`Account is temporarily locked due to too many failed 2FA attempts. Try again in ${lockout.remainingMinutes} minute(s).`)
  }
}

// GET /status
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT two_factor_enabled, two_factor_enabled_at, two_factor_last_verified_at,
              two_factor_recovery_generated_at, two_factor_backup_codes
       FROM citizens WHERE id = $1`,
      [req.user!.id]
    )
    if (result.rows.length === 0) throw AppError.notFound('Account not found.')
    const row = result.rows[0]
    res.json({
      enabled: row.two_factor_enabled || false,
      enabledAt: row.two_factor_enabled_at,
      lastVerifiedAt: row.two_factor_last_verified_at,
      recoveryCodesGeneratedAt: row.two_factor_recovery_generated_at,
      backupCodesRemaining: row.two_factor_enabled ? (row.two_factor_backup_codes?.length ?? 0) : null,
    })
  } catch (err) { next(err) }
})

// POST /setup
router.post('/setup', authMiddleware, setupLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const citizenId = req.user!.id
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    const cResult = await pool.query('SELECT two_factor_enabled, email FROM citizens WHERE id = $1', [citizenId])
    if (cResult.rows.length === 0) throw AppError.notFound('Account not found.')
    if (cResult.rows[0].two_factor_enabled) throw AppError.conflict('Two-factor authentication is already enabled. Disable it first to reconfigure.')

    const email = cResult.rows[0].email
    const secret = generateSecret({ length: 20 })
    const otpAuthUrl = generateOTPAuthURI(email, secret)
    const encryptedSecret = encrypt2FASecret(secret)

    await pool.query(`UPDATE citizens SET two_factor_secret = $1, two_factor_enabled = false WHERE id = $2`, [encryptedSecret, citizenId])

    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, { width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' } })

    await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_setup_initiated', ipAddress: clientIp, userAgent })

    res.json({ success: true, manualKey: secret, otpAuthUrl, qrCodeDataUrl })
  } catch (err) { next(err) }
})

// POST /verify
router.post('/verify', authMiddleware, verifyLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const citizenId = req.user!.id
    const { code } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!code || typeof code !== 'string' || code.length !== 6) throw AppError.badRequest('A valid 6-digit verification code is required.')

    const cResult = await pool.query('SELECT two_factor_enabled, two_factor_secret FROM citizens WHERE id = $1', [citizenId])
    if (cResult.rows.length === 0) throw AppError.notFound('Account not found.')
    const c = cResult.rows[0]
    if (c.two_factor_enabled) throw AppError.conflict('Two-factor authentication is already enabled.')
    if (!c.two_factor_secret) throw AppError.badRequest('Two-factor setup has not been initiated. Call /2fa/setup first.')

    const secret = decrypt2FASecret(c.two_factor_secret)
    const isValid = verifyTOTP(code, secret)
    if (!isValid) {
      await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_verify_failed', ipAddress: clientIp, userAgent, metadata: { stage: 'setup_verification' } })
      throw AppError.unauthorized('Invalid verification code. Please try again with a fresh code from your authenticator app.')
    }

    const { plainCodes, hashedCodes } = generateBackupCodes()
    const totpHash = hashTOTPCode(code)

    await pool.query(
      `UPDATE citizens
       SET two_factor_enabled = true, two_factor_enabled_at = NOW(), two_factor_last_verified_at = NOW(),
           two_factor_backup_codes = $1, two_factor_recovery_generated_at = NOW(),
           two_factor_failed_attempts = 0, two_factor_locked_until = NULL,
           two_factor_last_totp_hash = $3, two_factor_last_totp_at = NOW()
       WHERE id = $2`,
      [hashedCodes, citizenId, totpHash]
    )

    await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_enabled', ipAddress: clientIp, userAgent })

    res.json({ success: true, backupCodes: plainCodes })
  } catch (err) { next(err) }
})

// POST /authenticate
router.post('/authenticate', authLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { tempToken, code, rememberDevice } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!tempToken || typeof tempToken !== 'string') throw AppError.badRequest('Temporary login token is required.')
    if (!code || typeof code !== 'string') throw AppError.badRequest('Verification code is required.')

    const tokenHash = hashTempToken(tempToken)
    const tokenResult = await pool.query(
      `SELECT id, user_id, expires_at, consumed, ip_address, user_agent FROM two_factor_temp_tokens WHERE token_hash = $1 AND user_type = 'citizen'`,
      [tokenHash]
    )
    if (tokenResult.rows.length === 0) throw AppError.unauthorized('Invalid or expired temporary token. Please log in again.')

    const tempRecord = tokenResult.rows[0]
    if (tempRecord.consumed) {
      await logSecurityEvent({ userId: tempRecord.user_id, userType: 'citizen', eventType: '2fa_auth_failed', ipAddress: clientIp, userAgent, metadata: { reason: 'temp_token_reused' } })
      throw AppError.unauthorized('This temporary token has already been used. Please log in again.')
    }
    if (new Date(tempRecord.expires_at) < new Date()) {
      await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
      throw AppError.unauthorized('Temporary token has expired. Please log in again.')
    }
    if (tempRecord.ip_address && tempRecord.ip_address !== clientIp) {
      await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
      throw AppError.unauthorized('Session mismatch. Please log in again.')
    }
    if (tempRecord.user_agent && userAgent && tempRecord.user_agent !== userAgent) {
      await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
      throw AppError.unauthorized('Session mismatch. Please log in again.')
    }

    await enforce2FALockout(tempRecord.user_id)

    const cResult = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, phone, preferred_region, email_verified,
              location_lat, location_lng, is_vulnerable, vulnerability_details, country, city, bio, date_of_birth,
              two_factor_secret, two_factor_backup_codes, two_factor_enabled,
              two_factor_last_totp_hash, two_factor_last_totp_at
       FROM citizens WHERE id = $1 AND deleted_at IS NULL`,
      [tempRecord.user_id]
    )
    if (cResult.rows.length === 0) throw AppError.unauthorized('Account not found.')

    const citizen = cResult.rows[0]
    if (!citizen.two_factor_enabled || !citizen.two_factor_secret) throw AppError.badRequest('Two-factor authentication is not enabled for this account.')

    const isBackupCode = code.length > 6 || code.includes('-')
    let backupCodeUsed = false
    let backupCodesRemaining: number | null = null

    if (isBackupCode) {
      const storedCodes: string[] = citizen.two_factor_backup_codes || []
      const matchIndex = verifyBackupCode(code, storedCodes)
      if (matchIndex === -1) {
        const failure = await record2FAFailure(tempRecord.user_id, clientIp, userAgent, { method: 'backup_code' })
        if (failure.locked) {
          await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
          throw AppError.tooMany(`Account locked for ${failure.lockoutMinutes} minutes due to too many failed attempts.`)
        }
        throw AppError.unauthorized('Invalid code.')
      }
      const usedHash = storedCodes[matchIndex]
      const updateResult = await pool.query(
        `UPDATE citizens SET two_factor_backup_codes = array_remove(two_factor_backup_codes, $1) WHERE id = $2 RETURNING array_length(two_factor_backup_codes, 1) AS remaining`,
        [usedHash, citizen.id]
      )
      backupCodesRemaining = updateResult.rows[0]?.remaining ?? 0
      await logSecurityEvent({ userId: citizen.id, userType: 'citizen', eventType: '2fa_backup_code_used', ipAddress: clientIp, userAgent, metadata: { remaining_codes: backupCodesRemaining } })
      backupCodeUsed = true
    } else {
      const secret = decrypt2FASecret(citizen.two_factor_secret)
      const isValid = verifyTOTP(code, secret)
      if (!isValid) {
        const failure = await record2FAFailure(tempRecord.user_id, clientIp, userAgent, { method: 'totp' })
        if (failure.locked) {
          await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
          throw AppError.tooMany(`Account locked for ${failure.lockoutMinutes} minutes due to too many failed attempts.`)
        }
        throw AppError.unauthorized('Invalid code.')
      }
      const codeHash = hashTOTPCode(code)
      if (isTOTPReplay(codeHash, citizen.two_factor_last_totp_hash, citizen.two_factor_last_totp_at)) {
        await logSecurityEvent({ userId: citizen.id, userType: 'citizen', eventType: '2fa_auth_failed', ipAddress: clientIp, userAgent, metadata: { reason: 'totp_replay' } })
        throw AppError.unauthorized('This code has already been used. Please wait for a new code.')
      }
      await pool.query('UPDATE citizens SET two_factor_last_totp_hash = $1, two_factor_last_totp_at = NOW() WHERE id = $2', [codeHash, citizen.id])
    }

    // Consume temp token
    const consumeResult = await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1 AND consumed = false RETURNING id', [tempRecord.id])
    if (consumeResult.rows.length === 0) throw AppError.unauthorized('This temporary token has already been used. Please log in again.')

    await reset2FAFailures(citizen.id)
    await pool.query('UPDATE citizens SET two_factor_last_verified_at = NOW(), last_login = NOW(), login_count = login_count + 1 WHERE id = $1', [citizen.id])

    const token = generateToken({ id: citizen.id, email: citizen.email, role: citizen.role || 'citizen', displayName: citizen.display_name })
    const refreshToken = generateRefreshToken({ id: citizen.id, role: citizen.role || 'citizen' })

    await createSession({ userId: citizen.id, userType: 'citizen', refreshToken, ipAddress: clientIp, userAgent, ttlDays: 7 }).catch(() => {})

    await logSecurityEvent({ userId: citizen.id, userType: 'citizen', eventType: '2fa_auth_success', ipAddress: clientIp, userAgent, metadata: { method: isBackupCode ? 'backup_code' : 'totp' } })

    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/citizen-auth',
    })

    // Fetch preferences
    const prefsResult = await pool.query('SELECT * FROM citizen_preferences WHERE citizen_id = $1', [citizen.id])

    const responseData: Record<string, any> = {
      success: true,
      token,
      user: {
        id: citizen.id, email: citizen.email, displayName: citizen.display_name,
        role: citizen.role || 'citizen', avatarUrl: citizen.avatar_url, phone: citizen.phone,
        preferredRegion: citizen.preferred_region, emailVerified: citizen.email_verified,
        locationLat: citizen.location_lat, locationLng: citizen.location_lng,
        isVulnerable: citizen.is_vulnerable, vulnerabilityDetails: citizen.vulnerability_details,
        country: citizen.country, city: citizen.city, bio: citizen.bio, dateOfBirth: citizen.date_of_birth,
      },
      preferences: prefsResult.rows[0] || null,
      backupCodeUsed,
    }
    if (backupCodeUsed) {
      responseData.backupCodeWarning = 'A recovery code was used. Consider regenerating your backup codes in Settings.'
    }

    res.json(responseData)
  } catch (err) { next(err) }
})

// POST /disable
router.post('/disable', authMiddleware, disableLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const citizenId = req.user!.id
    const { password, code } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!password || typeof password !== 'string') throw AppError.badRequest('Current password is required to disable 2FA.')
    if (!code || typeof code !== 'string') throw AppError.badRequest('A valid TOTP code or backup code is required to disable 2FA.')

    await enforce2FALockout(citizenId)

    const cResult = await pool.query(
      `SELECT id, password_hash, two_factor_enabled, two_factor_secret, two_factor_backup_codes, two_factor_last_totp_hash, two_factor_last_totp_at FROM citizens WHERE id = $1`,
      [citizenId]
    )
    if (cResult.rows.length === 0) throw AppError.notFound('Account not found.')
    const c = cResult.rows[0]
    if (!c.two_factor_enabled) throw AppError.badRequest('Two-factor authentication is not currently enabled.')

    const passwordValid = await bcrypt.compare(password, c.password_hash)
    if (!passwordValid) {
      await record2FAFailure(citizenId, clientIp, userAgent, { action: 'disable', reason: 'wrong_password' })
      throw AppError.unauthorized('Invalid password.')
    }

    const isBackupCode = code.length > 6 || code.includes('-')
    let secondFactorValid = false
    if (isBackupCode) {
      const matchIndex = verifyBackupCode(code, c.two_factor_backup_codes || [])
      secondFactorValid = matchIndex !== -1
    } else {
      const secret = decrypt2FASecret(c.two_factor_secret)
      secondFactorValid = verifyTOTP(code, secret)
      if (secondFactorValid) {
        const codeHash = hashTOTPCode(code)
        if (isTOTPReplay(codeHash, c.two_factor_last_totp_hash, c.two_factor_last_totp_at)) secondFactorValid = false
      }
    }
    if (!secondFactorValid) {
      await record2FAFailure(citizenId, clientIp, userAgent, { action: 'disable', reason: 'wrong_code' })
      throw AppError.unauthorized('Invalid verification code.')
    }

    await reset2FAFailures(citizenId)
    await pool.query(
      `UPDATE citizens SET two_factor_enabled = false, two_factor_secret = NULL, two_factor_backup_codes = NULL,
       two_factor_enabled_at = NULL, two_factor_last_verified_at = NULL, two_factor_recovery_generated_at = NULL,
       two_factor_failed_attempts = 0, two_factor_locked_until = NULL, two_factor_last_totp_hash = NULL, two_factor_last_totp_at = NULL
       WHERE id = $1`,
      [citizenId]
    )

    await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_disabled', ipAddress: clientIp, userAgent })
    res.json({ success: true, message: 'Two-factor authentication has been disabled.' })
  } catch (err) { next(err) }
})

// POST /regenerate-backup-codes
router.post('/regenerate-backup-codes', authMiddleware, regenLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const citizenId = req.user!.id
    const { password, code } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!password || typeof password !== 'string') throw AppError.badRequest('Current password is required.')
    if (!code || typeof code !== 'string' || code.length !== 6) throw AppError.badRequest('A valid 6-digit TOTP code is required.')

    await enforce2FALockout(citizenId)

    const cResult = await pool.query(
      `SELECT id, password_hash, two_factor_enabled, two_factor_secret, two_factor_last_totp_hash, two_factor_last_totp_at FROM citizens WHERE id = $1`,
      [citizenId]
    )
    if (cResult.rows.length === 0) throw AppError.notFound('Account not found.')
    const c = cResult.rows[0]
    if (!c.two_factor_enabled) throw AppError.badRequest('Two-factor authentication is not enabled.')

    const passwordValid = await bcrypt.compare(password, c.password_hash)
    if (!passwordValid) {
      await record2FAFailure(citizenId, clientIp, userAgent, { action: 'regenerate', reason: 'wrong_password' })
      throw AppError.unauthorized('Invalid password.')
    }

    const secret = decrypt2FASecret(c.two_factor_secret)
    const isValid = verifyTOTP(code, secret)
    if (!isValid) {
      await record2FAFailure(citizenId, clientIp, userAgent, { action: 'regenerate', reason: 'wrong_code' })
      throw AppError.unauthorized('Invalid verification code.')
    }

    const codeHash = hashTOTPCode(code)
    if (isTOTPReplay(codeHash, c.two_factor_last_totp_hash, c.two_factor_last_totp_at)) {
      throw AppError.unauthorized('This code has already been used. Please wait for a new code.')
    }

    await reset2FAFailures(citizenId)
    await pool.query('UPDATE citizens SET two_factor_last_totp_hash = $1, two_factor_last_totp_at = NOW() WHERE id = $2', [codeHash, citizenId])

    const { plainCodes, hashedCodes } = generateBackupCodes()
    await pool.query(`UPDATE citizens SET two_factor_backup_codes = $1, two_factor_recovery_generated_at = NOW() WHERE id = $2`, [hashedCodes, citizenId])

    await logSecurityEvent({ userId: citizenId, userType: 'citizen', eventType: '2fa_backup_codes_regenerated', ipAddress: clientIp, userAgent })

    res.json({ success: true, backupCodes: plainCodes })
  } catch (err) { next(err) }
})

export default router
