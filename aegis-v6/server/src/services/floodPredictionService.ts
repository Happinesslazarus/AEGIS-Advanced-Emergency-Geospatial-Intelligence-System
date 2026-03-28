 /*
 * services/floodPredictionService.ts — Predictive flood model
 * Takes current river levels from riverLevelService, fetches rainfall
 * forecast from OpenWeatherMap (or Open-Meteo fallback), and calculates
 * predicted river levels at 1h, 2h, 4h, 6h using linear extrapolation
 * weighted by rainfall rate.
 * Selects the appropriate GeoJSON polygon for each predicted level and
 * returns confidence percentage based on data source agreement.
  */

import { getCurrentLevels } from './riverLevelService.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'
import { aiClient } from './aiClient.js'
import pool from '../models/db.js'
import fs from 'fs'
import path from 'path'
import { logger } from './logger.js'

// Types

interface PredictedLevel {
  hours: number
  level: number
  status: string
  extent: any | null
  confidence: number
}

export interface FloodPrediction {
  regionId: string
  riverName: string
  stationId: string
  currentLevel: number
  status: string
  predictions: PredictedLevel[]
  affectedAreas: string[]
  estimatedProperties: number
  estimatedPeople: number
  rainfallForecastMm: number
  calculatedAt: string
}

// Rainfall Forecast

async function fetchRainfallForecast(lat: number, lng: number): Promise<number> {
  // Try OpenWeatherMap first
  const owmKey = process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY
  if (owmKey) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${owmKey}&units=metric&cnt=8`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        const data = await res.json()
        const totalRain = (data.list || []).reduce((sum: number, item: any) => {
          return sum + (item.rain?.['3h'] || 0)
        }, 0)
        return totalRain
      }
    } catch (err: any) {
      logger.warn({ err, lat, lng }, '[FloodPrediction] OpenWeather fetch failed')
      // Fall through to Open-Meteo
    }
  }

  // Fallback: Open-Meteo (free, no API key)
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation&forecast_hours=6`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const data = await res.json()
      const precip: number[] = data?.hourly?.precipitation || []
      return precip.reduce((sum, v) => sum + (v || 0), 0)
    }
  } catch (err: any) {
    logger.warn({ err, lat, lng }, '[FloodPrediction] Open-Meteo fallback failed')
    // Return conservative estimate
  }

  return 0
}

// Flood Extent GeoJSON Loading

const extentCache = new Map<string, any>()

function loadFloodExtent(riverName: string): any[] | null {
  const region = getActiveCityRegion()
  const filename = region.floodExtentFiles?.[riverName]
  if (!filename) return null

  if (extentCache.has(filename)) return extentCache.get(filename)

  try {
    const filePath = path.join(process.cwd(), 'src', 'data', 'floodExtents', filename)
    // Try multiple possible locations
    const candidates = [
      filePath,
      path.resolve('src', 'data', 'floodExtents', filename),
      path.resolve('server', 'src', 'data', 'floodExtents', filename),
      path.resolve('aegis-v6', 'server', 'src', 'data', 'floodExtents', filename),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const geojson = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
        const features = geojson.features || []
        extentCache.set(filename, features)
        return features
      }
    }
  } catch (err: any) {
    logger.warn({ err, riverName }, '[FloodPrediction] Failed to load extent')
  }

  return null
}

function getExtentForLevel(features: any[], levelMetres: number): { extent: any; properties: any } | null {
  if (!features || features.length === 0) return null

  // Find the highest matching flood level
  let bestMatch: any = null
  let bestProps: any = null

  for (const feature of features) {
    const featureLevel = feature.properties?.level || 0
    const thresholds: Record<number, number> = { 2: 1.5, 3: 2.5, 4: 3.5 }
    const threshold = thresholds[featureLevel] || featureLevel

    if (levelMetres >= threshold) {
      if (!bestMatch || featureLevel > (bestMatch.properties?.level || 0)) {
        bestMatch = feature
        bestProps = feature.properties
      }
    }
  }

  return bestMatch ? { extent: bestMatch.geometry, properties: bestProps } : null
}

