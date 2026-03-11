/*
 * extendedRoutes.ts - Additional API routes for production features
 *
 * Handles:
 *   - Department listing
 *   - Alert subscriptions (subscribe, verify, unsubscribe)
 *   - Audit trail (log actions, query history)
 *   - Community help (offers/requests CRUD)
 *   - Alert delivery via multi-channel notifications
 *   - Data ingestion pipeline
 *   - ML training pipeline
 *   - RAG knowledge base expansion
 *   - Resilience monitoring
 */
import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
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

const router = Router()

/* ══════════════════════════════════════
   DEPARTMENTS
   ══════════════════════════════════════ */

router.get('/departments', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT id, name, description FROM departments ORDER BY name')
    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load departments.' })
  }
})

/* ══════════════════════════════════════
   ALERT SUBSCRIPTIONS
   ══════════════════════════════════════ */

// Subscribe to alerts
router.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    const { email, phone, telegram_id, whatsapp, channels, location_lat, location_lng, radius_km, severity_filter, topic_filter } = req.body
    const normalizedChannels = normalizeChannels(channels)

    if (normalizedChannels.length === 0) {
      res.status(400).json({ error: 'At least one channel must be selected.' })
      return
    }

    if (phone && !isValidE164(phone)) {
      res.status(400).json({ error: 'Phone number must be in E.164 format (e.g. +447700900123).' })
      return
    }

    if (whatsapp && !isValidE164(whatsapp)) {
      res.status(400).json({ error: 'WhatsApp number must be in E.164 format (e.g. +447700900123).' })
      return
    }

    // Validate required contact info for channels (more flexible)
    if (normalizedChannels.includes('email') && !email) {
      res.status(400).json({ error: 'Email is required for email notifications.' })
      return
    }
    if (normalizedChannels.includes('sms') && !phone) {
      res.status(400).json({ error: 'Phone number is required for SMS.' })
      return
    }
    // WhatsApp can use either whatsapp or phone field
    if (normalizedChannels.includes('whatsapp') && !whatsapp && !phone) {
      res.status(400).json({ error: 'Phone/WhatsApp number is required for WhatsApp.' })
      return
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
        console.error('Failed to send verification email:', emailError.message)
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
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create subscription.' })
  }
})

// Verify subscription
router.post('/subscriptions/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.body
    if (!token) {
      res.status(400).json({ error: 'Verification token is required.' })
      return
    }

    const { rows } = await pool.query(
      `UPDATE alert_subscriptions
       SET verified = true, verification_token = NULL, updated_at = NOW()
       WHERE verification_token = $1
       RETURNING id, email, phone, channels, verified`,
      [token]
    )

    if (rows.length === 0) {
      res.status(404).json({ error: 'Invalid verification token.' })
      return
    }

    res.json({ verified: true, subscription: rows[0] })
  } catch {
    res.status(500).json({ error: 'Failed to verify subscription.' })
  }
})

// Get subscriptions by email
router.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    const { email } = req.query
    const { rows } = await pool.query(
      'SELECT id, email, phone, channels, verified, severity_filter, created_at FROM alert_subscriptions WHERE email = $1 ORDER BY created_at DESC',
      [email]
    )
    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load subscriptions.' })
  }
})

// Unsubscribe
router.delete('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM alert_subscriptions WHERE id = $1', [req.params.id])
    res.json({ deleted: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete subscription.' })
  }
})

/* ══════════════════════════════════════
   AUDIT LOG
   ══════════════════════════════════════ */

// Log an action
router.post('/audit', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to write audit log.' })
  }
})

// Get audit log with filtering
router.get('/audit', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load audit log.' })
  }
})

/* ══════════════════════════════════════
   COMMUNITY HELP
   ══════════════════════════════════════ */

// List all active help offers/requests
router.get('/community', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load community data.' })
  }
})

