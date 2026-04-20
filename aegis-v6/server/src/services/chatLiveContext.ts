/**
 * Builds a real-time situational snapshot from the database.
 *
 * Injected into every LLM system prompt so the model has live awareness of active
 * alerts, river levels, weather warnings, shelters, and threat predictions without
 * needing to call tools first.
 */
import pool from '../models/db.js'
import { logger } from './logger.js'

 /*
 * Build a live situational snapshot from the database.
 * This is injected into the system prompt so the LLM has real-time awareness
 * without needing to call tools first.
  */
export async function buildLiveContext(): Promise<string> {
  const parts: string[] = []
  const now = new Date().toISOString()

  // Run ALL queries in parallel for speed (was sequential — 200ms → ~30ms)
  const [alertsRes, predictionsRes, riverRes, weatherRes, threatRes, trendRes, exposureRes, shelterRes, clusterRes] = await Promise.allSettled([
    // 1. Active alerts
    pool.query(
      `SELECT title, severity, location_text, created_at
       FROM alerts
       WHERE is_active = true AND deleted_at IS NULL
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, created_at DESC
       LIMIT 5`),
    // 2. AI predictions
    pool.query(
      `SELECT hazard_type, probability, confidence, region_name, created_at
       FROM predictions
       WHERE created_at > NOW() - INTERVAL '6 hours'
       ORDER BY probability DESC
       LIMIT 5`),
    // 3. River gauge levels
    pool.query(
      `SELECT station_name, water_level_m, normal_level_m, warning_level_m, recorded_at
       FROM river_levels
       WHERE recorded_at > NOW() - INTERVAL '2 hours'
       ORDER BY recorded_at DESC
       LIMIT 5`),
    // 4. Weather
    pool.query(
      `SELECT location_name, temperature_c, humidity_pct, wind_speed_ms, precipitation_mm, observed_at
       FROM weather_observations
       WHERE observed_at > NOW() - INTERVAL '3 hours'
       ORDER BY observed_at DESC
       LIMIT 3`),
    // 5. Threat level
    pool.query(
      `SELECT threat_level, threat_score, assessment_summary, assessed_at
       FROM threat_assessments
       ORDER BY assessed_at DESC
       LIMIT 1`),
    // 6a. Trend analysis
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '6 hours') AS recent_count,
        COUNT(*) FILTER (WHERE created_at BETWEEN NOW() - INTERVAL '12 hours' AND NOW() - INTERVAL '6 hours') AS previous_count
       FROM alerts
       WHERE is_active = true AND deleted_at IS NULL
         AND created_at > NOW() - INTERVAL '12 hours'`),
    // 6b. Population exposure
    pool.query(
      `SELECT p.region_name, p.probability,
              COALESCE(fz.estimated_population, 0) AS estimated_population
       FROM predictions p
       LEFT JOIN flood_zones fz ON LOWER(fz.zone_name) = LOWER(p.region_name)
       WHERE p.hazard_type ILIKE '%flood%'
         AND p.probability > 0.3
         AND p.created_at > NOW() - INTERVAL '6 hours'
       ORDER BY p.probability DESC
       LIMIT 3`),
    // 6c. Shelter capacity
    pool.query(
      `SELECT COUNT(*) AS total_shelters,
              SUM(capacity) AS total_capacity,
              SUM(current_occupancy) AS total_occupancy
       FROM shelters
       WHERE is_active = true`),
    // 6d. Incident clusters
    pool.query(
      `SELECT incident_type, COUNT(*) AS cnt
       FROM incidents
       WHERE created_at > NOW() - INTERVAL '24 hours'
         AND status != 'resolved'
       GROUP BY incident_type
       ORDER BY cnt DESC
       LIMIT 5`),
  ])

  // Process results — each is independent, failures are non-critical
  if (alertsRes.status === 'fulfilled' && alertsRes.value.rows.length > 0) {
    parts.push('ACTIVE ALERTS RIGHT NOW:')
    for (const r of alertsRes.value.rows) {
      parts.push(`  [${r.severity}] ${r.title} — ${r.location_text || 'Area-wide'} (${new Date(r.created_at).toLocaleString('en-GB')})`)
    }
  } else if (alertsRes.status === 'fulfilled') {
    parts.push('ACTIVE ALERTS: None currently active.')
  } else {
    parts.push('ACTIVE ALERTS: Data unavailable.')
  }

  if (predictionsRes.status === 'fulfilled' && predictionsRes.value.rows.length > 0) {
    parts.push('RECENT AI PREDICTIONS:')
    for (const r of predictionsRes.value.rows) {
      const prob = typeof r.probability === 'number'
        ? (r.probability > 1 ? r.probability : (r.probability * 100)).toFixed(0)
        : '?'
      parts.push(`  ${r.hazard_type}: ${prob}% probability (confidence: ${((r.confidence || 0) * 100).toFixed(0)}%) — ${r.region_name || 'Unknown region'}`)
    }
  }

  if (riverRes.status === 'fulfilled' && riverRes.value.rows.length > 0) {
    parts.push('RIVER GAUGE LEVELS (latest):')
    for (const r of riverRes.value.rows) {
      const level = parseFloat(r.water_level_m) || 0
      const warning = parseFloat(r.warning_level_m) || 999
      const status = level >= warning ? 'ABOVE WARNING' : level >= (parseFloat(r.normal_level_m) || 0) * 1.5 ? 'ELEVATED' : 'Normal'
      parts.push(`  ${r.station_name}: ${level.toFixed(2)}m [${status}] (${new Date(r.recorded_at).toLocaleTimeString('en-GB')})`)
    }
  }

  if (weatherRes.status === 'fulfilled' && weatherRes.value.rows.length > 0) {
    parts.push('WEATHER CONDITIONS:')
    for (const r of weatherRes.value.rows) {
      parts.push(`  ${r.location_name}: ${r.temperature_c}°C, Wind ${r.wind_speed_ms}m/s, Humidity ${r.humidity_pct}%, Rain ${r.precipitation_mm}mm`)
    }
  }

  if (threatRes.status === 'fulfilled' && threatRes.value.rows.length > 0 && threatRes.value.rows[0].threat_level) {
    parts.push(`CURRENT THREAT LEVEL: ${threatRes.value.rows[0].threat_level} (score: ${threatRes.value.rows[0].threat_score || 'N/A'})`)
    if (threatRes.value.rows[0].assessment_summary) {
      parts.push(`  Summary: ${threatRes.value.rows[0].assessment_summary}`)
    }
  }

  // Situational awareness
  const situationalParts: string[] = []

  if (trendRes.status === 'fulfilled' && trendRes.value.rows.length > 0) {
    const recent = parseInt(trendRes.value.rows[0].recent_count) || 0
    const previous = parseInt(trendRes.value.rows[0].previous_count) || 0
    let trendDirection = 'STABLE'
    if (recent > previous + 1) trendDirection = 'WORSENING — alert count increasing'
    else if (recent < previous - 1) trendDirection = 'IMPROVING — alert count decreasing'
    situationalParts.push(`  Threat trend (6h): ${trendDirection} (${recent} recent vs ${previous} previous alerts)`)
  }

  if (exposureRes.status === 'fulfilled') {
    for (const r of exposureRes.value.rows) {
      const pop = parseInt(r.estimated_population) || 0
      if (pop > 0) {
        const prob = typeof r.probability === 'number'
          ? (r.probability > 1 ? r.probability : (r.probability * 100)).toFixed(0)
          : '?'
        situationalParts.push(`  Population exposure: ~${pop.toLocaleString()} people in ${r.region_name} (${prob}% flood probability)`)
      }
    }
  }

  if (shelterRes.status === 'fulfilled' && shelterRes.value.rows.length > 0 && parseInt(shelterRes.value.rows[0].total_shelters) > 0) {
    const total = parseInt(shelterRes.value.rows[0].total_capacity) || 0
    const occupied = parseInt(shelterRes.value.rows[0].total_occupancy) || 0
    const available = total - occupied
    const utilizationPct = total > 0 ? ((occupied / total) * 100).toFixed(0) : '0'
    situationalParts.push(`  Shelter capacity: ${available.toLocaleString()} spaces available across ${shelterRes.value.rows[0].total_shelters} shelters (${utilizationPct}% utilized)`)
  }

  if (clusterRes.status === 'fulfilled' && clusterRes.value.rows.length > 0) {
    const clusterSummary = clusterRes.value.rows.map((r: any) => `${r.incident_type}: ${r.cnt}`).join(', ')
    situationalParts.push(`  Active incidents (24h): ${clusterSummary}`)
  }

  if (situationalParts.length > 0) {
    parts.push('SITUATIONAL AWARENESS SUMMARY:')
    parts.push(...situationalParts)
  }

  if (parts.length === 0) return ''

  return '\n\n--- LIVE SITUATIONAL AWARENESS (as of ' + now + ') ---\n' +
    parts.join('\n') +
    '\n--- END SITUATIONAL AWARENESS ---\n' +
    'Use this data to provide informed, real-time responses. If a citizen asks about current conditions, reference this data directly.\n'
}

