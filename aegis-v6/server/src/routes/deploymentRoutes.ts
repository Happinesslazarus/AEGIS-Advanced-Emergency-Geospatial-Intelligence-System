/**
 * Resource deployment zones + deployment assets (per-vehicle tracking).
 *
 * Powers the operator dispatch console: create/update/delete zones,
 * deploy & recall crews, AI-draft acknowledgement, ICS ops-log append,
 * mutual-aid flag, and asset (vehicle) status/GPS updates.
 *
 * - Mounted at /api in index.ts
 * - All endpoints require admin or operator role (some admin-only for delete)
 * - Extracted from extendedRoutes.ts (C3)
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import * as notificationService from '../services/notificationService.js'
import { aiClient } from '../services/aiClient.js'
import pool from '../models/db.js'

const router = Router()

//RESOURCE DEPLOYMENTS

//Get all resource deployments
router.get('/deployments', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
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
}))

//Deploy resources to a zone
router.post('/deployments/:id/deploy', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions for deployment operations.')
  }
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
}))

//Recall resources
router.post('/deployments/:id/recall', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions for deployment operations.')
  }
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

    //Module 5a: Auto-resolve linked report on recall
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

    //Module 5b: Submit AI prediction feedback signal + log
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
}))

//Create a new deployment zone
router.post('/deployments', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
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

    //Validate optional FK UUIDs to prevent injection
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

    //Critical zone escalation - notify all active admin/operator staff
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
          actionRequired: 'Review zone immediately and dispatch resources.' }
        for (const staff of staffRows) {
          const channels = Array.isArray(staff.channels) && staff.channels.length > 0 ? staff.channels : ['email']
          const recipient: notificationService.AlertRecipient = {
            email: staff.email, phone: staff.phone || undefined, telegram_id: staff.telegram_id || undefined }
          notificationService.sendMultiChannelAlert(recipient, criticalAlert, channels).catch(() => {})
        }
      } catch { /* notification failure must not block zone creation */ }
    }

    res.status(201).json(rows[0])
}))

//Delete a deployment zone
router.delete('/deployments/:id', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    throw AppError.forbidden('Only admins can delete deployment zones.')
  }
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
}))

//Update a deployment zone (inline edit)
router.patch('/deployments/:id', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) {
    throw AppError.forbidden('Insufficient permissions.')
  }
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
}))

//Acknowledge an AI draft deployment zone (operator review step)
router.patch('/deployments/:id/acknowledge', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
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
}))

//Add an ICS ops-log entry to a deployment zone
router.patch('/deployments/:id/ops-log', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
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
}))

//Toggle mutual aid flag on a deployment zone
router.patch('/deployments/:id/mutual-aid', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
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
}))

//DEPLOYMENT ASSETS (per-vehicle GPS tracking)

//List assets for a zone
router.get('/deployments/:id/assets', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
    const { rows } = await pool.query(
      `SELECT id, deployment_id, asset_type, call_sign, status, crew_count,
              last_lat, last_lng, last_seen_at, notes, created_at
       FROM deployment_assets WHERE deployment_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json(rows)
}))

//Add asset to a zone
router.post('/deployments/:id/assets', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
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
}))

//Update asset status / GPS - must precede /:id routes to avoid conflicts
router.patch('/deployments/assets/:assetId', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
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
}))

//Delete an asset
router.delete('/deployments/assets/:assetId', authMiddleware, asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!['admin', 'operator'].includes(req.user?.role || '')) throw AppError.forbidden('Insufficient permissions.')
    const { rows } = await pool.query(
      `DELETE FROM deployment_assets WHERE id = $1 RETURNING id`,
      [req.params.assetId]
    )
    if (!rows.length) throw AppError.notFound('Asset not found.')
    res.json({ deleted: true, id: rows[0].id })
}))


export default router
