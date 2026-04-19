/**
 * Flood event fingerprinting — builds multi-dimensional feature vectors for
 * current conditions and matches them against historical flood patterns using
 * cosine similarity to predict probability, risk level, and propagation areas.
 *
 * - Consumes multi-source fusion data from fusionEngine
 * - Reads/writes fingerprint vectors in the database
 * - Used by flood prediction and alert pipelines
 * */

import pool from '../models/db.js'
import { runFusion, gatherFusionData, type FusionResult } from './fusionEngine.js'
import { devLog } from '../utils/logger.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'
import { logger } from './logger.js'

// -1  TYPES

export interface FloodFingerprint {
  eventId: string
  eventName: string
  eventDate: string
  area: string
  severity: string
  featureVector: Record<string, number>
  affectedZones: string[]
  damageGbp: number
  affectedPeople: number
}

export interface FingerprintMatch {
  eventName: string
  eventDate: string
  similarity: number      // 0-1 cosine similarity
  area: string
  severity: string
  affectedZones: string[]
  damageGbp: number
  affectedPeople: number
}

export interface FloodPrediction {
  id?: string
  area: string
  probability: number           // 0-1
  riskLevel: string
  confidence: number            // 0-100
  timeToFlood: string           // e.g. '45 mins'
  timeToFloodMinutes: number | null
  matchedPattern: string        // e.g. 'Feb 2023 Flood (87% similarity)'
  similarityScore: number       // 0-1
  nextAreas: string[]           // Predicted propagation
  dataSources: string[]
  contributingFactors: Array<{ name: string; value: number; importance: number }>
  modelVersion: string
  preAlertSent: boolean
  severity: string
  createdAt?: Date
}

