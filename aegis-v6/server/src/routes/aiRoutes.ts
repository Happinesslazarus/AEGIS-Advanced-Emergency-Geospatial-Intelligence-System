/*
 * aiRoutes.ts - AI prediction and model management endpoints
 *
 * These routes integrate with the FastAPI AI Engine and provide
 * prediction capabilities to the frontend.
 */

import { Router, Request, Response } from 'express'
import pool from '../models/db.js'
import { authMiddleware, operatorOnly, AuthRequest } from '../middleware/auth.js'
import { aiClient } from '../services/aiClient.js'
import { analyseImage } from '../services/imageAnalysisService.js'
import { devLog } from '../utils/logger.js'

const router = Router()

/*
 * POST /api/ai/predict
 * Generate AI-powered hazard prediction for a location.
 * Stores the prediction in PostgreSQL for audit and historical analysis.
 */
router.post('/predict', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      hazard_type,
      region_id,
      latitude,
      longitude,
      forecast_horizon,
      include_contributing_factors
    } = req.body

    // Validate required fields
    if (
      !hazard_type ||
      !region_id ||
      latitude === undefined ||
      latitude === null ||
      longitude === undefined ||
      longitude === null
    ) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      res.status(400).json({ error: 'Invalid coordinates' })
      return
    }

    devLog(
      `[AI Prediction] ${hazard_type} for (${latitude}, ${longitude}) in ${region_id}`
    )

    // Call AI Engine
    const prediction = await aiClient.predict({
      hazard_type,
      region_id,
      latitude,
      longitude,
      forecast_horizon: forecast_horizon || 48,
      include_contributing_factors: include_contributing_factors !== false
    })

    // Store prediction in database
    const insertQuery = `
      INSERT INTO ai_predictions (
        hazard_type, region_id, probability, risk_level, confidence,
        predicted_peak_time, input_coordinates, affected_area,
        model_version, prediction_response, contributing_factors,
        data_sources, requested_by, execution_time_ms, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        ST_SetSRID(ST_MakePoint($7, $8), 4326),
        $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING id
    `

    // Safe polygon construction — validate geometry before building WKT (M21)
    let affectedAreaWKT: string | null = null
    try {
      const geo = prediction.geo_polygon
      if (geo?.type === 'Polygon' && Array.isArray(geo?.coordinates?.[0])) {
        const ring: number[][] = geo.coordinates[0]
        if (ring.length >= 3) {
          const wktPoints = ring.map(([lng, lat]: number[]) => {
            if (typeof lng !== 'number' || typeof lat !== 'number' ||
                lng < -180 || lng > 180 || lat < -90 || lat > 90) {
              throw new Error(`Invalid coordinate pair: [${lng}, ${lat}]`)
            }
            return `${lng} ${lat}`
          })
          affectedAreaWKT = `POLYGON((${wktPoints.join(',')}))`
        }
      }
    } catch (polyErr: any) {
      console.warn('[AI Predict] Skipping invalid geo_polygon:', polyErr.message)
    }

    const result = await pool.query(insertQuery, [
      hazard_type,
      region_id,
      prediction.probability,
      prediction.risk_level,
      prediction.confidence,
      prediction.predicted_peak_time || null,
      longitude,
      latitude,
      affectedAreaWKT,
      prediction.model_version,
      JSON.stringify(prediction),
      JSON.stringify(prediction.contributing_factors || []),
      JSON.stringify(prediction.data_sources || []),
      req.user?.id || null,
      null, // execution_time_ms (could calculate from timestamps)
      prediction.expires_at || null
    ])

    devLog(`[AI Prediction] Stored prediction ${result.rows[0].id}`)

    // Broadcast to connected admin clients via socket.io (M18)
    const io = (req as any).app?.get('io')
    if (io) {
      io.to('admins').emit('ai:prediction', {
        prediction_id: result.rows[0].id,
        hazard_type,
        region_id,
        probability: prediction.probability,
        risk_level: prediction.risk_level,
        confidence: prediction.confidence,
        model_version: prediction.model_version,
        generated_at: new Date().toISOString(),
      })
    }

    // Return prediction to frontend
    res.json({
      ...prediction,
      prediction_id: result.rows[0].id
    })
  } catch (err: any) {
    console.error('[AI Prediction] Error:', err.message)
    res.status(500).json({
      error: 'Prediction failed',
      message: err.message
    })
  }
})

/*
 * GET /api/ai/predictions
 * Get historical AI predictions with optional filters
 */
