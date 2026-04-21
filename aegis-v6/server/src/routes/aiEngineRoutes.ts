/**
 * AI Prediction Engine endpoints (plug-and-play architecture).
 *
 * Wraps the python AI engine + governance + fusion + fingerprinting +
 * ingestion + training + RAG + resilience + system reporting.
 *
 * Extracted from extendedRoutes.ts (C3).
 */
import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { requireAdmin, requireOperator } from '../middleware/internalAuth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'
import { aiClient } from '../services/aiClient.js'
import { addTrainingLabel, computeRiskHeatmap, estimateDamageCost } from '../services/governanceEngine.js'
import { runFingerprinting } from '../services/floodFingerprinting.js'
import { gatherFusionData, runFusion } from '../services/fusionEngine.js'
import { ensureIngestionSchema, runFullIngestion, ingestEAFloodData, ingestNASAPowerData, ingestOpenMeteoData, ingestUKFloodHistory, ingestWikipediaFloodKnowledge } from '../services/dataIngestionService.js'
import { expandRAGKnowledgeBase, ragRetrieve } from '../services/ragExpansionService.js'
import { trainAllModels, trainFusionWeights } from '../services/mlTrainingPipeline.js'
import { getResilienceStatus } from '../services/resilienceLayer.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'
import pool from '../models/db.js'

const router = Router()

//Maps hazard type + priority to recommended resource counts per deployment zone
function getResourceRecommendation(hazardType: string, priority: 'Critical' | 'High'): { ambulances: number; fire_engines: number; rescue_boats: number } {
  const isCritical = priority === 'Critical'
  const h = (hazardType || '').toLowerCase()

  //Water/coastal - rescue boats are the priority
  if (['flood', 'tsunami', 'coastal', 'flash_flood'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 2 : 1, rescue_boats: isCritical ? 6 : 3 }
  }
  //Wildfire - fire engines dominant
  if (['wildfire', 'fire', 'burn'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 8 : 4, rescue_boats: 0 }
  }
  //Volcanic - hazmat + structural + evacuation mix
  if (['volcanic', 'volcano', 'lava', 'ash'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 5 : 3, fire_engines: isCritical ? 3 : 2, rescue_boats: isCritical ? 1 : 0 }
  }
  //Structural/seismic - heavy search & rescue
  if (['earthquake', 'seismic', 'building_collapse', 'structural', 'landslide', 'avalanche', 'sinkhole', 'debris', 'bridge_damage', 'road_damage'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 6 : 3, fire_engines: isCritical ? 4 : 2, rescue_boats: 0 }
  }
  //Hazmat/chemical/environmental
  if (['chemical', 'gas_leak', 'hazmat', 'pollution', 'contamination', 'environmental_hazard', 'environmental', 'radiation'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 5 : 3, fire_engines: isCritical ? 3 : 2, rescue_boats: 0 }
  }
  //Medical/mass casualty - ambulances are the priority
  if (['medical', 'mass_casualty', 'casualty'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 10 : 5, fire_engines: isCritical ? 2 : 1, rescue_boats: 0 }
  }
  //Storm/wind/tornado/hurricane
  if (['storm', 'tornado', 'hurricane', 'typhoon', 'cyclone', 'severe_storm'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 3 : 2, rescue_boats: isCritical ? 3 : 1 }
  }
  //Extreme weather - heatwave/drought
  if (['heatwave', 'heat', 'drought'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 6 : 3, fire_engines: isCritical ? 2 : 1, rescue_boats: 0 }
  }
  //Infrastructure - power/water/road
  if (['infrastructure', 'power_line', 'power_outage', 'water_main', 'water_supply'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 2 : 1, fire_engines: isCritical ? 2 : 1, rescue_boats: 0 }
  }
  //Public safety - trapped/missing/evacuation
  if (['public_safety', 'person_trapped', 'missing', 'evacuation', 'hazardous_area'].some(k => h.includes(k))) {
    return { ambulances: isCritical ? 4 : 2, fire_engines: isCritical ? 2 : 1, rescue_boats: isCritical ? 1 : 0 }
  }
  //Fallback for unknown hazard types
  return { ambulances: isCritical ? 3 : 2, fire_engines: isCritical ? 2 : 1, rescue_boats: isCritical ? 1 : 0 }
}

// AI PREDICTION ENGINE - Plug & Play Architecture

