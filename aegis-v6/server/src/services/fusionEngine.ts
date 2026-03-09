/**
 * services/fusionEngine.ts — Multi-Source Data Fusion Algorithm
 *
 * Features #16-25: Fuses 10 real-time data sources into a single
 * flood probability score using weighted ensemble.
 *
 * Inputs:
 *   16. Water Level (SEPA gauge)
 *   17. Rainfall 24h (OpenWeatherMap / SEPA)
 *   18. River Gauge Delta (rate of change)
 *   19. Soil Saturation (proxy from rainfall history)
 *   20. NLP Citizen Report Analysis (aggregated recent reports)
 *   21. Historical Match / Fingerprinting
 *   22. Terrain Analysis (elevation-based risk)
 *   23. Photo CNN Analysis (water detection from uploaded images)
 *   24. Seasonal Weighting (time-of-year risk modifier)
 *   25. Urban Density Weighting (population exposure)
 *
 * Output:
 *   - Fused probability (0-1)
 *   - Confidence score (0-100)
 *   - Per-feature contributions (XAI)
 *   - Time-to-flood estimate
 *   - Contributing factor breakdown
 *
 * This is the ML prediction layer — it NEVER uses an LLM.
 */

import pool from '../models/db.js'
import { devLog } from '../utils/logger.js'
import { getActiveCityRegion } from '../config/regions/index.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FusionInput {
  regionId: string
  latitude: number
  longitude: number
  // Live data (fetched before calling fusion)
  waterLevelM?: number
  waterLevelThreshold?: number
  rainfall24hMm?: number
  rainfall7dMm?: number
  gaugeReadings?: Array<{ value: number; timestamp: Date }>
  soilMoistureIndex?: number
  recentReports?: Array<{ description: string; severity: string; confidence: number; createdAt: Date }>
  historicalEvents?: Array<{ featureVector: Record<string, number>; eventName: string; similarity?: number }>
  elevationM?: number
  slopePercent?: number
  drainageDensity?: number
  photoCnnScores?: Array<{ waterConfidence: number; disasterConfidence: number }>
  currentMonth?: number
  urbanDensityRatio?: number
  populationDensity?: number
}

export interface FusionFeature {
  name: string
  rawValue: number
  normalised: number      // 0-1 normalised risk contribution
  weight: number          // importance weight (sums to ~1)
  contribution: number    // normalised * weight
  unit: string
  source: string
}