// Catchment response characteristics — determines how fast rivers rise/fall
// based on catchment type. Urban catchments respond faster (impervious surfaces),
// rural/upland catchments have slower, sustained response.
interface CatchmentProfile {
  risingRateBase: number    // m/h base rate when rising
  fallingRateBase: number   // m/h base rate when falling (negative)
  stableVariation: number   // m/h random variation when stable
  rainfallCoeff: number     // m per mm of rainfall per hour
  recessionExponent: number // exponential decay constant for falling limb
}

const CATCHMENT_PROFILES: Record<string, CatchmentProfile> = {
  urban_small: { risingRateBase: 0.25, fallingRateBase: -0.12, stableVariation: 0.03, rainfallCoeff: 0.08, recessionExponent: 0.15 },
  urban_large: { risingRateBase: 0.18, fallingRateBase: -0.08, stableVariation: 0.02, rainfallCoeff: 0.06, recessionExponent: 0.12 },
  rural_upland: { risingRateBase: 0.10, fallingRateBase: -0.05, stableVariation: 0.01, rainfallCoeff: 0.04, recessionExponent: 0.08 },
  rural_lowland: { risingRateBase: 0.08, fallingRateBase: -0.04, stableVariation: 0.01, rainfallCoeff: 0.03, recessionExponent: 0.06 },
  default: { risingRateBase: 0.15, fallingRateBase: -0.07, stableVariation: 0.02, rainfallCoeff: 0.05, recessionExponent: 0.10 },
}

function getCatchmentProfile(riverName: string, regionId: string): CatchmentProfile {
  // Look up from river config, fall back to default
  // Rivers in urban areas (Glasgow, Edinburgh centers) use urban profiles
  const urbanRivers = ['clyde', 'kelvin', 'water of leith', 'thames', 'trent']
  const uplandRivers = ['tweed', 'tay', 'spey', 'dee']
  const lower = riverName.toLowerCase()
  if (urbanRivers.some(r => lower.includes(r))) return CATCHMENT_PROFILES.urban_large
  if (uplandRivers.some(r => lower.includes(r))) return CATCHMENT_PROFILES.rural_upland
  return CATCHMENT_PROFILES.default
}

// Prediction Calculation

 /*
 * Calculate flood predictions for all rivers in the active region.
  */
export async function getFloodPredictions(): Promise<FloodPrediction[]> {
  const region = getActiveCityRegion()
  const levels = await getCurrentLevels()
  const predictions: FloodPrediction[] = []

  for (const river of region.rivers) {
    const currentReading = levels.find(l => l.stationId === river.stationId)
    if (!currentReading) continue

    const coords = river.coordinates || region.centre
    const rainfallMm = await fetchRainfallForecast(coords.lat, coords.lng)
    const extentFeatures = loadFloodExtent(river.name)

    // H10: Try AI engine — pass REAL observed river level and rainfall so the
    // physics model uses actual conditions instead of hardcoded defaults.
    let aiProbability: number | null = null
    let aiConfidenceBoost = 0
    try {
      const aiResponse = await aiClient.predict({
        hazard_type: 'flood',
        region_id: region.id,
        latitude: coords.lat,
        longitude: coords.lng,
        forecast_horizon: 6,
        include_contributing_factors: false,
        feature_overrides: {
          river_level: currentReading.levelMetres,
          // 6h rainfall total ? approximate 24h by scaling; 7d by further scaling
          rainfall_24h: rainfallMm > 0 ? Math.round(rainfallMm * 4 * 10) / 10 : 0,
          rainfall_7d:  rainfallMm > 0 ? Math.round(rainfallMm * 7 * 10) / 10 : 0,
          rainfall_1h:  rainfallMm > 0 ? Math.round((rainfallMm / 6) * 10) / 10 : 0,
        },
      })
      if (aiResponse && typeof aiResponse.probability === 'number') {
        aiProbability = aiResponse.probability
        // Confidence boost scales with how far above normal the river is:
        // 0—20% above ? +5, 20—50% ? +8, 50%+ ? +10
        const levelRatio = currentReading.levelMetres / (river.floodThresholds?.normal ?? 1.5)
        aiConfidenceBoost = levelRatio >= 1.5 ? 10 : levelRatio >= 1.2 ? 8 : 5
      }
    } catch {
      // AI engine offline — continue with linear extrapolation only
    }

    const prediction = calculatePrediction(
      currentReading.levelMetres,
      currentReading.trend,
      rainfallMm,
      river.floodThresholds,
      extentFeatures,
      region.id,
      river.name,
      river.stationId,
      currentReading.status,
      aiConfidenceBoost,
    )

    prediction.rainfallForecastMm = rainfallMm
    predictions.push(prediction)

    // Store in DB
    storePrediction(prediction, aiProbability).catch(err => {
      logger.error({ err }, '[FloodPrediction] DB store failed')
    })
  }

  return predictions
}