//POST /api/predictions/run - Runs a hazard prediction via the AI engine
router.post('/predictions/run', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
  try {
    const { area, latitude, longitude, weather_data, historical_indicators, region_id } = req.body
    const startTime = Date.now()

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw AppError.badRequest('latitude and longitude are required numeric fields.')
    }

    const safeLat = Math.max(-90, Math.min(90, latitude))
    const safeLng = Math.max(-180, Math.min(180, longitude))
    const resolvedRegionId = typeof region_id === 'string' && region_id.trim().length > 0
      ? region_id.trim()
      : regionRegistry.getActiveRegion().getMetadata().regionId

    const predictionResponse = await aiClient.predict({
      hazard_type: (req.body.hazard_type as string) || 'flood',
      region_id: resolvedRegionId,
      latitude: safeLat,
      longitude: safeLng,
      include_contributing_factors: true })

    const executionMs = Date.now() - startTime

    //Log AI execution
    await pool.query(
      `INSERT INTO ai_executions (model_name, model_version, input_payload, raw_response, status, execution_time_ms, target_type)
       VALUES ('flood-predictor', $1, $2, $3, 'success', $4, 'prediction')`,
      [predictionResponse.model_version, JSON.stringify({ latitude: safeLat, longitude: safeLng, region_id: resolvedRegionId, weather_data, historical_indicators }),
       JSON.stringify(predictionResponse), executionMs]
    ).catch(() => {})

    //Store prediction record
    //Compute affected_radius_km from probability (0-100% ? 0.5-15 km range)
    const affectedRadiusKm = Math.max(0.5, Math.round(((predictionResponse.probability || 0.1) * 15) * 100) / 100)

    await pool.query(
      `INSERT INTO prediction_records (area_name, risk_level, probability, confidence, predicted_peak_time, affected_radius_km, model_version, raw_response, input_data, coordinates)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326))`,
      [area || 'Queried Area', predictionResponse.risk_level, predictionResponse.probability, predictionResponse.confidence,
       predictionResponse.predicted_peak_time || null, affectedRadiusKm, predictionResponse.model_version,
       JSON.stringify(predictionResponse), JSON.stringify({ latitude: safeLat, longitude: safeLng, region_id: resolvedRegionId }),
       safeLng, safeLat]
    ).catch(() => {})

    const prob = Number(predictionResponse.probability || 0)
    const confidencePct = Number(predictionResponse.confidence || 0)
    const probability01 = prob > 1 ? Math.min(1, prob / 100) : Math.max(0, prob)
    const confidence100 = confidencePct <= 1 ? Math.round(confidencePct * 100) : Math.round(confidencePct)
    const severity: 'critical' | 'high' | 'medium' | 'low' =
      probability01 >= 0.8 ? 'critical' :
      probability01 >= 0.6 ? 'high' :
      probability01 >= 0.35 ? 'medium' : 'low'

    const responseAny = predictionResponse as any

    const fpResult = await pool.query(
      `INSERT INTO flood_predictions
         (area, probability, time_to_flood, matched_pattern, next_areas,
          severity, confidence, data_sources, coordinates, model_version,
          expires_at)
       VALUES
         ($1, $2, $3, $4, $5, $6::report_severity, $7, $8,
          ST_SetSRID(ST_MakePoint($9, $10), 4326), $11,
          NOW() + INTERVAL '6 hours')
       RETURNING id`,
      [
        area || 'Queried Area',
        probability01,
        responseAny.time_to_flood || predictionResponse.predicted_peak_time || (
          probability01 >= 0.7 ? '< 24 hours' :
          probability01 >= 0.5 ? '24-48 hours' :
          probability01 >= 0.3 ? '2-5 days' :
          'No flood expected'
        ),
        responseAny.matched_pattern || 'On-demand model inference',
        Array.isArray(responseAny.next_areas) ? responseAny.next_areas : [],
        severity,
        Math.max(0, Math.min(100, confidence100)),
        Array.isArray(responseAny.data_sources) ? responseAny.data_sources : ['ai-engine'],
        safeLng,
        safeLat,
        predictionResponse.model_version || 'unknown',
      ]
    ).catch(() => null)

    //Module 1: Auto-create draft deployment zone for high-probability predictions (=70%)
    if (fpResult?.rows?.[0]?.id && probability01 >= 0.7) {
      const fpId = fpResult.rows[0].id
      const draftPriority = probability01 >= 0.85 ? 'Critical' : 'High'
      const resolvedHazardType: string = (req.body.hazard_type as string) || 'flood'
      const resources = getResourceRecommendation(resolvedHazardType, draftPriority)
      const draftAiRec = `Auto-created by AI prediction engine. Confidence: ${confidence100}%. ` +
        `${draftPriority} ${resolvedHazardType.replace(/_/g, ' ')} risk detected at ${area || 'Queried Area'}. Awaiting operator review.`
      pool.query(
        `INSERT INTO resource_deployments
           (zone, priority, active_reports, estimated_affected, ai_recommendation,
            ambulances, fire_engines, rescue_boats, coordinates, prediction_id, is_ai_draft)
         SELECT $1, $2, 0, $3, $4, $5, $6, $7,
                ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, true
         WHERE NOT EXISTS (
           SELECT 1 FROM resource_deployments WHERE prediction_id = $10
         )`,
        [
          area || 'Queried Area',
          draftPriority,
          `AI-flagged risk area - ${(probability01 * 100).toFixed(0)}% ${resolvedHazardType.replace(/_/g, ' ')} probability`,
          draftAiRec,
          resources.ambulances,
          resources.fire_engines,
          resources.rescue_boats,
          safeLng, safeLat,
          fpId,
        ]
      ).catch(() => {})
    }

    res.json({ ...predictionResponse, affected_radius_km: affectedRadiusKm, saved_to_feed: true, region_id: resolvedRegionId })
  } catch (err: any) {
    const statusCode = err?.message?.includes('not available') || err?.message?.includes('timed out') ? 503 : 502
    res.status(statusCode).json({ error: err.message || 'Failed to run live prediction.' })
  }
}))

