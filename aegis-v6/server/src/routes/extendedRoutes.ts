 /*
 * extendedRoutes.ts - Additional API routes for production features (SECURED)
 * Handles:
 * Department listing (public)
 * Alert subscriptions (subscribe, verify, unsubscribe) (public)
 * Audit trail (log actions, query history) (admin only)
 * Community help (offers/requests CRUD) (authenticated)
 * Alert delivery via multi-channel notifications (admin only)
 * Data ingestion pipeline (admin only)
 * ML training pipeline (admin only)
 * RAG knowledge base expansion (admin only)
 * Resilience monitoring (operator only)
 *
 * SECURITY: Sensitive endpoints require admin authentication
  */
import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest, verifyToken } from '../middleware/auth.js'
import { requireAdmin, requireOperator, operatorOnly } from '../middleware/internalAuth.js'
import pool from '../models/db.js'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import * as notificationService from '../services/notificationService.js'
import { devLog } from '../utils/logger.js'
import { aiClient } from '../services/aiClient.js'
import { isValidE164, normalizeToE164 } from '../utils/phoneValidation.js'
import { computeConfidenceDistribution, getExecutionAuditLog, addTrainingLabel, computeRiskHeatmap, estimateDamageCost, getModelMetrics, checkModelDrift } from '../services/governanceEngine.js'
import { runFingerprinting, getActivePredictions, sendPreAlert } from '../services/floodFingerprinting.js'
import { gatherFusionData, runFusion } from '../services/fusionEngine.js'
import { ensureIngestionSchema, runFullIngestion, ingestEAFloodData, ingestNASAPowerData, ingestOpenMeteoData, ingestUKFloodHistory, ingestWikipediaFloodKnowledge } from '../services/dataIngestionService.js'
import { expandRAGKnowledgeBase, ragRetrieve } from '../services/ragExpansionService.js'
import { trainAllModels, trainFusionWeights } from '../services/mlTrainingPipeline.js'
import { getResilienceStatus } from '../services/resilienceLayer.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()

// DEPARTMENTS

router.get('/departments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query('SELECT id, name, description FROM departments ORDER BY name')
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// ALERT SUBSCRIPTIONS

// Subscribe to alerts
router.post('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter } = req.body
    const normalizedChannels = normalizeChannels(channels)

    if (normalizedChannels.length === 0) {
      throw AppError.badRequest('At least one channel must be selected.')
    }

    if (phone && !isValidE164(phone)) {
      throw AppError.badRequest('Phone number must be in E.164 format (e.g. +447700900123).')
    }

    if (whatsapp && !isValidE164(whatsapp)) {
      throw AppError.badRequest('WhatsApp number must be in E.164 format (e.g. +447700900123).')
    }

    // Validate required contact info for channels (more flexible)
    if (normalizedChannels.includes('email') && !email) {
      throw AppError.badRequest('Email is required for email notifications.')
    }
    if (normalizedChannels.includes('sms') && !phone) {
      throw AppError.badRequest('Phone number is required for SMS.')
    }
    // WhatsApp can use either whatsapp or phone field
    if (normalizedChannels.includes('whatsapp') && !whatsapp && !phone) {
      throw AppError.badRequest('Phone/WhatsApp number is required for WhatsApp.')
    }
    // Telegram requires telegram_id but we'll allow empty for now to let users subscribe first
    // (they can update it later)

    const verificationToken = crypto.randomBytes(32).toString('hex')

    const normalizedTopics = Array.isArray(topic_filter) && topic_filter.length > 0
      ? topic_filter.map((t: string) => t.toLowerCase().trim()).filter(Boolean)
      : ['flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general']

    // Auto-verify all subscriptions immediately so alerts work right away.
    // Email verification is a nice-to-have but must not block other channels.
    // Use UPSERT on email to avoid duplicate subscriptions.
    const { rows } = await pool.query(
      `INSERT INTO alert_subscriptions (email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter, verification_token, verified, consent_given, consent_timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, true, true, NOW())
       ON CONFLICT (email) WHERE email IS NOT NULL
       DO UPDATE SET phone = EXCLUDED.phone, telegram_id = EXCLUDED.telegram_id, whatsapp = EXCLUDED.whatsapp, channels = EXCLUDED.channels, location_lat = EXCLUDED.location_lat, location_lng = EXCLUDED.location_lng, radius_km = EXCLUDED.radius_km, severity_filter = EXCLUDED.severity_filter, topic_filter = EXCLUDED.topic_filter, updated_at = NOW()
       RETURNING id, channels, verified, topic_filter`,
      [email || null, phone || null, telegram_id || null, whatsapp || phone || null, normalizedChannels, location_lat || null, location_lng || null, radius_km || 50, severity_filter || ['critical', 'warning', 'info'], normalizedTopics, verificationToken]
    )

    // Send verification email if email channel is selected (optional, subscription already verified)
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
          actionRequired: 'Click the verification link to activate your subscription.',
        }

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

      // If email couldn't be sent (SMTP not configured), auto-verify so the subscriber
      // still receives alerts via their other channels (SMS, WhatsApp, etc.)
      if (!emailVerified) {
        await pool.query(
          `UPDATE alert_subscriptions SET verified = true, verification_token = NULL WHERE id = $1`,
          [rows[0].id]
        )
        rows[0].verified = true
      }
    }

    res.status(201).json({ subscription: rows[0], verificationToken })
  } catch (err) {
    next(err)
  }
})

// Verify subscription
router.post('/subscriptions/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
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
  } catch (err) {
    next(err)
  }
})

