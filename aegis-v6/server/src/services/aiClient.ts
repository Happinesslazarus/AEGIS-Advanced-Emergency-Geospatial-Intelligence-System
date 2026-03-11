/*
 * aiClient.ts - AI Engine Integration Layer
 *
 * This module handles communication between Node.js and the FastAPI AI Engine.
 * It provides a clean interface for requesting predictions and other AI operations.
 *
 * Architecture:
 * - Node.js (this) → HTTP → FastAPI AI Engine
 * - Includes retry logic, timeout handling, error mapping
 * - Caches model status information
 */

import { devLog } from '../utils/logger.js'

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000'
const AI_ENGINE_TIMEOUT = parseInt(process.env.AI_ENGINE_TIMEOUT || '30000', 10)

interface PredictionRequest {
  hazard_type:
    | 'flood' | 'drought' | 'heatwave' | 'wildfire'
    | 'severe_storm' | 'landslide' | 'power_outage'
    | 'water_supply_disruption' | 'infrastructure_damage'
    | 'public_safety_incident' | 'environmental_hazard'
    | string  // allow future hazard types without breaking compile
  region_id: string
  latitude: number
  longitude: number
  forecast_horizon?: number
  include_contributing_factors?: boolean
  model_version?: string
  /** Real observed values that override the feature store defaults (e.g. river_level, rainfall_24h) */
  feature_overrides?: Record<string, number>
}

interface PredictionResponse {
  model_version: string
  hazard_type: string
  region_id: string
  probability: number
  risk_level: string
  confidence: number
  predicted_peak_time?: string
  geo_polygon?: any
  contributing_factors?: Array<{
    factor: string
    value: number
    importance: number
    unit?: string
  }>
  generated_at?: string
  expires_at?: string
  data_sources?: string[]
  warnings?: string[]
}

interface ModelStatus {
  model_name: string
  model_version: string
  status: string
  total_predictions: number
  average_latency_ms?: number
  drift_detected: boolean
}

interface HazardTypeInfo {
  hazard_type: string
  enabled: boolean
  models_available: string[]
  supported_regions: string[]
  forecast_horizons: number[]
}

class AIClient {
  private modelStatusCache: { data: any; timestamp: number } | null = null
  private readonly CACHE_TTL = 60000 // 1 minute

  private buildUrl(path: string): string {
    const base = AI_ENGINE_URL.endsWith('/') ? AI_ENGINE_URL.slice(0, -1) : AI_ENGINE_URL
    const normalized = path.startsWith('/') ? path : `/${path}`
    return `${base}${normalized}`
  }

