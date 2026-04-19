/**
 * Regional flood threat assessor — combines river levels, verified incident
 * reports, and flood predictions into a GREEN/AMBER/RED/CRITICAL assessment.
 * Estimates at-risk properties, affected population, and evacuation routes.
 *
 * - Pulls current levels from riverLevelService
 * - Reads reports, flood_predictions, and evacuation_routes from the DB
 * - Emits Socket.IO events when the threat level changes
 * */

import { getCurrentLevels } from './riverLevelService.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import type { ThreatLevel } from '../config/regions/types.js'
import pool from '../models/db.js'
import type { Server as IOServer } from 'socket.io'
import { logger } from './logger.js'

// Configurable threat thresholds

interface ThreatThresholds {
  amberReportCount: number        // Reports needed for AMBER
  redReportCount: number          // Reports needed for RED
  criticalPredictionHours: number // How far ahead severe prediction triggers CRITICAL
  reportWindowHours: number       // How far back to count reports
}

const DEFAULT_THRESHOLDS: ThreatThresholds = {
  amberReportCount: 2,
  redReportCount: 5,
  criticalPredictionHours: 3,
  reportWindowHours: 24,
}

// Larger regions need more reports to trigger escalation
function getRegionThresholds(regionId: string): ThreatThresholds {
  // Could be loaded from DB config in future
  // For now, scale by known region population
  const largeRegions = ['glasgow', 'edinburgh', 'london', 'manchester', 'birmingham']
  if (largeRegions.some(r => regionId.toLowerCase().includes(r))) {
    return { amberReportCount: 3, redReportCount: 8, criticalPredictionHours: 3, reportWindowHours: 24 }
  }
  return DEFAULT_THRESHOLDS
}

// Types

export interface ThreatAssessment {
  level: ThreatLevel
  previousLevel: ThreatLevel | null
  reasons: string[]
  riverSummary: Array<{
    name: string
    level: number
    status: string
    trend: string
  }>
  activeReportsInFloodZones: number
  activePredictionSevere: boolean
  estimatedPropertiesAtRisk: number
  estimatedPeopleAtRisk: number
  activeEvacuationRoutes: number
  calculatedAt: string
}

// State

let lastThreatLevel: ThreatLevel | null = null
let ioInstance: IOServer | null = null

export function setThreatIO(io: IOServer): void {
  ioInstance = io
}

// Core Calculation