function calculatePrediction(
  currentLevel: number,
  trend: string,
  rainfallMm: number,
  thresholds: { normal: number; elevated: number; high: number; severe: number },
  extentFeatures: any[] | null,
  regionId: string,
  riverName: string,
  stationId: string,
  currentStatus: string,
  aiConfidenceBoost = 0,
): FloodPrediction {
  const predictedLevels: PredictedLevel[] = []
  let maxAffectedAreas: string[] = []
  let maxProperties = 0
  let maxPeople = 0

  // Level-awareness: add up to +8 when river approaches flood thresholds
  const levelRatio = currentLevel / (thresholds.elevated ?? 2.0)
  const levelBonus = Math.min(8, Math.round(levelRatio * 4))

  for (const hours of [1, 2, 4, 6]) {
    const profile = getCatchmentProfile(riverName, regionId)
    let predictedLevel: number

    if (trend === 'rising') {
      // Rising limb: power-law growth with rainfall amplification
      // Level increase decelerates as it approaches flood peak (logistic saturation)
      const maxRise = (thresholds.severe - currentLevel) * 1.5  // Allow overshoot beyond severe
      const ratePerHour = profile.risingRateBase + (rainfallMm * profile.rainfallCoeff / 6)
      const rawRise = ratePerHour * hours
      // Logistic saturation: prevents unrealistic exponential growth
      predictedLevel = currentLevel + maxRise * (rawRise / (rawRise + maxRise))
    } else if (trend === 'falling') {
      // Falling limb: exponential recession (hydrologically correct)
      // Q(t) = Q0 * exp(-k * t) where k is the recession constant
      const decayFactor = Math.exp(profile.recessionExponent * hours)
      const excessAboveNormal = Math.max(0, currentLevel - thresholds.normal)
      predictedLevel = thresholds.normal + excessAboveNormal / decayFactor
      // Rainfall can slow or reverse recession
      predictedLevel += rainfallMm * profile.rainfallCoeff * hours / 6
    } else {
      // Stable: small variation proportional to rainfall
      const variation = profile.stableVariation * hours
      const rainfallContribution = rainfallMm * profile.rainfallCoeff * hours / 6
      predictedLevel = currentLevel + variation + rainfallContribution
    }

    predictedLevel = Math.max(0, Math.round(predictedLevel * 100) / 100)
    const roundedLevel = predictedLevel

    // Determine status at predicted level
    let status = 'NORMAL'
    if (roundedLevel >= thresholds.severe) status = 'CRITICAL'
    else if (roundedLevel >= thresholds.high) status = 'HIGH'
    else if (roundedLevel >= thresholds.elevated) status = 'ELEVATED'

    // Get flood extent polygon
    let extent: any = null
    let props: any = null
    if (extentFeatures) {
      const match = getExtentForLevel(extentFeatures, roundedLevel)
      if (match) {
        extent = match.extent
        props = match.properties
      }
    }

    // Confidence: quadratic time decay with data quality bonuses
    const baseConfidence = 90
    const timeDecay = Math.round(hours * hours * 0.8)  // Quadratic decay (uncertainty grows faster with time)
    const dataSourceBonus = rainfallMm > 0 ? 5 : 0     // Having rainfall data helps
    const aiBonus = aiConfidenceBoost                    // AI engine agreement
    const trendCertainty = trend === 'stable' ? 3 : trend === 'rising' ? 0 : -2  // Stable is most predictable
    const confidence = Math.max(15, Math.min(95, baseConfidence - timeDecay + dataSourceBonus + aiBonus + trendCertainty + levelBonus))

    predictedLevels.push({ hours, level: roundedLevel, status, extent, confidence })

    // Track worst-case affected areas
    if (props?.affectedAreas) {
      const areas: string[] = props.affectedAreas
      if (areas.length > maxAffectedAreas.length) maxAffectedAreas = areas
    }
    if (props?.estimatedProperties > maxProperties) maxProperties = props.estimatedProperties
    if (props?.estimatedPeople > maxPeople) maxPeople = props.estimatedPeople
  }

  return {
    regionId,
    riverName,
    stationId,
    currentLevel,
    status: currentStatus,
    predictions: predictedLevels,
    affectedAreas: maxAffectedAreas,
    estimatedProperties: maxProperties,
    estimatedPeople: maxPeople,
    rainfallForecastMm: rainfallMm,
    calculatedAt: new Date().toISOString(),
  }
}

