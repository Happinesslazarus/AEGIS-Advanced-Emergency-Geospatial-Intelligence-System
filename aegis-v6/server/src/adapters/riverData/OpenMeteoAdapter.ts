/**
 * River level adapter that pulls data from the Open-Meteo Flood API
 * (flood-api.open-meteo.com). No API key required. Uses the latitude/longitude
 * embedded in a station ID string (format: `lat_lng`) to query hourly river
 * discharge forecasts and return a standardised RiverReading.
 *
 * - Implements RiverDataAdapter interface (./RiverDataAdapter.ts)
 * - Used by ScotlandAdapter and GenericAdapter as a fallback data source
 * - Open-Meteo docs: https://open-meteo.com/en/docs/flood-api
 */

import type { RiverDataAdapter, RiverReading, RiverHistory } from './RiverDataAdapter.js'
import { logger } from '../../services/logger.js'

const OPENMETEO_FLOOD_API = process.env.OPENMETEO_FLOOD_API || 'https://flood-api.open-meteo.com/v1/flood'
const TIMEOUT_MS = 15_000

export class OpenMeteoAdapter implements RiverDataAdapter {
  readonly name = 'OpenMeteo'

  isAvailable(): boolean {
    // Open-Meteo is always available — no API key required
    return true
  }

  async fetchCurrentLevel(
    stationId: string,
    stationName?: string,
    riverName?: string,
  ): Promise<RiverReading | null> {
    try {
      // Open-Meteo Flood API uses coordinates, not station IDs.
      // We extract lat/lng from the stationId format "lat,lng" or use defaults.
      const coords = this.parseCoordinates(stationId)
      if (!coords) {
        logger.warn({ stationId }, '[OpenMeteo] Cannot parse coordinates from stationId')
        return null
      }

      const url = new URL(OPENMETEO_FLOOD_API)
      url.searchParams.set('latitude', coords.lat.toString())
      url.searchParams.set('longitude', coords.lng.toString())
      url.searchParams.set('daily', 'river_discharge,river_discharge_mean,river_discharge_max')
      url.searchParams.set('forecast_days', '3')
      url.searchParams.set('past_days', '2')

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) {
        logger.warn({ status: res.status }, '[OpenMeteo] HTTP error')
        return null
      }

      const data = await res.json()
      const dailyTimes: string[] = data?.daily?.time || []
      const discharges: (number | null)[] = data?.daily?.river_discharge || []

      // Find today's reading
      const today = new Date().toISOString().split('T')[0]
      const todayIdx = dailyTimes.indexOf(today)
      const currentDischarge = todayIdx >= 0 ? discharges[todayIdx] : discharges[discharges.length - 1]

      if (currentDischarge == null) return null

      // Convert discharge (m—/s) to an approximate level using Manning's equation simplification
      // This is a rough estimate — the relationship depends on channel geometry
      const estimatedLevel = this.dischargeToLevel(currentDischarge)

      return {
        stationId,
        stationName: stationName || `Open-Meteo (${coords.lat.toFixed(2)}, ${coords.lng.toFixed(2)})`,
        riverName: riverName || 'River (Open-Meteo)',
        levelMetres: estimatedLevel,
        flowCumecs: currentDischarge,
        timestamp: new Date().toISOString(),
        dataSource: 'OpenMeteo',
        rawResponse: data,
      }
    } catch (err: any) {
      logger.error({ err }, '[OpenMeteo] Failed to fetch current level')
      return null
    }
  }

  async fetchHistory(stationId: string, hours = 24): Promise<RiverHistory | null> {
    try {
      const coords = this.parseCoordinates(stationId)
      if (!coords) return null

      const pastDays = Math.max(1, Math.ceil(hours / 24))

      const url = new URL(OPENMETEO_FLOOD_API)
      url.searchParams.set('latitude', coords.lat.toString())
      url.searchParams.set('longitude', coords.lng.toString())
      url.searchParams.set('daily', 'river_discharge')
      url.searchParams.set('past_days', pastDays.toString())
      url.searchParams.set('forecast_days', '1')

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) return null

      const data = await res.json()
      const times: string[] = data?.daily?.time || []
      const discharges: (number | null)[] = data?.daily?.river_discharge || []

      const readings = times
        .map((t, i) => {
          const discharge = discharges[i]
          if (discharge == null) return null
          return {
            timestamp: new Date(t).toISOString(),
            levelMetres: this.dischargeToLevel(discharge),
            flowCumecs: discharge,
          }
        })
        .filter(Boolean) as Array<{ timestamp: string; levelMetres: number; flowCumecs?: number }>

      return { stationId, readings }
    } catch (err: any) {
      logger.error({ err }, '[OpenMeteo] History fetch failed')
      return null
    }
  }

  async fetchMultiple(stationIds: string[]): Promise<RiverReading[]> {
    const results = await Promise.allSettled(
      stationIds.map(id => this.fetchCurrentLevel(id)),
    )
    return results
      .filter((r): r is PromiseFulfilledResult<RiverReading | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((r): r is RiverReading => r !== null)
  }

  // Helpers

  private parseCoordinates(stationId: string): { lat: number; lng: number } | null {
    // Accept "lat,lng" format
    if (stationId.includes(',')) {
      const [latStr, lngStr] = stationId.split(',')
      const lat = parseFloat(latStr)
      const lng = parseFloat(lngStr)
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }
    return null
  }

   /**
   * Rough conversion from discharge (m—/s) to water level (m).
   * Uses a simplified power-law rating curve: h — a * Q^b
   * where a=0.3, b=0.4 are typical for medium rivers.
   * This is an approximation — real deployments would use station-specific rating curves.
   */
  private dischargeToLevel(dischargeCumecs: number): number {
    if (dischargeCumecs <= 0) return 0
    const a = 0.3
    const b = 0.4
    return Math.round(a * Math.pow(dischargeCumecs, b) * 100) / 100
  }
}
