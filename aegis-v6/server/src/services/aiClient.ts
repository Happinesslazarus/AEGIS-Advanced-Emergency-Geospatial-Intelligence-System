/**
 * File: aiClient.ts
 *
 * What this file does:
 * HTTP client for the Python AI Engine (FastAPI, port 8000). Wraps all calls
 * to the AI service with abort-controller timeouts, auth headers, JSON error
 * unwrapping, and graceful 'unavailable' handling. Caches the model-status
 * response for 60 s so the dashboard doesn't pummel the AI engine.
 *
 * How it works:
 * Every method calls the private `request()` helper, which:
 * 1. Builds the full URL from AI_ENGINE_URL env var
 * 2. Sets an AbortController timeout (default 30 s)
 * 3. Attaches X-API-Key + Authorization headers for inter-service auth
 * 4. Parses the JSON error body on failure and re-throws with a clean message
 *
 * How it connects:
 * - Used by server/src/services/floodPredictionService.ts
 * - Used by server/src/services/aiAnalysisPipeline.ts
 * - Used by server/src/routes/aiRoutes.ts (admin model management)
 * - Talks to ai-engine/app/api/endpoints.py over HTTP
 * - AI_ENGINE_URL defaults to http://localhost:8000
 * - AI_ENGINE_API_KEY must match the key configured in the Python service
 *
 * Simple explanation:
 * Sends data to the Python AI prediction engine and brings results back safely.
 * If the AI engine is down, calls here fail with a human-readable error message
 * rather than crashing the whole server.
 */