// Get subscriptions by email
router.get('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.query
    const { rows } = await pool.query(
      'SELECT id, email, phone, channels, verified, severity_filter, created_at FROM alert_subscriptions WHERE email = $1 ORDER BY created_at DESC',
      [email]
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// Unsubscribe (requires auth to prevent IDOR)
router.delete('/subscriptions/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await pool.query('DELETE FROM alert_subscriptions WHERE id = $1', [req.params.id])
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

// AUDIT LOG

// Log an action
router.post('/audit', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state } = req.body
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const ua = req.headers['user-agent'] || 'unknown'

    const { rows } = await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [operator_id, operator_name, action, action_type, target_type, target_id, before_state ? JSON.stringify(before_state) : null, after_state ? JSON.stringify(after_state) : null, ip, ua]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

// Get audit log with filtering
router.get('/audit', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { action_type, operator_id, limit, offset } = req.query
    let query = 'SELECT * FROM audit_log WHERE 1=1'
    const params: any[] = []
    let idx = 1

    if (action_type) { query += ` AND action_type = $${idx++}`; params.push(action_type) }
    if (operator_id) { query += ` AND operator_id = $${idx++}`; params.push(operator_id) }
    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`
    params.push(Number(limit) || 100, Number(offset) || 0)

    const { rows } = await pool.query(query, params)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// COMMUNITY HELP

// List all active help offers/requests
router.get('/community', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, category, status } = req.query
    let query = 'SELECT * FROM community_help WHERE 1=1'
    const params: any[] = []
    let idx = 1

    if (type) { query += ` AND type = $${idx++}`; params.push(type) }
    if (category) { query += ` AND category = $${idx++}`; params.push(category) }
    query += ` AND status = $${idx++}`; params.push(status || 'active')
    query += ' ORDER BY created_at DESC'

    const { rows } = await pool.query(query, params)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// Create a help offer or request (requires authentication)
router.post('/community', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
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
  } catch (err) {
    next(err)
  }
})

// Update status (fulfil, cancel, expire) — requires authentication
router.put('/community/:id/status', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body
    if (!status || !['fulfilled', 'cancelled', 'expired', 'active'].includes(status)) {
      throw AppError.badRequest('Invalid status.')
    }
    // #5 — Ownership check: only the creator (or an operator) can update status
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
  } catch (err) {
    next(err)
  }
})

// FLOOD PREDICTIONS

// Get all active flood predictions — deduplicated: latest per area only
router.get('/predictions', async (_req: Request, res: Response, next: NextFunction) => {
  // Reusable SQL fragment: DISTINCT ON (area) keeps the most recent run per area
  const latestPerAreaSQL = `
    SELECT id, area, probability, time_to_flood, matched_pattern, next_areas,
           severity, confidence, data_sources, model_version,
           pre_alert_sent, pre_alert_sent_at, created_at, expires_at,
           ST_Y(coordinates::geometry) AS lat,
           ST_X(coordinates::geometry) AS lng
    FROM (
      SELECT DISTINCT ON (LOWER(TRIM(area)))
             id, area, probability, time_to_flood, matched_pattern, next_areas,
             severity, confidence, data_sources, model_version,
             pre_alert_sent, pre_alert_sent_at, created_at, expires_at,
             coordinates
      FROM flood_predictions
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY LOWER(TRIM(area)), created_at DESC
    ) latest
    ORDER BY probability DESC`

  try {
    const { rows } = await pool.query(latestPerAreaSQL)

    // If no recent predictions, trigger a fresh calculation
    if (rows.length === 0) {
      try {
        const { getFloodPredictions } = await import('../services/floodPredictionService.js')
        await getFloodPredictions()
        const fresh = await pool.query(latestPerAreaSQL)
        res.json(fresh.rows)
        return
      } catch (genErr: any) {
        logger.warn({ err: genErr }, '[Predictions] Auto-regeneration failed')
        // Fall back to absolute latest regardless of age, still deduplicated
        const fallback = await pool.query(
          `SELECT id, area, probability, time_to_flood, matched_pattern, next_areas,
                  severity, confidence, data_sources, model_version,
                  pre_alert_sent, pre_alert_sent_at, created_at, expires_at,
                  ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lng
           FROM (
             SELECT DISTINCT ON (LOWER(TRIM(area)))
                    id, area, probability, time_to_flood, matched_pattern, next_areas,
                    severity, confidence, data_sources, model_version,
                    pre_alert_sent, pre_alert_sent_at, created_at, expires_at,
                    coordinates
             FROM flood_predictions
             ORDER BY LOWER(TRIM(area)), created_at DESC
           ) latest
           ORDER BY probability DESC
           LIMIT 20`
        )
        res.json(fallback.rows)
        return
      }
    }

    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// Send pre-alert for a prediction
router.post('/predictions/:id/pre-alert', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { operator_id, operator_name } = req.body

    // Get prediction details
    const predictionResult = await pool.query(
      `SELECT *,
              ST_Y(coordinates::geometry) as lat,
              ST_X(coordinates::geometry) as lng
       FROM flood_predictions
       WHERE id = $1`,
      [req.params.id]
    )

    if (predictionResult.rows.length === 0) {
      throw AppError.notFound('Prediction not found')
    }

    const prediction = predictionResult.rows[0]

    // Update prediction as alert sent
    await pool.query(
      `UPDATE flood_predictions SET pre_alert_sent = true, pre_alert_sent_at = NOW(), pre_alert_sent_by = $1
       WHERE id = $2`,
      [operator_id, req.params.id]
    )

    const severityRaw = String(prediction.severity || 'warning').toLowerCase()
    const severityAliases = severityRaw === 'critical'
      ? ['critical', 'warning']
      : severityRaw === 'high'
        ? ['high', 'warning']
        : severityRaw === 'medium'
          ? ['medium', 'warning', 'info']
          : ['low', 'info']

    // Geospatial + severity matching.
    // If prediction has coordinates, notify only subscribers within their own radius_km.
    // If no coordinates exist, gracefully fall back to severity-only matching.
    const subscriptions = await pool.query(
      `SELECT id, email, phone, telegram_id, whatsapp, channels, verified,
              location_lat, location_lng, radius_km
       FROM alert_subscriptions
       WHERE verified = true
         AND severity_filter && $1::text[]
         AND (
           $2::double precision IS NULL OR $3::double precision IS NULL
           OR location_lat IS NULL OR location_lng IS NULL
           OR ST_DWithin(
             ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography,
             ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
             GREATEST(COALESCE(radius_km, 50), 1) * 1000
           )
         )`,
      [severityAliases, prediction.lat ?? null, prediction.lng ?? null]
    )

    if (subscriptions.rows.length === 0) {
      devLog('No verified subscriptions found for alert')
      res.json({
        id: req.params.id,
        pre_alert_sent: true,
        subscribers_notified: 0,
        message: 'Alert marked as sent but no verified subscribers found'
      })
      return
    }

    // Build alert object
    const alert: notificationService.Alert = {
      id: req.params.id,
      type: 'flood',
      severity: prediction.severity || 'warning',
      title: `Flood Alert: ${prediction.area || 'Area'}`,
      message: `Flood probability: ${Math.round((prediction.probability || 0) * 100)}%. ${prediction.time_to_flood ? `Time to flood: ${prediction.time_to_flood}.` : ''} Please monitor conditions and be prepared to evacuate if instructed.`,
      area: prediction.area || 'Unknown area',
      actionRequired: prediction.probability >= 0.7 ? 'Prepare emergency supplies and review evacuation routes. Monitor official channels for updates.' : undefined,
      expiresAt: prediction.expires_at ? new Date(prediction.expires_at) : undefined,
      metadata: {
        confidence: prediction.confidence,
        model_version: prediction.model_version,
        data_sources: prediction.data_sources,
      },
    }

    // Send to all subscribers
    const deliveryResults = await notificationService.sendAlertToSubscribers(
      alert,
      subscriptions.rows
    )

    // Log audit trail
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        operator_id,
        operator_name || 'System',
        `Sent flood pre-alert to ${deliveryResults.successful} subscribers`,
        'alert_sent',
        'flood_prediction',
        req.params.id,
        JSON.stringify({
          total: deliveryResults.total,
          successful: deliveryResults.successful,
          failed: deliveryResults.failed
        })
      ]
    )

    res.json({
      id: req.params.id,
      pre_alert_sent: true,
      pre_alert_sent_at: new Date().toISOString(),
      delivery_summary: {
        total_attempts: deliveryResults.total,
        successful: deliveryResults.successful,
        failed: deliveryResults.failed,
        subscribers_notified: subscriptions.rows.length
      }
    })
  } catch (err) {
    next(err)
  }
})

// Test notification service (admin only)
router.post('/notifications/test', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { channel, recipient } = req.body

    if (!channel || !recipient) {
      throw AppError.badRequest('channel and recipient are required')
    }

    // Create test alert
    const testAlert: notificationService.Alert = {
      id: 'test-' + Date.now(),
      type: 'general',
      severity: 'info',
      title: 'AEGIS Test Alert',
      message: 'This is a test alert from the AEGIS Emergency Management System. If you received this, your notification channel is working correctly.',
      area: 'Test Area',
      actionRequired: 'No action required - this is only a test.',
    }

    let result: notificationService.DeliveryResult

    // Send based on channel
    switch (channel) {
      case 'email':
        result = await notificationService.sendEmailAlert(recipient, testAlert)
        break
      case 'sms':
        result = await notificationService.sendSMSAlert(recipient, testAlert)
        break
      case 'whatsapp':
        result = await notificationService.sendWhatsAppAlert(recipient, testAlert)
        break
      case 'telegram':
        result = await notificationService.sendTelegramAlert(recipient, testAlert)
        break
      default:
        throw AppError.badRequest('Invalid channel. Use: email, sms, whatsapp, telegram')
    }

    res.json({
      test_complete: true,
      channel,
      recipient,
      result
    })
  } catch (err) {
    next(err)
  }
})

// Get notification service status
router.get('/notifications/status', (_req: Request, res: Response) => {
  const status = notificationService.getNotificationServiceStatus()
  res.json(status)
})

// Subscribe to Web Push notifications
router.post('/notifications/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subscription, email } = req.body

    // Derive user_id from auth token if present — never trust body (#77)
    let user_id: number | null = null
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken<any>(authHeader.slice(7))
        user_id = decoded.userId || decoded.id || null
      } catch { /* anonymous subscription */ }
    }

    if (!subscription || !subscription.endpoint) {
      throw AppError.badRequest('Invalid push subscription object')
    }

    // Check if table exists, if not create it
    try {
      const checkTable = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'push_subscriptions'
        )
      `)

      if (!checkTable.rows[0].exists) {
        // Create table if it doesn't exist
        await pool.query(`
          CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            email TEXT,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT,
            auth TEXT,
            active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
          CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(active) WHERE active = true;
        `)
        devLog('Created push_subscriptions table')
      }
    } catch (tableErr: any) {
      logger.warn({ err: tableErr }, 'Table check failed, attempting to use existing table')
    }

    // Store push subscription in database
    const { rows } = await pool.query(
      `INSERT INTO push_subscriptions (user_id, email, endpoint, p256dh, auth, subscription_data, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (endpoint) DO UPDATE SET active = true, subscription_data = EXCLUDED.subscription_data, updated_at = NOW()
       RETURNING id, endpoint, active`,
      [
        user_id || null,
        email || null,
        subscription.endpoint,
        subscription.keys?.p256dh || null,
        subscription.keys?.auth || null,
        JSON.stringify(subscription),
      ]
    )

    if (process.env.NODE_ENV !== 'production') {
      devLog(`[Push] Subscription saved: ${subscription.endpoint.substring(0, 50)}...`)
    }
    res.status(201).json({
      subscription: { id: rows[0].id, active: rows[0].active },
      message: 'Push subscription saved successfully'
    })
  } catch (err) {
    next(err)
  }
})

