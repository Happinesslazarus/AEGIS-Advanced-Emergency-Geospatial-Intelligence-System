import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000'
const AI_API_KEY = process.env.AI_ENGINE_API_KEY || process.env.API_SECRET_KEY || ''

export class WildfireAIClient {
   /**
   * Get ML-based wildfire predictions from AI engine
   */
  static async getPredictions(region: string, features: Record<string, unknown>): Promise<IncidentPrediction[]> {
    try {
      const response = await fetch(`${AI_ENGINE_URL}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AI_API_KEY ? { 'X-API-Key': AI_API_KEY, 'Authorization': `Bearer ${AI_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          hazard_type: 'wildfire',
          region_id: region,
          latitude: Number(features.latitude) || 56.5,
          longitude: Number(features.longitude) || -3.5,
          feature_overrides: {
            temperature: Number(features.temperature) || 20,
            humidity: Number(features.humidity) || 50,
            wind_speed: Number(features.windSpeed) || 10,
            vegetation_dryness: Number(features.vegetationDryness) || 0.5,
            hotspot_count: Number(features.hotspotCount) || 0,
          },
        })
      })

      if (!response.ok) {
        throw new Error(`AI engine returned ${response.status}`)
      }

      const data = await response.json()
      
      return [{
        incidentType: 'wildfire',
        severity: data.severity || 'Low',
        probability: data.probability || 0,
        confidence: data.confidence || 0.65,
        confidenceSource: 'ml_model',
        region,
        description: data.explanation || 'Wildfire prediction from ML model',
        advisoryText: data.advisory || 'Monitor fire conditions',
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['ml_model', 'nasa_firms', 'weather_data'],
        modelVersion: data.model_version || 'wildfire_v1.0'
      }]
    } catch (error) {
      logger.error({ err: error }, '[Wildfire/AIClient] Prediction failed')
      //Return fallback prediction
      return [{
        incidentType: 'wildfire',
        severity: 'Low',
        probability: 0.1,
        confidence: 0.3,
        confidenceSource: 'rule_based',
        region,
        description: 'AI model unavailable, using fallback prediction',
        advisoryText: 'Monitor fire weather conditions and stay alert',
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
