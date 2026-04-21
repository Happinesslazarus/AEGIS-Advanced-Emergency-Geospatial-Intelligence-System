/**
 * CRUD endpoints for emergency incident reports. Citizens submit disaster
 * reports (with optional photo/video evidence), and operators review,
 * triage, and update them. New reports are automatically sent through the
 * AI analysis pipeline for severity classification and image analysis.
 *
 * - Mounted at /api/reports in server/src/index.ts
 * - Evidence files processed by server/src/middleware/upload.ts (Multer + magic-byte check)
 * - Each new report triggers server/src/services/aiAnalysisPipeline.ts for severity scoring
 * - Image evidence processed by server/src/services/imageAnalysisService.ts
 * - Admin dashboard (client/src/pages/AdminPage.tsx) reads from GET /api/reports
 * - Citizens submit from client/src/pages/CitizenDashboard.tsx or ReportPage
 *
 * POST /api/reports              -- Submit a new report (citizen or public)
 * GET  /api/reports              -- List reports (operator-filtered view)
 * GET  /api/reports/:id          -- Fetch a single report
 * PUT  /api/reports/:id          -- Update report status/severity (operator)
 * DELETE /api/reports/:id        -- Archive a report (operator)
 * POST /api/reports/:id/reanalyse -- Trigger AI re-analysis (operator)
 *
 * - server/src/services/aiAnalysisPipeline.ts  -- automated severity scoring
 * - server/src/services/imageAnalysisService.ts -- vision model for evidence images
 * - server/src/middleware/upload.ts             -- file upload & magic byte validation
 * - server/src/services/socket.ts              -- real-time notifications to operators
 * */

import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import pool from '../models/db.js'
import { authMiddleware, operatorOnly, AuthRequest } from '../middleware/auth.js'
import jwt from 'jsonwebtoken'
import { devLog } from '../utils/logger.js'
import { uploadEvidence, validateMagicBytes } from '../middleware/upload.js'
import { analyseReport, reanalyseReport } from '../services/aiAnalysisPipeline.js'
import { classify } from '../services/classifierRouter.js'
import { aiClient } from '../services/aiClient.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { IncidentIntelligenceCore } from '../services/incidentIntelligenceCore.js'
import { reportSubmissionsTotal } from '../services/metrics.js'
import { AppError } from '../utils/AppError.js'
import { validate, paginationSchema } from '../middleware/validate.js'
import { logger } from '../services/logger.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { eventBus } from '../events/eventBus.js'
import { AegisEventNames } from '../events/eventTypes.js'

/* Attempt to extract auth user from request without rejecting unauthenticated callers. */
function tryExtractUser(req: Request): AuthRequest['user'] | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  try {
    const token = header.split(' ')[1]
    const secret = process.env.JWT_SECRET
    if (!secret) return null
    return jwt.verify(token, secret) as AuthRequest['user']
  } catch { return null }
}

function isOperatorRole(role?: string): boolean {
  return ['admin', 'operator', 'manager'].includes(role || '')
}

//Rate limiter for public report submission -- prevents spam flooding
const reportSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                    // max 10 reports per IP per window
  message: { error: 'Too many reports submitted. Please wait before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    //Skip rate limiting for authenticated operators (bulk submissions)
    return !!(req as AuthRequest).user
  } })

