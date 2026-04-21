/**
 * Extended API surface: alert subscriptions, audit logs, department
 * listings, community help coordination, flood predictions, AI
 * governance, fusion engine, and resilience infrastructure endpoints.
 *
 * - Mounted at /api in index.ts
 * - Aggregates functionality from many services (notification, AI,
 *   governance, fusion, data ingestion, ML pipeline, resilience)
 * - Both public and authenticated endpoints
 *
 * Key endpoint groups:
 * - /departments -- Department listings
 * - /subscriptions -- Alert subscription management
 * - /audit -- Audit log query (admin)
 * - /community -- Community help coordination
 * - /predictions -- Flood predictions and pre-alerts
 * - /notifications -- Notification channel management
 * - /governance -- AI governance dashboard
 * - /fusion -- Multi-source data fusion
 * */
import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authMiddleware, AuthRequest, verifyToken } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/internalAuth.js'
import pool from '../models/db.js'
import crypto from 'crypto'
import * as notificationService from '../services/notificationService.js'
import { devLog } from '../utils/logger.js'
import { aiClient } from '../services/aiClient.js'
import { isValidE164} from '../utils/phoneValidation.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()

//Rate limiter for public subscription endpoints (prevent abuse)
const subscriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many subscription requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false })

//getResourceRecommendation helper moved to aiEngineRoutes.ts (C3) — only consumer was /predictions/run
router.get('/departments', asyncRoute(async (_req: Request, res: Response) => {
    const { rows } = await pool.query('SELECT id, name, description FROM departments ORDER BY name')
    res.json(rows)
}))

//ALERT SUBSCRIPTIONS

