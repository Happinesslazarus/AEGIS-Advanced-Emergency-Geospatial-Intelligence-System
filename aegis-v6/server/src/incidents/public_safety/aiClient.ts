/**
 * Module: aiClient.ts
 *
 * Public safety incidents incident module (handles public safety specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for public safety events.
 */

import type { IncidentPrediction } from '../types.js'
import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class PublicSafetyAIClient {
   /**
   * Get rule-based predictions for public safety incidents
   * Uses report clustering and severity keyword analysis
   */
  static async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      // Analyze recent reports
      const result = await pool.query(
        `SELECT COUNT(*) as count,
                COUNT(*) FILTER (WHERE custom_fields->>'publicAtRisk' = 'true') as at_risk_count,
                COUNT(*) FILTER (WHERE custom_fields->>'evacuationNeeded' = 'true') as evacuation_count,
                COUNT(*) FILTER (WHERE severity = 'Critical') as critical_count
         FROM reports
         WHERE incident_type = 'public_safety'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const reportCount = parseInt(result.rows[0]?.count || '0')
      const atRiskCount = parseInt(result.rows[0]?.at_risk_count || '0')
      const evacuationCount = parseInt(result.rows[0]?.evacuation_count || '0')
      const criticalCount = parseInt(result.rows[0]?.critical_count || '0')
      
      // Rule-based scoring
      let probability = Math.min(0.95, reportCount / 10)
      if (evacuationCount > 0) probability += 0.4
      if (atRiskCount >= 3) probability += 0.2
      if (criticalCount >= 2) probability += 0.15
      probability = Math.min(0.95, probability)
      
      let severity = 'Low'
      if (probability > 0.7 || evacuationCount > 0) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'public_safety',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.35,
        confidenceSource: 'rule_based',
        region,
        description: `${reportCount} safety reports, ${atRiskCount} public at risk, ${evacuationCount} evacuations needed`,
        advisoryText: this.getPublicSafetyAdvisory(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['citizen_reports', 'emergency_services']
      }]
    } catch (error) {
      logger.error({ err: error }, '[PublicSafety/AIClient] Rule-based model error')
      return []
    }
  }

  private static getPublicSafetyAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL SAFETY ALERT: Multiple incidents. Avoid affected areas. Follow emergency guidance.'
      case 'High':
        return 'HIGH SAFETY RISK: Significant concerns. Exercise extreme caution.'
      case 'Medium':
        return 'MODERATE SAFETY RISK: Safety incidents reported. Remain alert.'
      default:
        return 'LOW SAFETY RISK: Normal public safety conditions.'
    }
  }
}