// SPATIAL INTELLIGENCE - GeoJSON endpoints for QGIS + Heatmaps

//GET /api/map/risk-layer - Returns structured GeoJSON risk layer
router.get('/map/risk-layer', asyncRoute(async (_req: Request, res: Response) => {
    const result = await pool.query(
      `SELECT id, name, layer_type, ST_AsGeoJSON(geometry_data) as geojson, properties, model_version, valid_from
       FROM risk_layers WHERE valid_until IS NULL OR valid_until > NOW()
       ORDER BY created_at DESC`
    )
    const features = result.rows.map(r => ({
      type: 'Feature',
      geometry: r.geojson ? JSON.parse(r.geojson) : null,
      properties: { ...r.properties, id: r.id, name: r.name, layer_type: r.layer_type, model_version: r.model_version }
    }))
    res.json({ type: 'FeatureCollection', features })
}))

//GET /api/map/heatmap-data - Returns dynamically computed heatmap intensity data
router.get('/map/heatmap-data', asyncRoute(async (_req: Request, res: Response) => {
    //First try live computation from historical + report data
    const computed = await computeRiskHeatmap()
    if (computed.length > 0) {
      res.json({
        source: 'computed',
        generated_at: new Date().toISOString(),
        intensity_data: computed })
      return
    }

    //Fallback to stored heatmap layers
    const result = await pool.query(
      `SELECT id, name, source, intensity_data, model_version, generated_at
       FROM heatmap_layers ORDER BY generated_at DESC LIMIT 1`
    )
    if (result.rows.length > 0) {
      res.json(result.rows[0])
    } else {
      res.status(404).json({ error: 'No heatmap data available. Historical events needed for computation.' })
    }
}))

//GET /api/ai/status/detail - Returns detailed DB execution analytics
router.get('/ai/status/detail', authMiddleware, requireOperator, asyncRoute(async (_req: AuthRequest, res: Response) => {
    const models = await pool.query(
      `SELECT model_name, MAX(model_version) as version, COUNT(*) as executions,
              AVG(execution_time_ms) as avg_ms, MAX(created_at) as last_run
       FROM ai_executions GROUP BY model_name ORDER BY last_run DESC`
    )
    res.json({
      execution_history: models.rows
    })
}))

//GET /api/ai/drift - MOVED to aiRoutes.ts (Phase 5 Governance)
//Now served by aiRoutes with live AI engine drift detection

//POST /api/ai/labels - Add training label (human-in-the-loop)
router.post('/ai/labels', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { report_id, label_type, label_value, operator_id, confidence } = req.body
    if (!report_id || !label_type || !label_value || !operator_id) {
      throw AppError.badRequest('report_id, label_type, label_value, and operator_id are required')
    }
    await addTrainingLabel(report_id, label_type, label_value, operator_id, confidence)
    res.json({ success: true })
}))

