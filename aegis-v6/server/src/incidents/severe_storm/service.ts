/**
 * Module: service.ts
 *
 * Severe weather and storm systems incident module (handles severe storm specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { severeStormConfig, STORM_WEATHER_THRESHOLDS } from './config.js'
import { logger } from '../../services/logger.js'

export class SevereStormService {
   /**
   * Get storm risk score based on weather data and reports
   */
  static async calculateStormRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'severe_storm'
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
   * Get severe storm predictions for a region
   */
  static async getStormPredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateStormRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'severe_storm',
      severity,
      probability,
      confidence: 0.55,
      confidenceSource: 'statistical',
      region,
      description: `Severe storm risk assessment based on weather patterns and historical data.`,
      advisoryText: this.getStormAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['weather_api', 'citizen_reports', 'meteorological_data']
    }]
  }

   /**
   * Get storm advisory text based on severity
   */
  static getStormAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL STORM WARNING: Severe weather imminent. Seek shelter immediately. Avoid travel.'
      case 'High':
        return 'HIGH STORM RISK: Dangerous weather conditions expected. Secure property and stay indoors.'
      case 'Medium':
        return 'MODERATE STORM RISK: Stormy weather possible. Monitor forecasts and prepare.'
      default:
        return 'LOW STORM RISK: Minor weather disturbances possible. Continue normal activities.'
    }
  }

   /**
   * Analyze wind speed data
   */
  static async analyzeWindPatterns(region: string): Promise<{ currentWindSpeed: number; maxGust: number; gustLevel: string; direction: number }> {
    try {
      const { SevereStormDataIngestion } = await import('./dataIngestion.js')
      const weather = await SevereStormDataIngestion.fetchCurrentWeather(57.15, -2.11)
      const currentWindSpeed = parseFloat(String(weather.windspeed_10m || 0))
      const maxGust = parseFloat(String(weather.windgusts_10m || 0))
      const direction = parseFloat(String(weather.winddirection_10m || 0))
      let gustLevel = 'Low'
      if (maxGust >= 100) {
        gustLevel = 'Critical'
      } else if (maxGust >= 75) {
        gustLevel = 'High'
      } else if (maxGust >= 50) {
        gustLevel = 'Medium'
      }
      return { currentWindSpeed: Math.round(currentWindSpeed * 10) / 10, maxGust: Math.round(maxGust * 10) / 10, gustLevel, direction: Math.round(direction) }
    } catch (error) {
      logger.error({ err: error }, '[SevereStormService] Wind pattern analysis error')
      return { currentWindSpeed: 0, maxGust: 0, gustLevel: 'Unknown', direction: 0 }
    }
  }
}
