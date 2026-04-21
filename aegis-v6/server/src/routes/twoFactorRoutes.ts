/**
 * TOTP two-factor authentication for operator accounts. Handles setup
 * (generates secret + QR code), verification, login completion with
 * 2FA codes, and backup code management.
 *
 * - Mounted at /api/auth/2fa in index.ts
 * - Works with auth.ts for the two-step login flow
 * - Uses twoFactorCrypto for secret encryption at rest
 * - Requires authentication (operators only)
 * */

import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib'
import * as QRCode from 'qrcode'
import pool from '../models/db.js'
import { authMiddleware, generateToken, generateRefreshToken, createSession, AuthRequest } from '../middleware/auth.js'
import {
  encrypt2FASecret, decrypt2FASecret, generateBackupCodes,
  verifyBackupCode, hashTempToken, hashTOTPCode, isTOTPReplay,
  check2FALockout, should2FALockout } from '../utils/twoFactorCrypto.js'
import { getClientIp } from '../utils/securityUtils.js'
import { logSecurityEvent } from '../services/securityLogger.js'
import { isDeviceTrusted, trustDevice } from '../services/deviceTrustService.js'
import { alert2FADisabled, alertBackupCodeUsed, alertNewDeviceLogin } from '../services/securityAlertService.js'
import { AppError } from '../utils/AppError.js'
import { twoFactorAuthTotal } from '../services/metrics.js'

const router = Router()

//TOTP Configuration

const ISSUER = 'AEGIS'
const TOTP_DIGITS = 6
const TOTP_PERIOD = 30
const TOTP_WINDOW = 1 // --1 time step for clock skew tolerance

/* Verify a TOTP code against a secret */
function verifyTOTP(token: string, secret: string): boolean {
  const result = verifySync({ token, secret, digits: TOTP_DIGITS, period: TOTP_PERIOD, window: TOTP_WINDOW } as any)
  return result.valid
}

/* Generate an otpauth:// URI for authenticator apps */
function generateOTPAuthURI(email: string, secret: string): string {
  return generateURI({ strategy: 'totp', issuer: ISSUER, label: email, secret, digits: TOTP_DIGITS, period: TOTP_PERIOD })
}

//Rate Limiters

const twoFactorSetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many 2FA setup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false })

const twoFactorVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many 2FA verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false })

const twoFactorAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many 2FA authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false })

const twoFactorDisableLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Too many 2FA disable attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false })

const twoFactorRegenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many backup code regeneration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false })

//Helpers

/**
 * Record a failed 2FA attempt and apply lockout if threshold reached.
 * Returns { locked, lockoutMinutes }.
 */
async function record2FAFailure(
  operatorId: string, clientIp: string, userAgent: string, metadata: Record<string, any>
): Promise<{ locked: boolean; lockoutMinutes: number }> {
  //Atomically increment and fetch
  const result = await pool.query(
    `UPDATE operators
     SET two_factor_failed_attempts = two_factor_failed_attempts + 1
     WHERE id = $1
     RETURNING two_factor_failed_attempts`,
    [operatorId]
  )
  const attempts = result.rows[0]?.two_factor_failed_attempts || 0
  const { shouldLock, lockoutMinutes } = should2FALockout(attempts - 1) // should2FALockout expects current (pre-increment)

  if (shouldLock) {
    const lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000)
    await pool.query(
      'UPDATE operators SET two_factor_locked_until = $1 WHERE id = $2',
      [lockedUntil, operatorId]
    )
    await logSecurityEvent({
      userId: operatorId, userType: 'operator', eventType: '2fa_auth_failed',
      ipAddress: clientIp, userAgent,
      metadata: { ...metadata, locked: true, lockout_minutes: lockoutMinutes, attempts } })
    return { locked: true, lockoutMinutes }
  }

  await logSecurityEvent({
    userId: operatorId, userType: 'operator', eventType: '2fa_auth_failed',
    ipAddress: clientIp, userAgent,
    metadata: { ...metadata, attempts } })
  return { locked: false, lockoutMinutes: 0 }
}

/* Reset 2FA failed attempts and lockout after a successful verification. */
async function reset2FAFailures(operatorId: string): Promise<void> {
  await pool.query(
    'UPDATE operators SET two_factor_failed_attempts = 0, two_factor_locked_until = NULL WHERE id = $1',
    [operatorId]
  )
}

