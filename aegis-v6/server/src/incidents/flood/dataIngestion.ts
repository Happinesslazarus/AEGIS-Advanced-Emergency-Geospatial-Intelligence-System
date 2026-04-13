/**
 * Module: dataIngestion.ts
 *
 * River and surface water flooding incident module (handles flood specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for flood events.
 */

import { FLOOD_DATA_SOURCES } from './config.js'
import { logger } from '../../services/logger.js'

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
        logger.warn({ status: response.status }, '[Flood] EA Flood API returned non-OK status')
        return { recordsIngested: 0, source: 'UK Environment Agency (failed)' }
      }

      const data = await response.json()
      const floods = data.items || []

      logger.info({ count: floods.length }, '[Flood] Ingested flood warnings from EA API')
      
      return {
        recordsIngested: floods.length,
        source: 'UK Environment Agency Flood Monitoring'
      }
    } catch (error) {
      logger.error({ err: error }, '[Flood] Data ingestion error')
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
      logger.error({ err: error }, '[Flood] River gauge fetch error')
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