router.get('/predictions', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      hazard_type,
      region_id,
      risk_level,
      limit = '50'
    } = req.query

    let query = `
      SELECT
        id,
        hazard_type,
        region_id,
        probability,
        risk_level,
        confidence,
        predicted_peak_time,
        model_version,
        ST_AsGeoJSON(input_coordinates)::json as location,
        ST_AsGeoJSON(affected_area)::json as affected_area_geojson,
        contributing_factors,
        data_sources,
        generated_at,
        expires_at
      FROM ai_predictions
      WHERE 1=1
    `

    const params: any[] = []
    let idx = 1

    if (hazard_type) {
      query += ` AND hazard_type = $${idx++}`
      params.push(hazard_type)
    }

    if (region_id) {
      query += ` AND region_id = $${idx++}`
      params.push(region_id)
    }

    if (risk_level) {
      query += ` AND risk_level = $${idx++}`
      params.push(risk_level)
    }

    query += ` ORDER BY generated_at DESC LIMIT $${idx}`
    params.push(parseInt(limit as string))

    const result = await pool.query(query, params)

    res.json(result.rows)
  } catch (err: any) {
    console.error('[AI Predictions] Fetch error:', err.message)
    res.status(500).json({ error: 'Failed to fetch predictions' })
  }
})

/*
 * GET /api/ai/status
 * Get AI Engine and model status
 */
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Check AI Engine availability
    const isAvailable = await aiClient.isAvailable()

    if (!isAvailable) {
      res.json({
        status: 'unavailable',
        message: 'AI Engine is not reachable',
        models_loaded: 0
      })
      return
    }

    // Get model status
    const modelStatus = await aiClient.getModelStatus()

    res.json({
      status: 'operational',
      ai_engine_available: true,
      ...modelStatus
    })
  } catch (err: any) {
    console.error('[AI Status] Error:', err.message)
    res.status(500).json({
      status: 'error',
      error: err.message
    })
  }
})

/*
 * GET /api/ai/hazard-types
 * Get supported hazard types
 */
router.get('/hazard-types', async (_req: Request, res: Response): Promise<void> => {
  try {
    const hazardTypes = await aiClient.getHazardTypes()
    res.json(hazardTypes)
  } catch (err: any) {
    console.error('[AI Hazard Types] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch hazard types' })
  }
})

/*
 * POST /api/ai/retrain
 * Trigger model retraining (admin only)
 */
router.post('/retrain', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { hazard_type, region_id } = req.body

    if (!hazard_type || !region_id) {
      res.status(400).json({ error: 'Missing hazard_type or region_id' })
      return
    }

    const result = await aiClient.triggerRetrain(hazard_type, region_id)

    // Log the retrain request
    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, target_type, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user?.id,
        `Triggered AI model retraining: ${hazard_type}`,
        'note',
        'ai_model',
        JSON.stringify({ hazard_type, region_id, job_id: result.job_id })
      ]
    )

    res.json(result)
  } catch (err: any) {
    console.error('[AI Retrain] Error:', err.message)
    res.status(500).json({ error: 'Failed to trigger retraining' })
  }
})

/*
 * POST /api/ai/classify-image
 * Classify disaster image using CNN (HuggingFace ViT + DETR)
 */
router.post('/classify-image', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { image_path, latitude, longitude, report_id } = req.body

    if (!image_path) {
      res.status(400).json({ error: 'image_path is required' })
      return
    }

    devLog(`[AI Classify Image] Analysing: ${image_path}`)

    const result = await analyseImage(
      image_path,
      latitude || null,
      longitude || null,
      report_id || undefined,
    )

    res.json({
      photoValidation: result.photoValidation,
      exifAnalysis: result.exifAnalysis,
      modelUsed: result.modelUsed,
      processingTimeMs: result.processingTimeMs,
    })
  } catch (err: any) {
    console.error('[AI Classify Image] Error:', err.message)
    res.status(500).json({ error: 'Image classification failed', message: err.message })
  }
})

/*
 * POST /api/ai/classify-report
 * Classify disaster report into hazard type
 */
router.post('/classify-report', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { text, description, location } = req.body

    if (!text) {
      res.status(400).json({ error: 'Report text required' })
      return
    }

    devLog('[AI Classify Report] Analyzing report text')

    const result = await aiClient.classifyReport(text, description || '', location || '')

    res.json(result)
  } catch (err: any) {
    console.error('[AI Classify Report] Error:', err.message)
    res.status(500).json({ error: 'Report classification failed' })
  }
})

/*
 * POST /api/ai/predict-severity
 * Predict severity level for a report
 */
router.post('/predict-severity', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      text,
      description,
      trapped_persons,
      affected_area_km2,
      population_affected,
      hazard_type
    } = req.body

    if (!text) {
      res.status(400).json({ error: 'Report text required' })
      return
    }

    devLog('[AI Predict Severity] Analyzing severity')

    const result = await aiClient.predictSeverity({
      text,
      description: description || '',
      trapped_persons: trapped_persons || 0,
      affected_area_km2: affected_area_km2 || 0,
      population_affected: population_affected || 0,
      hazard_type: hazard_type || null
    })

    res.json(result)
  } catch (err: any) {
    console.error('[AI Predict Severity] Error:', err.message)
    res.status(500).json({ error: 'Severity prediction failed' })
  }
})