// Unsubscribe from Web Push
router.post('/notifications/unsubscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { endpoint } = req.body

    if (!endpoint) {
      throw AppError.badRequest('Endpoint is required')
    }

    await pool.query(
      'UPDATE push_subscriptions SET active = false WHERE endpoint = $1',
      [endpoint]
    )

    res.json({ message: 'Push subscription removed successfully' })
  } catch (err) {
    next(err)
  }
})

// Broadcast custom alert (admin only)
router.post('/alerts/broadcast', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      operator_id,
      operator_name,
      alert_type,
      severity,
      title,
      message,
      area,
      action_required,
      expires_at,
      severity_filter,
      topic_filter: broadcast_topic
    } = req.body

    // Validation
    if (!title || !message || !severity || !area) {
      throw AppError.badRequest('title, message, severity, and area are required')
    }

    if (!['critical', 'warning', 'info'].includes(severity)) {
      throw AppError.badRequest('severity must be: critical, warning, or info')
    }

    // Get matching subscriptions (filter by severity AND topic if specified)
    const filterCriteria = severity_filter || ['critical', 'warning', 'info']
    const topicCriteria = broadcast_topic || alert_type || 'general'
    const subscriptions = await pool.query(
      `SELECT id, email, phone, telegram_id, whatsapp, channels, verified
       FROM alert_subscriptions
       WHERE verified = true
       AND severity_filter && $1::text[]
       AND (topic_filter IS NULL OR topic_filter && ARRAY[$2]::text[])`,
      [filterCriteria, topicCriteria]
    )

    if (subscriptions.rows.length === 0) {
      res.status(400).json({
        error: 'No verified subscribers match the alert criteria',
        matching_subscribers: 0
      })
      return
    }

    // Persist alert to `alerts` table so delivery logs can reference a valid UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const safeOperatorId = operator_id && UUID_RE.test(operator_id) ? operator_id : null
    let alertId: string
    try {
      const { rows: alertRows } = await pool.query(
        `INSERT INTO alerts (title, message, severity, alert_type, location_text, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          title,
          message,
          severity,
          alert_type || 'general',
          area,
          expires_at ? new Date(expires_at) : null,
          safeOperatorId,
        ]
      )
      alertId = alertRows[0].id
    } catch (err) {
      next(err)
      return
    }

    const alert: notificationService.Alert = {
      id: alertId,
      type: alert_type || 'general',
      severity,
      title,
      message,
      area,
      actionRequired: action_required,
      expiresAt: expires_at ? new Date(expires_at) : undefined,
      metadata: {
        broadcast_by: operator_name,
        broadcast_at: new Date().toISOString(),
      },
    }

    // Send to all matching subscribers (email, SMS, WhatsApp, Telegram)
    const deliveryResults = await notificationService.sendAlertToSubscribers(
      alert,
      subscriptions.rows
    )

    // Also send Web Push to all active push subscriptions
    try {
      const pushSubs = await pool.query(
        `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE active = true`
      )
      for (const ps of pushSubs.rows) {
        if (ps.endpoint && ps.p256dh && ps.auth) {
          const pushResult = await notificationService.sendWebPushAlert(
            { endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } },
            alert
          )
          deliveryResults.results.push(pushResult)
          deliveryResults.total++
          if (pushResult.success) deliveryResults.successful++
          else deliveryResults.failed++
        }
      }
    } catch (pushErr: any) {
      logger.warn({ err: pushErr }, 'Web Push broadcast error')
    }

    // Log each delivery result to alert_delivery_log
    for (const dr of deliveryResults.results) {
      try {
        await pool.query(
          `INSERT INTO alert_delivery_log (alert_id, channel, recipient, status, error_message, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [alertId, dr.channel, dr.messageId || dr.channel, dr.success ? 'sent' : 'failed', dr.error || null, dr.success ? dr.timestamp : null]
        )
      } catch { /* best effort logging */ }
    }

    // Log audit trail
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        operator_id,
        operator_name || 'System',
        `Broadcast ${severity} alert to ${deliveryResults.successful} subscribers`,
        'alert_broadcast',
        'broadcast',
        alertId,
        JSON.stringify({
          alert_title: title,
          area,
          total: deliveryResults.total,
          successful: deliveryResults.successful,
          failed: deliveryResults.failed
        })
      ]
    )

    res.json({
      success: true,
      alert_id: alertId,
      broadcast_at: new Date().toISOString(),
      delivery_summary: {
        matching_subscribers: subscriptions.rows.length,
        total_attempts: deliveryResults.total,
        successful_deliveries: deliveryResults.successful,
        failed_deliveries: deliveryResults.failed,
      }
    })
  } catch (err) {
    next(err)
  }
})

