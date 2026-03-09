/**
 * services/floodPredictionService.ts — Predictive flood model
 *
 * Takes current river levels from riverLevelService, fetches rainfall
 * forecast from OpenWeatherMap (or Open-Meteo fallback), and calculates
 * predicted river levels at 1h, 2h, 4h, 6h using linear extrapolation
 * weighted by rainfall rate.
 *
 * Selects the appropriate GeoJSON polygon for each predicted level and
 * returns confidence percentage based on data source agreement.
 */

import { getCurrentLevels } from './riverLevelService.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { aiClient } from './aiClient.js'
import pool from '../models/db.js'
import fs from 'fs'
import path from 'path'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Rainfall Forecast
// ═══════════════════════════════════════════════════════════════════════════════

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
      console.warn(`[FloodPrediction] OpenWeather fetch failed for (${lat}, ${lng}): ${err?.message || 'unknown error'}`)
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
    console.warn(`[FloodPrediction] Open-Meteo fallback failed for (${lat}, ${lng}): ${err?.message || 'unknown error'}`)
    // Return conservative estimate
  }

  return 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flood Extent GeoJSON Loading
// ═══════════════════════════════════════════════════════════════════════════════

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
    console.warn(`[FloodPrediction] Failed to load extent for ${riverName}: ${err.message}`)
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

// ═══════════════════════════════════════════════════════════════════════════════
// Prediction Calculation
// ═══════════════════════════════════════════════════════════════════════════════

/**
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
          // 6h rainfall total → approximate 24h by scaling; 7d by further scaling
          rainfall_24h: rainfallMm > 0 ? Math.round(rainfallMm * 4 * 10) / 10 : 0,
          rainfall_7d:  rainfallMm > 0 ? Math.round(rainfallMm * 7 * 10) / 10 : 0,
          rainfall_1h:  rainfallMm > 0 ? Math.round((rainfallMm / 6) * 10) / 10 : 0,
        },
      })
      if (aiResponse && typeof aiResponse.probability === 'number') {
        aiProbability = aiResponse.probability
        // Confidence boost scales with how far above normal the river is:
        // 0–20% above → +5, 20–50% → +8, 50%+ → +10
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
      console.error(`[FloodPrediction] DB store failed: ${err.message}`)
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
  // Calculate trend rate (metres per hour)
  const trendRate = trend === 'rising' ? 0.15 : trend === 'falling' ? -0.08 : 0.02

  // Rainfall contribution: roughly 2mm rain = 0.1m river rise for urban catchments
  const rainfallRate = rainfallMm * 0.05 / 6 // Per hour averaged over 6 hours

  const predictedLevels: PredictedLevel[] = []
  let maxAffectedAreas: string[] = []
  let maxProperties = 0
  let maxPeople = 0

  for (const hours of [1, 2, 4, 6]) {
    const predictedLevel = Math.max(
      0,
      currentLevel + (trendRate * hours) + (rainfallRate * hours),
    )
    const roundedLevel = Math.round(predictedLevel * 100) / 100

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

    // Confidence decreases with prediction horizon; AI engine provides a boost.
    // Also varies with actual river level relative to flood thresholds — higher
    // level → higher confidence that the prediction is meaningful.
    const baseConfidence = 85
    const timeDecay = hours * 7   // slightly gentler decay
    const dataSourceBonus = rainfallMm > 0 ? 5 : 0
    // Level-awareness: add up to +8 when river approaches flood thresholds
    const levelRatio = currentLevel / (thresholds.elevated ?? 2.0)
    const levelBonus = Math.min(8, Math.round(levelRatio * 4))
    const confidence = Math.max(20, Math.min(95, baseConfidence - timeDecay + dataSourceBonus + aiConfidenceBoost + levelBonus))

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
    prediction.predictions[0] || { hours: 1, level: 0, status: 'NORMAL', confidence: 50, extent: null },
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

  // "AI-enhanced" = AI engine ran with real SEPA+rainfall inputs → probability is AI-derived
  // "Physics estimate" = AI engine offline, probability estimated from level/5
  const aiLabel = aiProbability !== null ? ' | AI-enhanced probability' : ' | Physics estimate'
  const pattern = `${prediction.riverName}: ${prediction.currentLevel.toFixed(2)}m → ${worst.level.toFixed(2)}m in ${worst.hours}h | rainfall=${prediction.rainfallForecastMm.toFixed(1)}mm${aiLabel}`
  const dataSources = aiProbability !== null
    ? ['SEPA River Levels', 'Rainfall Forecast', 'Hydrological Model', 'AI Engine']
    : ['SEPA River Levels', 'Rainfall Forecast', 'Hydrological Model']

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
}
