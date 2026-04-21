/**
 * Notifications routes: service test, service status, Web Push management,
 * and manual broadcast alerts.
 *
 * - POST /api/notifications/test            (admin only)
 * - GET  /api/notifications/status
 * - POST /api/push/verify
 * - POST /api/push/subscribe
 * - POST /api/push/unsubscribe
 * - POST /api/alerts/broadcast              (admin only)
 *
 * Extracted from extendedRoutes.ts (C3).
 */
import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authMiddleware, AuthRequest, verifyToken } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/internalAuth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import { devLog } from '../utils/logger.js'
import { logger } from '../services/logger.js'
import * as notificationService from '../services/notificationService.js'
import { broadcastAlert } from '../services/socket.js'
import pool from '../models/db.js'

const router = Router()

//Rate limiter for public Web Push subscribe endpoint (prevent abuse)
const subscriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many subscription requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

//Test notification service (admin only)
router.post('/notifications/test', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { channel, recipient } = req.body

    if (!channel || !recipient) {
      throw AppError.badRequest('channel and recipient are required')
    }

    //Create test alert
    const testAlert: notificationService.Alert = {
      id: 'test-' + Date.now(),
      type: 'general',
      severity: 'info',
      title: 'AEGIS Test Alert',
      message: 'This is a test alert from the AEGIS Emergency Management System. If you received this, your notification channel is working correctly.',
      area: 'Test Area',
      actionRequired: 'No action required - this is only a test.' }

    let result: notificationService.DeliveryResult

    //Send based on channel
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
}))

//Get notification service status
router.get('/notifications/status', (_req: Request, res: Response) => {
  const status = notificationService.getNotificationServiceStatus()
  res.json(status)
})

//Verify that a Web Push endpoint is still active in the database.
//Called by the client on load to detect stale FCM subscriptions.
router.get('/notifications/verify-subscription', asyncRoute(async (req: Request, res: Response) => {
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
}))

//Subscribe to Web Push notifications
router.post('/notifications/subscribe', subscriptionLimiter, asyncRoute(async (req: Request, res: Response) => {
    const { subscription, email } = req.body

    //Derive user_id from auth token if present - never trust the body
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

    //Check if table exists, if not create it
    try {
      const checkTable = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'push_subscriptions'
        )
      `)

      if (!checkTable.rows[0].exists) {
        //Create table if it doesn't exist
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

    //Store push subscription in database
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
}))

//Unsubscribe from Web Push
router.post('/notifications/unsubscribe', asyncRoute(async (req: Request, res: Response) => {
    const { endpoint } = req.body

    if (!endpoint) {
      throw AppError.badRequest('Endpoint is required')
    }

    await pool.query(
      'UPDATE push_subscriptions SET active = false WHERE endpoint = $1',
      [endpoint]
    )

    res.fail('Push subscription removed successfully')
}))

//Broadcast custom alert (admin only)
router.post('/alerts/broadcast', authMiddleware, requireAdmin, asyncRoute(async (req: AuthRequest, res: Response) => {
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

    //Validation
    if (!title || !message || !severity || !area) {
      throw AppError.badRequest('title, message, severity, and area are required')
    }

    if (!['critical', 'warning', 'info'].includes(severity)) {
      throw AppError.badRequest('severity must be: critical, warning, or info')
    }

    //Get matching subscriptions (filter by severity AND topic if specified)
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

    //Persist alert to `alerts` table so delivery logs can reference a valid UUID
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
      throw err
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
        broadcast_at: new Date().toISOString() } }

    //Send to all matching subscribers (email, SMS, WhatsApp, Telegram)
    const deliveryResults = await notificationService.sendAlertToSubscribers(
      alert,
      subscriptions.rows
    )

    //Also send Web Push to all active push subscriptions
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
            //410 Gone / 404 Not Found means the endpoint is permanently gone
            if (pushResult.expired) expiredEndpoints.push(ps.endpoint)
          }
        }
      }
      //Bulk-deactivate expired endpoints so they don't accumulate
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

    //Log each delivery result to alert_delivery_log
    for (const dr of deliveryResults.results) {
      try {
        await pool.query(
          `INSERT INTO alert_delivery_log (alert_id, channel, recipient, status, error_message, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [alertId, dr.channel, dr.messageId || dr.channel, dr.success ? 'sent' : 'failed', dr.error || null, dr.success ? dr.timestamp : null]
        )
      } catch { /* best effort logging */ }
    }

    //Log audit trail
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

    //Real-time Socket.IO push to all connected clients (fastest path)
    broadcastAlert({
      id: alertId,
      type: alert_type || 'general',
      severity,
      title,
      message,
      area,
      actionRequired: action_required,
      issuedAt: new Date().toISOString() })

    res.success({ alert_id: alertId,
      broadcast_at: new Date().toISOString(),
      delivery_summary: {
        matching_subscribers: subscriptions.rows.length,
        total_attempts: deliveryResults.total,
        successful_deliveries: deliveryResults.successful,
        failed_deliveries: deliveryResults.failed } })
}))

//ALERT DELIVERY LOG extracted to alertDeliveryRoutes.ts (C3)



export default router