async function storePrediction(prediction: FloodPrediction, aiProbability: number | null = null): Promise<void> {
  // Determine worst-case prediction for summary
  const worst = prediction.predictions.reduce(
    (w, p) => (p.level > w.level ? p : w),
    prediction.predictions[0] ||  { hours: 1, level: 0, status: 'NORMAL', confidence: 50, extent: null },
  )
  // Use AI probability when available; fall back to normalised level estimate
  const probability = aiProbability !== null ? aiProbability : Math.min(0.99, worst.level / 5)
  const timeToFlood = worst.status !== 'NORMAL'
    ? `${worst.hours} hour${worst.hours > 1 ? 's' : ''}`
    : 'No flood expected'

  const severity = worst.status === 'CRITICAL' ? 'critical'
    : worst.status === 'HIGH' ? 'high'
    : worst.status === 'ELEVATED' ? 'medium'
    : 'low'

  // "AI-enhanced" = AI engine ran with real SEPA+rainfall inputs ? probability is AI-derived
  // "Physics estimate" = AI engine offline, probability estimated from level/5
  const aiLabel = aiProbability !== null ? ' | AI-enhanced probability' : ' | Physics estimate'
  const pattern = `${prediction.riverName}: ${prediction.currentLevel.toFixed(2)}m ? ${worst.level.toFixed(2)}m in ${worst.hours}h | rainfall=${prediction.rainfallForecastMm.toFixed(1)}mm${aiLabel}`
  const gaugeSource = regionRegistry.getActiveRegion().getMetadata().floodAuthority + ' River Levels'
  const dataSources = aiProbability !== null
    ? [gaugeSource, 'Rainfall Forecast', 'Hydrological Model', 'AI Engine']
    : [gaugeSource, 'Rainfall Forecast', 'Hydrological Model']

  try {
    await pool.query(
      `INSERT INTO flood_predictions
         (area, probability, time_to_flood, matched_pattern, next_areas,
          severity, confidence, data_sources, model_version, region_id,
          expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::report_severity, $7, $8, $9, $10,
               NOW() + INTERVAL '1 hour')`,
      [
        `${prediction.riverName} (${prediction.regionId})`,
        probability,
        timeToFlood,
        pattern,
        prediction.affectedAreas,
        severity,
        worst.confidence,
        dataSources,
        'flood-fp-v2.1',
        prediction.regionId,
      ],
    )
  } catch (err: any) {
    // Backward compatibility for deployments where region_id has not been migrated yet.
    if (!String(err?.message || '').toLowerCase().includes('region_id')) throw err

    await pool.query(
      `INSERT INTO flood_predictions
         (area, probability, time_to_flood, matched_pattern, next_areas,
          severity, confidence, data_sources, model_version,
          expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::report_severity, $7, $8, $9,
               NOW() + INTERVAL '1 hour')`,
      [
        `${prediction.riverName} (${prediction.regionId})`,
        probability,
        timeToFlood,
        pattern,
        prediction.affectedAreas,
        severity,
        worst.confidence,
        dataSources,
        'flood-fp-v2.1',
      ],
    )
  }
}

// —2  NON-LINEAR PREDICTION MODEL

 /**
 * Predict river level using non-linear models:
 * Rising: logistic curve approaching a saturation max
 * Falling: exponential decay (slower recession)
 * Stable: small random walk proportional to rainfall
 */
