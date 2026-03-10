/**
 * incidents/heatwave/dataIngestion.ts — Data ingestion for heatwave monitoring
 * Data Source: Open-Meteo Weather API
 */

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'

export class HeatwaveDataIngestion {
  /**
   * Ingest temperature data from Open-Meteo API
   */
  static async ingestTemperatureData(region: string, lat = 57.15, lon = -2.11): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,relativehumidity_2m,apparent_temperature',
        daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max',
        forecast_days: '7',
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
      const recordsIngested = data.daily?.time?.length || 0

      console.log(`Ingested ${recordsIngested} temperature records from Open-Meteo`)
      
      return {
        recordsIngested,
        source: 'Open-Meteo Weather API'
      }
    } catch (error) {
      console.error(`Heatwave data ingestion error: ${error}`)
      return { recordsIngested: 0, source: 'Open-Meteo (error)' }
    }
  }

  /**
   * Fetch current temperature conditions
   */
  static async fetchCurrentTemperature(lat = 57.15, lon = -2.11): Promise<Record<string, unknown>> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: 'temperature_2m,relativehumidity_2m,apparent_temperature',
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
      console.error(`Current temperature fetch error: ${error}`)
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