/**
 * Check if operator is currently locked out from 2FA.
 * Throws AppError if locked.
 */
async function enforce2FALockout(operatorId: string): Promise<void> {
  const result = await pool.query(
    'SELECT two_factor_failed_attempts, two_factor_locked_until FROM operators WHERE id = $1',
    [operatorId]
  )
  if (result.rows.length === 0) return
  const { two_factor_failed_attempts, two_factor_locked_until } = result.rows[0]
  const lockout = check2FALockout(two_factor_failed_attempts, two_factor_locked_until)
  if (lockout.locked) {
    throw AppError.tooMany(`Account is temporarily locked due to too many failed 2FA attempts. Try again in ${lockout.remainingMinutes} minute(s).`)
  }
}

//GET /api/auth/2fa/status

router.get('/status', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    const result = await pool.query(
      `SELECT two_factor_enabled, two_factor_enabled_at, two_factor_last_verified_at,
              two_factor_recovery_generated_at, two_factor_backup_codes
       FROM operators WHERE id = $1`,
      [req.user!.id]
    )
    if (result.rows.length === 0) {
      throw AppError.notFound('Operator not found.')
    }
    const row = result.rows[0]
    res.json({
      enabled: row.two_factor_enabled,
      enabledAt: row.two_factor_enabled_at,
      lastVerifiedAt: row.two_factor_last_verified_at,
      recoveryCodesGeneratedAt: row.two_factor_recovery_generated_at,
      backupCodesRemaining: row.two_factor_enabled
        ? (row.two_factor_backup_codes?.length ?? 0)
        : null })
})

//POST /api/auth/2fa/setup

router.post('/setup', authMiddleware, twoFactorSetupLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
    const operatorId = req.user!.id
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    //Check if 2FA is already enabled
    const opResult = await pool.query(
      'SELECT two_factor_enabled, email, two_factor_secret FROM operators WHERE id = $1',
      [operatorId]
    )
    if (opResult.rows.length === 0) {
      throw AppError.notFound('Operator not found.')
    }
    if (opResult.rows[0].two_factor_enabled) {
      throw AppError.conflict('Two-factor authentication is already enabled. Disable it first to reconfigure.')
    }

    const email = opResult.rows[0].email
    const existingEncryptedSecret = opResult.rows[0].two_factor_secret
    let secret: string
    let reusedExistingSecret = false

    if (existingEncryptedSecret) {
      try {
        //Reuse pending setup secret so users can keep using the same authenticator entry.
        secret = decrypt2FASecret(existingEncryptedSecret)
        reusedExistingSecret = true
      } catch {
        //If stored secret is invalid/corrupt, rotate to a fresh one.
        secret = generateSecret({ length: 20 })
        const encryptedSecret = encrypt2FASecret(secret)
        await pool.query(
          `UPDATE operators
           SET two_factor_secret = $1, two_factor_enabled = false
           WHERE id = $2`,
          [encryptedSecret, operatorId]
        )
      }
    } else {
      secret = generateSecret({ length: 20 }) // 160-bit secret
      const encryptedSecret = encrypt2FASecret(secret)
      await pool.query(
        `UPDATE operators
         SET two_factor_secret = $1, two_factor_enabled = false
         WHERE id = $2`,
        [encryptedSecret, operatorId]
      )
    }

    const otpAuthUrl = generateOTPAuthURI(email, secret)

    //Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' } })

    await logSecurityEvent({
      userId: operatorId, userType: 'operator', eventType: '2fa_setup_initiated',
      ipAddress: clientIp, userAgent })

    res.json({
      success: true,
      manualKey: secret,
      otpAuthUrl,
      qrCodeDataUrl,
      reusedExistingSecret })
})

//POST /api/auth/2fa/verify

