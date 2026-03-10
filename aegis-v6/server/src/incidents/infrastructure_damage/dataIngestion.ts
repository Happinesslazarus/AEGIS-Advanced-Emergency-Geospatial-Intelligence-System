/**
 * incidents/infrastructure_damage/dataIngestion.ts — Data ingestion for infrastructure damage monitoring
 * Data Source: Citizen Reports
 */

import pool from '../../models/db.js'

export class InfrastructureDamageDataIngestion {
  /**
   * No external data source - relies on citizen reports
   * This method aggregates and processes existing reports
   */
  static async ingestData(region: string): Promise<{ recordsIngested: number; source: string }> {
    try {
      // Count recent infrastructure damage reports
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'infrastructure_damage'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      
      console.log(`Processed ${count} infrastructure damage reports from citizens`)
      
      return {
        recordsIngested: count,
        source: 'Citizen Reports (aggregation)'
      }
    } catch (error) {
      console.error(`Infrastructure damage data processing error: ${error}`)
      return { recordsIngested: 0, source: 'Citizen Reports (error)' }
    }
  }

  /**
   * Categorize damage by type
   */
  static async categorizeDamage(region: string): Promise<Record<string, number>> {
    try {
      const result = await pool.query(
        `SELECT 
           custom_fields->>'damageType' as damage_type,
           COUNT(*) as count
         FROM reports
         WHERE incident_type = 'infrastructure_damage'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         GROUP BY custom_fields->>'damageType'`,
        []
      )
      
      const categorization: Record<string, number> = {}
      result.rows.forEach(row => {
        if (row.damage_type) {
          categorization[row.damage_type] = parseInt(row.count)
        }
      })
      
      return categorization
    } catch (error) {
      console.error(`Damage categorization error: ${error}`)
      return {}
    }
  }

  /**
   * Schedule periodic data processing
   */
  static scheduleIngestion(intervalMinutes = 30): NodeJS.Timer {
    return setInterval(() => {
      InfrastructureDamageDataIngestion.ingestData('default')
    }, intervalMinutes * 60 * 1000)
  }
}
