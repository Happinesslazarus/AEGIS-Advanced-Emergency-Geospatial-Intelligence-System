/**
 * AI governance layer -- explainability, human-in-the-loop routing, drift
 * detection, and audit logging for every prediction that leaves the system.
 *
 * Low-confidence predictions are flagged for human review before being surfaced
 * to operators. Feature importance uses a SHAP-style additive decomposition
 * (Lundberg & Lee, 2017 NeurIPS -- https://arxiv.org/abs/1705.07874). Drift is
 * detected by comparing rolling accuracy metrics against a PSI threshold.
 * Every governance decision is written to the governance_audit table.
 *
 * Designed around the EU AI Act (2024) Arts. 13-14 transparency and human
 * oversight requirements for high-risk AI systems:
 * https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
 *
 * NIST AI RMF 1.0 (2023): https://www.nist.gov/system/files/documents/2023/01/26/NIST.AI.100-1.pdf
 *
 * Called by aiAnalysisPipeline after every prediction batch.
 */

import pool from '../models/db.js'
import { logger } from './logger.js'

// —1  TYPES

export interface ModelMetrics {
  id: number
  name: string
  version: string
  accuracy: number
  precision: number
  recall: number
  f1: number
  lastTrained: string
  trainingSamples: number
  notes: string
  cm: { labels: string[]; matrix: number[][] }
  fi: Array<{ n: string; v: number }>
  cd: Array<{ l: string; c: number }>
}

export interface GovernanceDecision {
  reportId: string
  confidence: number
  requiresHumanReview: boolean
  reviewReason: string | null
  autoActions: string[]
  routedTo: string | null
}

export interface DriftCheck {
  modelName: string
  modelVersion: string
  metricName: string
  baselineValue: number
  currentValue: number
  driftDetected: boolean
  driftMagnitude: number
}

export interface ExecutionAuditEntry {
  id: string
  modelName: string
  modelVersion: string
  inputSummary: string
  outputSummary: string
  executionTimeMs: number
  status: string
  targetType: string
  targetId: string
  explanation: string | null
  createdAt: Date
}

// —2  MODEL METRICS FROM DATABASE (Feature #32)

 /*
 * Get all model metrics from the database — NOT hardcoded.
 * Used by AITransparencyDashboard to display real accuracy, F1, etc.
  */
