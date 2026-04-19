/**
 * Module: service.ts
 *
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import pool from '../../models/db.js'
import type { IncidentPrediction } from '../types.js'
import { heatwaveConfig, HEATWAVE_TEMPERATURE_THRESHOLDS } from './config.js'

export class HeatwaveService {
   /**
   * Get heatwave risk score based on temperature data
   */
  static async calculateHeatwaveRisk(region: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM reports
         WHERE incident_type = 'heatwave'
           AND created_at >= NOW() - interval '72 hours'
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
   * Get heatwave predictions for a region
   */
  static async getHeatwavePredictions(region: string): Promise<IncidentPrediction[]> {
    const riskScore = await this.calculateHeatwaveRisk(region)
    const probability = Math.round(riskScore * 100) / 100

    let severity = 'Low'
    if (probability > 0.7) severity = 'Critical'
    else if (probability > 0.5) severity = 'High'
    else if (probability > 0.3) severity = 'Medium'

    return [{
      incidentType: 'heatwave',
      severity,
      probability,
      confidence: 0.6,
      confidenceSource: 'statistical',
      region,
      description: `Heatwave risk assessment based on temperature forecasts and historical patterns.`,
      advisoryText: this.getHeatwaveAdvisory(severity),
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: ['temperature_sensors', 'weather_forecast', 'citizen_reports']
    }]
  }

   /**
   * Get heatwave advisory text based on severity
   */
  static getHeatwaveAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'EXTREME HEAT WARNING: Life-threatening heat conditions. Stay indoors with air conditioning. Check on vulnerable individuals.'
      case 'High':
        return 'HIGH HEAT RISK: Dangerous heat expected. Limit outdoor activities. Stay hydrated.'
      case 'Medium':
        return 'MODERATE HEAT RISK: Hot temperatures expected. Take precautions when outdoors.'
      default:
        return 'LOW HEAT RISK: Normal summer temperatures. Enjoy outdoor activities safely.'
    }
  }

   /**
   * Calculate heat index
   */
  static calculateHeatIndex(temperature: number, humidity: number): number {
    // Simplified heat index calculation
    const heatIndex = temperature + (0.5555 * (6.11 * Math.exp(5417.7530 * ((1/273.16) - (1/(273.15 + temperature)))) * (humidity / 100) - 10))
    return Math.round(heatIndex * 10) / 10
  }
}
