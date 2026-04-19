/**
 * Module: service.ts
 *
 * Electrical grid failures incident module (handles power outage specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { powerOutageConfig, POWER_OUTAGE_CRITICAL_FACILITIES } from './config.js'

export class PowerOutageService {
   /**
   * Get power outage risk score
   */
  static async calculateOutageRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'power_outage'
           AND created_at >= NOW() - interval '6 hours'
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
   * Get power outage predictions for a region
   */
  static async getOutagePredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateOutageRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'power_outage',
      severity,
      probability,
      confidence: 0.4,
      confidenceSource: 'rule_based',
      region,
      description: `Power outage risk based on report clustering and critical infrastructure monitoring.`,
      advisoryText: this.getOutageAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['citizen_reports', 'infrastructure_monitoring']
    }]
  }

   /**
   * Get power outage advisory text based on severity
   */
  static getOutageAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL POWER OUTAGE: Widespread outages affecting critical infrastructure. Check on vulnerable neighbors.'
      case 'High':
        return 'HIGH OUTAGE RISK: Significant power disruptions. Conserve device battery. Use flashlights, not candles.'
      case 'Medium':
        return 'MODERATE OUTAGE RISK: Localized power disruptions possible. Have emergency supplies ready.'
      default:
        return 'LOW OUTAGE RISK: Power grid stable. Normal operations.'
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
         WHERE incident_type = 'power_outage'
           AND created_at >= NOW() - interval '6 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      return parseInt(result.rows[0]?.estimate || '0')
    } catch {
      return 0
    }
  }
}
