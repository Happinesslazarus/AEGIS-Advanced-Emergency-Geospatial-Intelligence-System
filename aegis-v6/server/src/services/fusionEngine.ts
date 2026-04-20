/**
 * Multi-source data fusion engine — normalises and combines 10 real-time data
 * sources (water level, rainfall, soil moisture, citizen NLP, photos, satellite,
 * etc.) into a single flood probability score with confidence and risk level.
 *
 * - Reads live data from DB, weather APIs (Open-Meteo), and region config
 * - Consumed by floodFingerprinting for pattern matching
 * - Uses evidence-based feature weights for ensemble scoring
 * */

import pool from '../models/db.js'
import { devLog } from '../utils/logger.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { OpenMeteoAdapter } from '../adapters/riverData/OpenMeteoAdapter.js'
import { logger } from './logger.js'


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
  historicalEvents?: Array<{ featureVector: Record<string, number>; eventName: string; similarity?: number; eventDate?: Date }>
  elevationM?: number
  slopePercent?: number
  drainageDensity?: number
  photoCnnScores?: Array<{ waterConfidence: number; disasterConfidence: number }>
  satelliteWaterExtentRatio?: number
  weatherForecastRain6hMm?: number
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


/* Evidence-based defaults from UK flood research (used until model trains) */
const EVIDENCE_BASED_DEFAULTS: Record<string, number> = {
  water_level: 0.18,       // #16 - highest individual importance
  rainfall_24h: 0.16,      // #17
  gauge_delta: 0.14,       // #18 - rate of change is critical
  soil_saturation: 0.12,   // #19
  citizen_nlp: 0.15,       // #20 - real-time human intelligence (increased from 0.10)
  historical_match: 0.09,  // #21
  terrain: 0.07,           // #22
  photo_cnn: 0.05,         // #23
  seasonal: 0.04,          // #24 - reduced from 0.05 (passive signal)
  urban_density: 0.04,     // #25 - reduced from 0.06 (static signal)
}

/* Cached learned weights - refreshed from DB every 5 minutes */
let _cachedWeights: Record<string, number> | null = null
let _weightsCacheTime = 0
const WEIGHTS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type AdaptiveCalibration = {
  multipliers: Record<string, number>
  sampleSize: number
  falseRate: number
  highSeverityRate: number
  avgConfidence: number
}

let _cachedAdaptiveCalibration: AdaptiveCalibration | null = null
let _adaptiveCalibrationCacheTime = 0
const ADAPTIVE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function normaliseWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights)
  const total = entries.reduce((acc, [, value]) => acc + Math.max(0, value), 0)
  if (total <= 0) return { ...EVIDENCE_BASED_DEFAULTS }

  const normalised: Record<string, number> = {}
  for (const [k, v] of entries) {
    normalised[k] = Number((Math.max(0, v) / total).toFixed(5))
  }
  return normalised
}

function applyAdaptiveCalibration(
  baseWeights: Record<string, number>,
  calibration: AdaptiveCalibration,
): Record<string, number> {
  const adjusted: Record<string, number> = {}

  for (const [feature, base] of Object.entries(baseWeights)) {
    const m = calibration.multipliers[feature] ?? 1
    adjusted[feature] = Number((base * m).toFixed(6))
  }

  return normaliseWeights(adjusted)
}

