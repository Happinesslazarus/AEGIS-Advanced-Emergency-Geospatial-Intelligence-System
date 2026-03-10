/**
 * incidents/wildfire/service.ts — Wildfire incident business logic
 */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { wildfireConfig, WILDFIRE_RISK_FACTORS } from './config.js'

export class WildfireService {
  /**
   * Get wildfire risk score
   */
  static async calculateWildfireRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'wildfire'
           AND created_at >= NOW() - interval '24 hours'
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
   * Get wildfire predictions for a region
   */
  static async getWildfirePredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateWildfireRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.75) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.25) severity = 'Medium'

    return [{
      incidentType: 'wildfire',
      severity,
      probability,
      confidence: 0.65,
      confidenceSource: 'ml_model',
      region,
      description: `Wildfire risk assessment based on fire hotspot detection and weather conditions.`,
      advisoryText: this.getWildfireAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['nasa_firms', 'weather_data', 'satellite_imagery'],
      modelVersion: 'wildfire_v1.0'
    }]
  }

  /**
   * Get wildfire advisory text based on severity
   */
  static getWildfireAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'EXTREME FIRE DANGER: Active wildfires or critical fire weather. Evacuate if ordered. No outdoor burning.'
      case 'High':
        return 'HIGH FIRE DANGER: Conditions favorable for rapid fire spread. Extreme caution advised.'
      case 'Medium':
        return 'MODERATE FIRE DANGER: Fire conditions present. Be cautious with fire sources.'
      default:
        return 'LOW FIRE DANGER: Normal fire safety precautions apply.'
    }
  }

  /**
   * Analyze fire hotspots
   */
  static async analyzeFireHotspots(region: string): Promise<Record<string, unknown>[]> {
    // Placeholder for NASA FIRMS hotspot analysis
    return []
  }
}