function predictNonLinear(
  currentLevel: number,
  trend: string,
  rainfallMm: number,
  hours: number,
): number {
  const rainfallRate = rainfallMm * 0.05 / 6 // mm to metres per hour contribution

  if (trend === 'rising') {
    // Logistic growth: level approaches a saturation max
    // Max is current level * 2.5 (natural river capacity ceiling)
    const maxLevel = Math.max(currentLevel * 2.5, currentLevel + 3.0)
    const growthRate = 0.3 + rainfallRate * 2
    const logistic = maxLevel / (1 + ((maxLevel - currentLevel) / currentLevel) * Math.exp(-growthRate * hours))
    return Math.round(logistic * 100) / 100
  }

  if (trend === 'falling') {
    // Exponential decay — rivers recede slowly
    const decayRate = 0.05 // ~5% per hour
    const baseLevel = Math.max(0.1, currentLevel * 0.3) // Floor level
    const decayed = baseLevel + (currentLevel - baseLevel) * Math.exp(-decayRate * hours)
    // Rainfall can slow the recession
    const rainfallOffset = rainfallRate * hours * 0.5
    return Math.round(Math.max(0, decayed + rainfallOffset) * 100) / 100
  }

  // Stable: small drift proportional to rainfall
  const drift = rainfallRate * hours
  // Small natural variation: +-2% per hour
  const variation = currentLevel * 0.02 * Math.sin(hours * 0.5)
  return Math.round(Math.max(0, currentLevel + drift + variation) * 100) / 100
}

// —3  HISTORICAL ANALOG MATCHING

 /**
 * Find historical flood events most similar to current conditions.
 */
export async function findHistoricalAnalogs(
  currentLevel: number,
  rainfallMm: number,
  month: number,
): Promise<Array<{ eventName: string; date: string; peakLevel: number; similarity: number; outcome: string }>> {
  try {
    const result = await pool.query(
      `SELECT event_name, event_date, peak_water_level_m, severity,
              affected_people, damage_gbp, duration_hours
       FROM historical_flood_events
       WHERE peak_water_level_m IS NOT NULL`,
    )

    if (result.rows.length === 0) return []

    const analogs = result.rows.map((row: any) => {
      const peakLevel = parseFloat(row.peak_water_level_m) || 0
      const eventMonth = new Date(row.event_date).getMonth() + 1

      // Similarity components (each 0-1, lower = more similar)
      const levelDiff = Math.abs(peakLevel - currentLevel) / Math.max(peakLevel, currentLevel, 1)
      // Seasonal proximity: 0 = same month, 0.5 = 6 months apart
      const monthDiff = Math.min(
        Math.abs(eventMonth - month),
        12 - Math.abs(eventMonth - month),
      ) / 6

      // Combined similarity (1 = perfect match, 0 = no similarity)
      const similarity = Math.round((1 - levelDiff * 0.6 - monthDiff * 0.4) * 100) / 100

      const outcome = row.severity === 'critical'
        ? `Critical event: ${row.affected_people || 'unknown'} people affected, ${row.duration_hours || 'unknown'}h duration`
        : row.severity === 'high'
        ? `High severity: ${row.affected_people || 'unknown'} people affected`
        : `${row.severity || 'Unknown'} severity event`

      return {
        eventName: row.event_name || 'Unnamed event',
        date: row.event_date ? new Date(row.event_date).toISOString().split('T')[0] : 'Unknown',
        peakLevel,
        similarity: Math.max(0, similarity),
        outcome,
      }
    })

    // Return top 3 most similar
    analogs.sort((a: any, b: any) => b.similarity - a.similarity)
    return analogs.slice(0, 3)
  } catch (err: any) {
    logger.error({ err }, '[FloodPrediction] Historical analog matching failed')
    return []
  }
}

// —4  ENSEMBLE PREDICTION

 /**
 * Combine standard linear, non-linear, and historical analog predictions into
 * an ensemble with uncertainty bands.
 */
export async function getEnsemblePredictions(): Promise<
  Array<FloodPrediction & { ensembleMethod: string; uncertainty: { lower: number; upper: number } }>
