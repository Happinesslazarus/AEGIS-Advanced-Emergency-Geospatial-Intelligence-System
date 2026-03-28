/**
 * adapters/riverData/index.ts — Adapter factory with automatic fallback
 *
 * Returns the appropriate river data adapter based on provider name.
 * If the primary adapter fails, falls back to OpenMeteo which covers
 * any river basin on Earth without requiring an API key.
 */

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
 * If both fail, returns realistic mock data so the map always works.
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

// Mock Data Generators

function generateMockReading(stationId: string, stationName?: string, riverName?: string): RiverReading {
  // Generate realistic-looking level with slight variation
  const baseLevel = 0.8 + Math.random() * 1.2  // 0.8—2.0m range
  const hour = new Date().getHours()
  // Rivers tend to be slightly higher in early morning
  const diurnalVariation = Math.sin((hour - 6) * Math.PI / 12) * 0.1

  return {
    stationId,
    stationName: stationName || `Station ${stationId}`,
    riverName: riverName || 'Unknown River',
    levelMetres: Math.round((baseLevel + diurnalVariation) * 100) / 100,
    flowCumecs: Math.round((baseLevel * 15 + Math.random() * 5) * 10) / 10,
    timestamp: new Date().toISOString(),
    dataSource: 'mock',
    rawResponse: { mock: true, reason: 'All live data providers unavailable' },
  }
}

function generateMockHistory(stationId: string, hours: number): RiverHistory {
  const now = Date.now()
  const readings: Array<{ timestamp: string; levelMetres: number }> = []

  // Generate a reading every 15 minutes
  const intervalMs = 15 * 60 * 1000
  const count = Math.ceil((hours * 60) / 15)
  const baseLevel = 0.8 + Math.random() * 0.8

  for (let i = count; i >= 0; i--) {
    const ts = now - i * intervalMs
    // Simulate natural river level variation
    const noise = (Math.sin(i * 0.1) * 0.15) + (Math.random() - 0.5) * 0.05
    readings.push({
      timestamp: new Date(ts).toISOString(),
      levelMetres: Math.round((baseLevel + noise) * 100) / 100,
    })
  }

  return { stationId, readings }
}

export type { RiverDataAdapter, RiverReading, RiverHistory } from './RiverDataAdapter.js'