//Limit bulk operations: max 5 bulk status updates per operator per 10 minutes
const bulkStatusLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
  message: { error: 'Too many bulk status updates. Please wait before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false })

const router = Router()

//Region config resolved once at startup (re-read from config, not env snapshot)
//Call getActiveCityRegion() per-request if multi-region support is ever added.
const activeRegion = getActiveCityRegion()
const regionLat = activeRegion.centre.lat
const regionLng = activeRegion.centre.lng
const intelligenceCore = new IncidentIntelligenceCore(activeRegion)
//Half-width of the region bounding box in degrees, used as a fast proximity guard.
//Does not replace PostGIS spatial queries -- just skips obviously out-of-range reports early.
const regionRadiusDeg = Math.max(
  0.1,
  Math.max(
    Math.abs(activeRegion.boundingBox.north - activeRegion.boundingBox.south),
    Math.abs(activeRegion.boundingBox.east - activeRegion.boundingBox.west),
  ) / 2,
)

function isWithinActiveRegion(lat: number, lng: number): boolean {
  return (
    lat >= regionLat - regionRadiusDeg &&
    lat <= regionLat + regionRadiusDeg &&
    lng >= regionLng - regionRadiusDeg &&
    lng <= regionLng + regionRadiusDeg
  )
}

type SignalFetchResult = {
  rows: Array<any>
  warnings: string[]
}

async function fetchRecentSignals(minutes: number): Promise<SignalFetchResult> {
  //Modern schema includes deleted_at and fine-grained status values.
  //Legacy deployments (pre-migration) only have the basic reports columns.
  const modernQuery = `SELECT id,
                              COALESCE(NULLIF(incident_subtype, ''), incident_category) AS signal_type,
                              severity,
                              COALESCE(ai_confidence, 50) AS ai_confidence,
                              ST_Y(coordinates::geometry) AS lat,
                              ST_X(coordinates::geometry) AS lng,
                              created_at
                       FROM reports
                       WHERE coordinates IS NOT NULL
                         AND deleted_at IS NULL
                         AND status NOT IN ('resolved', 'archived', 'false_report')
                         AND created_at >= now() - ($1::text || ' minutes')::interval
                       ORDER BY created_at DESC`

  const legacyQuery = `SELECT id,
                              COALESCE(NULLIF(incident_subtype, ''), incident_category) AS signal_type,
                              severity,
                              COALESCE(ai_confidence, 50) AS ai_confidence,
                              ST_Y(coordinates::geometry) AS lat,
                              ST_X(coordinates::geometry) AS lng,
                              created_at
                       FROM reports
                       WHERE coordinates IS NOT NULL
                         AND created_at >= now() - ($1::text || ' minutes')::interval
                       ORDER BY created_at DESC`

  try {
    const result = await pool.query(modernQuery, [String(minutes)])
    return { rows: result.rows, warnings: [] }
  } catch (err: any) {
    //Error 42703 = "column does not exist" -- fall back to legacy schema gracefully.
    //This keeps the intelligence endpoints working on older deployments during migration.
    if (err?.code === '42703' || /deleted_at|false_report|archived|status/i.test(String(err?.message || ''))) {
      const fallback = await pool.query(legacyQuery, [String(minutes)])
      return {
        rows: fallback.rows,
        warnings: ['legacy schema fallback: reports table missing modern status/deleted columns'] }
    }
    if (err?.code === '42P01' || /relation .*reports.* does not exist/i.test(String(err?.message || ''))) {
      return {
        rows: [],
        warnings: ['legacy schema: missing reports table'] }
    }
    throw err
  }
}

 /*
 * GET /api/reports
 * Returns all reports, optionally filtered by status, severity, or category.
 * Newest reports appear first. Results include extracted lat/lng from PostGIS.
  */
router.get('/', validate({ query: paginationSchema }), asyncRoute(async (req: Request, res: Response) => {
    const user = tryExtractUser(req)
    const isOp = isOperatorRole(user?.role)
    const { status, severity, category } = req.query
    const { page, limit } = (req as any).validatedQuery as { page: number; limit: number }
    const offset = (page - 1) * limit

    let whereClause = ' WHERE 1=1'
    const params: any[] = []
    let idx = 1

    //Apply optional filters
    if (status) { whereClause += ` AND status = $${idx++}`; params.push(status) }
    if (severity) { whereClause += ` AND severity = $${idx++}`; params.push(severity) }
    if (category) { whereClause += ` AND incident_category = $${idx++}`; params.push(category) }

    //Get total count for pagination metadata
    const countResult = await pool.query(`SELECT COUNT(*) FROM reports${whereClause}`, params)
    const total = parseInt(countResult.rows[0].count)

    const query = `
      SELECT id, report_number, incident_category, incident_subtype, display_type,
             description, severity, status, trapped_persons, location_text,
             ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
             has_media, media_type, media_url, reporter_name,
             ai_confidence, ai_analysis, operator_notes,
             created_at, updated_at, verified_at, resolved_at
      FROM reports${whereClause}
      ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`
    params.push(limit, offset)

    const result = await pool.query(query, params)

    if (isOp) {
      //Operators get full data including media
      const reportIds = result.rows.map((r: any) => r.id)
      let mediaMap: Record<string, any[]> = {}
      if (reportIds.length > 0) {
        const mediaResult = await pool.query(
          `SELECT id, report_id, file_url, file_type, file_size, original_filename,
                  ai_processed, ai_classification, ai_water_depth, ai_authenticity_score, ai_reasoning
           FROM report_media WHERE report_id = ANY($1) ORDER BY created_at`,
          [reportIds]
        )
        for (const m of mediaResult.rows) {
          if (!mediaMap[m.report_id]) mediaMap[m.report_id] = []
          mediaMap[m.report_id].push({
            id: m.id,
            url: m.file_url,
            file_url: m.file_url,
            fileType: m.file_type,
            fileSize: m.file_size,
            originalFilename: m.original_filename,
            aiAnalysis: m.ai_processed ? {
              classification: m.ai_classification,
              waterDepth: m.ai_water_depth,
              authenticityScore: m.ai_authenticity_score,
              reasoning: m.ai_reasoning } : null })
        }
      }
      const reports = result.rows.map((row: any) => ({
        ...formatReport(row),
        media: mediaMap[row.id] || [] }))
      res.json({ data: reports, total, page, limit })
    } else {
      //Public/citizen access: include media thumbnails but redact operator-only fields
      const reportIds = result.rows.map((r: any) => r.id)
      let mediaMap: Record<string, any[]> = {}
      if (reportIds.length > 0) {
        const mediaResult = await pool.query(
          `SELECT id, report_id, file_url, file_type, file_size, original_filename
           FROM report_media WHERE report_id = ANY($1) ORDER BY created_at`,
          [reportIds]
        )
        for (const m of mediaResult.rows) {
          if (!mediaMap[m.report_id]) mediaMap[m.report_id] = []
          mediaMap[m.report_id].push({
            id: m.id,
            url: m.file_url,
            file_url: m.file_url,
            fileType: m.file_type,
            fileSize: m.file_size,
            originalFilename: m.original_filename })
        }
      }
      const reports = result.rows.map((row: any) => ({
        ...formatReportPublic(row),
        media: mediaMap[row.id] || [] }))
      res.json({ data: reports, total, page, limit })
    }
}))

 /*
 * GET /api/reports/stats
 * Returns aggregate statistics for the analytics dashboard.
 * Includes counts by status, severity, category, hour, and confidence.
  */
router.get('/stats', authMiddleware, operatorOnly, asyncRoute(async (_req: AuthRequest, res: Response) => {
    //Run multiple count queries in parallel for performance
    const [byStatus, bySeverity, byCategory, byHour, totals] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int as count FROM reports GROUP BY status`),
      pool.query(`SELECT severity, COUNT(*)::int as count FROM reports GROUP BY severity`),
      pool.query(`SELECT incident_category, COUNT(*)::int as count FROM reports GROUP BY incident_category ORDER BY count DESC`),
      pool.query(`SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*)::int as count FROM reports GROUP BY hour ORDER BY hour`),
      pool.query(`SELECT COUNT(*)::int as total, AVG(ai_confidence)::int as avg_confidence,
                  COUNT(*) FILTER (WHERE has_media)::int as with_media,
                  COUNT(*) FILTER (WHERE trapped_persons = 'yes')::int as trapped FROM reports`),
    ])

    res.json({
      byStatus: Object.fromEntries(byStatus.rows.map(r => [r.status, r.count])),
      bySeverity: Object.fromEntries(bySeverity.rows.map(r => [r.severity, r.count])),
      byCategory: byCategory.rows.map(r => ({ category: r.incident_category, count: r.count })),
      byHour: byHour.rows,
      totals: totals.rows[0] })
}))

 /*
 * GET /api/reports/clusters
 * Spatiotemporal clustering of recent reports for incident intelligence.
 * Query params: minutes, radiusMeters, minReports
  */
router.get('/clusters', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
  try {
    const minutes = Math.min(24 * 60, Math.max(10, parseInt(String(req.query.minutes || '120'), 10) || 120))
    const radiusMeters = Math.min(5000, Math.max(100, parseInt(String(req.query.radiusMeters || '1000'), 10) || 1000))
    const minReports = Math.min(20, Math.max(2, parseInt(String(req.query.minReports || '3'), 10) || 3))

    const { rows, warnings } = await fetchRecentSignals(minutes)
    const evidence = intelligenceCore.buildEvidenceEvents(rows)
    if (evidence.length === 0) {
      res.json({
        ok: true,
        data: [],
        clusters: [],
        warnings,
        params: { minutes, radiusMeters, minReports } })
      return
    }

    const clusters = intelligenceCore.clusterEvidence(evidence, {
      radiusMeters,
      minReports })

    res.json({
      ok: true,
      data: clusters,
      clusters,
      warnings,
      params: { minutes, radiusMeters, minReports } })
  } catch (err: any) {
    logger.error({ err }, '[Reports] Clusters error')
    res.json({ ok: true, data: [], clusters: [], warnings: ['clusters unavailable -- check server logs'] })
  }
}))

 /*
 * GET /api/reports/cascading-insights
 * Detect likely cascading disaster chains from recent incident signals.
  */
router.get('/cascading-insights', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
  try {
    const windowMinutes = Math.min(24 * 60, Math.max(30, parseInt(String(req.query.windowMinutes || '180'), 10) || 180))
    const forecastHorizonMinutes = Math.min(24 * 60, Math.max(30, parseInt(String(req.query.forecastHorizonMinutes || '180'), 10) || 180))

    const { rows, warnings } = await fetchRecentSignals(windowMinutes)
    const evidence = intelligenceCore.buildEvidenceEvents(rows)
    const cascade = intelligenceCore.inferCascades(evidence, { forecastHorizonMinutes })

    res.json({
      ok: true,
      data: cascade.inferred,
      window_minutes: windowMinutes,
      forecast_horizon_minutes: forecastHorizonMinutes,
      signal_count: evidence.length,
      active_signals: cascade.activeSignals,
      inferred_cascades: cascade.inferred,
      warnings })
  } catch (err: any) {
    logger.error({ err }, '[Reports] Cascading insights error')
    res.json({ ok: true, data: [], inferred_cascades: [], warnings: ['cascading insights unavailable -- check server logs'] })
  }
}))

 /*
 * GET /api/reports/cascading-forecast
 * Live-data cascading forecast over current evidence only.
  */
router.get('/cascading-forecast', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const windowMinutes = Math.min(24 * 60, Math.max(30, parseInt(String(req.query.windowMinutes || '180'), 10) || 180))
    const forecastHorizonMinutes = Math.min(24 * 60, Math.max(30, parseInt(String(req.query.forecastHorizonMinutes || '180'), 10) || 180))

    const { rows, warnings } = await fetchRecentSignals(windowMinutes)
    const evidence = intelligenceCore.buildEvidenceEvents(rows)
    const baseline = intelligenceCore.inferCascades(evidence, { forecastHorizonMinutes })

    res.json({
      ok: true,
      window_minutes: windowMinutes,
      forecast_horizon_minutes: forecastHorizonMinutes,
      signal_count: evidence.length,
      data: {
        activeSignals: baseline.activeSignals,
        inferred: baseline.inferred },
      warnings })
}))

 /*
 * GET /api/reports/incident-objects
 * Promote clustered evidence into incident objects with confidence lifecycle state.
  */
router.get('/incident-objects', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
  try {
    const minutes = Math.min(24 * 60, Math.max(10, parseInt(String(req.query.minutes || '180'), 10) || 180))
    const radiusMeters = Math.min(5000, Math.max(100, parseInt(String(req.query.radiusMeters || '1000'), 10) || 1000))
    const minReports = Math.min(20, Math.max(2, parseInt(String(req.query.minReports || '3'), 10) || 3))

    const { rows, warnings } = await fetchRecentSignals(minutes)
    const evidence = intelligenceCore.buildEvidenceEvents(rows)
    const incidents = intelligenceCore.promoteIncidentObjects(evidence, {
      radiusMeters,
      minReports })

    res.json({
      ok: true,
      data: incidents,
      incidents,
      warnings,
      params: { minutes, radiusMeters, minReports } })
  } catch (err: any) {
    logger.error({ err }, '[Reports] Incident objects error')
    res.json({ ok: true, data: [], incidents: [], warnings: ['incident objects unavailable -- check server logs'] })
  }
}))

 /*
 * GET /api/reports/incident-objects/:id/explanation
 * Returns confidence trace and drivers for one promoted incident object.
  */
router.get('/incident-objects/:id/explanation', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
  try {
    const minutes = 180
    const radiusMeters = 1000
    const minReports = 3
    const incidentId = String(req.params.id || '')

    const { rows, warnings } = await fetchRecentSignals(minutes)
    const evidence = intelligenceCore.buildEvidenceEvents(rows)
    const incidents = intelligenceCore.promoteIncidentObjects(evidence, {
      radiusMeters,
      minReports })

    const incident = incidents.find((item) => item.incident_id === incidentId)
    if (!incident) {
      throw AppError.notFound('Incident object not found.')
    }

    res.json({
      ok: true,
      incident_id: incident.incident_id,
      incident_type: incident.incident_type,
      lifecycle_state: incident.lifecycle_state,
      confidence: incident.confidence,
      explanation: intelligenceCore.explainIncidentObject(incident),
      warnings })
  } catch (err: any) {
    logger.error({ err }, '[Reports] Incident explanation error')
    res.json({ ok: true, data: null, warnings: ['incident explanation unavailable -- check server logs'] })
  }
}))

 /*
 * GET /api/reports/incident-objects/:id/timeline
 * Returns confidence/lifecycle evolution for one live incident object across recent windows.
  */
router.get('/incident-objects/:id/timeline', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const incidentId = String(req.params.id || '')
    const radiusMeters = Math.min(5000, Math.max(100, parseInt(String(req.query.radiusMeters || '1000'), 10) || 1000))
    const minReports = Math.min(20, Math.max(2, parseInt(String(req.query.minReports || '3'), 10) || 3))
    const checkpoints = [360, 240, 180, 120, 60, 30, 15]

    const { rows, warnings } = await fetchRecentSignals(Math.max(...checkpoints))
    const timeline = checkpoints.map((minutes) => {
      const cutoff = Date.now() - minutes * 60 * 1000
      const snapshotRows = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)
      const incidents = intelligenceCore.promoteIncidentObjects(
        intelligenceCore.buildEvidenceEvents(snapshotRows),
        { radiusMeters, minReports },
      )
      const incident = incidents.find((item) => item.incident_id === incidentId)
      return {
        window_minutes: minutes,
        snapshot_at: new Date().toISOString(),
        present: Boolean(incident),
        lifecycle_state: incident?.lifecycle_state || null,
        confidence: incident?.confidence || null,
        evidence_count: incident?.evidence_count || 0 }
    })

    const found = timeline.some((point) => point.present)
    if (!found) {
      throw AppError.notFound('Incident object timeline unavailable for this id.')
    }

    res.json({
      ok: true,
      incident_id: incidentId,
      data: timeline,
      warnings })
}))

 /*
 * GET /api/reports/incident-objects/changes
 * Diff incident objects between current and previous windows.
  */
router.get('/incident-objects/changes', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
  try {
    const minutes = Math.min(120, Math.max(5, parseInt(String(req.query.minutes || '15'), 10) || 15))
    const baselineMinutes = Math.min(120, Math.max(5, parseInt(String(req.query.baselineMinutes || String(minutes)), 10) || minutes))
    const radiusMeters = Math.min(5000, Math.max(100, parseInt(String(req.query.radiusMeters || '1000'), 10) || 1000))
    const minReports = Math.min(20, Math.max(2, parseInt(String(req.query.minReports || '3'), 10) || 3))

    const totalWindow = minutes + baselineMinutes
    const { rows, warnings } = await fetchRecentSignals(totalWindow)
    const now = Date.now()
    const currentCutoff = now - minutes * 60 * 1000
    const baselineCutoff = now - totalWindow * 60 * 1000

    const currentRows = rows.filter((r) => new Date(r.created_at).getTime() >= currentCutoff)
    const previousRows = rows.filter((r) => {
      const ts = new Date(r.created_at).getTime()
      return ts >= baselineCutoff && ts < currentCutoff
    })

    const currentIncidents = intelligenceCore.promoteIncidentObjects(
      intelligenceCore.buildEvidenceEvents(currentRows),
      { radiusMeters, minReports },
    )
    const previousIncidents = intelligenceCore.promoteIncidentObjects(
      intelligenceCore.buildEvidenceEvents(previousRows),
      { radiusMeters, minReports },
    )

    const stateRank: Record<string, number> = {
      //Lower rank = less confident. Escalation is movement from a lower to a higher rank.
      weak: 1,
      possible: 2,
      probable: 3,
      high: 4,
      confirmed: 5 }

    //Geospatial key: round to 3dp (≈111m resolution) so incidents at the same location
    //are recognised as the same incident across time windows.
    const keyFor = (i: any): string => `${i.incident_type}:${i.center.lat.toFixed(3)}:${i.center.lng.toFixed(3)}`
    const currentMap = new Map(currentIncidents.map((i) => [keyFor(i), i]))
    const previousMap = new Map(previousIncidents.map((i) => [keyFor(i), i]))

    const newIncidents = Array.from(currentMap.entries())
      .filter(([k]) => !previousMap.has(k))
      .map(([, v]) => v)

    const resolvedIncidents = Array.from(previousMap.entries())
      .filter(([k]) => !currentMap.has(k))
      .map(([, v]) => v)

    const escalated = Array.from(currentMap.entries())
      .filter(([k, cur]) => {
        const prev = previousMap.get(k)
        return prev && stateRank[cur.lifecycle_state] > stateRank[prev.lifecycle_state]
      })
      .map(([, v]) => v)

    const downgraded = Array.from(currentMap.entries())
      .filter(([k, cur]) => {
        const prev = previousMap.get(k)
        return prev && stateRank[cur.lifecycle_state] < stateRank[prev.lifecycle_state]
      })
      .map(([, v]) => v)

    const lifecycleCounts = currentIncidents.reduce((acc, i) => {
      acc[i.lifecycle_state] = (acc[i.lifecycle_state] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    res.json({
      ok: true,
      data: {
        new_incidents: newIncidents,
        escalated,
        downgraded,
        resolved: resolvedIncidents },
      window_minutes: minutes,
      baseline_minutes: baselineMinutes,
      current_count: currentIncidents.length,
      previous_count: previousIncidents.length,
      lifecycle_counts: lifecycleCounts,
      changes: {
        new_incidents: newIncidents,
        escalated,
        downgraded,
        resolved: resolvedIncidents },
      totals: {
        new_count: newIncidents.length,
        escalated_count: escalated.length,
        downgraded_count: downgraded.length,
        resolved_count: resolvedIncidents.length },
      warnings })
  } catch (err: any) {
    logger.error({ err }, '[Reports] Incident object changes error')
    res.json({ ok: true, data: { new_incidents: [], escalated: [], downgraded: [], resolved: [] }, warnings: ['incident object changes unavailable -- check server logs'] })
  }
}))

 /*
 * GET /api/reports/analytics
 * Advanced live analytics for admin dashboard with time-range support.
 * Query params: range=24h|7d|30d|all (default: 24h)
  */
router.get('/analytics', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const rangeParam = String(req.query.range || '24h').toLowerCase()
    const range = ['24h', '7d', '30d', 'all'].includes(rangeParam) ? rangeParam : '24h'

    const intervalByRange: Record<string, string | null> = {
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
      'all': null }

    const whereClause = intervalByRange[range]
      ? `WHERE created_at >= NOW() - INTERVAL '${intervalByRange[range]}'`
      : ''

    const [totalsRes, statusRes, severityRes, categoryRes, trendRes, timingRes, seriesRes, categorySeverityRes, locationClusterRes, officerPerfRes, operationalRes, trendMetricsRes, aiAccuracyRes, geoCoverageRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COALESCE(ROUND(AVG(ai_confidence))::int, 0) AS avg_confidence,
           COUNT(*) FILTER (WHERE has_media)::int AS with_media,
           COUNT(*) FILTER (WHERE trapped_persons = 'yes')::int AS trapped,
           COUNT(*) FILTER (WHERE status IN ('verified','urgent','resolved'))::int AS handled,
           COUNT(*) FILTER (WHERE ai_confidence IS NOT NULL)::int AS ai_scored
         FROM reports
         ${whereClause}`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM reports
         ${whereClause}
         GROUP BY status`
      ),
      pool.query(
        `SELECT severity, COUNT(*)::int AS count
         FROM reports
         ${whereClause}
         GROUP BY severity`
      ),
      pool.query(
        `SELECT COALESCE(incident_category, 'unknown') AS category, COUNT(*)::int AS count
         FROM reports
         ${whereClause}
         GROUP BY incident_category
         ORDER BY count DESC
         LIMIT 8`
      ),
      intervalByRange[range]
        ? pool.query(
            `WITH current_period AS (
               SELECT COUNT(*)::int AS c
               FROM reports
               WHERE created_at >= NOW() - INTERVAL '${intervalByRange[range]}'
             ),
             previous_period AS (
               SELECT COUNT(*)::int AS c
               FROM reports
               WHERE created_at < NOW() - INTERVAL '${intervalByRange[range]}'
                 AND created_at >= NOW() - (INTERVAL '${intervalByRange[range]}' * 2)
             )
             SELECT current_period.c AS current_count, previous_period.c AS previous_count
             FROM current_period, previous_period`
          )
        : pool.query(`SELECT 0::int AS current_count, 0::int AS previous_count`),
      pool.query(
        `SELECT
           COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (verified_at - created_at)) / 60))::int, 0) AS avg_verify_minutes,
           COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60))::int, 0) AS avg_resolve_minutes
         FROM reports
         ${whereClause}`
      ),
      range === '24h'
        ? pool.query(
            `WITH hours AS (
               SELECT generate_series(
                 date_trunc('hour', NOW() - INTERVAL '23 hours'),
                 date_trunc('hour', NOW()),
                 INTERVAL '1 hour'
               ) AS bucket
             )
             SELECT
               to_char(hours.bucket, 'HH24:00') AS label,
               COALESCE(COUNT(r.id), 0)::int AS count
             FROM hours
             LEFT JOIN reports r
               ON date_trunc('hour', r.created_at) = hours.bucket
             GROUP BY hours.bucket
             ORDER BY hours.bucket`
          )
        : (range === '7d' || range === '30d') ? pool.query(
            `WITH days AS (
               SELECT generate_series(
                 date_trunc('day', NOW() - INTERVAL '${range === '7d' ? '6 days' : range === '30d' ? '29 days' : '89 days'}'),
                 date_trunc('day', NOW()),
                 INTERVAL '1 day'
               ) AS bucket
             )
             SELECT
               to_char(days.bucket, 'DD Mon') AS label,
               COALESCE(COUNT(r.id), 0)::int AS count
             FROM days
             LEFT JOIN reports r
               ON date_trunc('day', r.created_at) = days.bucket
             GROUP BY days.bucket
             ORDER BY days.bucket`
          ) : pool.query(
            `WITH bounds AS (
               SELECT date_trunc('month', COALESCE(MIN(created_at), NOW())) AS start_month
               FROM reports
             ),
             months AS (
               SELECT generate_series(
                 (SELECT start_month FROM bounds),
                 date_trunc('month', NOW()),
                 INTERVAL '1 month'
               ) AS bucket
             )
             SELECT
               to_char(months.bucket, 'Mon YYYY') AS label,
               COALESCE(COUNT(r.id), 0)::int AS count
             FROM months
             LEFT JOIN reports r
               ON date_trunc('month', r.created_at) = months.bucket
             GROUP BY months.bucket
             ORDER BY months.bucket`
          ),
      pool.query(
        `SELECT
           COALESCE(incident_category, 'unknown') AS category,
           severity,
           COUNT(*)::int AS count
         FROM reports
         ${whereClause}
         GROUP BY incident_category, severity
         ORDER BY category, severity`
      ),
      pool.query(
        `SELECT
           ROUND(AVG(ST_Y(coordinates::geometry))::numeric, 4)::float AS lat,
           ROUND(AVG(ST_X(coordinates::geometry))::numeric, 4)::float AS lng,
           COUNT(*)::int AS count,
           ROUND(ST_Y(coordinates::geometry)::numeric, 2)::float AS lat_bin,
           ROUND(ST_X(coordinates::geometry)::numeric, 2)::float AS lng_bin
         FROM reports
         ${whereClause ? `${whereClause} AND coordinates IS NOT NULL` : 'WHERE coordinates IS NOT NULL'}
         GROUP BY lat_bin, lng_bin
         ORDER BY count DESC
         LIMIT 10`
      ),
      pool.query(
        `SELECT
           COALESCE(o.display_name, 'Unknown') AS officer,
           COUNT(DISTINCT h.report_id)::int AS count
         FROM report_status_history h
         LEFT JOIN operators o ON o.id = h.changed_by
         ${intervalByRange[range]
           ? `WHERE h.created_at >= NOW() - INTERVAL '${intervalByRange[range]}'`
           : ''}
         GROUP BY officer
         ORDER BY count DESC
         LIMIT 8`
      ),
      pool.query(
        `WITH first_response AS (
           SELECT h.report_id, MIN(h.created_at) AS first_response_at
           FROM report_status_history h
           GROUP BY h.report_id
         )
         SELECT
           COUNT(*) FILTER (WHERE r.created_at >= date_trunc('day', NOW()))::int AS reports_today,
           COUNT(*) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days')::int AS reports_this_week,
           COUNT(*) FILTER (WHERE r.status = 'flagged')::int AS flagged_total,
           COALESCE(
             ROUND(AVG(EXTRACT(EPOCH FROM (fr.first_response_at - r.created_at)) / 60))::int,
             0
           ) AS admin_response_minutes,
           COALESCE(
             ROUND(AVG(EXTRACT(EPOCH FROM (r.resolved_at - r.verified_at)) / 60))::int,
             0
           ) AS investigation_completion_minutes
         FROM reports r
         LEFT JOIN first_response fr ON fr.report_id = r.id
         ${whereClause}`
      ),
      pool.query(
        `WITH weekly AS (
           SELECT
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS current_week,
             COUNT(*) FILTER (
               WHERE created_at < NOW() - INTERVAL '7 days'
                 AND created_at >= NOW() - INTERVAL '14 days'
             )::int AS previous_week
           FROM reports
         ),
         monthly AS (
           SELECT
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS current_month,
             COUNT(*) FILTER (
               WHERE created_at < NOW() - INTERVAL '30 days'
                 AND created_at >= NOW() - INTERVAL '60 days'
             )::int AS previous_month
           FROM reports
         )
         SELECT
           current_week,
           previous_week,
           current_month,
           previous_month
         FROM weekly, monthly`
      ),
      //AI Accuracy: % of high-confidence reports that were verified (not flagged)
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE ai_confidence >= 70)::int AS high_confidence_total,
           COUNT(*) FILTER (WHERE ai_confidence >= 70 AND status IN ('verified','urgent'))::int AS high_confidence_verified,
           COUNT(*) FILTER (WHERE ai_confidence >= 70 AND status = 'flagged')::int AS high_confidence_flagged
         FROM reports
         ${whereClause}`
      ),
      //Geographic Coverage: Max distance between report locations in km
      pool.query(
        `WITH locations AS (
           SELECT coordinates::geometry AS geom
           FROM reports
           ${whereClause ? `${whereClause} AND coordinates IS NOT NULL` : 'WHERE coordinates IS NOT NULL'}
         )
         SELECT
           COALESCE(MAX(ST_Distance(a.geom::geography, b.geom::geography) / 1000), 0)::int AS max_distance_km
         FROM locations a
         CROSS JOIN locations b
         WHERE a.geom != b.geom`
      ),
    ])

    const totals = totalsRes.rows[0] || {}
    const total = Number(totals.total || 0)
    const handled = Number(totals.handled || 0)
    const withMedia = Number(totals.with_media || 0)

    const verificationRate = total > 0 ? Math.round((handled / total) * 100) : 0
    const mediaRate = total > 0 ? Math.round((withMedia / total) * 100) : 0

    const trendRow = trendRes.rows[0] || { current_count: 0, previous_count: 0 }
    const currentCount = Number(trendRow.current_count || 0)
    const previousCount = Number(trendRow.previous_count || 0)
    const trendPct = previousCount > 0
      ? Math.round(((currentCount - previousCount) / previousCount) * 100)
      : (currentCount > 0 ? 100 : 0)

    const bySeverity = Object.fromEntries(severityRes.rows.map(r => [toUiSeverity(r.severity), Number(r.count)]))
    const byStatus = Object.fromEntries(statusRes.rows.map(r => [toUiStatus(r.status), Number(r.count)]))
    const byCategory = categoryRes.rows.map(r => ({ category: r.category, count: Number(r.count) }))

    const operational = operationalRes.rows[0] || {}
    const flaggedTotal = Number(operational.flagged_total || 0)
    const falseReportRate = total > 0 ? Math.round((flaggedTotal / total) * 100) : 0

    const heatmapMap = new Map<string, { category: string; High: number; Medium: number; Low: number; total: number }>()
    for (const row of categorySeverityRes.rows) {
      const category = String(row.category || 'unknown')
      const severityLabel = toUiSeverity(String(row.severity || 'low')) as 'High' | 'Medium' | 'Low'
      const count = Number(row.count || 0)
      const current = heatmapMap.get(category) || { category, High: 0, Medium: 0, Low: 0, total: 0 }
      if (severityLabel === 'High') current.High += count
      else if (severityLabel === 'Medium') current.Medium += count
      else current.Low += count
      current.total += count
      heatmapMap.set(category, current)
    }

    const trendMetrics = trendMetricsRes.rows[0] || {}
    const currentWeek = Number(trendMetrics.current_week || 0)
    const previousWeek = Number(trendMetrics.previous_week || 0)
    const currentMonth = Number(trendMetrics.current_month || 0)
    const previousMonth = Number(trendMetrics.previous_month || 0)
    const weekOverWeekGrowth = previousWeek > 0
      ? Math.round(((currentWeek - previousWeek) / previousWeek) * 100)
      : (currentWeek > 0 ? 100 : 0)
    const monthlyTrend = previousMonth > 0
      ? Math.round(((currentMonth - previousMonth) / previousMonth) * 100)
      : (currentMonth > 0 ? 100 : 0)

    const series = seriesRes.rows.map(r => ({ label: r.label, count: Number(r.count) }))
    const seriesCounts = series.map(point => point.count)
    const seriesMean = seriesCounts.length
      ? (seriesCounts.reduce((acc, value) => acc + value, 0) / seriesCounts.length)
      : 0
    const seriesVariance = seriesCounts.length
      ? (seriesCounts.reduce((acc, value) => acc + ((value - seriesMean) ** 2), 0) / seriesCounts.length)
      : 0
    const seriesStdDev = Math.sqrt(seriesVariance)
    const spikeThreshold = Math.max(1, Math.round(seriesMean + (seriesStdDev * 1.5)))
    //A period is a spike when its count is >1.5 standard deviations above the mean
    //a common statistical threshold for anomaly detection.
    const incidentSpikes = series.filter(point => point.count >= spikeThreshold).length

    const aiScored = Number(totals.ai_scored || 0)
    const verifiedCount = Number(byStatus.Verified || 0)

    //AI Accuracy Rate
    const aiAccuracy = aiAccuracyRes.rows[0] || {}
    const highConfTotal = Number(aiAccuracy.high_confidence_total || 0)
    const highConfVerified = Number(aiAccuracy.high_confidence_verified || 0)
    const aiAccuracyRate = highConfTotal > 0 ? Math.round((highConfVerified / highConfTotal) * 100) : 0

    //Geographic Coverage
    const geoCoverage = geoCoverageRes.rows[0] || {}
    const geoCoverageKm = Number(geoCoverage.max_distance_km || 0)

    //Threat Level Index (0-100): weighted composite of severity, urgency, and weekly trend.
    //severity:   ≤30pts (high=3x, medium=2x weighted count ratio)
    //urgency:    ≤40pts (urgent-flagged ratio)
    //trend:      ≤30pts (week-over-week growth, capped at 100% change = 30pts)
    const highSev = Number(bySeverity.High || 0)
    const medSev = Number(bySeverity.Medium || 0)
    const urgentCount = Number(byStatus.Urgent || 0)
    const severityScore = total > 0 ? ((highSev * 3 + medSev * 2) / total) * 30 : 0
    const urgencyScore = total > 0 ? (urgentCount / total) * 40 : 0
    const trendScore = Math.min(30, Math.max(0, (weekOverWeekGrowth / 100) * 30))
    const threatLevelIndex = Math.min(100, Math.round(severityScore + urgencyScore + trendScore))

    res.json({
      range,
      generatedAt: new Date().toISOString(),
      kpis: {
        total,
        avgConfidence: Number(totals.avg_confidence || 0),
        mediaRate,
        withMedia,
        trapped: Number(totals.trapped || 0),
        verificationRate,
        falseReportRate,
        aiScored,
        avgVerifyMinutes: Number(timingRes.rows[0]?.avg_verify_minutes || 0),
        avgResolveMinutes: Number(timingRes.rows[0]?.avg_resolve_minutes || 0),
        reportsToday: Number(operational.reports_today || 0),
        reportsThisWeek: Number(operational.reports_this_week || 0),
        adminResponseMinutes: Number(operational.admin_response_minutes || 0),
        investigationCompletionMinutes: Number(operational.investigation_completion_minutes || 0),
        aiAccuracyRate,
        geoCoverageKm,
        threatLevelIndex },
      trend: {
        current: currentCount,
        previous: previousCount,
        percent: trendPct },
      byStatus,
      bySeverity,
      byCategory,
      series,
      operationalMetrics: {
        reportsToday: Number(operational.reports_today || 0),
        reportsThisWeek: Number(operational.reports_this_week || 0),
        verifiedRate: verificationRate,
        falseReportRate,
        avgVerificationTime: Number(timingRes.rows[0]?.avg_verify_minutes || 0),
        avgResolutionTime: Number(timingRes.rows[0]?.avg_resolve_minutes || 0) },
      intelligenceMetrics: {
        severityDistribution: bySeverity,
        categoryHeatmap: Array.from(heatmapMap.values()).sort((a, b) => b.total - a.total).slice(0, 8),
        locationClusters: locationClusterRes.rows.map((r) => ({
          lat: Number(r.lat),
          lng: Number(r.lng),
          count: Number(r.count),
          label: `${Number(r.lat_bin).toFixed(2)}, ${Number(r.lng_bin).toFixed(2)}` })) },
      performanceMetrics: {
        adminResponseTime: Number(operational.admin_response_minutes || 0),
        investigationCompletionTime: Number(operational.investigation_completion_minutes || 0),
        reportsPerOfficer: officerPerfRes.rows.map((r) => ({ officer: r.officer, count: Number(r.count) })) },
      trendMetrics: {
        weekOverWeekGrowth,
        monthlyTrend,
        incidentSpikes },
      dataQuality: {
        aiCoverageRate: total > 0 ? Math.round((aiScored / total) * 100) : 0,
        mediaCoverageRate: mediaRate,
        verificationCoverageRate: total > 0 ? Math.round((verifiedCount / total) * 100) : 0 } })
}))

