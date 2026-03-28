/**
 * incidents/public_safety/service.ts — Public Safety Incident business logic
 */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { publicSafetyConfig, PUBLIC_SAFETY_PRIORITY_KEYWORDS } from './config.js'

export class PublicSafetyService {
   /**
   * Get public safety risk score
   */
  static async calculateSafetyRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'public_safety'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      return Math.min(1.0, count / 10)
    } catch {
      return 0
    }
  }

   /**
   * Get public safety predictions for a region
   */
  static async getPublicSafetyPredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateSafetyRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'public_safety',
      severity,
      probability,
      confidence: 0.35,
      confidenceSource: 'rule_based',
      region,
      description: `Public safety assessment based on incident reports and pattern analysis.`,
      advisoryText: this.getPublicSafetyAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['citizen_reports', 'emergency_services']
    }]
  }

   /**
   * Get public safety advisory text based on severity
   */
  static getPublicSafetyAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL SAFETY ALERT: Multiple safety incidents reported. Avoid affected areas. Follow emergency guidance.'
      case 'High':
        return 'HIGH SAFETY RISK: Significant safety concerns. Exercise extreme caution. Stay informed.'
      case 'Medium':
        return 'MODERATE SAFETY RISK: Safety incidents reported. Remain alert and vigilant.'
      default:
        return 'LOW SAFETY RISK: Normal public safety conditions. Standard precautions apply.'
    }
  }

   /**
   * Identify safety hotspots
   */
  static async identifySafetyHotspots(region: string): Promise<Record<string, unknown>[]> {
    try {
      const result = await pool.query(
        `SELECT 
           latitude, longitude, COUNT(*) as incident_count
         FROM reports
         WHERE incident_type = 'public_safety'
           AND created_at >= NOW() - interval '24 hours'
           AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')
         GROUP BY latitude, longitude
         HAVING COUNT(*) >= 2
         ORDER BY incident_count DESC`,
        []
      )
      
      return result.rows
    } catch {
      return []
    }
  }
}
