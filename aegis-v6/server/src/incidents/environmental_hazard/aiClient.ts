/**
 * incidents/environmental_hazard/aiClient.ts — AI client for environmental hazard predictions
 * AI Tier: tier3 (ML) - Uses trained machine learning models
 */

import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000'

export class EnvironmentalHazardAIClient {
   /**
   * Get ML-based environmental hazard predictions from AI engine
   */
  static async getPredictions(region: string, features: Record<string, unknown>): Promise<IncidentPrediction[]> {
    try {
      const response = await fetch(`${AI_ENGINE_URL}/api/ai/predict/environmental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region,
          features: {
            pm25: features.pm25 || 0,
            pm10: features.pm10 || 0,
            o3: features.o3 || 0,
            no2: features.no2 || 0,
            aqi: features.aqi || 0
          }
        })
      })

      if (!response.ok) {
        throw new Error(`AI engine returned ${response.status}`)
      }

      const data = await response.json()
      
      return [{
        incidentType: 'environmental_hazard',
        severity: data.severity || 'Low',
        probability: data.probability || 0,
        confidence: data.confidence || 0.6,
        confidenceSource: 'ml_model',
        region,
        description: data.explanation || 'Environmental hazard prediction from ML model',
        advisoryText: data.advisory || 'Monitor air quality conditions',
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['ml_model', 'openaq_api', 'air_quality_sensors'],
        modelVersion: data.model_version || 'environmental_v1.0'
      }]
    } catch (error) {
      logger.error({ err: error }, '[EnvironmentalHazard/AIClient] Prediction failed')
      // Return fallback prediction
      return [{
        incidentType: 'environmental_hazard',
        severity: 'Low',
        probability: 0.1,
        confidence: 0.3,
        confidenceSource: 'rule_based',
        region,
        description: 'AI model unavailable, using fallback prediction',
        advisoryText: 'Monitor air quality and stay alert',
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['fallback']
      }]
    }
  }

   /**
   * Check if AI engine is available
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${AI_ENGINE_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
      return response.ok
    } catch {
      return false
    }
  }
}