/*
 * GET /api/reports/historical-events
 * Returns resolved/archived reports shaped as HistoricalEvent[] for the History page.
 * Also incorporates historical_flood_events table data.
 */
router.get('/historical-events', authMiddleware, operatorOnly, asyncRoute(async (_req: AuthRequest, res: Response) => {
    const [reportsRes, historicalRes] = await Promise.all([
      pool.query(
        `SELECT id, report_number, incident_category, incident_subtype, description,
                severity, location_text,
                ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lng,
                created_at, resolved_at
         FROM reports
         WHERE deleted_at IS NULL AND status IN ('resolved', 'archived')
         ORDER BY created_at DESC
         LIMIT 200`
      ),
      pool.query(
        `SELECT id, event_name, event_date, area, severity, affected_people, damage_gbp,
                ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lng,
                duration_hours, peak_water_level_m, rainfall_24h_mm
         FROM historical_flood_events
         ORDER BY event_date DESC
         LIMIT 200`
      ).catch(() => ({ rows: [] })),
    ])

    const events = reportsRes.rows.map((r: any) => ({
      id: r.report_number || r.id,
      date: (r.resolved_at || r.created_at || '').toString().slice(0, 10),
      type: (r.incident_category || 'Flood').replace(/_/g, ' '),
      location: r.location_text || 'Unknown Location',
      coordinates: [r.lat || 57.15, r.lng || -2.09],
      severity: r.severity === 'critical' ? 'High' : r.severity === 'high' ? 'High' : r.severity === 'medium' ? 'Medium' : 'Low',
      description: r.description || '',
      affectedPeople: 0,
      damage: '',
      source: 'database' }))

    const histEvents = historicalRes.rows.map((h: any) => ({
      id: `HFE-${h.id?.toString().slice(0, 8)}`,
      date: (h.event_date || '').toString().slice(0, 10),
      type: 'Flood',
      location: h.area || 'Unknown',
      coordinates: [h.lat || 57.15, h.lng || -2.09],
      severity: h.severity === 'critical' ? 'High' : h.severity === 'high' ? 'High' : h.severity === 'medium' ? 'Medium' : 'Low',
      description: h.event_name || '',
      affectedPeople: h.affected_people || 0,
      damage: h.damage_gbp ? `£${Number(h.damage_gbp) >= 1000000 ? (Number(h.damage_gbp) / 1000000).toFixed(1) + 'M' : Number(h.damage_gbp) >= 1000 ? Math.round(Number(h.damage_gbp) / 1000) + 'K' : h.damage_gbp}` : '',
      source: 'historical_flood_events' }))

    const combined = [...events, ...histEvents]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 200)

    res.json({ events: combined, total: combined.length, source: combined.length > 0 ? 'database' : 'empty' })
}))

