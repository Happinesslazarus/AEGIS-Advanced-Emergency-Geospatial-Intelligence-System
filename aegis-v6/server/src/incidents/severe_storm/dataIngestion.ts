/**
 * incidents/severe_storm/dataIngestion.ts — Data ingestion for severe storm monitoring
 * Data Source: Open-Meteo Weather API
 */

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'

export class SevereStormDataIngestion {
  /**
   * Ingest weather data from Open-Meteo API
   */
  static async ingestWeatherData(region: string, lat = 57.15, lon = -2.11): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,precipitation,windspeed_10m,windgusts_10m,weathercode',
        hourly: 'temperature_2m,precipitation,windspeed_10m',
        timezone: 'Europe/London'
      })

      const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        console.warn(`Open-Meteo API returned ${response.status}`)
        return { recordsIngested: 0, source: 'Open-Meteo (failed)' }
      }

      const data = await response.json()
      const recordsIngested = data.hourly?.time?.length || 0

      console.log(`Ingested ${recordsIngested} weather records from Open-Meteo`)
      
      return {
        recordsIngested,
        source: 'Open-Meteo Weather API'
      }
    } catch (error) {
      console.error(`Severe storm data ingestion error: ${error}`)
      return { recordsIngested: 0, source: 'Open-Meteo (error)' }
    }
  }

  /**
   * Fetch current weather conditions
   */
  static async fetchCurrentWeather(lat = 57.15, lon = -2.11): Promise<Record<string, unknown>> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,precipitation,windspeed_10m,windgusts_10m,weathercode,pressure_msl',
        timezone: 'Europe/London'
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
      console.error(`Current weather fetch error: ${error}`)
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
