/*
 * reportRoutes.ts - Emergency report management API
 *
 * Handles all report-related endpoints:
 *   GET    /api/reports          - List all reports (with filters)
 *   GET    /api/reports/:id      - Get a single report by ID
 *   POST   /api/reports          - Submit a new report (citizen, public)
 *   PUT    /api/reports/:id/status - Update report status (admin only)
 *   PUT    /api/reports/:id/notes  - Add operator notes (admin only)
 *   GET    /api/reports/nearby    - Spatial query for nearby reports
 *   GET    /api/reports/stats     - Aggregate statistics for analytics
 *   GET    /api/reports/export    - Export all reports as JSON (admin only)
 *
 * PostGIS spatial functions are used for:
 *   - ST_MakePoint: creating geographic points from lat/lng
 *   - ST_DWithin: finding reports within a radius
 *   - ST_X/ST_Y: extracting coordinates from stored points
 */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { devLog } from '../utils/logger.js'
import { uploadEvidence } from '../middleware/upload.js'
import { analyseReport } from '../services/aiAnalysisPipeline.js'
import { classify } from '../services/classifierRouter.js'
import { aiClient } from '../services/aiClient.js'
import { getActiveCityRegion } from '../config/regions/index.js'

const router = Router()
const activeRegion = getActiveCityRegion()
const regionLat = activeRegion.centre.lat
const regionLng = activeRegion.centre.lng
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

/*
 * GET /api/reports
 * Returns all reports, optionally filtered by status, severity, or category.
 * Newest reports appear first. Results include extracted lat/lng from PostGIS.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, severity, category, limit = '100' } = req.query

    let query = `
      SELECT id, report_number, incident_category, incident_subtype, display_type,
             description, severity, status, trapped_persons, location_text,
             ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
             has_media, media_type, media_url, reporter_name,
             ai_confidence, ai_analysis, operator_notes,
             created_at, updated_at, verified_at, resolved_at
      FROM reports WHERE 1=1`

    const params: any[] = []
    let idx = 1

    // Apply optional filters
    if (status) { query += ` AND status = $${idx++}`; params.push(status) }
    if (severity) { query += ` AND severity = $${idx++}`; params.push(severity) }
    if (category) { query += ` AND incident_category = $${idx++}`; params.push(category) }

    query += ` ORDER BY created_at DESC LIMIT $${idx}`
    params.push(parseInt(limit as string) || 100)

    const result = await pool.query(query, params)

    // Fetch all media for these reports in a single query
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
            reasoning: m.ai_reasoning,
          } : null,
        })
      }
    }

    // Transform database rows into the frontend-expected format
    const reports = result.rows.map((row: any) => ({
      ...formatReport(row),
      media: mediaMap[row.id] || [],
    }))
    res.json(reports)
  } catch (err: any) {
    console.error('[Reports] List error:', err.message)
    res.status(500).json({ error: 'Failed to load reports.' })
  }
})

/*
 * GET /api/reports/stats
 * Returns aggregate statistics for the analytics dashboard.
 * Includes counts by status, severity, category, hour, and confidence.
 */
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Run multiple count queries in parallel for performance
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
      totals: totals.rows[0],
    })
  } catch (err: any) {
    console.error('[Reports] Stats error:', err.message)
    res.status(500).json({ error: 'Failed to load statistics.' })
  }
})

/*
 * GET /api/reports/analytics
 * Advanced live analytics for admin dashboard with time-range support.
 * Query params: range=24h|7d|30d|all (default: 24h)
 */