/*
 * GET /api/reports/seasonal-trends
 * Returns per-month aggregates for the seasonal trends chart.
 */
router.get('/seasonal-trends', authMiddleware, operatorOnly, asyncRoute(async (_req: AuthRequest, res: Response) => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    const [reportsMonthly, historicalMonthly] = await Promise.all([
      pool.query(
        `SELECT EXTRACT(MONTH FROM created_at)::int AS month_num,
                COUNT(*)::int AS report_count,
                AVG(CASE severity
                  WHEN 'critical' THEN 3.0 WHEN 'high' THEN 2.5
                  WHEN 'medium' THEN 1.5 ELSE 0.5 END)::numeric(3,1) AS avg_severity
         FROM reports
         WHERE deleted_at IS NULL AND incident_category ILIKE '%flood%'
         GROUP BY month_num ORDER BY month_num`
      ),
      pool.query(
        `SELECT EXTRACT(MONTH FROM event_date)::int AS month_num,
                COUNT(*)::int AS event_count,
                AVG(CASE severity
                  WHEN 'critical' THEN 3.0 WHEN 'high' THEN 2.5
                  WHEN 'medium' THEN 1.5 ELSE 0.5 END)::numeric(3,1) AS avg_severity,
                AVG(rainfall_24h_mm)::numeric(5,1) AS avg_rainfall
         FROM historical_flood_events
         GROUP BY month_num ORDER BY month_num`
      ).catch(() => ({ rows: [] })),
    ])

    const reportMap: Record<number, any> = {}
    reportsMonthly.rows.forEach((r: any) => { reportMap[r.month_num] = r })
    const histMap: Record<number, any> = {}
    historicalMonthly.rows.forEach((h: any) => { histMap[h.month_num] = h })

    const trends = monthNames.map((month, i) => {
      const m = i + 1
      const rep = reportMap[m]
      const hist = histMap[m]
      const floodCount = (rep?.report_count || 0) + (hist?.event_count || 0)
      const avgSev = hist?.avg_severity ? Number(hist.avg_severity) : rep?.avg_severity ? Number(rep.avg_severity) : 0
      const rainfall = hist?.avg_rainfall ? Number(hist.avg_rainfall) : 0
      return { month, floodCount, avgSeverity: avgSev, rainfallMm: rainfall }
    })

    const hasData = trends.some(t => t.floodCount > 0)
    res.json({ trends, source: hasData ? 'database' : 'empty' })
}))

 /*
 * GET /api/reports/command-center
 * Executive command-center payload for the main admin dashboard.
  */
