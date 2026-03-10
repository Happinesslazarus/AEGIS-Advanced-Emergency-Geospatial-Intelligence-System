/**
 * incidents/wildfire/dataIngestion.ts — Data ingestion for wildfire monitoring
 * Data Source: NASA FIRMS API
 */

import { NASA_FIRMS_CONFIG } from './config.js'

export class WildfireDataIngestion {
  /**
   * Ingest wildfire hotspot data from NASA FIRMS API
   */
  static async ingestFireData(region: string, lat = 57.15, lon = -2.11, radius = 100): Promise<{ recordsIngested: number; source: string }> {
    try {
      const apiKey = process.env.NASA_FIRMS_API_KEY
      if (!apiKey) {
        console.warn('NASA FIRMS API key not configured')
        return { recordsIngested: 0, source: 'NASA FIRMS (no API key)' }
      }

      // NASA FIRMS area format: csv/{map_key}/{source}/{area}/{dayRange}/{date}
      const source = 'VIIRS_NOAA20_NRT'
      const area = `${lat},${lon},${radius}km`
      const dayRange = 1

      const url = `${NASA_FIRMS_CONFIG.baseUrl}/csv/${apiKey}/${source}/${area}/${dayRange}`

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'text/csv' }
      })

      if (!response.ok) {
        console.warn(`NASA FIRMS API returned ${response.status}`)
        return { recordsIngested: 0, source: 'NASA FIRMS (failed)' }
      }

      const csvData = await response.text()
      const lines = csvData.split('\n').filter(line => line.trim())
      const recordCount = Math.max(0, lines.length - 1) // Subtract header row

      console.log(`Ingested ${recordCount} fire hotspots from NASA FIRMS`)
      
      return {
        recordsIngested: recordCount,
        source: 'NASA FIRMS'
      }
    } catch (error) {
      console.error(`Wildfire data ingestion error: ${error}`)
      return { recordsIngested: 0, source: 'NASA FIRMS (error)' }
    }
  }

  /**
   * Parse NASA FIRMS CSV data
   */
  static parseFireHotspots(csvData: string): Record<string, unknown>[] {
    const lines = csvData.split('\n').filter(line => line.trim())
    if (lines.length <= 1) return []

    const headers = lines[0].split(',')
    const hotspots: Record<string, unknown>[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',')
      const hotspot: Record<string, unknown> = {}
      
      headers.forEach((header, index) => {
        hotspot[header.trim()] = values[index]?.trim() || ''
      })
      
      hotspots.push(hotspot)
    }

    return hotspots
  }

  /**
   * Schedule periodic data ingestion
   */
  static scheduleIngestion(intervalMinutes = 60): NodeJS.Timer {
    return setInterval(() => {
      WildfireDataIngestion.ingestFireData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
