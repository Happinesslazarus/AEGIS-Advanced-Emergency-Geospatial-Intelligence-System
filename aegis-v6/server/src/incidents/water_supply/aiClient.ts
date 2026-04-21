import type { IncidentPrediction } from '../types.js'
import pool from '../../models/db.js'
import { logger } from '../../services/logger.js'

export class WaterSupplyAIClient {
   /**
   * Get rule-based predictions for water supply disruptions
   * Uses report clustering and contamination analysis
   */
  static async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      //Analyze recent reports
      const result = await pool.query(
        `SELECT COUNT(*) as count,
                COUNT(*) FILTER (WHERE custom_fields->>'waterQualityIssue' = 'true') as contamination_count,
                COUNT(*) FILTER (WHERE custom_fields->>'disruptionType' = 'No Water') as no_water_count
         FROM reports
         WHERE incident_type = 'water_supply'
           AND created_at >= NOW() - interval '12 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const reportCount = parseInt(result.rows[0]?.count || '0')
      const contaminationCount = parseInt(result.rows[0]?.contamination_count || '0')
      const noWaterCount = parseInt(result.rows[0]?.no_water_count || '0')
      
      //Rule-based scoring
      let probability = Math.min(0.95, reportCount / 20)
      if (contaminationCount > 0) probability += 0.3 // Contamination is critical
      if (noWaterCount >= 5) probability += 0.2
      probability = Math.min(0.95, probability)
      
      let severity = 'Low'
      if (probability > 0.7 || contaminationCount > 0) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'water_supply',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.4,
        confidenceSource: 'rule_based',
        region,
        description: `${reportCount} water supply reports, ${contaminationCount} contamination issues, ${noWaterCount} no water reports`,
        advisoryText: this.getWaterSupplyAdvisory(severity, contaminationCount > 0),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['citizen_reports', 'water_quality_monitoring']
      }]
    } catch (error) {
      logger.error({ err: error }, '[WaterSupply/AIClient] Rule-based model error')
      return []
    }
  }

  private static getWaterSupplyAdvisory(severity: string, contamination: boolean): string {
    if (contamination) {
      return 'CRITICAL: Water contamination reported. Use bottled water only. Follow boil advisories.'
    }
    
    switch (severity) {
      case 'Critical':
        return 'CRITICAL WATER DISRUPTION: Widespread supply issues. Use bottled water.'
      case 'High':
        return 'HIGH DISRUPTION RISK: Significant supply problems. Conserve water.'
      case 'Medium':
        return 'MODERATE DISRUPTION RISK: Localized issues possible.'
      default:
        return 'LOW DISRUPTION RISK: Water supply normal.'
    }
  }
}
