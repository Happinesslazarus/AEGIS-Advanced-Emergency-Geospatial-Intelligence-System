/**
 * incidents/landslide/dataIngestion.ts — Data ingestion for landslide monitoring
 * Data Source: Open-Meteo Weather API (rainfall data)
 */

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'

export class LandslideDataIngestion {
  /**
   * Ingest rainfall data from Open-Meteo API
   */
  static async ingestRainfallData(region: string, lat = 57.15, lon = -2.11): Promise<{ recordsIngested: number; source: string }> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        hourly: 'precipitation,soil_moisture_0_to_7cm',
        daily: 'precipitation_sum',
        past_days: '7',
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
      const recordsIngested = data.hourly?.time?.length || 0

      console.log(`Ingested ${recordsIngested} rainfall records from Open-Meteo`)
      
      return {
        recordsIngested,
        source: 'Open-Meteo Weather API'
      }
    } catch (error) {
      console.error(`Landslide data ingestion error: ${error}`)
      return { recordsIngested: 0, source: 'Open-Meteo (error)' }
    }
  }

  /**
   * Calculate rainfall accumulation over period
   */
  static async calculateRainfallAccumulation(lat = 57.15, lon = -2.11, hours = 72): Promise<number> {
    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        hourly: 'precipitation',
        past_hours: hours.toString(),
        timezone: 'Europe/London'
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
      console.error(`Rainfall accumulation calculation error: ${error}`)
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