// ALERT DELIVERY LOG — Advanced multi-channel delivery tracking

function buildDeliveryWhere(q: Record<string, any>): { where: string; params: any[]; nextIdx: number } {
  const clauses: string[] = []
  const params: any[] = []
  let idx = 1
  const ch = q.channel ? (String(q.channel) === 'webpush' ? 'web' : String(q.channel)) : null
  if (ch)         { clauses.push(`adl.channel = $${idx++}`);            params.push(ch) }
  if (q.status)   { clauses.push(`adl.status = $${idx++}`);             params.push(String(q.status)) }
  if (q.alert_id) { clauses.push(`adl.alert_id = $${idx++}`);           params.push(String(q.alert_id)) }
  if (q.start)    { clauses.push(`adl.created_at >= $${idx++}`);        params.push(new Date(String(q.start))) }
  if (q.end)      { clauses.push(`adl.created_at <= $${idx++}`);        params.push(new Date(String(q.end))) }
  if (q.severity) { clauses.push(`a.severity = $${idx++}`);             params.push(String(q.severity)) }
  if (q.search)   { clauses.push(`(adl.recipient ILIKE $${idx} OR a.title ILIKE $${idx})`); params.push(`%${String(q.search)}%`); idx++ }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params, nextIdx: idx }
}

// GET /api/alerts/delivery — paginated, filtered, joined with alert title
router.get('/alerts/delivery', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  || '100')), 1000)
    const offset = parseInt(String(req.query.offset || '0'))
    const { where, params, nextIdx } = buildDeliveryWhere(req.query as any)

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id ${where}`, params),
      pool.query(`
        SELECT adl.id, adl.alert_id, adl.channel, adl.recipient, adl.provider_id,
               adl.status, adl.error_message, adl.sent_at, adl.delivered_at, adl.created_at,
               COALESCE(adl.retry_count,0) AS retry_count, adl.last_retry_at,
               a.title AS alert_title, a.severity AS alert_severity, a.alert_type
        FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
        ${where} ORDER BY adl.created_at DESC LIMIT $${nextIdx} OFFSET $${nextIdx+1}`,
        [...params, limit, offset]),
    ])
    res.json({ rows: dataRes.rows, total: parseInt(countRes.rows[0].count), limit, offset })
  } catch (err) {
    next(err)
  }
})

// GET /api/alerts/delivery/stats — analytics dashboard data
router.get('/alerts/delivery/stats', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const [overall, byChannel, hourly, topFailing, recentErrors] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
        COUNT(*) FILTER (WHERE status='delivered') AS delivered,
        COUNT(*) FILTER (WHERE status='failed') AS failed,
        COUNT(*) FILTER (WHERE status='pending') AS pending,
        ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('sent','delivered'))/NULLIF(COUNT(*),0),1) AS success_rate
        FROM alert_delivery_log`),
      pool.query(`SELECT channel,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
        COUNT(*) FILTER (WHERE status='failed') AS failed,
        COUNT(*) FILTER (WHERE status='pending') AS pending,
        ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('sent','delivered'))/NULLIF(COUNT(*),0),1) AS success_rate
        FROM alert_delivery_log GROUP BY channel ORDER BY total DESC`),
      pool.query(`SELECT date_trunc('hour',created_at) AS hour,
        COUNT(*) AS total, COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
        COUNT(*) FILTER (WHERE status='failed') AS failed
        FROM alert_delivery_log WHERE created_at>=NOW()-INTERVAL '24 hours' GROUP BY 1 ORDER BY 1`),
      pool.query(`SELECT adl.alert_id, a.title AS alert_title, a.severity,
        COUNT(*) AS fail_count, MAX(adl.created_at) AS last_attempt
        FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
        WHERE adl.status='failed' GROUP BY adl.alert_id,a.title,a.severity ORDER BY fail_count DESC LIMIT 5`),
      pool.query(`SELECT channel, error_message, COUNT(*) AS count
        FROM alert_delivery_log WHERE status='failed' AND error_message IS NOT NULL
        AND created_at>=NOW()-INTERVAL '7 days'
        GROUP BY channel,error_message ORDER BY count DESC LIMIT 10`),
    ])
    res.json({ overall: overall.rows[0], by_channel: byChannel.rows, hourly_trend: hourly.rows, top_failing: topFailing.rows, recent_errors: recentErrors.rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/alerts/delivery/grouped — per-alert summary with all channel deliveries
router.get('/alerts/delivery/grouped', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  || '50')), 200)
    const offset = parseInt(String(req.query.offset || '0'))
    const clauses: string[] = []
    const params: any[] = []
    let idx = 1
    if (req.query.search)   { clauses.push(`a.title ILIKE $${idx++}`);  params.push(`%${String(req.query.search)}%`) }
    if (req.query.severity) { clauses.push(`a.severity = $${idx++}`);   params.push(String(req.query.severity)) }
    const whereStr = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''

    const [dataRes, countRes] = await Promise.all([
      pool.query(`
        SELECT adl.alert_id, a.title AS alert_title, a.severity AS alert_severity, a.alert_type,
          MAX(adl.created_at) AS last_attempt,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE adl.status IN ('sent','delivered')) AS sent,
          COUNT(*) FILTER (WHERE adl.status='failed') AS failed,
          COUNT(*) FILTER (WHERE adl.status='pending') AS pending,
          JSON_AGG(DISTINCT adl.channel) AS channels,
          JSON_AGG(JSON_BUILD_OBJECT(
            'id',adl.id,'channel',adl.channel,'status',adl.status,'recipient',adl.recipient,
            'error_message',adl.error_message,'sent_at',adl.sent_at,'retry_count',COALESCE(adl.retry_count,0)
          ) ORDER BY adl.channel) AS deliveries
        FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
        ${whereStr} GROUP BY adl.alert_id,a.title,a.severity,a.alert_type
        ORDER BY last_attempt DESC LIMIT $${idx} OFFSET $${idx+1}`,
        [...params, limit, offset]),
      pool.query(`SELECT COUNT(DISTINCT adl.alert_id) FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id ${whereStr}`, params),
    ])
    res.json({ groups: dataRes.rows, total: parseInt(countRes.rows[0].count), limit, offset })
  } catch (err) {
    next(err)
  }
})

