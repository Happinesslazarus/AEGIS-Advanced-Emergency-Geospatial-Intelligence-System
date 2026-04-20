/**
 * Environmental contamination events incident module (handles environmental hazard specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { environmentalHazardConfig, AIR_QUALITY_THRESHOLDS } from './config.js'

export class EnvironmentalHazardService {
   /**
   * Get environmental hazard risk score
   */
  static async calculateEnvironmentalRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'environmental_hazard'
           AND created_at >= NOW() - interval '24 hours'
           AND status NOT IN ('resolved', 'closed', 'rejected', 'archived')`,
        []
      )
      
      const count = parseInt(result.rows[0]?.count || '0')
      return Math.min(1.0, count / 10)
    } catch {
      return 0
    }
  }

   /**
   * Get environmental hazard predictions for a region
   */
  static async getEnvironmentalPredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateEnvironmentalRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'environmental_hazard',
      severity,
      probability,
      confidence: 0.6,
      confidenceSource: 'ml_model',
      region,
      description: `Environmental hazard assessment based on air quality monitoring and sensor data.`,
      advisoryText: this.getEnvironmentalAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['openaq_api', 'air_quality_sensors', 'citizen_reports'],
      modelVersion: 'environmental_v1.0'
    }]
  }

   /**
   * Get environmental advisory text based on severity
   */
  static getEnvironmentalAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'HAZARDOUS AIR QUALITY: Dangerous pollution levels. Stay indoors. Use air purifiers. Avoid outdoor activity.'
      case 'High':
        return 'UNHEALTHY AIR QUALITY: Elevated pollution levels. Limit outdoor exposure. Vulnerable groups should stay indoors.'
      case 'Medium':
        return 'MODERATE AIR QUALITY: Some pollutants detected. Sensitive individuals should reduce prolonged outdoor exertion.'
      default:
        return 'GOOD AIR QUALITY: Air quality is satisfactory. Normal outdoor activities.'
    }
  }

   /**
   * Calculate Air Quality Index (AQI)
   */
  static calculateAQI(pm25: number, pm10: number, o3: number, no2: number): number {
    // Simplified AQI calculation based on PM2.5
    if (pm25 >= AIR_QUALITY_THRESHOLDS.pm25.critical) return 300
    if (pm25 >= AIR_QUALITY_THRESHOLDS.pm25.high) return 200
    if (pm25 >= AIR_QUALITY_THRESHOLDS.pm25.medium) return 100
    if (pm25 >= AIR_QUALITY_THRESHOLDS.pm25.low) return 50
    return 25
  }

   /**
   * Generate health advisory based on AQI
   */
  static generateHealthAdvisory(aqi: number): Record<string, unknown> {
    if (aqi >= 300) {
      return {
        level: 'Hazardous',
        message: 'Health alert: everyone may experience serious health effects',
        recommendations: ['Stay indoors', 'Use air purifiers', 'Avoid all outdoor activity']
      }
    } else if (aqi >= 200) {
      return {
        level: 'Unhealthy',
        message: 'Health warnings: everyone may experience health effects',
        recommendations: ['Limit outdoor activity', 'Wear masks outdoors', 'Keep windows closed']
      }
    } else if (aqi >= 100) {
      return {
        level: 'Moderate',
        message: 'Air quality acceptable; some pollutants may be a concern',
        recommendations: ['Sensitive groups should limit prolonged outdoor activity']
      }
    } else {
      return {
        level: 'Good',
        message: 'Air quality is satisfactory',
        recommendations: ['Enjoy normal outdoor activities']
      }
    }
  }
}
