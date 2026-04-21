/**
 * Flood prediction endpoints.
 *
 * - GET  /api/predictions        — latest predictions per area (24h window,
 *                                  auto-regenerates if empty)
 * - POST /api/predictions/:id/pre-alert — operator fan-out to verified
 *                                  subscribers (geo + severity matched) plus
 *                                  all active Web Push endpoints
 *
 * Extracted from extendedRoutes.ts (C3).
 */
import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { requireOperator } from '../middleware/internalAuth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import { devLog } from '../utils/logger.js'
import { logger } from '../services/logger.js'
import * as notificationService from '../services/notificationService.js'
import pool from '../models/db.js'

const router = Router()

//FLOOD PREDICTIONS

//Get all active flood predictions, deduplicated to latest per area
router.get('/predictions', asyncRoute(async (_req: Request, res: Response) => {
  //Reusable SQL fragment: DISTINCT ON (area) keeps the most recent run per area
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

    const { rows } = await pool.query(latestPerAreaSQL)

    //If no recent predictions, trigger a fresh calculation
    if (rows.length === 0) {
      try {
        const { getFloodPredictions } = await import('../services/floodPredictionService.js')
        await getFloodPredictions()
        const fresh = await pool.query(latestPerAreaSQL)
        res.json(fresh.rows)
        return
      } catch (genErr: any) {
        logger.warn({ err: genErr }, '[Predictions] Auto-regeneration failed')
        //Fall back to absolute latest regardless of age, still deduplicated
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
}))

//Send pre-alert for a prediction
router.post('/predictions/:id/pre-alert', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { operator_id, operator_name } = req.body

    //Get prediction details
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

    //Update prediction as alert sent
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

    //Geospatial + severity matching.
    //If prediction has coordinates, notify only subscribers within their own radius_km.
    //If no coordinates exist, gracefully fall back to severity-only matching.
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

    //Build alert object
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
        data_sources: prediction.data_sources } }

    //Send to all subscribers (email, SMS, WhatsApp, Telegram)
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

    //Log audit trail
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
}))



export default router