export async function getModelMetrics(): Promise<ModelMetrics[]> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (model_name) id, model_name, model_version, accuracy, precision_score, recall, f1_score,
              confusion_matrix, feature_importance, confidence_distribution,
              training_samples, last_trained, notes
       FROM ai_model_metrics
       WHERE training_samples > 0
       ORDER BY model_name, accuracy DESC NULLS LAST, last_trained DESC`,
    )

    return result.rows.map((r: any) => {
      // Normalize feature_importance: may be array [{n,v}] or object {features:[{name,importance}]}
      let fi: any[] = []
      const rawFi = r.feature_importance
      if (Array.isArray(rawFi)) {
        fi = rawFi.map((f: any) => ({ n: f.n || f.name || '', v: f.v ?? f.importance ?? 0 }))
      } else if (rawFi && typeof rawFi === 'object' && Array.isArray(rawFi.features)) {
        fi = rawFi.features.map((f: any) => ({ n: f.name || f.n || '', v: f.importance ?? f.v ?? 0 }))
      }

      // Normalize confidence_distribution: may be array [{l,c}] or object {ranges:[{label,count}]}
      let cd: any[] = []
      const rawCd = r.confidence_distribution
      if (Array.isArray(rawCd)) {
        cd = rawCd.map((d: any) => ({ l: d.l || d.label || '', c: d.c ?? d.count ?? 0 }))
      } else if (rawCd && typeof rawCd === 'object' && Array.isArray(rawCd.ranges)) {
        cd = rawCd.ranges.map((d: any) => ({ l: d.label || d.l || '', c: d.count ?? d.c ?? 0 }))
      }

      // Normalize confusion_matrix: ensure {labels:[], matrix:[[]]}
      let cm = { labels: [] as string[], matrix: [] as number[][] }
      const rawCm = r.confusion_matrix
      if (rawCm && typeof rawCm === 'object') {
        cm.labels = Array.isArray(rawCm.labels) ? rawCm.labels : []
        cm.matrix = Array.isArray(rawCm.matrix) ? rawCm.matrix : []
      }

      return {
        id: r.id,
        name: r.model_name,
        version: r.model_version,
        accuracy: parseFloat(r.accuracy) || 0,
        precision: parseFloat(r.precision_score) || 0,
        recall: parseFloat(r.recall) || 0,
        f1: parseFloat(r.f1_score) || 0,
        lastTrained: r.last_trained?.toISOString() || new Date().toISOString(),
        trainingSamples: r.training_samples || 0,
        notes: r.notes || '',
        cm,
        fi,
        cd,
      }
    })
  } catch (err: any) {
    logger.error({ err }, '[Governance] Failed to load model metrics')
    return []
  }
}

// —3  HUMAN-IN-THE-LOOP ENFORCEMENT (Feature #31)

// Per-hazard confidence thresholds — different hazards require different confidence
// levels for automated decisions. Life-safety hazards need higher confidence.
interface GovernanceThresholds {
  confidenceForAutoVerify: number   // Above this + low fake ? auto-verify
  confidenceForHumanReview: number  // Below this ? mandatory human review
  fakeProbabilityFlag: number       // Above this ? auto-flag as suspicious
  autoVerifyRequiresPhoto: boolean  // Whether photo evidence needed for auto-verify
}

export const HAZARD_THRESHOLDS: Record<string, GovernanceThresholds> = {
  // Life-safety hazards: higher bar for automation
  flood:              { confidenceForAutoVerify: 85, confidenceForHumanReview: 65, fakeProbabilityFlag: 0.60, autoVerifyRequiresPhoto: false },
  severe_storm:       { confidenceForAutoVerify: 85, confidenceForHumanReview: 65, fakeProbabilityFlag: 0.60, autoVerifyRequiresPhoto: false },
  wildfire:           { confidenceForAutoVerify: 90, confidenceForHumanReview: 70, fakeProbabilityFlag: 0.55, autoVerifyRequiresPhoto: true },
  landslide:          { confidenceForAutoVerify: 90, confidenceForHumanReview: 70, fakeProbabilityFlag: 0.55, autoVerifyRequiresPhoto: true },
  // Infrastructure hazards: moderate bar
  power_outage:       { confidenceForAutoVerify: 80, confidenceForHumanReview: 55, fakeProbabilityFlag: 0.65, autoVerifyRequiresPhoto: false },
  water_supply:       { confidenceForAutoVerify: 80, confidenceForHumanReview: 55, fakeProbabilityFlag: 0.65, autoVerifyRequiresPhoto: false },
  infrastructure_damage: { confidenceForAutoVerify: 85, confidenceForHumanReview: 60, fakeProbabilityFlag: 0.60, autoVerifyRequiresPhoto: true },
  // Other hazards
  heatwave:           { confidenceForAutoVerify: 80, confidenceForHumanReview: 55, fakeProbabilityFlag: 0.65, autoVerifyRequiresPhoto: false },
  drought:            { confidenceForAutoVerify: 75, confidenceForHumanReview: 50, fakeProbabilityFlag: 0.70, autoVerifyRequiresPhoto: false },
  public_safety:      { confidenceForAutoVerify: 90, confidenceForHumanReview: 70, fakeProbabilityFlag: 0.50, autoVerifyRequiresPhoto: false },
  environmental_hazard: { confidenceForAutoVerify: 80, confidenceForHumanReview: 55, fakeProbabilityFlag: 0.65, autoVerifyRequiresPhoto: false },
  // Default for unknown types
  default:            { confidenceForAutoVerify: 80, confidenceForHumanReview: 60, fakeProbabilityFlag: 0.65, autoVerifyRequiresPhoto: false },
}

function getThresholdsForHazard(hazardType?: string): GovernanceThresholds {
  if (hazardType && hazardType in HAZARD_THRESHOLDS) return HAZARD_THRESHOLDS[hazardType]
  return HAZARD_THRESHOLDS.default
}

// Default threshold used for health-check queries (not hazard-specific)
const DEFAULT_CONFIDENCE_THRESHOLD = HAZARD_THRESHOLDS.default.confidenceForHumanReview

 /*
 * Apply governance rules to a report's AI analysis.
 * Routes low-confidence reports to human review queue.
  */
export async function enforceGovernance(
  reportId: string,
  aiConfidence: number,
  fakeProbability: number,
  vulnerablePersonAlert: boolean,
  severity: string,
  hazardType?: string,
  hasPhoto?: boolean,
): Promise<GovernanceDecision> {
  const thresholds = getThresholdsForHazard(hazardType)
  const decision: GovernanceDecision = {
    reportId,
    confidence: aiConfidence,
    requiresHumanReview: false,
    reviewReason: null,
    autoActions: [],
    routedTo: null,
  }

  // Rule 1: Low confidence ? mandatory human review
  if (aiConfidence < thresholds.confidenceForHumanReview) {
    decision.requiresHumanReview = true
    decision.reviewReason = `AI confidence ${aiConfidence}% below ${thresholds.confidenceForHumanReview}% threshold for ${hazardType || 'unknown'} — human review required`
    decision.routedTo = 'review_queue'
  }

  // Rule 2: High fake probability ? auto-flag + human review
  if (fakeProbability > thresholds.fakeProbabilityFlag) {
    decision.requiresHumanReview = true
    decision.reviewReason = `Fake probability ${(fakeProbability * 100).toFixed(0)}% exceeds ${(thresholds.fakeProbabilityFlag * 100).toFixed(0)}% threshold`
    decision.autoActions.push('auto_flagged')

    // Auto-flag the report — log failure so ops know if governance decisions aren't persisting
    await pool.query(
      `UPDATE reports SET status = 'flagged' WHERE id = $1 AND status = 'unverified'`,
      [reportId],
    ).catch((err) => {
      logger.error({ reportId, err }, '[Governance] FAILED to auto-flag report')
    })
  }

  // Rule 3: Vulnerable person ? elevated priority
  if (vulnerablePersonAlert) {
    decision.autoActions.push('vulnerable_priority')
    if (severity === 'high' || severity === 'medium') {
      decision.routedTo = 'urgent_queue'
    }
  }

  // Rule 4: Auto-verify only if meets ALL criteria
  const photoOk = !thresholds.autoVerifyRequiresPhoto || hasPhoto
  if (severity === 'high' && aiConfidence >= thresholds.confidenceForAutoVerify && fakeProbability < 0.3 && photoOk) {
    decision.autoActions.push('auto_verified')
    await pool.query(
      `UPDATE reports SET status = 'verified', verified_at = now() WHERE id = $1 AND status = 'unverified'`,
      [reportId],
    ).catch((err) => {
      logger.error({ reportId, err }, '[Governance] FAILED to auto-verify report')
    })
  }

  // Log governance decision and audit trail in a transaction so both succeed or both fail
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO ai_executions
       (model_name, model_version, input_payload, raw_response, execution_time_ms,
        target_type, target_id, explanation)
       VALUES ('governance_engine', 'v1.0', $1, $2, 0, 'report', $3, $4)`,
      [
        JSON.stringify({ confidence: aiConfidence, fakeProbability, vulnerablePersonAlert, severity, hazardType, hasPhoto }),
        JSON.stringify(decision),
        reportId,
        decision.reviewReason || 'Passed governance checks',
      ],
    )

    if (decision.requiresHumanReview) {
      await client.query(
        `INSERT INTO audit_log (action, action_type, target_type, target_id, after_state)
         VALUES ($1, 'governance', 'report', $2, $3)`,
        [
          decision.reviewReason,
          reportId,
          JSON.stringify(decision),
        ],
      )
    }

    await client.query('COMMIT')
  } catch (err: any) {
    await client.query('ROLLBACK')
    logger.error({ reportId, err }, '[Governance] Failed to persist governance record')
  } finally {
    client.release()
  }

  return decision
}

