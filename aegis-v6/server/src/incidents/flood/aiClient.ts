import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000'
const AI_API_KEY = process.env.AI_ENGINE_API_KEY || process.env.API_SECRET_KEY || ''

export class FloodAIClient {
   /**
   * Get ML-based flood predictions from AI engine
   */
  static async getPredictions(region: string, features: Record<string, unknown>): Promise<IncidentPrediction[]> {
    try {
      //Uses the central /api/predict endpoint with hazard_type=flood
      const response = await fetch(`${AI_ENGINE_URL}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AI_API_KEY ? { 'X-API-Key': AI_API_KEY, 'Authorization': `Bearer ${AI_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          hazard_type: 'flood',
          region_id: region,
          latitude: Number(features.latitude) || 56.5,
          longitude: Number(features.longitude) || -3.5,
          feature_overrides: {
            rainfall: Number(features.rainfall) || 0,
            river_level: Number(features.riverLevel) || 0,
            soil_moisture: Number(features.soilMoisture) || 0,
            historical_risk: Number(features.historicalRisk) || 0,
          },
        })
      })

      if (!response.ok) {
        throw new Error(`AI engine returned ${response.status}`)
      }

      const data = await response.json()
      
      return [{
        incidentType: 'flood',
        severity: data.severity || 'Low',
        probability: data.probability || 0,
        confidence: data.confidence || 0.6,
        confidenceSource: 'ml_model',
        region,
        description: data.explanation || 'Flood prediction from ML model',
        advisoryText: data.advisory || 'Monitor flood conditions',
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['ml_model', 'river_gauges', 'weather_data'],
        modelVersion: data.model_version || 'flood_v1.0'
      }]
    } catch (error) {
      logger.error({ err: error }, '[Flood/AIClient] Prediction failed')
      //Return fallback prediction
      return [{
        incidentType: 'flood',
        severity: 'Low',
        probability: 0.1,
        confidence: 0.3,
        confidenceSource: 'rule_based',
        region,
        description: 'AI model unavailable, using fallback prediction',
        advisoryText: 'Monitor flood conditions and stay alert',
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
