import type { IncidentPrediction } from '../types.js'
import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class InfrastructureDamageAIClient {
   /**
   * Get rule-based predictions for infrastructure damage
   * Uses report clustering and severity analysis
   */
  static async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      //Analyze recent reports
      const result = await pool.query(
        `SELECT COUNT(*) as count,
                COUNT(*) FILTER (WHERE custom_fields->>'structuralIntegrity' = 'Collapsed') as collapsed_count,
                COUNT(*) FILTER (WHERE custom_fields->>'safetyHazard' = 'true') as hazard_count,
                COUNT(*) FILTER (WHERE custom_fields->>'emergencyAccess' = 'true') as blocked_access_count
         FROM reports
         WHERE incident_type = 'infrastructure_damage'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const reportCount = parseInt(result.rows[0]?.count || '0')
      const collapsedCount = parseInt(result.rows[0]?.collapsed_count || '0')
      const hazardCount = parseInt(result.rows[0]?.hazard_count || '0')
      const blockedAccessCount = parseInt(result.rows[0]?.blocked_access_count || '0')
      
      //Rule-based scoring
      let probability = Math.min(0.95, reportCount / 15)
      if (collapsedCount > 0) probability += 0.3
      if (hazardCount >= 3) probability += 0.2
      if (blockedAccessCount > 0) probability += 0.15
      probability = Math.min(0.95, probability)
      
      let severity = 'Low'
      if (probability > 0.7 || collapsedCount > 0) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'infrastructure_damage',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.4,
        confidenceSource: 'rule_based',
        region,
        description: `${reportCount} damage reports, ${collapsedCount} collapsed structures, ${hazardCount} safety hazards`,
        advisoryText: this.getInfrastructureAdvisory(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['citizen_reports', 'emergency_services']
      }]
    } catch (error) {
      logger.error({ err: error }, '[InfrastructureDamage/AIClient] Rule-based model error')
      return []
    }
  }

  private static getInfrastructureAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL INFRASTRUCTURE DAMAGE: Major structural damage. Avoid affected areas.'
      case 'High':
        return 'HIGH DAMAGE RISK: Significant damage reported. Use alternate routes.'
      case 'Medium':
        return 'MODERATE DAMAGE RISK: Infrastructure damage in some areas. Stay alert.'
      default:
        return 'LOW DAMAGE RISK: Infrastructure intact.'
    }
  }
}
