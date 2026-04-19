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
 * - /departments — Department listings
 * - /subscriptions — Alert subscription management
 * - /audit — Audit log query (admin)
 * - /community — Community help coordination
 * - /predictions — Flood predictions and pre-alerts
 * - /notifications — Notification channel management
 * - /governance — AI governance dashboard
 * - /fusion — Multi-source data fusion
 * */
import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
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
import { computeConfidenceDistribution, getExecutionAuditLog, addTrainingLabel, computeRiskHeatmap, estimateDamageCost, getModelMetrics, checkModelDrift, generateBiasReport, checkGovernanceHealth } from '../services/governanceEngine.js'
import { getClassifierHealth } from '../services/classifierRouter.js'
import { runFingerprinting, getActivePredictions, sendPreAlert } from '../services/floodFingerprinting.js'
import { gatherFusionData, runFusion } from '../services/fusionEngine.js'
import { ensureIngestionSchema, runFullIngestion, ingestEAFloodData, ingestNASAPowerData, ingestOpenMeteoData, ingestUKFloodHistory, ingestWikipediaFloodKnowledge } from '../services/dataIngestionService.js'
import { expandRAGKnowledgeBase, ragRetrieve } from '../services/ragExpansionService.js'
import { trainAllModels, trainFusionWeights } from '../services/mlTrainingPipeline.js'
import { getResilienceStatus } from '../services/resilienceLayer.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'
import { broadcastAlert } from '../services/socket.js'

const router = Router()

// Rate limiter for public subscription endpoints (prevent abuse)
const subscriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many subscription requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Maps hazard type + priority to recommended resource counts per deployment zone
function getResourceRecommendation(hazardType: string, priority: 'Critical' | 'High'): { ambulances: number; fire_engines: number; rescue_boats: number } {
  const isCritical = priority === 'Critical'
  const h = (hazardType || '').toLowerCase()

  // Water/coastal - rescue boats are the priority
  if (['flood', 'tsunami', 'coastal', 'flash_flood'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 2 : 1, rescue_boats: isCritical ? 6 : 3 }
  }
  // Wildfire - fire engines dominant
  if (['wildfire', 'fire', 'burn'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 8 : 4, rescue_boats: 0 }
  }
  // Volcanic - hazmat + structural + evacuation mix
  if (['volcanic', 'volcano', 'lava', 'ash'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 5 : 3, fire_engines: isCritical ? 3 : 2, rescue_boats: isCritical ? 1 : 0 }
  }
  // Structural/seismic - heavy search & rescue
  if (['earthquake', 'seismic', 'building_collapse', 'structural', 'landslide', 'avalanche', 'sinkhole', 'debris', 'bridge_damage', 'road_damage'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 6 : 3, fire_engines: isCritical ? 4 : 2, rescue_boats: 0 }
  }
  // Hazmat/chemical/environmental
  if (['chemical', 'gas_leak', 'hazmat', 'pollution', 'contamination', 'environmental_hazard', 'environmental', 'radiation'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 5 : 3, fire_engines: isCritical ? 3 : 2, rescue_boats: 0 }
  }
  // Medical/mass casualty - ambulances are the priority
  if (['medical', 'mass_casualty', 'casualty'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 10 : 5, fire_engines: isCritical ? 2 : 1, rescue_boats: 0 }
  }
  // Storm/wind/tornado/hurricane
  if (['storm', 'tornado', 'hurricane', 'typhoon', 'cyclone', 'severe_storm'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 3 : 2, rescue_boats: isCritical ? 3 : 1 }
  }
  // Extreme weather - heatwave/drought
  if (['heatwave', 'heat', 'drought'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 6 : 3, fire_engines: isCritical ? 2 : 1, rescue_boats: 0 }
  }
  // Infrastructure - power/water/road
  if (['infrastructure', 'power_line', 'power_outage', 'water_main', 'water_supply'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 2 : 1, fire_engines: isCritical ? 2 : 1, rescue_boats: 0 }
  }
  // Public safety - trapped/missing/evacuation
  if (['public_safety', 'person_trapped', 'missing', 'evacuation', 'hazardous_area'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 2 : 1, rescue_boats: isCritical ? 1 : 0 }
  }
  // Fallback for unknown hazard types
  return { ambulances: isCritical ? 3 : 2, fire_engines: isCritical ? 2 : 1, rescue_boats: isCritical ? 1 : 0 }
}
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
router.post('/subscriptions', subscriptionLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter, subscriber_name } = req.body
    const normalizedChannels = normalizeChannels(channels)

    // Detect if the request comes from a signed-in citizen (vs anonymous visitor).
    // Citizens carry a Bearer JWT with role='citizen'.  Operators are excluded so
    // their staff tokens never accidentally claim a citizen subscription.
    let citizenId: string | null = null
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken<any>(authHeader.split(' ')[1])
        if (typeof decoded?.id === 'string' && String(decoded?.role || '').toLowerCase() === 'citizen') {
          citizenId = decoded.id
        }
      } catch {
        // Invalid / expired token — treat as anonymous subscription
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
      `INSERT INTO alert_subscriptions (citizen_id, email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter, verification_token, verified, consent_given, consent_timestamp, subscriber_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, true, true, NOW(), $13)
       ON CONFLICT (email) WHERE email IS NOT NULL
       DO UPDATE SET citizen_id = COALESCE(EXCLUDED.citizen_id, alert_subscriptions.citizen_id), phone = EXCLUDED.phone, telegram_id = EXCLUDED.telegram_id, whatsapp = EXCLUDED.whatsapp, channels = EXCLUDED.channels, location_lat = EXCLUDED.location_lat, location_lng = EXCLUDED.location_lng, radius_km = EXCLUDED.radius_km, severity_filter = EXCLUDED.severity_filter, topic_filter = EXCLUDED.topic_filter, subscriber_name = EXCLUDED.subscriber_name, updated_at = NOW()
       RETURNING id, channels, verified, topic_filter, citizen_id IS NOT NULL AS is_authenticated`,
      [citizenId, email || null, phone || null, telegram_id || null, whatsapp || phone || null, normalizedChannels, location_lat || null, location_lng || null, radius_km || 50, severity_filter || ['critical', 'warning', 'info'], normalizedTopics, verificationToken, subscriber_name || null]
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
    const ip = req.ip || 'unknown'
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
  } catch (err) {
    next(err)
  }
})

