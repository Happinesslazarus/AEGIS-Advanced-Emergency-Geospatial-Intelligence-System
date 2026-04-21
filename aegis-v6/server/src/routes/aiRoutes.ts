/**
 * Proxies AI prediction requests from the frontend to the Python FastAPI
 * engine. Operators can trigger hazard predictions, view model status,
 * and manage AI pipeline configuration. Also exposes model governance
 * endpoints (rollback, drift detection, version promotion) for admins.
 *
 * Route groups:
 * - POST /api/ai/predict         -- run a hazard prediction and persist to DB
 * - GET  /api/ai/predictions     -- historical prediction log with filters
 * - GET  /api/ai/status          -- liveness probe for the AI engine
 * - POST /api/ai/retrain         -- trigger background model retraining
 * - POST /api/ai/classify-image  -- CNN image classification (ViT + DETR)
 * - POST /api/ai/classify-report -- NLP hazard type classification
 * - POST /api/ai/predict-severity-- NLP severity prediction
 * - POST /api/ai/detect-fake     -- fake/spam report detector
 * - GET  /api/ai/models          -- governed model list
 * - POST /api/ai/models/rollback -- model rollback (admin)
 * - GET  /api/ai/drift           -- drift detection report
 * - POST /api/ai/registry/*      -- on-disk model registry management
 *
 * - Mounted at /api/ai in index.ts
 * - Forwards requests to the AI engine via aiClient service
 * - Uses imageAnalysisService for image-based predictions
 * - Operator/admin authenticated endpoints
 * */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import pool from '../models/db.js'
import { adminOnly, authMiddleware, operatorOnly, AuthRequest } from '../middleware/auth.js'
import { aiClient } from '../services/aiClient.js'
import { analyseImage } from '../services/imageAnalysisService.js'
import { devLog } from '../utils/logger.js'
import {
  aiPredictionsTotal,
  aiPredictionLatency,
  aegisModelPredictionsTotal,
  aegisModelAvgConfidence,
  aegisModelDriftScore,
  aegisModelAlertStatus,
  aegisModelDegradedGauge } from '../services/metrics.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'
import { regionRegistry } from '../adapters/regions/index.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()

//Prometheus requires numeric gauge values; map string alert levels to 0-3.
function alertLevelToMetric(alertLevel: string): number {
  const level = String(alertLevel || '').toUpperCase()
  if (level === 'INFO') return 1
  if (level === 'WARNING') return 2
  if (level === 'CRITICAL') return 3
  return 0
}

/*
 * POST /api/ai/predict
 * Generate AI-powered hazard prediction for a location.
 * Stores the prediction in PostgreSQL for audit and historical analysis.
 */