/*
 * POST /api/ai/detect-fake
 * Detect if a report is fake/spam
 */
router.post('/detect-fake', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      text,
      description,
      user_reputation,
      image_count,
      location_verified,
      source_type,
      submission_frequency,
      similar_reports_count
    } = req.body

    if (!text) {
      res.status(400).json({ error: 'Report text required' })
      return
    }

    devLog('[AI Detect Fake] Analyzing report authenticity')

    const result = await aiClient.detectFake({
      text,
      description: description || '',
      user_reputation: user_reputation ?? 0.5,
      image_count: image_count || 0,
      location_verified: location_verified || false,
      source_type: source_type || 'user_report',
      submission_frequency: submission_frequency || 1,
      similar_reports_count: similar_reports_count || 0
    })

    res.json(result)
  } catch (err: any) {
    console.error('[AI Detect Fake] Error:', err.message)
    res.status(500).json({ error: 'Fake detection failed' })
  }
})

/*
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  Phase 5: Model Governance Endpoints
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

/*
 * GET /api/ai/models
 * List all governed models with active versions
 */
router.get('/models', authMiddleware, operatorOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await aiClient.listGovernedModels()
    res.json(result)
  } catch (err: any) {
    console.error('[AI Models] Error:', err.message)
    res.status(500).json({ error: 'Failed to list models' })
  }
})

/*
 * GET /api/ai/models/:modelName/versions
 * List all versions for a specific model
 */
router.get('/models/:modelName/versions', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const { modelName } = req.params
    const limit = parseInt(req.query.limit as string) || 20
    const result = await aiClient.listModelVersions(modelName, limit)
    res.json(result)
  } catch (err: any) {
    console.error('[AI Model Versions] Error:', err.message)
    res.status(500).json({ error: 'Failed to list model versions' })
  }
})

/*
 * POST /api/ai/models/rollback
 * Roll back a model to its previous stable version (admin only)
 */
router.post('/models/rollback', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required for model rollback' })
      return
    }

    const { model_name, target_version } = req.body

    if (!model_name) {
      res.status(400).json({ error: 'model_name is required' })
      return
    }

    devLog(`[AI Rollback] Model: ${model_name}, target: ${target_version || 'previous'}`)

    const result = await aiClient.rollbackModel(model_name, target_version)

    // Log the rollback action
    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.id,
        `Model rollback: ${model_name} â†’ ${result.to_version || 'previous'}`,
        'deploy',
        JSON.stringify({ model_name, target_version, result })
      ]
    )

    res.json(result)
  } catch (err: any) {
    console.error('[AI Rollback] Error:', err.message)
    res.status(500).json({ error: 'Model rollback failed', message: err.message })
  }
})

/*
 * GET /api/ai/drift
 * Run drift detection on models
 */
router.get('/drift', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const model_name = req.query.model_name as string | undefined
    const hours = parseInt(req.query.hours as string) || 24
    const result = await aiClient.checkDrift(model_name, hours)
    res.json(result)
  } catch (err: any) {
    console.error('[AI Drift] Error:', err.message)
    res.status(500).json({ error: 'Drift check failed' })
  }
})

/*
 * POST /api/ai/predictions/:predictionId/feedback
 * Submit feedback for a prediction (correct/incorrect/uncertain)
 */
router.post('/predictions/:predictionId/feedback', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { predictionId } = req.params
    const { feedback } = req.body

    if (!feedback || !['correct', 'incorrect', 'uncertain'].includes(feedback)) {
      res.status(400).json({ error: 'feedback must be: correct, incorrect, uncertain' })
      return
    }

    const result = await aiClient.submitPredictionFeedback(predictionId, feedback)
    res.json(result)
  } catch (err: any) {
    console.error('[AI Feedback] Error:', err.message)
    res.status(500).json({ error: 'Feedback submission failed' })
  }
})

/*
 * GET /api/ai/predictions/stats
 * Get prediction statistics for monitoring
 */
router.get('/predictions/stats', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const model_name = req.query.model_name as string | undefined
    const hours = parseInt(req.query.hours as string) || 24
    const result = await aiClient.getPredictionStats(model_name, hours)
    res.json(result)
  } catch (err: any) {
    console.error('[AI Prediction Stats] Error:', err.message)
    res.status(500).json({ error: 'Failed to get prediction stats' })
  }
})