// COMMUNITY HELP

// List all active help offers/requests
router.get('/community', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

// Update status (fulfil, cancel, expire)
router.put('/community/:id/status', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body
    if (!status || !['fulfilled', 'cancelled', 'expired', 'active'].includes(status)) {
      throw AppError.badRequest('Invalid status.')
    }
    // Only the creator (or an operator) can update status
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

// Get all active flood predictions, deduplicated to latest per area
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

    // Send to all subscribers (email, SMS, WhatsApp, Telegram)
    const deliveryResults = await notificationService.sendAlertToSubscribers(
      alert,
      subscriptions.rows
    )

    // Also send Web Push to all active push subscriptions
    try {
      const pushSubs = await pool.query(
        `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE active = true`
      )
      const expiredEndpoints: string[] = []
      for (const ps of pushSubs.rows) {
        if (ps.endpoint && ps.p256dh && ps.auth) {
          const pushResult = await notificationService.sendWebPushAlert(
            { endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } },
            alert
          )
          deliveryResults.results.push(pushResult)
          deliveryResults.total++
          if (pushResult.success) deliveryResults.successful++
          else {
            deliveryResults.failed++
            if (pushResult.expired) expiredEndpoints.push(ps.endpoint)
          }
        }
      }
      if (expiredEndpoints.length > 0) {
        await pool.query(
          `UPDATE push_subscriptions SET active = false WHERE endpoint = ANY($1::text[])`,
          [expiredEndpoints]
        )
        logger.info({ count: expiredEndpoints.length }, 'Deactivated expired push subscriptions (flood pre-alert)')
      }
    } catch (pushErr: any) {
      logger.warn({ err: pushErr }, 'Web Push flood pre-alert error')
    }

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

// Verify that a Web Push endpoint is still active in the database.
// Called by the client on load to detect stale FCM subscriptions.
router.get('/notifications/verify-subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { endpoint } = req.query
    if (!endpoint || typeof endpoint !== 'string') {
      res.status(400).json({ active: false, error: 'endpoint query parameter is required' })
      return
    }
    const { rows } = await pool.query(
      'SELECT active FROM push_subscriptions WHERE endpoint = $1 LIMIT 1',
      [endpoint]
    )
    if (rows.length === 0) {
      res.json({ active: false })
    } else {
      res.json({ active: rows[0].active === true })
    }
  } catch (err) {
    next(err)
  }
})

// Subscribe to Web Push notifications
router.post('/notifications/subscribe', subscriptionLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subscription, email } = req.body

    // Derive user_id from auth token if present - never trust the body
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
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::uuid)
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
      const expiredEndpoints: string[] = []
      for (const ps of pushSubs.rows) {
        if (ps.endpoint && ps.p256dh && ps.auth) {
          const pushResult = await notificationService.sendWebPushAlert(
            { endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } },
            alert
          )
          deliveryResults.results.push(pushResult)
          deliveryResults.total++
          if (pushResult.success) deliveryResults.successful++
          else {
            deliveryResults.failed++
            // 410 Gone / 404 Not Found means the endpoint is permanently gone
            if (pushResult.expired) expiredEndpoints.push(ps.endpoint)
          }
        }
      }
      // Bulk-deactivate expired endpoints so they don't accumulate
      if (expiredEndpoints.length > 0) {
        await pool.query(
          `UPDATE push_subscriptions SET active = false WHERE endpoint = ANY($1::text[])`,
          [expiredEndpoints]
        )
        logger.info({ count: expiredEndpoints.length }, 'Deactivated expired push subscriptions')
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
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
      [
        safeOperatorId,
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

    // Real-time Socket.IO push to all connected clients (fastest path)
    broadcastAlert({
      id: alertId,
      type: alert_type || 'general',
      severity,
      title,
      message,
      area,
      actionRequired: action_required,
      issuedAt: new Date().toISOString(),
    })

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

// ALERT DELIVERY LOG

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

// GET /api/alerts/delivery - paginated, filtered, joined with alert title
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

// GET /api/alerts/delivery/stats - analytics dashboard data
router.get('/alerts/delivery/stats', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions.' }); return }
  try {
    const [overall, byChannel, hourly, topFailing, recentErrors, subscriberStats] = await Promise.all([
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
      pool.query(`SELECT
        COUNT(*) AS total_subscribers,
        COUNT(*) FILTER (WHERE verified = true) AS verified_subscribers,
        COUNT(*) FILTER (WHERE verified = false) AS unverified_subscribers,
        COUNT(*) FILTER (WHERE 'email' = ANY(channels)) AS email_subscribers,
        COUNT(*) FILTER (WHERE 'sms' = ANY(channels)) AS sms_subscribers,
        COUNT(*) FILTER (WHERE 'whatsapp' = ANY(channels)) AS whatsapp_subscribers,
        COUNT(*) FILTER (WHERE 'telegram' = ANY(channels)) AS telegram_subscribers,
        COUNT(*) FILTER (WHERE 'web' = ANY(channels) OR 'webpush' = ANY(channels)) AS webpush_subscribers
        FROM alert_subscriptions`),
    ])
    res.json({ overall: overall.rows[0], by_channel: byChannel.rows, hourly_trend: hourly.rows, top_failing: topFailing.rows, recent_errors: recentErrors.rows, subscribers: subscriberStats.rows[0] })
  } catch (err) {
    next(err)
  }
})

// GET /api/alerts/delivery/grouped - per-alert summary with all channel deliveries
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

// POST /api/alerts/delivery/:id/retry - retry a single failed delivery
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

// POST /api/alerts/delivery/retry-failed - bulk retry failed deliveries
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

// GET /api/alerts/delivery/export.csv - stream CSV download
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
      `SELECT d.id, d.zone, d.priority, d.active_reports, d.estimated_affected,
              d.ai_recommendation, d.ambulances, d.fire_engines, d.rescue_boats,
              d.deployed, d.deployed_at, d.deployed_by, d.created_at, d.updated_at,
              d.report_id, d.prediction_id, d.is_ai_draft, d.ai_draft_acknowledged_at, d.ai_draft_acknowledged_by,
              d.ops_log, d.needs_mutual_aid, d.incident_commander, d.hazard_type,
              ST_Y(d.coordinates::geometry) as lat,
              ST_X(d.coordinates::geometry) as lng,
              r.report_number
       FROM resource_deployments d
       LEFT JOIN reports r ON d.report_id = r.id
       ORDER BY
         CASE d.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END`
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
    const { reason, outcome_summary, ai_feedback } = req.body
    const operator_id = req.user!.id
    const operator_name = req.user!.displayName || 'Operator'
    const trimmedReason = (reason || '').toString().trim()
    const trimmedOutcome = (outcome_summary || '').toString().trim()
    if (!trimmedReason || !trimmedOutcome) {
      throw AppError.badRequest('reason and outcome_summary are required for recall.')
    }
    if (trimmedReason.length > 500 || trimmedOutcome.length > 1000) {
      throw AppError.badRequest('reason must be =500 chars, outcome_summary =1000 chars.')
    }

    const { rows } = await pool.query(
      `UPDATE resource_deployments SET deployed = false, deployed_at = NULL, deployed_by = NULL
       WHERE id = $1 RETURNING *,
             ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng`,
      [req.params.id]
    )
    if (!rows.length) throw AppError.notFound('Deployment zone not found.')
    const zone = rows[0]

    // Module 5a: Auto-resolve linked report on recall
    let reportResolved = false
    if (zone.report_id) {
      try {
        const rRes = await pool.query(
          `UPDATE reports SET status = 'resolved', resolved_at = NOW()
           WHERE id = $1 AND status NOT IN ('archived', 'false_report', 'resolved')
           RETURNING id`,
          [zone.report_id]
        )
        reportResolved = rRes.rows.length > 0
      } catch { /* non-critical */ }
    }

    // Module 5b: Submit AI prediction feedback signal + log
    const validFeedbacks = ['correct', 'incorrect', 'uncertain']
    const feedback = validFeedbacks.includes(ai_feedback) ? ai_feedback : 'correct'
    let feedbackLogged = false
    if (zone.prediction_id) {
      try {
        await aiClient.submitPredictionFeedback(zone.prediction_id, feedback)
        await pool.query(
          `INSERT INTO ai_dispatch_feedback (prediction_id, deployment_id, feedback, outcome_notes, submitted_by)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [zone.prediction_id, zone.id, feedback, trimmedOutcome, operator_id]
        )
        feedbackLogged = true
      } catch { /* non-critical */ }
    }

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'recall', 'deployment', $4, $5, $6)`,
      [
        operator_id,
        operator_name,
        `Recalled resources (${trimmedReason})`,
        req.params.id,
        JSON.stringify({ deployed: true }),
        JSON.stringify({ deployed: false, reason: trimmedReason, outcome_summary: trimmedOutcome, report_resolved: reportResolved })
      ]
    )

    res.json({ ...zone, report_resolved: reportResolved, feedback_logged: feedbackLogged })
  } catch (err) {
    next(err)
  }
})

