/*
 * citizenAuthRoutes.ts - Citizen Authentication API
 *
 * Handles all citizen-facing auth endpoints:
 *   POST /api/citizen-auth/register      - Create citizen account
 *   POST /api/citizen-auth/login         - Authenticate citizen
 *   GET  /api/citizen-auth/me            - Get current citizen profile
 *   PUT  /api/citizen-auth/profile       - Update citizen profile
 *   PUT  /api/citizen-auth/preferences   - Update notification/audio/caption prefs
 *   GET  /api/citizen-auth/preferences   - Get preferences
 *   POST /api/citizen-auth/emergency-contacts    - Add emergency contact
 *   GET  /api/citizen-auth/emergency-contacts     - List emergency contacts
 *   DELETE /api/citizen-auth/emergency-contacts/:id - Remove emergency contact
 *
 * Separate from operator auth — citizens have their own table and JWT tokens
 * with role='citizen' to distinguish from operator tokens.
 */

import { Router, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, generateToken, generateRefreshToken, verifyRefreshToken, AuthRequest, createSession, validateSession, rotateRefreshToken, revokeAllSessions } from '../middleware/auth.js'
import { uploadAvatar, validateMagicBytes } from '../middleware/upload.js'
import {
  validatePasswordStrength, hashToken, generateSecureToken, timingSafeCompare,
  checkLockout, recordFailedLogin, resetFailedLogins, recordPasswordHistory,
  isPasswordReused, getClientIp, LOCKOUT_DURATION_MINUTES,
} from '../utils/securityUtils.js'
import { sendVerificationEmail, sendLockoutNotification, sendPasswordResetEmail } from '../services/emailService.js'
import { logSecurityEvent, checkSuspiciousActivity } from '../services/securityLogger.js'
import { generateTempToken, hashTempToken } from '../utils/twoFactorCrypto.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()

