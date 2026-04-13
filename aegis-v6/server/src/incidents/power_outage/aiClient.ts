/**
 * Module: aiClient.ts
 *
 * Electrical grid failures incident module (handles power outage specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for power outage events.
 */

import type { IncidentPrediction } from '../types.js'
import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class PowerOutageAIClient {
   /**
   * Get rule-based predictions for power outages
   * Uses report clustering and density analysis
   */
  static async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      // Analyze recent reports
      const result = await pool.query(
        `SELECT COUNT(*) as count,
                COUNT(*) FILTER (WHERE custom_fields->>'criticalFacility' = 'true') as critical_count
         FROM reports
         WHERE incident_type = 'power_outage'
           AND created_at >= NOW() - interval '6 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const reportCount = parseInt(result.rows[0]?.count || '0')
      const criticalCount = parseInt(result.rows[0]?.critical_count || '0')
      
      // Rule-based scoring
      let probability = Math.min(0.95, reportCount / 20)
      if (criticalCount > 0) probability += 0.2
      probability = Math.min(0.95, probability)
      
      let severity = 'Low'
      if (probability > 0.7) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'power_outage',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.4,
        confidenceSource: 'rule_based',
        region,
        description: `${reportCount} power outage reports, ${criticalCount} affecting critical facilities`,
        advisoryText: this.getOutageAdvisory(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['citizen_reports', 'report_clustering']
      }]
    } catch (error) {
      logger.error({ err: error }, '[PowerOutage/AIClient] Rule-based model error')
      return []
    }
  }

  private static getOutageAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL POWER OUTAGE: Widespread outages. Check on vulnerable neighbors.'
      case 'High':
        return 'HIGH OUTAGE RISK: Significant disruptions. Conserve device battery.'
      case 'Medium':
        return 'MODERATE OUTAGE RISK: Localized disruptions possible.'
      default:
        return 'LOW OUTAGE RISK: Power grid stable.'
    }
  }
}