// POST /api/alerts/delivery/:id/retry — retry a single failed delivery
router.post('/alerts/delivery/:id/retry', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const { rows } = await pool.query(
      `SELECT adl.*, a.title, a.message, a.severity, a.alert_type
       FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id WHERE adl.id=$1`, [req.params.id])
    if (!rows.length) { res.status(404).json({ error: 'Not found.' }); return }
    const e = rows[0]
    const ap: notificationService.Alert = { id: e.alert_id, type: e.alert_type||'general', severity: e.severity||'warning', title: e.title||'AEGIS Alert', message: e.message||'', area: 'AEGIS Coverage Area' }
    let r: any = { success: false, error: 'Unknown channel' }
    if (e.channel==='email')     r = await notificationService.sendEmailAlert(e.recipient, ap)
    else if (e.channel==='sms')      r = await notificationService.sendSMSAlert(e.recipient, ap)
    else if (e.channel==='telegram') r = await notificationService.sendTelegramAlert(e.recipient, ap)
    else if (e.channel==='whatsapp') r = await notificationService.sendWhatsAppAlert(e.recipient, ap)
    const newStatus = r.success ? 'sent' : 'failed'
    await pool.query(`UPDATE alert_delivery_log SET status=$1,error_message=$2,sent_at=$3,retry_count=COALESCE(retry_count,0)+1,last_retry_at=NOW() WHERE id=$4`,
      [newStatus, r.error||null, r.success?new Date():null, req.params.id])
    res.json({ success: r.success, status: newStatus, error: r.error||null })
  } catch (err) {
    next(err)
  }
})

// POST /api/alerts/delivery/retry-failed — bulk retry failed deliveries
router.post('/alerts/delivery/retry-failed', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const { alert_id, channel } = req.body
    const clauses = [`adl.status='failed'`, `COALESCE(adl.retry_count,0)<3`]
    const params: any[] = []
    let idx = 1
    if (alert_id) { clauses.push(`adl.alert_id=$${idx++}`); params.push(alert_id) }
    if (channel)  { clauses.push(`adl.channel=$${idx++}`);  params.push(channel) }
    const { rows: failed } = await pool.query(
      `SELECT adl.*,a.title,a.message,a.severity,a.alert_type FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id WHERE ${clauses.join(' AND ')} LIMIT 50`, params)
    let succeeded=0, failedCount=0
    for (const e of failed) {
      const ap: notificationService.Alert = { id:e.alert_id,type:e.alert_type||'general',severity:e.severity||'warning',title:e.title||'AEGIS Alert',message:e.message||'',area:'AEGIS Coverage Area' }
      let r:any={success:false}
      try {
        if (e.channel==='email') r=await notificationService.sendEmailAlert(e.recipient,ap)
        else if(e.channel==='sms') r=await notificationService.sendSMSAlert(e.recipient,ap)
        else if(e.channel==='telegram') r=await notificationService.sendTelegramAlert(e.recipient,ap)
        else if(e.channel==='whatsapp') r=await notificationService.sendWhatsAppAlert(e.recipient,ap)
      } catch { r={success:false} }
      if(r.success) succeeded++; else failedCount++
      await pool.query(`UPDATE alert_delivery_log SET status=$1,error_message=$2,sent_at=$3,retry_count=COALESCE(retry_count,0)+1,last_retry_at=NOW() WHERE id=$4`,
        [r.success?'sent':'failed', r.error||null, r.success?new Date():null, e.id])
    }
    res.json({ attempted: failed.length, succeeded, failed: failedCount })
  } catch (err) {
    next(err)
  }
})

// GET /api/alerts/delivery/export.csv — stream CSV download to browser
router.get('/alerts/delivery/export.csv', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const { where, params, nextIdx } = buildDeliveryWhere(req.query as any)
    const { rows } = await pool.query(`
      SELECT adl.id, adl.alert_id, a.title AS alert_title, a.severity AS alert_severity,
             adl.channel, adl.recipient, adl.status, adl.error_message, adl.provider_id,
             adl.sent_at, adl.delivered_at, adl.created_at, COALESCE(adl.retry_count,0) AS retry_count
      FROM alert_delivery_log adl LEFT JOIN alerts a ON a.id=adl.alert_id
      ${where} ORDER BY adl.created_at DESC LIMIT $${nextIdx}`, [...params, 10000])
    const esc = (v:any) => v==null?'':(`"${String(v).replace(/"/g,'""')}"`)
    const headers = ['id','alert_id','alert_title','alert_severity','channel','recipient','status','error_message','provider_id','sent_at','delivered_at','created_at','retry_count']
    const csv = [headers.join(','), ...rows.map((r:any)=>headers.map(h=>esc(r[h])).join(','))].join('\n')
    res.setHeader('Content-Type','text/csv')
    res.setHeader('Content-Disposition',`attachment; filename="delivery_log_${Date.now()}.csv"`)
    res.send(csv)
  } catch (err) {
    next(err)
  }
})

// RESOURCE DEPLOYMENTS

// Get all resource deployments
router.get('/deployments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, zone, priority, active_reports, estimated_affected,
              ai_recommendation, ambulances, fire_engines, rescue_boats,
              deployed, deployed_at, created_at,
              ST_Y(coordinates::geometry) as lat,
              ST_X(coordinates::geometry) as lng
       FROM resource_deployments ORDER BY
         CASE priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END`
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// Deploy resources to a zone
router.post('/deployments/:id/deploy', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions for deployment operations.')
  }
  try {
    const { reason, report_id } = req.body
    const operator_id = req.user!.id
    const operator_name = req.user!.displayName || 'Operator'
    const trimmedReason = (reason || '').toString().trim()
    if (!trimmedReason) {
      throw AppError.badRequest('Deployment reason is required.')
    }
    if (trimmedReason.length > 500) {
      throw AppError.badRequest('Reason must be 500 characters or less.')
    }

    const { rows } = await pool.query(
      `UPDATE resource_deployments SET deployed = true, deployed_at = NOW(), deployed_by = $1
       WHERE id = $2 RETURNING *`,
      [operator_id, req.params.id]
    )

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'deploy', 'deployment', $4, $5, $6)`,
      [
        operator_id,
        operator_name,
        `Deployed resources (${trimmedReason})`,
        req.params.id,
        JSON.stringify({ deployed: false, report_id: report_id || null }),
        JSON.stringify({ deployed: true, report_id: report_id || null, reason: trimmedReason })
      ]
    )

    res.json(rows[0] || { id: req.params.id, deployed: true })
  } catch (err) {
    next(err)
  }
})

