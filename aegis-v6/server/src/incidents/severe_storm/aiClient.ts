/**
 * incidents/severe_storm/aiClient.ts — AI client for severe storm predictions
 * AI Tier: tier2 (statistical) - Uses statistical models
 */

import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

export class SevereStormAIClient {
   /**
   * Get statistical predictions for severe storms
   * Uses statistical analysis of weather patterns, no external AI engine call
   */
  static async getPredictions(region: string, weatherData: Record<string, unknown>): Promise<IncidentPrediction[]> {
    try {
      const windSpeed = Number(weatherData.windSpeed || 0)
      const rainfall = Number(weatherData.rainfall || 0)
      const pressure = Number(weatherData.pressure || 1013)
      
      // Statistical scoring based on weather parameters
      let riskScore = 0
      
      // Wind speed contribution
      if (windSpeed >= 100) riskScore += 0.4
      else if (windSpeed >= 75) riskScore += 0.3
      else if (windSpeed >= 50) riskScore += 0.2
      else if (windSpeed >= 30) riskScore += 0.1
      
      // Rainfall contribution
      if (rainfall >= 50) riskScore += 0.3
      else if (rainfall >= 30) riskScore += 0.2
      else if (rainfall >= 15) riskScore += 0.1
      
      // Pressure contribution (low pressure = storms)
      if (pressure < 990) riskScore += 0.3
      else if (pressure < 1000) riskScore += 0.2
      else if (pressure < 1010) riskScore += 0.1
      
      const probability = Math.min(0.95, riskScore)
      let severity = 'Low'
      if (probability > 0.7) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'severe_storm',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.55,
        confidenceSource: 'statistical',
        region,
        description: `Storm risk based on wind speed (${windSpeed} km/h), rainfall (${rainfall} mm), pressure (${pressure} hPa)`,
        advisoryText: this.getStormAdvisory(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['weather_statistical_model', 'meteorological_data']
      }]
    } catch (error) {
      logger.error({ err: error }, '[SevereStorm/AIClient] Statistical model error')
      return []
    }
  }

  private static getStormAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL STORM WARNING: Severe weather imminent. Seek shelter immediately.'
      case 'High':
        return 'HIGH STORM RISK: Dangerous conditions expected. Secure property and stay indoors.'
      case 'Medium':
        return 'MODERATE STORM RISK: Stormy weather possible. Monitor forecasts.'
      default:
        return 'LOW STORM RISK: Minor weather disturbances possible.'
    }
  }
}
