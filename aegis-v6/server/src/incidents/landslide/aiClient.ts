/**
 * Module: aiClient.ts
 *
 * Ground movement and landslides incident module (handles landslide specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for landslide events.
 */

import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

export class LandslideAIClient {
   /**
   * Get statistical predictions for landslides
   * Uses statistical analysis of rainfall and geological factors
   */
  static async getPredictions(region: string, environmentalData: Record<string, unknown>): Promise<IncidentPrediction[]> {
    try {
      const rainfall24h = Number(environmentalData.rainfall24h || 0)
      const rainfall72h = Number(environmentalData.rainfall72h || 0)
      const soilMoisture = Number(environmentalData.soilMoisture || 50)
      const slopeAngle = Number(environmentalData.slopeAngle || 15)
      
      // Statistical scoring based on geological parameters
      let riskScore = 0
      
      // Rainfall contribution
      if (rainfall24h >= 100) riskScore += 0.3
      else if (rainfall24h >= 75) riskScore += 0.2
      else if (rainfall24h >= 50) riskScore += 0.1
      
      if (rainfall72h >= 200) riskScore += 0.3
      else if (rainfall72h >= 150) riskScore += 0.2
      else if (rainfall72h >= 100) riskScore += 0.1
      
      // Soil moisture contribution
      if (soilMoisture >= 80) riskScore += 0.2
      else if (soilMoisture >= 70) riskScore += 0.15
      else if (soilMoisture >= 60) riskScore += 0.1
      
      // Slope angle contribution
      if (slopeAngle >= 35) riskScore += 0.2
      else if (slopeAngle >= 25) riskScore += 0.15
      else if (slopeAngle >= 20) riskScore += 0.1
      
      const probability = Math.min(0.95, riskScore)
      let severity = 'Low'
      if (probability > 0.7) severity = 'Critical'
      else if (probability > 0.5) severity = 'High'
      else if (probability > 0.3) severity = 'Medium'
      
      return [{
        incidentType: 'landslide',
        severity,
        probability: Math.round(probability * 100) / 100,
        confidence: 0.5,
        confidenceSource: 'statistical',
        region,
        description: `Landslide risk based on rainfall (${rainfall24h}mm/24h), soil moisture (${soilMoisture}%), slope (${slopeAngle}—)`,
        advisoryText: this.getLandslideAdvisory(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['rainfall_statistical_model', 'geological_data']
      }]
    } catch (error) {
      logger.error({ err: error }, '[Landslide/AIClient] Statistical model error')
      return []
    }
  }

  private static getLandslideAdvisory(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'CRITICAL LANDSLIDE RISK: Landslides imminent. Evacuate vulnerable areas immediately.'
      case 'High':
        return 'HIGH LANDSLIDE RISK: Conditions highly favorable for landslides. Avoid slopes.'
      case 'Medium':
        return 'MODERATE LANDSLIDE RISK: Possible landslides in vulnerable areas.'
      default:
        return 'LOW LANDSLIDE RISK: Normal geological stability.'
    }
  }
}