// Rate limiter for login attempts (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 login attempts per hour
  message: { error: 'Too many login attempts. Please try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate limiter for registration (anti-bot)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10, // max 10 registrations per hour per IP
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate limiter for password reset requests
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5, // max 5 reset requests per hour per IP
  message: { error: 'Too many reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate limiter for password change
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 attempts per 15 min
  message: { error: 'Too many password change attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Input length limits
const MAX_DISPLAY_NAME = 100
const MAX_BIO = 500
const MAX_ADDRESS = 200
const MAX_PHONE = 30
const MAX_CITY = 100

// POST /register — Create a new citizen account
router.post('/register', registerLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, displayName, phone, preferredRegion,
            isVulnerable, vulnerabilityDetails, country, city, dateOfBirth,
            bio, addressLine } = req.body

    // Honeypot — invisible field filled by bots, real users leave it empty
    if (req.body.website || req.body.url || req.body.fax) {
      // Silently reject without revealing why (looks like success to bots)
      res.status(201).json({ message: 'Registration successful! Please check your email to verify your account.' })
      return
    }

    if (!email || !password || !displayName) {
      throw AppError.badRequest('Email, password, and display name are required.')
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      throw AppError.badRequest('Please enter a valid email address.')
    }

    // Input length validation
    if (typeof displayName === 'string' && displayName.length > MAX_DISPLAY_NAME) {
      throw AppError.badRequest(`Display name must be ${MAX_DISPLAY_NAME} characters or less.`)
    }
    if (typeof bio === 'string' && bio.length > MAX_BIO) {
      throw AppError.badRequest(`Bio must be ${MAX_BIO} characters or less.`)
    }
    if (typeof addressLine === 'string' && addressLine.length > MAX_ADDRESS) {
      throw AppError.badRequest(`Address must be ${MAX_ADDRESS} characters or less.`)
    }
    if (typeof phone === 'string' && phone.length > MAX_PHONE) {
      throw AppError.badRequest(`Phone must be ${MAX_PHONE} characters or less.`)
    }

    // Password strength — enterprise policy (12 chars, uppercase, lowercase, digit, special)
    const pwResult = validatePasswordStrength(password, email)
    if (!pwResult.valid) {
      res.status(400).json({ error: pwResult.errors[0] })
      return
    }

    // Check if email already registered (case-insensitive)
    const normalizedEmail = email.trim().toLowerCase()
    const exists = await pool.query(
      'SELECT id FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [normalizedEmail]
    )
    if (exists.rows.length > 0) {
      throw AppError.conflict('An account with this email already exists.')
    }

    // Check if phone already registered (if provided)
    if (phone) {
      const phoneExists = await pool.query(
        'SELECT id FROM citizens WHERE phone = $1 AND deleted_at IS NULL',
        [String(phone).trim()]
      )
      if (phoneExists.rows.length > 0) {
        throw AppError.conflict('An account with this phone number already exists.')
      }
    }

    // Hash password with bcrypt (12 rounds)
    const passwordHash = await bcrypt.hash(password, 12)

    // Generate email verification token (store HASH, send raw)
    const rawVerificationToken = generateSecureToken()
    const verificationTokenHash = hashToken(rawVerificationToken)
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Insert citizen with all new fields (email stored lowercase)
    const result = await pool.query(
      `INSERT INTO citizens (email, password_hash, display_name, phone, preferred_region,
                             verification_token_hash, verification_expires,
                             is_vulnerable, vulnerability_details,
                             country, city, date_of_birth, bio, address_line,
                             password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       RETURNING id, email, display_name, role, preferred_region, email_verified,
                 is_vulnerable, country, city, bio, address_line, created_at`,
      [normalizedEmail, passwordHash, displayName, phone || null, preferredRegion || null,
       verificationTokenHash, verificationExpires,
       isVulnerable || false, vulnerabilityDetails || null,
       country || null, city || null, dateOfBirth || null,
       bio || null, addressLine || null]
    )

    const citizen = result.rows[0]

    // Create default preferences
    await pool.query(
      `INSERT INTO citizen_preferences (citizen_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [citizen.id]
    )

    // Record initial password in history (prevents immediate reuse)
    await recordPasswordHistory(citizen.id, 'citizen', passwordHash)

    // Send verification email (dev mode: logged to console + dev_emails table)
    try {
      await sendVerificationEmail(normalizedEmail, rawVerificationToken, 'citizen')
    } catch (emailErr: any) {
      logger.error({ err: emailErr }, '[CitizenAuth] Failed to send verification email')
    }

    // Log registration event
    const clientIp = getClientIp(req)
    await logSecurityEvent({
      userId: citizen.id, userType: 'citizen', eventType: 'register',
      ipAddress: clientIp, userAgent: req.headers['user-agent'] as string,
      metadata: { email: normalizedEmail },
    })

    // Generate JWT with citizen role
    const token = generateToken({
      id: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
    })
    const refreshToken = generateRefreshToken({ id: citizen.id, role: citizen.role || 'citizen' })

    // Create session record for the refresh token
    await createSession({
      userId: citizen.id, userType: 'citizen', refreshToken,
      ipAddress: clientIp, userAgent: req.headers['user-agent'] as string,
      ttlDays: 7,
    }).catch(() => {}) // Don't fail registration on session creation error

    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/citizen-auth',
    })

    res.status(201).json({
      token,
      user: {
        id: citizen.id,
        email: citizen.email,
        displayName: citizen.display_name,
        role: citizen.role || 'citizen',
        preferredRegion: citizen.preferred_region,
        emailVerified: citizen.email_verified,
        isVulnerable: citizen.is_vulnerable,
        country: citizen.country,
        city: citizen.city,
        bio: citizen.bio,
        addressLine: citizen.address_line,
        createdAt: citizen.created_at,
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /check-availability — Check if email or phone is already registered
router.post('/check-availability', registerLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, phone } = req.body
    const result: Record<string, boolean> = {}

    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (emailRegex.test(normalizedEmail)) {
        const exists = await pool.query(
          'SELECT id FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
          [normalizedEmail]
        )
        result.emailAvailable = exists.rows.length === 0
      }
    }

    if (phone) {
      const normalizedPhone = String(phone).trim()
      if (normalizedPhone.length >= 6) {
        const exists = await pool.query(
          'SELECT id FROM citizens WHERE phone = $1 AND deleted_at IS NULL',
          [normalizedPhone]
        )
        result.phoneAvailable = exists.rows.length === 0
      }
    }

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /login — Authenticate citizen
router.post('/login', loginLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body
    const clientIp = getClientIp(req)
    const userAgent = req.headers['user-agent'] as string

    if (!email || !password) {
      throw AppError.badRequest('Email and password are required.')
    }

    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, role, avatar_url,
              preferred_region, email_verified, is_active, phone, location_lat, location_lng,
              is_vulnerable, vulnerability_details, country, city, bio, date_of_birth,
              deletion_requested_at, failed_login_attempts, locked_until, two_factor_enabled
       FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [email.trim()]
    )

    if (result.rows.length === 0) {
      // Log failed attempt (no user found — don't reveal this)
      await logSecurityEvent({ eventType: 'login_failed', ipAddress: clientIp, userAgent, metadata: { reason: 'unknown_email' } })
      throw AppError.unauthorized('Invalid email or password.')
    }

    const citizen = result.rows[0]

    // Check account lockout
    const lockoutStatus = checkLockout(citizen.failed_login_attempts, citizen.locked_until)
    if (lockoutStatus.locked) {
      await logSecurityEvent({
        userId: citizen.id, userType: 'citizen', eventType: 'login_failed',
        ipAddress: clientIp, userAgent, metadata: { reason: 'account_locked', remaining_minutes: lockoutStatus.remainingMinutes },
      })
      res.status(423).json({
        error: `Account is temporarily locked due to too many failed attempts. Try again in ${lockoutStatus.remainingMinutes} minute(s).`,
        code: 'ACCOUNT_LOCKED',
        retryAfterMinutes: lockoutStatus.remainingMinutes,
      })
      return
    }

    if (!citizen.is_active) {
      throw AppError.forbidden('Account is deactivated. Contact support.')
    }

    const valid = await bcrypt.compare(password, citizen.password_hash)
    if (!valid) {
      // Record failed attempt + possibly lock the account
      const newLockout = await recordFailedLogin('citizens', citizen.id)

      await logSecurityEvent({
        userId: citizen.id, userType: 'citizen', eventType: 'login_failed',
        ipAddress: clientIp, userAgent, metadata: { attempts: newLockout.attempts },
      })

      // Check for suspicious activity patterns
      await checkSuspiciousActivity(citizen.id, 'citizen', clientIp)

      if (newLockout.locked) {
        await logSecurityEvent({
          userId: citizen.id, userType: 'citizen', eventType: 'account_locked',
          ipAddress: clientIp, userAgent, metadata: { duration_minutes: LOCKOUT_DURATION_MINUTES },
        })
        // Send lockout notification email
        sendLockoutNotification(citizen.email, LOCKOUT_DURATION_MINUTES).catch(() => {})
        res.status(423).json({
          error: `Account locked for ${LOCKOUT_DURATION_MINUTES} minutes due to too many failed attempts.`,
          code: 'ACCOUNT_LOCKED',
          retryAfterMinutes: LOCKOUT_DURATION_MINUTES,
        })
        return
      }

      throw AppError.unauthorized('Invalid email or password.')
    }

    // Successful login — reset failed attempts
    await resetFailedLogins('citizens', citizen.id)

    // 2FA Gate — if citizen has 2FA enabled, issue temp token instead of full JWT
    if (citizen.two_factor_enabled) {
      const tempTokenRaw = generateTempToken()
      const tempTokenHash = hashTempToken(tempTokenRaw)
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

      // Invalidate old temp tokens and create new one
      await pool.query(
        `UPDATE two_factor_temp_tokens SET consumed = true WHERE user_id = $1 AND user_type = 'citizen' AND consumed = false`,
        [citizen.id]
      )
      await pool.query(
        `INSERT INTO two_factor_temp_tokens (user_id, token_hash, expires_at, ip_address, user_agent, user_type)
         VALUES ($1, $2, $3, $4, $5, 'citizen')`,
        [citizen.id, tempTokenHash, expiresAt, clientIp, userAgent || null]
      )

      await logSecurityEvent({
        userId: citizen.id, userType: 'citizen', eventType: 'login_success',
        ipAddress: clientIp, userAgent, metadata: { requires_2fa: true },
      })

      res.json({ requires2FA: true, tempToken: tempTokenRaw })
      return
    }

    // Update last login and increment login count
    const loginUpdate = await pool.query(
      'UPDATE citizens SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1 RETURNING login_count, last_login, created_at',
      [citizen.id]
    )
    const loginMeta = loginUpdate.rows[0]

    // Auto-cancel pending deletion if user logs back in (grace period)
    let deletionCancelled = false
    if (citizen.deletion_requested_at) {
      await pool.query(
        `UPDATE citizens SET deletion_requested_at = NULL, deletion_scheduled_at = NULL WHERE id = $1`,
        [citizen.id]
      )
      await pool.query(
        `INSERT INTO account_deletion_log (citizen_id, citizen_email, citizen_name, action)
         VALUES ($1, $2, $3, 'deletion_auto_cancelled_login')`,
        [citizen.id, citizen.email, citizen.display_name]
      ).catch(() => {})
      deletionCancelled = true
    }

    const token = generateToken({
      id: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
    })
    const refreshToken = generateRefreshToken({ id: citizen.id, role: citizen.role || 'citizen' })

    // Create session in DB for refresh token tracking
    await createSession({
      userId: citizen.id, userType: 'citizen', refreshToken,
      ipAddress: clientIp, userAgent, ttlDays: 7,
    }).catch(() => {})

    // Log successful login
    await logSecurityEvent({
      userId: citizen.id, userType: 'citizen', eventType: 'login_success',
      ipAddress: clientIp, userAgent,
    })

    res.cookie('aegis_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/citizen-auth',
    })

    // Fetch preferences
    const prefsResult = await pool.query(
      'SELECT * FROM citizen_preferences WHERE citizen_id = $1',
      [citizen.id]
    )

    res.json({
      token,
      deletionCancelled,
      user: {
        id: citizen.id,
        email: citizen.email,
        displayName: citizen.display_name,
        role: citizen.role || 'citizen',
        avatarUrl: citizen.avatar_url,
        phone: citizen.phone,
        preferredRegion: citizen.preferred_region,
        emailVerified: citizen.email_verified,
        locationLat: citizen.location_lat,
        locationLng: citizen.location_lng,
        isVulnerable: citizen.is_vulnerable,
        vulnerabilityDetails: citizen.vulnerability_details,
        country: citizen.country,
        city: citizen.city,
        bio: citizen.bio,
        dateOfBirth: citizen.date_of_birth,
        loginCount: loginMeta.login_count,
        lastLogin: loginMeta.last_login,
        createdAt: loginMeta.created_at,
      },
      preferences: prefsResult.rows[0] || null,
    })
  } catch (err) {
    next(err)
  }
})

// GET /me — Get current citizen profile (protected)
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role, avatar_url, phone,
              preferred_region, email_verified, location_lat, location_lng,
              is_vulnerable, vulnerability_details, country, city, bio, date_of_birth,
              login_count, last_login, created_at
       FROM citizens WHERE id = $1 AND deleted_at IS NULL`,
      [req.user!.id]
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Citizen account not found.')
    }

    const citizen = result.rows[0]

    // Fetch preferences
    const prefsResult = await pool.query(
      'SELECT * FROM citizen_preferences WHERE citizen_id = $1',
      [citizen.id]
    )

    // Fetch emergency contacts
    const contactsResult = await pool.query(
      'SELECT * FROM emergency_contacts WHERE citizen_id = $1 ORDER BY is_primary DESC, created_at ASC',
      [citizen.id]
    )

    // Fetch recent safety check-ins
    const safetyResult = await pool.query(
      'SELECT * FROM safety_check_ins WHERE citizen_id = $1 ORDER BY created_at DESC LIMIT 5',
      [citizen.id]
    )

    // Count unread messages
    const unreadResult = await pool.query(
      `SELECT COALESCE(SUM(citizen_unread), 0) as unread_count
       FROM message_threads WHERE citizen_id = $1 AND status != 'closed'`,
      [citizen.id]
    )

    res.json({
      user: {
        id: citizen.id,
        email: citizen.email,
        displayName: citizen.display_name,
        role: citizen.role,
        avatarUrl: citizen.avatar_url,
        phone: citizen.phone,
        preferredRegion: citizen.preferred_region,
        emailVerified: citizen.email_verified,
        locationLat: citizen.location_lat,
        locationLng: citizen.location_lng,
        isVulnerable: citizen.is_vulnerable,
        vulnerabilityDetails: citizen.vulnerability_details,
        country: citizen.country,
        city: citizen.city,
        bio: citizen.bio,
        dateOfBirth: citizen.date_of_birth,
        loginCount: citizen.login_count,
        lastLogin: citizen.last_login,
        createdAt: citizen.created_at,
      },
      preferences: prefsResult.rows[0] || null,
      emergencyContacts: contactsResult.rows,
      recentSafetyCheckIns: safetyResult.rows,
      unreadMessages: parseInt(unreadResult.rows[0]?.unread_count || '0'),
    })
  } catch (err) {
    next(err)
  }
})

