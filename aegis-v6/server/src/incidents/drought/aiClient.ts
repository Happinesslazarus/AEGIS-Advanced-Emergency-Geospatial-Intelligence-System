/**
 * Module: aiClient.ts
 *
 * Extended drought conditions incident module (handles drought specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for drought events.
 */

import type { IncidentPrediction } from '../types.js'
import { logger } from '../../services/logger.js'

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000'

export class DroughtAIClient {
   /**
   * Get statistical drought predictions from AI engine (DroughtPredictor).
   */
  static async getPredictions(region: string, latitude = 57.15, longitude = -2.09): Promise<IncidentPrediction[]> {
    try {
      const response = await fetch(`${AI_ENGINE_URL}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hazard_type: 'drought',
          region_id: region,
          latitude,
          longitude,
          include_contributing_factors: true,
          forecast_horizon: 2160, // 90 days
        }),
        signal: AbortSignal.timeout(8000),
      })

      if (!response.ok) throw new Error(`AI engine returned ${response.status}`)

      const data = await response.json()
      const factors = (data.contributing_factors || [])
        .slice(0, 3)
        .map((f: any) => `${f.factor}: ${f.value}`)
        .join(', ')

      return [{
        incidentType: 'drought',
        severity: data.risk_level || 'Low',
        probability: data.probability || 0.05,
        confidence: data.confidence || 0.60,
        confidenceSource: 'statistical',
        region,
        description: `Drought assessment: ${data.risk_level || 'Low'} risk.${factors ? ` Factors — ${factors}` : ''}`,
        advisoryText: DroughtAIClient.getAdvisory(data.risk_level || 'Low'),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: data.data_sources || ['statistical_model'],
        modelVersion: data.model_version,
      }]
    } catch (error) {
      logger.error({ err: error }, '[Drought/AIClient] Prediction failed')
      return []
    }
  }

  static getAdvisory(riskLevel: string): string {
    const map: Record<string, string> = {
      Critical: 'Severe drought conditions. Mandatory water restrictions likely. Conserve all non-essential water use immediately.',
      High:     'Significant rainfall deficit. Implement voluntary water conservation. Monitor river levels and reservoir status.',
      Medium:   'Below-average precipitation. Monitor soil moisture and water supply. Consider early conservation measures.',
      Low:      'Conditions within normal range. Continue routine monitoring.',
    }
    return map[riskLevel] || map.Low
  }

  static async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${AI_ENGINE_URL}/health`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }
}