/*
 * GET /api/ai/governance/models
 * Alias for /api/ai/models â€” governance dashboard entry point
 */
router.get('/governance/models', authMiddleware, operatorOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await aiClient.listGovernedModels()
    res.json(result)
  } catch (err: any) {
    console.error('[AI Governance Models] Error:', err.message)
    res.status(500).json({ error: 'Failed to list governed models' })
  }
})

/*
 * GET /api/ai/governance/drift
 * Governance-level drift report â€” returns drift status for all models
 */
router.get('/governance/drift', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = parseInt(req.query.hours as string) || 24
    const result = await aiClient.checkDrift(undefined, hours)
    // Also pull persisted drift records from DB if available
    const dbDrift = await pool.query(`
      SELECT model_name, metric_name, drift_detected, threshold,
             baseline_value, current_value, created_at
      FROM model_drift_metrics
      WHERE drift_detected = true
      ORDER BY created_at DESC
      LIMIT 20
    `).catch(() => ({ rows: [] }))
    res.json({ ...result, persisted_drift: dbDrift.rows })
  } catch (err: any) {
    console.error('[AI Governance Drift] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch governance drift data' })
  }
})

/*
 * GET /api/ai/confidence-distribution?model=<name>
 * Returns confidence histogram for a model from prediction_logs
 */
router.get('/confidence-distribution', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const modelName = (req.query.model as string) || null
    const hours = parseInt(req.query.hours as string) || 168 // 7 days default

    const params: any[] = [hours]
    let modelFilter = ''
    if (modelName) {
      params.push(modelName)
      modelFilter = `AND model_name = $${params.length}`
    }

    const result = await pool.query(`
      SELECT
        CASE
          WHEN confidence < 0.5 THEN 'Very Low (<50%)'
          WHEN confidence < 0.65 THEN 'Low (50-65%)'
          WHEN confidence < 0.75 THEN 'Medium (65-75%)'
          WHEN confidence < 0.85 THEN 'High (75-85%)'
          ELSE 'Very High (>85%)'
        END as l,
        COUNT(*)::int as c
      FROM prediction_logs
      WHERE created_at > NOW() - ($1 || ' hours')::interval
        ${modelFilter}
        AND confidence IS NOT NULL
      GROUP BY 1
      ORDER BY MIN(confidence)
    `, params).catch(() => ({ rows: [] }))

    // Fallback: try ai_predictions table if prediction_logs is empty
    if (result.rows.length === 0) {
      const fallback = await pool.query(`
        SELECT
          CASE
            WHEN confidence_score < 0.5 THEN 'Very Low (<50%)'
            WHEN confidence_score < 0.65 THEN 'Low (50-65%)'
            WHEN confidence_score < 0.75 THEN 'Medium (65-75%)'
            WHEN confidence_score < 0.85 THEN 'High (75-85%)'
            ELSE 'Very High (>85%)'
          END as l,
          COUNT(*)::int as c
        FROM ai_predictions
        WHERE created_at > NOW() - ($1 || ' hours')::interval
          AND confidence_score IS NOT NULL
        GROUP BY 1
        ORDER BY MIN(confidence_score)
      `, [hours]).catch(() => ({ rows: [] }))
      res.json(fallback.rows)
      return
    }

    res.json(result.rows)
  } catch (err: any) {
    console.error('[AI Confidence Distribution] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch confidence distribution' })
  }
})

/*
 * GET /api/ai/audit?limit=N&offset=N&model=<name>
 * Returns AI prediction audit log entries
 */
router.get('/audit', authMiddleware, operatorOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50)
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0)
    const modelName = req.query.model as string | undefined

    const params: any[] = [limit, offset]
    let modelFilter = ''
    if (modelName) {
      params.push(modelName)
      modelFilter = `AND model_name = $${params.length}`
    }

    // Try prediction_logs first, fall back to ai_predictions
    const result = await pool.query(`
      SELECT id, model_name, hazard_type, risk_level, confidence,
             execution_time_ms, feedback, created_at
      FROM prediction_logs
      WHERE 1=1 ${modelFilter}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, params).catch(() => ({ rows: [] as any[], rowCount: 0 }))

    if (result.rows.length === 0 && !modelName) {
      // Fall back to ai_predictions
      const fallback = await pool.query(`
        SELECT id, hazard_type, risk_level, confidence_score as confidence,
               model_version, feedback, created_at
        FROM ai_predictions
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]).catch(() => ({ rows: [] as any[], rowCount: 0 }))
      res.json({ entries: fallback.rows, total: fallback.rowCount ?? fallback.rows.length })
      return
    }

    res.json({ entries: result.rows, total: result.rowCount ?? result.rows.length })
  } catch (err: any) {
    console.error('[AI Audit] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch AI audit log' })
  }
})

export default router
