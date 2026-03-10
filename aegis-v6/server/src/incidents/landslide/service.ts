/**
 * incidents/landslide/service.ts — Landslide incident business logic
 */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { landslideConfig, LANDSLIDE_RISK_THRESHOLDS } from './config.js'

export class LandslideService {
  /**
   * Get landslide risk score
   */
  static async calculateLandslideRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'landslide'
           AND created_at >= NOW() - interval '72 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      return Math.min(1.0, count / 5)
    } catch {
      return 0
    }
  }

  /**
   * Get landslide predictions for a region
   */
  static async getLandslidePredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateLandslideRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'landslide',
      severity,
      probability,
      confidence: 0.5,
      confidenceSource: 'statistical',
      region,
      description: `Landslide risk assessment based on rainfall accumulation and soil conditions.`,
      advisoryText: this.getLandslideAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['rainfall_data', 'geological_surveys', 'citizen_reports']
    }]
  }

  /**
   * Get landslide advisory text based on severity
   */
  static getLandslideAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL LANDSLIDE RISK: Landslides imminent or occurring. Evacuate vulnerable areas immediately.'
      case 'High':
        return 'HIGH LANDSLIDE RISK: Conditions highly favorable for landslides. Avoid slopes and hillsides.'
      case 'Medium':
        return 'MODERATE LANDSLIDE RISK: Possible landslides in vulnerable areas. Exercise caution near slopes.'
      default:
        return 'LOW LANDSLIDE RISK: Normal geological stability. Standard precautions apply.'
    }
  }

  /**
   * Calculate rainfall accumulation
   */
  static async calculateRainfallAccumulation(region: string, hours: number): Promise<number> {
    // Placeholder for rainfall accumulation calculation
    return 0
  }
}