router.get('/analytics', async (req: Request, res: Response): Promise<void> => {
  try {
    const rangeParam = String(req.query.range || '24h').toLowerCase()
    const range = ['24h', '7d', '30d', 'all'].includes(rangeParam) ? rangeParam : '24h'

    const intervalByRange: Record<string, string | null> = {
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
      'all': null,
    }

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
      // AI Accuracy: % of high-confidence reports that were verified (not flagged)
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE ai_confidence >= 70)::int AS high_confidence_total,
           COUNT(*) FILTER (WHERE ai_confidence >= 70 AND status IN ('verified','urgent'))::int AS high_confidence_verified,
           COUNT(*) FILTER (WHERE ai_confidence >= 70 AND status = 'flagged')::int AS high_confidence_flagged
         FROM reports
         ${whereClause}`
      ),
      // Geographic Coverage: Max distance between report locations in km
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
    const incidentSpikes = series.filter(point => point.count >= spikeThreshold).length

    const aiScored = Number(totals.ai_scored || 0)
    const verifiedCount = Number(byStatus.Verified || 0)

    // AI Accuracy Rate
    const aiAccuracy = aiAccuracyRes.rows[0] || {}
    const highConfTotal = Number(aiAccuracy.high_confidence_total || 0)
    const highConfVerified = Number(aiAccuracy.high_confidence_verified || 0)
    const aiAccuracyRate = highConfTotal > 0 ? Math.round((highConfVerified / highConfTotal) * 100) : 0

    // Geographic Coverage
    const geoCoverage = geoCoverageRes.rows[0] || {}
    const geoCoverageKm = Number(geoCoverage.max_distance_km || 0)

    // Threat Level Index (0-100): weighted by severity, urgent count, and recent trend
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
        threatLevelIndex,
      },
      trend: {
        current: currentCount,
        previous: previousCount,
        percent: trendPct,
      },
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
        avgResolutionTime: Number(timingRes.rows[0]?.avg_resolve_minutes || 0),
      },
      intelligenceMetrics: {
        severityDistribution: bySeverity,
        categoryHeatmap: Array.from(heatmapMap.values()).sort((a, b) => b.total - a.total).slice(0, 8),
        locationClusters: locationClusterRes.rows.map((r) => ({
          lat: Number(r.lat),
          lng: Number(r.lng),
          count: Number(r.count),
          label: `${Number(r.lat_bin).toFixed(2)}, ${Number(r.lng_bin).toFixed(2)}`,
        })),
      },
      performanceMetrics: {
        adminResponseTime: Number(operational.admin_response_minutes || 0),
        investigationCompletionTime: Number(operational.investigation_completion_minutes || 0),
        reportsPerOfficer: officerPerfRes.rows.map((r) => ({ officer: r.officer, count: Number(r.count) })),
      },
      trendMetrics: {
        weekOverWeekGrowth,
        monthlyTrend,
        incidentSpikes,
      },
      dataQuality: {
        aiCoverageRate: total > 0 ? Math.round((aiScored / total) * 100) : 0,
        mediaCoverageRate: mediaRate,
        verificationCoverageRate: total > 0 ? Math.round((verifiedCount / total) * 100) : 0,
      },
    })
  } catch (err: any) {
    console.error('[Reports] Analytics error:', err.message)
    res.status(500).json({ error: 'Failed to load analytics.' })
  }
})

/*
 * GET /api/reports/command-center
 * Executive command-center payload for the main admin dashboard.
 */
router.get('/command-center', async (_req: Request, res: Response): Promise<void> => {
  try {
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
        avgResponseMinutes: Number(r.avg_response_minutes || 0),
      })),
      recommendations,
      comparative: {
        today: todayCount,
        yesterday: yesterdayCount,
        dayDeltaPct,
        thisWeek: thisWeekCount,
        previousWeek: previousWeekCount,
        weekDeltaPct,
      },
    })
  } catch (err: any) {
    console.error('[Reports] Command-center error:', err.message)
    res.status(500).json({ error: 'Failed to load command-center analytics.' })
  }
})

/*
 * GET /api/reports/nearby
 * Spatial query: finds reports within a given radius of a point.
 * Uses PostGIS ST_DWithin for efficient spatial filtering.
 * Query params: lat, lng, radius (in metres, default 5000)
 */
router.get('/nearby', async (req: Request, res: Response): Promise<void> => {
  try {
    const { lat, lng, radius = '5000' } = req.query
    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng query parameters are required.' })
      return
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
      distanceMetres: Math.round(r.distance_m),
    })))
  } catch (err: any) {
    console.error('[Reports] Nearby error:', err.message)
    res.status(500).json({ error: 'Failed to search nearby reports.' })
  }
})

/*
 * GET /api/reports/:id
 * Returns a single report by its UUID.
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
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
      res.status(404).json({ error: 'Report not found.' })
      return
    }

    // Fetch associated media files
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
        reasoning: m.ai_reasoning,
      } : null,
    }))

    res.json({ ...formatReport(result.rows[0]), media })
  } catch (err: any) {
    console.error('[Reports] Get error:', err.message)
    res.status(500).json({ error: 'Failed to load report.' })
  }
})

/*
 * POST /api/reports
 * Submit a new emergency report (public endpoint, no auth required).
 * Accepts multipart form data to allow evidence photo/video upload.
 * Automatically runs AI confidence scoring based on available data.
 */
router.post('/', uploadEvidence, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      incidentCategory, incidentSubtype, displayType,
      description, severity, trappedPersons,
      locationText, lat, lng,
    } = req.body

    // Validate required fields
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
      res.status(400).json({ error: 'Missing required fields.' })
      return
    }

    // Input length validation (#29)
    if (typeof description !== 'string' || description.length > 5000) {
      res.status(400).json({ error: 'Description must be under 5000 characters.' })
      return
    }
    if (typeof locationText !== 'string' || locationText.length > 500) {
      res.status(400).json({ error: 'Location text must be under 500 characters.' })
      return
    }
    const parsedLat = parseFloat(lat)
    const parsedLng = parseFloat(lng)
    if (isNaN(parsedLat) || isNaN(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      res.status(400).json({ error: 'Invalid coordinates.' })
      return
    }

    // Build media URL if evidence was uploaded (support up to 3 files)
    const files = (req as any).files as Express.Multer.File[] | undefined
    const hasFiles = Array.isArray(files) && files.length > 0
    const mediaUrl = hasFiles ? `/uploads/${files[0].filename}` : null
    const hasMedia = hasFiles
    const mediaType = hasFiles
      ? (files.some(f => f.mimetype.startsWith('video/')) ? 'video' : 'photo')
      : null

    // Run basic AI confidence scoring
    // Calls real HuggingFace ML classifiers with heuristic fallback
    const aiResult = await computeAIScore(description, severity, trappedPersons, hasMedia, parseFloat(lat), parseFloat(lng))

    const dbSeverity = toDbSeverity(severity)
    const reportNumber = await generateReportNumberSafe()

    const result = await pool.query(
      `INSERT INTO reports
       (report_number, incident_category, incident_subtype, display_type,
        description, severity, trapped_persons, location_text, coordinates,
        has_media, media_type, media_url, ai_confidence, ai_analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               ST_SetSRID(ST_MakePoint($10, $9), 4326),
               $11, $12, $13, $14, $15)
       RETURNING id, report_number, created_at`,
      [
        reportNumber,
        incidentCategory, incidentSubtype || '', displayType || '',
        description, dbSeverity, trappedPersons || 'no', locationText,
        parseFloat(lat), parseFloat(lng),
        hasMedia, mediaType, mediaUrl,
        aiResult.confidence, JSON.stringify(aiResult.analysis),
      ]
    )

    const report = result.rows[0]

    // Insert all uploaded files into report_media table
    if (hasFiles && files!.length > 0) {
      for (const file of files!) {
        await pool.query(
          `INSERT INTO report_media (report_id, file_url, file_type, file_size, original_filename)
           VALUES ($1, $2, $3, $4, $5)`,
          [report.id, `/uploads/${file.filename}`, file.mimetype, file.size, file.originalname]
        )
      }
    }

    // Broadcast the new report via WebSocket so admin dashboard updates in real time
    try {
      const io = req.app.get('io')
      if (io) {
        const fullReport = {
          ...formatReport({
            ...report,
            incident_category: incidentCategory,
            incident_subtype: incidentSubtype || '',
            display_type: displayType || '',
            description,
            severity: dbSeverity,
            trapped_persons: trappedPersons || 'no',
            location_text: locationText,
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            has_media: hasMedia,
            media_type: mediaType,
            media_url: mediaUrl,
            reporter_name: null,
            ai_confidence: aiResult.confidence,
            ai_analysis: aiResult.analysis,
            operator_notes: null,
            updated_at: null,
            verified_at: null,
            resolved_at: null,
          }),
          media: hasFiles ? files!.map(f => ({
            id: null,
            url: `/uploads/${f.filename}`,
            file_url: `/uploads/${f.filename}`,
            fileType: f.mimetype,
            fileSize: f.size,
            originalFilename: f.originalname,
            aiAnalysis: null,
          })) : [],
        }
        io.emit('report:new', fullReport)
        devLog(`[Reports] Broadcast report:new ${report.report_number}`)
      }
    } catch (wsErr: any) {
      console.warn('[Reports] WebSocket broadcast failed:', wsErr.message)
    }

    // Run the full AI analysis pipeline in the background (non-blocking).
    // This calls real HuggingFace classifiers for sentiment, fake detection,
    // severity, category, language, and urgency on the submitted report.
    analyseReport(
      report.id, description, parseFloat(lat), parseFloat(lng),
      locationText, dbSeverity, hasMedia,
    ).catch((err: any) =>
      console.error('[Reports] AI pipeline error:', err.message),
    )

    res.status(201).json({
      id: report.id,
      reportNumber: report.report_number,
      createdAt: report.created_at,
      aiConfidence: aiResult.confidence,
    })
  } catch (err: any) {
    console.error('[Reports] Create error:', err.message)
    res.status(500).json({ error: 'Failed to submit report.' })
  }
})

/*
 * PUT /api/reports/:id/status
 * Update report status (admin only). Logs the action in the activity trail.
 * Valid statuses: Verified, Urgent, Flagged, Resolved
 */
router.put('/:id/status', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, reason } = req.body
    const valid = ['Verified', 'Urgent', 'Flagged', 'Resolved', 'Archived', 'False_Report']
    if (!valid.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` })
      return
    }

    const dbStatus = toDbStatus(status)

    const beforeResult = await pool.query('SELECT status::text AS status, verified_by FROM reports WHERE id = $1', [req.params.id])
    if (beforeResult.rows.length === 0) {
      res.status(404).json({ error: 'Report not found.' })
      return
    }
    const oldStatus = beforeResult.rows[0].status
    const alreadyDecided = ['verified', 'urgent', 'false_report', 'resolved', 'archived'].includes(oldStatus?.toLowerCase())
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.department === 'Command & Control'

    // Status locking: once a decision is made, only super-admins can override with justification
    if (alreadyDecided && !isSuperAdmin) {
      res.status(403).json({ error: 'This report has already been actioned. Only a super-admin can override the status.' })
      return
    }
    if (alreadyDecided && isSuperAdmin && !reason?.trim()) {
      res.status(400).json({ error: 'A justification is required to override an already-actioned report.' })
      return
    }

    // Build the update based on the new status
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
    await pool.query(
      `UPDATE reports SET ${updates.join(', ')} WHERE id = $${idx}`,
      params
    )

    await pool.query(
      `INSERT INTO report_status_history (report_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, oldStatus, dbStatus, req.user!.id, reason || null]
    )

    // Map status to activity log action type
    const typeMap: Record<string, string> = {
      Verified: 'verify', Urgent: 'urgent', Flagged: 'flag', Resolved: 'resolve',
      Archived: 'archive', False_Report: 'false_report',
    }
    await pool.query(
      `INSERT INTO activity_log (action, action_type, report_id, operator_id, operator_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `${status === 'Urgent' ? 'Escalated to URGENT' : `Marked as ${status}`}`,
        typeMap[status] || 'verify',
        req.params.id, req.user!.id, req.user!.displayName,
      ]
    )

    res.json({ success: true, status })

    // Broadcast status update via WebSocket
    try {
      const io = req.app.get('io')
      if (io) {
        io.emit('report:updated', { id: req.params.id, status, oldStatus: toUiStatus(oldStatus), updatedBy: req.user!.displayName })
        devLog(`[Reports] Broadcast report:updated ${req.params.id} → ${status}`)
      }
    } catch (wsErr: any) {
      console.warn('[Reports] WebSocket broadcast failed:', wsErr.message)
    }
  } catch (err: any) {
    console.error('[Reports] Status update error:', err.message)
    res.status(500).json({ error: 'Failed to update status.' })
  }
})

