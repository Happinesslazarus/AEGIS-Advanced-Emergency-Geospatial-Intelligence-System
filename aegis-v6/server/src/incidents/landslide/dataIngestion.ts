/**
 * Ground movement and landslides incident module (handles landslide specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { logger } from '../../services/logger.js'

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const DEFAULT_LAT = parseFloat(process.env.AEGIS_DEFAULT_LAT || '0')
const DEFAULT_LON = parseFloat(process.env.AEGIS_DEFAULT_LON || '0')
const AEGIS_TIMEZONE = process.env.AEGIS_TIMEZONE || 'UTC'

export class LandslideDataIngestion {
   /**
   * Ingest rainfall data from Open-Meteo API
   */
  static async ingestRainfallData(region: string, lat = DEFAULT_LAT, lon = DEFAULT_LON): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        hourly: 'precipitation,soil_moisture_0_to_7cm',
        daily: 'precipitation_sum',
        past_days: '7',
        forecast_days: '7',
        timezone: AEGIS_TIMEZONE
      })

      const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        logger.warn({ status: response.status }, '[Landslide] Open-Meteo API returned non-OK status')
        return { recordsIngested: 0, source: 'Open-Meteo (failed)' }
      }

      const data = await response.json()
      const recordsIngested = data.hourly?.time?.length || 0

      logger.info({ recordsIngested }, '[Landslide] Ingested rainfall records from Open-Meteo')
      
      return {
        recordsIngested,
        source: 'Open-Meteo Weather API'
      }
    } catch (error) {
      logger.error({ err: error }, '[Landslide] Data ingestion error')
      return { recordsIngested: 0, source: 'Open-Meteo (error)' }
    }
  }

   /**
   * Calculate rainfall accumulation over period
   */
  static async calculateRainfallAccumulation(lat = DEFAULT_LAT, lon = DEFAULT_LON, hours = 72): Promise<number> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        hourly: 'precipitation',
        past_hours: hours.toString(),
        timezone: AEGIS_TIMEZONE
      })

      const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        return 0
      }

      const data = await response.json()
      const precipitation = data.hourly?.precipitation || []
      
      return precipitation.reduce((sum: number, val: number) => sum + (val || 0), 0)
    } catch (error) {
      logger.error({ err: error }, '[Landslide] Rainfall accumulation calculation error')
      return 0
    }
  }

   /**
   * Schedule periodic data ingestion
   */
  static scheduleIngestion(intervalMinutes = 30): NodeJS.Timer {
    return setInterval(() => {
      LandslideDataIngestion.ingestRainfallData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