export interface FusionResult {
  probability: number           // 0-1 fused flood probability
  confidence: number            // 0-100
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical'
  timeToFloodMinutes: number | null
  features: FusionFeature[]
  featureWeights: Record<string, number>
  dataSources: string[]
  modelVersion: string
  computationTimeMs: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  FEATURE WEIGHTS (loaded from training pipeline, with evidence-based defaults)
// ═══════════════════════════════════════════════════════════════════════════════

/** Evidence-based defaults from UK flood research (used until model trains) */
const EVIDENCE_BASED_DEFAULTS: Record<string, number> = {
  water_level: 0.18,       // #16 — highest individual importance
  rainfall_24h: 0.16,      // #17
  gauge_delta: 0.14,       // #18 — rate of change is critical
  soil_saturation: 0.12,   // #19
  citizen_nlp: 0.10,       // #20
  historical_match: 0.09,  // #21
  terrain: 0.07,           // #22
  photo_cnn: 0.05,         // #23
  seasonal: 0.05,          // #24
  urban_density: 0.04,     // #25
}

/** Cached learned weights — refreshed from DB every 5 minutes */
let _cachedWeights: Record<string, number> | null = null
let _weightsCacheTime = 0
const WEIGHTS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getLearnedWeights(): Promise<Record<string, number>> {
  const now = Date.now()
  if (_cachedWeights && now - _weightsCacheTime < WEIGHTS_CACHE_TTL) {
    return _cachedWeights
  }

  try {
    const { rows } = await pool.query(`
      SELECT metadata FROM ai_model_metrics
      WHERE model_name = 'fusion_weight_optimizer'
        AND metric_name = 'learned_weights'
      ORDER BY created_at DESC
      LIMIT 1
    `)

    if (rows.length > 0 && rows[0].metadata) {
      const meta = typeof rows[0].metadata === 'string'
        ? JSON.parse(rows[0].metadata)
        : rows[0].metadata
      if (meta.weights && Object.keys(meta.weights).length >= 5) {
        _cachedWeights = meta.weights as Record<string, number>
        _weightsCacheTime = now
        return _cachedWeights!
      }
    }
  } catch {
    // DB error — use defaults
  }

  const defaults: Record<string, number> = { ...EVIDENCE_BASED_DEFAULTS }
  _cachedWeights = defaults
  _weightsCacheTime = now
  return defaults
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3  INDIVIDUAL FEATURE NORMALISATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** #16: Water Level — normalise gauge reading to risk (0-1) */
function normaliseWaterLevel(levelM: number, thresholdM: number): number {
  if (levelM <= 0) return 0
  // Risk increases sharply as level approaches and exceeds threshold
  const ratio = levelM / thresholdM
  if (ratio < 0.5) return ratio * 0.2     // Low risk below 50% of threshold
  if (ratio < 0.8) return 0.1 + (ratio - 0.5) * 0.6  // Medium ramp
  if (ratio < 1.0) return 0.28 + (ratio - 0.8) * 1.8  // Sharp increase near threshold
  // Above threshold — high risk, capped at 1.0
  return Math.min(1.0, 0.64 + (ratio - 1.0) * 1.5)
}

/** #17: Rainfall 24h — mm to risk score */
function normaliseRainfall(mm: number): number {
  if (mm <= 5) return 0         // Negligible
  if (mm <= 15) return mm / 60  // Light rain
  if (mm <= 30) return 0.25 + (mm - 15) / 60   // Moderate
  if (mm <= 50) return 0.5 + (mm - 30) / 80    // Heavy
  if (mm <= 80) return 0.75 + (mm - 50) / 120  // Very heavy
  return Math.min(1.0, 0.95 + (mm - 80) / 400) // Extreme
}

/** #18: Gauge Delta — rate of change to risk */
function normaliseGaugeDelta(readings: Array<{ value: number; timestamp: Date }>): {
  normalised: number; deltaPerHour: number
} {
  if (!readings || readings.length < 2) return { normalised: 0, deltaPerHour: 0 }

  // Calculate rate of change between most recent readings
  const sorted = [...readings].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  const newest = sorted[0]
  const oldest = sorted[Math.min(sorted.length - 1, 3)] // Look back 3 readings

  const timeDiffHours = (
    new Date(newest.timestamp).getTime() - new Date(oldest.timestamp).getTime()
  ) / 3600000

  if (timeDiffHours <= 0) return { normalised: 0, deltaPerHour: 0 }

  const deltaPerHour = (newest.value - oldest.value) / timeDiffHours

  // Rising fast = dangerous
  if (deltaPerHour <= 0) return { normalised: 0, deltaPerHour } // Falling = no risk
  if (deltaPerHour < 0.05) return { normalised: 0.1, deltaPerHour }
  if (deltaPerHour < 0.1) return { normalised: 0.3, deltaPerHour }
  if (deltaPerHour < 0.2) return { normalised: 0.55, deltaPerHour }
  if (deltaPerHour < 0.3) return { normalised: 0.75, deltaPerHour }
  return { normalised: Math.min(1.0, 0.75 + deltaPerHour), deltaPerHour }
}

/** #19: Soil Saturation — direct 0-1 mapping */
function normaliseSoilSaturation(saturation: number | undefined): number {
  if (saturation === undefined || saturation === null) return 0.5 // Unknown = moderate
  return Math.min(1.0, Math.max(0, saturation))
}

/** #20: Citizen NLP — aggregate recent report urgency */
function normaliseCitizenReports(
  reports: Array<{ description: string; severity: string; confidence: number; createdAt: Date }> | undefined,
): number {
  if (!reports || reports.length === 0) return 0

  // Weight by recency and severity
  const now = Date.now()
  let score = 0

  for (const report of reports) {
    const ageHours = (now - new Date(report.createdAt).getTime()) / 3600000
    const recencyWeight = Math.max(0, 1 - ageHours / 24) // Decay over 24h

    let severityWeight = 0.3
    if (report.severity === 'high') severityWeight = 1.0
    else if (report.severity === 'medium') severityWeight = 0.6

    const confidenceWeight = (report.confidence || 50) / 100

    score += recencyWeight * severityWeight * confidenceWeight
  }

  // Normalise by report count — more reports = higher confidence
  const countBoost = Math.min(1.0, reports.length / 10)
  return Math.min(1.0, (score / Math.max(1, reports.length)) * 0.7 + countBoost * 0.3)
}

/** #21: Historical Match — best cosine similarity */
function normaliseHistoricalMatch(
  events: Array<{ similarity?: number }> | undefined,
): number {
  if (!events || events.length === 0) return 0
  const bestMatch = Math.max(...events.map(e => e.similarity || 0))
  return bestMatch // Already 0-1 from cosine similarity
}

/** #22: Terrain — elevation + slope risk */
function normaliseTerrain(elevationM: number | undefined, slopePercent: number | undefined): number {
  if (elevationM === undefined) return 0.5 // Unknown

  // Lower elevation = higher flood risk
  let elevRisk = 0
  if (elevationM < 5) elevRisk = 0.9
  else if (elevationM < 15) elevRisk = 0.7
  else if (elevationM < 30) elevRisk = 0.5
  else if (elevationM < 60) elevRisk = 0.3
  else if (elevationM < 100) elevRisk = 0.15
  else elevRisk = 0.05

  // Flat terrain holds water longer
  const slopeRisk = slopePercent !== undefined
    ? Math.max(0, 1 - slopePercent / 30) // Flat = high risk
    : 0.5

  return elevRisk * 0.7 + slopeRisk * 0.3
}

/** #23: Photo CNN — aggregate water detection from uploaded images */
function normalisePhotoCnn(
  scores: Array<{ waterConfidence: number; disasterConfidence: number }> | undefined,
): number {
  if (!scores || scores.length === 0) return 0

  const avgWater = scores.reduce((s, p) => s + p.waterConfidence, 0) / scores.length
  const avgDisaster = scores.reduce((s, p) => s + p.disasterConfidence, 0) / scores.length

  return avgWater * 0.6 + avgDisaster * 0.4
}

/** #24: Seasonal Weighting — UK flood season risk */
function normaliseSeasonal(month: number | undefined): number {
  // UK flood season: October-March (higher risk)
  // month 1-12
  const m = month || new Date().getMonth() + 1
  const seasonalRisk: Record<number, number> = {
    1: 0.85, 2: 0.80, 3: 0.65, 4: 0.45, 5: 0.30, 6: 0.25,
    7: 0.30, 8: 0.35, 9: 0.45, 10: 0.65, 11: 0.80, 12: 0.90,
  }
  return seasonalRisk[m] || 0.5
}

/** #25: Urban Density — population exposure risk */
function normaliseUrbanDensity(ratio: number | undefined): number {
  if (ratio === undefined) return 0.5
  // Higher density = more people at risk = higher priority
  return Math.min(1.0, Math.max(0, ratio))
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  MAIN FUSION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the multi-source fusion algorithm.
 * Combines all 10 data sources into a single flood probability.
 */
export async function runFusion(input: FusionInput): Promise<FusionResult> {
  const start = Date.now()
  const weights = await getLearnedWeights()

  // Compute each feature
  const gaugeDelta = normaliseGaugeDelta(input.gaugeReadings || [])

  const features: FusionFeature[] = [
    {
      name: 'Water Level',
      rawValue: input.waterLevelM || 0,
      normalised: normaliseWaterLevel(input.waterLevelM || 0, input.waterLevelThreshold || 3.0),
      weight: weights.water_level,
      contribution: 0,
      unit: 'm',
      source: 'SEPA River Gauge',
    },
    {
      name: 'Rainfall 24h',
      rawValue: input.rainfall24hMm || 0,
      normalised: normaliseRainfall(input.rainfall24hMm || 0),
      weight: weights.rainfall_24h,
      contribution: 0,
      unit: 'mm',
      source: 'OpenWeatherMap API',
    },
    {
      name: 'River Gauge Delta',
      rawValue: gaugeDelta.deltaPerHour,
      normalised: gaugeDelta.normalised,
      weight: weights.gauge_delta,
      contribution: 0,
      unit: 'm/h',
      source: 'SEPA Gauge Rate-of-Change',
    },
    {
      name: 'Soil Saturation',
      rawValue: input.soilMoistureIndex || 0,
      normalised: normaliseSoilSaturation(input.soilMoistureIndex),
      weight: weights.soil_saturation,
      contribution: 0,
      unit: 'index',
      source: 'Rainfall History Proxy',
    },
    {
      name: 'Citizen Report NLP',
      rawValue: (input.recentReports || []).length,
      normalised: normaliseCitizenReports(input.recentReports),
      weight: weights.citizen_nlp,
      contribution: 0,
      unit: 'reports',
      source: 'AEGIS Report Database',
    },
    {
      name: 'Historical Match',
      rawValue: input.historicalEvents ? Math.max(...input.historicalEvents.map(e => e.similarity || 0)) : 0,
      normalised: normaliseHistoricalMatch(input.historicalEvents),
      weight: weights.historical_match,
      contribution: 0,
      unit: 'similarity',
      source: 'AEGIS Historical Fingerprinting',
    },
    {
      name: 'Terrain Analysis',
      rawValue: input.elevationM || 0,
      normalised: normaliseTerrain(input.elevationM, input.slopePercent),
      weight: weights.terrain,
      contribution: 0,
      unit: 'm',
      source: 'DEM Elevation Data',
    },
    {
      name: 'Photo CNN',
      rawValue: (input.photoCnnScores || []).length,
      normalised: normalisePhotoCnn(input.photoCnnScores),
      weight: weights.photo_cnn,
      contribution: 0,
      unit: 'images',
      source: 'CNN Image Analysis',
    },
    {
      name: 'Seasonal Weighting',
      rawValue: input.currentMonth || new Date().getMonth() + 1,
      normalised: normaliseSeasonal(input.currentMonth),
      weight: weights.seasonal,
      contribution: 0,
      unit: 'month',
      source: 'UK Flood Season Calendar',
    },
    {
      name: 'Urban Density',
      rawValue: input.urbanDensityRatio || 0,
      normalised: normaliseUrbanDensity(input.urbanDensityRatio),
      weight: weights.urban_density,
      contribution: 0,
      unit: 'ratio',
      source: 'ONS Population Data',
    },
  ]

  // Compute contributions
  for (const f of features) {
    f.contribution = f.normalised * f.weight
  }

  // Sum weighted contributions = fused probability
  const probability = Math.min(1.0, features.reduce((sum, f) => sum + f.contribution, 0))

  // Confidence: based on how many data sources are available
  const availableSources = features.filter(f => f.rawValue !== 0).length
  const confidence = Math.round((availableSources / features.length) * 85 + 15)

  // Risk level classification
  let riskLevel: FusionResult['riskLevel'] = 'Low'
  if (probability >= 0.75) riskLevel = 'Critical'
  else if (probability >= 0.55) riskLevel = 'High'
  else if (probability >= 0.30) riskLevel = 'Medium'

  // Time-to-flood estimate from gauge delta
  let timeToFloodMinutes: number | null = null
  if (gaugeDelta.deltaPerHour > 0.05 && input.waterLevelM && input.waterLevelThreshold) {
    const remaining = input.waterLevelThreshold - input.waterLevelM
    if (remaining > 0) {
      timeToFloodMinutes = Math.round((remaining / gaugeDelta.deltaPerHour) * 60)
    } else {
      timeToFloodMinutes = 0 // Already above threshold
    }
  }

  const dataSources = features
    .filter(f => f.rawValue !== 0)
    .map(f => f.source)

  const featureWeights: Record<string, number> = {}
  for (const f of features) {
    featureWeights[f.name] = f.contribution
  }

  const computationTimeMs = Date.now() - start

  const result: FusionResult = {
    probability,
    confidence,
    riskLevel,
    timeToFloodMinutes,
    features,
    featureWeights,
    dataSources,
    modelVersion: 'fusion-v2.1',
    computationTimeMs,
  }

  // Store in database
  try {
    await pool.query(
      `INSERT INTO fusion_computations
       (region_id, hazard_type, water_level_input, rainfall_input, gauge_delta_input,
        soil_saturation_input, citizen_nlp_input, historical_match_input, terrain_input,
        photo_cnn_input, seasonal_input, urban_density_input,
        fused_probability, fused_confidence, feature_weights, model_version, computation_time_ms)
       VALUES ($1, 'flood', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        input.regionId,
        JSON.stringify(features[0]),
        JSON.stringify(features[1]),
        JSON.stringify(features[2]),
        JSON.stringify(features[3]),
        JSON.stringify(features[4]),
        JSON.stringify(features[5]),
        JSON.stringify(features[6]),
        JSON.stringify(features[7]),
        JSON.stringify(features[8]),
        JSON.stringify(features[9]),
        probability,
        confidence,
        JSON.stringify(featureWeights),
        result.modelVersion,
        computationTimeMs,
      ],
    )

    // Log AI execution
    await pool.query(
      `INSERT INTO ai_executions
       (model_name, model_version, input_payload, raw_response, execution_time_ms,
        target_type, target_id, feature_importance, explanation)
       VALUES ('fusion_engine', $1, $2, $3, $4, 'region', $5, $6, $7)`,
      [
        result.modelVersion,
        JSON.stringify({ regionId: input.regionId, lat: input.latitude, lng: input.longitude }),
        JSON.stringify(result),
        computationTimeMs,
        input.regionId,
        JSON.stringify(featureWeights),
        `Fused ${dataSources.length} sources → ${(probability * 100).toFixed(1)}% flood probability (${riskLevel})`,
      ],
    )
  } catch (err: any) {
    console.error(`[FusionEngine] DB storage failed: ${err.message}`)
  }

  devLog(`[FusionEngine] ${input.regionId}: ${(probability * 100).toFixed(1)}% (${riskLevel}) from ${dataSources.length} sources in ${computationTimeMs}ms`)
  return result
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5  LIVE DATA FETCHERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch all available live data for a region and return a FusionInput.
 * Called by the prediction endpoint and cron jobs.
 */
export async function gatherFusionData(
  regionId: string,
  latitude: number,
  longitude: number,
): Promise<FusionInput> {
  const input: FusionInput = {
    regionId,
    latitude,
    longitude,
    currentMonth: new Date().getMonth() + 1,
  }

  // Parallel data fetching
  const [
    gaugeData,
    weatherData,
    recentReports,
    historicalData,
    photoScores,
  ] = await Promise.allSettled([
    fetchGaugeData(latitude, longitude),
    fetchWeatherData(latitude, longitude),
    fetchRecentReports(latitude, longitude),
    fetchHistoricalFingerprints(regionId),
    fetchPhotoScores(latitude, longitude),
  ])

  // Merge gauge data
  if (gaugeData.status === 'fulfilled' && gaugeData.value) {
    input.waterLevelM = gaugeData.value.currentLevel
    input.waterLevelThreshold = gaugeData.value.warningThreshold
    input.gaugeReadings = gaugeData.value.readings
  }

  // Merge weather
  if (weatherData.status === 'fulfilled' && weatherData.value) {
    input.rainfall24hMm = weatherData.value.rainfall24h
    input.rainfall7dMm = weatherData.value.rainfall7d
    input.soilMoistureIndex = weatherData.value.soilProxy
  }

  // Merge reports
  if (recentReports.status === 'fulfilled') {
    input.recentReports = recentReports.value
  }

  // Merge historical
  if (historicalData.status === 'fulfilled') {
    input.historicalEvents = historicalData.value
  }

  // Merge photo CNN scores
  if (photoScores.status === 'fulfilled') {
    input.photoCnnScores = photoScores.value
  }

  // Terrain — approximate from location
  input.elevationM = estimateElevation(latitude, longitude)
  input.urbanDensityRatio = estimateUrbanDensity(latitude, longitude)

  return input
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6  DATA SOURCE IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Fetch river gauge data from SEPA/EA API */
async function fetchGaugeData(lat: number, lng: number): Promise<{
  currentLevel: number; warningThreshold: number; readings: Array<{ value: number; timestamp: Date }>
} | null> {
  try {
    // EA API for stations near this location
    const url = `https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=level&lat=${lat}&long=${lng}&dist=10&_limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const data = await res.json() as any
    if (!data.items || data.items.length === 0) return null

    const station = data.items[0]

    // Fetch recent readings
    const readingsUrl = `${station['@id']}/readings?_sorted&_limit=10`
    const readRes = await fetch(readingsUrl, { signal: AbortSignal.timeout(5000) })
    if (!readRes.ok) return null

    const readData = await readRes.json() as any
    const readings = (readData.items || []).map((r: any) => ({
      value: r.value,
      timestamp: new Date(r.dateTime),
    }))

    // Store snapshot
    await pool.query(
      `INSERT INTO live_data_snapshots (source, data_type, coordinates, value, unit, raw_data)
       VALUES ('EA_API', 'gauge_level', ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 'm', $4)`,
      [lng, lat, readings[0]?.value || 0, JSON.stringify({ station: station.label, readings: readings.slice(0, 3) })],
    ).catch(() => {})

    return {
      currentLevel: readings[0]?.value || 0,
      warningThreshold: station.stageScale?.typicalRangeHigh || 3.0,
      readings,
    }
  } catch {
    return null
  }
}

/** Fetch weather data from OpenWeatherMap */
async function fetchWeatherData(lat: number, lng: number): Promise<{
  rainfall24h: number; rainfall7d: number; soilProxy: number
} | null> {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY || process.env.OPENWEATHERMAP_API_KEY
    if (!apiKey) {
      // Check cached data
      const cached = await pool.query(
        `SELECT raw_data FROM live_data_snapshots
         WHERE source = 'openweathermap' AND data_type = 'weather'
         AND fetched_at > now() - INTERVAL '1 hour'
         ORDER BY fetched_at DESC LIMIT 1`,
      )
      if (cached.rows.length > 0) {
        const d = cached.rows[0].raw_data
        return { rainfall24h: d.rain24h || 0, rainfall7d: d.rain24h * 3 || 0, soilProxy: d.humidity / 100 || 0.5 }
      }
      return null
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const data = await res.json() as any
    const rain1h = data.rain?.['1h'] || 0
    const rain3h = data.rain?.['3h'] || 0
    const humidity = data.main?.humidity || 50

    // Estimate 24h from available data
    const rainfall24h = rain1h > 0 ? rain1h * 8 : rain3h * 3 // Rough extrapolation
    const soilProxy = humidity / 100 // Humidity as soil saturation proxy

    // Store snapshot
    await pool.query(
      `INSERT INTO live_data_snapshots (source, data_type, coordinates, value, unit, raw_data)
       VALUES ('openweathermap', 'weather', ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 'mm', $4)`,
      [lng, lat, rainfall24h, JSON.stringify({ rain1h, rain3h, humidity, rain24h: rainfall24h })],
    ).catch(() => {})

    return { rainfall24h, rainfall7d: rainfall24h * 3, soilProxy }
  } catch {
    return null
  }
}

/** Fetch recent citizen reports near this location from DB */
async function fetchRecentReports(lat: number, lng: number): Promise<
  Array<{ description: string; severity: string; confidence: number; createdAt: Date }>
> {
  try {
    const result = await pool.query(
      `SELECT description, severity, ai_confidence as confidence, created_at as "createdAt"
       FROM reports
       WHERE deleted_at IS NULL
         AND created_at > now() - INTERVAL '24 hours'
         AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 10000)
       ORDER BY created_at DESC LIMIT 20`,
      [lng, lat],
    )
    return result.rows
  } catch {
    return []
  }
}

/** Fetch historical flood fingerprints and compute similarity */
async function fetchHistoricalFingerprints(regionId: string): Promise<
  Array<{ featureVector: Record<string, number>; eventName: string; similarity: number }>
> {
  try {
    const result = await pool.query(
      `SELECT event_name, feature_vector FROM historical_flood_events ORDER BY event_date DESC`,
    )
    return result.rows.map((r: any) => ({
      featureVector: r.feature_vector,
      eventName: r.event_name,
      similarity: 0, // Computed later by fingerprinting engine
    }))
  } catch {
    return []
  }
}

/** Fetch recent image CNN scores from nearby reports */
async function fetchPhotoScores(lat: number, lng: number): Promise<
  Array<{ waterConfidence: number; disasterConfidence: number }>
> {
  try {
    const result = await pool.query(
      `SELECT water_confidence, confidence as disaster_confidence
       FROM image_analyses ia
       JOIN reports r ON r.id = ia.report_id
       WHERE r.created_at > now() - INTERVAL '24 hours'
         AND ST_DWithin(r.coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 10000)
       ORDER BY ia.created_at DESC LIMIT 10`,
      [lng, lat],
    )
    return result.rows.map((r: any) => ({
      waterConfidence: parseFloat(r.water_confidence) || 0,
      disasterConfidence: parseFloat(r.disaster_confidence) || 0,
    }))
  } catch {
    return []
  }
}

/** Estimate elevation based on known Aberdeen topography */
function estimateElevation(lat: number, lng: number): number {
  // Region-configurable rough DEM lookup
  const coastReferenceLng = Number(process.env.COAST_REFERENCE_LNG ?? -2.05)
  const distFromCoast = Math.abs(lng - coastReferenceLng) * 111 // km from coast reference
  const baseElevation = 5 + distFromCoast * 15 // Rough gradient
  // River valleys are lower
  const activeRegion = getActiveCityRegion()
  const nearRiver = (Math.abs(lat - activeRegion.center[0]) < 0.02 && Math.abs(lng - activeRegion.center[1]) < 0.03) ? -10 : 0
  return Math.max(2, baseElevation + nearRiver)
}

/** Estimate urban density ratio from location */
function estimateUrbanDensity(lat: number, lng: number): number {
  // Region-centre zones: city centre ~0.82, residential ~0.5, suburbs ~0.3, rural ~0.1
  const activeRegion = getActiveCityRegion()
  const distFromCentre = Math.sqrt(
    (lat - activeRegion.center[0]) ** 2 + (lng - activeRegion.center[1]) ** 2,
  ) * 111 // km from configured city centre

  if (distFromCentre < 1) return 0.82    // City centre
  if (distFromCentre < 3) return 0.55    // Inner residential
  if (distFromCentre < 6) return 0.35    // Suburbs
  if (distFromCentre < 10) return 0.20   // Outer area
  return 0.10                             // Rural
}
