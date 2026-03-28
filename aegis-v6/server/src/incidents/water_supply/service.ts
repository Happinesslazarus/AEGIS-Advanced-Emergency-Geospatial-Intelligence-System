/**
 * incidents/water_supply/service.ts — Water Supply Disruption incident business logic
 */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { waterSupplyConfig, WATER_SUPPLY_PRIORITY_LEVELS } from './config.js'

export class WaterSupplyService {
   /**
   * Get water supply disruption risk score
   */
  static async calculateDisruptionRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'water_supply'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      return Math.min(1.0, count / 20)
    } catch {
      return 0
    }
  }

   /**
   * Get water supply predictions for a region
   */
  static async getWaterSupplyPredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateDisruptionRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'water_supply',
      severity,
      probability,
      confidence: 0.4,
      confidenceSource: 'rule_based',
      region,
      description: `Water supply disruption risk based on report clustering and infrastructure monitoring.`,
      advisoryText: this.getWaterSupplyAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['citizen_reports', 'water_quality_monitoring']
    }]
  }

   /**
   * Get water supply advisory text based on severity
   */
  static getWaterSupplyAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL WATER DISRUPTION: Widespread water supply issues. Use bottled water. Follow boil advisories.'
      case 'High':
        return 'HIGH DISRUPTION RISK: Significant water supply problems. Conserve water. Store emergency supply.'
      case 'Medium':
        return 'MODERATE DISRUPTION RISK: Localized water issues possible. Monitor water quality alerts.'
      default:
        return 'LOW DISRUPTION RISK: Water supply normal. Standard usage.'
    }
  }

   /**
   * Estimate affected households
   */
  static async estimateAffectedHouseholds(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COALESCE(SUM((custom_fields->>'affectedHouseholds')::int), COUNT(*) * 5) as estimate
         FROM reports
         WHERE incident_type = 'water_supply'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      return parseInt(result.rows[0]?.estimate || '0')
    } catch {
      return 0
    }
  }
}
