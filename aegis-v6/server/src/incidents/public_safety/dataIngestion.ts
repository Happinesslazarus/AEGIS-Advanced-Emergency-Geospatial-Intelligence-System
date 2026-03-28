/**
 * incidents/public_safety/dataIngestion.ts — Data ingestion for public safety monitoring
 * Data Source: Citizen Reports, Emergency Services Integration
 */

import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class PublicSafetyDataIngestion {
   /**
   * No external data source - relies on citizen reports and emergency services
   * This method aggregates and processes existing reports
   */
  static async ingestData(region: string): Promise<{ recordsIngested: number; source: string }> {
    try {
      // Count recent public safety reports
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'public_safety'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      
      logger.info({ count }, '[PublicSafety] Processed citizen reports')
      
      return {
        recordsIngested: count,
        source: 'Citizen Reports (aggregation)'
      }
    } catch (error) {
      logger.error({ err: error }, '[PublicSafety] Data processing error')
      return { recordsIngested: 0, source: 'Citizen Reports (error)' }
    }
  }

   /**
   * Identify safety hotspots by geographic clustering
   */
  static async identifyHotspots(region: string): Promise<Record<string, unknown>[]> {
    try {
      const result = await pool.query(
        `SELECT 
           latitude, longitude, 
           COUNT(*) as incident_count,
           ARRAY_AGG(custom_fields->>'incidentType') as incident_types,
           ARRAY_AGG(id) as report_ids
         FROM reports
         WHERE incident_type = 'public_safety'
           AND created_at >= NOW() - interval '24 hours'
           AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         GROUP BY ROUND(latitude::numeric, 2), ROUND(longitude::numeric, 2)
         HAVING COUNT(*) >= 2
         ORDER BY COUNT(*) DESC`,
        []
      )
      
      return result.rows
    } catch (error) {
      logger.error({ err: error }, '[PublicSafety] Hotspot identification error')
      return []
    }
  }

   /**
   * Schedule periodic data processing
   */
  static scheduleIngestion(intervalMinutes = 15): NodeJS.Timer {
    return setInterval(() => {
      PublicSafetyDataIngestion.ingestData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
