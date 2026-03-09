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

import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, generateToken, generateRefreshToken, verifyRefreshToken, AuthRequest } from '../middleware/auth.js'
import { uploadAvatar } from '../middleware/upload.js'

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /register — Create a new citizen account
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register', registerLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
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
      res.status(400).json({ error: 'Email, password, and display name are required.' })
      return
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' })
      return
    }

    // Input length validation
    if (typeof displayName === 'string' && displayName.length > MAX_DISPLAY_NAME) {
      res.status(400).json({ error: `Display name must be ${MAX_DISPLAY_NAME} characters or less.` })
      return
    }
    if (typeof bio === 'string' && bio.length > MAX_BIO) {
      res.status(400).json({ error: `Bio must be ${MAX_BIO} characters or less.` })
      return
    }
    if (typeof addressLine === 'string' && addressLine.length > MAX_ADDRESS) {
      res.status(400).json({ error: `Address must be ${MAX_ADDRESS} characters or less.` })
      return
    }
    if (typeof phone === 'string' && phone.length > MAX_PHONE) {
      res.status(400).json({ error: `Phone must be ${MAX_PHONE} characters or less.` })
      return
    }

    // Password strength — require 8+ chars with at least 1 uppercase, 1 digit, and 1 special char
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' })
      return
    }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(password)) {
      res.status(400).json({ error: 'Password must contain at least one uppercase letter, one number, and one special character.' })
      return
    }

    // Check if email already registered (case-insensitive)
    const normalizedEmail = email.trim().toLowerCase()
    const exists = await pool.query(
      'SELECT id FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [normalizedEmail]
    )
    if (exists.rows.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' })
      return
    }

    // Hash password with bcrypt (12 rounds)
    const passwordHash = await bcrypt.hash(password, 12)

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex')

    // Insert citizen with all new fields (email stored lowercase)
    const result = await pool.query(
      `INSERT INTO citizens (email, password_hash, display_name, phone, preferred_region,
                             verification_token, is_vulnerable, vulnerability_details,
                             country, city, date_of_birth, bio, address_line)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, email, display_name, role, preferred_region, email_verified,
                 is_vulnerable, country, city, bio, address_line, created_at`,
      [normalizedEmail, passwordHash, displayName, phone || null, preferredRegion || null,
       verificationToken, isVulnerable || false, vulnerabilityDetails || null,
       country || 'United Kingdom', city || null, dateOfBirth || null,
       bio || null, addressLine || null]
    )

    const citizen = result.rows[0]

    // Create default preferences
    await pool.query(
      `INSERT INTO citizen_preferences (citizen_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [citizen.id]
    )

    // Generate JWT with citizen role
    const token = generateToken({
      id: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
    })
    const refreshToken = generateRefreshToken({ id: citizen.id, role: citizen.role || 'citizen' })
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
  } catch (err: any) {
    console.error('[CitizenAuth] Register error:', err.message)
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /login — Authenticate citizen
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' })
      return
    }

    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, role, avatar_url,
              preferred_region, email_verified, is_active, phone, location_lat, location_lng,
              is_vulnerable, vulnerability_details, country, city, bio, date_of_birth,
              deletion_requested_at
       FROM citizens WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [email.trim()]
    )

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password.' })
      return
    }

    const citizen = result.rows[0]

    if (!citizen.is_active) {
      res.status(403).json({ error: 'Account is deactivated. Contact support.' })
      return
    }

    const valid = await bcrypt.compare(password, citizen.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' })
      return
    }

    // Update last login and increment login count
    await pool.query(
      'UPDATE citizens SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1',
      [citizen.id]
    )

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
      if (process.env.NODE_ENV !== 'production') console.log(`[CitizenAuth] Auto-cancelled deletion for ${citizen.display_name} on login`)
    }

    const token = generateToken({
      id: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
    })
    const refreshToken = generateRefreshToken({ id: citizen.id, role: citizen.role || 'citizen' })
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
      },
      preferences: prefsResult.rows[0] || null,
    })
  } catch (err: any) {
    console.error('[CitizenAuth] Login error:', err.message)
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /me — Get current citizen profile (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
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
      res.status(404).json({ error: 'Citizen account not found.' })
      return
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
  } catch (err: any) {
    console.error('[CitizenAuth] Profile fetch error:', err.message)
    res.status(500).json({ error: 'Failed to load profile.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /profile — Update citizen profile (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
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
      res.status(400).json({ error: 'No fields to update.' })
      return
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
      res.status(404).json({ error: 'Account not found.' })
      return
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
  } catch (err: any) {
    console.error('[CitizenAuth] Profile update error:', err.message)
    res.status(500).json({ error: 'Failed to update profile.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /avatar — Upload profile photo (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/avatar', authMiddleware, uploadAvatar, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided. Accepted: JPG, PNG, GIF, WebP (max 2MB).' })
      return
    }

    const avatarUrl = `/uploads/${req.file.filename}`

    await pool.query(
      'UPDATE citizens SET avatar_url = $1 WHERE id = $2 AND deleted_at IS NULL',
      [avatarUrl, req.user!.id]
    )

    res.json({ avatarUrl })
  } catch (err: any) {
    console.error('[CitizenAuth] Avatar upload error:', err.message)
    res.status(500).json({ error: 'Failed to upload avatar.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /preferences — Get citizen preferences (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/preferences', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM citizen_preferences WHERE citizen_id = $1',
      [req.user!.id]
    )
    res.json(result.rows[0] || {})
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load preferences.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /preferences — Update citizen preferences (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/preferences', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch (err: any) {
    console.error('[CitizenAuth] Preferences update error:', err.message)
    res.status(500).json({ error: 'Failed to update preferences.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Emergency Contacts CRUD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/emergency-contacts', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM emergency_contacts WHERE citizen_id = $1 ORDER BY is_primary DESC, created_at ASC',
      [req.user!.id]
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load emergency contacts.' })
  }
})

router.post('/emergency-contacts', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, phone, relationship, isPrimary, notifyOnHelp } = req.body

    if (!name || !phone) {
      res.status(400).json({ error: 'Name and phone are required.' })
      return
    }

    // Max 5 contacts per citizen
    const countResult = await pool.query(
      'SELECT COUNT(*) as cnt FROM emergency_contacts WHERE citizen_id = $1',
      [req.user!.id]
    )
    if (parseInt(countResult.rows[0].cnt) >= 5) {
      res.status(400).json({ error: 'Maximum 5 emergency contacts allowed.' })
      return
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
  } catch (err: any) {
    console.error('[CitizenAuth] Add contact error:', err.message)
    res.status(500).json({ error: 'Failed to add emergency contact.' })
  }
})

router.delete('/emergency-contacts/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND citizen_id = $2 RETURNING id',
      [req.params.id, req.user!.id]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found.' })
      return
    }

    res.json({ deleted: true })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to remove contact.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /change-password — Change citizen password (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/change-password', authMiddleware, changePasswordLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new passwords are required.' })
      return
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' })
      return
    }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(newPassword)) {
      res.status(400).json({ error: 'Password must contain at least one uppercase letter, one number, and one special character.' })
      return
    }

    const userResult = await pool.query(
      'SELECT password_hash FROM citizens WHERE id = $1 AND deleted_at IS NULL',
      [req.user!.id]
    )

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'Account not found.' })
      return
    }

    const valid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect.' })
      return
    }

    const newHash = await bcrypt.hash(newPassword, 12)
    await pool.query('UPDATE citizens SET password_hash = $1 WHERE id = $2', [newHash, req.user!.id])

    res.json({ success: true, message: 'Password changed successfully.' })
  } catch (err: any) {
    console.error('[CitizenAuth] Password change error:', err.message)
    res.status(500).json({ error: 'Failed to change password.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /forgot-password — Request a password reset token
// ─────────────────────────────────────────────────────────────────────────────
router.post('/forgot-password', resetLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.body

    if (!email) {
      res.status(400).json({ error: 'Email is required.' })
      return
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
    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await pool.query(
      'UPDATE citizens SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, resetExpires, citizen.id]
    )

    // In production, send email here. For dev, log the token.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CitizenAuth] Password reset token for ${citizen.email}: ${resetToken}`)
      console.log(`[CitizenAuth] Reset URL: /citizen/login?reset=${resetToken}`)
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been generated.',
    })
  } catch (err: any) {
    console.error('[CitizenAuth] Forgot password error:', err.message)
    res.status(500).json({ error: 'Failed to process reset request.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /reset-password — Reset password using a token
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reset-password', resetLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body

    if (!token || !newPassword) {
      res.status(400).json({ error: 'Reset token and new password are required.' })
      return
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' })
      return
    }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(newPassword)) {
      res.status(400).json({ error: 'Password must contain at least one uppercase letter, one number, and one special character.' })
      return
    }

    const result = await pool.query(
      `SELECT id, email FROM citizens
       WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL`,
      [token]
    )

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired reset token. Please request a new one.' })
      return
    }

    const citizen = result.rows[0]
    const newHash = await bcrypt.hash(newPassword, 12)

    await pool.query(
      'UPDATE citizens SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [newHash, citizen.id]
    )

    if (process.env.NODE_ENV !== 'production') console.log(`[CitizenAuth] Password reset successful for ${citizen.email}`)

    res.json({ success: true, message: 'Password has been reset successfully. You can now sign in.' })
  } catch (err: any) {
    console.error('[CitizenAuth] Reset password error:', err.message)
    res.status(500).json({ error: 'Failed to reset password.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /refresh — Get new access token using refresh token cookie (#24)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refresh', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const refreshCookie = req.cookies?.aegis_refresh
    if (!refreshCookie) {
      res.status(401).json({ error: 'No refresh token.' })
      return
    }

    const decoded = verifyRefreshToken(refreshCookie)

    // Verify citizen still exists and is not deleted
    const result = await pool.query(
      'SELECT id, email, display_name, role, deletion_scheduled_at FROM citizens WHERE id = $1',
      [decoded.id]
    )
    if (result.rows.length === 0) {
      res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
      res.status(401).json({ error: 'Account not found.' })
      return
    }
    const citizen = result.rows[0]
    if (citizen.deletion_scheduled_at && new Date(citizen.deletion_scheduled_at) < new Date()) {
      res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
      res.status(401).json({ error: 'Account has been deleted.' })
      return
    }

    const newToken = generateToken({
      id: citizen.id,
      email: citizen.email,
      role: citizen.role || 'citizen',
      displayName: citizen.display_name,
    })

    res.json({ token: newToken })
  } catch {
    res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
    res.status(401).json({ error: 'Invalid or expired refresh token.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /logout — Server-side logout: clear refresh cookie (#25)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', (_req: AuthRequest, res: Response): void => {
  res.clearCookie('aegis_refresh', { path: '/api/citizen-auth' })
  res.json({ success: true, message: 'Logged out.' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /verify-email?token=xxx — Verify citizen email address (#23)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify-email', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token } = req.query
    if (!token || typeof token !== 'string' || token.length !== 64) {
      res.status(400).json({ error: 'Invalid verification token.' })
      return
    }

    const result = await pool.query(
      `UPDATE citizens SET email_verified = true, verification_token = NULL
       WHERE verification_token = $1 AND email_verified = false
       RETURNING id, email, display_name`,
      [token]
    )

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or already-used verification token.' })
      return
    }

    res.json({ success: true, message: 'Email verified successfully! You can now access all features.' })
  } catch (err: any) {
    console.error('[CitizenAuth] Verify email error:', err.message)
    res.status(500).json({ error: 'Verification failed.' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /resend-verification — Resend email verification token (#23)
// ─────────────────────────────────────────────────────────────────────────────
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many verification emails requested. Please try again later.' },
})

router.post('/resend-verification', authMiddleware, resendLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id

    const citizen = await pool.query(
      'SELECT id, email, email_verified FROM citizens WHERE id = $1',
      [userId]
    )

    if (citizen.rows.length === 0) {
      res.status(404).json({ error: 'Account not found.' })
      return
    }

    if (citizen.rows[0].email_verified) {
      res.json({ success: true, message: 'Email is already verified.' })
      return
    }

    const newToken = crypto.randomBytes(32).toString('hex')
    await pool.query(
      'UPDATE citizens SET verification_token = $1 WHERE id = $2',
      [newToken, userId]
    )

    // In production, send email here with verification link
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CitizenAuth] Verification token for ${citizen.rows[0].email}: ${newToken}`)
    }

    res.json({ success: true, message: 'Verification email has been sent.' })
  } catch (err: any) {
    console.error('[CitizenAuth] Resend verification error:', err.message)
    res.status(500).json({ error: 'Failed to resend verification email.' })
  }
})

export default router