router.post('/verify', authMiddleware, twoFactorVerifyLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
    const operatorId = req.user!.id
    const { code } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!code || typeof code !== 'string' || code.length !== 6) {
      throw AppError.badRequest('A valid 6-digit verification code is required.')
    }

    //Fetch operator 2FA state
    const opResult = await pool.query(
      'SELECT two_factor_enabled, two_factor_secret FROM operators WHERE id = $1',
      [operatorId]
    )
    if (opResult.rows.length === 0) {
      throw AppError.notFound('Operator not found.')
    }

    const op = opResult.rows[0]

    if (op.two_factor_enabled) {
      throw AppError.conflict('Two-factor authentication is already enabled.')
    }

    if (!op.two_factor_secret) {
      throw AppError.badRequest('Two-factor setup has not been initiated. Call /2fa/setup first.')
    }

    //Decrypt and verify the TOTP code
    const secret = decrypt2FASecret(op.two_factor_secret)
    const isValid = verifyTOTP(code, secret)

    if (!isValid) {
      await logSecurityEvent({
        userId: operatorId, userType: 'operator', eventType: '2fa_verify_failed',
        ipAddress: clientIp, userAgent, metadata: { stage: 'setup_verification' } })
      twoFactorAuthTotal.inc({ outcome: 'failure', method: 'totp_setup' })
      throw AppError.unauthorized('Invalid verification code. Please try again with a fresh code from your authenticator app.')
    }

    //Generate backup codes
    const { plainCodes, hashedCodes } = generateBackupCodes()

    //Enable 2FA and record initial TOTP for replay protection
    const totpHash = hashTOTPCode(code)
    await pool.query(
      `UPDATE operators
       SET two_factor_enabled = true,
           two_factor_enabled_at = NOW(),
           two_factor_last_verified_at = NOW(),
           two_factor_backup_codes = $1,
           two_factor_recovery_generated_at = NOW(),
           two_factor_failed_attempts = 0,
           two_factor_locked_until = NULL,
           two_factor_last_totp_hash = $3,
           two_factor_last_totp_at = NOW()
       WHERE id = $2`,
      [hashedCodes, operatorId, totpHash]
    )

    await logSecurityEvent({
      userId: operatorId, userType: 'operator', eventType: '2fa_enabled',
      ipAddress: clientIp, userAgent })
    twoFactorAuthTotal.inc({ outcome: 'success', method: 'totp' })

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, (SELECT display_name FROM operators WHERE id = $3))`,
      ['Two-factor authentication enabled', 'note', operatorId]
    )

    res.json({
      success: true,
      backupCodes: plainCodes })
})

//POST /api/auth/2fa/authenticate

router.post('/authenticate', twoFactorAuthLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
    const { tempToken, code, rememberDevice } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!tempToken || typeof tempToken !== 'string') {
      throw AppError.badRequest('Temporary login token is required.')
    }
    if (!code || typeof code !== 'string') {
      throw AppError.badRequest('Verification code is required.')
    }

    //Look up temp token
    const tokenHash = hashTempToken(tempToken)
    const tokenResult = await pool.query(
      `SELECT id, user_id, expires_at, consumed, ip_address, user_agent
       FROM two_factor_temp_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    )

    if (tokenResult.rows.length === 0) {
      throw AppError.unauthorized('Invalid or expired temporary token. Please log in again.')
    }

    const tempRecord = tokenResult.rows[0]

    //Check if already consumed
    if (tempRecord.consumed) {
      await logSecurityEvent({
        userId: tempRecord.user_id, userType: 'operator', eventType: '2fa_auth_failed',
        ipAddress: clientIp, userAgent, metadata: { reason: 'temp_token_reused' } })
      throw AppError.unauthorized('This temporary token has already been used. Please log in again.')
    }

    //Check expiry
    if (new Date(tempRecord.expires_at) < new Date()) {
      await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
      await logSecurityEvent({
        userId: tempRecord.user_id, userType: 'operator', eventType: '2fa_temp_token_expired',
        ipAddress: clientIp, userAgent })
      throw AppError.unauthorized('Temporary token has expired. Please log in again.')
    }

    //IP + User-Agent binding: reject if the request comes from a different origin
    if (tempRecord.ip_address && tempRecord.ip_address !== clientIp) {
      await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
      await logSecurityEvent({
        userId: tempRecord.user_id, userType: 'operator', eventType: '2fa_auth_failed',
        ipAddress: clientIp, userAgent,
        metadata: { reason: 'ip_mismatch', expected_ip: tempRecord.ip_address } })
      throw AppError.unauthorized('Session mismatch. Please log in again.')
    }
    if (tempRecord.user_agent && userAgent && tempRecord.user_agent !== userAgent) {
      await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
      await logSecurityEvent({
        userId: tempRecord.user_id, userType: 'operator', eventType: '2fa_auth_failed',
        ipAddress: clientIp, userAgent,
        metadata: { reason: 'user_agent_mismatch' } })
      throw AppError.unauthorized('Session mismatch. Please log in again.')
    }

    //Check brute-force lockout on the operator
    await enforce2FALockout(tempRecord.user_id)

    //Fetch operator
    const opResult = await pool.query(
      `SELECT id, email, display_name, role, department, avatar_url,
              two_factor_secret, two_factor_backup_codes, two_factor_enabled,
              two_factor_last_totp_hash, two_factor_last_totp_at
       FROM operators WHERE id = $1 AND deleted_at IS NULL`,
      [tempRecord.user_id]
    )
    if (opResult.rows.length === 0) {
      throw AppError.unauthorized('Account not found.')
    }

    const user = opResult.rows[0]
    if (!user.two_factor_enabled || !user.two_factor_secret) {
      throw AppError.badRequest('Two-factor authentication is not enabled for this account.')
    }

    //Determine if the code is a TOTP code (6 digits) or a backup code
    const isBackupCode = code.length > 6 || code.includes('-')
    let backupCodeUsed = false
    let backupCodesRemaining: number | null = null

    if (isBackupCode) {
      //Verify backup code
      const storedCodes: string[] = user.two_factor_backup_codes || []
      const matchIndex = verifyBackupCode(code, storedCodes)

      if (matchIndex === -1) {
        //Record failure + possible lockout
        const failure = await record2FAFailure(tempRecord.user_id, clientIp, userAgent, { method: 'backup_code' })
        twoFactorAuthTotal.inc({ outcome: 'failure', method: 'backup_code' })
        //Don't consume the temp token on failure -- let them retry until lockout
        if (failure.locked) {
          await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
          throw AppError.tooMany(`Account locked for ${failure.lockoutMinutes} minutes due to too many failed attempts.`)
        }
        throw AppError.unauthorized('Invalid code.')
      }

      //Atomic backup code removal: use array_remove on the specific hash
      const usedHash = storedCodes[matchIndex]
      const updateResult = await pool.query(
        `UPDATE operators
         SET two_factor_backup_codes = array_remove(two_factor_backup_codes, $1)
         WHERE id = $2
         RETURNING array_length(two_factor_backup_codes, 1) AS remaining`,
        [usedHash, user.id]
      )

      backupCodesRemaining = updateResult.rows[0]?.remaining ?? 0

      await logSecurityEvent({
        userId: user.id, userType: 'operator', eventType: '2fa_backup_code_used',
        ipAddress: clientIp, userAgent,
        metadata: { remaining_codes: backupCodesRemaining } })

      backupCodeUsed = true
    } else {
      //Verify TOTP code
      const secret = decrypt2FASecret(user.two_factor_secret)
      const isValid = verifyTOTP(code, secret)

      if (!isValid) {
        const failure = await record2FAFailure(tempRecord.user_id, clientIp, userAgent, { method: 'totp' })
        twoFactorAuthTotal.inc({ outcome: 'failure', method: 'totp' })
        if (failure.locked) {
          await pool.query('UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1', [tempRecord.id])
          throw AppError.tooMany(`Account locked for ${failure.lockoutMinutes} minutes due to too many failed attempts.`)
        }
        throw AppError.unauthorized('Invalid code.')
      }

      //TOTP replay protection: reject if same code was used in the current window
      const codeHash = hashTOTPCode(code)
      if (isTOTPReplay(codeHash, user.two_factor_last_totp_hash, user.two_factor_last_totp_at)) {
        await logSecurityEvent({
          userId: user.id, userType: 'operator', eventType: '2fa_auth_failed',
          ipAddress: clientIp, userAgent, metadata: { reason: 'totp_replay' } })
        throw AppError.unauthorized('This code has already been used. Please wait for a new code.')
      }

      //Record this TOTP code for replay protection
      await pool.query(
        'UPDATE operators SET two_factor_last_totp_hash = $1, two_factor_last_totp_at = NOW() WHERE id = $2',
        [codeHash, user.id]
      )
    }

    //Success -- consume temp token atomically (CAS to prevent race)
    const consumeResult = await pool.query(
      'UPDATE two_factor_temp_tokens SET consumed = true WHERE id = $1 AND consumed = false RETURNING id',
      [tempRecord.id]
    )
    if (consumeResult.rows.length === 0) {
      //Another request already consumed this token (race condition)
      throw AppError.unauthorized('This temporary token has already been used. Please log in again.')
    }

    //Reset failed attempts on success
    await reset2FAFailures(user.id)
    twoFactorAuthTotal.inc({ outcome: 'success', method: isBackupCode ? 'backup_code' : 'totp' })

    //Update last verified timestamp
    await pool.query(
      'UPDATE operators SET two_factor_last_verified_at = NOW(), last_login = NOW() WHERE id = $1',
      [user.id]
    )

    //Issue full JWT
    const token = generateToken({
      id: user.id, email: user.email,
      role: user.role, displayName: user.display_name,
      department: user.department })
    const refreshToken = generateRefreshToken({ id: user.id, role: user.role })

    await createSession({
      userId: user.id, userType: 'operator', refreshToken,
      ipAddress: clientIp, userAgent, ttlDays: 30 }).catch(() => {})

    await logSecurityEvent({
      userId: user.id, userType: 'operator', eventType: '2fa_auth_success',
      ipAddress: clientIp, userAgent,
      metadata: { method: isBackupCode ? 'backup_code' : 'totp' } })

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      ['Logged in to AEGIS Admin (2FA)', 'login', user.id, user.display_name]
    )

    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/auth' })

    //Trust device if requested (30-day remember-me)
    let deviceTrusted = false
    if (rememberDevice) {
      try {
        await trustDevice(user.id, userAgent || '', clientIp)
        deviceTrusted = true
      } catch {
        //Non-critical -- don't fail the login
      }
    }

    const responseData: Record<string, any> = {
      success: true,
      token,
      user: {
        id: user.id, email: user.email,
        displayName: user.display_name, role: user.role,
        avatarUrl: user.avatar_url, department: user.department },
      backupCodeUsed,
      deviceTrusted }

    //Generic warning without disclosing exact count
    if (backupCodeUsed) {
      responseData.backupCodeWarning = 'A recovery code was used. Consider regenerating your backup codes in Settings.'
      //Fire security alert for backup code usage
      alertBackupCodeUsed(user.id, backupCodesRemaining ?? 0, clientIp).catch(() => {})
    }

    res.json(responseData)
})

