/**
 * File: floodStatus.ts
 *
 * What this file does:
 * Calculates flood status for a river station by comparing current
 * water level against configured thresholds (normal, alert, warning,
 * severe, extreme).
 *
 * How it connects:
 * - Used by riverLevelService and floodPredictionService
 * - Station thresholds defined in region config (config/regions/)
 * - Returns a FloodStatus enum value used by the frontend map
 *
 * Simple explanation:
 * Looks at how high the river is and decides if it's normal,
 * at alert level, or in flood.
 */

import type { FloodStatus } from '../config/regions/types.js'
import type { RiverStation } from '../config/regions/types.js'

export interface FloodStatusResult {
  status: FloodStatus
  percentageOfFloodLevel: number
  levelMetres: number
  thresholdUsed: string
}

/**
 * Calculate flood status using dynamic threshold calibration.
 *
 * If the station has a historicalFloodLevel, use percentage-based calculation.
 * Otherwise, fall back to the station's fixed thresholds.
 */
export function calculateFloodStatus(
  currentLevel: number,
  station: RiverStation,
): FloodStatusResult {
  // Method 1: Percentage of historical flood level (preferred — self-calibrating)
  if (station.historicalFloodLevel && station.historicalFloodLevel > 0) {
    const percentageOfFloodLevel = currentLevel / station.historicalFloodLevel

    let status: FloodStatus
    if (percentageOfFloodLevel > 0.90) {
      status = 'CRITICAL'
    } else if (percentageOfFloodLevel > 0.75) {
      status = 'HIGH'
    } else if (percentageOfFloodLevel > 0.50) {
      status = 'ELEVATED'
    } else {
      status = 'NORMAL'
    }

    return {
      status,
      percentageOfFloodLevel: Math.round(percentageOfFloodLevel * 100),
      levelMetres: currentLevel,
      thresholdUsed: 'dynamic',
    }
  }

  // Method 2: Fixed thresholds from region config (fallback)
  const { normal, elevated, high, severe } = station.floodThresholds
  let status: FloodStatus = 'NORMAL'
  if (currentLevel >= severe) status = 'CRITICAL'
  else if (currentLevel >= high) status = 'HIGH'
  else if (currentLevel >= elevated) status = 'ELEVATED'

  const maxThreshold = severe || high || elevated || normal || 3.0
  const percentageOfFloodLevel = (currentLevel / maxThreshold) * 100

  return {
    status,
    percentageOfFloodLevel: Math.round(percentageOfFloodLevel),
    levelMetres: currentLevel,
    thresholdUsed: 'fixed',
  }
}

/**
 * Calculate trend by comparing current level to previous reading.
 */
export function calculateTrend(
  currentLevel: number,
  previousLevel: number | null,
): 'rising' | 'falling' | 'stable' {
  if (previousLevel == null) return 'stable'
  const diff = currentLevel - previousLevel
  if (diff > 0.05) return 'rising'
  if (diff < -0.05) return 'falling'
  return 'stable'
}

/**
 * Get status colour for UI rendering.
 */
export function getStatusColour(status: FloodStatus): string {
  switch (status) {
    case 'CRITICAL': return '#dc2626'  // Red
    case 'HIGH':     return '#f97316'  // Orange
    case 'ELEVATED': return '#eab308'  // Yellow
    case 'NORMAL':   return '#2563eb'  // Blue
    default:         return '#6b7280'  // Gray
  }
}