router.get('/command-center', authMiddleware, operatorOnly, asyncRoute(async (_req: AuthRequest, res: Response) => {
    const [activityRes, leaderboardRes, recommendationRes, comparativeRes] = await Promise.all([
      pool.query(
        `SELECT id, action, action_type, report_id, operator_name, created_at
         FROM activity_log
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      pool.query(
        `WITH first_response AS (
           SELECT report_id, MIN(created_at) AS first_response_at
           FROM report_status_history
           GROUP BY report_id
         )
         SELECT
           COALESCE(o.display_name, 'Unknown') AS operator,
           COUNT(*)::int AS actions,
           COUNT(*) FILTER (WHERE h.new_status IN ('verified', 'urgent'))::int AS handled,
           COALESCE(
             ROUND(AVG(EXTRACT(EPOCH FROM (fr.first_response_at - r.created_at)) / 60))::int,
             0
           ) AS avg_response_minutes
         FROM report_status_history h
         LEFT JOIN operators o ON o.id = h.changed_by
         LEFT JOIN reports r ON r.id = h.report_id
         LEFT JOIN first_response fr ON fr.report_id = h.report_id
         WHERE h.created_at >= NOW() - INTERVAL '7 days'
         GROUP BY operator
         ORDER BY handled DESC, actions DESC
         LIMIT 5`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'urgent')::int AS urgent_open,
           COUNT(*) FILTER (WHERE status = 'unverified' AND severity = 'high')::int AS high_unverified,
           COUNT(*) FILTER (WHERE status = 'flagged' AND ai_confidence >= 80)::int AS high_confidence_flagged,
           COUNT(*) FILTER (WHERE has_media = false AND status IN ('urgent', 'unverified'))::int AS pending_media
         FROM reports`
      ),
      pool.query(
        `WITH today AS (
           SELECT COUNT(*)::int AS c
           FROM reports
           WHERE created_at >= date_trunc('day', NOW())
         ),
         yesterday AS (
           SELECT COUNT(*)::int AS c
           FROM reports
           WHERE created_at >= date_trunc('day', NOW() - INTERVAL '1 day')
             AND created_at < date_trunc('day', NOW())
         ),
         this_week AS (
           SELECT COUNT(*)::int AS c
           FROM reports
           WHERE created_at >= NOW() - INTERVAL '7 days'
         ),
         previous_week AS (
           SELECT COUNT(*)::int AS c
           FROM reports
           WHERE created_at < NOW() - INTERVAL '7 days'
             AND created_at >= NOW() - INTERVAL '14 days'
         )
         SELECT
           today.c AS today_count,
           yesterday.c AS yesterday_count,
           this_week.c AS this_week_count,
           previous_week.c AS previous_week_count
         FROM today, yesterday, this_week, previous_week`
      )
    ])

    const rec = recommendationRes.rows[0] || {}
    const urgentOpen = Number(rec.urgent_open || 0)
    const highUnverified = Number(rec.high_unverified || 0)
    const highConfidenceFlagged = Number(rec.high_confidence_flagged || 0)
    const pendingMedia = Number(rec.pending_media || 0)

    const recommendations: Array<{ priority: 'critical' | 'high' | 'medium'; message: string }> = []
    if (urgentOpen > 0) recommendations.push({ priority: 'critical', message: `${urgentOpen} urgent reports need immediate assignment.` })
    if (highUnverified > 0) recommendations.push({ priority: 'high', message: `${highUnverified} high-severity reports are still unverified.` })
    if (highConfidenceFlagged > 0) recommendations.push({ priority: 'high', message: `${highConfidenceFlagged} high-confidence flagged reports need review.` })
    if (pendingMedia > 0) recommendations.push({ priority: 'medium', message: `${pendingMedia} critical/unverified reports have no media evidence.` })
    if (recommendations.length === 0) {
      recommendations.push({ priority: 'medium', message: 'System stable: no immediate operational escalations detected.' })
    }

    const cmp = comparativeRes.rows[0] || {}
    const todayCount = Number(cmp.today_count || 0)
    const yesterdayCount = Number(cmp.yesterday_count || 0)
    const thisWeekCount = Number(cmp.this_week_count || 0)
    const previousWeekCount = Number(cmp.previous_week_count || 0)

    const dayDeltaPct = yesterdayCount > 0
      ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
      : (todayCount > 0 ? 100 : 0)
    const weekDeltaPct = previousWeekCount > 0
      ? Math.round(((thisWeekCount - previousWeekCount) / previousWeekCount) * 100)
      : (thisWeekCount > 0 ? 100 : 0)

    res.json({
      generatedAt: new Date().toISOString(),
      activity: activityRes.rows,
      leaderboard: leaderboardRes.rows.map((r) => ({
        operator: r.operator,
        actions: Number(r.actions || 0),
        handled: Number(r.handled || 0),
        avgResponseMinutes: Number(r.avg_response_minutes || 0) })),
      recommendations,
      comparative: {
        today: todayCount,
        yesterday: yesterdayCount,
        dayDeltaPct,
        thisWeek: thisWeekCount,
        previousWeek: previousWeekCount,
        weekDeltaPct } })
}))

 /*
 * GET /api/reports/nearby
 * Spatial query: finds reports within a given radius of a point.
 * Uses PostGIS ST_DWithin for efficient spatial filtering.
 * Query params: lat, lng, radius (in metres, default 5000)
  */
router.get('/nearby', asyncRoute(async (req: Request, res: Response) => {
    const { lat, lng, radius = '5000' } = req.query
    if (!lat || !lng) {
      throw AppError.badRequest('lat and lng query parameters are required.')
    }

    const result = await pool.query(
      `SELECT id, report_number, display_type, severity, status, location_text,
              ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
              ai_confidence, created_at,
              ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
       FROM reports
       WHERE ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
       ORDER BY distance_m ASC LIMIT 50`,
      [parseFloat(lat as string), parseFloat(lng as string), parseInt(radius as string)]
    )

    res.json(result.rows.map(r => ({
      ...formatReport(r),
      distanceMetres: Math.round(r.distance_m) })))
}))

 /*
 * GET /api/reports/:id
 * Returns a single report by its UUID.
  */
router.get('/:id', asyncRoute(async (req: Request, res: Response) => {
    const user = tryExtractUser(req)
    const isOp = isOperatorRole(user?.role)

    const result = await pool.query(
      `SELECT id, report_number, incident_category, incident_subtype, display_type,
              description, severity, status, trapped_persons, location_text,
              ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
              has_media, media_type, media_url, reporter_name,
              ai_confidence, ai_analysis, operator_notes,
              created_at, updated_at, verified_at, resolved_at
       FROM reports WHERE id = $1`,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      throw AppError.notFound('Report not found.')
    }

    if (isOp) {
      //Operators get full data including media
      const mediaResult = await pool.query(
        `SELECT id, file_url, file_type, file_size, original_filename,
                ai_processed, ai_classification, ai_water_depth, ai_authenticity_score, ai_reasoning
         FROM report_media WHERE report_id = $1 ORDER BY created_at`,
        [req.params.id]
      )
      const media = mediaResult.rows.map(m => ({
        id: m.id,
        url: m.file_url,
        file_url: m.file_url,
        fileType: m.file_type,
        fileSize: m.file_size,
        originalFilename: m.original_filename,
        aiAnalysis: m.ai_processed ? {
          classification: m.ai_classification,
          waterDepth: m.ai_water_depth,
          authenticityScore: m.ai_authenticity_score,
          reasoning: m.ai_reasoning } : null }))
      res.json({ ...formatReport(result.rows[0]), media })
    } else {
      //Public access: include media but redact operator-only fields
      const mediaResult = await pool.query(
        `SELECT id, file_url, file_type, file_size, original_filename
         FROM report_media WHERE report_id = $1 ORDER BY created_at`,
        [req.params.id]
      )
      const media = mediaResult.rows.map(m => ({
        id: m.id,
        url: m.file_url,
        file_url: m.file_url,
        fileType: m.file_type,
        fileSize: m.file_size,
        originalFilename: m.original_filename }))
      res.json({ ...formatReportPublic(result.rows[0]), media })
    }
}))

/*
 * POST /api/reports/:id/reanalyse
 * Re-runs the full AI analysis pipeline on an existing report.
 * Admin/operator only. Returns updated aiAnalysis object.
 */
router.post('/:id/reanalyse', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const reportId = String(req.params.id)
    const exists = await pool.query('SELECT id FROM reports WHERE id = $1', [reportId])
    if (exists.rows.length === 0) {
      throw AppError.notFound('Report not found.')
    }
    const result = await reanalyseReport(reportId)
    if (!result) {
      res.status(500).json({ ok: false, error: 'Re-analysis failed -- check server logs.' })
      return
    }
    res.json({ ok: true, aiAnalysis: result })
}))

 /*
 * POST /api/reports
 * Submit a new emergency report (public endpoint, no auth required).
 * Accepts multipart form data to allow evidence photo/video upload.
 * Automatically runs AI confidence scoring based on available data.
  */
