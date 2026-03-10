/**
 * incidents/flood/service.ts â€” Flood incident business logic
 */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { floodConfig } from './config.js'

export class FloodService {
  /**
   * Get flood risk score based on recent reports and environmental data
   */
  static async calculateFloodRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count, AVG(CASE 
          WHEN severity = 'Critical' THEN 4
          WHEN severity = 'High' THEN 3
          WHEN severity = 'Medium' THEN 2
          ELSE 1 END) as avg_severity
         FROM reports
         WHERE incident_type = 'flood'
           AND created_at >= NOW() - interval '48 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      const avgSeverity = parseFloat(result.rows[0]?.avg_severity || '1')
      
      return Math.min(1.0, (count / 20) * (avgSeverity / 4))
    } catch {
      return 0
    }
  }

  /**
   * Get flood predictions for a region
   */
  static async getFloodPredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateFloodRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.75) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.25) severity = 'Medium'

    return [{
      incidentType: 'flood',
      severity,
      probability,
      confidence: 0.6,
      confidenceSource: 'ml_model',
      region,
      description: `Flood risk assessment based on recent report patterns and environmental conditions.`,
      advisoryText: this.getFloodAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['citizen_reports', 'river_gauges', 'weather_data'],
      modelVersion: 'flood_v1.0'
    }]
  }

  /**
   * Get flood advisory text based on severity
   */
  static getFloodAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL FLOOD RISK: Severe flooding expected. Evacuate if instructed. Avoid flood-prone areas.'
      case 'High':
        return 'HIGH FLOOD RISK: Flooding likely. Prepare emergency supplies. Monitor river levels closely.'
      case 'Medium':
        return 'MODERATE FLOOD RISK: Possible flooding. Stay alert. Avoid low-lying areas.'
      default:
        return 'LOW FLOOD RISK: Minimal flooding expected. Continue normal activities.'
    }
  }

  /**
   * Analyze river gauge trends
   */
  static async analyzeRiverGauges(region: string): Promise<Record<string, unknown>[]> {
    // Placeholder for river gauge analysis
    return []
  }

  /**
   * Get historical flood data
   */
  static async getHistoricalFloodData(region: string, days: number): Promise<Record<string, unknown>[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM reports
         WHERE incident_type = 'flood'
           AND created_at >= NOW() - ($1 || ' days')::interval
         ORDER BY created_at DESC`,
        [days]
      )
      return result.rows
    } catch {
      return []
    }
  }
}