export async function calculateThreatLevel(): Promise<ThreatAssessment> {
  const region = getActiveCityRegion()
  const thresholds = getRegionThresholds(region.id)
  const levels = await getCurrentLevels()
  const reasons: string[] = []

  // 1. Analyze river levels
  const hasElevated = levels.some(l => l.status === 'ELEVATED')
  const hasHigh = levels.some(l => l.status === 'HIGH')
  const hasCritical = levels.some(l => l.status === 'CRITICAL')

  if (hasCritical) reasons.push('One or more rivers at CRITICAL level')
  else if (hasHigh) reasons.push('One or more rivers at HIGH level')
  else if (hasElevated) reasons.push('One or more rivers at ELEVATED level')

  // 2. Count verified reports in flood zones
  let reportsInZones = 0
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as cnt FROM reports
      WHERE status IN ('verified', 'urgent')
        AND region_id = $1
        AND created_at > NOW() - INTERVAL '${thresholds.reportWindowHours} hours'
        AND deleted_at IS NULL
    `, [region.id])
    reportsInZones = parseInt(rows[0]?.cnt || '0')
  } catch {
    // Continue with 0
  }

  if (reportsInZones > 0) {
    reasons.push(`${reportsInZones} verified report(s) in active period`)
  }

  // 3. Check flood predictions
  let predictedSevere = false
  try {
    const { rows } = await pool.query(`
      SELECT predicted_levels FROM flood_predictions
      WHERE region_id = $1 AND valid_until > NOW()
      ORDER BY calculated_at DESC LIMIT 5
    `, [region.id])

    for (const row of rows) {
      const predictions = typeof row.predicted_levels === 'string'
        ? JSON.parse(row.predicted_levels)
        : row.predicted_levels
      if (Array.isArray(predictions)) {
        for (const p of predictions) {
          if (p.hours <= thresholds.criticalPredictionHours && (p.status === 'CRITICAL' || p.status === 'HIGH')) {
            predictedSevere = true
            reasons.push(`Predicted ${p.status} level within ${p.hours} hour(s)`)
            break
          }
        }
      }
      if (predictedSevere) break
    }
  } catch {
    // Continue
  }

  // 4. Determine overall threat level
  let level: ThreatLevel = 'GREEN'

  if (hasCritical || predictedSevere) {
    level = 'CRITICAL'
  } else if ((hasHigh && reportsInZones > 0) || reportsInZones >= thresholds.redReportCount) {
    level = 'RED'
  } else if (hasElevated || (reportsInZones >= thresholds.amberReportCount)) {
    level = 'AMBER'
  }

  // 5. Get estimated impact numbers
  let estimatedProperties = 0
  let estimatedPeople = 0
  try {
    const { rows } = await pool.query(`
      SELECT estimated_properties, estimated_people FROM flood_predictions
      WHERE region_id = $1 AND valid_until > NOW()
      ORDER BY estimated_people DESC LIMIT 1
    `, [region.id])
    if (rows.length > 0) {
      estimatedProperties = parseInt(rows[0].estimated_properties || '0')
      estimatedPeople = parseInt(rows[0].estimated_people || '0')
    }
  } catch {
    // Continue
  }

  // 6. Count active evacuation routes
  let activeEvacRoutes = 0
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM evacuation_routes WHERE region_id = $1 AND is_blocked = false`,
      [region.id],
    )
    activeEvacRoutes = parseInt(rows[0]?.cnt || '0')
  } catch {
    // Continue
  }

  const assessment: ThreatAssessment = {
    level,
    previousLevel: lastThreatLevel,
    reasons,
    riverSummary: levels.map(l => ({
      name: l.riverName,
      level: l.levelMetres,
      status: l.status,
      trend: l.trend,
    })),
    activeReportsInFloodZones: reportsInZones,
    activePredictionSevere: predictedSevere,
    estimatedPropertiesAtRisk: estimatedProperties,
    estimatedPeopleAtRisk: estimatedPeople,
    activeEvacuationRoutes: activeEvacRoutes,
    calculatedAt: new Date().toISOString(),
  }

  // 7. Emit Socket.IO event if level changed
  if (lastThreatLevel !== null && lastThreatLevel !== level && ioInstance) {
    ioInstance.emit('threat:level_changed', {
      newLevel: level,
      previousLevel: lastThreatLevel,
      reasons,
      calculatedAt: assessment.calculatedAt,
    })

    // Log the change
    pool.query(
      `INSERT INTO threat_level_log (region_id, level, previous_level, trigger_reasons, river_levels, active_reports)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [region.id, level, lastThreatLevel, JSON.stringify(reasons), JSON.stringify(assessment.riverSummary), reportsInZones],
    ).catch(() => {})
  }

  lastThreatLevel = level

  return assessment
}

// —2  MULTI-HAZARD THREAT ASSESSMENT

/**
 * Calculate threat levels across multiple hazard types, not just flooding.
 */
export async function calculateMultiHazardThreat(): Promise<{
  overall: ThreatLevel
  perHazard: Array<{ hazard: string; level: ThreatLevel; score: number; reasons: string[] }>
  composite: number
}> {
  const perHazard: Array<{ hazard: string; level: ThreatLevel; score: number; reasons: string[] }> = []
  const region = getActiveCityRegion()

  // 1. Flood threats (leverage existing logic)
  try {
    const floodAssessment = await calculateThreatLevel()
    const floodScore = floodAssessment.level === 'CRITICAL' ? 100
      : floodAssessment.level === 'RED' ? 75
      : floodAssessment.level === 'AMBER' ? 40
      : 10
    perHazard.push({
      hazard: 'flood',
      level: floodAssessment.level,
      score: floodScore,
      reasons: floodAssessment.reasons,
    })
  } catch {
    perHazard.push({ hazard: 'flood', level: 'GREEN', score: 0, reasons: ['Unable to assess flood threat'] })
  }

  // 2. Weather-based threats (storms, heatwave, etc.)
  try {
    const weatherReasons: string[] = []
    let weatherScore = 0

    const recentWeather = await pool.query(
      `SELECT incident_type, COUNT(*)::int as cnt, MAX(severity::text) as max_sev
       FROM reports
       WHERE incident_type IN ('severe_storm', 'heatwave', 'wildfire')
         AND created_at > NOW() - INTERVAL '6 hours'
         AND deleted_at IS NULL
         AND region_id = $1
       GROUP BY incident_type`,
      [region.id],
    )

    for (const row of recentWeather.rows) {
      const count = row.cnt || 0
      const sevScore = row.max_sev === 'high' ? 30 : row.max_sev === 'medium' ? 15 : 5
      weatherScore += sevScore + count * 5
      weatherReasons.push(`${count} ${row.incident_type} report(s) (max severity: ${row.max_sev})`)
    }

    weatherScore = Math.min(100, weatherScore)
    const weatherLevel: ThreatLevel = weatherScore >= 80 ? 'CRITICAL'
      : weatherScore >= 55 ? 'RED'
      : weatherScore >= 25 ? 'AMBER'
      : 'GREEN'

    perHazard.push({ hazard: 'weather', level: weatherLevel, score: weatherScore, reasons: weatherReasons })
  } catch {
    perHazard.push({ hazard: 'weather', level: 'GREEN', score: 0, reasons: ['Unable to assess weather threats'] })
  }

  // 3. Report-based threats (all other incident types)
  try {
    const reportReasons: string[] = []
    let reportScore = 0

    const recentAll = await pool.query(
      `SELECT incident_type, COUNT(*)::int as cnt
       FROM reports
       WHERE created_at > NOW() - INTERVAL '12 hours'
         AND deleted_at IS NULL
         AND status IN ('verified', 'urgent')
         AND region_id = $1
       GROUP BY incident_type
       ORDER BY cnt DESC`,
      [region.id],
    )

    for (const row of recentAll.rows) {
      reportScore += row.cnt * 8
      reportReasons.push(`${row.cnt} verified ${row.incident_type} report(s) in last 12h`)
    }

    reportScore = Math.min(100, reportScore)
    const reportLevel: ThreatLevel = reportScore >= 80 ? 'CRITICAL'
      : reportScore >= 55 ? 'RED'
      : reportScore >= 25 ? 'AMBER'
      : 'GREEN'

    perHazard.push({ hazard: 'reports', level: reportLevel, score: reportScore, reasons: reportReasons })
  } catch {
    perHazard.push({ hazard: 'reports', level: 'GREEN', score: 0, reasons: ['Unable to assess report-based threats'] })
  }

  // Overall = MAX of individual hazard levels
  const levelOrder: ThreatLevel[] = ['GREEN', 'AMBER', 'RED', 'CRITICAL']
  const overall = perHazard.reduce<ThreatLevel>((max, h) => {
    return levelOrder.indexOf(h.level) > levelOrder.indexOf(max) ? h.level : max
  }, 'GREEN')

  // Composite = weighted average (flood 50%, weather 30%, reports 20%)
  const weights: Record<string, number> = { flood: 0.5, weather: 0.3, reports: 0.2 }
  const composite = Math.round(
    perHazard.reduce((sum, h) => sum + h.score * (weights[h.hazard] || 0.1), 0),
  )

  return { overall, perHazard, composite }
}

// —3  THREAT TRAJECTORY PREDICTION

/**
 * Predict how the threat level will evolve over the next 1, 3, and 6 hours.
 */
export async function predictThreatTrajectory(): Promise<{
  current: ThreatLevel
  predictions: Array<{ hours: number; level: ThreatLevel; confidence: number }>
}> {
  const assessment = await calculateThreatLevel()
  const current = assessment.level
  const predictions: Array<{ hours: number; level: ThreatLevel; confidence: number }> = []

  // Analyze river trends
  const risingCount = assessment.riverSummary.filter(r => r.trend === 'rising').length
  const fallingCount = assessment.riverSummary.filter(r => r.trend === 'falling').length
  const totalRivers = assessment.riverSummary.length || 1
  // Trend factor: +1 if all rising, -1 if all falling
  const trendFactor = (risingCount - fallingCount) / totalRivers

  // Analyze report velocity
  let reportAcceleration = 0
  try {
    const recent = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int as last_1h,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '3 hours' AND created_at <= NOW() - INTERVAL '1 hour')::int as prev_2h
       FROM reports
       WHERE created_at > NOW() - INTERVAL '3 hours'
         AND deleted_at IS NULL
         AND status IN ('verified', 'urgent')`,
    )
    const last1h = recent.rows[0]?.last_1h || 0
    const prev2hRate = (recent.rows[0]?.prev_2h || 0) / 2
    reportAcceleration = prev2hRate > 0 ? (last1h - prev2hRate) / prev2hRate : (last1h > 0 ? 1 : 0)
  } catch {
    // Continue with 0
  }

  const levelOrder: ThreatLevel[] = ['GREEN', 'AMBER', 'RED', 'CRITICAL']
  const currentIdx = levelOrder.indexOf(current)

  for (const hours of [1, 3, 6]) {
    // Shift factor: positive = escalating, negative = de-escalating
    const shift = (trendFactor * 0.6 + reportAcceleration * 0.4) * (hours / 3)
    let predictedIdx = Math.round(currentIdx + shift)
    predictedIdx = Math.max(0, Math.min(levelOrder.length - 1, predictedIdx))

    // Confidence decreases with horizon
    const confidence = Math.max(20, Math.round(85 - hours * 8 - Math.abs(shift) * 10))

    predictions.push({
      hours,
      level: levelOrder[predictedIdx],
      confidence,
    })
  }

  return { current, predictions }
}