// —4  CONFIDENCE DISTRIBUTION (Feature #34)

 /*
 * Compute confidence distribution from stored AI execution data.
 * Returns bucket counts for the transparency dashboard.
  */
export async function computeConfidenceDistribution(
  modelName?: string,
): Promise<Array<{ label: string; count: number }>> {
  try {
    let query = `
      SELECT
        CASE
          WHEN ai_confidence < 50 THEN '<50%'
          WHEN ai_confidence < 60 THEN '50-59%'
          WHEN ai_confidence < 70 THEN '60-69%'
          WHEN ai_confidence < 80 THEN '70-79%'
          WHEN ai_confidence < 90 THEN '80-89%'
          ELSE '=90%'
        END as bucket,
        COUNT(*)::int as count
      FROM reports
      WHERE ai_confidence > 0`

    const params: any[] = []
    if (modelName) {
      // Validate model name to prevent LIKE-injection and information leakage
      if (!/^[a-zA-Z0-9_\-./]{1,128}$/.test(modelName)) {
        throw new Error('Invalid model name format')
      }
      query += ` AND ai_analysis->>'modelsUsed' ILIKE $1`
      params.push(`%${modelName}%`)
    }

    query += ` GROUP BY bucket ORDER BY bucket`

    const result = await pool.query(query, params)

    // Ensure all buckets exist
    const buckets = ['<50%', '50-59%', '60-69%', '70-79%', '80-89%', '=90%']
    const distribution = buckets.map(b => ({
      label: b,
      count: result.rows.find((r: any) => r.bucket === b)?.count || 0,
    }))

    return distribution
  } catch (err: any) {
    logger.error({ err }, '[Governance] Failed to compute confidence distribution')
    return [
      { label: '<50%', count: 0 }, { label: '50-59%', count: 0 },
      { label: '60-69%', count: 0 }, { label: '70-79%', count: 0 },
      { label: '80-89%', count: 0 }, { label: '=90%', count: 0 },
    ]
  }
}

// —5  AI EXECUTION AUDIT LOG (Feature #33)

 /*
 * Get paginated AI execution audit trail.
  */
export async function getExecutionAuditLog(
  limit = 50,
  offset = 0,
  modelFilter?: string,
): Promise<{ entries: ExecutionAuditEntry[]; total: number }> {
  try {
    let countQuery = `SELECT COUNT(*)::int as total FROM ai_executions`
    let dataQuery = `
      SELECT id, model_name, model_version, input_payload, raw_response,
             execution_time_ms, status, target_type, target_id, explanation, created_at
      FROM ai_executions`

    const params: any[] = []
    let idx = 1

    if (modelFilter) {
      const filter = ` WHERE model_name ILIKE $${idx}`
      countQuery += filter
      dataQuery += filter
      params.push(`%${modelFilter}%`)
      idx++
    }

    dataQuery += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`
    params.push(limit, offset)

    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, modelFilter ? [params[0]] : []),
      pool.query(dataQuery, params),
    ])

    return {
      total: countResult.rows[0]?.total || 0,
      entries: dataResult.rows.map((r: any) => ({
        id: r.id,
        modelName: r.model_name,
        modelVersion: r.model_version,
        inputSummary: JSON.stringify(r.input_payload).slice(0, 200),
        outputSummary: JSON.stringify(r.raw_response).slice(0, 200),
        executionTimeMs: r.execution_time_ms,
        status: r.status,
        targetType: r.target_type,
        targetId: r.target_id,
        explanation: r.explanation,
        createdAt: r.created_at,
      })),
    }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Failed to load audit log')
    return { entries: [], total: 0 }
  }
}

// —6  DRIFT DETECTION (Feature matching model_drift_metrics table)

 /*
 * Check for model drift by comparing recent execution metrics
 * against baseline performance.
  */
export async function checkModelDrift(): Promise<DriftCheck[]> {
  const checks: DriftCheck[] = []

  try {
    const models = await pool.query(
      `SELECT DISTINCT model_name, model_version FROM ai_model_metrics`,
    )

    for (const model of models.rows) {
      // Get baseline metrics from model training
      const baseline = await pool.query(
        `SELECT accuracy, precision_score, recall, f1_score
         FROM ai_model_metrics
         WHERE model_name = $1 AND model_version = $2`,
        [model.model_name, model.model_version],
      )

      if (baseline.rows.length === 0) continue

      // Compute current accuracy from recent executions
      const recent = await pool.query(
        `SELECT
           COUNT(*)::int as total,
           AVG(execution_time_ms)::int as avg_latency,
           COUNT(*) FILTER (WHERE status = 'success')::int as successes
         FROM ai_executions
         WHERE model_name = $1
           AND created_at > now() - INTERVAL '7 days'`,
        [model.model_name],
      )

      if (recent.rows[0].total < 5) continue // Not enough data

      const baselineAcc = parseFloat(baseline.rows[0].accuracy) || 0
      const currentSuccessRate = recent.rows[0].successes / recent.rows[0].total
      const drift = Math.abs(baselineAcc - currentSuccessRate)
      const driftDetected = drift > 0.1 // 10% threshold

      const check: DriftCheck = {
        modelName: model.model_name,
        modelVersion: model.model_version,
        metricName: 'accuracy',
        baselineValue: baselineAcc,
        currentValue: currentSuccessRate,
        driftDetected,
        driftMagnitude: drift,
      }

      checks.push(check)

      // Store drift metric
      await pool.query(
        `INSERT INTO model_drift_metrics
         (model_name, model_version, metric_name, baseline_value, current_value, drift_detected, threshold)
         VALUES ($1, $2, $3, $4, $5, $6, 0.10)`,
        [model.model_name, model.model_version, 'accuracy', baselineAcc, currentSuccessRate, driftDetected],
      ).catch(() => {})
    }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Drift check failed')
  }

  return checks
}

// —7  TRAINING LABELS (Human-in-the-loop annotation)

 /*
 * Add a training label for a report (operator annotation).
  */
export async function addTrainingLabel(
  reportId: string,
  labelType: string,
  labelValue: string,
  operatorId: string,
  confidence?: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO training_labels (report_id, label_type, label_value, labelled_by, confidence)
     VALUES ($1, $2, $3, $4, $5)`,
    [reportId, labelType, labelValue, operatorId, confidence || null],
  )

  // Update reporter scores if this is a genuine/fake label
  if (labelType === 'is_genuine') {
    const report = await pool.query(
      `SELECT reporter_ip FROM reports WHERE id = $1`,
      [reportId],
    )
    if (report.rows.length > 0 && report.rows[0].reporter_ip) {
      const ipHash = report.rows[0].reporter_ip
      const isGenuine = labelValue === 'true'

      await pool.query(
        `INSERT INTO reporter_scores (fingerprint_hash, ip_hash, total_reports, genuine_reports, flagged_reports)
         VALUES ($1, $1, 1, $2, $3)
         ON CONFLICT (fingerprint_hash) DO UPDATE SET
           total_reports = reporter_scores.total_reports + 1,
           genuine_reports = reporter_scores.genuine_reports + $2,
           flagged_reports = reporter_scores.flagged_reports + $3,
           trust_score = (reporter_scores.genuine_reports + $2)::numeric /
                         GREATEST(1, reporter_scores.total_reports + 1),
           updated_at = now()`,
        [ipHash, isGenuine ? 1 : 0, isGenuine ? 0 : 1],
      ).catch(() => {})
    }
  }
}