//Subscribe to alerts
router.post('/subscriptions', subscriptionLimiter, asyncRoute(async (req: Request, res: Response) => {
    const { email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter, subscriber_name } = req.body
    const normalizedChannels = normalizeChannels(channels)

    //Detect if the request comes from a signed-in citizen (vs anonymous visitor).
    //Citizens carry a Bearer JWT with role='citizen'.  Operators are excluded so
    //their staff tokens never accidentally claim a citizen subscription.
    let citizenId: string | null = null
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken<any>(authHeader.split(' ')[1])
        if (typeof decoded?.id === 'string' && String(decoded?.role || '').toLowerCase() === 'citizen') {
          citizenId = decoded.id
        }
      } catch {
        //Invalid / expired token -- treat as anonymous subscription
      }
    }

    if (normalizedChannels.length === 0) {
      throw AppError.badRequest('At least one channel must be selected.')
    }

    if (phone && !isValidE164(phone)) {
      throw AppError.badRequest('Phone number must be in E.164 format (e.g. +447700900123).')
    }

    if (whatsapp && !isValidE164(whatsapp)) {
      throw AppError.badRequest('WhatsApp number must be in E.164 format (e.g. +447700900123).')
    }

    //Validate required contact info for channels (more flexible)
    if (normalizedChannels.includes('email') && !email) {
      throw AppError.badRequest('Email is required for email notifications.')
    }
    if (normalizedChannels.includes('sms') && !phone) {
      throw AppError.badRequest('Phone number is required for SMS.')
    }
    //WhatsApp can use either whatsapp or phone field
    if (normalizedChannels.includes('whatsapp') && !whatsapp && !phone) {
      throw AppError.badRequest('Phone/WhatsApp number is required for WhatsApp.')
    }
    //Telegram requires telegram_id but we'll allow empty for now to let users subscribe first
    // (they can update it later)

    const verificationToken = crypto.randomBytes(32).toString('hex')

    const normalizedTopics = Array.isArray(topic_filter) && topic_filter.length > 0
      ? topic_filter.map((t: string) => t.toLowerCase().trim()).filter(Boolean)
      : ['flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general']

    //Auto-verify all subscriptions immediately so alerts work right away.
    //Email verification is a nice-to-have but must not block other channels.
    //Use UPSERT on email to avoid duplicate subscriptions.
    const { rows } = await pool.query(
      `INSERT INTO alert_subscriptions (citizen_id, email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter, verification_token, verified, consent_given, consent_timestamp, subscriber_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, true, true, NOW(), $13)
       ON CONFLICT (email) WHERE email IS NOT NULL
       DO UPDATE SET citizen_id = COALESCE(EXCLUDED.citizen_id, alert_subscriptions.citizen_id), phone = EXCLUDED.phone, telegram_id = EXCLUDED.telegram_id, whatsapp = EXCLUDED.whatsapp, channels = EXCLUDED.channels, location_lat = EXCLUDED.location_lat, location_lng = EXCLUDED.location_lng, radius_km = EXCLUDED.radius_km, severity_filter = EXCLUDED.severity_filter, topic_filter = EXCLUDED.topic_filter, subscriber_name = EXCLUDED.subscriber_name, updated_at = NOW()
       RETURNING id, channels, verified, topic_filter, citizen_id IS NOT NULL AS is_authenticated`,
      [citizenId, email || null, phone || null, telegram_id || null, whatsapp || phone || null, normalizedChannels, location_lat || null, location_lng || null, radius_km || 50, severity_filter || ['critical', 'warning', 'info'], normalizedTopics, verificationToken, subscriber_name || null]
    )

    //Send verification email if email channel is selected (optional, subscription already verified)
    const needsEmailVerification = normalizedChannels.includes('email') && !!email
    if (needsEmailVerification) {
      let emailVerified = false
      try {
        const verificationUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify-subscription?token=${verificationToken}`

        const verificationAlert: notificationService.Alert = {
          id: 'verify-' + rows[0].id,
          type: 'general',
          severity: 'info',
          title: 'Verify Your AEGIS Alert Subscription',
          message: `Thank you for subscribing to AEGIS emergency alerts. To complete your subscription, please verify your email address by clicking the link below:\n\n${verificationUrl}\n\nThis link will expire in 24 hours.`,
          area: 'Subscription Service',
          actionRequired: 'Click the verification link to activate your subscription.' }

        const emailResult = await notificationService.sendEmailAlert(email, verificationAlert)
        if (emailResult.success) {
          emailVerified = true
          devLog(`Verification email sent to ${email}`)
        } else {
          devLog(`Email send failed (${emailResult.error}), auto-verifying subscription`)
        }
      } catch (emailError: any) {
        logger.error({ err: emailError }, 'Failed to send verification email')
      }

      //If email couldn't be sent (SMTP not configured), auto-verify so the subscriber
      //still receives alerts via their other channels (SMS, WhatsApp, etc.)
      if (!emailVerified) {
        await pool.query(
          `UPDATE alert_subscriptions SET verified = true, verification_token = NULL WHERE id = $1`,
          [rows[0].id]
        )
        rows[0].verified = true
      }
    }

    res.status(201).json({ subscription: rows[0], verificationToken })
}))

//Verify subscription
router.post('/subscriptions/verify', asyncRoute(async (req: Request, res: Response) => {
    const { token } = req.body
    if (!token) {
      throw AppError.badRequest('Verification token is required.')
    }

    const { rows } = await pool.query(
      `UPDATE alert_subscriptions
       SET verified = true, verification_token = NULL, updated_at = NOW()
       WHERE verification_token = $1
       RETURNING id, email, phone, channels, verified`,
      [token]
    )

    if (rows.length === 0) {
      throw AppError.notFound('Invalid verification token.')
    }

    res.json({ verified: true, subscription: rows[0] })
}))

//Get subscriptions by email
router.get('/subscriptions', asyncRoute(async (req: Request, res: Response) => {
    const { email } = req.query
    const { rows } = await pool.query(
      'SELECT id, email, phone, channels, verified, severity_filter, created_at FROM alert_subscriptions WHERE email = $1 ORDER BY created_at DESC',
      [email]
    )
    res.json(rows)
}))

//Unsubscribe (requires auth to prevent IDOR)
router.delete('/subscriptions/:id', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
    await pool.query('DELETE FROM alert_subscriptions WHERE id = $1', [req.params.id])
    res.json({ deleted: true })
}))

//AUDIT LOG

//Log an action
router.post('/audit', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state } = req.body
    const ip = req.ip || 'unknown'
    const ua = req.headers['user-agent'] || 'unknown'

    const { rows } = await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [operator_id, operator_name, action, action_type, target_type, target_id, before_state ? JSON.stringify(before_state) : null, after_state ? JSON.stringify(after_state) : null, ip, ua]
    )
    res.status(201).json(rows[0])
}))

//Get audit log with filtering
router.get('/audit', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { action_type, operator_id, limit, offset, date_from, date_to, search } = req.query
    let query = 'SELECT id, action_type, action, operator_id, operator_name, target_id, target_type, ip_address, metadata, created_at FROM audit_log WHERE 1=1'
    const params: any[] = []
    let idx = 1

    if (action_type) { query += ` AND action_type = $${idx++}`; params.push(action_type) }
    if (operator_id) { query += ` AND operator_id = $${idx++}`; params.push(operator_id) }
    if (date_from) { query += ` AND created_at >= $${idx++}`; params.push(new Date(date_from as string)) }
    if (date_to) { query += ` AND created_at <= $${idx++}`; params.push(new Date(date_to + 'T23:59:59Z')) }
    if (search) {
      query += ` AND (action ILIKE $${idx} OR operator_name ILIKE $${idx} OR target_id ILIKE $${idx} OR ip_address ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`
    params.push(Number(limit) || 100, Number(offset) || 0)

    const { rows } = await pool.query(query, params)
    res.json(rows)
}))

//COMMUNITY HELP

//List all active help offers/requests
router.get('/community', asyncRoute(async (req: Request, res: Response) => {
    const { type, category, status } = req.query
    let query = 'SELECT id, type, category, title, description, location_text, location_lat, location_lng, contact_info, capacity, status, citizen_id, created_at, updated_at FROM community_help WHERE 1=1' // fix: was user_id
    const params: any[] = []
    let idx = 1

    if (type) { query += ` AND type = $${idx++}`; params.push(type) }
    if (category) { query += ` AND category = $${idx++}`; params.push(category) }
    query += ` AND status = $${idx++}`; params.push(status || 'active')
    query += ' ORDER BY created_at DESC'

    const { rows } = await pool.query(query, params)
    res.json(rows)
}))

//Create a help offer or request (requires authentication)
router.post('/community', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { type, category, title, description, location_text, location_lat, location_lng, contact_info, capacity, consent_given } = req.body

    if (!type || !['offer', 'request'].includes(type)) {
      throw AppError.badRequest('Type must be "offer" or "request".')
    }
    if (!title || typeof title !== 'string' || title.length < 3 || title.length > 200) {
      throw AppError.badRequest('Title is required (3-200 characters).')
    }
    if (!description || typeof description !== 'string' || description.length > 2000) {
      throw AppError.badRequest('Description required (max 2000 characters).')
    }

    const { rows } = await pool.query(
      `INSERT INTO community_help (type, category, title, description, location_text, location_lat, location_lng, contact_info, capacity, consent_given, citizen_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [type, category || null, title, description, location_text || null, location_lat || null, location_lng || null, contact_info || null, capacity || null, consent_given || false, req.user!.id]
    )
    res.status(201).json(rows[0])
}))

//Update status (fulfil, cancel, expire)
router.put('/community/:id/status', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { status } = req.body
    if (!status || !['fulfilled', 'cancelled', 'expired', 'active'].includes(status)) {
      throw AppError.badRequest('Invalid status.')
    }
    //Only the creator (or an operator) can update status
    const userId = req.user?.id
    const userRole = req.user?.role || ''
    const isOperator = ['admin', 'operator', 'manager'].includes(userRole)
    const { rows } = await pool.query(
      isOperator
        ? 'UPDATE community_help SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *'
        : 'UPDATE community_help SET status = $1, updated_at = NOW() WHERE id = $2 AND citizen_id = $3 RETURNING *',
      isOperator ? [status, req.params.id] : [status, req.params.id, userId]
    )
    if (rows.length === 0) {
      throw AppError.notFound('Entry not found or you do not have permission to update it.')
    }
    res.json(rows[0])
}))