// Create a new deployment zone
router.post('/deployments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
  try {
    const { zone, priority, active_reports, estimated_affected, ai_recommendation, ambulances, fire_engines, rescue_boats, lat, lng, report_id, prediction_id, is_ai_draft, hazard_type } = req.body

    const zoneName = (zone || '').toString().trim()
    if (!zoneName) throw AppError.badRequest('Zone name is required.')
    if (zoneName.length > 100) throw AppError.badRequest('Zone name must be 100 characters or less.')

    const validPriorities = ['Critical', 'High', 'Medium', 'Low']
    const zonePriority = validPriorities.includes(priority) ? priority : 'Medium'

    const parsedAmbulances = Math.max(0, parseInt(ambulances, 10) || 0)
    const parsedFireEngines = Math.max(0, parseInt(fire_engines, 10) || 0)
    const parsedRescueBoats = Math.max(0, parseInt(rescue_boats, 10) || 0)
    const parsedReports = Math.max(0, parseInt(active_reports, 10) || 0)

    const parsedLat = parseFloat(lat)
    const parsedLng = parseFloat(lng)
    const hasCoords = !isNaN(parsedLat) && !isNaN(parsedLng) &&
                      parsedLat >= -90 && parsedLat <= 90 &&
                      parsedLng >= -180 && parsedLng <= 180

    // Validate optional FK UUIDs to prevent injection
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const safeReportId = (report_id && UUID_RE.test(report_id)) ? report_id : null
    const safePredictionId = (prediction_id && UUID_RE.test(prediction_id)) ? prediction_id : null
    const isAiDraft = is_ai_draft === true || is_ai_draft === 'true'
    const safeHazardType = (hazard_type || 'general').toString().trim().slice(0, 80).replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'general'

    const RETURN_COLS = `id, zone, priority, active_reports, estimated_affected, ai_recommendation,
                 ambulances, fire_engines, rescue_boats, deployed, deployed_at, created_at,
                 report_id, prediction_id, is_ai_draft, hazard_type,
                 ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng`

    let insertSql: string
    let insertParams: any[]
    if (hasCoords) {
      insertSql = `INSERT INTO resource_deployments
         (zone, priority, active_reports, estimated_affected, ai_recommendation,
          ambulances, fire_engines, rescue_boats, coordinates,
          report_id, prediction_id, is_ai_draft, hazard_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326), $11, $12, $13, $14)
       RETURNING ${RETURN_COLS}`
      insertParams = [zoneName, zonePriority, parsedReports, estimated_affected || null, ai_recommendation || null,
                      parsedAmbulances, parsedFireEngines, parsedRescueBoats, parsedLng, parsedLat,
                      safeReportId, safePredictionId, isAiDraft, safeHazardType]
    } else {
      insertSql = `INSERT INTO resource_deployments
         (zone, priority, active_reports, estimated_affected, ai_recommendation,
          ambulances, fire_engines, rescue_boats, coordinates,
          report_id, prediction_id, is_ai_draft, hazard_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11, $12)
       RETURNING ${RETURN_COLS}`
      insertParams = [zoneName, zonePriority, parsedReports, estimated_affected || null, ai_recommendation || null,
                      parsedAmbulances, parsedFireEngines, parsedRescueBoats,
                      safeReportId, safePredictionId, isAiDraft, safeHazardType]
    }

    const { rows } = await pool.query(insertSql, insertParams)

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'create', 'deployment', $4, $5, $6)`,
      [
        req.user!.id,
        req.user!.displayName || 'Operator',
        `Created deployment zone: ${zoneName}`,
        rows[0].id,
        JSON.stringify({}),
        JSON.stringify({ zone: zoneName, priority: zonePriority }),
      ]
    )

    // Critical zone escalation - notify all active admin/operator staff
    if (zonePriority === 'Critical') {
      try {
        const { rows: staffRows } = await pool.query(
          `SELECT DISTINCT o.email, o.phone, s.telegram_id, s.channels
           FROM operators o
           LEFT JOIN alert_subscriptions s ON s.email = o.email AND s.verified = true
           WHERE o.role IN ('admin', 'operator') AND o.deleted_at IS NULL AND o.is_active = true`
        )
        const criticalAlert: notificationService.Alert = {
          id: rows[0].id,
          type: 'flood',
          severity: 'critical',
          title: `CRITICAL Zone Activated: ${zoneName}`,
          message: `Deployment zone "${zoneName}" created at CRITICAL priority. Immediate command attention required.`,
          area: zoneName,
          actionRequired: 'Review zone immediately and dispatch resources.',
        }
        for (const staff of staffRows) {
          const channels = Array.isArray(staff.channels) && staff.channels.length > 0 ? staff.channels : ['email']
          const recipient: notificationService.AlertRecipient = {
            email: staff.email, phone: staff.phone || undefined, telegram_id: staff.telegram_id || undefined,
          }
          notificationService.sendMultiChannelAlert(recipient, criticalAlert, channels).catch(() => {})
        }
      } catch { /* notification failure must not block zone creation */ }
    }

    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

// Delete a deployment zone
router.delete('/deployments/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    throw AppError.forbidden('Only admins can delete deployment zones.')
  }
  try {
    const { rows } = await pool.query(
      `DELETE FROM resource_deployments WHERE id = $1 RETURNING id, zone`,
      [req.params.id]
    )
    if (!rows.length) throw AppError.notFound('Deployment zone not found.')

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'delete', 'deployment', $4, $5, $6)`,
      [
        req.user!.id,
        req.user!.displayName || 'Admin',
        `Deleted deployment zone: ${rows[0].zone}`,
        rows[0].id,
        JSON.stringify({ zone: rows[0].zone }),
        JSON.stringify({}),
      ]
    )

    res.json({ deleted: true, id: rows[0].id })
  } catch (err) {
    next(err)
  }
})