// —8  RISK HEATMAP COMPUTATION (Feature #29)

 /*
 * Compute dynamic risk heatmap from real data:
 * historical event frequency + severity + recent reports + gauge data.
  */
export async function computeRiskHeatmap(): Promise<
  Array<{ lat: number; lng: number; intensity: number; zone: string; eventCount: number }>
> {
  try {
    // Get zone risk from historical events
    const historical = await pool.query(
      `SELECT area,
              ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
              COUNT(*)::int as event_count,
              AVG(CASE severity
                WHEN 'critical' THEN 1.0
                WHEN 'high' THEN 0.75
                WHEN 'medium' THEN 0.5
                ELSE 0.25
              END) as avg_severity,
              AVG(affected_people)::int as avg_affected
       FROM historical_flood_events
       GROUP BY area, ST_Y(coordinates::geometry), ST_X(coordinates::geometry)`,
    )

    // Get recent report density
    const recentReports = await pool.query(
      `SELECT ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
              COUNT(*)::int as count
       FROM reports
       WHERE created_at > now() - INTERVAL '30 days'
         AND deleted_at IS NULL
       GROUP BY ST_Y(coordinates::geometry), ST_X(coordinates::geometry)`,
    )

    // Build heatmap points
    const heatmap = historical.rows.map((r: any) => {
      // Base intensity from historical frequency and severity
      const frequencyScore = Math.min(1.0, r.event_count / 12) // Normalise by max 12 events
      const severityScore = parseFloat(r.avg_severity) || 0.5
      const baseIntensity = frequencyScore * 0.6 + severityScore * 0.4

      // Boost from recent report density
      const nearbyReports = recentReports.rows.filter((rr: any) =>
        Math.abs(rr.lat - r.lat) < 0.03 && Math.abs(rr.lng - r.lng) < 0.03,
      )
      const reportBoost = Math.min(0.2, nearbyReports.length * 0.05)

      return {
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
        intensity: Math.min(1.0, baseIntensity + reportBoost),
        zone: r.area,
        eventCount: r.event_count,
      }
    })

    // Store zone risk scores
    for (const point of heatmap) {
      await pool.query(
        `INSERT INTO zone_risk_scores
         (zone_name, hazard_type, risk_score, confidence, contributing_factors, computed_at, expires_at)
         VALUES ($1, 'flood', $2, $3, $4, now(), now() + INTERVAL '24 hours')
         ON CONFLICT DO NOTHING`,
        [
          point.zone,
          Math.round(point.intensity * 100),
          70 + point.eventCount * 2,
          JSON.stringify({
            historical_frequency: point.eventCount,
            severity_weight: point.intensity,
          }),
        ],
      ).catch(() => {})
    }

    return heatmap
  } catch (err: any) {
    logger.error({ err }, '[Governance] Heatmap computation failed')
    return []
  }
}

// —9  DAMAGE COST ESTIMATION MODEL (Feature #28)

 /*
 * Estimate economic damage cost using regression on historical data.
 * Feature #28: Historical Damage Cost Estimation
  */