async function getAdaptiveWeightCalibration(): Promise<AdaptiveCalibration> {
  const now = Date.now()
  if (_cachedAdaptiveCalibration && now - _adaptiveCalibrationCacheTime < ADAPTIVE_CACHE_TTL) {
    return _cachedAdaptiveCalibration
  }

  const neutral: AdaptiveCalibration = {
    multipliers: {
      water_level: 1,
      rainfall_24h: 1,
      gauge_delta: 1,
      soil_saturation: 1,
      citizen_nlp: 1,
      historical_match: 1,
      terrain: 1,
      photo_cnn: 1,
      seasonal: 1,
      urban_density: 1,
    },
    sampleSize: 0,
    falseRate: 0,
    highSeverityRate: 0,
    avgConfidence: 0.5,
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'false_report')::int AS false_reports,
         COUNT(*) FILTER (WHERE status IN ('verified', 'resolved', 'urgent'))::int AS trusted_reports,
         AVG(COALESCE(ai_confidence, 50))::float AS avg_conf,
         AVG(CASE WHEN severity IN ('high', 'critical') THEN 1 ELSE 0 END)::float AS high_ratio
       FROM reports
       WHERE created_at > NOW() - INTERVAL '30 days'
         AND deleted_at IS NULL`,
    )

    const row = rows[0] || {}
    const total = Number(row.total || 0)
    if (total < 40) {
      _cachedAdaptiveCalibration = neutral
      _adaptiveCalibrationCacheTime = now
      return neutral
    }

    const falseRate = Math.max(0, Math.min(1, Number(row.false_reports || 0) / total))
    const trustedRate = Math.max(0, Math.min(1, Number(row.trusted_reports || 0) / total))
    const highSeverityRate = Math.max(0, Math.min(1, Number(row.high_ratio || 0)))
    const avgConfidence = Math.max(0, Math.min(1, Number(row.avg_conf || 50) / 100))

    const reliability = Math.max(0.35, Math.min(1.15, 0.6 + trustedRate * 0.45 - falseRate * 0.4))
    const hazardMomentum = Math.max(0.85, Math.min(1.25, 0.92 + highSeverityRate * 0.35))

    const multipliers: Record<string, number> = {
      water_level: hazardMomentum,
      rainfall_24h: hazardMomentum,
      gauge_delta: Number((hazardMomentum + 0.05).toFixed(4)),
      soil_saturation: Number((0.95 + highSeverityRate * 0.2).toFixed(4)),
      citizen_nlp: Number((0.85 + reliability * 0.2).toFixed(4)),
      historical_match: Number((0.95 + trustedRate * 0.15).toFixed(4)),
      terrain: 1,
      photo_cnn: Number((0.95 + (1 - falseRate) * 0.2).toFixed(4)),
      seasonal: 1,
      urban_density: Number((0.94 + highSeverityRate * 0.12).toFixed(4)),
    }

    // Widen bounds to allow meaningful learning (was 0.75-1.3, too tight)
    for (const [k, v] of Object.entries(multipliers)) {
      multipliers[k] = Math.max(0.5, Math.min(1.8, v))
    }

    const calibration: AdaptiveCalibration = {
      multipliers,
      sampleSize: total,
      falseRate: Number(falseRate.toFixed(4)),
      highSeverityRate: Number(highSeverityRate.toFixed(4)),
      avgConfidence: Number(avgConfidence.toFixed(4)),
    }

    _cachedAdaptiveCalibration = calibration
    _adaptiveCalibrationCacheTime = now

    // Persist calibration snapshot for governance/audit visibility.
    await pool.query(
      `INSERT INTO ai_model_metrics
        (model_name, model_version, metric_name, metric_value, dataset_size, metadata)
       VALUES ('fusion_weight_optimizer', 'adaptive-v1', 'online_calibration', $1, $2, $3)`,
      [reliability, total, JSON.stringify(calibration)],
    ).catch(() => {})

    return calibration
  } catch {
    _cachedAdaptiveCalibration = neutral
    _adaptiveCalibrationCacheTime = now
    return neutral
  }
}

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
        const adaptive = await getAdaptiveWeightCalibration()
        const calibrated = applyAdaptiveCalibration(meta.weights as Record<string, number>, adaptive)
        _cachedWeights = calibrated
        _weightsCacheTime = now
        return _cachedWeights!
      }
    }
  } catch {
    // DB error - use defaults
  }

  const defaults: Record<string, number> = { ...EVIDENCE_BASED_DEFAULTS }
  const adaptive = await getAdaptiveWeightCalibration()
  _cachedWeights = applyAdaptiveCalibration(defaults, adaptive)
  _weightsCacheTime = now
  return _cachedWeights
}


/* #16: Water Level - normalise gauge reading to risk (0-1) */
function normaliseWaterLevel(levelM: number, thresholdM: number): number {
  // Hydrological risk mapping: risk increases non-linearly as level approaches threshold
  // Based on flood frequency analysis where threshold = ~Q10 event level
  const ratio = levelM / thresholdM
  if (ratio < 0.3) return 0                              // Well below normal range
  if (ratio < 0.6) return (ratio - 0.3) * 0.167          // Low risk zone (0 ? 0.05)
  if (ratio < 0.8) return 0.05 + (ratio - 0.6) * 0.75    // Moderate (0.05 ? 0.20)
  if (ratio < 0.95) return 0.20 + (ratio - 0.8) * 2.0    // Elevated (0.20 ? 0.50)
  if (ratio < 1.0) return 0.50 + (ratio - 0.95) * 6.0    // High - sharp ramp near threshold (0.50 ? 0.80)
  // Above threshold: rapid convergence to 1.0
  return Math.min(1.0, 0.80 + (ratio - 1.0) * 2.0)       // (0.80 ? 1.0)
}

/* #17: Rainfall 24h - mm to risk score */
function normaliseRainfall(mm: number): number {
  // UK rainfall return periods (approximate, England/Wales averages):
  // Daily totals: 10mm = common, 25mm = notable, 50mm = Q5, 80mm = Q10, 120mm = Q50, 150mm+ = Q100
  // Risk mapping based on exceedance probability
  if (mm <= 2) return 0                                     // Trace rainfall
  if (mm <= 10) return mm / 100                             // Common (0 ? 0.10)
  if (mm <= 25) return 0.10 + (mm - 10) * 0.01             // Notable (0.10 ? 0.25)
  if (mm <= 50) return 0.25 + (mm - 25) * 0.012            // Significant (0.25 ? 0.55)
  if (mm <= 80) return 0.55 + (mm - 50) * 0.01             // Q5-Q10 event (0.55 ? 0.85)
  if (mm <= 120) return 0.85 + (mm - 80) * 0.003           // Q10-Q50 (0.85 ? 0.97)
  return Math.min(1.0, 0.97 + (mm - 120) * 0.001)          // Extreme (? 1.0)
}

function blendRainfallWithNowcast(mm24h: number, forecast6h: number | undefined): number {
  if (!forecast6h || forecast6h <= 0) return mm24h
  // Amplify near-term nowcast risk without double counting full 24h totals.
  return Number((mm24h + Math.min(40, forecast6h * 0.65)).toFixed(2))
}

/* #18: Gauge Delta - rate of change to risk */
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

/* #19: Soil Saturation - direct 0-1 mapping */
function normaliseSoilSaturation(
  saturation: number | undefined | null,
  satelliteExtentRatio?: number,
): number {
  if (saturation === undefined || saturation === null) {
    // Unknown soil saturation - estimate from seasonal baseline
    // UK average soil moisture: ~0.6 in winter, ~0.3 in summer
    const month = new Date().getMonth() // 0-11
    const seasonalBaseline = month >= 3 && month <= 8 ? 0.3 : 0.55  // Summer vs winter
    return Math.min(1.0, seasonalBaseline + (satelliteExtentRatio || 0) * 0.3)
  }
  const base = Math.min(1.0, Math.max(0, saturation))
  const satBoost = satelliteExtentRatio !== undefined
    ? Math.min(0.2, Math.max(0, satelliteExtentRatio) * 0.25)
    : 0
  return Math.min(1.0, Number((base + satBoost).toFixed(3)))
}

/* #20: Citizen NLP - aggregate recent report urgency */
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

  // Normalise by report count - more reports = higher confidence
  const countBoost = Math.min(1.0, reports.length / 10)
  return Math.min(1.0, (score / Math.max(1, reports.length)) * 0.7 + countBoost * 0.3)
}

/* #21: Historical Match - best cosine similarity with recency decay */
function normaliseHistoricalMatch(
  events: Array<{ featureVector?: any; eventName?: string; similarity?: number; eventDate?: Date }> | undefined,
): number {
  if (!events || events.length === 0) return 0
  // Find best match with recency weighting
  let bestScore = 0
  for (const event of events) {
    const baseSimilarity = event.similarity || 0
    // Decay by age: recent events (< 5 years) get full weight, older events decay
    let recencyFactor = 1.0
    if (event.eventDate) {
      const yearsAgo = (Date.now() - new Date(event.eventDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      recencyFactor = Math.max(0.2, 1.0 - yearsAgo * 0.05)  // Lose 5% per year, floor at 20%
    }
    bestScore = Math.max(bestScore, baseSimilarity * recencyFactor)
  }
  return Math.min(1.0, bestScore)
}

/* #22: Terrain - elevation + slope risk */
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

/* #23: Photo CNN - aggregate water detection from uploaded images */
function normalisePhotoCnn(
  scores: Array<{ waterConfidence: number; disasterConfidence: number }> | undefined,
  satelliteExtentRatio?: number,
): number {
  if (!scores || scores.length === 0) return 0

  const avgWater = scores.reduce((s, p) => s + p.waterConfidence, 0) / scores.length
  const avgDisaster = scores.reduce((s, p) => s + p.disasterConfidence, 0) / scores.length

  const base = avgWater * 0.6 + avgDisaster * 0.4
  if (satelliteExtentRatio === undefined) return base
  return Math.min(1.0, Number((base * 0.75 + satelliteExtentRatio * 0.25).toFixed(3)))
}

/* #24: Seasonal Weighting - UK flood season risk */
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

/* #25: Urban Density - population exposure risk */
function normaliseUrbanDensity(ratio: number | undefined): number {
  if (ratio === undefined) return 0.5
  // Higher density = more people at risk = higher priority
  return Math.min(1.0, Math.max(0, ratio))
}


 /*
 * Run the multi-source fusion algorithm.
 * Combines all 10 data sources into a single flood probability.
  */
export async function runFusion(input: FusionInput): Promise<FusionResult> {
  const start = Date.now()
  const weights = await getLearnedWeights()
  const blendedRainfall = blendRainfallWithNowcast(input.rainfall24hMm || 0, input.weatherForecastRain6hMm)

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
      rawValue: blendedRainfall,
      normalised: normaliseRainfall(blendedRainfall),
      weight: weights.rainfall_24h,
      contribution: 0,
      unit: 'mm',
      source: 'Open-Meteo weather + 6h nowcast',
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
      normalised: normaliseSoilSaturation(input.soilMoistureIndex, input.satelliteWaterExtentRatio),
      weight: weights.soil_saturation,
      contribution: 0,
      unit: 'index',
      source: 'Rainfall Proxy + Satellite Flood Extent',
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
      normalised: normalisePhotoCnn(input.photoCnnScores, input.satelliteWaterExtentRatio),
      weight: weights.photo_cnn,
      contribution: 0,
      unit: 'images',
      source: 'CNN Image Analysis + Satellite Context',
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
        `Fused ${dataSources.length} sources ? ${(probability * 100).toFixed(1)}% flood probability (${riskLevel})`,
      ],
    )
  } catch (err: any) {
    logger.error({ err }, '[FusionEngine] DB storage failed')
  }

  devLog(`[FusionEngine] ${input.regionId}: ${(probability * 100).toFixed(1)}% (${riskLevel}) from ${dataSources.length} sources in ${computationTimeMs}ms`)
  return result
}


 /*
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
    weatherNowcast,
    recentReports,
    historicalData,
    photoScores,
    satelliteSignal,
  ] = await Promise.allSettled([
    fetchGaugeData(latitude, longitude),
    fetchWeatherData(latitude, longitude),
    fetchWeatherNowcast(latitude, longitude),
    fetchRecentReports(latitude, longitude),
    fetchHistoricalFingerprints(regionId),
    fetchPhotoScores(latitude, longitude),
    fetchSatelliteFloodSignal(latitude, longitude),
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

  if (weatherNowcast.status === 'fulfilled' && weatherNowcast.value !== null) {
    input.weatherForecastRain6hMm = weatherNowcast.value
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

  if (satelliteSignal.status === 'fulfilled' && satelliteSignal.value !== null) {
    input.satelliteWaterExtentRatio = satelliteSignal.value
  }

  // Terrain - approximate from location
  input.elevationM = estimateElevation(latitude, longitude)
  input.urbanDensityRatio = estimateUrbanDensity(latitude, longitude)

  return input
}


/* Fetch river gauge data from SEPA/EA API */
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
    try {
      const adapter = new OpenMeteoAdapter()
      const stationId = `${lat},${lng}`
      const [current, history] = await Promise.all([
        adapter.fetchCurrentLevel(stationId),
        adapter.fetchHistory(stationId, 48),
      ])

      if (!current) return null

      const readings = (history?.readings || [])
        .slice(-10)
        .map((reading) => ({
          value: Number(reading.levelMetres || 0),
          timestamp: new Date(reading.timestamp),
        }))

      if (!readings.length) {
        readings.push({
          value: Number(current.levelMetres || 0),
          timestamp: new Date(current.timestamp),
        })
      }

      await pool.query(
        `INSERT INTO live_data_snapshots (source, data_type, coordinates, value, unit, raw_data)
         VALUES ('OPEN_METEO_FLOOD', 'gauge_level', ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 'm', $4)`,
        [lng, lat, current.levelMetres || 0, JSON.stringify({ flowCumecs: current.flowCumecs, readings: readings.slice(-3) })],
      ).catch(() => {})

      return {
        currentLevel: Number(current.levelMetres || 0),
        warningThreshold: Math.max(1.5, Number(((current.levelMetres || 0) * 1.25).toFixed(2))),
        readings,
      }
    } catch {
      return null
    }
  }
}

/* Fetch weather data, preferring no-signup Open-Meteo and augmenting with OpenWeather when available. */
async function fetchWeatherData(lat: number, lng: number): Promise<{
  rainfall24h: number; rainfall7d: number; soilProxy: number
} | null> {
  try {
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,relative_humidity_2m,soil_moisture_0_to_1cm&current=relative_humidity_2m&past_days=2&forecast_days=1&timezone=UTC`
    const openMeteoRes = await fetch(openMeteoUrl, { signal: AbortSignal.timeout(5000) })
    if (openMeteoRes.ok) {
      const data = await openMeteoRes.json() as any
      const precipitation = Array.isArray(data?.hourly?.precipitation) ? data.hourly.precipitation : []
      const humiditySeries = Array.isArray(data?.hourly?.relative_humidity_2m) ? data.hourly.relative_humidity_2m : []
      const soilSeries = Array.isArray(data?.hourly?.soil_moisture_0_to_1cm) ? data.hourly.soil_moisture_0_to_1cm : []

      const rainfall24h = Number(
        precipitation.slice(-24).reduce((sum: number, value: any) => sum + (Number(value) || 0), 0).toFixed(2),
      )
      const rainfall7d = Number(
        Math.max(
          rainfall24h,
          precipitation.slice(-72).reduce((sum: number, value: any) => sum + (Number(value) || 0), 0),
        ).toFixed(2),
      )
      const humidity = Number(data?.current?.relative_humidity_2m ?? humiditySeries.at(-1) ?? 50)
      const soilRaw = Number(soilSeries.at(-1))
      const soilProxy = Number.isFinite(soilRaw)
        ? Math.max(0, Math.min(1, soilRaw))
        : Math.max(0, Math.min(1, humidity / 100))

      await pool.query(
        `INSERT INTO live_data_snapshots (source, data_type, coordinates, value, unit, raw_data)
         VALUES ('open_meteo', 'weather', ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 'mm', $4)`,
        [lng, lat, rainfall24h, JSON.stringify({ rain24h: rainfall24h, rain72h: rainfall7d, humidity, soilProxy })],
      ).catch(() => {})

      return { rainfall24h, rainfall7d, soilProxy }
    }

    const apiKey = process.env.OPENWEATHER_API_KEY || process.env.OPENWEATHERMAP_API_KEY
    if (!apiKey) {
      const cached = await pool.query(
        `SELECT raw_data FROM live_data_snapshots
         WHERE source IN ('open_meteo', 'openweathermap') AND data_type = 'weather'
         AND fetched_at > now() - INTERVAL '6 hours'
         ORDER BY fetched_at DESC LIMIT 1`,
      )
      if (cached.rows.length > 0) {
        const d = cached.rows[0].raw_data
        return {
          rainfall24h: d.rain24h || 0,
          rainfall7d: d.rain72h || d.rain24h * 3 || 0,
          soilProxy: d.soilProxy || d.humidity / 100 || 0.5,
        }
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

/* Fetch short-term rainfall forecast (next 6h) from Open-Meteo nowcast. */
async function fetchWeatherNowcast(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation&forecast_days=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const data = await res.json() as any
    const series = Array.isArray(data?.hourly?.precipitation) ? data.hourly.precipitation : []
    if (!series.length) return null

    const sixHour = series.slice(0, 6).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0)
    return Number(Math.max(0, sixHour).toFixed(2))
  } catch {
    return null
  }
}

/* Fetch recent citizen reports near this location from DB */
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

/* Fetch historical flood fingerprints and compute similarity */
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

/* Fetch recent image CNN scores from nearby reports */
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

 /*
 * Estimate flooded-area ratio from satellite proxies.
 * If external satellite endpoint is configured, use it; otherwise derive from local imagery/reports.
  */
async function fetchSatelliteFloodSignal(lat: number, lng: number): Promise<number | null> {
  try {
    const endpoint = process.env.SATELLITE_FLOOD_EXTENT_ENDPOINT
    if (endpoint) {
      const separator = endpoint.includes('?') ? '&' : '?'
      const url = `${endpoint}${separator}lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const payload = await res.json() as any
        const ratio = Number(
          payload?.flooded_ratio
          ?? payload?.extent_ratio
          ?? payload?.water_extent_ratio
          ?? payload?.floodRatio,
        )
        if (Number.isFinite(ratio)) {
          return Math.max(0, Math.min(1, ratio))
        }

        // Support provider payloads that expose water depth/discharge, not direct ratios.
        const depthCm = Number(payload?.surface_water_depth_cm ?? payload?.water_depth_cm)
        if (Number.isFinite(depthCm)) {
          return Math.max(0, Math.min(1, depthCm / 40))
        }
        const discharge = Number(payload?.river_discharge_m3s ?? payload?.discharge)
        if (Number.isFinite(discharge)) {
          return Math.max(0, Math.min(1, discharge / 300))
        }
      }
    }

    // Public no-key hydrology fallback (Open-Meteo Flood API) when no custom endpoint is configured.
    const floodRes = await fetch(
      `https://flood-api.open-meteo.com/v1/flood?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lng))}&hourly=river_discharge&forecast_days=1`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (floodRes.ok) {
      const floodPayload = await floodRes.json() as any
      const values = floodPayload?.hourly?.river_discharge
      if (Array.isArray(values) && values.length > 0) {
        const latest = Number(values[values.length - 1])
        if (Number.isFinite(latest)) {
          return Math.max(0, Math.min(1, latest / 300))
        }
      }
    }

    const proxy = await pool.query(
      `SELECT
         COALESCE(AVG(ia.water_confidence), 0) AS avg_water_conf,
         COUNT(*) FILTER (WHERE r.severity IN ('high', 'critical'))::float AS severe_count,
         COUNT(*)::float AS total_count
       FROM reports r
       LEFT JOIN image_analyses ia ON ia.report_id = r.id
       WHERE r.created_at > now() - INTERVAL '24 hours'
         AND ST_DWithin(r.coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 10000)`,
      [lng, lat],
    )

    const row = proxy.rows[0] || {}
    const avgWater = Number(row.avg_water_conf || 0)
    const severe = Number(row.severe_count || 0)
    const total = Math.max(1, Number(row.total_count || 0))

    const ratio = Math.max(0, Math.min(1, avgWater * 0.65 + (severe / total) * 0.35))
    return Number(ratio.toFixed(3))
  } catch {
    return null
  }
}

/* Estimate elevation based on known Aberdeen topography */
function estimateElevation(lat: number, lng: number): number {
  // Region-configurable rough DEM lookup
  const coastReferenceLng = Number(process.env.COAST_REFERENCE_LNG ?? -2.05)
  const distFromCoast = Math.abs(lng - coastReferenceLng) * 111 // km from coast reference
  const baseElevation = 5 + distFromCoast * 15 // Rough gradient
  // River valleys are lower
  const activeRegion = getActiveCityRegion()
  const nearRiver = (Math.abs(lat - activeRegion.centre.lat) < 0.02 && Math.abs(lng - activeRegion.centre.lng) < 0.03) ? -10 : 0
  return Math.max(2, baseElevation + nearRiver)
}

/* Estimate urban density ratio from location */
function estimateUrbanDensity(lat: number, lng: number): number {
  // Region-centre zones: city centre ~0.82, residential ~0.5, suburbs ~0.3, rural ~0.1
  const activeRegion = getActiveCityRegion()
  const distFromCentre = Math.sqrt(
    (lat - activeRegion.centre.lat) ** 2 + (lng - activeRegion.centre.lng) ** 2,
  ) * 111 // km from configured city centre

  if (distFromCentre < 1) return 0.82    // City centre
  if (distFromCentre < 3) return 0.55    // Inner residential
  if (distFromCentre < 6) return 0.35    // Suburbs
  if (distFromCentre < 10) return 0.20   // Outer area
  return 0.10                             // Rural
}


/**
 * Fuse features using Bayes' theorem.
 * Treats each feature's normalised value as P(evidence_i | flood) and computes
 * the posterior P(flood | all evidence) with a configurable prior (default 5%).
 * Result is clamped to [0, 1].
 */
export function fuseBayesian(features: FusionFeature[], prior = 0.05): number {
  if (features.length === 0) return prior

  // P(flood | evidence) ? P(flood) * ? P(e_i | flood)
  // P(no flood | evidence) ? P(no flood) * ? P(e_i | no flood)
  // Where P(e_i | flood) - feature.normalised, P(e_i | no flood) - 1 - feature.normalised
  let logLikelihoodFlood = Math.log(prior)
  let logLikelihoodNoFlood = Math.log(1 - prior)

  for (const f of features) {
    // Clamp to avoid log(0)
    const pGivenFlood = Math.max(0.01, Math.min(0.99, f.normalised))
    const pGivenNoFlood = Math.max(0.01, Math.min(0.99, 1 - f.normalised))

    logLikelihoodFlood += Math.log(pGivenFlood)
    logLikelihoodNoFlood += Math.log(pGivenNoFlood)
  }

  // Normalise via log-sum-exp for numerical stability
  const maxLog = Math.max(logLikelihoodFlood, logLikelihoodNoFlood)
  const floodExp = Math.exp(logLikelihoodFlood - maxLog)
  const noFloodExp = Math.exp(logLikelihoodNoFlood - maxLog)

  const posterior = floodExp / (floodExp + noFloodExp)
  return Math.max(0, Math.min(1, Number(posterior.toFixed(6))))
}


/**
 * Conservative fusion strategy: return the single highest weighted feature
 * contribution. Any single strong signal triggers high risk.
 */
export function fuseMaxPooling(features: FusionFeature[]): number {
  if (features.length === 0) return 0

  let maxContribution = 0
  for (const f of features) {
    const weightedValue = f.normalised * f.weight
    if (weightedValue > maxContribution) {
      maxContribution = weightedValue
    }
  }

  // Scale to [0, 1] - the max single contribution from a perfectly weighted
  // feature is its weight (when normalised=1). Normalise by the max possible
  // weight so the result spans the full range.
  const maxWeight = Math.max(...features.map(f => f.weight), 0.01)
  return Math.min(1.0, maxContribution / maxWeight)
}


/**
 * Count how many features exceed a threshold and derive a probability from
 * the proportion of "votes" for high risk. Also returns agreement ratio.
 */
export function fuseMajorityVoting(
  features: FusionFeature[],
  threshold = 0.5,
): { probability: number; agreement: number } {
  if (features.length === 0) return { probability: 0, agreement: 0 }

  const countAbove = features.filter(f => f.normalised > threshold).length
  const agreement = countAbove / features.length

  return {
    probability: Number(agreement.toFixed(4)),
    agreement: Number(agreement.toFixed(4)),
  }
}


/**
 * Query recent fusion computations for a region and compute an exponentially
 * weighted moving average, trend direction, and volatility.
 */
export async function fuseTemporalSequence(
  regionId: string,
  latitude: number,
  longitude: number,
  windowHours = 6,
): Promise<{
  smoothedProbability: number
  trend: 'rising' | 'falling' | 'stable'
  trendStrength: number
  volatility: number
}> {
  const defaultResult = { smoothedProbability: 0, trend: 'stable' as const, trendStrength: 0, volatility: 0 }

  try {
    const { rows } = await pool.query(
      `SELECT fused_probability, created_at
       FROM fusion_computations
       WHERE region_id = $1
         AND created_at > NOW() - INTERVAL '${Math.max(1, Math.floor(windowHours))} hours'
       ORDER BY created_at ASC
       LIMIT 50`,
      [regionId],
    )

    if (rows.length === 0) return defaultResult

    const probabilities: number[] = rows.map((r: any) => Number(r.fused_probability) || 0)

    // Exponentially weighted moving average (decay factor alpha)
    const alpha = 2 / (probabilities.length + 1)
    let ewma = probabilities[0]
    for (let i = 1; i < probabilities.length; i++) {
      ewma = alpha * probabilities[i] + (1 - alpha) * ewma
    }
    const smoothedProbability = Number(Math.max(0, Math.min(1, ewma)).toFixed(4))

    // Trend detection from recent slope (last 3+ values)
    let trend: 'rising' | 'falling' | 'stable' = 'stable'
    let trendStrength = 0
    if (probabilities.length >= 3) {
      const recentSlice = probabilities.slice(-Math.min(probabilities.length, 5))
      // Simple linear regression slope
      const n = recentSlice.length
      const xMean = (n - 1) / 2
      const yMean = recentSlice.reduce((s, v) => s + v, 0) / n
      let num = 0
      let den = 0
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (recentSlice[i] - yMean)
        den += (i - xMean) ** 2
      }
      const slope = den !== 0 ? num / den : 0
      trendStrength = Math.min(1.0, Math.abs(slope) * 10) // Scale slope to 0-1

      if (slope > 0.01) trend = 'rising'
      else if (slope < -0.01) trend = 'falling'
    }

    // Volatility = standard deviation of probabilities
    const mean = probabilities.reduce((s, v) => s + v, 0) / probabilities.length
    const variance = probabilities.reduce((s, v) => s + (v - mean) ** 2, 0) / probabilities.length
    const volatility = Number(Math.sqrt(variance).toFixed(4))

    return {
      smoothedProbability,
      trend,
      trendStrength: Number(trendStrength.toFixed(4)),
      volatility,
    }
  } catch (err: any) {
    devLog(`[FusionEngine] Temporal fusion query failed: ${err.message}`)
    return defaultResult
  }
}