//POST /api/auth/2fa/disable

router.post('/disable', authMiddleware, twoFactorDisableLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
    const operatorId = req.user!.id
    const { password, code } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!password || typeof password !== 'string') {
      throw AppError.badRequest('Current password is required to disable 2FA.')
    }
    if (!code || typeof code !== 'string') {
      throw AppError.badRequest('A valid TOTP code or backup code is required to disable 2FA.')
    }

    //Check brute-force lockout
    await enforce2FALockout(operatorId)

    //Fetch operator
    const opResult = await pool.query(
      `SELECT id, password_hash, two_factor_enabled, two_factor_secret, two_factor_backup_codes,
              two_factor_last_totp_hash, two_factor_last_totp_at
       FROM operators WHERE id = $1`,
      [operatorId]
    )
    if (opResult.rows.length === 0) {
      throw AppError.notFound('Operator not found.')
    }

    const op = opResult.rows[0]

    if (!op.two_factor_enabled) {
      throw AppError.badRequest('Two-factor authentication is not currently enabled.')
    }

    //Verify password
    const passwordValid = await bcrypt.compare(password, op.password_hash)
    if (!passwordValid) {
      await record2FAFailure(operatorId, clientIp, userAgent, { action: 'disable', reason: 'wrong_password' })
      throw AppError.unauthorized('Invalid password.')
    }

    //Verify second factor (TOTP or backup code)
    const isBackupCode = code.length > 6 || code.includes('-')
    let secondFactorValid = false

    if (isBackupCode) {
      const storedCodes: string[] = op.two_factor_backup_codes || []
      const matchIndex = verifyBackupCode(code, storedCodes)
      secondFactorValid = matchIndex !== -1
    } else {
      const secret = decrypt2FASecret(op.two_factor_secret)
      secondFactorValid = verifyTOTP(code, secret)

      //Check replay
      if (secondFactorValid) {
        const codeHash = hashTOTPCode(code)
        if (isTOTPReplay(codeHash, op.two_factor_last_totp_hash, op.two_factor_last_totp_at)) {
          secondFactorValid = false
        }
      }
    }

    if (!secondFactorValid) {
      await record2FAFailure(operatorId, clientIp, userAgent, { action: 'disable', reason: 'wrong_code' })
      throw AppError.unauthorized('Invalid verification code.')
    }

    //Reset failures on success
    await reset2FAFailures(operatorId)

    //Disable 2FA -- clear all 2FA data
    await pool.query(
      `UPDATE operators
       SET two_factor_enabled = false,
           two_factor_secret = NULL,
           two_factor_backup_codes = NULL,
           two_factor_enabled_at = NULL,
           two_factor_last_verified_at = NULL,
           two_factor_recovery_generated_at = NULL,
           two_factor_failed_attempts = 0,
           two_factor_locked_until = NULL,
           two_factor_last_totp_hash = NULL,
           two_factor_last_totp_at = NULL
       WHERE id = $1`,
      [operatorId]
    )

    await logSecurityEvent({
      userId: operatorId, userType: 'operator', eventType: '2fa_disabled',
      ipAddress: clientIp, userAgent })

    //Fire security alert -- 2FA disabled is a critical event
    alert2FADisabled(operatorId, clientIp).catch(() => {})

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, (SELECT display_name FROM operators WHERE id = $3))`,
      ['Two-factor authentication disabled', 'note', operatorId]
    )

    res.json({ success: true, message: 'Two-factor authentication has been disabled.' })
})

//POST /api/auth/2fa/regenerate-backup-codes

router.post('/regenerate-backup-codes', authMiddleware, twoFactorRegenLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
    const operatorId = req.user!.id
    const { password, code } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!password || typeof password !== 'string') {
      throw AppError.badRequest('Current password is required.')
    }
    if (!code || typeof code !== 'string' || code.length !== 6) {
      throw AppError.badRequest('A valid 6-digit TOTP code is required.')
    }

    //Check brute-force lockout
    await enforce2FALockout(operatorId)

    //Fetch operator
    const opResult = await pool.query(
      `SELECT id, password_hash, two_factor_enabled, two_factor_secret,
              two_factor_last_totp_hash, two_factor_last_totp_at
       FROM operators WHERE id = $1`,
      [operatorId]
    )
    if (opResult.rows.length === 0) {
      throw AppError.notFound('Operator not found.')
    }

    const op = opResult.rows[0]

    if (!op.two_factor_enabled) {
      throw AppError.badRequest('Two-factor authentication is not enabled.')
    }

    //Verify password
    const passwordValid = await bcrypt.compare(password, op.password_hash)
    if (!passwordValid) {
      await record2FAFailure(operatorId, clientIp, userAgent, { action: 'regenerate', reason: 'wrong_password' })
      throw AppError.unauthorized('Invalid password.')
    }

    //Verify TOTP code
    const secret = decrypt2FASecret(op.two_factor_secret)
    const isValid = verifyTOTP(code, secret)
    if (!isValid) {
      await record2FAFailure(operatorId, clientIp, userAgent, { action: 'regenerate', reason: 'wrong_code' })
      throw AppError.unauthorized('Invalid verification code.')
    }

    //Check replay
    const codeHash = hashTOTPCode(code)
    if (isTOTPReplay(codeHash, op.two_factor_last_totp_hash, op.two_factor_last_totp_at)) {
      throw AppError.unauthorized('This code has already been used. Please wait for a new code.')
    }

    //Reset failures and record TOTP for replay protection
    await reset2FAFailures(operatorId)
    await pool.query(
      'UPDATE operators SET two_factor_last_totp_hash = $1, two_factor_last_totp_at = NOW() WHERE id = $2',
      [codeHash, operatorId]
    )

    //Generate new backup codes (old ones are completely replaced)
    const { plainCodes, hashedCodes } = generateBackupCodes()

    await pool.query(
      `UPDATE operators
       SET two_factor_backup_codes = $1,
           two_factor_recovery_generated_at = NOW()
       WHERE id = $2`,
      [hashedCodes, operatorId]
    )

    await logSecurityEvent({
      userId: operatorId, userType: 'operator', eventType: '2fa_backup_codes_regenerated',
      ipAddress: clientIp, userAgent })

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, (SELECT display_name FROM operators WHERE id = $3))`,
      ['Backup recovery codes regenerated', 'note', operatorId]
    )

    res.json({
      success: true,
      backupCodes: plainCodes })
})

export default router