//POST /api/ai/damage-estimate - Economic damage estimation model
router.post('/ai/damage-estimate', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
    const { severity, affected_area_km2, population_density, duration_hours, water_depth_m } = req.body
    const estimate = await estimateDamageCost(
      severity || 'medium',
      affected_area_km2 || 1,
      population_density || 500,
      duration_hours || 12,
      water_depth_m || 0.5,
    )
    res.json(estimate)
}))

// MULTI-SOURCE FUSION ENGINE (Features #16-25)

//POST /api/fusion/run - Run full 10-source fusion analysis (ADMIN ONLY)
router.post('/fusion/run', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
    const { region_id, latitude, longitude } = req.body
    if (!region_id || latitude === undefined || longitude === undefined) {
      throw AppError.badRequest('region_id, latitude, and longitude are required')
    }

    //Gather live data from all sources
    const fusionInput = await gatherFusionData(region_id, latitude, longitude)
    //Run weighted fusion algorithm
    const result = await runFusion(fusionInput)
    res.json(result)
}))

// FLOOD FINGERPRINTING ENGINE (Features #26-27)

//POST /api/fingerprint/run - Run cosine-similarity flood fingerprinting (OPERATOR ONLY)
router.post('/fingerprint/run', requireOperator, asyncRoute(async (req: Request, res: Response) => {
    const { region_id, latitude, longitude, area } = req.body
    if (!region_id || latitude === undefined || longitude === undefined) {
      throw AppError.badRequest('region_id, latitude, and longitude are required')
    }

    const prediction = await runFingerprinting(
      region_id, latitude, longitude, area || 'Unknown Area',
    )
    res.json(prediction)
}))

// DATA INGESTION PIPELINE (ADMIN ONLY)

//POST /api/ingestion/run - Run full data ingestion from all sources (ADMIN ONLY)
router.post('/ingestion/run', requireAdmin, asyncRoute(async (_req: Request, res: Response) => {
    const result = await runFullIngestion()
    res.json(result)
}))

//POST /api/ingestion/source/:source - Run single source ingestion (ADMIN ONLY)
router.post('/ingestion/source/:source', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
    const source = req.params.source
    let result
    switch (source) {
      case 'ea': result = await ingestEAFloodData(200); break
      case 'nasa': result = await ingestNASAPowerData(); break
      case 'openmeteo': result = await ingestOpenMeteoData(); break
      case 'floodhistory': result = await ingestUKFloodHistory(); break
      case 'wikipedia': result = await ingestWikipediaFloodKnowledge(); break
      default:
        throw AppError.badRequest(`Unknown source: ${source}. Valid: ea, nasa, openmeteo, floodhistory, wikipedia`)
    }
    res.json(result)
}))

//GET /api/ingestion/status - Get ingestion history and table counts (OPERATOR ONLY)
router.get('/ingestion/status', authMiddleware, requireOperator, asyncRoute(async (_req: Request, res: Response) => {
    await ensureIngestionSchema()

    const tables = [
      'reports', 'river_gauge_readings', 'climate_observations',
      'weather_observations', 'flood_archives', 'news_articles',
      'wiki_flood_knowledge', 'historical_flood_events',
      'rag_documents', 'ai_model_metrics', 'ingestion_log',
    ]

    const ALLOWED_TABLES = new Set(tables)
    const counts: Record<string, number> = {}
    for (const t of tables) {
      try {
        if (!ALLOWED_TABLES.has(t)) { counts[t] = 0; continue }
        const r = await pool.query(`SELECT COUNT(*) as c FROM ${t}`)
        counts[t] = parseInt(r.rows[0].c) || 0
      } catch { counts[t] = 0 }
    }

    //Recent ingestion logs
    let logs: any[] = []
    try {
      const r = await pool.query(`
        SELECT source, rows_ingested, rows_before, rows_after, duration_ms, errors, created_at
        FROM ingestion_log
        ORDER BY created_at DESC
        LIMIT 20
      `)
      logs = r.rows
    } catch { /* table may not exist */ }

    res.json({ tableCounts: counts, recentIngestions: logs, totalRows: Object.values(counts).reduce((a, b) => a + b, 0) })
}))

// ML TRAINING PIPELINE (ADMIN ONLY)

//POST /api/training/run - Train all ML models (ADMIN ONLY)
router.post('/training/run', requireAdmin, asyncRoute(async (_req: Request, res: Response) => {
    const result = await trainAllModels()
    res.json(result)
}))

