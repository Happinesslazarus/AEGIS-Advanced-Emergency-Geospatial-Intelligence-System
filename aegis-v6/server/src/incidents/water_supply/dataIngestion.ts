/**
 * Water supply disruptions incident module (handles water supply specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class WaterSupplyDataIngestion {
   /**
   * No external data source - relies on citizen reports
   * This method aggregates and processes existing reports
   */
  static async ingestData(region: string): Promise<{ recordsIngested: number; source: string }> {
    try {
      //Count recent water supply disruption reports
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'water_supply'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      
      logger.info({ count }, '[WaterSupply] Processed citizen reports')
      
      return {
        recordsIngested: count,
        source: 'Citizen Reports (aggregation)'
      }
    } catch (error) {
      logger.error({ err: error }, '[WaterSupply] Data processing error')
      return { recordsIngested: 0, source: 'Citizen Reports (error)' }
    }
  }

   /**
   * Cluster reports by geographic proximity
   */
  static async clusterReports(region: string, radiusKm = 2): Promise<Record<string, unknown>[]> {
    try {
      const result = await pool.query(
        `SELECT 
           latitude, longitude, 
           COUNT(*) as report_count,
           COUNT(*) FILTER (WHERE custom_fields->>'waterQualityIssue' = 'true') as contamination_count,
           ARRAY_AGG(id) as report_ids
         FROM reports
         WHERE incident_type = 'water_supply'
           AND created_at >= NOW() - interval '12 hours'
           AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         GROUP BY ROUND(latitude::numeric, 2), ROUND(longitude::numeric, 2)
         HAVING COUNT(*) >= 2`,
        []
      )
      
      return result.rows
    } catch (error) {
      logger.error({ err: error }, '[WaterSupply] Report clustering error')
      return []
    }
  }

   /**
   * Schedule periodic data processing
   */
  static scheduleIngestion(intervalMinutes = 30): NodeJS.Timer {
    return setInterval(() => {
      WaterSupplyDataIngestion.ingestData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