/**
 * Compute a 90% confidence interval around the fused probability, accounting
 * for the number of available features, their agreement, and missing data.
 */
export function quantifyUncertainty(
  features: FusionFeature[],
  probability: number,
): {
  lower: number
  upper: number
  confidenceLevel: number
  missingDataPenalty: number
} {
  const totalExpected = 10 // 10 feature sources in the fusion engine
  const available = features.filter(f => f.rawValue !== 0).length
  const missingRatio = 1 - available / totalExpected

  // Missing data penalty: 0 (all present) to 1 (all missing)
  const missingDataPenalty = Number(missingRatio.toFixed(3))

  // Base half-width of confidence band
  // Fewer features = wider band (more uncertainty)
  let halfWidth = 0.08 + missingRatio * 0.20

  // Feature agreement: if features disagree, widen the band
  const normValues = features.filter(f => f.rawValue !== 0).map(f => f.normalised)
  if (normValues.length >= 2) {
    const mean = normValues.reduce((s, v) => s + v, 0) / normValues.length
    const disagreement = Math.sqrt(
      normValues.reduce((s, v) => s + (v - mean) ** 2, 0) / normValues.length,
    )
    halfWidth += disagreement * 0.3
  }

  // Ceiling effect: high probability narrows the upper band
  const upper = Math.min(1.0, probability + halfWidth * (1.0 - probability * 0.5))
  const lower = Math.max(0.0, probability - halfWidth)

  // Confidence level based on data completeness and agreement
  const confidenceLevel = Number(
    Math.max(0, Math.min(1, 1 - missingDataPenalty * 0.5 - halfWidth * 0.5)).toFixed(3),
  )

  return {
    lower: Number(lower.toFixed(4)),
    upper: Number(upper.toFixed(4)),
    confidenceLevel,
    missingDataPenalty,
  }
}


