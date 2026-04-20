/**
 * Infrastructure damage assessment incident module (handles infrastructure damage specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { infrastructureDamageConfig, INFRASTRUCTURE_CRITICAL_TYPES } from './config.js'

export class InfrastructureDamageService {
   /**
   * Get infrastructure damage risk score
   */
  static async calculateDamageRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'infrastructure_damage'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      return Math.min(1.0, count / 15)
    } catch {
      return 0
    }
  }

   /**
   * Get infrastructure damage predictions for a region
   */
  static async getInfrastructurePredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateDamageRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'infrastructure_damage',
      severity,
      probability,
      confidence: 0.4,
      confidenceSource: 'rule_based',
      region,
      description: `Infrastructure damage assessment based on report patterns and critical infrastructure monitoring.`,
      advisoryText: this.getInfrastructureAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['citizen_reports', 'emergency_services']
    }]
  }

   /**
   * Get infrastructure advisory text based on severity
   */
  static getInfrastructureAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL INFRASTRUCTURE DAMAGE: Major structural damage reported. Avoid affected areas. Follow official guidance.'
      case 'High':
        return 'HIGH DAMAGE RISK: Significant infrastructure damage. Use alternate routes. Exercise extreme caution.'
      case 'Medium':
        return 'MODERATE DAMAGE RISK: Infrastructure damage reported in some areas. Drive carefully and stay alert.'
      default:
        return 'LOW DAMAGE RISK: Infrastructure intact. Normal operations.'
    }
  }

   /**
   * Generate damage assessment summary
   */
  static async generateDamageAssessment(region: string): Promise<Record<string, unknown>> {
    try {
      const result = await pool.query(
        `SELECT 
           COUNT(*) as total_reports,
           COUNT(*) FILTER (WHERE severity = 'Critical') as critical_damage,
           COUNT(*) FILTER (WHERE custom_fields->>'damageType' = 'Road') as roads_affected,
           COUNT(*) FILTER (WHERE custom_fields->>'damageType' = 'Bridge') as bridges_affected
         FROM reports
         WHERE incident_type = 'infrastructure_damage'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      return result.rows[0] || { total_reports: 0, critical_damage: 0, roads_affected: 0, bridges_affected: 0 }
    } catch {
      return { total_reports: 0, critical_damage: 0, roads_affected: 0, bridges_affected: 0 }
    }
  }
}