router.post('/predict', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const {
      hazard_type,
      region_id,
      latitude,
      longitude,
      forecast_horizon,
      include_contributing_factors
    } = req.body

    //Validate required fields
    if (
      !hazard_type ||
      !region_id ||
      latitude === undefined ||
      latitude === null ||
      longitude === undefined ||
      longitude === null
    ) {
      throw AppError.badRequest('Please provide all required fields: location coordinates and hazard type.')
    }

    //Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw AppError.badRequest('The coordinates provided are invalid. Latitude must be -90 to 90, longitude -180 to 180.')
    }

    devLog(
      `[AI Prediction] ${hazard_type} for (${latitude}, ${longitude}) in ${region_id}`
    )

    //Call AI Engine
    const predStart = Date.now()
    const prediction = await aiClient.predict({
      hazard_type,
      region_id,
      latitude,
      longitude,
      forecast_horizon: forecast_horizon || 48,
      include_contributing_factors: include_contributing_factors !== false
    })

    //Store prediction in database
    const insertQuery = `
      INSERT INTO ai_predictions (
        hazard_type, region_id, probability, risk_level, confidence,
        predicted_peak_time, input_coordinates, affected_area,
        model_version, prediction_response, contributing_factors,
        predicted_label, predicted_severity, top_shap_contributors,
        input_feature_summary_hash,
        data_sources, requested_by, execution_time_ms, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        ST_SetSRID(ST_MakePoint($7, $8), 4326),
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20
      ) RETURNING id
    `

    //Build WKT polygon string from the GeoJSON if it's valid.
    //Invalid or missing geometry is logged and skipped rather than failing the whole request.
    //PostGIS requires exactly: POLYGON((lng lat, lng lat, ...))
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
      logger.warn({ err: polyErr }, '[AI Predict] Skipping invalid geo_polygon')
    }

    //Extract top 5 SHAP contributors sorted by absolute importance descending.
    //Stored separately from the full prediction payload for fast analytics queries.
    const topShapContributors = (prediction.contributing_factors || [])
      .filter((f: any) => typeof f === 'object' && f !== null)
      .sort((a: any, b: any) => Math.abs(Number(b.importance || 0)) - Math.abs(Number(a.importance || 0)))
      .slice(0, 5)
      .map((f: any) => ({ factor: f.factor || f.name, importance: Number(f.importance || 0), value: f.value }))

    //SHA-256 hash of the full input feature set used as an idempotency/dedup key.
    //Allows the frontend to check whether a cached prediction is still valid
    //for the same coordinates, hazard type, and horizon.
    const inputFeatureSummaryHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        hazard_type,
        region_id,
        latitude,
        longitude,
        forecast_horizon: forecast_horizon || 48,
        include_contributing_factors: include_contributing_factors !== false }))
      .digest('hex')

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
      prediction.risk_level,
      prediction.risk_level,
      JSON.stringify(topShapContributors),
      inputFeatureSummaryHash,
      Array.isArray(prediction.data_sources) ? prediction.data_sources.map(String) : [],
      req.user?.id || null,
      null, // execution_time_ms (could calculate from timestamps)
      prediction.expires_at || null
    ])

    devLog(`[AI Prediction] Stored prediction ${result.rows[0].id}`)
    aiPredictionsTotal.inc({ hazard_type })
    aiPredictionLatency.observe({ hazard_type }, (Date.now() - predStart) / 1000)
    aegisModelPredictionsTotal.inc({ hazard: hazard_type, region: region_id, version: prediction.model_version || 'unknown' })

    //Broadcast to connected admin clients via socket.io so dashboards
    //update in real time without a manual refresh.
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
        generated_at: new Date().toISOString() })
    }

    //Return prediction to frontend
    res.json({
      ...prediction,
      prediction_id: result.rows[0].id
    })
}))

/*
 * GET /api/ai/predictions
 * Get historical AI predictions with optional filters
 */
router.get('/predictions', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
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
        predicted_label,
        predicted_severity,
        confidence,
        predicted_peak_time,
        model_version,
        top_shap_contributors,
        input_feature_summary_hash,
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
}))

/*
 * GET /api/ai/status
 * Get AI Engine and model status
 */
router.get('/status', asyncRoute(async (_req: Request, res: Response) => {
    //Check AI Engine availability
    const isAvailable = await aiClient.isAvailable()

    if (!isAvailable) {
      res.json({
        status: 'unavailable',
        message: 'AI Engine is not reachable',
        models_loaded: 0
      })
      return
    }

    //Get model status
    const modelStatus = await aiClient.getModelStatus()

    res.json({
      status: modelStatus?.status || 'operational',
      ai_engine_available: true,
      ...modelStatus
    })
}))

/*
 * GET /api/ai/hazard-types
 * Get supported hazard types
 */
router.get('/hazard-types', asyncRoute(async (_req: Request, res: Response) => {
    const hazardTypes = await aiClient.getHazardTypes()
    res.json(hazardTypes)
}))

/*
 * POST /api/ai/retrain
 * Trigger model retraining (admin only)
 */
router.post('/retrain', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { hazard_type, region_id } = req.body

    if (!hazard_type) {
      throw AppError.badRequest('Please specify a hazard type (e.g. flood, wildfire, heatwave).')
    }

    const resolvedRegionId = (typeof region_id === 'string' && region_id.trim()) || regionRegistry.getActiveRegion().getMetadata().regionId

    const result = await aiClient.triggerRetrain(hazard_type, resolvedRegionId)

    //Log the retrain request
    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.id,
        `Triggered AI model retraining: ${hazard_type}`,
        'note',
        JSON.stringify({ targetType: 'ai_model', hazard_type, region_id: resolvedRegionId, job_id: result.job_id }),
      ]
    )

    res.json(result)
}))

/*
 * POST /api/ai/classify-image
 * Classify disaster image using CNN (HuggingFace ViT + DETR)
 */
