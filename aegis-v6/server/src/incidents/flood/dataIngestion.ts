/**
 * incidents/flood/dataIngestion.ts — Data ingestion for flood monitoring
 * Data Source: UK Environment Agency Flood Monitoring API
 */

import { FLOOD_DATA_SOURCES } from './config.js'

export class FloodDataIngestion {
  /**
   * Ingest flood data from UK Environment Agency API
   */
  static async ingestFloodData(region: string): Promise<{ recordsIngested: number; source: string }> {
    try {
      const response = await fetch(`${FLOOD_DATA_SOURCES.EA_API}${FLOOD_DATA_SOURCES.FLOODS_ENDPOINT}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        console.warn(`EA Flood API returned ${response.status}`)
        return { recordsIngested: 0, source: 'UK Environment Agency (failed)' }
      }

      const data = await response.json()
      const floods = data.items || []

      console.log(`Ingested ${floods.length} flood warnings from EA API`)
      
      return {
        recordsIngested: floods.length,
        source: 'UK Environment Agency Flood Monitoring'
      }
    } catch (error) {
      console.error(`Flood data ingestion error: ${error}`)
      return { recordsIngested: 0, source: 'UK Environment Agency (error)' }
    }
  }

  /**
   * Fetch river gauge readings
   */
  static async fetchRiverGauges(region: string): Promise<Record<string, unknown>[]> {
    try {
      const response = await fetch(`${FLOOD_DATA_SOURCES.EA_API}${FLOOD_DATA_SOURCES.GAUGES_ENDPOINT}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (!response.ok) {
        return []
      }

      const data = await response.json()
      return data.items || []
    } catch (error) {
      console.error(`River gauge fetch error: ${error}`)
      return []
    }
  }

  /**
   * Schedule periodic data ingestion
   */
  static scheduleIngestion(intervalMinutes = 15): NodeJS.Timer {
    return setInterval(() => {
      FloodDataIngestion.ingestFloodData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