//FLOOD PREDICTIONS extracted to floodPredictionRoutes.ts (C3)

//NOTIFICATIONS + WEB PUSH + BROADCAST extracted to notificationRoutes.ts (C3)

//RESOURCE DEPLOYMENTS + DEPLOYMENT ASSETS extracted to deploymentRoutes.ts (C3)

//REPORT MEDIA

//Get media for a specific report
router.get('/reports/:id/media', asyncRoute(async (req: Request, res: Response) => {
    const { rows } = await pool.query(
      `SELECT id, file_url, file_type, file_size, ai_processed,
              ai_classification, ai_water_depth, ai_authenticity_score,
              ai_model_version, ai_reasoning, created_at
       FROM report_media WHERE report_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json(rows)
}))

//AI MODEL STATUS (detailed model endpoints moved to aiRoutes.ts)

router.get('/ai/status', asyncRoute(async (_req: Request, res: Response) => {
  try {
    const available = await aiClient.isAvailable()
    if (!available) {
      res.status(503).json({ status: 'unavailable', error: 'AI Engine is not reachable.' })
      return
    }

    const modelStatus = await aiClient.getModelStatus(true)
    res.json({ status: 'operational', ...modelStatus, lastUpdated: new Date().toISOString() })
  } catch (err: any) {
    res.status(502).json({ status: 'error', error: err.message || 'Failed to retrieve AI status.' })
  }
}))

//AI GOVERNANCE ENDPOINTS extracted to aiGovernanceRoutes.ts (C3)

//Safe Zone + Metro/Transit alerts extracted to operationalAlertRoutes.ts (C3)


function normalizeChannels(channels: unknown): string[] {
  if (!Array.isArray(channels)) return []
  const allowed = new Set(['web', 'email', 'sms', 'telegram', 'whatsapp'])
  return Array.from(new Set(
    channels
      .map(c => String(c).toLowerCase())
      .map(c => c === 'webpush' ? 'web' : c)
      .filter(c => allowed.has(c))
  ))
}

//Phone validation is now imported from utils/phoneValidation.ts

// ACCOUNT GOVERNANCE ENDPOINTS extracted to operatorAdminRoutes.ts (C3)

// AI PREDICTION ENGINE block extracted to aiEngineRoutes.ts (C3)

export default router