import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000'
const AI_ENGINE_TIMEOUT = parseInt(process.env.AI_ENGINE_TIMEOUT || '30000', 10) // 30 s default
const AI_ENGINE_API_KEY = process.env.AI_ENGINE_API_KEY || process.env.API_SECRET_KEY || ''

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
  /* Real observed values that override the feature store defaults (e.g. river_level, rainfall_24h) */
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

  private buildAuthHeaders(): Record<string, string> {
    if (!AI_ENGINE_API_KEY) return {}
    return {
      'X-API-Key': AI_ENGINE_API_KEY,
      Authorization: `Bearer ${AI_ENGINE_API_KEY}`,
    }
  }

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
      devLog(`[AI] ? ${method} ${path}`)

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AEGIS-Node-Backend/1.0',
          ...this.buildAuthHeaders(),
          ...(init?.headers || {})
        }
      })

      devLog(`[AI] ? ${response.status} ${path}`)

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

  /** Quick liveness check — uses a 5 s timeout so status endpoints don't block the main flow */
  async isAvailable(): Promise<boolean> {
    try {
      await this.request('/health', undefined, 5000)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Generate a hazard prediction by sending feature data to the AI engine.
   * The engine runs the appropriate ML model (flood, fire, storm, etc.) and returns
   * probability, confidence, contributing factors, and optional GeoJSON polygon.
   */
  async predict(request: PredictionRequest): Promise<PredictionResponse> {
    try {
      const response = await this.request<PredictionResponse>('/api/predict', {
        method: 'POST',
        body: JSON.stringify(request)
      })

      return {
        ...response,
        // Normalise: always have a generated_at timestamp even if the AI engine omitted it
        generated_at: response.generated_at || new Date().toISOString()
      }
    } catch (error: any) {
      throw new Error(error?.message || 'AI prediction failed')
    }
  }

  /**
   * Get model status for all loaded models (with 1-minute process-level cache).
   * Pass skipCache=true when you need fresh data (e.g. after triggering a retrain).
   */
  async getModelStatus(skipCache = false): Promise<any> {
    const now = Date.now()

    // Serve from cache if fresh enough — avoids a status-poll on every chat message
    if (!skipCache && this.modelStatusCache) {
      const age = now - this.modelStatusCache.timestamp
      if (age < this.CACHE_TTL) {
        devLog('[AI] Using cached model status')
        return this.modelStatusCache.data
      }
    }

    try {
      const response = await this.request<any>('/api/model-status')
      this.modelStatusCache = { data: response, timestamp: now }
      return response
    } catch (error: any) {
      logger.error({ err: error }, '[AI] Failed to get model status')
      throw error
    }
  }

   /*
   * Get supported hazard types
    */
  async getHazardTypes(): Promise<HazardTypeInfo[]> {
    try {
      return await this.request<HazardTypeInfo[]>('/api/hazard-types')
    } catch (error: any) {
      logger.error({ err: error }, '[AI] Failed to get hazard types')
      throw error
    }
  }

   /*
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
      logger.error({ err: error }, '[AI] Failed to trigger retrain')
      throw error
    }
  }

   /*
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

   /*
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
   * Classify a disaster image using the CLIP vision model.
   * Must send as multipart/form-data because the Python endpoint expects a file upload.
   * We build the multipart body manually here to avoid pulling in the `form-data` npm package.
   */
  async classifyImage(imageBuffer: Buffer, filename = 'image.jpg'): Promise<{
    hazard_type: string
    disaster_type: string
    probability: number
    risk_level: string
    confidence: number
    probabilities: Record<string, number>
    processing_time_ms: number
    model_version: string
    error?: string
  }> {
    const url = this.buildUrl('/api/classify-image')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    try {
      // Build multipart/form-data body manually (avoids adding a new npm dependency)
      const boundary = '----AEGISBoundary' + Date.now()
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      const footer = `\r\n--${boundary}--\r\n`

      const headerBuf = Buffer.from(header)
      const footerBuf = Buffer.from(footer)
      const body = Buffer.concat([headerBuf, imageBuffer, footerBuf])

      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'User-Agent': 'AEGIS-Node-Backend/1.0',
          ...this.buildAuthHeaders(),
        },
        body,
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => null)
        throw new Error(errBody?.detail || `CLIP classify failed: ${response.status}`)
      }

      return await response.json()
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('CLIP image classification timed out')
      }
      throw new Error(`CLIP image classification failed: ${error.message}`)
    } finally {
      clearTimeout(timeout)
    }
  }

   /*
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

   /*
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

  //  Phase 5: Model Governance

   /*
   * List all governed models with active versions
    */
  async listGovernedModels(): Promise<any> {
    return this.request('/api/models')
  }

   /*
   * List all versions for a model
    */
  async listModelVersions(modelName: string, limit = 20): Promise<any> {
    return this.request(`/api/models/${encodeURIComponent(modelName)}/versions?limit=${limit}`)
  }

   /*
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

   /*
   * Run drift detection on one or all models
    */
  async checkDrift(modelName?: string, hours = 24): Promise<any> {
    const params = new URLSearchParams({ hours: hours.toString() })
    if (modelName) params.set('model_name', modelName)
    return this.request(`/api/drift/check?${params.toString()}`)
  }

   /*
   * Submit prediction feedback (correct/incorrect/uncertain)
    */
  async submitPredictionFeedback(predictionId: string, feedback: string): Promise<any> {
    const params = new URLSearchParams({ feedback })
    return this.request(`/api/predictions/${predictionId}/feedback?${params.toString()}`, {
      method: 'POST'
    })
  }

   /*
   * Get prediction statistics for monitoring
    */
  async getPredictionStats(modelName?: string, hours = 24): Promise<any> {
    const params = new URLSearchParams({ hours: hours.toString() })
    if (modelName) params.set('model_name', modelName)
    return this.request(`/api/predictions/stats?${params.toString()}`)
  }

  //  Model Lifecycle Management

  //  Model Registry — version lifecycle management
  // These methods map 1-to-1 with registry endpoints in the Python AI engine.
  // Using encodeURIComponent to handle hazard types like 'severe_storm' safely in URL paths.

  async listRegistryVersions(hazardType: string, regionId: string): Promise<any> {
    return this.request(`/api/registry/versions/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}`)
  }

  async promoteRegistryModel(hazardType: string, regionId: string, version: string): Promise<any> {
    return this.request(
      `/api/registry/promote/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}/${encodeURIComponent(version)}`,
      { method: 'POST' }
    )
  }

  async demoteRegistryModel(hazardType: string, regionId: string): Promise<any> {
    return this.request(
      `/api/registry/demote/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}`,
      { method: 'POST' }
    )
  }

  async validateRegistryModel(hazardType: string, regionId: string, version: string): Promise<any> {
    return this.request(
      `/api/registry/validate/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}/${encodeURIComponent(version)}`
    )
  }

  async cleanupRegistryVersions(hazardType: string, regionId: string, keep = 3, dryRun = false): Promise<any> {
    const params = new URLSearchParams({ keep: keep.toString(), dry_run: dryRun.toString() })
    return this.request(
      `/api/registry/cleanup/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}?${params.toString()}`,
      { method: 'POST' }
    )
  }

  async cleanupAllRegistry(keep = 3, dryRun = true): Promise<any> {
    const params = new URLSearchParams({ keep: keep.toString(), dry_run: dryRun.toString() })
    return this.request(`/api/registry/cleanup-all?${params.toString()}`, { method: 'POST' })
  }

  async getRegistryHealth(hazardType: string, regionId: string): Promise<any> {
    return this.request(`/api/registry/health/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}`)
  }

  async getAllRegistryHealth(): Promise<any> {
    return this.request('/api/registry/health')
  }

  async getRegistryDrift(hazardType: string, regionId: string, version: string): Promise<any> {
    return this.request(
      `/api/registry/drift/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}/${encodeURIComponent(version)}`
    )
  }

  async markRegistryDegraded(hazardType: string, regionId: string, version: string, driftScore: number, reason = 'manual_mark_degraded'): Promise<any> {
    return this.request(
      `/api/registry/mark-degraded/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}/${encodeURIComponent(version)}`,
      {
        method: 'POST',
        body: JSON.stringify({ drift_score: driftScore, reason }),
      }
    )
  }

  async recommendRegistryRollback(hazardType: string, regionId: string): Promise<any> {
    return this.request(`/api/registry/recommend-rollback/${encodeURIComponent(hazardType)}/${encodeURIComponent(regionId)}`)
  }
}

// Singleton — all callers import this one shared instance so they share the model status cache
export const aiClient = new AIClient()

// Export types
export type {
  PredictionRequest,
  PredictionResponse,
  ModelStatus,
  HazardTypeInfo
}