> {
  // Get standard predictions
  const standardPredictions = await getFloodPredictions()
  const currentMonth = new Date().getMonth() + 1

  const ensembleResults: Array<FloodPrediction & { ensembleMethod: string; uncertainty: { lower: number; upper: number } }> = []

  for (const pred of standardPredictions) {
    // Get historical analogs for context
    const analogs = await findHistoricalAnalogs(pred.currentLevel, pred.rainfallForecastMm, currentMonth)
    const analogPeakAvg = analogs.length > 0
      ? analogs.reduce((sum, a) => sum + a.peakLevel, 0) / analogs.length
      : pred.currentLevel

    // Build ensemble predictions for each time horizon
    const ensembleLevels: PredictedLevel[] = pred.predictions.map((p) => {
      const linearLevel = p.level

      // Non-linear prediction
      const nlLevel = predictNonLinear(
        pred.currentLevel,
        pred.status === 'CRITICAL' || pred.status === 'HIGH' ? 'rising' : 'stable',
        pred.rainfallForecastMm,
        p.hours,
      )

      // Historical analog contribution: weighted interpolation toward analog peak
      const analogWeight = 0.2
      const analogLevel = pred.currentLevel + (analogPeakAvg - pred.currentLevel) * analogWeight * (p.hours / 6)

      // Ensemble average (weighted: linear 40%, non-linear 40%, analog 20%)
      const ensembleLevel = Math.round(
        (linearLevel * 0.4 + nlLevel * 0.4 + analogLevel * 0.2) * 100,
      ) / 100

      // Uncertainty from spread between methods
      const levels = [linearLevel, nlLevel, analogLevel]
      const minLevel = Math.min(...levels)
      const maxLevel = Math.max(...levels)

      return {
        hours: p.hours,
        level: ensembleLevel,
        status: p.status,
        extent: p.extent,
        confidence: Math.max(20, p.confidence - Math.round((maxLevel - minLevel) * 5)),
      }
    })

    // Compute overall uncertainty from spread
    const allLevels = ensembleLevels.map(e => e.level)
    const avgLevel = allLevels.reduce((s, l) => s + l, 0) / allLevels.length
    const spread = Math.max(...allLevels) - Math.min(...allLevels)

    ensembleResults.push({
      ...pred,
      predictions: ensembleLevels,
      ensembleMethod: 'weighted_average(linear=0.4, nonlinear=0.4, analog=0.2)',
      uncertainty: {
        lower: Math.round(Math.max(0, avgLevel - spread * 0.8) * 100) / 100,
        upper: Math.round((avgLevel + spread * 0.8) * 100) / 100,
      },
    })
  }

  return ensembleResults
}

// —5  PREDICTION ACCURACY TRACKING

 /**
 * Compare past predictions (6-24h ago) with actual observed river levels
 * to compute RMSE, MAE, and bias per station.
 */