// Update a deployment zone (inline edit)
router.patch('/deployments/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
  try {
    const { zone, priority, active_reports, estimated_affected, ai_recommendation,
            ambulances, fire_engines, rescue_boats, hazard_type, incident_commander } = req.body
    const validPriorities = ['Critical', 'High', 'Medium', 'Low']
    const updates: string[] = []
    const params: any[] = []
    let pIdx = 1

    if (zone !== undefined) {
      const z = (zone || '').toString().trim().slice(0, 100)
      if (!z) throw AppError.badRequest('Zone name cannot be empty.')
      updates.push(`zone = $${pIdx++}`); params.push(z)
    }
    if (priority !== undefined && validPriorities.includes(priority)) {
      updates.push(`priority = $${pIdx++}`); params.push(priority)
    }
    if (active_reports !== undefined) {
      updates.push(`active_reports = $${pIdx++}`); params.push(Math.max(0, parseInt(active_reports, 10) || 0))
    }
    if (estimated_affected !== undefined) {
      updates.push(`estimated_affected = $${pIdx++}`); params.push((estimated_affected || '').toString().trim().slice(0, 200) || null)
    }
    if (ai_recommendation !== undefined) {
      updates.push(`ai_recommendation = $${pIdx++}`); params.push((ai_recommendation || '').toString().trim().slice(0, 2000) || null)
    }
    if (ambulances !== undefined) {
      updates.push(`ambulances = $${pIdx++}`); params.push(Math.max(0, parseInt(ambulances, 10) || 0))
    }
    if (fire_engines !== undefined) {
      updates.push(`fire_engines = $${pIdx++}`); params.push(Math.max(0, parseInt(fire_engines, 10) || 0))
    }
    if (rescue_boats !== undefined) {
      updates.push(`rescue_boats = $${pIdx++}`); params.push(Math.max(0, parseInt(rescue_boats, 10) || 0))
    }
    if (hazard_type !== undefined) {
      const ht = (hazard_type || 'general').toString().trim().slice(0, 80).replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'general'
      updates.push(`hazard_type = $${pIdx++}`); params.push(ht)
    }
    if (incident_commander !== undefined) {
      const ic = (incident_commander || '').toString().trim().slice(0, 200) || null
      updates.push(`incident_commander = $${pIdx++}`); params.push(ic)
    }
    if (!updates.length) throw AppError.badRequest('No valid fields to update.')

    updates.push(`updated_at = NOW()`)
    params.push(req.params.id)
    const { rows } = await pool.query(
      `UPDATE resource_deployments SET ${updates.join(', ')} WHERE id = $${pIdx}
       RETURNING id, zone, priority, active_reports, estimated_affected, ai_recommendation,
                 ambulances, fire_engines, rescue_boats, deployed, deployed_at, deployed_by,
                 created_at, updated_at, report_id, prediction_id, is_ai_draft,
                 ai_draft_acknowledged_at, ai_draft_acknowledged_by,
                 ops_log, needs_mutual_aid, incident_commander, hazard_type,
                 ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng`,
      params
    )
    if (!rows.length) throw AppError.notFound('Deployment zone not found.')

    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'update', 'deployment', $4, $5, $6)`,
      [req.user!.id, req.user!.displayName || 'Operator', `Updated zone: ${rows[0].zone}`,
       rows[0].id, JSON.stringify({}), JSON.stringify(rows[0])]
    )

    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// Acknowledge an AI draft deployment zone (operator review step)
router.patch('/deployments/:id/acknowledge', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { rows } = await pool.query(
      `UPDATE resource_deployments
       SET ai_draft_acknowledged_at = NOW(),
           ai_draft_acknowledged_by = $1
       WHERE id = $2
       RETURNING id, ai_draft_acknowledged_at, ai_draft_acknowledged_by`,
      [req.user!.id, req.params.id]
    )
    if (!rows.length) throw AppError.notFound('Deployment zone not found.')
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, $3, 'verify', 'deployment', $4, $5, $6)`,
      [req.user!.id, req.user!.displayName || 'Operator', `Acknowledged AI draft zone`,
       req.params.id, JSON.stringify({ ai_draft_acknowledged_at: null }), JSON.stringify({ ai_draft_acknowledged_at: rows[0].ai_draft_acknowledged_at })]
    )
    res.json(rows[0])
  } catch (err) { next(err) }
})

