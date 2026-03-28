import pool from '../models/db.js'
import { aiClient } from './aiClient.js'
import {
  aegisModelAvgConfidence,
  aegisModelAlertStatus,
  aegisModelDriftScore,
  aegisModelFallbackTotal,
} from './metrics.js'

const fallbackCountCache = new Map<string, number>()

function alertLevelToMetric(alertLevel: string): number {
  const level = String(alertLevel || '').toUpperCase()
  if (level === 'INFO') return 1
  if (level === 'WARNING') return 2
  if (level === 'CRITICAL') return 3
  return 0
}

function toAlertLevel(healthStatus: string): string {
  const hs = String(healthStatus || '').toLowerCase()
  if (hs === 'rollback_recommended') return 'CRITICAL'
  if (hs === 'degraded') return 'WARNING'
  if (hs === 'watch') return 'INFO'
  return 'HEALTHY'
}

export async function collectModelRollingStats(): Promise<number> {
  const health = await aiClient.getAllRegistryHealth()
  const items: any[] = health?.items || []

  for (const item of items) {
    const hazard = item.hazard_type
    const region = item.region_id
    const version = item.current_version
    if (!hazard || !region || !version) continue

    const { rows } = await pool.query(
      `SELECT
          COUNT(*)::int AS sample_count,
          COALESCE(AVG(confidence), 0) AS avg_confidence,
          COALESCE(STDDEV_POP(confidence), 0) AS confidence_std,
          COALESCE(AVG(CASE WHEN probability >= 0.5 THEN 1 ELSE 0 END), 0) AS prediction_positive_rate
       FROM ai_predictions
       WHERE hazard_type = $1
         AND region_id = $2
         AND model_version = $3
         AND generated_at >= NOW() - interval '15 minutes'`,
      [hazard, region, version]
    )

    const row = rows[0] || {}
    const avgConf = Number(row.avg_confidence || 0)
    const driftScore = Number(item.drift_score || 0)
    const alertLevel = toAlertLevel(item.health_status)

    aegisModelAvgConfidence.set({ hazard, region, version }, avgConf)
    aegisModelDriftScore.set({ hazard, region, version }, driftScore)
    aegisModelAlertStatus.set({ hazard, region, version }, alertLevelToMetric(alertLevel))
  }

  return items.length
}

export async function computeAndPersistModelDriftSnapshots(): Promise<number> {
  const health = await aiClient.getAllRegistryHealth()
  const items: any[] = health?.items || []

  for (const item of items) {
    const hazard = item.hazard_type
    const region = item.region_id
    const version = item.current_version
    if (!hazard || !region || !version) continue

    const driftResult = await aiClient.getRegistryDrift(hazard, region, version)
    const snapshot = driftResult?.snapshot || {}

    await pool.query(
      `INSERT INTO model_monitoring_snapshots (
          hazard_type, region_id, model_version, snapshot_time,
          sample_count, avg_confidence, prediction_positive_rate,
          confidence_std, top_feature_means, top_feature_stds,
          drift_score, alert_level
       ) VALUES (
          $1, $2, $3, COALESCE($4::timestamptz, NOW()),
          $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12
       )`,
      [
        hazard,
        region,
        version,
        snapshot.snapshot_time || null,
        Number(snapshot.sample_count || 0),
        Number(snapshot.avg_confidence || 0),
        Number(snapshot.prediction_positive_rate || 0),
        Number(snapshot.confidence_std || 0),
        JSON.stringify(snapshot.top_feature_means || {}),
        JSON.stringify(snapshot.top_feature_stds || {}),
        Number(snapshot.drift_score || 0),
        String(snapshot.alert_level || 'HEALTHY'),
      ]
    )

    if (Number(item.fallback_count || 0) > 0) {
      const cacheKey = `${hazard}:${region}:${version}`
      const currentFallback = Number(item.fallback_count || 0)
      const previousFallback = Number(fallbackCountCache.get(cacheKey) || 0)
      const delta = currentFallback - previousFallback
      if (delta > 0) {
        aegisModelFallbackTotal.inc({ hazard, region }, delta)
      }
      fallbackCountCache.set(cacheKey, currentFallback)
    }

    aegisModelAvgConfidence.set({ hazard, region, version }, Number(snapshot.avg_confidence || 0))
    aegisModelDriftScore.set({ hazard, region, version }, Number(snapshot.drift_score || 0))
    aegisModelAlertStatus.set({ hazard, region, version }, alertLevelToMetric(snapshot.alert_level || 'HEALTHY'))
  }

  return items.length
}