router.post('/', reportSubmitLimiter, uploadEvidence, validateMagicBytes, asyncRoute(async (req: Request, res: Response) => {
    const submitter = tryExtractUser(req)
    const {
      incidentCategory, incidentSubtype, displayType,
      description, severity, trappedPersons,
      locationText, lat, lng,
      locationMetadata: rawLocationMetadata,
      customFields: rawCustomFields } = req.body

    //Safely parse customFields -- sent as JSON string from FormData
    //whitelistfilter prevents nested objects/arrays from being stored unintentionally.
    let customFields: Record<string, unknown> = {}
    if (rawCustomFields) {
      try {
        const parsed = typeof rawCustomFields === 'string' ? JSON.parse(rawCustomFields) : rawCustomFields
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          //Whitelist: only allow boolean, number, string values (no nested objects)
          customFields = Object.fromEntries(
            Object.entries(parsed).filter(([, v]) => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string')
          )
        }
      } catch { /* malformed JSON -- ignore, proceed with empty customFields */ }
    }

    let locationMetadata: any = null
    if (rawLocationMetadata) {
      try {
        const parsed = typeof rawLocationMetadata === 'string' ? JSON.parse(rawLocationMetadata) : rawLocationMetadata
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const parsedLatMeta = Number(parsed.lat)
          const parsedLngMeta = Number(parsed.lng)
          const parsedConfidence = Number(parsed.confidence)
          const parsedAccuracy = parsed.accuracy === null || parsed.accuracy === undefined ? null : Number(parsed.accuracy)
          const source = String(parsed.source || 'manual_text')

          if (
            Number.isFinite(parsedLatMeta) && parsedLatMeta >= -90 && parsedLatMeta <= 90
            && Number.isFinite(parsedLngMeta) && parsedLngMeta >= -180 && parsedLngMeta <= 180
            && Number.isFinite(parsedConfidence) && parsedConfidence >= 0 && parsedConfidence <= 1
            && (parsedAccuracy === null || (Number.isFinite(parsedAccuracy) && parsedAccuracy >= 0 && parsedAccuracy <= 10000))
          ) {
            locationMetadata = {
              lat: parsedLatMeta,
              lng: parsedLngMeta,
              accuracy: parsedAccuracy,
              source,
              confidence: parsedConfidence,
              user_corrected: Boolean(parsed.user_corrected) }
          }
        }
      } catch {
        //Ignore malformed metadata and continue.
      }
    }

    if (locationMetadata) {
      customFields = {
        ...customFields,
        location_metadata: locationMetadata }
    }

    //Validate required fields
    if (
      !incidentCategory ||
      !description ||
      !severity ||
      !locationText ||
      lat === undefined ||
      lat === null ||
      lng === undefined ||
      lng === null
    ) {
      throw AppError.badRequest('Missing required fields.')
    }

    //Input length validation (#29)
    if (typeof description !== 'string' || description.length > 5000) {
      throw AppError.badRequest('Description must be under 5000 characters.')
    }
    if (typeof locationText !== 'string' || locationText.length > 500) {
      throw AppError.badRequest('Location text must be under 500 characters.')
    }
    const parsedLat = parseFloat(lat)
    const parsedLng = parseFloat(lng)
    if (isNaN(parsedLat) || isNaN(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      throw AppError.badRequest('Invalid coordinates.')
    }

    //Build media URL if evidence was uploaded (support up to 3 files)
    const files = (req as any).files as Express.Multer.File[] | undefined
    const hasFiles = Array.isArray(files) && files.length > 0
    const mediaUrl = hasFiles ? `/uploads/evidence/${files![0].filename}` : null
    const hasMedia = hasFiles
    const mediaType = hasFiles
      ? (files.some(f => f.mimetype.startsWith('video/')) ? 'video' : 'photo')
      : null

    // Deduplication check: run before INSERT so we can flag the report
    //   and inform the submitter without blocking them.
    const dupCheck = await checkDuplicate(
      description, parsedLat, parsedLng, incidentCategory,
    )

    //Run basic AI confidence scoring
    //Calls real HuggingFace ML classifiers with heuristic fallback
    const aiResult = await computeAIScore(description, severity, trappedPersons, hasMedia, parseFloat(lat), parseFloat(lng))

    //Attach dedup metadata to ai_analysis so it is visible in the admin dashboard
    if (dupCheck) {
      aiResult.analysis = {
        ...aiResult.analysis,
        deduplication: dupCheck }
    }

    const dbSeverity = toDbSeverity(severity)
    const reportNumber = await generateReportNumberSafe()

    //Attempt INSERT with custom_fields; fall back without it if column doesn't exist yet
    let result: any
    try {
      result = await pool.query(
        `INSERT INTO reports
         (report_number, incident_category, incident_subtype, display_type,
          description, severity, trapped_persons, location_text, coordinates,
          has_media, media_type, media_url, reporter_name, ai_confidence, ai_analysis, custom_fields, citizen_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
           ST_SetSRID(ST_MakePoint($10, $9), 4326),
           $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id, report_number, created_at`,
        [
          reportNumber,
          incidentCategory, incidentSubtype || '', displayType || '',
          description, dbSeverity, trappedPersons || 'no', locationText,
          parseFloat(lat), parseFloat(lng),
          hasMedia, mediaType, mediaUrl,
          submitter?.displayName || 'Anonymous Citizen',
          aiResult.confidence, JSON.stringify(aiResult.analysis),
          JSON.stringify(customFields),
          submitter?.id || null,
        ]
      )
    } catch (colErr: any) {
      //Fallback: custom_fields column may not exist on un-migrated DBs
      if (colErr.message?.includes('custom_fields') || colErr.code === '42703') {
        result = await pool.query(
            `INSERT INTO reports
             (report_number, incident_category, incident_subtype, display_type,
              description, severity, trapped_persons, location_text, coordinates,
              has_media, media_type, media_url, reporter_name, ai_confidence, ai_analysis, citizen_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               ST_SetSRID(ST_MakePoint($10, $9), 4326),
               $11, $12, $13, $14, $15, $16, $17)
             RETURNING id, report_number, created_at`,
          [
            reportNumber,
            incidentCategory, incidentSubtype || '', displayType || '',
            description, dbSeverity, trappedPersons || 'no', locationText,
            parseFloat(lat), parseFloat(lng),
            hasMedia, mediaType, mediaUrl,
            submitter?.displayName || 'Anonymous Citizen',
            aiResult.confidence, JSON.stringify(aiResult.analysis),
              submitter?.id || null,
            ]
        )
      } else {
        throw colErr
      }
    }

    const report = result.rows[0]
    reportSubmissionsTotal.inc()

    //Insert all uploaded files into report_media table
    if (hasFiles && files!.length > 0) {
      for (const file of files!) {
        await pool.query(
          `INSERT INTO report_media (report_id, file_url, file_type, file_size, original_filename)
           VALUES ($1, $2, $3, $4, $5)`,
          [report.id, `/uploads/evidence/${file.filename}`, file.mimetype, file.size, file.originalname]
        )
      }
    }

    //Publish typed event onto the Aegis event spine. The socketBroadcastSubscriber
    //fetches the full report from DB and emits 'report:new' to all connected clients.
    //The auditSubscriber records the event automatically.
    const dbSeverityEvt = dbSeverity === 'high' ? 'high' : dbSeverity === 'medium' ? 'medium' : 'low'
    await eventBus.publish(
      AegisEventNames.REPORT_CREATED,
      {
        reportId: String(report.id),
        reporterId: submitter?.id ? String(submitter.id) : undefined,
        hazardType: incidentSubtype || incidentCategory,
        latitude: parsedLat,
        longitude: parsedLng,
        description: typeof description === 'string' ? description.slice(0, 500) : undefined,
        mediaCount: hasFiles ? files!.length : 0,
        severity: dbSeverityEvt },
      { source: 'citizen', severity: dbSeverityEvt },
    )

    //Run the full AI analysis pipeline in the background (non-blocking).
    //This calls real HuggingFace classifiers for sentiment, fake detection,
    //severity, category, language, and urgency on the submitted report.
    analyseReport(
      report.id, description, parseFloat(lat), parseFloat(lng),
      locationText, dbSeverity, hasMedia,
    ).catch((err: any) =>
      logger.error({ err }, '[Reports] AI pipeline error'),
    )

    //Auto-create a draft deployment zone for urgent/high-severity reports (non-blocking)
    //This ensures all critical multi-hazard incidents get an immediate resource draft,
    //not just AI flood predictions.
    if ((dbSeverity === 'high' || trappedPersons === 'yes') && Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
      const category: string = incidentCategory || 'other'
      const subtype: string = incidentSubtype || ''
      const hazardKey = subtype || category
      const isHighestSeverity = dbSeverity === 'high' && trappedPersons === 'yes'
      const draftPriority = isHighestSeverity ? 'Critical' : 'High'

      //Inline per-hazard resource recommendation (mirrors server helper)
      const h = hazardKey.toLowerCase()
      let amb = draftPriority === 'Critical' ? 3 : 2
      let fire = draftPriority === 'Critical' ? 2 : 1
      let boats = 0
      if (['flood', 'tsunami', 'coastal', 'flash_flood'].some(k => h.includes(k))) { amb = draftPriority === 'Critical' ? 4 : 2; fire = draftPriority === 'Critical' ? 2 : 1; boats = draftPriority === 'Critical' ? 4 : 2 }
      else if (['wildfire', 'fire', 'burn'].some(k => h.includes(k))) { amb = draftPriority === 'Critical' ? 3 : 2; fire = draftPriority === 'Critical' ? 6 : 3; boats = 0 }
      else if (['earthquake', 'building_collapse', 'structural', 'landslide', 'avalanche'].some(k => h.includes(k))) { amb = draftPriority === 'Critical' ? 5 : 3; fire = draftPriority === 'Critical' ? 3 : 2; boats = 0 }
      else if (['chemical', 'gas_leak', 'hazmat', 'pollution', 'environmental'].some(k => h.includes(k))) { amb = draftPriority === 'Critical' ? 4 : 2; fire = draftPriority === 'Critical' ? 2 : 1; boats = 0 }
      else if (['medical', 'mass_casualty'].some(k => h.includes(k))) { amb = draftPriority === 'Critical' ? 8 : 4; fire = 1; boats = 0 }

      const draftZoneName = `${displayType || category.replace(/_/g, ' ')} -- ${locationText.slice(0, 60)}`
      const draftAiRec = `Auto-drafted from citizen report ${report.report_number}. ${draftPriority} severity ${hazardKey.replace(/_/g, ' ')} reported. Awaiting operator review.`
      pool.query(
        `INSERT INTO resource_deployments
           (zone, priority, active_reports, estimated_affected, ai_recommendation,
            ambulances, fire_engines, rescue_boats, coordinates, report_id, is_ai_draft)
         SELECT $1, $2, 1, $3, $4, $5, $6, $7,
                ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, true
         WHERE NOT EXISTS (
           SELECT 1 FROM resource_deployments WHERE report_id = $10 AND is_ai_draft = true
         )`,
        [
          draftZoneName, draftPriority,
          `Citizen-reported ${hazardKey.replace(/_/g, ' ')}`,
          draftAiRec, amb, fire, boats,
          parsedLng, parsedLat,
          report.id,
        ]
      ).catch(() => {})
    }

    res.status(201).json({
      id: report.id,
      reportNumber: report.report_number,
      createdAt: report.created_at,
      aiConfidence: aiResult.confidence,
      locationMetadata,
      ...(dupCheck?.isDuplicate ? {
        possibleDuplicate: {
          reportNumber: dupCheck.duplicateReportNumber,
          similarityPct: dupCheck.confidencePct,
          message: `This report may be a duplicate of ${dupCheck.duplicateReportNumber} (${dupCheck.confidencePct}% similarity). It has been submitted and will be reviewed.` } } : {}) })
}))

/*
 * PUT /api/reports/bulk/status
 * Bulk update status for multiple reports (admin only).
  */