/* Interaction rule definition */
interface InteractionRule {
  featureNames: string[]
  condition: 'both_high' | 'both_low'
  type: 'amplifying' | 'dampening'
  factor: number
}

const INTERACTION_RULES: InteractionRule[] = [
  { featureNames: ['Rainfall 24h', 'Soil Saturation'], condition: 'both_high', type: 'amplifying', factor: 1.3 },
  { featureNames: ['River Gauge Delta', 'Water Level'], condition: 'both_high', type: 'amplifying', factor: 1.25 },
  { featureNames: ['Seasonal Weighting', 'Rainfall 24h'], condition: 'both_high', type: 'amplifying', factor: 1.2 },
  { featureNames: ['Photo CNN', 'Citizen Report NLP'], condition: 'both_low', type: 'dampening', factor: 0.85 },
]

/**
 * Detect multiplicative interactions between features and adjust probability.
 * Returns detected interactions and the adjusted probability (capped at 0.99).
 */
export function detectFeatureInteractions(
  features: FusionFeature[],
  baseProbability?: number,
): {
  interactions: Array<{ features: string[]; type: 'amplifying' | 'dampening'; factor: number }>
  adjustedProbability: number
} {
  const featureMap = new Map<string, FusionFeature>()
  for (const f of features) {
    featureMap.set(f.name, f)
  }

  const probability = baseProbability ?? features.reduce((s, f) => s + f.contribution, 0)
  let adjusted = probability

  const triggered: Array<{ features: string[]; type: 'amplifying' | 'dampening'; factor: number }> = []

  for (const rule of INTERACTION_RULES) {
    const feats = rule.featureNames.map(name => featureMap.get(name))
    if (feats.some(f => !f)) continue // Feature not present

    const normValues = feats.map(f => f!.normalised)

    let conditionMet = false
    if (rule.condition === 'both_high') {
      conditionMet = normValues.every(v => v > 0.6)
    } else if (rule.condition === 'both_low') {
      conditionMet = normValues.every(v => v < 0.25)
    }

    if (conditionMet) {
      adjusted *= rule.factor
      triggered.push({
        features: rule.featureNames,
        type: rule.type,
        factor: rule.factor,
      })
    }
  }

  return {
    interactions: triggered,
    adjustedProbability: Number(Math.max(0, Math.min(0.99, adjusted)).toFixed(4)),
  }
}