export async function trackPredictionAccuracy(): Promise<Array<{
  stationId: string
  rmse: number
  mae: number
  bias: number
  sampleSize: number
}>> {
  const results: Array<{ stationId: string; rmse: number; mae: number; bias: number; sampleSize: number }> = []

  try {
    const region = getActiveCityRegion()
    const currentLevels = await getCurrentLevels()

    for (const river of region.rivers) {
      const currentReading = currentLevels.find(l => l.stationId === river.stationId)
      if (!currentReading) continue

      const actualLevel = currentReading.levelMetres

      // Get predictions made 6-24h ago for this area
      const pastPredictions = await pool.query(
        `SELECT predicted_levels, calculated_at
         FROM flood_predictions
         WHERE area ILIKE $1
           AND calculated_at > NOW() - INTERVAL '24 hours'
           AND calculated_at < NOW() - INTERVAL '6 hours'
         ORDER BY calculated_at DESC
         LIMIT 20`,
        [`%${river.name}%`],
      )

      if (pastPredictions.rows.length === 0) continue

      const errors: number[] = []

      for (const row of pastPredictions.rows) {
        const predictions = typeof row.predicted_levels === 'string'
          ? JSON.parse(row.predicted_levels)
          : row.predicted_levels

        if (!Array.isArray(predictions)) continue

        // Find the prediction closest to the elapsed time
        const elapsedHours = (Date.now() - new Date(row.calculated_at).getTime()) / (1000 * 60 * 60)

        let bestPrediction: any = null
        let bestDist = Infinity
        for (const p of predictions) {
          const dist = Math.abs(p.hours - elapsedHours)
          if (dist < bestDist) {
            bestDist = dist
            bestPrediction = p
          }
        }

        if (bestPrediction && typeof bestPrediction.level === 'number') {
          errors.push(bestPrediction.level - actualLevel)
        }
      }

      if (errors.length === 0) continue

      const n = errors.length
      const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / n
      const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / n)
      const bias = errors.reduce((s, e) => s + e, 0) / n

      results.push({
        stationId: river.stationId,
        rmse: Math.round(rmse * 1000) / 1000,
        mae: Math.round(mae * 1000) / 1000,
        bias: Math.round(bias * 1000) / 1000,
        sampleSize: n,
      })

      // Store accuracy metrics in DB
      await pool.query(
        `INSERT INTO ai_executions
         (model_name, model_version, input_payload, raw_response, execution_time_ms,
          target_type, target_id, explanation, status)
         VALUES ('flood_prediction_accuracy', 'v1.0', $1, $2, 0,
                 'station', $3, $4, 'success')`,
        [
          JSON.stringify({ stationId: river.stationId, sampleSize: n }),
          JSON.stringify({ rmse, mae, bias }),
          river.stationId,
          `RMSE=${rmse.toFixed(3)}, MAE=${mae.toFixed(3)}, Bias=${bias.toFixed(3)} (n=${n})`,
        ],
      ).catch(() => {})
    }
  } catch (err: any) {
    logger.error({ err }, '[FloodPrediction] Accuracy tracking failed')
  }

  return results
}

// —6  MULTI-RIVER INTERACTION ANALYSIS

 /**
 * Analyze whether multiple rivers rising simultaneously creates amplified flood risk.
 */
export async function analyzeMultiRiverDynamics(): Promise<{
  interactionRisk: 'none' | 'low' | 'moderate' | 'high'
  details: string[]
  amplificationFactor: number
}> {
  const details: string[] = []

  try {
    const levels = await getCurrentLevels()

    if (levels.length === 0) {
      return { interactionRisk: 'none', details: ['No river data available'], amplificationFactor: 1.0 }
    }

    const risingRivers = levels.filter(l => l.trend === 'rising')
    const highRivers = levels.filter(l => l.status === 'HIGH' || l.status === 'CRITICAL')
    const criticalRivers = levels.filter(l => l.status === 'CRITICAL')

    details.push(`${levels.length} rivers monitored, ${risingRivers.length} rising`)

    if (highRivers.length > 0) {
      details.push(`Rivers at HIGH or above: ${highRivers.map(r => r.riverName).join(', ')}`)
    }

    if (risingRivers.length > 1) {
      details.push(`Multiple rivers rising simultaneously: ${risingRivers.map(r => r.riverName).join(', ')}`)
    }

    // Determine interaction risk
    let interactionRisk: 'none' | 'low' | 'moderate' | 'high' = 'none'
    let amplificationFactor = 1.0

    if (criticalRivers.length >= 1 || highRivers.length >= 3) {
      interactionRisk = 'high'
      amplificationFactor = 1.5
      details.push('HIGH interaction risk: severe multi-river flooding likely, downstream confluence areas at extreme risk')
    } else if (highRivers.length >= 2) {
      interactionRisk = 'moderate'
      amplificationFactor = 1.3
      details.push('MODERATE interaction risk: multiple rivers at HIGH level may cause confluence flooding')
    } else if (risingRivers.length >= 2) {
      interactionRisk = 'low'
      amplificationFactor = 1.1
      details.push('LOW interaction risk: multiple rivers rising but not yet at HIGH levels')
    } else {
      details.push('No significant multi-river interaction detected')
    }

    return { interactionRisk, details, amplificationFactor }
  } catch (err: any) {
    logger.error({ err }, '[FloodPrediction] Multi-river dynamics analysis failed')
    return { interactionRisk: 'none', details: ['Analysis failed: ' + err.message], amplificationFactor: 1.0 }
  }
}