// —4  THREAT EXPLANATION

/**
 * Provide a human-readable explanation of the current threat level with escalation/de-escalation triggers.
 */
export async function explainThreatLevel(): Promise<{
  summary: string
  factors: Array<{ name: string; contribution: 'positive' | 'negative' | 'neutral'; detail: string }>
  escalationTriggers: string[]
  deescalationTriggers: string[]
}> {
  const assessment = await calculateThreatLevel()
  const factors: Array<{ name: string; contribution: 'positive' | 'negative' | 'neutral'; detail: string }> = []
  const escalationTriggers: string[] = []
  const deescalationTriggers: string[] = []

  // Build factors from assessment reasons
  for (const reason of assessment.reasons) {
    let contribution: 'positive' | 'negative' | 'neutral' = 'negative'
    if (reason.toLowerCase().includes('normal') || reason.toLowerCase().includes('no ')) {
      contribution = 'positive'
    }
    factors.push({ name: reason.split(':')[0] || reason, contribution, detail: reason })
  }

  // River-based factors
  const criticalRivers = assessment.riverSummary.filter(r => r.status === 'CRITICAL')
  const highRivers = assessment.riverSummary.filter(r => r.status === 'HIGH')
  const elevatedRivers = assessment.riverSummary.filter(r => r.status === 'ELEVATED')
  const normalRivers = assessment.riverSummary.filter(r => r.status === 'NORMAL')

  if (normalRivers.length > 0) {
    factors.push({
      name: 'Normal rivers',
      contribution: 'positive',
      detail: `${normalRivers.length} river(s) at normal levels`,
    })
  }

  // Escalation triggers
  if (assessment.level === 'GREEN') {
    escalationTriggers.push('Any river reaching ELEVATED level')
    escalationTriggers.push('1+ verified reports in flood zones')
  } else if (assessment.level === 'AMBER') {
    escalationTriggers.push('Any river reaching HIGH level combined with verified reports')
    escalationTriggers.push('3+ verified reports in flood zones')
    escalationTriggers.push('Flood prediction of HIGH or CRITICAL within 2 hours')
  } else if (assessment.level === 'RED') {
    escalationTriggers.push('Any river reaching CRITICAL (severe) level')
    escalationTriggers.push('Severe flood predicted within 2 hours')
  }

  // De-escalation triggers
  if (assessment.level === 'CRITICAL') {
    deescalationTriggers.push('All rivers drop below severe threshold')
    deescalationTriggers.push('No severe flood predictions within 2 hours')
  } else if (assessment.level === 'RED') {
    deescalationTriggers.push('Reports in flood zones drop below 3')
    deescalationTriggers.push('All rivers drop below HIGH level')
  } else if (assessment.level === 'AMBER') {
    deescalationTriggers.push('All rivers return to NORMAL')
    deescalationTriggers.push('No verified reports in flood zones')
  }

  const summary = `Current threat level is ${assessment.level}. ` +
    `${assessment.riverSummary.length} rivers monitored` +
    (criticalRivers.length > 0 ? `, ${criticalRivers.length} CRITICAL` : '') +
    (highRivers.length > 0 ? `, ${highRivers.length} HIGH` : '') +
    (elevatedRivers.length > 0 ? `, ${elevatedRivers.length} ELEVATED` : '') +
    `. ${assessment.activeReportsInFloodZones} active report(s) in flood zones.`

  return { summary, factors, escalationTriggers, deescalationTriggers }
}