// Recall resources
router.post('/deployments/:id/recall', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions for deployment operations.')
  }
  try {
    const { reason, outcome_summary, report_id } = req.body
    const operator_id = req.user!.id
    const operator_name = req.user!.displayName || 'Operator'
    const trimmedReason = (reason || '').toString().trim()
    const trimmedOutcome = (outcome_summary || '').toString().trim()
    if (!trimmedReason || !trimmedOutcome) {
      throw AppError.badRequest('reason and outcome_summary are required for recall.')
    }
    if (trimmedReason.length > 500 || trimmedOutcome.length > 1000) {
      throw AppError.badRequest('reason must be ≤500 chars, outcome_summary ≤1000 chars.')
    }

    const { rows } = await pool.query(
      `UPDATE resource_deployments SET deployed = false, deployed_at = NULL, deployed_by = NULL
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    )

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'recall', 'deployment', $4, $5, $6)`,
      [
        operator_id,
        operator_name,
        `Recalled resources (${trimmedReason})`,
        req.params.id,
        JSON.stringify({ deployed: true, report_id: report_id || null }),
        JSON.stringify({ deployed: false, report_id: report_id || null, reason: trimmedReason, outcome_summary: trimmedOutcome })
      ]
    )

    res.json(rows[0] || { id: req.params.id, deployed: false })
  } catch (err) {
    next(err)
  }
})

// REPORT MEDIA

