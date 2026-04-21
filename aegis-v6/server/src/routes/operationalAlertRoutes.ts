/**
 * Operational alert routes (Safe Zones + Metro/Transit).
 * Extracted from extendedRoutes.ts (C3).
 */
import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { requireOperator } from '../middleware/internalAuth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import * as notificationService from '../services/notificationService.js'
import { broadcastAlert } from '../services/socket.js'
import pool from '../models/db.js'

const router = Router()

//Safe Zone / Shelter Capacity Alerts

/**
 * PATCH /api/shelters/:id/occupancy
 * Operator updates current occupancy. When a shelter reaches ≥ 90% capacity
 * or becomes full, an alert is automatically broadcast to all verified
 * subscribers within the shelter's vicinity.
 */
router.patch('/shelters/:id/occupancy', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
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

    //Trigger alert when shelter is ≥ 90% full or at capacity
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

      //Notify subscribers near the shelter
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
          actionRequired: isFull ? 'Seek an alternative shelter immediately.' : 'Consider alternative shelters if possible.' }

        await notificationService.sendAlertToSubscribers(alert, subResult.rows)

        //Also send web push
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

        //Real-time Socket.IO push
        broadcastAlert({
          id: alert.id,
          type: 'safe_zone',
          severity,
          title,
          message,
          area: shelter.name,
          actionRequired: isFull ? 'Seek an alternative shelter immediately.' : 'Consider alternative shelters if possible.',
          issuedAt: new Date().toISOString() })
      }
    }

    res.json({
      id: shelter.id,
      name: shelter.name,
      capacity: shelter.capacity,
      current_occupancy: shelter.current_occupancy,
      occupancy_pct: Math.round(occupancyPct),
      alert_sent: alertSent })
}))

/**
 * POST /api/shelters/:id/close
 * Mark a shelter as inactive and notify nearby subscribers.
 */
router.post('/shelters/:id/close', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
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
        actionRequired: 'Locate and proceed to an alternative shelter.' }
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
}))

//Metro / Transit Disruption Alerts

/**
 * POST /api/alerts/transit
 * Operator creates a transit disruption alert (metro, bus, train, ferry).
 * Broadcasts to all verified subscribers; web push included.
 */
router.post('/alerts/transit', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
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
      expires_at } = req.body

    if (!title || !message || !severity || !affected_area) {
      throw AppError.badRequest('title, message, severity, and affected_area are required')
    }
    if (!['critical', 'warning', 'info'].includes(severity)) {
      throw AppError.badRequest('severity must be: critical, warning, or info')
    }

    const validTypes = ['metro', 'bus', 'train', 'ferry', 'tram', 'general']
    const type = validTypes.includes(transit_type) ? transit_type : 'general'

    //Persist to alerts table
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
      metadata: { transit_type: type, line: line || null } }

    //Get all verified subscribers who include transit topics or haven't filtered it out
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

    //Web Push broadcast
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

    //Audit log
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

    //Real-time Socket.IO push to all connected clients
    broadcastAlert({
      id: alertId,
      type: `transit_${type}`,
      severity,
      title,
      message: fullMessage,
      area: affected_area,
      actionRequired: action_required,
      issuedAt: new Date().toISOString() })

    res.success({ alert_id: alertId,
      transit_type: type,
      delivery: {
        total: deliveryResults.total,
        successful: deliveryResults.successful,
        failed: deliveryResults.failed } }, 201)
}))

/**
 * GET /api/alerts/transit
 * List recent transit disruption alerts (public).
 */
router.get('/alerts/transit', asyncRoute(async (_req: Request, res: Response) => {
    const { rows } = await pool.query(
      `SELECT id, title, message, severity, alert_type, location_text as area, created_at, expires_at
       FROM alerts
       WHERE alert_type LIKE 'transit_%'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 20`
    )
    res.json({ alerts: rows })
}))


export default router