/*
 * PUT /api/reports/bulk/status
 * Bulk update status for multiple reports (admin only).
 */
router.put('/bulk/status', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { reportIds, status, reason } = req.body
    
    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      res.status(400).json({ error: 'reportIds must be a non-empty array' })
      return
    }

    const valid = ['Verified', 'Urgent', 'Flagged', 'Resolved', 'Archived', 'False_Report']
    if (!valid.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` })
      return
    }

    const dbStatus = toDbStatus(status)
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')
      
      const typeMap: Record<string, string> = {
        Verified: 'verify', Urgent: 'urgent', Flagged: 'flag', Resolved: 'resolve',
        Archived: 'archive', False_Report: 'false_report',
      }
      
      let updated = 0
      for (const reportId of reportIds) {
        // Get old status
        const beforeResult = await client.query('SELECT status::text AS status FROM reports WHERE id = $1', [reportId])
        if (beforeResult.rows.length === 0) continue
        
        const oldStatus = beforeResult.rows[0].status
        
        // Build updates based on status
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

        // Log history
        await client.query(
          `INSERT INTO report_status_history (report_id, old_status, new_status, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [reportId, oldStatus, dbStatus, req.user!.id, reason || `Bulk ${status.toLowerCase()}`]
        )

        // Log activity
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

      // Broadcast updates via WebSocket
      try {
        const io = req.app.get('io')
        if (io) {
          io.emit('report:bulk-updated', { reportIds, status, updatedBy: req.user!.displayName, count: updated })
          devLog(`[Reports] Broadcast bulk update: ${updated} reports → ${status}`)
        }
      } catch (wsErr: any) {
        console.warn('[Reports] WebSocket broadcast failed:', wsErr.message)
      }
    } catch (txErr: any) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err: any) {
    console.error('[Reports] Bulk status update error:', err.message)
    res.status(500).json({ error: 'Failed to bulk update status.' })
  }
})