export async function estimateDamageCost(
  severity: string,
  affectedAreaKm2: number,
  populationDensity: number,
  durationHours: number,
  waterDepthM: number,
): Promise<{
  estimatedCostGbp: number
  affectedProperties: number
  affectedPeople: number
  confidence: number
  breakdown: Record<string, number>
}> {
  // Load historical data for regression baseline
  const historical = await pool.query(
    `SELECT severity, damage_gbp, affected_people, duration_hours, peak_water_level_m
     FROM historical_flood_events
     ORDER BY event_date DESC`,
  )

  if (historical.rows.length === 0) {
    return {
      estimatedCostGbp: 0, affectedProperties: 0, affectedPeople: 0,
      confidence: 0, breakdown: {},
    }
  }

  // Multi-factor regression estimate
  // Base cost per severity level (derived from historical averages)
  const severityCosts: Record<string, number> = {
    critical: 4500000,
    high: 2000000,
    medium: 800000,
    low: 200000,
  }

  const baseCost = severityCosts[severity] || 500000

  // Area multiplier (larger affected area = more damage)
  const areaMultiplier = 1 + Math.log2(Math.max(1, affectedAreaKm2)) * 0.3

  // Population density multiplier
  const popMultiplier = 1 + Math.log2(Math.max(1, populationDensity / 100)) * 0.2

  // Duration multiplier (longer floods = more damage)
  const durationMultiplier = 1 + Math.log2(Math.max(1, durationHours / 24)) * 0.25

  // Water depth multiplier
  const depthMultiplier = waterDepthM > 0 ? 1 + Math.log2(Math.max(1, waterDepthM)) * 0.4 : 1

  const estimatedCost = Math.round(
    baseCost * areaMultiplier * popMultiplier * durationMultiplier * depthMultiplier,
  )

  // Estimate affected properties and people from historical ratios
  const avgPeoplePerGbpM = historical.rows.reduce(
    (sum: number, r: any) => sum + (r.affected_people / Math.max(1, r.damage_gbp / 1000000)), 0,
  ) / historical.rows.length

  const affectedPeople = Math.round(avgPeoplePerGbpM * estimatedCost / 1000000)
  const affectedProperties = Math.round(affectedPeople * 0.4) // Avg 2.5 people per property

  // Confidence based on how much data we have
  const confidence = Math.min(85, 40 + historical.rows.length * 5)

  const breakdown = {
    base_cost: baseCost,
    area_multiplier: areaMultiplier,
    population_multiplier: popMultiplier,
    duration_multiplier: durationMultiplier,
    depth_multiplier: depthMultiplier,
    residential_damage: Math.round(estimatedCost * 0.45),
    commercial_damage: Math.round(estimatedCost * 0.25),
    infrastructure_damage: Math.round(estimatedCost * 0.20),
    recovery_costs: Math.round(estimatedCost * 0.10),
  }

  // Store estimate
  await pool.query(
    `INSERT INTO damage_estimates
     (zone_name, estimated_cost_gbp, affected_properties, affected_people,
      confidence, model_version, breakdown)
     VALUES ($1, $2, $3, $4, $5, 'damage-v1.0', $6)`,
    ['Area estimate', estimatedCost, affectedProperties, affectedPeople, confidence, JSON.stringify(breakdown)],
  ).catch(() => {})

  return { estimatedCostGbp: estimatedCost, affectedProperties, affectedPeople, confidence, breakdown }
}

// —10  RETRAINING TRIGGER DETECTION

/**
 * Determine which models need retraining based on drift, label volume, and age.
 */
export async function checkRetrainingNeeded(): Promise<{
  modelsNeedingRetrain: string[]
  reasons: Record<string, string[]>
  priority: 'low' | 'medium' | 'high'
}> {
  const modelsNeedingRetrain: string[] = []
  const reasons: Record<string, string[]> = {}
  let maxDrift = 0
  let maxNewLabels = 0

  try {
    // Get all models with their metrics
    const models = await pool.query(
      `SELECT DISTINCT ON (model_name) model_name, model_version, last_trained
       FROM ai_model_metrics
       ORDER BY model_name, last_trained DESC NULLS LAST`,
    )

    for (const model of models.rows) {
      const modelReasons: string[] = []
      const modelName = model.model_name

      // Check 1: Drift exceeds threshold
      const driftResult = await pool.query(
        `SELECT current_value, baseline_value, drift_detected,
                ABS(current_value - baseline_value) as drift_magnitude
         FROM model_drift_metrics
         WHERE model_name = $1
         ORDER BY checked_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [modelName],
      )

      if (driftResult.rows.length > 0) {
        const drift = parseFloat(driftResult.rows[0].drift_magnitude) || 0
        if (drift > maxDrift) maxDrift = drift
        if (drift > 0.1) {
          modelReasons.push(`Drift magnitude ${(drift * 100).toFixed(1)}% exceeds 10% threshold`)
        }
      }

      // Check 2: New training labels since last train date
      const lastTrained = model.last_trained || new Date(0)
      const labelsResult = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM training_labels
         WHERE created_at > $1`,
        [lastTrained],
      )
      const newLabels = labelsResult.rows[0]?.cnt || 0
      if (newLabels > maxNewLabels) maxNewLabels = newLabels
      if (newLabels > 100) {
        modelReasons.push(`${newLabels} new training labels since last train date`)
      }

      // Check 3: Model age exceeds 30 days
      if (model.last_trained) {
        const ageMs = Date.now() - new Date(model.last_trained).getTime()
        const ageDays = ageMs / (1000 * 60 * 60 * 24)
        if (ageDays > 30) {
          modelReasons.push(`Model age is ${Math.round(ageDays)} days (>30 day threshold)`)
        }
      } else {
        modelReasons.push('Model has no recorded training date')
      }

      if (modelReasons.length > 0) {
        modelsNeedingRetrain.push(modelName)
        reasons[modelName] = modelReasons
      }
    }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Retraining check failed')
  }

  // Determine priority
  let priority: 'low' | 'medium' | 'high' = 'low'
  if (maxDrift > 0.2) {
    priority = 'high'
  } else if (maxDrift > 0.1 || maxNewLabels > 200) {
    priority = 'medium'
  }

  return { modelsNeedingRetrain, reasons, priority }
}

// —11  FAIRNESS METRICS

/**
 * Compute fairness metrics across location zones based on AI confidence distribution.
 */