  private async request<T>(path: string, init?: RequestInit, timeoutMs = AI_ENGINE_TIMEOUT): Promise<T> {
    const url = this.buildUrl(path)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const method = (init?.method || 'GET').toUpperCase()
      devLog(`[AI] → ${method} ${path}`)

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AEGIS-Node-Backend/1.0',
          ...(init?.headers || {})
        }
      })

      devLog(`[AI] ← ${response.status} ${path}`)

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const detail = body?.detail || body?.error || `AI request failed: ${response.status}`
        throw new Error(detail)
      }

      return await response.json() as T
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('AI prediction timed out. Please try again.')
      }
      if (error?.message?.includes('fetch')) {
        throw new Error('AI Engine is not available. Please try again later.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Check if AI Engine is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.request('/health', undefined, 5000)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Generate hazard prediction
   */
  async predict(request: PredictionRequest): Promise<PredictionResponse> {
    try {
      const response = await this.request<PredictionResponse>('/api/predict', {
        method: 'POST',
        body: JSON.stringify(request)
      })

      return {
        ...response,
        generated_at: response.generated_at || new Date().toISOString()
      }
    } catch (error: any) {
      throw new Error(error?.message || 'AI prediction failed')
    }
  }

  /**
   * Get model status (with caching)
   */
  async getModelStatus(skipCache = false): Promise<any> {
    const now = Date.now()

    // Return cached data if available and fresh
    if (!skipCache && this.modelStatusCache) {
      const age = now - this.modelStatusCache.timestamp
      if (age < this.CACHE_TTL) {
        devLog('[AI] Using cached model status')
        return this.modelStatusCache.data
      }
    }

    try {
      const response = await this.request<any>('/api/model-status')
      this.modelStatusCache = {
        data: response,
        timestamp: now
      }
      return response
    } catch (error: any) {
      console.error('[AI] Failed to get model status:', error.message)
      throw error
    }
  }

  /**
   * Get supported hazard types
   */
  async getHazardTypes(): Promise<HazardTypeInfo[]> {
    try {
      return await this.request<HazardTypeInfo[]>('/api/hazard-types')
    } catch (error: any) {
      console.error('[AI] Failed to get hazard types:', error.message)
      throw error
    }
  }

  /**
   * Trigger model retraining (admin only)
   */
  async triggerRetrain(
    hazardType: string,
    regionId: string
  ): Promise<{ job_id: string; status: string; message: string }> {
    try {
      return await this.request<{ job_id: string; status: string; message: string }>('/api/retrain', {
        method: 'POST',
        body: JSON.stringify({
        hazard_type: hazardType,
        region_id: regionId
      })
      })
    } catch (error: any) {
      console.error('[AI] Failed to trigger retrain:', error.message)
      throw error
    }
  }

  /**
   * Get AI Engine health status
   */
  async getHealth(): Promise<{
    status: string
    timestamp: string
    service: string
    version: string
  }> {
    try {
      return await this.request('/health')
    } catch (error: any) {
      throw new Error(`AI Engine health check failed: ${error.message}`)
    }
  }

  /**
   * Classify disaster report into hazard type
   */
  async classifyReport(text: string, description = '', location = ''): Promise<any> {
    try {
      return await this.request('/api/classify-report', {
        method: 'POST',
        body: JSON.stringify({ text, description, location })
      })
    } catch (error: any) {
      throw new Error(`Report classification failed: ${error.message}`)
    }
  }

  /**
   * Predict severity level for a report
   */
  async predictSeverity(params: {
    text: string
    description?: string
    trapped_persons?: number
    affected_area_km2?: number
    population_affected?: number
    hazard_type?: string | null
  }): Promise<any> {
    try {
      return await this.request('/api/predict-severity', {
        method: 'POST',
        body: JSON.stringify(params)
      })
    } catch (error: any) {
      throw new Error(`Severity prediction failed: ${error.message}`)
    }
  }

  /**
   * Detect if a report is fake/spam
   */
  async detectFake(params: {
    text: string
    description?: string
    user_reputation?: number
    image_count?: number
    location_verified?: boolean
    source_type?: string
    submission_frequency?: number
    similar_reports_count?: number
  }): Promise<any> {
    try {
      return await this.request('/api/detect-fake', {
        method: 'POST',
        body: JSON.stringify(params)
      })
    } catch (error: any) {
      throw new Error(`Fake detection failed: ${error.message}`)
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 5: Model Governance
  // ═══════════════════════════════════════════════════════════

  /**
   * List all governed models with active versions
   */
  async listGovernedModels(): Promise<any> {
    return this.request('/api/models')
  }

  /**
   * List all versions for a model
   */
  async listModelVersions(modelName: string, limit = 20): Promise<any> {
    return this.request(`/api/models/${encodeURIComponent(modelName)}/versions?limit=${limit}`)
  }

  /**
   * Roll back a model to previous stable version
   */
  async rollbackModel(
    modelName: string,
    targetVersion?: string
  ): Promise<any> {
    const params = new URLSearchParams({ model_name: modelName })
    if (targetVersion) params.set('target_version', targetVersion)
    return this.request(`/api/models/rollback?${params.toString()}`, { method: 'POST' })
  }

  /**
   * Run drift detection on one or all models
   */
  async checkDrift(modelName?: string, hours = 24): Promise<any> {
    const params = new URLSearchParams({ hours: hours.toString() })
    if (modelName) params.set('model_name', modelName)
    return this.request(`/api/drift/check?${params.toString()}`)
  }

  /**
   * Submit prediction feedback (correct/incorrect/uncertain)
   */
  async submitPredictionFeedback(predictionId: string, feedback: string): Promise<any> {
    const params = new URLSearchParams({ feedback })
    return this.request(`/api/predictions/${predictionId}/feedback?${params.toString()}`, {
      method: 'POST'
    })
  }

  /**
   * Get prediction statistics for monitoring
   */
  async getPredictionStats(modelName?: string, hours = 24): Promise<any> {
    const params = new URLSearchParams({ hours: hours.toString() })
    if (modelName) params.set('model_name', modelName)
    return this.request(`/api/predictions/stats?${params.toString()}`)
  }
}

// Singleton instance
export const aiClient = new AIClient()

// Export types
export type {
  PredictionRequest,
  PredictionResponse,
  ModelStatus,
  HazardTypeInfo
}