router.post('/classify-image', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { image_path, latitude, longitude, report_id } = req.body

    if (!image_path) {
      throw AppError.badRequest('An image path is required for classification.')
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
      processingTimeMs: result.processingTimeMs })
}))

/*
 * POST /api/ai/classify-report
 * Classify disaster report into hazard type
 */
router.post('/classify-report', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { text, description, location } = req.body

    if (!text) {
      throw AppError.badRequest('Report text is required. Please provide a description.')
    }

    devLog('[AI Classify Report] Analyzing report text')

    const result = await aiClient.classifyReport(text, description || '', location || '')

    res.json(result)
}))

/*
 * POST /api/ai/predict-severity
 * Predict severity level for a report
 */
router.post('/predict-severity', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const {
      text,
      description,
      trapped_persons,
      affected_area_km2,
      population_affected,
      hazard_type
    } = req.body

    if (!text) {
      throw AppError.badRequest('Report text is required. Please provide a description.')
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
}))

/*
 * POST /api/ai/detect-fake
 * Detect if a report is fake/spam
 */
router.post('/detect-fake', authMiddleware, operatorOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
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
      throw AppError.badRequest('Report text is required. Please provide a description.')
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
}))

/*
 * â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-
 *  Phase 5: Model Governance Endpoints
 * â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-â-
 */

/*
 * GET /api/ai/models
 * List all governed models with active versions
 */
router.get('/models', authMiddleware, operatorOnly, asyncRoute(async (_req: Request, res: Response) => {
    const result = await aiClient.listGovernedModels()
    res.json(result)
}))

/*
 * GET /api/ai/models/:modelName/versions
 * List all versions for a specific model
 */
router.get('/models/:modelName/versions', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { modelName } = req.params
    const parsedLimit = parseInt(req.query.limit as string)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20
    const result = await aiClient.listModelVersions(modelName, limit)
    res.json(result)
}))

/*
 * POST /api/ai/models/rollback
 * Roll back a model to its previous stable version (admin only)
 */
router.post('/models/rollback', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { model_name, target_version } = req.body

    if (!model_name) {
      throw AppError.badRequest('A model name is required. Please specify which model to use.')
    }

    devLog(`[AI Rollback] Model: ${model_name}, target: ${target_version || 'previous'}`)

    const result = await aiClient.rollbackModel(model_name, target_version)

    //Log the rollback action
    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.id,
        `Model rollback: ${model_name} â†' ${result.to_version || 'previous'}`,
        'deploy',
        JSON.stringify({ model_name, target_version, result })
      ]
    )

    res.json(result)
}))

/*
 * GET /api/ai/drift
 * Run drift detection on models
 */
router.get('/drift', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const model_name = req.query.model_name as string | undefined
    const parsedHours = parseInt(req.query.hours as string)
    const hours = Number.isFinite(parsedHours) && parsedHours > 0 ? Math.min(parsedHours, 8760) : 24
    const result = await aiClient.checkDrift(model_name, hours)
    res.json(result)
}))

/*
 * POST /api/ai/predictions/:predictionId/feedback
 * Submit feedback for a prediction (correct/incorrect/uncertain)
 */
router.post('/predictions/:predictionId/feedback', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { predictionId } = req.params
    const { feedback } = req.body

    if (!feedback || !['correct', 'incorrect', 'uncertain'].includes(feedback)) {
      throw AppError.badRequest('Invalid feedback value. Please choose one of: correct, incorrect, or uncertain.')
    }

    const result = await aiClient.submitPredictionFeedback(predictionId, feedback)
    res.json(result)
}))

/*
 * GET /api/ai/predictions/stats
 * Get prediction statistics for monitoring
 */
router.get('/predictions/stats', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const model_name = req.query.model_name as string | undefined
    const parsedHours2 = parseInt(req.query.hours as string)
    const hours = Number.isFinite(parsedHours2) && parsedHours2 > 0 ? Math.min(parsedHours2, 8760) : 24
    const result = await aiClient.getPredictionStats(model_name, hours)
    res.json(result)
}))

/*
 * GET /api/ai/governance/models
 * Alias for /api/ai/models â€" governance dashboard entry point
 */
router.get('/governance/models', authMiddleware, operatorOnly, asyncRoute(async (_req: Request, res: Response) => {
    const result = await aiClient.listGovernedModels()
    res.json(result)
}))