/*
 * PUT /api/reports/:id/notes
 * Add or update operator notes on a report (admin only).
 */
router.put('/:id/notes', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { notes } = req.body
    await pool.query('UPDATE reports SET operator_notes = $1 WHERE id = $2', [notes, req.params.id])

    await pool.query(
      `INSERT INTO activity_log (action, action_type, report_id, operator_id, operator_name)
       VALUES ($1, $2, $3, $4, $5)`,
      ['Added operator notes', 'note', req.params.id, req.user!.id, req.user!.displayName]
    )

    res.json({ success: true })
  } catch (err: any) {
    console.error('[Reports] Notes error:', err.message)
    res.status(500).json({ error: 'Failed to save notes.' })
  }
})

/*
 * GET /api/reports/export
 * Export all reports as JSON (admin only).
 */
router.get('/export/json', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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
      ['Exported reports as JSON', 'export', req.user!.id, req.user!.displayName]
    )

    res.json(result.rows.map(formatReport))
  } catch (err: any) {
    console.error('[Reports] Export error:', err.message)
    res.status(500).json({ error: 'Failed to export reports.' })
  }
})

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

  // When HuggingFace API key is absent, use local Python AI engine instead
  // so reports get real ML scoring rather than silent 'unknown' fallbacks.
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
          predictedSeverity: sev?.predicted_severity || null,
        },
      }
    } catch {
      return computeAIScoreFallback(description, severity, trapped, hasMedia, lat, lng)
    }
  }

  try {
    // Run 3 ML classifiers in parallel for speed
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

    // Compute composite confidence from ML outputs
    let confidence = 50 // Base

    // Fake probability inversely affects confidence
    const fakeProbability = fake?.score ?? 0.3
    if (fakeProbability < 0.3) confidence += 20
    else if (fakeProbability < 0.5) confidence += 10
    else confidence -= 10

    // Severity alignment boosts confidence
    if (severityPred) {
      const severityMatch = severityPred.label?.toLowerCase() === severity.toLowerCase()
      if (severityMatch) confidence += 10
      confidence += Math.round(severityPred.score * 15)
    }

    // Media evidence
    if (hasMedia) confidence += 12

    // Trapped persons
    if (trapped === 'yes') confidence += 5

    if (isWithinActiveRegion(lat, lng)) confidence += 5

    // Description quality
    const wordCount = description.split(/\s+/).length
    if (wordCount > 30) confidence += 8
    else if (wordCount > 15) confidence += 4

    confidence = Math.min(Math.max(confidence, 15), 95)

    // Sentiment-derived panic level
    let panicLevel = 0
    if (sentiment) {
      const negLabels = ['negative', 'NEGATIVE', 'LABEL_0']
      if (negLabels.includes(sentiment.label)) {
        panicLevel = Math.round(sentiment.score * 10)
      }
    }

    // Extract key entities
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
          (trapped === 'yes' ? 'Trapped persons reported. ' : ''),
      },
    }
  } catch (err: any) {
    console.warn(`[Reports] ML scoring failed, using heuristic: ${err.message}`)
    return computeAIScoreFallback(description, severity, trapped, hasMedia, lat, lng)
  }
}

/**
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
      reasoning: `Heuristic scoring (ML unavailable). Confidence based on description quality and metadata.`,
    },
  }
}

/*
 * Transforms a database row into the standardised API response format.
 * Converts PostGIS coordinate columns into a simple coordinates array.
 */
function formatReport(row: any): any {
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
    operatorNotes: row.operator_notes,
    timestamp: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
    resolvedAt: row.resolved_at,
  }
}

async function generateReportNumberSafe(): Promise<string> {
  try {
    // Try the DB function first (if it exists and handles current format)
    const result = await pool.query(`SELECT generate_report_number() AS report_number`)
    return result.rows[0]?.report_number
  } catch {
    // Fallback: RPT-<timestamp-hex> format
    const ts = Date.now().toString(16).toUpperCase()
    const rand = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0').toUpperCase()
    return `RPT-${ts}-${rand}`
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
    Emergency: 'high',
  }
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