/**
 * Weight profiles for non-flood hazard types. Each profile maps feature
 * names to importance weights (summing to ~1). Used to re-weight the fusion
 * engine for different hazard predictions.
 */
export const MULTI_HAZARD_PROFILES: Record<string, Record<string, number>> = {
  wildfire: {
    temperature: 0.25,
    humidity: 0.20,
    wind_speed: 0.20,
    vegetation_dryness: 0.15,
    citizen_reports: 0.10,
    historical: 0.05,
    satellite: 0.05,
  },
  heatwave: {
    temperature: 0.35,
    humidity: 0.15,
    duration: 0.20,
    uv_index: 0.10,
    population_vulnerability: 0.10,
    historical: 0.05,
    forecast: 0.05,
  },
  storm: {
    wind_speed: 0.25,
    pressure: 0.20,
    rainfall: 0.20,
    lightning: 0.10,
    citizen_reports: 0.10,
    forecast: 0.10,
    historical: 0.05,
  },
  landslide: {
    soil_saturation: 0.25,
    rainfall: 0.20,
    slope: 0.20,
    vegetation: 0.10,
    seismic: 0.10,
    historical: 0.10,
    citizen_reports: 0.05,
  },
}

/* Default balanced profile used when a hazard type has no specific profile */
const DEFAULT_HAZARD_PROFILE: Record<string, number> = {
  sensor_primary: 0.20,
  sensor_secondary: 0.15,
  environmental: 0.15,
  citizen_reports: 0.15,
  historical: 0.10,
  forecast: 0.10,
  satellite: 0.10,
  seasonal: 0.05,
}

/**
 * Return the weight profile for a given hazard type.
 * Falls back to a balanced default if the hazard has no specific profile.
 */
export function getMultiHazardProfile(hazardType: string): Record<string, number> {
  const key = hazardType.toLowerCase().replace(/[\s-]+/g, '_')
  return MULTI_HAZARD_PROFILES[key] ?? { ...DEFAULT_HAZARD_PROFILE }
}
