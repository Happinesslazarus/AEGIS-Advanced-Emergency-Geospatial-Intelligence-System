/**
 * Module: aiClient.ts
 *
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for heatwave events.
 */

import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

export class HeatwaveAIClient {
   /**
   * Get statistical predictions for heatwaves
   * Uses statistical analysis of temperature patterns
   */
  static async getPredictions(region: string, temperatureData: Record<string, unknown>): Promise<IncidentPrediction[]> {
    try {
      const currentTemp = Number(temperatureData.currentTemp || 20)
      const forecastTemp = Number(temperatureData.forecastTemp || 20)
      const humidity = Number(temperatureData.humidity || 50)
      const consecutiveDays = Number(temperatureData.consecutiveDays || 0)
      
      // Statistical scoring based on temperature parameters
      let riskScore = 0
      
      // Temperature contribution
      if (forecastTemp >= 38) riskScore += 0.4
      else if (forecastTemp >= 35) riskScore += 0.3
      else if (forecastTemp >= 32) riskScore += 0.2
      else if (forecastTemp >= 28) riskScore += 0.1
      
      // Humidity contribution (high humidity increases heat index)
      if (humidity >= 80) riskScore += 0.2
      else if (humidity >= 70) riskScore += 0.15
      else if (humidity >= 60) riskScore += 0.1
      
      // Duration contribution (consecutive hot days)
      if (consecutiveDays >= 5) riskScore += 0.3
      else if (consecutiveDays >= 3) riskScore += 0.2
      else if (consecutiveDays >= 2) riskScore += 0.1
      
      const probability = Math.min(0.95, riskScore)
      let severity = 'Low'
      if (probability > 0.7) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'heatwave',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.6,
        confidenceSource: 'statistical',
        region,
        description: `Heatwave risk based on temperature (${forecastTemp}—C), humidity (${humidity}%), duration (${consecutiveDays} days)`,
        advisoryText: this.getHeatwaveAdvisory(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['temperature_statistical_model', 'weather_forecast']
      }]
    } catch (error) {
      logger.error({ err: error }, '[Heatwave/AIClient] Statistical model error')
      return []
    }
  }

  private static getHeatwaveAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'EXTREME HEAT WARNING: Life-threatening conditions. Stay indoors with air conditioning.'
      case 'High':
        return 'HIGH HEAT RISK: Dangerous heat expected. Limit outdoor activities.'
      case 'Medium':
        return 'MODERATE HEAT RISK: Hot temperatures expected. Take precautions.'
      default:
        return 'LOW HEAT RISK: Normal summer temperatures.'
    }
  }
}
