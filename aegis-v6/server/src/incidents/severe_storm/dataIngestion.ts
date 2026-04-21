import { logger } from '../../services/logger.js'

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const DEFAULT_LAT = parseFloat(process.env.AEGIS_DEFAULT_LAT || '0')
const DEFAULT_LON = parseFloat(process.env.AEGIS_DEFAULT_LON || '0')
const AEGIS_TIMEZONE = process.env.AEGIS_TIMEZONE || 'UTC'

export class SevereStormDataIngestion {
   /**
   * Ingest weather data from Open-Meteo API
   */
  static async ingestWeatherData(region: string, lat = DEFAULT_LAT, lon = DEFAULT_LON): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,precipitation,windspeed_10m,windgusts_10m,weathercode',
        hourly: 'temperature_2m,precipitation,windspeed_10m',
        timezone: AEGIS_TIMEZONE
      })

      const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        logger.warn({ status: response.status }, '[SevereStorm] Open-Meteo API returned non-OK status')
        return { recordsIngested: 0, source: 'Open-Meteo (failed)' }
      }

      const data = await response.json()
      const recordsIngested = data.hourly?.time?.length || 0

      logger.info({ recordsIngested }, '[SevereStorm] Ingested weather records from Open-Meteo')
      
      return {
        recordsIngested,
        source: 'Open-Meteo Weather API'
      }
    } catch (error) {
      logger.error({ err: error }, '[SevereStorm] Data ingestion error')
      return { recordsIngested: 0, source: 'Open-Meteo (error)' }
    }
  }

   /**
   * Fetch current weather conditions
   */
  static async fetchCurrentWeather(lat = DEFAULT_LAT, lon = DEFAULT_LON): Promise<Record<string, unknown>> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,precipitation,windspeed_10m,windgusts_10m,weathercode,pressure_msl',
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
      logger.error({ err: error }, '[SevereStorm] Current weather fetch error')
      return {}
    }
  }

   /**
   * Schedule periodic data ingestion
   */
  static scheduleIngestion(intervalMinutes = 30): NodeJS.Timer {
    return setInterval(() => {
      SevereStormDataIngestion.ingestWeatherData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