// Create a help offer or request (requires authentication)
router.post('/community', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { type, category, title, description, location_text, location_lat, location_lng, contact_info, capacity, consent_given } = req.body

    if (!type || !['offer', 'request'].includes(type)) {
      res.status(400).json({ error: 'Type must be "offer" or "request".' })
      return
    }
    if (!title || typeof title !== 'string' || title.length < 3 || title.length > 200) {
      res.status(400).json({ error: 'Title is required (3-200 characters).' })
      return
    }
    if (!description || typeof description !== 'string' || description.length > 2000) {
      res.status(400).json({ error: 'Description required (max 2000 characters).' })
      return
    }

    const { rows } = await pool.query(
      `INSERT INTO community_help (type, category, title, description, location_text, location_lat, location_lng, contact_info, capacity, consent_given, citizen_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [type, category || null, title, description, location_text || null, location_lat || null, location_lng || null, contact_info || null, capacity || null, consent_given || false, req.user!.id]
    )
    res.status(201).json(rows[0])
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create community entry.' })
  }
})

// Update status (fulfil, cancel, expire) — requires authentication
router.put('/community/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body
    if (!status || !['fulfilled', 'cancelled', 'expired', 'active'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' })
      return
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
      res.status(404).json({ error: 'Entry not found or you do not have permission to update it.' })
      return
    }
    res.json(rows[0])
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update community status.' })
  }
})

/* ══════════════════════════════════════
   FLOOD PREDICTIONS
   ══════════════════════════════════════ */

// Get all active flood predictions — deduplicated: latest per area only
router.get('/predictions', async (_req: Request, res: Response) => {
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
        console.warn('[Predictions] Auto-regeneration failed:', genErr.message)
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load predictions.' })
  }
})

// Send pre-alert for a prediction
router.post('/predictions/:id/pre-alert', async (req: Request, res: Response) => {
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
      res.status(404).json({ error: 'Prediction not found' })
      return
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
  } catch (error: any) {
    console.error('Pre-alert sending failed:', error)
    res.status(500).json({ 
      error: 'Failed to send pre-alert',
      message: error.message 
    })
  }
})

// Test notification service (admin only)
router.post('/notifications/test', async (req: Request, res: Response) => {
  try {
    const { channel, recipient } = req.body

    if (!channel || !recipient) {
      res.status(400).json({ error: 'channel and recipient are required' })
      return
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
        res.status(400).json({ error: 'Invalid channel. Use: email, sms, whatsapp, telegram' })
        return
    }

    res.json({ 
      test_complete: true,
      channel,
      recipient,
      result 
    })
  } catch (error: any) {
    console.error('Test notification failed:', error)
    res.status(500).json({ 
      error: 'Test failed',
      message: error.message 
    })
  }
})

// Get notification service status
router.get('/notifications/status', (_req: Request, res: Response) => {
  const status = notificationService.getNotificationServiceStatus()
  res.json(status)
})

// Subscribe to Web Push notifications
router.post('/notifications/subscribe', async (req: Request, res: Response) => {
  try {
    const { subscription, email } = req.body

    // Derive user_id from auth token if present — never trust body (#77)
    let user_id: number | null = null
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = await import('jsonwebtoken')
        const decoded = jwt.default.verify(authHeader.slice(7), process.env.JWT_SECRET!) as any
        user_id = decoded.userId || decoded.id || null
      } catch { /* anonymous subscription */ }
    }

    if (!subscription || !subscription.endpoint) {
      res.status(400).json({ error: 'Invalid push subscription object' })
      return
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
      console.warn('Table check failed, attempting to use existing table:', tableErr.message)
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
  } catch (err: any) {
    console.error('Push subscription error:', err.message)
    res.status(500).json({ error: 'Failed to save push subscription', details: err.message })
  }
})

// Unsubscribe from Web Push
router.post('/notifications/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body

    if (!endpoint) {
      res.status(400).json({ error: 'Endpoint is required' })
      return
    }

    await pool.query(
      'UPDATE push_subscriptions SET active = false WHERE endpoint = $1',
      [endpoint]
    )

    res.json({ message: 'Push subscription removed successfully' })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to remove push subscription' })
  }
})

// Broadcast custom alert (admin only)
router.post('/alerts/broadcast', async (req: Request, res: Response) => {
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
      res.status(400).json({ error: 'title, message, severity, and area are required' })
      return
    }

    if (!['critical', 'warning', 'info'].includes(severity)) {
      res.status(400).json({ error: 'severity must be: critical, warning, or info' })
      return
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
    } catch (err: any) {
      console.error('Failed to persist broadcast alert:', err.message)
      res.status(500).json({ error: 'Failed to create alert record' })
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
      console.warn('Web Push broadcast error:', pushErr.message)
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
  } catch (error: any) {
    console.error('Alert broadcast failed:', error)
    res.status(500).json({ 
      error: 'Failed to broadcast alert',
      message: error.message 
    })
  }
})

/* ══════════════════════════════════════════════════════════════
   ALERT DELIVERY LOG — Advanced multi-channel delivery tracking
   ══════════════════════════════════════════════════════════════ */

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
router.get('/alerts/delivery', authMiddleware, async (req: AuthRequest, res: Response) => {
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
  } catch (err: any) {
    console.error('[Delivery] Load failed:', err)
    res.status(500).json({ error: 'Failed to load delivery logs.' })
  }
})

// GET /api/alerts/delivery/stats — analytics dashboard data
router.get('/alerts/delivery/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
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
  } catch (err: any) {
    console.error('[Delivery/Stats] Failed:', err)
    res.status(500).json({ error: 'Failed to load delivery stats.' })
  }
})

// GET /api/alerts/delivery/grouped — per-alert summary with all channel deliveries
router.get('/alerts/delivery/grouped', authMiddleware, async (req: AuthRequest, res: Response) => {
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
  } catch (err: any) {
    console.error('[Delivery/Grouped] Failed:', err)
    res.status(500).json({ error: 'Failed to load grouped delivery logs.' })
  }
})

// POST /api/alerts/delivery/:id/retry — retry a single failed delivery
router.post('/alerts/delivery/:id/retry', authMiddleware, async (req: AuthRequest, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: 'Retry failed.', message: err.message })
  }
})

// POST /api/alerts/delivery/retry-failed — bulk retry failed deliveries
router.post('/alerts/delivery/retry-failed', authMiddleware, async (req: AuthRequest, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: 'Bulk retry failed.' })
  }
})

// GET /api/alerts/delivery/export.csv — stream CSV download to browser
router.get('/alerts/delivery/export.csv', authMiddleware, async (req: AuthRequest, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: 'CSV export failed.' })
  }
})

/* ══════════════════════════════════════
   RESOURCE DEPLOYMENTS
   ══════════════════════════════════════ */

// Get all resource deployments
router.get('/deployments', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    res.status(403).json({ error: 'Insufficient permissions.' })
    return
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
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load deployments.' })
  }
})

// Deploy resources to a zone
router.post('/deployments/:id/deploy', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    res.status(403).json({ error: 'Insufficient permissions for deployment operations.' })
    return
  }
  try {
    const { reason, report_id } = req.body
    const operator_id = req.user!.id
    const operator_name = req.user!.displayName || 'Operator'
    const trimmedReason = (reason || '').toString().trim()
    if (!trimmedReason) {
      res.status(400).json({ error: 'Deployment reason is required.' })
      return
    }
    if (trimmedReason.length > 500) {
      res.status(400).json({ error: 'Reason must be 500 characters or less.' })
      return
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
  } catch (err: any) {
    console.error('[Deploy] Error:', err)
    res.status(500).json({ error: 'Failed to process deployment request.' })
  }
})

// Recall resources
router.post('/deployments/:id/recall', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    res.status(403).json({ error: 'Insufficient permissions for deployment operations.' })
    return
  }
  try {
    const { reason, outcome_summary, report_id } = req.body
    const operator_id = req.user!.id
    const operator_name = req.user!.displayName || 'Operator'
    const trimmedReason = (reason || '').toString().trim()
    const trimmedOutcome = (outcome_summary || '').toString().trim()
    if (!trimmedReason || !trimmedOutcome) {
      res.status(400).json({ error: 'reason and outcome_summary are required for recall.' })
      return
    }
    if (trimmedReason.length > 500 || trimmedOutcome.length > 1000) {
      res.status(400).json({ error: 'reason must be ≤500 chars, outcome_summary ≤1000 chars.' })
      return
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
  } catch (err: any) {
    console.error('[Recall] Error:', err)
    res.status(500).json({ error: 'Failed to process recall request.' })
  }
})

/* ══════════════════════════════════════
   REPORT MEDIA
   ══════════════════════════════════════ */

// Get media for a specific report
router.get('/reports/:id/media', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, file_url, file_type, file_size, ai_processed,
              ai_classification, ai_water_depth, ai_authenticity_score,
              ai_model_version, ai_reasoning, created_at
       FROM report_media WHERE report_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load report media.' })
  }
})

/* ══════════════════════════════════════
   AI MODEL STATUS — MOVED to aiRoutes.ts (Phase 5 Governance)
   GET /api/ai/models now served by aiRoutes with live AI engine data
   ══════════════════════════════════════ */

router.get('/ai/status', async (_req: Request, res: Response) => {
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

// ═══════════════════════════════════════════════════════════════════
//  AI GOVERNANCE ENDPOINTS (Features #30-34)
// ═══════════════════════════════════════════════════════════════════

// GET /api/ai/governance/models — Model metrics from PostgreSQL ai_model_metrics table
// Used by AITransparencyDashboard to show real accuracy, F1, confusion matrix, XAI weights
router.get('/ai/governance/models', async (_req: Request, res: Response) => {
  try {
    const metrics = await getModelMetrics()
    res.json(metrics)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ai/governance/drift — Model drift detection from PostgreSQL
router.get('/ai/governance/drift', async (_req: Request, res: Response) => {
  try {
    const drift = await checkModelDrift()
    res.json(drift)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ai/confidence-distribution — Computed from real predictions
router.get('/ai/confidence-distribution', async (req: Request, res: Response) => {
  try {
    const { model } = req.query
    const distribution = await computeConfidenceDistribution(model as string | undefined)
    res.json(distribution)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ai/audit — AI execution audit log
router.get('/ai/audit', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const model = req.query.model as string | undefined
    const result = await getExecutionAuditLog(limit, offset, model)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
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


// ═══════════════════════════════════════════════════════════════════
//  ACCOUNT GOVERNANCE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// Deactivate operator account
router.post('/operators/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason, actorId, actorName } = req.body
    if (!reason) return res.status(400).json({ error: 'Reason is required' })

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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Reactivate operator account
router.post('/operators/:id/reactivate', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Suspend operator temporarily
router.post('/operators/:id/suspend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason, actorId, actorName, until } = req.body
    if (!reason) return res.status(400).json({ error: 'Reason is required' })
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GDPR-safe anonymise operator (preferred over hard delete)
router.post('/operators/:id/anonymise', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// List all operators (for admin management)
router.get('/operators', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role, department, phone, is_active, is_suspended, suspended_until, last_login, created_at
       FROM operators WHERE deleted_at IS NULL ORDER BY created_at DESC`
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Update operator profile
router.put('/operators/:id/profile', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})


// ═══════════════════════════════════════════════════════════════════
//  AI PREDICTION ENGINE — Plug & Play Architecture
// ═══════════════════════════════════════════════════════════════════

// POST /api/predictions/run — Production-ready prediction endpoint
router.post('/predictions/run', async (req: Request, res: Response) => {
  try {
    const { area, latitude, longitude, weather_data, historical_indicators, region_id } = req.body
    const startTime = Date.now()

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      res.status(400).json({ error: 'latitude and longitude are required numeric fields.' })
      return
    }

    const safeLat = Math.max(-90, Math.min(90, latitude))
    const safeLng = Math.max(-180, Math.min(180, longitude))
    const resolvedRegionId = typeof region_id === 'string' && region_id.trim().length > 0
      ? region_id.trim()
      : 'uk-default'

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


// ═══════════════════════════════════════════════════════════════════
//  SPATIAL INTELLIGENCE — GeoJSON endpoints for QGIS + Heatmaps
// ═══════════════════════════════════════════════════════════════════

// GET /api/map/risk-layer — Returns structured GeoJSON risk layer
router.get('/map/risk-layer', async (_req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load risk layer.' })
  }
})

// GET /api/map/heatmap-data — Returns dynamically computed heatmap intensity data
router.get('/map/heatmap-data', async (_req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load heatmap data.' })
  }
})

// GET /api/ai/status/detail — Returns detailed DB execution analytics
router.get('/ai/status/detail', async (_req: Request, res: Response) => {
  try {
    const models = await pool.query(
      `SELECT model_name, MAX(model_version) as version, COUNT(*) as executions,
              AVG(execution_time_ms) as avg_ms, MAX(created_at) as last_run
       FROM ai_executions GROUP BY model_name ORDER BY last_run DESC`
    )
    res.json({
      execution_history: models.rows
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load AI status detail.' })
  }
})

// GET /api/ai/drift — MOVED to aiRoutes.ts (Phase 5 Governance)
// Now served by aiRoutes with live AI engine drift detection

// POST /api/ai/labels — Add training label (human-in-the-loop)
router.post('/ai/labels', async (req: Request, res: Response) => {
  try {
    const { report_id, label_type, label_value, operator_id, confidence } = req.body
    if (!report_id || !label_type || !label_value || !operator_id) {
      res.status(400).json({ error: 'report_id, label_type, label_value, and operator_id are required' })
      return
    }
    await addTrainingLabel(report_id, label_type, label_value, operator_id, confidence)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ai/damage-estimate — Economic damage estimation model
router.post('/ai/damage-estimate', async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  MULTI-SOURCE FUSION ENGINE (Features #16-25)
// ═══════════════════════════════════════════════════════════════════

// POST /api/fusion/run — Run full 10-source fusion analysis
router.post('/fusion/run', async (req: Request, res: Response) => {
  try {
    const { region_id, latitude, longitude } = req.body
    if (!region_id || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'region_id, latitude, and longitude are required' })
      return
    }

    // Gather live data from all sources
    const fusionInput = await gatherFusionData(region_id, latitude, longitude)
    // Run weighted fusion algorithm
    const result = await runFusion(fusionInput)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Fusion engine failed' })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  FLOOD FINGERPRINTING ENGINE (Features #26-27)
// ═══════════════════════════════════════════════════════════════════

// POST /api/fingerprint/run — Run cosine-similarity flood fingerprinting
router.post('/fingerprint/run', async (req: Request, res: Response) => {
  try {
    const { region_id, latitude, longitude, area } = req.body
    if (!region_id || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'region_id, latitude, and longitude are required' })
      return
    }

    const prediction = await runFingerprinting(
      region_id, latitude, longitude, area || 'Unknown Area',
    )
    res.json(prediction)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Fingerprinting failed' })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  DATA INGESTION PIPELINE
// ═══════════════════════════════════════════════════════════════════

// POST /api/ingestion/run — Run full data ingestion from all sources
router.post('/ingestion/run', async (_req: Request, res: Response) => {
  try {
    const result = await runFullIngestion()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ingestion/source/:source — Run single source ingestion
router.post('/ingestion/source/:source', async (req: Request, res: Response) => {
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
        res.status(400).json({ error: `Unknown source: ${source}. Valid: ea, nasa, openmeteo, floodhistory, wikipedia` })
        return
    }
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ingestion/status — Get ingestion history and table counts
router.get('/ingestion/status', async (_req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  ML TRAINING PIPELINE
// ═══════════════════════════════════════════════════════════════════

// POST /api/training/run — Train all ML models
router.post('/training/run', async (_req: Request, res: Response) => {
  try {
    const result = await trainAllModels()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/training/fusion-weights — Train fusion weight optimizer
router.post('/training/fusion-weights', async (_req: Request, res: Response) => {
  try {
    const result = await trainFusionWeights()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  RAG KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════

// POST /api/rag/expand — Expand RAG knowledge base
router.post('/rag/expand', async (_req: Request, res: Response) => {
  try {
    const result = await expandRAGKnowledgeBase()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rag/query — Query RAG knowledge base
router.post('/rag/query', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body
    if (!query) { res.status(400).json({ error: 'query is required' }); return }
    const results = await ragRetrieve(query, limit || 5)
    res.json({ query, results, count: results.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  RESILIENCE MONITORING
// ═══════════════════════════════════════════════════════════════════

// GET /api/resilience/status — Get cache, rate limit, circuit breaker status
router.get('/resilience/status', (_req: Request, res: Response) => {
  try {
    res.json(getResilienceStatus())
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════
//  SYSTEM REPORT
// ═══════════════════════════════════════════════════════════════════

// GET /api/system/report — Generate comprehensive system status report
router.get('/system/report', async (_req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