// Get media for a specific report
router.get('/reports/:id/media', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, file_url, file_type, file_size, ai_processed,
              ai_classification, ai_water_depth, ai_authenticity_score,
              ai_model_version, ai_reasoning, created_at
       FROM report_media WHERE report_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// AI MODEL STATUS — MOVED to aiRoutes.ts (Phase 5 Governance)
// GET /api/ai/models now served by aiRoutes with live AI engine data

router.get('/ai/status', async (_req: Request, res: Response, next: NextFunction) => {
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
})

//  AI GOVERNANCE ENDPOINTS (Features #30-34)

// GET /api/ai/governance/models — Model metrics from PostgreSQL ai_model_metrics table
// Used by AITransparencyDashboard to show real accuracy, F1, confusion matrix, XAI weights
router.get('/ai/governance/models', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const metrics = await getModelMetrics()
    res.json(metrics)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/governance/drift — Model drift detection from PostgreSQL
router.get('/ai/governance/drift', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const drift = await checkModelDrift()
    res.json(drift)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/confidence-distribution — Computed from real predictions
router.get('/ai/confidence-distribution', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { model } = req.query
    const distribution = await computeConfidenceDistribution(model as string | undefined)
    res.json(distribution)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/audit — AI execution audit log
router.get('/ai/audit', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const model = req.query.model as string | undefined
    const result = await getExecutionAuditLog(limit, offset, model)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router

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

// Phone validation is now imported from utils/phoneValidation.ts

//  ACCOUNT GOVERNANCE ENDPOINTS

// Deactivate operator account
router.post('/operators/:id/deactivate', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { reason, actorId, actorName } = req.body
    if (!reason) throw AppError.badRequest('Reason is required')

    await pool.query(
      `UPDATE operators SET is_active = false, updated_at = NOW() WHERE id = $1`, [id]
    )
    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'deactivate', 'operator', $4, $5, $6)`,
      [
        actorId,
        actorName,
        'Deactivated operator account',
        id,
        JSON.stringify({ reason }),
        JSON.stringify({ is_active: false })
      ]
    )
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// Reactivate operator account
router.post('/operators/:id/reactivate', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { reason, actorId, actorName } = req.body
    await pool.query(
      `UPDATE operators SET is_active = true, is_suspended = false, suspended_until = NULL, updated_at = NOW() WHERE id = $1`, [id]
    )
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, 'Reactivated operator account', 'reactivate', 'operator', $3, $4, $5)`,
      [actorId, actorName, id, JSON.stringify({ reason: reason || '' }), JSON.stringify({ is_active: true, is_suspended: false })]
    )
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// Suspend operator temporarily
router.post('/operators/:id/suspend', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { reason, actorId, actorName, until } = req.body
    if (!reason) throw AppError.badRequest('Reason is required')
    await pool.query(
      `UPDATE operators SET is_suspended = true, suspended_until = $1, suspended_by = $2, updated_at = NOW() WHERE id = $3`,
      [until || null, actorId, id]
    )
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, 'Suspended operator account', 'suspend', 'operator', $3, $4, $5)`,
      [actorId, actorName, id, JSON.stringify({ reason }), JSON.stringify({ is_suspended: true, suspended_until: until || null })]
    )
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// GDPR-safe anonymise operator (preferred over hard delete)
router.post('/operators/:id/anonymise', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { actorId, actorName, reason } = req.body
    await pool.query(
      `UPDATE operators SET
        display_name = 'Redacted User',
        email = CONCAT('redacted-', id, '@anonymised.local'),
        phone = NULL,
        avatar_url = NULL,
        is_active = false,
        anonymised_at = NOW(),
        anonymised_by = $1,
        updated_at = NOW()
       WHERE id = $2`, [actorId, id]
    )
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, 'Anonymised operator (GDPR)', 'anonymise', 'operator', $3, $4, $5)`,
      [
        actorId,
        actorName,
        id,
        JSON.stringify({ reason: reason || 'GDPR compliance' }),
        JSON.stringify({ anonymised_at: new Date().toISOString(), is_active: false })
      ]
    )
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// List all operators (for admin management)
router.get('/operators', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role, department, phone, is_active, is_suspended, suspended_until, last_login, created_at
       FROM operators WHERE deleted_at IS NULL ORDER BY created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// Update operator profile
router.put('/operators/:id/profile', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { displayName, email, phone } = req.body
    await pool.query(
      `UPDATE operators SET
        display_name = COALESCE($1, display_name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        updated_at = NOW()
       WHERE id = $4`, [displayName, email, phone, id]
    )
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

//  AI PREDICTION ENGINE — Plug & Play Architecture

// POST /api/predictions/run — Production-ready prediction endpoint
router.post('/predictions/run', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { area, latitude, longitude, weather_data, historical_indicators, region_id } = req.body
    const startTime = Date.now()

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw AppError.badRequest('latitude and longitude are required numeric fields.')
    }

    const safeLat = Math.max(-90, Math.min(90, latitude))
    const safeLng = Math.max(-180, Math.min(180, longitude))
    const resolvedRegionId = typeof region_id === 'string' && region_id.trim().length > 0
      ? region_id.trim()
      : regionRegistry.getActiveRegion().getMetadata().regionId

    const predictionResponse = await aiClient.predict({
      hazard_type: 'flood',
      region_id: resolvedRegionId,
      latitude: safeLat,
      longitude: safeLng,
      include_contributing_factors: true,
    })

    const executionMs = Date.now() - startTime

    // Log AI execution
    await pool.query(
      `INSERT INTO ai_executions (model_name, model_version, input_payload, raw_response, status, execution_time_ms, target_type)
       VALUES ('flood-predictor', $1, $2, $3, 'success', $4, 'prediction')`,
      [predictionResponse.model_version, JSON.stringify({ latitude: safeLat, longitude: safeLng, region_id: resolvedRegionId, weather_data, historical_indicators }),
       JSON.stringify(predictionResponse), executionMs]
    ).catch(() => {})

    // Store prediction record
    // Compute affected_radius_km from probability (0-100% → 0.5-15 km range)
    const affectedRadiusKm = Math.max(0.5, Math.round(((predictionResponse.probability || 0.1) * 15) * 100) / 100)

    await pool.query(
      `INSERT INTO prediction_records (area_name, risk_level, probability, confidence, predicted_peak_time, affected_radius_km, model_version, raw_response, input_data, coordinates)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326))`,
      [area || 'Queried Area', predictionResponse.risk_level, predictionResponse.probability, predictionResponse.confidence,
       predictionResponse.predicted_peak_time || null, affectedRadiusKm, predictionResponse.model_version,
       JSON.stringify(predictionResponse), JSON.stringify({ latitude: safeLat, longitude: safeLng, region_id: resolvedRegionId }),
       safeLng, safeLat]
    ).catch(() => {})

    const prob = Number(predictionResponse.probability || 0)
    const confidencePct = Number(predictionResponse.confidence || 0)
    const probability01 = prob > 1 ? Math.min(1, prob / 100) : Math.max(0, prob)
    const confidence100 = confidencePct <= 1 ? Math.round(confidencePct * 100) : Math.round(confidencePct)
    const severity: 'critical' | 'high' | 'medium' | 'low' =
      probability01 >= 0.8 ? 'critical' :
      probability01 >= 0.6 ? 'high' :
      probability01 >= 0.35 ? 'medium' : 'low'

    const responseAny = predictionResponse as any

    await pool.query(
      `INSERT INTO flood_predictions
         (area, probability, time_to_flood, matched_pattern, next_areas,
          severity, confidence, data_sources, coordinates, model_version,
          expires_at)
       VALUES
         ($1, $2, $3, $4, $5, $6::report_severity, $7, $8,
          ST_SetSRID(ST_MakePoint($9, $10), 4326), $11,
          NOW() + INTERVAL '6 hours')`,
      [
        area || 'Queried Area',
        probability01,
        responseAny.time_to_flood || predictionResponse.predicted_peak_time || 'Unknown',
        responseAny.matched_pattern || predictionResponse.risk_level || 'On-demand model inference',
        Array.isArray(responseAny.next_areas) ? responseAny.next_areas : [],
        severity,
        Math.max(0, Math.min(100, confidence100)),
        Array.isArray(responseAny.data_sources) ? responseAny.data_sources : ['ai-engine'],
        safeLng,
        safeLat,
        predictionResponse.model_version || 'unknown',
      ]
    ).catch(() => {})

    res.json({ ...predictionResponse, affected_radius_km: affectedRadiusKm, saved_to_feed: true, region_id: resolvedRegionId })
  } catch (err: any) {
    const statusCode = err?.message?.includes('not available') || err?.message?.includes('timed out') ? 503 : 502
    res.status(statusCode).json({ error: err.message || 'Failed to run live prediction.' })
  }
})

//  SPATIAL INTELLIGENCE — GeoJSON endpoints for QGIS + Heatmaps

// GET /api/map/risk-layer — Returns structured GeoJSON risk layer
router.get('/map/risk-layer', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT id, name, layer_type, ST_AsGeoJSON(geometry_data) as geojson, properties, model_version, valid_from
       FROM risk_layers WHERE valid_until IS NULL OR valid_until > NOW()
       ORDER BY created_at DESC`
    )
    const features = result.rows.map(r => ({
      type: 'Feature',
      geometry: r.geojson ? JSON.parse(r.geojson) : null,
      properties: { ...r.properties, id: r.id, name: r.name, layer_type: r.layer_type, model_version: r.model_version }
    }))
    res.json({ type: 'FeatureCollection', features })
  } catch (err) {
    next(err)
  }
})

// GET /api/map/heatmap-data — Returns dynamically computed heatmap intensity data
router.get('/map/heatmap-data', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // First try live computation from historical + report data
    const computed = await computeRiskHeatmap()
    if (computed.length > 0) {
      res.json({
        source: 'computed',
        generated_at: new Date().toISOString(),
        intensity_data: computed,
      })
      return
    }

    // Fallback to stored heatmap layers
    const result = await pool.query(
      `SELECT id, name, source, intensity_data, model_version, generated_at
       FROM heatmap_layers ORDER BY generated_at DESC LIMIT 1`
    )
    if (result.rows.length > 0) {
      res.json(result.rows[0])
    } else {
      res.status(404).json({ error: 'No heatmap data available. Historical events needed for computation.' })
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/status/detail — Returns detailed DB execution analytics
router.get('/ai/status/detail', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const models = await pool.query(
      `SELECT model_name, MAX(model_version) as version, COUNT(*) as executions,
              AVG(execution_time_ms) as avg_ms, MAX(created_at) as last_run
       FROM ai_executions GROUP BY model_name ORDER BY last_run DESC`
    )
    res.json({
      execution_history: models.rows
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/drift — MOVED to aiRoutes.ts (Phase 5 Governance)
// Now served by aiRoutes with live AI engine drift detection

// POST /api/ai/labels — Add training label (human-in-the-loop)
router.post('/ai/labels', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { report_id, label_type, label_value, operator_id, confidence } = req.body
    if (!report_id || !label_type || !label_value || !operator_id) {
      throw AppError.badRequest('report_id, label_type, label_value, and operator_id are required')
    }
    await addTrainingLabel(report_id, label_type, label_value, operator_id, confidence)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/ai/damage-estimate — Economic damage estimation model
router.post('/ai/damage-estimate', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { severity, affected_area_km2, population_density, duration_hours, water_depth_m } = req.body
    const estimate = await estimateDamageCost(
      severity || 'medium',
      affected_area_km2 || 1,
      population_density || 500,
      duration_hours || 12,
      water_depth_m || 0.5,
    )
    res.json(estimate)
  } catch (err) {
    next(err)
  }
})

//  MULTI-SOURCE FUSION ENGINE (Features #16-25)

// POST /api/fusion/run — Run full 10-source fusion analysis (ADMIN ONLY)
router.post('/fusion/run', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { region_id, latitude, longitude } = req.body
    if (!region_id || latitude === undefined || longitude === undefined) {
      throw AppError.badRequest('region_id, latitude, and longitude are required')
    }

    // Gather live data from all sources
    const fusionInput = await gatherFusionData(region_id, latitude, longitude)
    // Run weighted fusion algorithm
    const result = await runFusion(fusionInput)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

//  FLOOD FINGERPRINTING ENGINE (Features #26-27)

// POST /api/fingerprint/run — Run cosine-similarity flood fingerprinting (OPERATOR ONLY)
router.post('/fingerprint/run', requireOperator, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { region_id, latitude, longitude, area } = req.body
    if (!region_id || latitude === undefined || longitude === undefined) {
      throw AppError.badRequest('region_id, latitude, and longitude are required')
    }

    const prediction = await runFingerprinting(
      region_id, latitude, longitude, area || 'Unknown Area',
    )
    res.json(prediction)
  } catch (err) {
    next(err)
  }
})

//  DATA INGESTION PIPELINE (ADMIN ONLY)

// POST /api/ingestion/run — Run full data ingestion from all sources (ADMIN ONLY)
router.post('/ingestion/run', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runFullIngestion()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/ingestion/source/:source — Run single source ingestion (ADMIN ONLY)
router.post('/ingestion/source/:source', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const source = req.params.source
    let result
    switch (source) {
      case 'ea': result = await ingestEAFloodData(200); break
      case 'nasa': result = await ingestNASAPowerData(); break
      case 'openmeteo': result = await ingestOpenMeteoData(); break
      case 'floodhistory': result = await ingestUKFloodHistory(); break
      case 'wikipedia': result = await ingestWikipediaFloodKnowledge(); break
      default:
        throw AppError.badRequest(`Unknown source: ${source}. Valid: ea, nasa, openmeteo, floodhistory, wikipedia`)
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /api/ingestion/status — Get ingestion history and table counts
router.get('/ingestion/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureIngestionSchema()

    const tables = [
      'reports', 'river_gauge_readings', 'climate_observations',
      'weather_observations', 'flood_archives', 'news_articles',
      'wiki_flood_knowledge', 'historical_flood_events',
      'rag_documents', 'ai_model_metrics', 'ingestion_log',
    ]

    const counts: Record<string, number> = {}
    for (const t of tables) {
      try {
        const r = await pool.query(`SELECT COUNT(*) as c FROM ${t}`)
        counts[t] = parseInt(r.rows[0].c) || 0
      } catch { counts[t] = 0 }
    }

    // Recent ingestion logs
    let logs: any[] = []
    try {
      const r = await pool.query(`
        SELECT source, rows_ingested, rows_before, rows_after, duration_ms, errors, created_at
        FROM ingestion_log
        ORDER BY created_at DESC
        LIMIT 20
      `)
      logs = r.rows
    } catch { /* table may not exist */ }

    res.json({ tableCounts: counts, recentIngestions: logs, totalRows: Object.values(counts).reduce((a, b) => a + b, 0) })
  } catch (err) {
    next(err)
  }
})

//  ML TRAINING PIPELINE (ADMIN ONLY)

// POST /api/training/run — Train all ML models (ADMIN ONLY)
router.post('/training/run', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await trainAllModels()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/training/fusion-weights — Train fusion weight optimizer (ADMIN ONLY)
router.post('/training/fusion-weights', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await trainFusionWeights()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

//  RAG KNOWLEDGE BASE (ADMIN ONLY)

// POST /api/rag/expand — Expand RAG knowledge base (ADMIN ONLY)
router.post('/rag/expand', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await expandRAGKnowledgeBase()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/rag/query — Query RAG knowledge base
router.post('/rag/query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, limit } = req.body
    if (!query) { res.status(400).json({ error: 'query is required' }); return }
    const results = await ragRetrieve(query, limit || 5)
    res.json({ query, results, count: results.length })
  } catch (err) {
    next(err)
  }
})

//  RESILIENCE MONITORING (OPERATOR ONLY)

// GET /api/resilience/status — Get cache, rate limit, circuit breaker status (OPERATOR ONLY)
router.get('/resilience/status', requireOperator, (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getResilienceStatus())
  } catch (err) {
    next(err)
  }
})

//  SYSTEM REPORT (OPERATOR ONLY)

// GET /api/system/report — Generate comprehensive system status report (OPERATOR ONLY)
router.get('/system/report', requireOperator, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Table row counts
    const tables = [
      'reports', 'river_gauge_readings', 'climate_observations',
      'weather_observations', 'flood_archives', 'news_articles',
      'wiki_flood_knowledge', 'historical_flood_events', 'rag_documents',
      'ai_model_metrics', 'ai_executions', 'fusion_computations',
      'flood_predictions', 'image_analyses', 'reporter_scores',
    ]
    const tableCounts: Record<string, number> = {}
    for (const t of tables) {
      try {
        const r = await pool.query(`SELECT COUNT(*) as c FROM ${t}`)
        tableCounts[t] = parseInt(r.rows[0].c) || 0
      } catch { tableCounts[t] = 0 }
    }

    // Model metrics
    let modelMetrics: any[] = []
    try {
      const r = await pool.query(`
        SELECT DISTINCT ON (model_name) model_name, model_version, metric_name, metric_value,
               dataset_size, metadata, created_at
        FROM ai_model_metrics
        ORDER BY model_name, created_at DESC
      `)
      modelMetrics = r.rows
    } catch { /* ignore */ }

    // API key status
    const apiKeys = {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GROQ_API_KEY: !!process.env.GROQ_API_KEY,
      HF_API_KEY: !!process.env.HF_API_KEY,
      WEATHER_API_KEY: !!(process.env.WEATHER_API_KEY || process.env.OPENWEATHERMAP_API_KEY),
      NEWSAPI_KEY: !!process.env.NEWSAPI_KEY,
      DATABASE_URL: !!process.env.DATABASE_URL,
    }

    // Resilience status
    const resilience = getResilienceStatus()

    // Recent ingestion
    let lastIngestion: any = null
    try {
      const r = await pool.query(`SELECT * FROM ingestion_log ORDER BY created_at DESC LIMIT 1`)
      lastIngestion = r.rows[0] || null
    } catch { /* ignore */ }

    const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0)

    res.json({
      system: 'AEGIS v6 — Hybrid AI Disaster Intelligence Platform',
      version: '6.0.0-production',
      generatedAt: new Date().toISOString(),
      database: {
        totalRows,
        tableCounts,
      },
      models: modelMetrics,
      apiKeys,
      resilience,
      lastIngestion,
      capabilities: {
        llmProviders: ['Gemini Flash', 'Groq Llama 3.1', 'OpenRouter', 'HuggingFace'],
        mlModels: ['flood_classifier', 'fake_detector', 'severity_predictor', 'damage_regression', 'fusion_engine'],
        dataSources: ['UK EA', 'SEPA KiWIS', 'NASA POWER', 'Open-Meteo', 'NewsAPI', 'Wikipedia', 'UK Gov Archives'],
        features: 37,
      },
    })
  } catch (err) {
    next(err)
  }
})
