/**
 * incidents/power_outage/dataIngestion.ts — Data ingestion for power outage monitoring
 * Data Source: Citizen Reports (no public utility API)
 */

import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class PowerOutageDataIngestion {
   /**
   * No external data source - relies on citizen reports
   * This method aggregates and processes existing reports
   */
  static async ingestData(region: string): Promise<{ recordsIngested: number; source: string }> {
    try {
      // Count recent power outage reports
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'power_outage'
           AND created_at >= NOW() - interval '6 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      
      logger.info({ count }, '[PowerOutage] Processed citizen reports')
      
      return {
        recordsIngested: count,
        source: 'Citizen Reports (aggregation)'
      }
    } catch (error) {
      logger.error({ err: error }, '[PowerOutage] Data processing error')
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
           ARRAY_AGG(id) as report_ids
         FROM reports
         WHERE incident_type = 'power_outage'
           AND created_at >= NOW() - interval '6 hours'
           AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         GROUP BY ROUND(latitude::numeric, 2), ROUND(longitude::numeric, 2)
         HAVING COUNT(*) >= 2`,
        []
      )
      
      return result.rows
    } catch (error) {
      logger.error({ err: error }, '[PowerOutage] Report clustering error')
      return []
    }
  }

   /**
   * Schedule periodic data processing
   */
  static scheduleIngestion(intervalMinutes = 15): NodeJS.Timer {
    return setInterval(() => {
      PowerOutageDataIngestion.ingestData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