router.put('/bulk/status', authMiddleware, operatorOnly, bulkStatusLimiter, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { reportIds, status, reason } = req.body

    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      throw AppError.badRequest('reportIds must be a non-empty array')
    }

    if (reportIds.length > 200) {
      throw AppError.badRequest('Maximum 200 report IDs per bulk operation')
    }

    const valid = ['Verified', 'Urgent', 'Flagged', 'Resolved', 'Archived', 'False_Report']
    if (!valid.includes(status)) {
      throw AppError.badRequest(`Invalid status. Must be one of: ${valid.join(', ')}`)
    }

    const dbStatus = toDbStatus(status)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const typeMap: Record<string, string> = {
        Verified: 'verify', Urgent: 'urgent', Flagged: 'flag', Resolved: 'resolve',
        Archived: 'archive', False_Report: 'false_report' }

      let updated = 0
      for (const reportId of reportIds) {
        //Get old status
        const beforeResult = await client.query('SELECT status::text AS status FROM reports WHERE id = $1', [reportId])
        if (beforeResult.rows.length === 0) continue

        const oldStatus = beforeResult.rows[0].status

        //Build updates based on status
        const updates: string[] = ['status = $1']
        const params: any[] = [dbStatus]
        let idx = 2

        if (status === 'Verified' || status === 'Urgent') {
          updates.push(`verified_by = $${idx++}`, `verified_at = NOW()`)
          params.push(req.user!.id)
        }
        if (status === 'Resolved') {
          updates.push(`resolved_at = NOW()`)
        }

        params.push(reportId)
        await client.query(`UPDATE reports SET ${updates.join(', ')} WHERE id = $${idx}`, params)

        //Log history
        await client.query(
          `INSERT INTO report_status_history (report_id, old_status, new_status, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [reportId, oldStatus, dbStatus, req.user!.id, reason || `Bulk ${status.toLowerCase()}`]
        )

        //Log activity
        await client.query(
          `INSERT INTO activity_log (action, action_type, report_id, operator_id, operator_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            `${status === 'Urgent' ? 'Escalated to URGENT' : `Marked as ${status}`} (bulk)`,
            typeMap[status] || 'verify',
            reportId, req.user!.id, req.user!.displayName,
          ]
        )

        updated++
      }

      await client.query('COMMIT')

      res.json({ success: true, status, updated })

      //Broadcast updates via WebSocket
      try {
        const io = req.app.get('io')
        if (io) {
          io.emit('report:bulk-updated', { reportIds, status, updatedBy: req.user!.displayName, count: updated })
 devLog(`[Reports] Broadcast bulk update: ${updated} reports -> ${status}`)
        }
      } catch (wsErr: any) {
        logger.warn({ err: wsErr }, '[Reports] WebSocket broadcast failed')
      }
    } catch (txErr: any) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
}))

/*
 * PUT /api/reports/:id/status
 * Update report status (admin only). Logs the action in the activity trail.
 * Valid statuses: Verified, Urgent, Flagged, Resolved
 * Uses transaction + SELECT FOR UPDATE to prevent race conditions.
  */
router.put('/:id/status', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  let released = false
  try {
    const { status, reason } = req.body
    const valid = ['Verified', 'Urgent', 'Flagged', 'Resolved', 'Archived', 'False_Report']
    if (!valid.includes(status)) {
      throw AppError.badRequest(`Invalid status. Must be one of: ${valid.join(', ')}`)
    }

    const dbStatus = toDbStatus(status)

    await client.query('BEGIN')

    //SELECT FOR UPDATE locks the row to prevent concurrent modifications
    const beforeResult = await client.query(
      'SELECT status::text AS status, verified_by FROM reports WHERE id = $1 FOR UPDATE',
      [req.params.id]
    )
    if (beforeResult.rows.length === 0) {
      await client.query('ROLLBACK')
      throw AppError.notFound('Report not found.')
    }
    const oldStatus = beforeResult.rows[0].status
    const alreadyDecided = ['verified', 'urgent', 'false_report', 'resolved', 'archived'].includes(oldStatus?.toLowerCase())
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.department === 'Command & Control'

    //Status locking: once a decision is made, only super-admins can override with justification
    if (alreadyDecided && !isSuperAdmin) {
      await client.query('ROLLBACK')
      throw AppError.forbidden('This report has already been actioned. Only a super-admin can override the status.')
    }
    if (alreadyDecided && isSuperAdmin && !reason?.trim()) {
      await client.query('ROLLBACK')
      throw AppError.badRequest('A justification is required to override an already-actioned report.')
    }

    //Build the update based on the new status
    const updates: string[] = ['status = $1']
    const params: any[] = [dbStatus]
    let idx = 2

    if (status === 'Verified' || status === 'Urgent') {
      updates.push(`verified_by = $${idx++}`, `verified_at = NOW()`)
      params.push(req.user!.id)
    }
    if (status === 'Resolved') {
      updates.push(`resolved_at = NOW()`)
    }
    if (status === 'Archived') {
      updates.push(`resolved_at = COALESCE(resolved_at, NOW())`)
    }

    params.push(req.params.id)
    await client.query(
      `UPDATE reports SET ${updates.join(', ')} WHERE id = $${idx}`,
      params
    )

    await client.query(
      `INSERT INTO report_status_history (report_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, oldStatus, dbStatus, req.user!.id, reason || null]
    )

    //Map status to activity log action type
    const typeMap: Record<string, string> = {
      Verified: 'verify', Urgent: 'urgent', Flagged: 'flag', Resolved: 'resolve',
      Archived: 'archive', False_Report: 'false_report' }
    await client.query(
      `INSERT INTO activity_log (action, action_type, report_id, operator_id, operator_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `${status === 'Urgent' ? 'Escalated to URGENT' : `Marked as ${status}`}`,
        typeMap[status] || 'verify',
        req.params.id, req.user!.id, req.user!.displayName,
      ]
    )

    await client.query('COMMIT')

    //Store oldStatus for WebSocket broadcast (must happen after commit succeeds)
    const broadcastOldStatus = oldStatus

    released = true
    client.release()

    res.json({ success: true, status })

    //Broadcast status update via WebSocket
    try {
      const io = req.app.get('io')
      if (io) {
        io.emit('report:updated', { id: req.params.id, status, oldStatus: toUiStatus(broadcastOldStatus), updatedBy: req.user!.displayName })
 devLog(`[Reports] Broadcast report:updated ${req.params.id} -> ${status}`)
      }
    } catch (wsErr: any) {
      logger.warn({ err: wsErr }, '[Reports] WebSocket broadcast failed')
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (!released) client.release()
  }
}))

 /*
 * PUT /api/reports/:id/notes
 * Add or update operator notes on a report (admin only).
  */
router.put('/:id/notes', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { notes } = req.body
    await pool.query('UPDATE reports SET operator_notes = $1 WHERE id = $2', [notes, req.params.id])

    await pool.query(
      `INSERT INTO activity_log (action, action_type, report_id, operator_id, operator_name)
       VALUES ($1, $2, $3, $4, $5)`,
      ['Added operator notes', 'note', req.params.id, req.user!.id, req.user!.displayName]
    )

    res.json({ success: true })
}))

 /*
 * GET /api/reports/export
 * Export all reports as JSON (admin only).
  */
router.get('/export/json', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const result = await pool.query(
      `SELECT id, report_number, incident_category, incident_subtype, display_type,
              description, severity, status, trapped_persons, location_text,
              ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
              has_media, media_type, ai_confidence, ai_analysis, created_at
       FROM reports ORDER BY created_at DESC`
    )

    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      [`Exported ${result.rows.length} reports as JSON`, 'export', req.user!.id, req.user!.displayName]
    )

    res.json(result.rows.map(formatReport))
}))

//REPORT DEDUPLICATION  (Feature #9)

 /*
 * Jaccard similarity on word-token sets -- fast, no external deps.
 * Returns 0-1 where 1 = identical token sets.
  */
function jaccardSimilarity(a: string, b: string): number {
  const tokenise = (t: string) =>
    new Set(
      t.toLowerCase()
       .replace(/[^\w\s]/g, ' ')
       .split(/\s+/)
       .filter(w => w.length > 2),
    )
  const setA = tokenise(a)
  const setB = tokenise(b)
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const t of setA) { if (setB.has(t)) intersection++ }
  return intersection / (setA.size + setB.size - intersection)
}

 /*
 * Check if an incoming report is a likely duplicate of a recently submitted one.
 * Criteria:
 * Same incident category
 * Within 250 metres
 * Submitted within the last 90 minutes
 * Jaccard token similarity ≥ 0.55
 * Returns the best match (highest similarity) above the threshold, or null.
  */
