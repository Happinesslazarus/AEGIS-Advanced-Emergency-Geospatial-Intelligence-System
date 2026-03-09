/**
 * services/threatLevelService.ts — Real-time threat level calculation
 *
 * Calculates an overall threat level for the active region based on:
 *   - River levels (from riverLevelService)
 *   - Verified flood reports in flood zones
 *   - Flood predictions (severity and time horizon)
 *
 * Levels: GREEN → AMBER → RED → CRITICAL
 *
 * GREEN:    All rivers normal, no verified reports in flood zones
 * AMBER:    Any river elevated OR 1-2 verified reports in flood zones
 * RED:      Any river HIGH AND verified reports in flood zones OR 3+ reports
 * CRITICAL: Any river above severe threshold OR predicted severe within 2 hours
 */

import { getCurrentLevels } from './riverLevelService.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import type { ThreatLevel } from '../config/regions/types.js'
import pool from '../models/db.js'
import type { Server as IOServer } from 'socket.io'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════════

let lastThreatLevel: ThreatLevel | null = null
let ioInstance: IOServer | null = null

export function setThreatIO(io: IOServer): void {
  ioInstance = io
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core Calculation
// ═══════════════════════════════════════════════════════════════════════════════

export async function calculateThreatLevel(): Promise<ThreatAssessment> {
  const region = getActiveCityRegion()
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
        AND created_at > NOW() - INTERVAL '24 hours'
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
          if (p.hours <= 2 && (p.status === 'CRITICAL' || p.status === 'HIGH')) {
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
  } else if ((hasHigh && reportsInZones > 0) || reportsInZones >= 3) {
    level = 'RED'
  } else if (hasElevated || (reportsInZones >= 1 && reportsInZones <= 2)) {
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