// PUT /profile — Update citizen profile (protected)
router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { displayName, phone, preferredRegion, locationLat, locationLng,
            bio, country, city, addressLine, isVulnerable, vulnerabilityDetails, dateOfBirth } = req.body

    // Use explicit null to clear a field, undefined to keep existing
    // JSON sends null for cleared fields; COALESCE would prevent clearing
    const setClauses: string[] = []
    const params: any[] = [req.user!.id]
    let idx = 2
    const fields: [string, any, string][] = [
      ['display_name', displayName, 'displayName'],
      ['phone', phone, 'phone'],
      ['preferred_region', preferredRegion, 'preferredRegion'],
      ['location_lat', locationLat, 'locationLat'],
      ['location_lng', locationLng, 'locationLng'],
      ['bio', bio, 'bio'],
      ['country', country, 'country'],
      ['city', city, 'city'],
      ['address_line', addressLine, 'addressLine'],
      ['is_vulnerable', isVulnerable, 'isVulnerable'],
      ['vulnerability_details', vulnerabilityDetails, 'vulnerabilityDetails'],
      ['date_of_birth', dateOfBirth, 'dateOfBirth'],
    ]
    for (const [col, val, _key] of fields) {
      if (val !== undefined) {
        setClauses.push(`${col} = $${idx++}`)
        params.push(val)
      }
    }
    if (setClauses.length === 0) {
      throw AppError.badRequest('No fields to update.')
    }

    const result = await pool.query(
      `UPDATE citizens 
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, email, display_name, role, avatar_url, phone, preferred_region,
                 location_lat, location_lng, bio, country, city, address_line,
                 is_vulnerable, vulnerability_details, date_of_birth, email_verified`,
      params
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Account not found.')
    }

    const c = result.rows[0]
    res.json({
      user: {
        id: c.id,
        email: c.email,
        displayName: c.display_name,
        role: c.role,
        avatarUrl: c.avatar_url,
        phone: c.phone,
        preferredRegion: c.preferred_region,
        locationLat: c.location_lat,
        locationLng: c.location_lng,
        bio: c.bio,
        country: c.country,
        city: c.city,
        addressLine: c.address_line,
        isVulnerable: c.is_vulnerable,
        vulnerabilityDetails: c.vulnerability_details,
        dateOfBirth: c.date_of_birth,
        emailVerified: c.email_verified,
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /avatar — Upload profile photo (protected)
router.post('/avatar', authMiddleware, uploadAvatar, validateMagicBytes, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      throw AppError.badRequest('No image file provided. Accepted: JPG, PNG, GIF, WebP (max 2MB).')
    }

    const avatarUrl = `/uploads/${req.file.filename}`

    await pool.query(
      'UPDATE citizens SET avatar_url = $1 WHERE id = $2 AND deleted_at IS NULL',
      [avatarUrl, req.user!.id]
    )

    res.json({ avatarUrl })
  } catch (err) {
    next(err)
  }
})