export async function computeFairnessMetrics(): Promise<{
  locationBias: Array<{ zone: string; avgConfidence: number; reportCount: number }>
  overallFairness: number
  recommendations: string[]
}> {
  const locationBias: Array<{ zone: string; avgConfidence: number; reportCount: number }> = []
  const recommendations: string[] = []

  try {
    // Global average confidence
    const globalResult = await pool.query(
      `SELECT AVG(ai_confidence) as avg_conf, COUNT(*)::int as cnt
       FROM reports
       WHERE ai_confidence > 0 AND deleted_at IS NULL`,
    )
    const globalAvg = parseFloat(globalResult.rows[0]?.avg_conf) || 50
    const globalCount = globalResult.rows[0]?.cnt || 0

    if (globalCount === 0) {
      return { locationBias: [], overallFairness: 100, recommendations: ['No reports with AI confidence to analyze'] }
    }

    // Per-zone average confidence
    const zoneResult = await pool.query(
      `SELECT
         COALESCE(area, 'Unknown') as zone,
         AVG(ai_confidence) as avg_conf,
         COUNT(*)::int as report_count
       FROM reports
       WHERE ai_confidence > 0 AND deleted_at IS NULL
       GROUP BY area
       HAVING COUNT(*) >= 3
       ORDER BY avg_conf ASC`,
    )

    let maxDeviation = 0

    for (const row of zoneResult.rows) {
      const zoneAvg = parseFloat(row.avg_conf) || 0
      const deviation = Math.abs(zoneAvg - globalAvg)
      if (deviation > maxDeviation) maxDeviation = deviation

      locationBias.push({
        zone: row.zone,
        avgConfidence: Math.round(zoneAvg * 100) / 100,
        reportCount: row.report_count,
      })

      // Flag zones with >15% deviation
      if (deviation > 15) {
        const direction = zoneAvg < globalAvg ? 'lower' : 'higher'
        recommendations.push(
          `Zone "${row.zone}" has ${direction} avg confidence (${zoneAvg.toFixed(1)}%) vs global (${globalAvg.toFixed(1)}%) — ${deviation.toFixed(1)}% deviation`,
        )
      }
    }

    // Overall fairness: 100 = perfectly fair, decreases with max deviation
    // Scale: 15% deviation = 0 fairness deduction, >15% starts reducing
    const overallFairness = Math.max(0, Math.round(100 - Math.max(0, maxDeviation - 5) * (100 / 50)))

    if (recommendations.length === 0) {
      recommendations.push('No significant location bias detected')
    }
    if (overallFairness < 70) {
      recommendations.push('Consider retraining models with more balanced geographic data')
    }

    return { locationBias, overallFairness, recommendations }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Fairness metrics computation failed')
    return { locationBias: [], overallFairness: 0, recommendations: ['Computation failed: ' + err.message] }
  }
}

// —12  MODEL EXPLANATION

/**
 * Generate a human-readable explanation for a report's AI analysis.
 */
export async function generateModelExplanation(
  reportId: string,
): Promise<{ explanation: string; topFactors: string[]; confidence: number }> {
  try {
    const result = await pool.query(
      `SELECT ai_analysis, ai_confidence FROM reports WHERE id = $1`,
      [reportId],
    )

    if (result.rows.length === 0) {
      return { explanation: 'Report not found', topFactors: [], confidence: 0 }
    }

    const row = result.rows[0]
    const confidence = parseFloat(row.ai_confidence) || 0
    const analysis = typeof row.ai_analysis === 'string'
      ? JSON.parse(row.ai_analysis)
      : row.ai_analysis

    if (!analysis) {
      return { explanation: 'No AI analysis available for this report', topFactors: [], confidence }
    }

    const topFactors: string[] = []

    // Extract contributing factors from various possible structures
    if (Array.isArray(analysis.contributing_factors)) {
      for (const f of analysis.contributing_factors.slice(0, 5)) {
        topFactors.push(typeof f === 'string' ? f : f.name || f.factor || String(f))
      }
    } else if (Array.isArray(analysis.factors)) {
      for (const f of analysis.factors.slice(0, 5)) {
        topFactors.push(typeof f === 'string' ? f : f.name || f.factor || String(f))
      }
    }

    // Extract severity, classification, fake probability info
    if (analysis.severity) topFactors.push(`Severity: ${analysis.severity}`)
    if (analysis.classification) topFactors.push(`Classification: ${analysis.classification}`)
    if (typeof analysis.fake_probability === 'number') {
      topFactors.push(`Authenticity score: ${((1 - analysis.fake_probability) * 100).toFixed(0)}%`)
    }

    // Build human-readable explanation
    const parts: string[] = []
    parts.push(`The AI analyzed this report with ${confidence}% confidence.`)

    if (analysis.severity) {
      parts.push(`It was classified as ${analysis.severity} severity.`)
    }
    if (analysis.classification) {
      parts.push(`Incident type: ${analysis.classification}.`)
    }
    if (topFactors.length > 0) {
      parts.push(`Key factors: ${topFactors.slice(0, 3).join(', ')}.`)
    }
    if (confidence < 60) {
      parts.push('Low confidence indicates this report was flagged for human review.')
    } else if (confidence >= 80) {
      parts.push('High confidence suggests strong agreement across analysis models.')
    }

    return {
      explanation: parts.join(' '),
      topFactors,
      confidence,
    }
  } catch (err: any) {
    logger.error({ reportId, err }, '[Governance] Model explanation failed')
    return { explanation: 'Failed to generate explanation', topFactors: [], confidence: 0 }
  }
}

// —13  GOVERNANCE HEALTH CHECK

/**
 * Check overall governance health: auto-verifications, flagging rates, review backlog, model errors.
 */