// Add an ICS ops-log entry to a deployment zone
router.patch('/deployments/:id/ops-log', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { note } = req.body
    const trimmedNote = (note || '').toString().trim().slice(0, 500)
    if (!trimmedNote) throw AppError.badRequest('note is required.')
    const entry = { ts: new Date().toISOString(), operator: req.user!.displayName || 'Operator', note: trimmedNote }
    const { rows } = await pool.query(
      `UPDATE resource_deployments
       SET ops_log = ops_log || $1::jsonb
       WHERE id = $2
       RETURNING id, ops_log`,
      [JSON.stringify(entry), req.params.id]
    )
    if (!rows.length) throw AppError.notFound('Deployment zone not found.')
    res.json({ id: rows[0].id, ops_log: rows[0].ops_log })
  } catch (err) { next(err) }
})

// Toggle mutual aid flag on a deployment zone
router.patch('/deployments/:id/mutual-aid', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { needs_mutual_aid, incident_commander } = req.body
    const updates: string[] = []
    const params: any[] = []
    let pIdx = 1
    if (typeof needs_mutual_aid === 'boolean') { updates.push(`needs_mutual_aid = $${pIdx++}`); params.push(needs_mutual_aid) }
    if (incident_commander !== undefined) {
      const ic = (incident_commander || '').toString().trim().slice(0, 200) || null
      updates.push(`incident_commander = $${pIdx++}`); params.push(ic)
    }
    if (!updates.length) throw AppError.badRequest('Nothing to update.')
    params.push(req.params.id)
    const { rows } = await pool.query(
      `UPDATE resource_deployments SET ${updates.join(', ')} WHERE id = $${pIdx}
       RETURNING id, needs_mutual_aid, incident_commander`,
      params
    )
    if (!rows.length) throw AppError.notFound('Deployment zone not found.')
    res.json(rows[0])
  } catch (err) { next(err) }
})

// DEPLOYMENT ASSETS (per-vehicle GPS tracking)