// GET /preferences — Get citizen preferences (protected)
router.get('/preferences', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM citizen_preferences WHERE citizen_id = $1',
      [req.user!.id]
    )
    res.json(result.rows[0] || {})
  } catch (err) {
    next(err)
  }
})

// PUT /preferences — Update citizen preferences (protected)
router.put('/preferences', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      audioAlertsEnabled, audioVoice, audioVolume, autoPlayCritical,
      captionsEnabled, captionFontSize, captionPosition,
      notificationChannels, severityFilter,
      quietHoursStart, quietHoursEnd,
      language, darkMode, compactView,
    } = req.body

    const resolvedAudioAlertsEnabled = audioAlertsEnabled ?? true
    const resolvedAudioVoice = audioVoice ?? 'default'
    const parsedAudioVolume = typeof audioVolume === 'number'
      ? audioVolume
      : Number(audioVolume)
    const normalizedAudioVolume = Number.isFinite(parsedAudioVolume)
      ? (parsedAudioVolume > 1 ? parsedAudioVolume / 100 : parsedAudioVolume)
      : 0.8
    const resolvedAudioVolume = Math.max(0, Math.min(1, normalizedAudioVolume))
    const resolvedAutoPlayCritical = autoPlayCritical ?? true
    const resolvedCaptionsEnabled = captionsEnabled ?? false
    const resolvedCaptionFontSize = captionFontSize ?? 'medium'
    const resolvedCaptionPosition = captionPosition ?? 'bottom'
    const resolvedNotificationChannels = Array.isArray(notificationChannels) && notificationChannels.length > 0
      ? notificationChannels
      : ['web']
    const resolvedSeverityFilter = Array.isArray(severityFilter) && severityFilter.length > 0
      ? severityFilter
      : ['critical', 'warning', 'info']
    const resolvedLanguage = language ?? 'en'
    const resolvedDarkMode = darkMode ?? false
    const resolvedCompactView = compactView ?? false

    const result = await pool.query(
      `INSERT INTO citizen_preferences (
        citizen_id, audio_alerts_enabled, audio_voice, audio_volume, auto_play_critical,
        captions_enabled, caption_font_size, caption_position,
        notification_channels, severity_filter, quiet_hours_start, quiet_hours_end,
        language, dark_mode, compact_view
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (citizen_id) DO UPDATE SET
        audio_alerts_enabled = COALESCE($2, citizen_preferences.audio_alerts_enabled),
        audio_voice = COALESCE($3, citizen_preferences.audio_voice),
        audio_volume = COALESCE($4, citizen_preferences.audio_volume),
        auto_play_critical = COALESCE($5, citizen_preferences.auto_play_critical),
        captions_enabled = COALESCE($6, citizen_preferences.captions_enabled),
        caption_font_size = COALESCE($7, citizen_preferences.caption_font_size),
        caption_position = COALESCE($8, citizen_preferences.caption_position),
        notification_channels = COALESCE($9, citizen_preferences.notification_channels),
        severity_filter = COALESCE($10, citizen_preferences.severity_filter),
        quiet_hours_start = $11,
        quiet_hours_end = $12,
        language = COALESCE($13, citizen_preferences.language),
        dark_mode = COALESCE($14, citizen_preferences.dark_mode),
        compact_view = COALESCE($15, citizen_preferences.compact_view)
      RETURNING *`,
      [
        req.user!.id,
        resolvedAudioAlertsEnabled, resolvedAudioVoice, resolvedAudioVolume, resolvedAutoPlayCritical,
        resolvedCaptionsEnabled, resolvedCaptionFontSize, resolvedCaptionPosition,
        resolvedNotificationChannels, resolvedSeverityFilter, quietHoursStart || null, quietHoursEnd || null,
        resolvedLanguage, resolvedDarkMode, resolvedCompactView,
      ]
    )

    res.json(result.rows[0])
  } catch (err) {
    next(err)
  }
})