//POST /api/training/fusion-weights - Train fusion weight optimizer (ADMIN ONLY)
router.post('/training/fusion-weights', requireAdmin, asyncRoute(async (_req: Request, res: Response) => {
    const result = await trainFusionWeights()
    res.json(result)
}))

// RAG KNOWLEDGE BASE (ADMIN ONLY)

//POST /api/rag/expand - Expand RAG knowledge base (ADMIN ONLY)
router.post('/rag/expand', requireAdmin, asyncRoute(async (_req: Request, res: Response) => {
    const result = await expandRAGKnowledgeBase()
    res.json(result)
}))

//POST /api/rag/query - Query RAG knowledge base (OPERATOR ONLY)
router.post('/rag/query', authMiddleware, requireOperator, asyncRoute(async (req: Request, res: Response) => {
    const { query, limit } = req.body
    if (!query) { res.status(400).json({ error: 'query is required' }); return }
    const safeLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 50)
    const results = await ragRetrieve(query, safeLimit)
    res.json({ query, results, count: results.length })
}))

// RESILIENCE MONITORING (OPERATOR ONLY)

//GET /api/resilience/status - Get cache, rate limit, circuit breaker status (OPERATOR ONLY)
router.get('/resilience/status', requireOperator, asyncRoute(async (_req: Request, res: Response) => {
    res.json(getResilienceStatus())
}))

// SYSTEM REPORT (OPERATOR ONLY)

//GET /api/system/report - Generate comprehensive system status report (OPERATOR ONLY)
router.get('/system/report', requireOperator, asyncRoute(async (_req: Request, res: Response) => {
    //Table row counts
    const tables = [
      'reports', 'river_gauge_readings', 'climate_observations',
      'weather_observations', 'flood_archives', 'news_articles',
      'wiki_flood_knowledge', 'historical_flood_events', 'rag_documents',
      'ai_model_metrics', 'ai_executions', 'fusion_computations',
      'flood_predictions', 'image_analyses', 'reporter_scores',
    ]
    const ALLOWED_TABLES = new Set(tables)
    const tableCounts: Record<string, number> = {}
    for (const t of tables) {
      try {
        if (!ALLOWED_TABLES.has(t)) { tableCounts[t] = 0; continue }
        const r = await pool.query(`SELECT COUNT(*) as c FROM ${t}`)
        tableCounts[t] = parseInt(r.rows[0].c) || 0
      } catch { tableCounts[t] = 0 }
    }

    //Model metrics
    let modelMetrics: any[] = []
    try {
      const r = await pool.query(`
        SELECT DISTINCT ON (model_name) model_name, model_version, metric_name, metric_value,
               dataset_size, metadata, created_at
        FROM ai_model_metrics
        ORDER BY model_name, created_at DESC
      `)
      modelMetrics = r.rows
    } catch { /* ignore */ }

    //API key status
    const apiKeys = {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GROQ_API_KEY: !!process.env.GROQ_API_KEY,
      HF_API_KEY: !!process.env.HF_API_KEY,
      WEATHER_API_KEY: !!(process.env.WEATHER_API_KEY || process.env.OPENWEATHERMAP_API_KEY),
      NEWSAPI_KEY: !!process.env.NEWSAPI_KEY,
      DATABASE_URL: !!process.env.DATABASE_URL }

    //Resilience status
    const resilience = getResilienceStatus()

    //Recent ingestion
    let lastIngestion: any = null
    try {
      const r = await pool.query(`SELECT id, status, source, records_processed, errors, created_at FROM ingestion_log ORDER BY created_at DESC LIMIT 1`)
      lastIngestion = r.rows[0] || null
    } catch { /* ignore */ }

    const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0)

    res.json({
      system: 'AEGIS v6 - Hybrid AI Disaster Intelligence Platform',
      version: '6.0.0-production',
      generatedAt: new Date().toISOString(),
      database: {
        totalRows,
        tableCounts },
      models: modelMetrics,
      apiKeys,
      resilience,
      lastIngestion,
      capabilities: {
        llmProviders: ['Gemini Flash', 'Groq Llama 3.1', 'OpenRouter', 'HuggingFace'],
        mlModels: ['flood_classifier', 'fake_detector', 'severity_predictor', 'damage_regression', 'fusion_engine'],
        dataSources: ['UK EA', 'SEPA KiWIS', 'NASA POWER', 'Open-Meteo', 'NewsAPI', 'Wikipedia', 'UK Gov Archives'],
        features: 37 } })
}))


export default router