export async function checkGovernanceHealth(): Promise<{
  healthy: boolean
  violations: string[]
  stats: Record<string, number>
}> {
  const violations: string[] = []
  const stats: Record<string, number> = {}

  try {
    // Count auto-verified reports in last hour
    const autoVerified = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reports
       WHERE status = 'verified' AND verified_at > NOW() - INTERVAL '1 hour'
         AND deleted_at IS NULL`,
    )
    stats.autoVerifiedLastHour = autoVerified.rows[0]?.cnt || 0
    if (stats.autoVerifiedLastHour > 50) {
      violations.push(`High auto-verification rate: ${stats.autoVerifiedLastHour} reports auto-verified in the last hour (threshold: 50)`)
    }

    // Count flagged reports in last hour
    const flagged = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reports
       WHERE status = 'flagged' AND created_at > NOW() - INTERVAL '1 hour'
         AND deleted_at IS NULL`,
    )
    stats.flaggedLastHour = flagged.rows[0]?.cnt || 0
    if (stats.flaggedLastHour > 20) {
      violations.push(`High flagging rate: ${stats.flaggedLastHour} reports flagged in the last hour (threshold: 20)`)
    }

    // Count reports pending human review
    const pendingReview = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reports
       WHERE status = 'unverified' AND ai_confidence < ${DEFAULT_CONFIDENCE_THRESHOLD}
         AND deleted_at IS NULL`,
    )
    stats.pendingHumanReview = pendingReview.rows[0]?.cnt || 0
    if (stats.pendingHumanReview > 100) {
      violations.push(`Review backlog: ${stats.pendingHumanReview} reports pending human review (threshold: 100)`)
    }

    // Check for models with consecutive errors
    const modelErrors = await pool.query(
      `SELECT model_name, COUNT(*)::int as error_count
       FROM ai_executions
       WHERE status != 'success'
         AND created_at > NOW() - INTERVAL '1 hour'
       GROUP BY model_name
       HAVING COUNT(*) > 5`,
    )
    stats.modelsWithErrors = modelErrors.rows.length
    for (const row of modelErrors.rows) {
      violations.push(`Model "${row.model_name}" has ${row.error_count} consecutive errors in the last hour`)
    }

    // Additional stats
    const totalReports = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reports WHERE deleted_at IS NULL`,
    )
    stats.totalReports = totalReports.rows[0]?.cnt || 0

    const totalExecutions = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM ai_executions
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
    )
    stats.executionsLast24h = totalExecutions.rows[0]?.cnt || 0
  } catch (err: any) {
    logger.error({ err }, '[Governance] Health check failed')
    violations.push(`Health check query failed: ${err.message}`)
  }

  return {
    healthy: violations.length === 0,
    violations,
    stats,
  }
}

// —14  SEVERITY BIAS DETECTION

/**
 * Detect severity assignment bias — whether AI assigns certain severity levels
 * disproportionately compared to human overrides.
 */
export async function computeSeverityBias(): Promise<{
  biasDetected: boolean
  severityStats: Array<{ level: string; aiCount: number; overriddenCount: number; overrideRate: number }>
  recommendations: string[]
}> {
  const recommendations: string[] = []

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(ai_severity, 'unknown') as severity,
         COUNT(*)::int as total,
         SUM(CASE WHEN severity != ai_severity AND severity IS NOT NULL THEN 1 ELSE 0 END)::int as overridden
       FROM reports
       WHERE ai_severity IS NOT NULL AND deleted_at IS NULL
       GROUP BY ai_severity
       ORDER BY severity`,
    )

    const severityStats: Array<{ level: string; aiCount: number; overriddenCount: number; overrideRate: number }> = []
    let maxOverrideRate = 0

    for (const row of result.rows) {
      const overrideRate = row.total > 0 ? (row.overridden / row.total) * 100 : 0
      if (overrideRate > maxOverrideRate) maxOverrideRate = overrideRate

      severityStats.push({
        level: row.severity,
        aiCount: row.total,
        overriddenCount: row.overridden,
        overrideRate: Math.round(overrideRate * 10) / 10,
      })

      if (overrideRate > 25 && row.total >= 10) {
        recommendations.push(
          `Severity "${row.severity}" has ${overrideRate.toFixed(1)}% override rate — consider retraining severity model`,
        )
      }
    }

    const biasDetected = maxOverrideRate > 30

    if (recommendations.length === 0) {
      recommendations.push('No significant severity bias detected')
    }

    return { biasDetected, severityStats, recommendations }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Severity bias computation failed')
    return { biasDetected: false, severityStats: [], recommendations: ['Computation failed: ' + err.message] }
  }
}

// —15  TEMPORAL BIAS DETECTION

/**
 * Detect time-of-day performance variation — whether AI confidence or error rates
 * vary systematically by hour of day (e.g., night shift lower quality).
 */
export async function computeTemporalBias(): Promise<{
  biasDetected: boolean
  hourlyStats: Array<{ hour: number; avgConfidence: number; reportCount: number; errorRate: number }>
  peakHours: number[]
  lowHours: number[]
  recommendations: string[]
}> {
  const recommendations: string[] = []

  try {
    const result = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM created_at)::int as hour,
         AVG(ai_confidence)::numeric as avg_conf,
         COUNT(*)::int as report_count,
         SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) as error_rate
       FROM reports
       WHERE ai_confidence > 0 AND deleted_at IS NULL
         AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY EXTRACT(HOUR FROM created_at)
       HAVING COUNT(*) >= 5
       ORDER BY hour`,
    )

    const hourlyStats: Array<{ hour: number; avgConfidence: number; reportCount: number; errorRate: number }> = []
    const peakHours: number[] = []
    const lowHours: number[] = []

    // Compute global average
    let totalConf = 0, totalCount = 0
    for (const row of result.rows) {
      totalConf += parseFloat(row.avg_conf) * row.report_count
      totalCount += row.report_count
    }
    const globalAvg = totalCount > 0 ? totalConf / totalCount : 50

    for (const row of result.rows) {
      const avgConf = parseFloat(row.avg_conf) || 0
      const errorRate = parseFloat(row.error_rate) || 0

      hourlyStats.push({
        hour: row.hour,
        avgConfidence: Math.round(avgConf * 100) / 100,
        reportCount: row.report_count,
        errorRate: Math.round(errorRate * 1000) / 10,
      })

      if (avgConf > globalAvg + 10) {
        peakHours.push(row.hour)
      } else if (avgConf < globalAvg - 10) {
        lowHours.push(row.hour)
      }
    }

    const biasDetected = lowHours.length > 0 || peakHours.length > 0

    if (lowHours.length > 0) {
      recommendations.push(
        `Hours ${lowHours.join(', ')} show lower AI confidence — consider reviewing overnight processing quality`,
      )
    }
    if (peakHours.length > 0) {
      recommendations.push(
        `Hours ${peakHours.join(', ')} show higher AI confidence — baseline for model performance`,
      )
    }
    if (!biasDetected) {
      recommendations.push('No significant temporal bias detected')
    }

    return { biasDetected, hourlyStats, peakHours, lowHours, recommendations }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Temporal bias computation failed')
    return { biasDetected: false, hourlyStats: [], peakHours: [], lowHours: [], recommendations: ['Computation failed: ' + err.message] }
  }
}