// Emergency Contacts CRUD
router.get('/emergency-contacts', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM emergency_contacts WHERE citizen_id = $1 ORDER BY is_primary DESC, created_at ASC',
      [req.user!.id]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

router.post('/emergency-contacts', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, phone, relationship, isPrimary, notifyOnHelp } = req.body

    if (!name || !phone) {
      throw AppError.badRequest('Name and phone are required.')
    }

    // Max 5 contacts per citizen
    const countResult = await pool.query(
      'SELECT COUNT(*) as cnt FROM emergency_contacts WHERE citizen_id = $1',
      [req.user!.id]
    )
    if (parseInt(countResult.rows[0].cnt) >= 5) {
      throw AppError.badRequest('Maximum 5 emergency contacts allowed.')
    }

    // If setting as primary, un-primary others
    if (isPrimary) {
      await pool.query(
        'UPDATE emergency_contacts SET is_primary = false WHERE citizen_id = $1',
        [req.user!.id]
      )
    }

    const result = await pool.query(
      `INSERT INTO emergency_contacts (citizen_id, name, phone, relationship, is_primary, notify_on_help)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user!.id, name, phone, relationship || null, isPrimary || false, notifyOnHelp !== false]
    )

    res.status(201).json(result.rows[0])
  } catch (err) {
    next(err)
  }
})

router.delete('/emergency-contacts/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND citizen_id = $2 RETURNING id',
      [req.params.id, req.user!.id]
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Contact not found.')
    }

    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

// POST /change-password — Change citizen password (protected)
router.post('/change-password', authMiddleware, changePasswordLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      throw AppError.badRequest('Current and new passwords are required.')
    }

    // Enterprise password policy
    const pwResult = validatePasswordStrength(newPassword, req.user!.email)
    if (!pwResult.valid) {
      res.status(400).json({ error: pwResult.errors[0] })
      return
    }

    const userResult = await pool.query(
      'SELECT password_hash FROM citizens WHERE id = $1 AND deleted_at IS NULL',
      [req.user!.id]
    )

    if (userResult.rows.length === 0) {
      throw AppError.notFound('Account not found.')
    }

    const valid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash)
    if (!valid) {
      throw AppError.unauthorized('Current password is incorrect.')
    }

    // Check password history (prevent reuse of last 5 passwords)
    const reused = await isPasswordReused(newPassword, req.user!.id, 'citizen')
    if (reused) {
      throw AppError.badRequest('You cannot reuse any of your last 5 passwords. Please choose a different password.')
    }

    const newHash = await bcrypt.hash(newPassword, 12)
    await pool.query(
      'UPDATE citizens SET password_hash = $1, password_changed_at = NOW() WHERE id = $2',
      [newHash, req.user!.id]
    )

    // Record in password history
    await recordPasswordHistory(req.user!.id, 'citizen', newHash)

    // Revoke all other sessions (force re-login on other devices)
    await revokeAllSessions(req.user!.id, 'password_changed')

    // Log the event
    const clientIp = getClientIp(req)
    await logSecurityEvent({
      userId: req.user!.id, userType: 'citizen', eventType: 'password_changed',
      ipAddress: clientIp, userAgent: req.headers['user-agent'] as string,
    })

    res.json({ success: true, message: 'Password changed successfully. All other sessions have been signed out.' })
  } catch (err) {
    next(err)
  }
})

// POST /forgot-password — Request a password reset token
router.post('/forgot-password', resetLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body

    if (!email) {
      throw AppError.badRequest('Email is required.')
    }

    const result = await pool.query(
      'SELECT id, email, display_name FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [email.trim()]
    )

    if (result.rows.length === 0) {
      // Don't reveal whether the email exists — always return success
      res.json({ success: true, message: 'If an account with that email exists, a password reset link has been generated.' })
      return
    }

    const citizen = result.rows[0]

    // Generate reset token (valid for 1 hour)
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Store the HASH — never store the raw token
    await pool.query(
      'UPDATE citizens SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [tokenHash, resetExpires, citizen.id]
    )

    // In production, send email with the raw (unhashed) token via emailService.
    try {
      await sendPasswordResetEmail(citizen.email, rawToken, 'citizen')
    } catch (emailErr: any) {
      logger.error({ err: emailErr }, '[CitizenAuth] Failed to send reset email')
    }

    // Log the event
    await logSecurityEvent({
      userId: citizen.id, userType: 'citizen', eventType: 'password_reset_requested',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been generated.',
    })
  } catch (err) {
    next(err)
  }
})

// POST /reset-password — Reset password using a token
router.post('/reset-password', resetLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token, newPassword } = req.body

    if (!token || !newPassword) {
      throw AppError.badRequest('Reset token and new password are required.')
    }

    if (newPassword.length < 12) {
      throw AppError.badRequest('New password must be at least 12 characters.')
    }
    const pwResult = validatePasswordStrength(newPassword)
    if (!pwResult.valid) {
      res.status(400).json({ error: pwResult.errors[0] })
      return
    }

    // Hash the submitted token with SHA-256 to compare against the stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const result = await pool.query(
      `SELECT id, email, reset_token FROM citizens
       WHERE reset_token IS NOT NULL AND reset_token_expires > NOW() AND deleted_at IS NULL
       AND reset_token = $1`,
      [tokenHash]
    )

    if (result.rows.length === 0) {
      throw AppError.badRequest('Invalid or expired reset token. Please request a new one.')
    }

    // Timing-safe comparison as defense-in-depth (DB already matched by hash)
    const storedHash = Buffer.from(result.rows[0].reset_token, 'hex')
    const submittedHash = Buffer.from(tokenHash, 'hex')
    if (storedHash.length !== submittedHash.length || !crypto.timingSafeEqual(storedHash, submittedHash)) {
      throw AppError.badRequest('Invalid or expired reset token. Please request a new one.')
    }

    const citizen = { id: result.rows[0].id, email: result.rows[0].email }
    const newHash = await bcrypt.hash(newPassword, 12)

    await pool.query(
      'UPDATE citizens SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, password_changed_at = NOW() WHERE id = $2',
      [newHash, citizen.id]
    )

    // Record in password history & revoke all sessions
    await recordPasswordHistory(citizen.id, 'citizen', newHash)
    await revokeAllSessions(citizen.id, 'password_reset')

    await logSecurityEvent({
      userId: citizen.id, userType: 'citizen', eventType: 'password_reset_completed',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    logger.info({ email: citizen.email }, '[CitizenAuth] Password reset successful')

    res.json({ success: true, message: 'Password has been reset successfully. You can now sign in.' })
  } catch (err) {
    next(err)
  }
})

// POST /refresh — Get new access token using refresh token cookie (#24)
router.post('/refresh', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshCookie = req.cookies?.aegis_refresh
    if (!refreshCookie) {
      throw AppError.unauthorized('No refresh token.')
    }

    const decoded = verifyRefreshToken(refreshCookie)

    // Validate session exists and is not revoked
    const session = await validateSession(refreshCookie)
    if (!session) {
      res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
      throw AppError.unauthorized('Session expired or revoked. Please log in again.')
    }

    // Verify citizen still exists and is not deleted
    const result = await pool.query(
      'SELECT id, email, display_name, role, deletion_scheduled_at FROM citizens WHERE id = $1',
      [decoded.id]
    )
    if (result.rows.length === 0) {
      res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
      throw AppError.unauthorized('Account not found.')
    }
    const citizen = result.rows[0]
    if (citizen.deletion_scheduled_at && new Date(citizen.deletion_scheduled_at) < new Date()) {
      res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
      throw AppError.unauthorized('Account has been deleted.')
    }

    const newToken = generateToken({
      id: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
    })

    // Rotate refresh token (revoke old, issue new)
    const newRefreshToken = generateRefreshToken({ id: citizen.id, role: citizen.role || 'citizen' })
    const clientIp = getClientIp(req)
    await rotateRefreshToken({
      oldToken: refreshCookie, newToken: newRefreshToken,
      userId: citizen.id, userType: 'citizen',
      ipAddress: clientIp, userAgent: req.headers['user-agent'] as string,
      ttlDays: 7,
    }).catch(() => {})

    res.cookie('aegis_refresh', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/citizen-auth',
    })

    res.json({ token: newToken })
  } catch {
    res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
    res.status(401).json({ error: 'Invalid or expired refresh token.' })
  }
})

// POST /logout — Server-side logout: clear refresh cookie (#25)
router.post('/logout', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const refreshCookie = req.cookies?.aegis_refresh
  if (refreshCookie) {
    // Revoke the session in DB
    const { hashRefreshToken } = await import('../middleware/auth.js')
    const tokenHash = hashRefreshToken(refreshCookie)
    await pool.query(
      `UPDATE user_sessions SET revoked = true, revoked_reason = 'logout'
       WHERE refresh_token_hash = $1`,
      [tokenHash]
    ).catch(() => {})
  }
  res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
  res.json({ success: true, message: 'Logged out.' })
})

// GET /verify-email?token=xxx — Verify citizen email address (#23)
router.get('/verify-email', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.query
    if (!token || typeof token !== 'string' || token.length !== 64) {
      throw AppError.badRequest('Invalid verification token.')
    }

    const tokenHash = hashToken(token)

    // Try new hashed column first, fall back to legacy plaintext column
    let result = await pool.query(
      `UPDATE citizens SET email_verified = true, verification_token_hash = NULL, verification_expires = NULL, verification_token = NULL
       WHERE verification_token_hash = $1 AND email_verified = false
       AND (verification_expires IS NULL OR verification_expires > NOW())
       RETURNING id, email, display_name`,
      [tokenHash]
    )

    // Fallback: check legacy plaintext verification_token (pre-migration tokens)
    if (result.rows.length === 0) {
      result = await pool.query(
        `UPDATE citizens SET email_verified = true, verification_token = NULL, verification_token_hash = NULL
         WHERE verification_token = $1 AND email_verified = false
         RETURNING id, email, display_name`,
        [token]
      )
    }

    if (result.rows.length === 0) {
      throw AppError.badRequest('Invalid, expired, or already-used verification token.')
    }

    await logSecurityEvent({
      userId: result.rows[0].id, userType: 'citizen', eventType: 'email_verified',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    res.json({ success: true, message: 'Email verified successfully! You can now access all features.' })
  } catch (err) {
    next(err)
  }
})

// POST /resend-verification — Resend email verification token (#23)
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many verification emails requested. Please try again later.' },
})

router.post('/resend-verification', authMiddleware, resendLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id

    const citizen = await pool.query(
      'SELECT id, email, email_verified FROM citizens WHERE id = $1',
      [userId]
    )

    if (citizen.rows.length === 0) {
      throw AppError.notFound('Account not found.')
    }

    if (citizen.rows[0].email_verified) {
      res.json({ success: true, message: 'Email is already verified.' })
      return
    }

    // Generate new token (hashed storage, raw sent via email)
    const rawToken = generateSecureToken()
    const tokenHash = hashToken(rawToken)
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await pool.query(
      'UPDATE citizens SET verification_token_hash = $1, verification_expires = $2, verification_token = NULL WHERE id = $3',
      [tokenHash, expires, userId]
    )

    // Send verification email (dev mode = console + DB, production = SMTP)
    try {
      await sendVerificationEmail(citizen.rows[0].email, rawToken, 'citizen')
    } catch (emailErr: any) {
      logger.error({ err: emailErr }, '[CitizenAuth] Failed to send verification email')
    }

    await logSecurityEvent({
      userId, userType: 'citizen', eventType: 'email_verification_sent',
      ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] as string,
    })

    res.json({ success: true, message: 'Verification email has been sent.' })
  } catch (err) {
    next(err)
  }
})

export default router
