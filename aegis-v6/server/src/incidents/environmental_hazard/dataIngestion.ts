/**
 * incidents/environmental_hazard/dataIngestion.ts — Data ingestion for environmental hazard monitoring
 * Data Source: OpenAQ Air Quality API
 */

import { OPENAQ_CONFIG } from './config.js'
import { logger } from '../../services/logger.js'

export class EnvironmentalHazardDataIngestion {
   /**
   * Ingest air quality data from OpenAQ API
   */
  static async ingestAirQualityData(region: string, lat = 57.15, lon = -2.11): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        coordinates: `${lat},${lon}`,
        radius: (OPENAQ_CONFIG.radiusKm * 1000).toString(), // Convert km to meters
        limit: '100',
        order_by: 'datetime'
      })

      const response = await fetch(`${OPENAQ_CONFIG.baseUrl}/latest?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        logger.warn({ status: response.status }, '[EnvironmentalHazard] OpenAQ API returned non-OK status')
        return { recordsIngested: 0, source: 'OpenAQ (failed)' }
      }

      const data = await response.json()
      const results = data.results || []

      logger.info({ count: results.length }, '[EnvironmentalHazard] Ingested air quality readings from OpenAQ')
      
      return {
        recordsIngested: results.length,
        source: 'OpenAQ Air Quality API'
      }
    } catch (error) {
      logger.error({ err: error }, '[EnvironmentalHazard] Data ingestion error')
      return { recordsIngested: 0, source: 'OpenAQ (error)' }
    }
  }

   /**
   * Fetch latest air quality measurements
   */
  static async fetchLatestAirQuality(lat = 57.15, lon = -2.11): Promise<Record<string, unknown>[]> {
    try {
      const params = new URLSearchParams({
        coordinates: `${lat},${lon}`,
        radius: (OPENAQ_CONFIG.radiusKm * 1000).toString(),
        limit: '100'
      })

      const response = await fetch(`${OPENAQ_CONFIG.baseUrl}/latest?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        return []
      }

      const data = await response.json()
      return data.results || []
    } catch (error) {
      logger.error({ err: error }, '[EnvironmentalHazard] Air quality fetch error')
      return []
    }
  }

   /**
   * Parse air quality measurements into standardized format
   */
  static parseAirQualityData(results: Record<string, unknown>[]): Record<string, number> {
    const aggregated: Record<string, number[]> = {}

    results.forEach(result => {
      const measurements = result.measurements as Array<{ parameter: string; value: number }>
      if (!measurements) return

      measurements.forEach(m => {
        if (!aggregated[m.parameter]) {
          aggregated[m.parameter] = []
        }
        aggregated[m.parameter].push(m.value)
      })
    })

    // Calculate averages
    const averages: Record<string, number> = {}
    Object.keys(aggregated).forEach(param => {
      const values = aggregated[param]
      averages[param] = values.reduce((a, b) => a + b, 0) / values.length
    })

    return averages
  }

   /**
   * Schedule periodic data ingestion
   */
  static scheduleIngestion(intervalMinutes = 60): NodeJS.Timer {
    return setInterval(() => {
      EnvironmentalHazardDataIngestion.ingestAirQualityData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