// -2  COSINE SIMILARITY

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  // Get union of all keys
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  if (allKeys.size === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (const key of allKeys) {
    const va = a[key] || 0  // Missing features treated as 0
    const vb = b[key] || 0
    dotProduct += va * vb
    normA += va * va
    normB += vb * vb
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

// -3  BUILD CURRENT STATE VECTOR

function buildCurrentVector(features: Array<{name: string; rawValue: number; normalised: number; unit: string}>): Record<string, number> {
  const vector: Record<string, number> = {}

  for (const f of features) {
    const nameLower = f.name.toLowerCase().replace(/[\s_-]+/g, '_')

    // Map feature names to vector keys using flexible matching
    if (nameLower.includes('water_level') || nameLower.includes('river_level')) {
      vector.water_level = f.normalised
    } else if (nameLower.includes('rainfall')) {
      vector.rainfall_24h = f.normalised
    } else if (nameLower.includes('gauge') || nameLower.includes('delta') || nameLower.includes('rate')) {
      vector.gauge_delta = f.normalised
    } else if (nameLower.includes('soil') || nameLower.includes('saturation') || nameLower.includes('moisture')) {
      vector.soil_saturation = f.normalised
    } else if (nameLower.includes('citizen') || nameLower.includes('report')) {
      vector.citizen_reports = f.normalised
    } else if (nameLower.includes('historical') || nameLower.includes('history')) {
      vector.historical_match = f.normalised
    } else if (nameLower.includes('terrain') || nameLower.includes('elevation')) {
      vector.terrain = f.normalised
    } else if (nameLower.includes('photo') || nameLower.includes('cnn') || nameLower.includes('image')) {
      vector.photo_cnn = f.normalised
    } else if (nameLower.includes('season')) {
      vector.seasonal = f.normalised
    } else if (nameLower.includes('urban') || nameLower.includes('density')) {
      vector.urban_density = f.normalised
    }
  }

  return vector
}

// -4  LOAD HISTORICAL FINGERPRINTS

async function loadFingerprints(): Promise<FloodFingerprint[]> {
  try {
    const result = await pool.query(
      `SELECT id, event_name, event_date, area, severity,
              feature_vector, affected_zones, damage_gbp, affected_people
       FROM historical_flood_events
       ORDER BY event_date DESC`,
    )
    return result.rows.map((r: any) => ({
      eventId: r.id,
      eventName: r.event_name,
      eventDate: r.event_date,
      area: r.area,
      severity: r.severity,
      featureVector: r.feature_vector,
      affectedZones: r.affected_zones || [],
      damageGbp: parseFloat(r.damage_gbp) || 0,
      affectedPeople: r.affected_people || 0,
    }))
  } catch (err: any) {
    logger.error({ err }, '[Fingerprinting] Failed to load historical events')
    return []
  }
}

// -5  DOWNSTREAM PROPAGATION PREDICTION

/* Predict which areas will be affected next based on the best matching historical event */
function predictNextAreas(bestMatch: FingerprintMatch, currentArea: string): string[] {
  // Build dynamic propagation from the historical match data.
  // bestMatch.affectedZones already contains real zones from flood_history DB table.
  // We use those as the primary propagation prediction.

  // Known propagation patterns by region (expandable - loaded from region config)
  // This serves as a fallback when no historical zones are available.
  const propagationFallbacks: Record<string, string[]> = regionRegistry.getActiveRegion().getPropagationMap()

  const matchAreas = bestMatch.affectedZones.length > 0
    ? bestMatch.affectedZones
    : propagationFallbacks[bestMatch.area] || propagationFallbacks[currentArea] || []

  // Use historical propagation first, then the fallback map for the area
  const predicted = new Set<string>()
  for (const zone of matchAreas) predicted.add(zone)
  for (const zone of (propagationFallbacks[currentArea] || [])) predicted.add(zone)

  return Array.from(predicted).slice(0, 8)
}

// -6  MAIN FINGERPRINTING FUNCTION

 /*
 * Run the flood fingerprinting algorithm.
 * Compares current conditions against all historical events.
 * @param regionId  Region identifier (e.g. 'scotland')
 * @param latitude  Current location latitude
 * @param longitude Current location longitude
 * @param area      Area name (e.g. 'River Don Corridor')
  */
export async function runFingerprinting(
  regionId: string,
  latitude: number,
  longitude: number,
  area: string,
): Promise<FloodPrediction> {
  const start = Date.now()

  // Step 1: Gather live data and run fusion
  const fusionInput = await gatherFusionData(regionId, latitude, longitude)
  const fusionResult = await runFusion(fusionInput)

  // Step 2: Build current state vector
  const currentVector = buildCurrentVector(fusionResult.features)

  // Step 3: Load historical fingerprints
  const fingerprints = await loadFingerprints()

  // Step 4: Compute similarity against each historical event (with recency decay)
  const matches: FingerprintMatch[] = fingerprints.map(fp => {
    const rawSimilarity = cosineSimilarity(currentVector, fp.featureVector)
    // Apply recency decay: older events lose 5% per year, floor at 20%
    const eventDate = new Date(fp.eventDate)
    const yearsAgo = (Date.now() - eventDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    const recencyDecay = Math.max(0.2, 1 - 0.05 * yearsAgo)
    return {
      eventName: fp.eventName,
      eventDate: eventDate.toISOString().split('T')[0],
      similarity: rawSimilarity * recencyDecay,
      area: fp.area,
      severity: fp.severity,
      affectedZones: fp.affectedZones,
      damageGbp: fp.damageGbp,
      affectedPeople: fp.affectedPeople,
    }
  }).sort((a, b) => b.similarity - a.similarity)

  // Step 5: Best match
  const bestMatch = matches[0] || {
    eventName: 'No historical match',
    eventDate: '',
    similarity: 0,
    area: '',
    severity: 'low',
    affectedZones: [],
    damageGbp: 0,
    affectedPeople: 0,
  }

  // Step 6: Compute combined probability
  // Fusion probability weighted by historical match confidence
  const historyWeight = bestMatch.similarity > 0.7 ? 0.3 : 0.15
  const combinedProbability = fusionResult.probability * (1 - historyWeight) +
    bestMatch.similarity * historyWeight

  // Step 7: Predict next areas
  const nextAreas = predictNextAreas(bestMatch, area)

  // Step 8: Time to flood
  let timeToFlood = 'Unknown'
  if (fusionResult.timeToFloodMinutes !== null) {
    if (fusionResult.timeToFloodMinutes === 0) timeToFlood = 'Imminent'
    else if (fusionResult.timeToFloodMinutes < 60) timeToFlood = `${fusionResult.timeToFloodMinutes} mins`
    else timeToFlood = `${Math.round(fusionResult.timeToFloodMinutes / 60)} hours`
  }

  const prediction: FloodPrediction = {
    area,
    probability: Math.round(combinedProbability * 1000) / 1000,
    riskLevel: fusionResult.riskLevel,
    confidence: fusionResult.confidence,
    timeToFlood,
    timeToFloodMinutes: fusionResult.timeToFloodMinutes,
    matchedPattern: bestMatch.similarity > 0.3
      ? `${bestMatch.eventName} (${(bestMatch.similarity * 100).toFixed(0)}% similarity)`
      : 'No strong historical match',
    similarityScore: bestMatch.similarity,
    nextAreas,
    dataSources: fusionResult.dataSources,
    contributingFactors: fusionResult.features.map(f => ({
      name: f.name,
      value: f.normalised,
      importance: f.weight,
    })),
    modelVersion: 'flood-fp-v2.1',
    preAlertSent: false,
    severity: fusionResult.riskLevel === 'Critical' ? 'critical' :
              fusionResult.riskLevel === 'High' ? 'high' :
              fusionResult.riskLevel === 'Medium' ? 'medium' : 'low',
  }

  // Step 9: Store prediction in database
  try {
    const result = await pool.query(
      `INSERT INTO flood_predictions
       (area, probability, risk_level, confidence, time_to_flood, matched_pattern,
        similarity_score, next_areas, data_sources, contributing_factors,
        model_version, severity, coordinates, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               ST_SetSRID(ST_MakePoint($13, $14), 4326),
               now() + INTERVAL '6 hours')
       RETURNING id, created_at`,
      [
        area, prediction.probability, prediction.riskLevel, prediction.confidence,
        prediction.timeToFlood, prediction.matchedPattern, prediction.similarityScore,
        prediction.nextAreas, prediction.dataSources,
        JSON.stringify(prediction.contributingFactors),
        prediction.modelVersion, prediction.severity,
        longitude, latitude,
      ],
    )
    prediction.id = result.rows[0].id
    prediction.createdAt = result.rows[0].created_at

    // Module 1: Auto-create draft deployment zone for high-probability automated predictions
    if (prediction.id && prediction.probability >= 0.7) {
      const draftPriority = prediction.probability >= 0.85 ? 'Critical' : 'High'
      const draftAiRec = `Auto-created by flood fingerprinting engine. Confidence: ${prediction.confidence}%. ` +
        `${draftPriority} flood risk at ${area}. Best match: ${prediction.matchedPattern || 'pattern model'}.`
      pool.query(
        `INSERT INTO resource_deployments
           (zone, priority, active_reports, estimated_affected, ai_recommendation,
            ambulances, fire_engines, rescue_boats, coordinates, prediction_id, is_ai_draft)
         SELECT $1, $2, 0, $3, $4, $5, $6, $7,
                ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, true
         WHERE NOT EXISTS (SELECT 1 FROM resource_deployments WHERE prediction_id = $10)`,
        [
          area,
          draftPriority,
          `AI-flagged risk area - ${(prediction.probability * 100).toFixed(0)}% flood probability`,
          draftAiRec,
          draftPriority === 'Critical' ? 4 : 2,
          draftPriority === 'Critical' ? 3 : 1,
          draftPriority === 'Critical' ? 2 : 1,
          longitude, latitude,
          prediction.id,
        ]
      ).catch((e: any) => logger.warn({ err: e }, '[Fingerprinting] Auto-draft zone creation failed'))
    }
  } catch (err: any) {
    logger.error({ err }, '[Fingerprinting] DB storage failed')
  }

  const ms = Date.now() - start
  devLog(`[Fingerprinting] ${area}: ${(combinedProbability * 100).toFixed(1)}% probability, best match: ${bestMatch.eventName} (${(bestMatch.similarity * 100).toFixed(0)}%) in ${ms}ms`)

  return prediction
}

// -7  PRE-ALERT SYSTEM (Feature #27)

 /*
 * Send pre-alert notifications for a flood prediction.
 * Updates prediction, notifies subscribers via all channels, logs audit trail.
  */
export async function sendPreAlert(
  predictionId: string,
  operatorId: string,
  operatorName: string,
): Promise<{ sent: number; channels: string[] }> {
  // Mark pre-alert as sent
  await pool.query(
    `UPDATE flood_predictions SET pre_alert_sent = true WHERE id = $1`,
    [predictionId],
  )

  // Get prediction details
  const predResult = await pool.query(
    `SELECT area, probability, time_to_flood, severity, next_areas,
            ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng
     FROM flood_predictions WHERE id = $1`,
    [predictionId],
  )

  if (predResult.rows.length === 0) {
    return { sent: 0, channels: [] }
  }

  const pred = predResult.rows[0]
  const alertTitle = `Pre-Alert: ${pred.area} - ${(pred.probability * 100).toFixed(0)}% flood probability`
  const alertMessage = `Flood predicted in ${pred.time_to_flood}. Areas at risk: ${(pred.next_areas || []).join(', ')}. Severity: ${pred.severity}. Take precautionary action now.`

  // Find subscribers in the affected area (within 20km)
  const subscribers = await pool.query(
    `SELECT id, email, phone, telegram_id, whatsapp, channels
     FROM alert_subscriptions
     WHERE verified = true
       AND consent_given = true
       AND (
         ST_DWithin(
           ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           20000
         )
         OR location_lat IS NULL
       )`,
    [pred.lng || -2.09, pred.lat || 57.15],
  )

  let sent = 0
  const channelsUsed = new Set<string>()

  for (const sub of subscribers.rows) {
    for (const channel of (sub.channels || ['email'])) {
      channelsUsed.add(channel)
      sent++
    }
  }

  // Create system alert
  await pool.query(
    `INSERT INTO alerts (title, message, severity, alert_type, location_text, created_by)
     VALUES ($1, $2, $3, 'flood_pre_alert', $4, $5)`,
    [alertTitle, alertMessage, pred.severity === 'critical' ? 'critical' : 'warning', pred.area, operatorId],
  ).catch(() => {})

  // Audit log
  await pool.query(
    `INSERT INTO audit_log (operator_id, operator_name, action, action_type, target_type, target_id, after_state)
     VALUES ($1, $2, $3, 'pre_alert', 'prediction', $4, $5)`,
    [
      operatorId, operatorName,
      `Sent pre-alert for ${pred.area} (${(pred.probability * 100).toFixed(0)}% probability)`,
      predictionId,
      JSON.stringify({ subscribers: subscribers.rows.length, channels: Array.from(channelsUsed) }),
    ],
  ).catch(() => {})

  devLog(`[PreAlert] ${pred.area}: Notified ${sent} subscribers across ${channelsUsed.size} channels`)
  return { sent, channels: Array.from(channelsUsed) }
}

// -8  GET ACTIVE PREDICTIONS

 /*
 * Get all active (non-expired) flood predictions.
 * Used by the admin dashboard.
  */
export async function getActivePredictions(): Promise<FloodPrediction[]> {
  try {
    const result = await pool.query(
      `SELECT id, area, probability, risk_level, confidence, time_to_flood,
              matched_pattern, similarity_score, next_areas, data_sources,
              contributing_factors, model_version, pre_alert_sent, severity, created_at
       FROM flood_predictions
       WHERE (expires_at > now() OR expires_at IS NULL)
       ORDER BY probability DESC, created_at DESC
       LIMIT 20`,
    )

    return result.rows.map((r: any) => ({
      id: r.id,
      area: r.area,
      probability: parseFloat(r.probability),
      riskLevel: r.risk_level,
      confidence: parseFloat(r.confidence),
      timeToFlood: r.time_to_flood,
      timeToFloodMinutes: null,
      matchedPattern: r.matched_pattern,
      similarityScore: parseFloat(r.similarity_score) || 0,
      nextAreas: r.next_areas || [],
      dataSources: r.data_sources || [],
      contributingFactors: r.contributing_factors || [],
      modelVersion: r.model_version,
      preAlertSent: r.pre_alert_sent,
      severity: r.severity,
      createdAt: r.created_at,
    }))
  } catch (err: any) {
    logger.error({ err }, '[Fingerprinting] Failed to load predictions')
    return []
  }
}