/*
 * GET /api/ai/governance/drift
 * Governance-level drift report â€" returns drift status for all models
 */
router.get('/governance/drift', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const parsedHours3 = parseInt(req.query.hours as string)
    const hours = Number.isFinite(parsedHours3) && parsedHours3 > 0 ? Math.min(parsedHours3, 8760) : 24
    const result = await aiClient.checkDrift(undefined, hours)
    //Also pull persisted drift records from DB if available
    const dbDrift = await pool.query(`
      SELECT model_name, metric_name, drift_detected, threshold,
             baseline_value, current_value, created_at
      FROM model_drift_metrics
      WHERE drift_detected = true
      ORDER BY created_at DESC
      LIMIT 20
    `).catch(() => ({ rows: [] }))
    res.json({ ...result, persisted_drift: dbDrift.rows })
}))

/*
 * GET /api/ai/confidence-distribution?model=<name>
 * Returns confidence histogram for a model from prediction_logs
 */
router.get('/confidence-distribution', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const modelName = (req.query.model as string) || null
    const parsedHours4 = parseInt(req.query.hours as string)
    const hours = Number.isFinite(parsedHours4) && parsedHours4 > 0 ? Math.min(parsedHours4, 8760) : 168 // 7 days default

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

    //Fallback: try ai_predictions table if prediction_logs is empty
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
}))

/*
 * GET /api/ai/audit?limit=N&offset=N&model=<name>
 * Returns AI prediction audit log entries
 */
