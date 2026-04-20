/**
 * Riverdata barrel export (re-exports module contents).
 *
 * - Used by services for external data fetching
 * */

import type { RiverDataAdapter, RiverReading, RiverHistory } from './RiverDataAdapter.js'
import { SEPAAdapter } from './SEPAAdapter.js'
import { OpenMeteoAdapter } from './OpenMeteoAdapter.js'
import { logger } from '../../services/logger.js'

const sepaAdapter = new SEPAAdapter()
const openMeteoAdapter = new OpenMeteoAdapter()

const ADAPTER_MAP: Record<string, RiverDataAdapter> = {
  SEPA: sepaAdapter,
  EA: sepaAdapter,                // EA uses similar KiWIS format
  OpenMeteo: openMeteoAdapter,
}

/**
 * Get the adapter for a specific data provider.
 * Falls back to OpenMeteo if the requested provider is unknown.
 */
export function getAdapter(providerName: string): RiverDataAdapter {
  return ADAPTER_MAP[providerName] || openMeteoAdapter
}

/**
 * Fetch current level with automatic fallback.
 * Tries the primary adapter first; if it fails, tries OpenMeteo.
 * If both fail, returns null so the UI shows 'no data' honestly.
 */
export async function fetchWithFallback(
  primaryProvider: string,
  stationId: string,
  stationName?: string,
  riverName?: string,
  coordinates?: { lat: number; lng: number },
): Promise<RiverReading | null> {
  // Try primary adapter
  const primary = getAdapter(primaryProvider)
  const reading = await primary.fetchCurrentLevel(stationId, stationName, riverName)
  if (reading) return reading

  // Fallback to OpenMeteo if coordinates are available
  if (coordinates) {
    const coordStationId = `${coordinates.lat},${coordinates.lng}`
    const fallbackReading = await openMeteoAdapter.fetchCurrentLevel(
      coordStationId, stationName, riverName,
    )
    if (fallbackReading) {
      return { ...fallbackReading, stationId, dataSource: `OpenMeteo (fallback)` }
    }
  }

  // All providers failed — return null so UI shows 'no data' honestly
  logger.warn({ stationId }, '[RiverAdapter] All providers failed — no data available')
  return null
}

/**
 * Fetch history with automatic fallback.
 */
export async function fetchHistoryWithFallback(
  primaryProvider: string,
  stationId: string,
  hours = 24,
  coordinates?: { lat: number; lng: number },
): Promise<RiverHistory> {
  const primary = getAdapter(primaryProvider)
  const history = await primary.fetchHistory(stationId, hours)
  if (history && history.readings.length > 0) return history

  // Fallback to OpenMeteo
  if (coordinates) {
    const coordStationId = `${coordinates.lat},${coordinates.lng}`
    const fallback = await openMeteoAdapter.fetchHistory(coordStationId, hours)
    if (fallback && fallback.readings.length > 0) {
      return { ...fallback, stationId }
    }
  }

  // All providers failed — return empty history
  return { stationId, readings: [] }
}

export type { RiverDataAdapter, RiverReading, RiverHistory } from './RiverDataAdapter.js'