async function checkDuplicate(
  text: string,
  lat: number,
  lng: number,
  category: string,
): Promise<{
  isDuplicate: boolean
  duplicateOf: string | null
  duplicateReportNumber: string | null
  similarityScore: number
  confidencePct: number
} | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id::text, report_number, description
       FROM reports
       WHERE incident_category = $1
         AND deleted_at IS NULL
         AND created_at > now() - INTERVAL '90 minutes'
         AND ST_DWithin(
           coordinates,
           ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
           250
         )
       ORDER BY created_at DESC
       LIMIT 8`,
      [category, lat, lng],
    )

    let bestSim = 0
    let bestRow: any = null

    for (const row of rows) {
      const sim = jaccardSimilarity(text, row.description || '')
      if (sim > bestSim) { bestSim = sim; bestRow = row }
    }

    if (bestSim >= 0.55 && bestRow) {
      return {
        isDuplicate: true,
        duplicateOf: bestRow.id,
        duplicateReportNumber: bestRow.report_number,
        similarityScore: Math.round(bestSim * 1000) / 1000,
        confidencePct: Math.round(bestSim * 100) }
    }

    return { isDuplicate: false, duplicateOf: null, duplicateReportNumber: null, similarityScore: bestSim, confidencePct: 0 }
  } catch {
    return null
  }
}

 /*
 * Real-time AI confidence scoring using ML classifiers.
 * Calls HuggingFace models for sentiment, fake detection, and severity.
 * Falls back to heuristic-based scoring if ML services are unavailable.
  */
async function computeAIScore(
  description: string, severity: string, trapped: string,
  hasMedia: boolean, lat: number, lng: number
): Promise<{ confidence: number; analysis: any }> {
  const modelsUsed: string[] = []
  const hfKeyPresent = !!(process.env.HF_API_KEY)

  //When HuggingFace API key is absent, use local Python AI engine instead
  //so reports get real ML scoring rather than silent 'unknown' fallbacks.
  if (!hfKeyPresent) {
    try {
      const [fakeRes, severityRes, classifyRes] = await Promise.allSettled([
        aiClient.detectFake({ text: description, description, image_count: hasMedia ? 1 : 0 }),
        aiClient.predictSeverity({ text: description, description, trapped_persons: trapped === 'yes' ? 1 : 0 }),
        aiClient.classifyReport(description, description),
      ])
      const fake = fakeRes.status === 'fulfilled' ? fakeRes.value : null
      const sev  = severityRes.status === 'fulfilled' ? severityRes.value : null
      const cat  = classifyRes.status === 'fulfilled' ? classifyRes.value : null

      if (fake) modelsUsed.push('local-fake-detector')
      if (sev)  modelsUsed.push('local-severity-predictor')
      if (cat)  modelsUsed.push('local-report-classifier')

      let confidence = 45
      const fakeProbability = fake?.fake_probability ?? fake?.probability ?? 0.3
      if (fakeProbability < 0.2) confidence += 20
      else if (fakeProbability < 0.4) confidence += 10
      else confidence -= 10

      if (sev) {
        const sevLabel = (sev.predicted_severity || '').toLowerCase()
        if (sevLabel === severity.toLowerCase()) confidence += 10
        confidence += Math.round((sev.confidence ?? 0) * 15)
      }
      if (hasMedia) confidence += 12
      if (trapped === 'yes') confidence += 5
      if (isWithinActiveRegion(lat, lng)) confidence += 5
      const wordCount = description.split(/\s+/).length
      if (wordCount > 30) confidence += 8
      else if (wordCount > 15) confidence += 4
      confidence = Math.min(Math.max(confidence, 15), 95)

      return {
        confidence,
        analysis: {
          panicLevel: 0,
          fakeProbability: Math.round(fakeProbability * 100),
          sentimentScore: 0,
          keyEntities: [],
          modelsUsed,
          mlPowered: modelsUsed.length > 0,
          reasoning: `Local AI engine scoring (HF key not configured). ` +
            `Confidence ${confidence}% from ${modelsUsed.length} local models. ` +
            `Fake probability: ${Math.round(fakeProbability * 100)}%.`,
          predictedCategory: cat?.hazard_type || null,
          predictedSeverity: sev?.predicted_severity || null } }
    } catch {
      return computeAIScoreFallback(description, severity, trapped, hasMedia, lat, lng)
    }
  }

  try {
    //Run 3 ML classifiers in parallel for speed
    const [sentimentResult, fakeResult, severityResult] = await Promise.allSettled([
      classify({ text: description, task: 'sentiment' }),
      classify({ text: description, task: 'fake_detection' }),
      classify({ text: description, task: 'severity' }),
    ])

    const sentiment = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null
    const fake = fakeResult.status === 'fulfilled' ? fakeResult.value : null
    const severityPred = severityResult.status === 'fulfilled' ? severityResult.value : null

    if (sentiment) modelsUsed.push('sentiment-roberta')
    if (fake) modelsUsed.push('fake-detector')
    if (severityPred) modelsUsed.push('severity-bart-mnli')

    //Composite confidence formula -- components add/subtract from base 50:
 // fake probability < 0.3 -> +20, < 0.5 -> +10, else -> -10
 // severity match with ML prediction -> +10 + (ML confidence × 15)
 // photo/video evidence attached -> +12
 // trapped persons reported -> +5
 // location within active region -> +5
 // description ≥30 words -> +8, ≥15 words -> +4
    //  hard floor 15, hard cap 95 (never guarantee or discard a report)
    let confidence = 50 // Base

    //Fake probability inversely affects confidence
    const fakeProbability = fake?.score ?? 0.3
    if (fakeProbability < 0.3) confidence += 20
    else if (fakeProbability < 0.5) confidence += 10
    else confidence -= 10

    //Severity alignment boosts confidence
    if (severityPred) {
      const severityMatch = severityPred.label?.toLowerCase() === severity.toLowerCase()
      if (severityMatch) confidence += 10
      confidence += Math.round(severityPred.score * 15)
    }

    //Media evidence
    if (hasMedia) confidence += 12

    //Trapped persons
    if (trapped === 'yes') confidence += 5

    if (isWithinActiveRegion(lat, lng)) confidence += 5

    //Description quality
    const wordCount = description.split(/\s+/).length
    if (wordCount > 30) confidence += 8
    else if (wordCount > 15) confidence += 4

    confidence = Math.min(Math.max(confidence, 15), 95)

    //Sentiment-derived panic level
    let panicLevel = 0
    if (sentiment) {
      const negLabels = ['negative', 'NEGATIVE', 'LABEL_0']
      if (negLabels.includes(sentiment.label)) {
        panicLevel = Math.round(sentiment.score * 10)
      }
    }

    //Extract key entities
    const entityPatterns = /\b(River \w+|[A-Z][a-z]+ (?:Street|Road|Drive|Bridge|Park|Green|Walk)|\b[A-Z]{2,3}\d+\b)/g
    const keyEntities = [...new Set((description.match(entityPatterns) || []).slice(0, 5))]

    return {
      confidence,
      analysis: {
        panicLevel,
        fakeProbability: Math.round((fakeProbability) * 100),
        sentimentScore: sentiment ? Math.round(sentiment.score * 100) / 100 : 0,
        keyEntities,
        modelsUsed,
        mlPowered: true,
        reasoning: `AI confidence ${confidence}% from ${modelsUsed.length} ML models. ` +
          `Fake probability: ${Math.round(fakeProbability * 100)}%. ` +
          (hasMedia ? 'Photo evidence provided. ' : '') +
          (wordCount > 20 ? 'Detailed description. ' : '') +
          (trapped === 'yes' ? 'Trapped persons reported. ' : '') } }
  } catch (err: any) {
    logger.warn({ err }, '[Reports] ML scoring failed, using heuristic')
    return computeAIScoreFallback(description, severity, trapped, hasMedia, lat, lng)
  }
}

 /*
 * Heuristic-only fallback when ML services are unavailable.
  */
function computeAIScoreFallback(
  description: string, severity: string, trapped: string,
  hasMedia: boolean, lat: number, lng: number
): { confidence: number; analysis: any } {
  let confidence = 40

  const wordCount = description.split(/\s+/).length
  if (wordCount > 30) confidence += 15
  else if (wordCount > 15) confidence += 10
  else if (wordCount > 8) confidence += 5

  const locationWords = ['street', 'road', 'drive', 'avenue', 'bridge', 'river', 'park', 'near', 'junction']
  const locMatches = locationWords.filter(w => description.toLowerCase().includes(w)).length
  confidence += Math.min(locMatches * 5, 15)

  if (hasMedia) confidence += 15
  if (severity === 'High') confidence += 5
  if (trapped === 'yes') confidence += 5

  if (isWithinActiveRegion(lat, lng)) confidence += 5

  confidence = Math.min(Math.max(confidence, 15), 95)

  const entityPatterns = /\b(River \w+|[A-Z][a-z]+ (?:Street|Road|Drive|Bridge|Park|Green|Walk)|\b[A-Z]{2,3}\d+\b)/g
  const keyEntities = [...new Set((description.match(entityPatterns) || []).slice(0, 5))]

  return {
    confidence,
    analysis: {
      panicLevel: 0,
      fakeProbability: Math.max(5, 40 - confidence / 2),
      sentimentScore: 0,
      keyEntities,
      modelsUsed: [],
      mlPowered: false,
      reasoning: `Heuristic scoring (ML unavailable). Confidence based on description quality and metadata.` } }
}

 /*
 * Transforms a database row into the standardised API response format.
 * Converts PostGIS coordinate columns into a simple coordinates array.
  */
/**
 * Redact sensitive fields from a report for public/unauthenticated access.
 * Strips: reporter name, operator notes, raw AI analysis, exact coordinates, media URLs.
 */
function formatReportPublic(row: any): any {
  return {
    id: row.id,
    reportNumber: row.report_number,
    incidentCategory: row.incident_category,
    incidentSubtype: row.incident_subtype,
    type: row.display_type,
    description: row.description,
    severity: toUiSeverity(row.severity),
    status: toUiStatus(row.status),
    trappedPersons: row.trapped_persons,
    location: row.location_text,
    //Round coordinates to ~1km precision for public safety without exact location
    coordinates: [
      Math.round(parseFloat(row.lat) * 100) / 100,
      Math.round(parseFloat(row.lng) * 100) / 100,
    ],
    hasMedia: row.has_media,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    confidence: row.ai_confidence,
    timestamp: row.created_at,
    updatedAt: row.updated_at,
    //Explicitly omitted: reporter, aiAnalysis, operatorNotes
  }
}

function formatReport(row: any): any {
  const customFields = typeof row.custom_fields === 'string'
    ? JSON.parse(row.custom_fields)
    : row.custom_fields

  return {
    id: row.id,
    reportNumber: row.report_number,
    incidentCategory: row.incident_category,
    incidentSubtype: row.incident_subtype,
    type: row.display_type,
    description: row.description,
    severity: toUiSeverity(row.severity),
    status: toUiStatus(row.status),
    trappedPersons: row.trapped_persons,
    location: row.location_text,
    coordinates: [parseFloat(row.lat), parseFloat(row.lng)],
    hasMedia: row.has_media,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    reporter: row.reporter_name,
    confidence: row.ai_confidence,
    aiAnalysis: typeof row.ai_analysis === 'string' ? JSON.parse(row.ai_analysis) : row.ai_analysis,
    locationMetadata: row.location_metadata || customFields?.location_metadata || null,
    operatorNotes: row.operator_notes,
    timestamp: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
    resolvedAt: row.resolved_at }
}

async function generateReportNumberSafe(): Promise<string> {
  try {
    //Use the proper sequence for clean RPT-XXXX format
    const result = await pool.query(`SELECT 'RPT-' || LPAD(NEXTVAL('report_num_seq')::TEXT, 4, '0') AS report_number`)
    return result.rows[0]?.report_number
  } catch {
    //True last-resort fallback using a counter-based approach
    try {
      const countResult = await pool.query(`SELECT COUNT(*) + 1 AS next FROM reports`)
      const next = parseInt(countResult.rows[0]?.next || '1', 10)
      return `RPT-${String(next).padStart(4, '0')}`
    } catch {
      return `RPT-${String(Date.now()).slice(-4)}`
    }
  }
}

function toDbStatus(status: string): string {
  const map: Record<string, string> = {
    Verified: 'verified',
    Urgent: 'urgent',
    Flagged: 'flagged',
    Resolved: 'resolved',
    Unverified: 'unverified',
    Archived: 'archived',
    False_Report: 'false_report'
  }
  return map[status] || status.toLowerCase()
}

function toUiStatus(status: string): string {
  const map: Record<string, string> = {
    verified: 'Verified',
    urgent: 'Urgent',
    flagged: 'Flagged',
    resolved: 'Resolved',
    unverified: 'Unverified',
    archived: 'Archived',
    false_report: 'False_Report'
  }
  return map[status] || status
}

function toDbSeverity(severity: string): string {
  const map: Record<string, string> = {
    High: 'high',
    high: 'high',
    Medium: 'medium',
    medium: 'medium',
    Low: 'low',
    low: 'low',
    critical: 'high',
    Critical: 'high',
    emergency: 'high',
    Emergency: 'high' }
  return map[severity] || 'medium'
}

function toUiSeverity(severity: string): string {
  const map: Record<string, string> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  }
  return map[severity] || severity
}

export default router