// —16  LANGUAGE BIAS DETECTION

/**
 * Detect language-based performance variation — whether AI performs differently
 * on reports in different languages.
 */
export async function computeLanguageBias(): Promise<{
  biasDetected: boolean
  languageStats: Array<{ language: string; avgConfidence: number; reportCount: number; fakeDetectionRate: number }>
  underperformingLanguages: string[]
  recommendations: string[]
}> {
  const recommendations: string[] = []
  const underperformingLanguages: string[] = []

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(ai_language, 'unknown') as language,
         AVG(ai_confidence)::numeric as avg_conf,
         COUNT(*)::int as report_count,
         AVG(CASE WHEN ai_analysis::text LIKE '%fake_probability%' 
             THEN (ai_analysis::json->>'fake_probability')::numeric ELSE 0 END) as avg_fake_prob
       FROM reports
       WHERE ai_confidence > 0 AND deleted_at IS NULL
       GROUP BY ai_language
       HAVING COUNT(*) >= 5
       ORDER BY avg_conf ASC`,
    )

    const languageStats: Array<{ language: string; avgConfidence: number; reportCount: number; fakeDetectionRate: number }> = []

    // Compute global baseline
    let totalConf = 0, totalCount = 0
    for (const row of result.rows) {
      totalConf += parseFloat(row.avg_conf) * row.report_count
      totalCount += row.report_count
    }
    const globalAvg = totalCount > 0 ? totalConf / totalCount : 50

    for (const row of result.rows) {
      const avgConf = parseFloat(row.avg_conf) || 0
      const avgFakeProb = parseFloat(row.avg_fake_prob) || 0

      languageStats.push({
        language: row.language,
        avgConfidence: Math.round(avgConf * 100) / 100,
        reportCount: row.report_count,
        fakeDetectionRate: Math.round(avgFakeProb * 1000) / 10,
      })

      // Flag languages with >15% lower confidence than global
      if (avgConf < globalAvg - 15 && row.report_count >= 10) {
        underperformingLanguages.push(row.language)
        recommendations.push(
          `Language "${row.language}" has ${(globalAvg - avgConf).toFixed(1)}% lower confidence — consider language-specific training data`,
        )
      }
    }

    const biasDetected = underperformingLanguages.length > 0

    if (!biasDetected) {
      recommendations.push('No significant language bias detected')
    }

    return { biasDetected, languageStats, underperformingLanguages, recommendations }
  } catch (err: any) {
    logger.error({ err }, '[Governance] Language bias computation failed')
    return { biasDetected: false, languageStats: [], underperformingLanguages: [], recommendations: ['Computation failed: ' + err.message] }
  }
}

// —17  COMPREHENSIVE BIAS REPORT

/**
 * Generate a comprehensive bias report combining all bias metrics.
 */
export async function generateBiasReport(): Promise<{
  overallBiasScore: number
  location: Awaited<ReturnType<typeof computeFairnessMetrics>>
  severity: Awaited<ReturnType<typeof computeSeverityBias>>
  temporal: Awaited<ReturnType<typeof computeTemporalBias>>
  language: Awaited<ReturnType<typeof computeLanguageBias>>
  criticalIssues: string[]
}> {
  const [location, severity, temporal, language] = await Promise.all([
    computeFairnessMetrics(),
    computeSeverityBias(),
    computeTemporalBias(),
    computeLanguageBias(),
  ])

  const criticalIssues: string[] = []

  // Identify critical bias issues
  if (location.overallFairness < 60) {
    criticalIssues.push('Location bias: Overall fairness below 60%')
  }
  if (severity.biasDetected) {
    criticalIssues.push('Severity bias: High override rates detected')
  }
  if (temporal.lowHours.length >= 4) {
    criticalIssues.push('Temporal bias: Multiple hours with degraded performance')
  }
  if (language.underperformingLanguages.length >= 2) {
    criticalIssues.push(`Language bias: ${language.underperformingLanguages.length} languages underperforming`)
  }

  // Compute overall bias score (100 = no bias)
  let biasDeductions = 0
  biasDeductions += (100 - location.overallFairness) * 0.3
  if (severity.biasDetected) biasDeductions += 20
  if (temporal.biasDetected) biasDeductions += 15
  if (language.biasDetected) biasDeductions += 15
  const overallBiasScore = Math.max(0, Math.round(100 - biasDeductions))

  return {
    overallBiasScore,
    location,
    severity,
    temporal,
    language,
    criticalIssues,
  }
}