router.get('/audit', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50)
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0)
    const modelName = req.query.model as string | undefined

    const params: any[] = [limit, offset]
    let modelFilter = ''
    if (modelName) {
      params.push(modelName)
      modelFilter = `AND model_name = $${params.length}`
    }

    //Try prediction_logs first (full ML run logs); fall back to ai_predictions
    //if that table is empty (older deployments or test environments).
    const result = await pool.query(`
      SELECT id, model_name, hazard_type, risk_level, confidence,
             execution_time_ms, feedback, created_at
      FROM prediction_logs
      WHERE 1=1 ${modelFilter}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, params).catch(() => ({ rows: [] as any[], rowCount: 0 }))

    if (result.rows.length === 0 && !modelName) {
      //Fall back to ai_predictions
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
}))

/*
 *  Model Lifecycle Management Endpoints
 */

/*
 * GET /api/ai/registry/versions/:hazardType/:regionId
 * List all versions for a hazard+region from on-disk model registry
 */
router.get('/registry/versions/:hazardType/:regionId', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { hazardType, regionId } = req.params
    const result = await aiClient.listRegistryVersions(hazardType, regionId)
    res.json(result)
}))

/*
 * POST /api/ai/registry/promote/:hazardType/:regionId/:version
 * Promote a specific model version as active (admin only)
 */
router.post('/registry/promote/:hazardType/:regionId/:version', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { hazardType, regionId, version } = req.params
    const result = await aiClient.promoteRegistryModel(hazardType, regionId, version)

    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.id,
 `Promoted model: ${hazardType}/${regionId} -> ${version}`,
        'deploy',
        JSON.stringify({ targetType: 'ai_model', hazardType, regionId, version, result }),
      ]
    )

    res.json(result)
}))

/*
 * POST /api/ai/registry/demote/:hazardType/:regionId
 * Remove manual promotion override (admin only)
 */
router.post('/registry/demote/:hazardType/:regionId', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { hazardType, regionId } = req.params
    const result = await aiClient.demoteRegistryModel(hazardType, regionId)

    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.id,
        `Demoted model override: ${hazardType}/${regionId}`,
        'deploy',
        JSON.stringify({ targetType: 'ai_model', hazardType, regionId, result }),
      ]
    )

    res.json(result)
}))

/*
 * GET /api/ai/registry/validate/:hazardType/:regionId/:version
 * Validate integrity of a specific model version
 */
router.get('/registry/validate/:hazardType/:regionId/:version', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { hazardType, regionId, version } = req.params
    const result = await aiClient.validateRegistryModel(hazardType, regionId, version)
    res.json(result)
}))

/*
 * POST /api/ai/registry/cleanup/:hazardType/:regionId
 * Remove old model versions (admin only)
 */
router.post('/registry/cleanup/:hazardType/:regionId', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { hazardType, regionId } = req.params
    const keep = parseInt(req.query.keep as string) || 3
    const dryRun = req.query.dry_run === 'true'
    const result = await aiClient.cleanupRegistryVersions(hazardType, regionId, keep, dryRun)
    res.json(result)
}))

/*
 * POST /api/ai/registry/cleanup-all
 * Run cleanup across all hazard+region combinations (admin only)
 */
router.post('/registry/cleanup-all', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const keep = parseInt(req.query.keep as string) || 3
    const dryRun = req.query.dry_run !== 'false' // default to dry-run for safety -- must explicitly pass dry_run=false to actually delete
    const result = await aiClient.cleanupAllRegistry(keep, dryRun)
    res.json(result)
}))

/*
 * GET /api/ai/registry/health/:hazardType/:regionId
 * Get active model health for a hazard+region
 */
router.get('/registry/health/:hazardType/:regionId', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { hazardType, regionId } = req.params
    const result = await aiClient.getRegistryHealth(hazardType, regionId)

    if (result?.current_version) {
      const labels = {
        hazard: hazardType,
        region: regionId,
        version: result.current_version }
      aegisModelAvgConfidence.set(labels, Number(result.avg_confidence ?? 0))
      aegisModelDriftScore.set(labels, Number(result.drift_score ?? 0))
      aegisModelAlertStatus.set(labels, alertLevelToMetric(result.alert_level || result.health_status || 'HEALTHY'))
    }

    res.json(result)
}))

/*
 * GET /api/ai/registry/health
 * Get active model health for all hazard+region pairs
 */
router.get('/registry/health', authMiddleware, operatorOnly, asyncRoute(async (_req: Request, res: Response) => {
    const result = await aiClient.getAllRegistryHealth()
    for (const item of result?.items || []) {
      if (!item?.current_version) continue
      const labels = {
        hazard: item.hazard_type,
        region: item.region_id,
        version: item.current_version }
      aegisModelDriftScore.set(labels, Number(item.drift_score ?? 0))
      aegisModelAlertStatus.set(labels, alertLevelToMetric(item.health_status || 'HEALTHY'))
    }
    res.json(result)
}))

/*
 * GET /api/ai/registry/drift/:hazardType/:regionId/:version
 * Compute drift snapshot for a model version
 */
router.get('/registry/drift/:hazardType/:regionId/:version', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { hazardType, regionId, version } = req.params
    const result = await aiClient.getRegistryDrift(hazardType, regionId, version)

    const snapshot = result?.snapshot || {}
    if (version) {
      const labels = { hazard: hazardType, region: regionId, version }
      aegisModelAvgConfidence.set(labels, Number(snapshot.avg_confidence ?? 0))
      aegisModelDriftScore.set(labels, Number(snapshot.drift_score ?? 0))
      aegisModelAlertStatus.set(labels, alertLevelToMetric(snapshot.alert_level || 'HEALTHY'))
    }

    res.json(result)
}))

/*
 * POST /api/ai/registry/mark-degraded/:hazardType/:regionId/:version
 * Manually mark model as degraded/rollback_recommended (admin only)
 */
router.post('/registry/mark-degraded/:hazardType/:regionId/:version', authMiddleware, adminOnly, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { hazardType, regionId, version } = req.params
    const driftScore = Number(req.body?.drift_score ?? 0.8)
    const reason = String(req.body?.reason || 'manual_mark_degraded')

    const result = await aiClient.markRegistryDegraded(hazardType, regionId, version, driftScore, reason)
    aegisModelDegradedGauge.set({ hazard: hazardType, region: regionId, version }, 1)
    await pool.query(
      `INSERT INTO activity_log (operator_id, action, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.id,
        `Marked model degraded: ${hazardType}/${regionId}/${version}`,
        'note',
        JSON.stringify({ targetType: 'ai_model', hazardType, regionId, version, driftScore, reason, result }),
      ]
    )

    res.json(result)
}))

/*
 * GET /api/ai/registry/recommend-rollback/:hazardType/:regionId
 * Get deterministic rollback recommendation for active model
 */
router.get('/registry/recommend-rollback/:hazardType/:regionId', authMiddleware, operatorOnly, asyncRoute(async (req: Request, res: Response) => {
    const { hazardType, regionId } = req.params
    const result = await aiClient.recommendRegistryRollback(hazardType, regionId)
    res.json(result)
}))

export default router