// List assets for a zone
router.get('/deployments/:id/assets', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { rows } = await pool.query(
      `SELECT id, deployment_id, asset_type, call_sign, status, crew_count,
              last_lat, last_lng, last_seen_at, notes, created_at
       FROM deployment_assets WHERE deployment_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// Add asset to a zone
router.post('/deployments/:id/assets', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { asset_type, call_sign, status, crew_count, notes } = req.body
    const validTypes = ['ambulance', 'fire_engine', 'rescue_boat', 'helicopter', 'hazmat_unit', 'police', 'medical_unit', 'urban_search_rescue', 'other']
    const validStatuses = ['staging', 'en_route', 'on_site', 'returning', 'available', 'off_duty']
    const safeType = validTypes.includes(asset_type) ? asset_type : 'other'
    const safeStatus = validStatuses.includes(status) ? status : 'staging'
    const safeCallSign = (call_sign || '').toString().trim().slice(0, 50)
    if (!safeCallSign) throw AppError.badRequest('call_sign is required.')
    const { rows } = await pool.query(
      `INSERT INTO deployment_assets (deployment_id, asset_type, call_sign, status, crew_count, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, deployment_id, asset_type, call_sign, status, crew_count, last_lat, last_lng, last_seen_at, notes, created_at`,
      [req.params.id, safeType, safeCallSign, safeStatus,
       Math.max(0, parseInt(crew_count, 10) || 0),
       (notes || '').toString().trim().slice(0, 500) || null]
    )
    res.status(201).json(rows[0])
  } catch (err) { next(err) }
})

// Update asset status / GPS - must precede /:id routes to avoid conflicts
router.patch('/deployments/assets/:assetId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { status, last_lat, last_lng, crew_count, notes } = req.body
    const validStatuses = ['staging', 'en_route', 'on_site', 'returning', 'available', 'off_duty']
    const updates: string[] = []
    const params: any[] = []
    let pIdx = 1
    if (status !== undefined && validStatuses.includes(status)) { updates.push(`status = $${pIdx++}`); params.push(status) }
    const lat = parseFloat(last_lat), lng = parseFloat(last_lng)
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      updates.push(`last_lat = $${pIdx++}`); params.push(lat)
      updates.push(`last_lng = $${pIdx++}`); params.push(lng)
      updates.push(`last_seen_at = NOW()`)
    }
    if (crew_count !== undefined) { updates.push(`crew_count = $${pIdx++}`); params.push(Math.max(0, parseInt(crew_count, 10) || 0)) }
    if (notes !== undefined) { updates.push(`notes = $${pIdx++}`); params.push((notes || '').toString().trim().slice(0, 500) || null) }
    if (!updates.length) throw AppError.badRequest('No valid fields to update.')
    params.push(req.params.assetId)
    const { rows } = await pool.query(
      `UPDATE deployment_assets SET ${updates.join(', ')} WHERE id = $${pIdx}
       RETURNING id, deployment_id, asset_type, call_sign, status, crew_count, last_lat, last_lng, last_seen_at, notes`,
      params
    )
    if (!rows.length) throw AppError.notFound('Asset not found.')
    res.json(rows[0])
  } catch (err) { next(err) }
})

// Delete an asset
router.delete('/deployments/assets/:assetId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
  try {
    const { rows } = await pool.query(
      `DELETE FROM deployment_assets WHERE id = $1 RETURNING id`,
      [req.params.assetId]
    )
    if (!rows.length) throw AppError.notFound('Asset not found.')
    res.json({ deleted: true, id: rows[0].id })
  } catch (err) { next(err) }
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

// AI MODEL STATUS (detailed model endpoints moved to aiRoutes.ts)

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

// AI GOVERNANCE ENDPOINTS

// GET /api/ai/governance/models - used by AITransparencyDashboard for accuracy, F1, etc.
router.get('/ai/governance/models', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const metrics = await getModelMetrics()
    res.json(metrics)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/governance/drift - model drift detection
router.get('/ai/governance/drift', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const drift = await checkModelDrift()
    res.json(drift)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/governance/bias - bias report (location, severity, temporal, language)
router.get('/ai/governance/bias', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const report = await generateBiasReport()
    res.json(report)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/governance/health - auto-verifications, flagging rates, backlog
router.get('/ai/governance/health', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const health = await checkGovernanceHealth()
    res.json(health)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/classifier/health - circuit breaker status for HF classifiers
router.get('/ai/classifier/health', authMiddleware, requireOperator, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const health = getClassifierHealth()
    res.json({ models: health, timestamp: new Date().toISOString() })
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/confidence-distribution - computed from real predictions
router.get('/ai/confidence-distribution', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { model } = req.query
    const distribution = await computeConfidenceDistribution(model as string | undefined)
    res.json(distribution)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/audit - AI execution audit log
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

// ─── Safe Zone / Shelter Capacity Alerts ─────────────────────────────────────

/**
 * PATCH /api/shelters/:id/occupancy
 * Operator updates current occupancy. When a shelter reaches ≥ 90% capacity
 * or becomes full, an alert is automatically broadcast to all verified
 * subscribers within the shelter's vicinity.
 */
router.patch('/shelters/:id/occupancy', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shelterId = parseInt(req.params.id, 10)
    const { current_occupancy, operator_name } = req.body

    if (!Number.isInteger(shelterId) || shelterId < 1) {
      throw AppError.badRequest('Invalid shelter id')
    }
    if (typeof current_occupancy !== 'number' || current_occupancy < 0) {
      throw AppError.badRequest('current_occupancy must be a non-negative number')
    }

    const { rows } = await pool.query(
      `UPDATE shelters SET current_occupancy = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, capacity, current_occupancy,
                 ST_Y(coordinates::geometry) as lat,
                 ST_X(coordinates::geometry) as lng`,
      [current_occupancy, shelterId]
    )

    if (rows.length === 0) {
      throw AppError.notFound('Shelter not found')
    }

    const shelter = rows[0]
    const occupancyPct = shelter.capacity > 0
      ? (shelter.current_occupancy / shelter.capacity) * 100
      : 0

    // Trigger alert when shelter is ≥ 90% full or at capacity
    let alertSent = false
    if (shelter.capacity > 0 && occupancyPct >= 90) {
      const isFull = current_occupancy >= shelter.capacity
      const severity = isFull ? 'critical' : 'warning'
      const title = isFull
        ? `Safe Zone Full: ${shelter.name}`
        : `Safe Zone Near Capacity: ${shelter.name}`
      const message = isFull
        ? `${shelter.name} has reached maximum capacity (${shelter.capacity} people). Please proceed to an alternative shelter.`
        : `${shelter.name} is ${Math.round(occupancyPct)}% full (${shelter.current_occupancy}/${shelter.capacity}). Limited spaces remaining.`

      // Notify subscribers near the shelter
      const subResult = await pool.query(
        `SELECT id, email, phone, telegram_id, whatsapp, channels, verified
         FROM alert_subscriptions
         WHERE verified = true
           AND severity_filter && ARRAY[$1]::text[]
           AND (
             location_lat IS NULL OR location_lng IS NULL
             OR ST_DWithin(
               ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography,
               ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
               COALESCE(radius_km, 50) * 1000
             )
           )`,
        [severity, shelter.lat ?? null, shelter.lng ?? null]
      )

      if (subResult.rows.length > 0) {
        const alert: notificationService.Alert = {
          id: `shelter-${shelterId}-${Date.now()}`,
          type: 'safe_zone',
          severity,
          title,
          message,
          area: shelter.name,
          actionRequired: isFull ? 'Seek an alternative shelter immediately.' : 'Consider alternative shelters if possible.',
        }

        await notificationService.sendAlertToSubscribers(alert, subResult.rows)

        // Also send web push
        const pushSubs = await pool.query(
          `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE active = true`
        )
        const expiredEndpoints: string[] = []
        for (const ps of pushSubs.rows) {
          if (ps.endpoint && ps.p256dh && ps.auth) {
            const pr = await notificationService.sendWebPushAlert(
              { endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } },
              alert
            )
            if (pr.expired) expiredEndpoints.push(ps.endpoint)
          }
        }
        if (expiredEndpoints.length > 0) {
          await pool.query(
            `UPDATE push_subscriptions SET active = false WHERE endpoint = ANY($1::text[])`,
            [expiredEndpoints]
          )
        }
        alertSent = true

        // Real-time Socket.IO push
        broadcastAlert({
          id: alert.id,
          type: 'safe_zone',
          severity,
          title,
          message,
          area: shelter.name,
          actionRequired: isFull ? 'Seek an alternative shelter immediately.' : 'Consider alternative shelters if possible.',
          issuedAt: new Date().toISOString(),
        })
      }
    }

    res.json({
      id: shelter.id,
      name: shelter.name,
      capacity: shelter.capacity,
      current_occupancy: shelter.current_occupancy,
      occupancy_pct: Math.round(occupancyPct),
      alert_sent: alertSent,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/shelters/:id/close
 * Mark a shelter as inactive and notify nearby subscribers.
 */
router.post('/shelters/:id/close', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shelterId = parseInt(req.params.id, 10)
    if (!Number.isInteger(shelterId) || shelterId < 1) throw AppError.badRequest('Invalid shelter id')

    const { rows } = await pool.query(
      `UPDATE shelters SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng`,
      [shelterId]
    )
    if (rows.length === 0) throw AppError.notFound('Shelter not found')

    const shelter = rows[0]
    const subResult = await pool.query(
      `SELECT id, email, phone, telegram_id, whatsapp, channels FROM alert_subscriptions
       WHERE verified = true
         AND (location_lat IS NULL OR location_lng IS NULL OR ST_DWithin(
           ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           50000
         ))`,
      [shelter.lat ?? 0, shelter.lng ?? 0]
    )

    if (subResult.rows.length > 0) {
      const alert: notificationService.Alert = {
        id: `shelter-close-${shelterId}-${Date.now()}`,
        type: 'safe_zone',
        severity: 'warning',
        title: `Safe Zone Closed: ${shelter.name}`,
        message: `${shelter.name} is no longer accepting people. Please proceed to the nearest alternative shelter.`,
        area: shelter.name,
        actionRequired: 'Locate and proceed to an alternative shelter.',
      }
      await notificationService.sendAlertToSubscribers(alert, subResult.rows)
      const pushSubs = await pool.query(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE active = true`)
      const expired: string[] = []
      for (const ps of pushSubs.rows) {
        if (ps.endpoint && ps.p256dh && ps.auth) {
          const pr = await notificationService.sendWebPushAlert({ endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } }, alert)
          if (pr.expired) expired.push(ps.endpoint)
        }
      }
      if (expired.length > 0) await pool.query(`UPDATE push_subscriptions SET active = false WHERE endpoint = ANY($1::text[])`, [expired])
    }

    res.json({ id: shelter.id, name: shelter.name, closed: true, subscribers_notified: subResult.rows.length })
  } catch (err) {
    next(err)
  }
})