// —5  ZONE-SPECIFIC THREATS

/**
 * Compute per-zone threat levels using zone risk scores and local conditions.
 */
export async function getZoneThreatLevels(): Promise<
  Array<{ zoneId: string; zoneName: string; level: ThreatLevel; reasons: string[]; score: number }>
> {
  const region = getActiveCityRegion()
  const results: Array<{ zoneId: string; zoneName: string; level: ThreatLevel; reasons: string[]; score: number }> = []

  try {
    // Get zone risk scores
    const zones = await pool.query(
      `SELECT id, zone_name, hazard_type, risk_score, confidence, contributing_factors
       FROM zone_risk_scores
       WHERE expires_at > NOW()
       ORDER BY risk_score DESC`,
    )

    for (const zone of zones.rows) {
      const reasons: string[] = []
      let score = parseInt(zone.risk_score) || 0

      // Base reason from stored risk
      reasons.push(`Base risk score: ${score}/100 (${zone.hazard_type})`)

      // Check for recent reports in this zone
      const zoneReports = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM reports
         WHERE area = $1
           AND created_at > NOW() - INTERVAL '24 hours'
           AND status IN ('verified', 'urgent')
           AND deleted_at IS NULL`,
        [zone.zone_name],
      )
      const reportCount = zoneReports.rows[0]?.cnt || 0
      if (reportCount > 0) {
        score = Math.min(100, score + reportCount * 10)
        reasons.push(`${reportCount} verified report(s) in the last 24h`)
      }

      // Parse contributing factors
      const factors = typeof zone.contributing_factors === 'string'
        ? JSON.parse(zone.contributing_factors)
        : zone.contributing_factors
      if (factors?.historical_frequency) {
        reasons.push(`Historical frequency: ${factors.historical_frequency} events`)
      }

      // Determine threat level from score
      let level: ThreatLevel = 'GREEN'
      if (score >= 80) level = 'CRITICAL'
      else if (score >= 55) level = 'RED'
      else if (score >= 30) level = 'AMBER'

      results.push({
        zoneId: String(zone.id),
        zoneName: zone.zone_name,
        level,
        reasons,
        score,
      })
    }
  } catch (err: any) {
    logger.error({ err }, '[ThreatLevel] Zone threat computation failed')
  }

  return results
}
