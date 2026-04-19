/**
 * Module: dataIngestion.ts
 *
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { logger } from '../../services/logger.js'

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const DEFAULT_LAT = parseFloat(process.env.AEGIS_DEFAULT_LAT || '0')
const DEFAULT_LON = parseFloat(process.env.AEGIS_DEFAULT_LON || '0')
const AEGIS_TIMEZONE = process.env.AEGIS_TIMEZONE || 'UTC'

export class HeatwaveDataIngestion {
   /**
   * Ingest temperature data from Open-Meteo API
   */
  static async ingestTemperatureData(region: string, lat = DEFAULT_LAT, lon = DEFAULT_LON): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,relativehumidity_2m,apparent_temperature',
        daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max',
        forecast_days: '7',
        timezone: AEGIS_TIMEZONE
      })

      const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        logger.warn({ status: response.status }, '[Heatwave] Open-Meteo API returned non-OK status')
        return { recordsIngested: 0, source: 'Open-Meteo (failed)' }
      }

      const data = await response.json()
      const recordsIngested = data.daily?.time?.length || 0

      logger.info({ recordsIngested }, '[Heatwave] Ingested temperature records from Open-Meteo')
      
      return {
        recordsIngested,
        source: 'Open-Meteo Weather API'
      }
    } catch (error) {
      logger.error({ err: error }, '[Heatwave] Data ingestion error')
      return { recordsIngested: 0, source: 'Open-Meteo (error)' }
    }
  }

   /**
   * Fetch current temperature conditions
   */
  static async fetchCurrentTemperature(lat = DEFAULT_LAT, lon = DEFAULT_LON): Promise<Record<string, unknown>> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,relativehumidity_2m,apparent_temperature',
        timezone: AEGIS_TIMEZONE
      })

      const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        return {}
      }

      const data = await response.json()
      return data.current || {}
    } catch (error) {
      logger.error({ err: error }, '[Heatwave] Current temperature fetch error')
      return {}
    }
  }

   /**
   * Schedule periodic data ingestion
   */
  static scheduleIngestion(intervalMinutes = 60): NodeJS.Timer {
    return setInterval(() => {
      HeatwaveDataIngestion.ingestTemperatureData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