// ─── Metro / Transit Disruption Alerts ───────────────────────────────────────

/**
 * POST /api/alerts/transit
 * Operator creates a transit disruption alert (metro, bus, train, ferry).
 * Broadcasts to all verified subscribers; web push included.
 */
router.post('/alerts/transit', authMiddleware, requireOperator, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      operator_id,
      operator_name,
      transit_type,   // metro | bus | train | ferry | tram | general
      line,           // e.g. "Line 3" or "Northern Line"
      severity,       // critical | warning | info
      title,
      message,
      affected_area,
      action_required,
      estimated_resume, // ISO string or null
      expires_at,
    } = req.body

    if (!title || !message || !severity || !affected_area) {
      throw AppError.badRequest('title, message, severity, and affected_area are required')
    }
    if (!['critical', 'warning', 'info'].includes(severity)) {
      throw AppError.badRequest('severity must be: critical, warning, or info')
    }

    const validTypes = ['metro', 'bus', 'train', 'ferry', 'tram', 'general']
    const type = validTypes.includes(transit_type) ? transit_type : 'general'

    // Persist to alerts table
    const { rows: alertRows } = await pool.query(
      `INSERT INTO alerts (title, message, severity, alert_type, location_text, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       RETURNING id`,
      [title, message, severity, `transit_${type}`, affected_area, expires_at ? new Date(expires_at) : null]
    )
    const alertId: string = alertRows[0].id

    const fullMessage = [
      message,
      line ? `Affected line: ${line}.` : '',
      estimated_resume ? `Estimated resume: ${new Date(estimated_resume).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}.` : '',
    ].filter(Boolean).join(' ')

    const alert: notificationService.Alert = {
      id: alertId,
      type: `transit_${type}`,
      severity,
      title,
      message: fullMessage,
      area: affected_area,
      actionRequired: action_required,
      expiresAt: expires_at ? new Date(expires_at) : undefined,
      metadata: { transit_type: type, line: line || null },
    }

    // Get all verified subscribers who include transit topics or haven't filtered it out
    const subResult = await pool.query(
      `SELECT id, email, phone, telegram_id, whatsapp, channels
       FROM alert_subscriptions
       WHERE verified = true
         AND severity_filter && ARRAY[$1]::text[]
         AND (topic_filter IS NULL OR topic_filter && ARRAY['transit', 'general', $2]::text[])`,
      [severity, `transit_${type}`]
    )

    let deliveryResults = { total: 0, successful: 0, failed: 0, results: [] as any[] }
    if (subResult.rows.length > 0) {
      deliveryResults = await notificationService.sendAlertToSubscribers(alert, subResult.rows)
    }

    // Web Push broadcast
    const pushSubs = await pool.query(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE active = true`)
    const expiredEndpoints: string[] = []
    for (const ps of pushSubs.rows) {
      if (ps.endpoint && ps.p256dh && ps.auth) {
        const pr = await notificationService.sendWebPushAlert(
          { endpoint: ps.endpoint, keys: { p256dh: ps.p256dh, auth: ps.auth } },
          alert
        )
        deliveryResults.total++
        if (pr.success) deliveryResults.successful++
        else {
          deliveryResults.failed++
          if (pr.expired) expiredEndpoints.push(ps.endpoint)
        }
      }
    }
    if (expiredEndpoints.length > 0) {
      await pool.query(`UPDATE push_subscriptions SET active = false WHERE endpoint = ANY($1::text[])`, [expiredEndpoints])
    }

    // Audit log
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const safeOpId = operator_id && UUID_RE.test(operator_id) ? operator_id : null
    await pool.query(
      `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, after_state)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
      [
        safeOpId,
        operator_name || 'System',
        `Transit disruption alert: ${title}`,
        'alert_broadcast',
        'transit_alert',
        alertId,
        JSON.stringify({ type, line, area: affected_area, successful: deliveryResults.successful })
      ]
    )

    // Real-time Socket.IO push to all connected clients
    broadcastAlert({
      id: alertId,
      type: `transit_${type}`,
      severity,
      title,
      message: fullMessage,
      area: affected_area,
      actionRequired: action_required,
      issuedAt: new Date().toISOString(),
    })

    res.status(201).json({
      success: true,
      alert_id: alertId,
      transit_type: type,
      delivery: {
        total: deliveryResults.total,
        successful: deliveryResults.successful,
        failed: deliveryResults.failed,
      },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/alerts/transit
 * List recent transit disruption alerts (public).
 */
router.get('/alerts/transit', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, message, severity, alert_type, location_text as area, created_at, expires_at
       FROM alerts
       WHERE alert_type LIKE 'transit_%'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 20`
    )
    res.json({ alerts: rows })
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

//  AI PREDICTION ENGINE - Plug & Play Architecture

// POST /api/predictions/run - Runs a hazard prediction via the AI engine
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
      hazard_type: (req.body.hazard_type as string) || 'flood',
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
    // Compute affected_radius_km from probability (0-100% ? 0.5-15 km range)
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

    const fpResult = await pool.query(
      `INSERT INTO flood_predictions
         (area, probability, time_to_flood, matched_pattern, next_areas,
          severity, confidence, data_sources, coordinates, model_version,
          expires_at)
       VALUES
         ($1, $2, $3, $4, $5, $6::report_severity, $7, $8,
          ST_SetSRID(ST_MakePoint($9, $10), 4326), $11,
          NOW() + INTERVAL '6 hours')
       RETURNING id`,
      [
        area || 'Queried Area',
        probability01,
        responseAny.time_to_flood || predictionResponse.predicted_peak_time || (
          probability01 >= 0.7 ? '< 24 hours' :
          probability01 >= 0.5 ? '24-48 hours' :
          probability01 >= 0.3 ? '2-5 days' :
          'No flood expected'
        ),
        responseAny.matched_pattern || 'On-demand model inference',
        Array.isArray(responseAny.next_areas) ? responseAny.next_areas : [],
        severity,
        Math.max(0, Math.min(100, confidence100)),
        Array.isArray(responseAny.data_sources) ? responseAny.data_sources : ['ai-engine'],
        safeLng,
        safeLat,
        predictionResponse.model_version || 'unknown',
      ]
    ).catch(() => null)

    // Module 1: Auto-create draft deployment zone for high-probability predictions (=70%)
    if (fpResult?.rows?.[0]?.id && probability01 >= 0.7) {
      const fpId = fpResult.rows[0].id
      const draftPriority = probability01 >= 0.85 ? 'Critical' : 'High'
      const resolvedHazardType: string = (req.body.hazard_type as string) || 'flood'
      const resources = getResourceRecommendation(resolvedHazardType, draftPriority)
      const draftAiRec = `Auto-created by AI prediction engine. Confidence: ${confidence100}%. ` +
        `${draftPriority} ${resolvedHazardType.replace(/_/g, ' ')} risk detected at ${area || 'Queried Area'}. Awaiting operator review.`
      pool.query(
        `INSERT INTO resource_deployments
           (zone, priority, active_reports, estimated_affected, ai_recommendation,
            ambulances, fire_engines, rescue_boats, coordinates, prediction_id, is_ai_draft)
         SELECT $1, $2, 0, $3, $4, $5, $6, $7,
                ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, true
         WHERE NOT EXISTS (
           SELECT 1 FROM resource_deployments WHERE prediction_id = $10
         )`,
        [
          area || 'Queried Area',
          draftPriority,
          `AI-flagged risk area - ${(probability01 * 100).toFixed(0)}% ${resolvedHazardType.replace(/_/g, ' ')} probability`,
          draftAiRec,
          resources.ambulances,
          resources.fire_engines,
          resources.rescue_boats,
          safeLng, safeLat,
          fpId,
        ]
      ).catch(() => {})
    }

    res.json({ ...predictionResponse, affected_radius_km: affectedRadiusKm, saved_to_feed: true, region_id: resolvedRegionId })
  } catch (err: any) {
    const statusCode = err?.message?.includes('not available') || err?.message?.includes('timed out') ? 503 : 502
    res.status(statusCode).json({ error: err.message || 'Failed to run live prediction.' })
  }
})

//  SPATIAL INTELLIGENCE - GeoJSON endpoints for QGIS + Heatmaps

// GET /api/map/risk-layer - Returns structured GeoJSON risk layer
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

// GET /api/map/heatmap-data - Returns dynamically computed heatmap intensity data
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

// GET /api/ai/status/detail - Returns detailed DB execution analytics
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

// GET /api/ai/drift - MOVED to aiRoutes.ts (Phase 5 Governance)
// Now served by aiRoutes with live AI engine drift detection

// POST /api/ai/labels - Add training label (human-in-the-loop)
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

// POST /api/ai/damage-estimate - Economic damage estimation model
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

// POST /api/fusion/run - Run full 10-source fusion analysis (ADMIN ONLY)
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

// POST /api/fingerprint/run - Run cosine-similarity flood fingerprinting (OPERATOR ONLY)
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

// POST /api/ingestion/run - Run full data ingestion from all sources (ADMIN ONLY)
router.post('/ingestion/run', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runFullIngestion()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/ingestion/source/:source - Run single source ingestion (ADMIN ONLY)
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

// GET /api/ingestion/status - Get ingestion history and table counts (OPERATOR ONLY)
router.get('/ingestion/status', authMiddleware, requireOperator, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureIngestionSchema()

    const tables = [
      'reports', 'river_gauge_readings', 'climate_observations',
      'weather_observations', 'flood_archives', 'news_articles',
      'wiki_flood_knowledge', 'historical_flood_events',
      'rag_documents', 'ai_model_metrics', 'ingestion_log',
    ]

    const ALLOWED_TABLES = new Set(tables)
    const counts: Record<string, number> = {}
    for (const t of tables) {
      try {
        if (!ALLOWED_TABLES.has(t)) { counts[t] = 0; continue }
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

// POST /api/training/run - Train all ML models (ADMIN ONLY)
router.post('/training/run', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await trainAllModels()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/training/fusion-weights - Train fusion weight optimizer (ADMIN ONLY)
router.post('/training/fusion-weights', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await trainFusionWeights()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

//  RAG KNOWLEDGE BASE (ADMIN ONLY)

// POST /api/rag/expand - Expand RAG knowledge base (ADMIN ONLY)
router.post('/rag/expand', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await expandRAGKnowledgeBase()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/rag/query - Query RAG knowledge base (OPERATOR ONLY)
router.post('/rag/query', authMiddleware, requireOperator, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, limit } = req.body
    if (!query) { res.status(400).json({ error: 'query is required' }); return }
    const safeLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 50)
    const results = await ragRetrieve(query, safeLimit)
    res.json({ query, results, count: results.length })
  } catch (err) {
    next(err)
  }
})

//  RESILIENCE MONITORING (OPERATOR ONLY)

// GET /api/resilience/status - Get cache, rate limit, circuit breaker status (OPERATOR ONLY)
router.get('/resilience/status', requireOperator, (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getResilienceStatus())
  } catch (err) {
    next(err)
  }
})

//  SYSTEM REPORT (OPERATOR ONLY)

// GET /api/system/report - Generate comprehensive system status report (OPERATOR ONLY)
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
    const ALLOWED_TABLES = new Set(tables)
    const tableCounts: Record<string, number> = {}
    for (const t of tables) {
      try {
        if (!ALLOWED_TABLES.has(t)) { tableCounts[t] = 0; continue }
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
      const r = await pool.query(`SELECT id, status, source, records_processed, errors, created_at FROM ingestion_log ORDER BY created_at DESC LIMIT 1`)
      lastIngestion = r.rows[0] || null
    } catch { /* ignore */ }

    const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0)

    res.json({
      system: 'AEGIS v6 - Hybrid AI Disaster Intelligence Platform',
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

