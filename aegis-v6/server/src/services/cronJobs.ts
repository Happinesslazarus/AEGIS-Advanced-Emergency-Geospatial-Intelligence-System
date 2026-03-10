/**
 * services/cronJobs.ts — Scheduled background tasks
 *
 * Uses node-cron to run periodic jobs:
 *   1. Ingest SEPA flood warnings RSS feed (every 15 minutes)
 *   2. Clean expired response cache entries (hourly)
 *   3. Expire old chat sessions (daily)
 *   4. Re-ingest data from EA, NASA POWER, Open-Meteo (every 6 hours)
 *   5. Retrain ML models (daily at 2am)
 *   6. Monitor AI confidence + anomaly detection (every 30 minutes)
 *   7. Expand RAG knowledge base (daily at 4am)
 *
 * Each job logs its execution to the scheduled_jobs table for auditing.
 * Jobs are idempotent and safe to restart at any time.
 */

import cron from 'node-cron'
import pool from '../models/db.js'
import { getActiveRegion } from '../config/regions.js'
import { fetchAndBroadcastLevels } from './riverLevelService.js'
import { calculateThreatLevel } from './threatLevelService.js'
import { aiClient } from './aiClient.js'
import { broadcastIncidentAlert, broadcastPredictionUpdate } from './socket.js'

const region = getActiveRegion()

// ═══════════════════════════════════════════════════════════════════════════════
// §1  JOB EXECUTION WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

async function runJob(name: string, fn: () => Promise<number | string>): Promise<void> {
  const start = Date.now()
  try {
    const affected = await fn()
    const duration = Date.now() - start
    console.log(`[Cron] ✅ ${name} completed in ${duration}ms (${affected} records)`)

    await pool.query(
      `INSERT INTO scheduled_jobs (job_name, status, duration_ms, records_affected, completed_at)
       VALUES ($1, 'success', $2, $3, now())`,
      [name, duration, affected],
    ).catch(() => {}) // Don't fail the job if logging fails
  } catch (err: any) {
    const duration = Date.now() - start
    console.error(`[Cron] ❌ ${name} failed after ${duration}ms: ${err.message}`)

    await pool.query(
      `INSERT INTO scheduled_jobs (job_name, status, duration_ms, error_message, completed_at)
       VALUES ($1, 'failed', $2, $3, now())`,
      [name, duration, err.message],
    ).catch(() => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  SEPA FLOOD WARNINGS INGESTION
// ═══════════════════════════════════════════════════════════════════════════════

async function ingestSEPAWarnings(): Promise<number> {
  // SEPA flood warning RSS feed was discontinued.
  // Use SEPA's public floodline flood warning JSON endpoint instead.
  // Fallback chain: SEPA JSON → Environment Agency API → skip
  const urls = [
    'https://floodline.sepa.org.uk/floodmap/rest/flood/warnings',
    'https://environment.data.gov.uk/flood-monitoring/id/floods?_limit=50',
  ]

  let data: any[] = []
  let source = 'SEPA'

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AEGIS-AlertIngestion/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const json = await res.json()
      if (url.includes('sepa')) {
        // SEPA format: direct array of warning objects
        data = Array.isArray(json) ? json : json.warnings || json.items || []
        source = 'SEPA'
      } else {
        // EA format: { items: [...] }
        data = json.items || []
        source = 'EA'
      }
      if (data.length > 0) break
    } catch {
      continue
    }
  }

  if (!data.length) {
    // Fallback: use SEPA KiWIS timeseries API to check for active alerts
    const kiWISBase = process.env.SEPA_API_BASE || 'https://timeseries.sepa.org.uk/KiWIS/KiWIS'
    try {
      const res = await fetch(
        `${kiWISBase}?service=kisters&type=queryServices&datasource=0&request=getrequestinfo&format=json`,
        { headers: { 'User-Agent': 'AEGIS/1.0' }, signal: AbortSignal.timeout(10000) },
      )
      if (res.ok) {
        // KiWIS doesn't have a direct "warnings" endpoint, but confirming connectivity
        console.log('[Cron] SEPA KiWIS is reachable — no dedicated warnings endpoint available')
      }
    } catch { /* skip */ }
    return 0
  }

  let ingested = 0

  for (const item of data) {
    // Normalize fields across SEPA and EA formats
    const id = item.id || item.floodAreaID || item.uri || `${source}-${Date.now()}-${ingested}`
    const title = item.description || item.message || item.headline || `${source} Flood Warning`
    const description = item.description || item.message || item.summary || ''
    const area = item.area || item.eaAreaName || item.floodArea?.label || item.county || null

    let severity: 'critical' | 'warning' | 'info' = 'info'
    const sevRaw = (item.severity || item.severityLevel || item.severity_level || '').toString().toLowerCase()
    if (sevRaw.includes('severe') || sevRaw === '1') severity = 'critical'
    else if (sevRaw.includes('warning') || sevRaw === '2') severity = 'warning'
    else if (sevRaw.includes('alert') || sevRaw === '3') severity = 'info'

    const updated = item.timeRaised || item.timeMessageChanged || item.updated || new Date().toISOString()

    try {
      await pool.query(
        `INSERT INTO external_alerts (source, source_id, title, description, severity, area, ingested_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source, source_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           severity = EXCLUDED.severity`,
        [
          source,
          String(id),
          title.slice(0, 500),
          description.slice(0, 2000),
          severity,
          area,
          new Date(updated),
          new Date(Date.now() + 24 * 60 * 60 * 1000),
        ],
      )
      ingested++
    } catch {
      // Duplicate or constraint error — skip
    }
  }

  return ingested
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3  CACHE CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

async function cleanExpiredCache(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM response_cache WHERE expires_at < now()`,
  )
  return result.rowCount || 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  EXPIRE OLD CHAT SESSIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function expireChatSessions(): Promise<number> {
  const result = await pool.query(
    `UPDATE chat_sessions SET status = 'expired'
     WHERE status = 'active' AND updated_at < now() - INTERVAL '7 days'`,
  )
  return result.rowCount || 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5  DATA RE-INGESTION (scheduled)
// ═══════════════════════════════════════════════════════════════════════════════

async function scheduledDataIngestion(): Promise<number> {
  try {
    // Lazy import to avoid circular dependency at load time
    const { ingestEAFloodData, ingestNASAPowerData, ingestOpenMeteoData, ensureIngestionSchema } 
      = await import('./dataIngestionService.js')

    await ensureIngestionSchema()

    let total = 0

    // EA river gauge data (fresh readings)
    const ea = await ingestEAFloodData(100)
    total += ea.rowsIngested
    console.log(`[Cron/Ingestion] EA: ${ea.rowsIngested} new readings`)

    // Open-Meteo climate data (recent observations)  
    const meteo = await ingestOpenMeteoData()
    total += meteo.rowsIngested
    console.log(`[Cron/Ingestion] Open-Meteo: ${meteo.rowsIngested} new records`)

    return total
  } catch (err: any) {
    console.error(`[Cron/Ingestion] Failed: ${err.message}`)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6  ML MODEL RETRAINING (scheduled)
// ═══════════════════════════════════════════════════════════════════════════════

async function scheduledModelRetraining(): Promise<number> {
  try {
    const { trainAllModels } = await import('./mlTrainingPipeline.js')
    console.log('[Cron/Training] Starting scheduled model retraining...')
    const result = await trainAllModels()
    console.log(`[Cron/Training] Complete: ${result.summary.successful}/${result.summary.total} models trained`)
    return result.summary.successful
  } catch (err: any) {
    console.error(`[Cron/Training] Failed: ${err.message}`)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7  AI CONFIDENCE MONITORING & ANOMALY DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

async function monitorAIConfidence(): Promise<number> {
  try {
    // Check recent AI predictions for confidence drift
    const { rows: recentPredictions } = await pool.query(`
      SELECT 
        AVG(ai_confidence) as avg_confidence,
        MIN(ai_confidence) as min_confidence,  
        MAX(ai_confidence) as max_confidence,
        STDDEV(ai_confidence) as stddev_confidence,
        COUNT(*) as prediction_count,
        COUNT(CASE WHEN ai_confidence < 0.3 THEN 1 END) as low_confidence_count
      FROM reports
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND ai_confidence IS NOT NULL
        AND deleted_at IS NULL
    `)

    const stats = recentPredictions[0]
    if (!stats || !stats.prediction_count || parseInt(stats.prediction_count) === 0) {
      return 0
    }

    const avgConf = parseFloat(stats.avg_confidence) || 0
    const stddevConf = parseFloat(stats.stddev_confidence) || 0
    const predCount = parseInt(stats.prediction_count) || 0
    const lowConfCount = parseInt(stats.low_confidence_count) || 0

    // Anomaly detection: flag if confidence drops significantly
    const lowConfRatio = lowConfCount / predCount
    const anomalyDetected = avgConf < 0.4 || lowConfRatio > 0.3 || stddevConf > 0.35

    // Log monitoring metrics
    await pool.query(`
      INSERT INTO ai_model_metrics
        (model_name, model_version, metric_name, metric_value, dataset_size, metadata)
      VALUES ('ai_monitor', 'v1', 'confidence_check', $1, $2, $3)
    `, [
      avgConf,
      predCount,
      JSON.stringify({
        avg_confidence: avgConf,
        min_confidence: parseFloat(stats.min_confidence) || 0,
        max_confidence: parseFloat(stats.max_confidence) || 0,
        stddev: stddevConf,
        low_confidence_count: lowConfCount,
        low_confidence_ratio: lowConfRatio,
        anomaly_detected: anomalyDetected,
        checked_at: new Date().toISOString(),
      }),
    ])

    if (anomalyDetected) {
      console.warn(`[Monitor] ⚠️ ANOMALY DETECTED: avg_confidence=${avgConf.toFixed(3)}, ` +
        `low_conf_ratio=${(lowConfRatio * 100).toFixed(1)}%, stddev=${stddevConf.toFixed(3)}`)

      // Log system event for anomaly
      await pool.query(`
        INSERT INTO system_events (event_type, metadata, created_at)
        VALUES ('ai_anomaly', $1, NOW())
      `, [
        JSON.stringify({
          severity: 'warning',
          description: `AI confidence anomaly: avg=${avgConf.toFixed(3)}, ${lowConfCount}/${predCount} predictions below 0.3`,
          avgConf, stddevConf, lowConfCount, predCount,
        }),
      ]).catch(() => {})
    } else {
      console.log(`[Monitor] ✅ AI confidence OK: avg=${avgConf.toFixed(3)}, ` +
        `predictions=${predCount}, low_conf=${lowConfCount}`)
    }

    // Check model drift — compare recent vs historical performance
    const { rows: historicalMetrics } = await pool.query(`
      SELECT metric_value 
      FROM ai_model_metrics 
      WHERE model_name = 'ai_monitor' 
        AND metric_name = 'confidence_check'
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC 
      LIMIT 14
    `)

    if (historicalMetrics.length > 3) {
      const historical = historicalMetrics.map(r => parseFloat(r.metric_value) || 0)
      const historicalAvg = historical.reduce((a, b) => a + b, 0) / historical.length

      if (avgConf < historicalAvg * 0.8) {
        console.warn(`[Monitor] ⚠️ MODEL DRIFT: current avg (${avgConf.toFixed(3)}) ` +
          `is ${((1 - avgConf / historicalAvg) * 100).toFixed(1)}% below 7-day avg (${historicalAvg.toFixed(3)})`)

        // Trigger retraining if drift is significant
        try {
          const { trainAllModels } = await import('./mlTrainingPipeline.js')
          console.log('[Monitor] Auto-triggering retraining due to model drift...')
          await trainAllModels()
        } catch { /* non-critical */ }
      }
    }

    return predCount
  } catch (err: any) {
    console.error(`[Monitor] Failed: ${err.message}`)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8  RAG KNOWLEDGE BASE EXPANSION (scheduled)
// ═══════════════════════════════════════════════════════════════════════════════

async function scheduledRAGExpansion(): Promise<number> {
  try {
    const { expandRAGKnowledgeBase } = await import('./ragExpansionService.js')
    console.log('[Cron/RAG] Expanding knowledge base...')
    const result = await expandRAGKnowledgeBase()
    console.log(`[Cron/RAG] Complete: ${result.newDocuments} documents stored`)
    return result.newDocuments || 0
  } catch (err: any) {
    console.error(`[Cron/RAG] Failed: ${err.message}`)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9c  SAFETY CHECK-IN REMINDERS (#36)
// ═══════════════════════════════════════════════════════════════════════════════

async function sendSafetyReminders(): Promise<number> {
  // Find active, vulnerable citizens whose last check-in is overdue.
  // Default threshold: 24 hours for vulnerable citizens, 72 hours for others.
  // Only reminds citizens who have checked in at least once (opted-in).
  const overdue = await pool.query(`
    WITH last_checkin AS (
      SELECT citizen_id, MAX(created_at) AS last_at
      FROM safety_check_ins
      GROUP BY citizen_id
    )
    SELECT c.id, c.display_name, c.is_vulnerable, lc.last_at
    FROM citizens c
    INNER JOIN last_checkin lc ON lc.citizen_id = c.id
    WHERE c.deleted_at IS NULL
      AND c.is_active = true
      AND (
        (c.is_vulnerable = true  AND lc.last_at < NOW() - INTERVAL '24 hours')
        OR
        (c.is_vulnerable = false AND lc.last_at < NOW() - INTERVAL '72 hours')
      )
  `)

  if (overdue.rows.length === 0) return 0

  let reminded = 0

  for (const citizen of overdue.rows) {
    try {
      // Create/reopen a message thread so the citizen sees the reminder in their inbox
      const existingThread = await pool.query(
        `SELECT id FROM message_threads
         WHERE citizen_id = $1 AND subject = 'Safety Check-In Reminder'
           AND status != 'closed'
         LIMIT 1`,
        [citizen.id]
      )

      let threadId: string

      if (existingThread.rows.length > 0) {
        threadId = existingThread.rows[0].id
      } else {
        const newThread = await pool.query(
          `INSERT INTO message_threads (citizen_id, subject, status, operator_unread)
           VALUES ($1, 'Safety Check-In Reminder', 'open', 0)
           RETURNING id`,
          [citizen.id]
        )
        threadId = newThread.rows[0].id
      }

      // Add a system message
      const hoursAgo = Math.round(
        (Date.now() - new Date(citizen.last_at).getTime()) / (1000 * 60 * 60)
      )
      await pool.query(
        `INSERT INTO messages (thread_id, sender_type, body)
         VALUES ($1, 'operator', $2)`,
        [
          threadId,
          `🔔 Safety Reminder: We haven't heard from you in ${hoursAgo} hours. ` +
          `Please check in when you can so we know you're safe. ` +
          `Go to Safety → Check In to update your status.`,
        ]
      )

      // Bump the citizen_unread counter so the badge shows
      await pool.query(
        `UPDATE message_threads SET citizen_unread = citizen_unread + 1 WHERE id = $1`,
        [threadId]
      )

      // Try to send a web push notification if the citizen has a subscription
      try {
        const sub = await pool.query(
          `SELECT subscription_data FROM push_subscriptions
           WHERE user_id = $1 AND is_active = true
           LIMIT 1`,
          [citizen.id]
        )
        if (sub.rows.length > 0) {
          const { sendWebPushAlert } = await import('./notificationService.js')
          await sendWebPushAlert(sub.rows[0].subscription_data, {
            id: `safety-reminder-${citizen.id}`,
            title: 'Safety Check-In Reminder',
            message: `We haven't heard from you in ${hoursAgo} hours. Please check in.`,
            severity: citizen.is_vulnerable ? 'warning' : 'info',
            type: 'safety',
            area: 'Your area',
          } as any)
        }
      } catch {
        // Push delivery is best-effort; don't fail the whole job
      }

      reminded++
    } catch (err: any) {
      console.error(`[Cron/SafetyReminder] Failed for ${citizen.id}: ${err.message}`)
    }
  }

  return reminded
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9b  ACCOUNT DELETION PROCESSING (30-day grace period)
// ═══════════════════════════════════════════════════════════════════════════════

async function processScheduledDeletions(): Promise<number> {
  // Find citizens whose 30-day grace period has expired
  const result = await pool.query(
    `SELECT id, email, display_name FROM citizens
     WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= NOW()
       AND deleted_at IS NULL`
  )

  if (result.rows.length === 0) return 0

  let processed = 0
  for (const citizen of result.rows) {
    try {
      // Anonymize community chat messages
      await pool.query(
        `UPDATE community_chat_messages
         SET sender_name = 'Deleted User', sender_id = NULL
         WHERE sender_id = $1 AND sender_type = 'citizen'`,
        [citizen.id]
      )

      // Remove community membership
      await pool.query(`DELETE FROM community_members WHERE user_id = $1`, [citizen.id])
      await pool.query(`DELETE FROM community_bans WHERE user_id = $1`, [citizen.id])
      await pool.query(`DELETE FROM community_mutes WHERE user_id = $1`, [citizen.id])

      // Remove community posts
      await pool.query(
        `UPDATE community_posts SET author_name = 'Deleted User', author_id = NULL WHERE author_id = $1`,
        [citizen.id]
      ).catch(() => {})

      // Soft-delete the citizen (preserve for audit)
      await pool.query(
        `UPDATE citizens SET deleted_at = NOW(), is_active = false,
                display_name = 'Deleted User', email = $2,
                password_hash = 'DELETED', phone = NULL, bio = NULL,
                avatar_url = NULL, location_lat = NULL, location_lng = NULL,
                vulnerability_details = NULL
         WHERE id = $1`,
        [citizen.id, `deleted_${citizen.id}@removed.local`]
      )

      // Log the deletion
      await pool.query(
        `INSERT INTO account_deletion_log (citizen_id, citizen_email, citizen_name, action, details)
         VALUES ($1, $2, $3, 'account_permanently_deleted', $4)`,
        [citizen.id, citizen.email, citizen.display_name,
         JSON.stringify({ processed_at: new Date().toISOString() })]
      ).catch(() => {})

      processed++
      console.log(`[Cron/Deletion] Permanently deleted account: ${citizen.display_name} (${citizen.id})`)
    } catch (err: any) {
      console.error(`[Cron/Deletion] Failed to delete ${citizen.id}: ${err.message}`)
    }
  }

  return processed
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10  SCHEDULE ALL JOBS
// ═══════════════════════════════════════════════════════════════════════════════

export function startCronJobs(): void {
  // Ingest SEPA warnings every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    runJob('sepa_warnings_ingestion', ingestSEPAWarnings)
  })

  // Fetch river levels every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    runJob('river_level_fetch', fetchAndBroadcastLevels)
  })

  // Clean expired response cache every hour
  cron.schedule('0 * * * *', () => {
    runJob('cache_cleanup', cleanExpiredCache)
  })

  // Expire old chat sessions daily at 3am
  cron.schedule('0 3 * * *', () => {
    runJob('chat_session_expiry', expireChatSessions)
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Cron] ✅ Scheduled jobs started:')
    console.log('  • SEPA warnings ingestion: every 15 minutes')
    console.log('  • River level monitoring: every 5 minutes')
    console.log('  • Cache cleanup: every hour')
    console.log('  • Chat session expiry: daily at 3am')
    console.log('  • Data re-ingestion (EA, Open-Meteo): every 6 hours')
    console.log('  • ML model retraining: daily at 2am')
    console.log('  • AI confidence monitoring: every 30 minutes')
    console.log('  • RAG knowledge expansion: daily at 4am')
    console.log('  • Account deletion processing: daily at 5am')
    console.log('  • Safety check-in reminders: every 30 minutes')
  }

  // Calculate threat level every 10 minutes
  cron.schedule('*/10 * * * *', () => {
    runJob('threat_level_assessment', async () => {
      const assessment = await calculateThreatLevel()
      return assessment.level
    })
  })

  // Re-ingest fresh data every 6 hours
  cron.schedule('0 */6 * * *', () => {
    runJob('scheduled_data_ingestion', scheduledDataIngestion)
  })

  // Retrain ML models daily at 2am
  cron.schedule('0 2 * * *', () => {
    runJob('scheduled_model_retraining', scheduledModelRetraining)
  })

  // Monitor AI confidence every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    runJob('ai_confidence_monitor', monitorAIConfidence)
  })

  // Drift detection + model performance snapshot every hour (M16 + M17)
  cron.schedule('0 * * * *', () => {
    runJob('model_drift_check', async () => {
      let driftCount = 0
      try {
        const driftResult = await aiClient.checkDrift(undefined, 1)
        const models: any[] = driftResult?.models || []
        for (const m of models) {
          if (m.drift_detected) {
            driftCount++
            console.warn(`[Cron/Drift] Drift detected in ${m.model_name} — consider retraining`)
            await pool.query(`
              INSERT INTO model_drift_metrics (model_name, metric_name, drift_detected, threshold, current_value, created_at)
              VALUES ($1, 'output_distribution', true, 0.05, $2, NOW())
              ON CONFLICT DO NOTHING
            `, [m.model_name, m.drift_score ?? 0]).catch(() => {})
          }
          // Persist hourly performance snapshot (M17)
          await pool.query(`
            INSERT INTO model_performance_history
              (model_name, model_version, measurement_hour, accuracy, prediction_count, drift_detected)
            VALUES ($1, $2, date_trunc('hour', NOW()), $3, $4, $5)
            ON CONFLICT (model_name, measurement_hour) DO UPDATE
              SET accuracy = EXCLUDED.accuracy,
                  prediction_count = EXCLUDED.prediction_count,
                  drift_detected = EXCLUDED.drift_detected
          `, [
            m.model_name,
            m.model_version || 'unknown',
            m.accuracy ?? null,
            m.total_predictions ?? 0,
            m.drift_detected ?? false
          ]).catch(() => {})
        }
      } catch (e: any) {
        console.warn('[Cron/Drift] AI engine unreachable:', e.message)
      }
      return driftCount
    })
  })

  // Expand RAG knowledge base daily at 4am
  cron.schedule('0 4 * * *', () => {
    runJob('scheduled_rag_expansion', scheduledRAGExpansion)
  })

  // Process scheduled account deletions daily at 5am
  cron.schedule('0 5 * * *', () => {
    runJob('account_deletion_processing', processScheduledDeletions)
  })

  // Safety check-in reminders every 30 minutes (#36)
  cron.schedule('*/30 * * * *', () => {
    runJob('safety_checkin_reminders', sendSafetyReminders)
  })

  // Refresh flood predictions every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    runJob('flood_prediction_refresh', async () => {
      try {
        const { getFloodPredictions } = await import('./floodPredictionService.js')
        const predictions = await getFloodPredictions()
        return predictions.length
      } catch (e: any) {
        console.warn(`[Cron] Flood prediction refresh: ${e.message}`)
        return 0
      }
    })
  })

  // Run SEPA ingestion immediately on startup
  runJob('sepa_warnings_ingestion', ingestSEPAWarnings)

  // Fetch river levels immediately on startup
  setTimeout(() => runJob('river_level_fetch', fetchAndBroadcastLevels), 5_000)

  // Run initial confidence monitoring
  setTimeout(() => runJob('ai_confidence_monitor', monitorAIConfidence), 30_000)

  // Calculate initial threat level on startup
  setTimeout(() => runJob('threat_level_assessment', async () => {
    const assessment = await calculateThreatLevel()
    return assessment.level
  }), 10_000)
}

// ═══════════════════════════════════════════════════════════════════════════════
// §11  n8n FALLBACK MODE
// ═══════════════════════════════════════════════════════════════════════════════
//
// When the n8n instance is unreachable, the health monitor calls
// activateFallbackJobs() so the same data-fetching work still happens
// via cron inside this Node process. When n8n comes back online,
// deactivateFallbackJobs() stops the duplicated schedules.

const fallbackTasks: ReturnType<typeof cron.schedule>[] = []
let fallbackActive = false

/**
 * Start cron-based fallback jobs that mirror the critical n8n workflows:
 *   WF1 — SEPA gauge polling  (every 5 min)
 *   WF2 — Weather forecast    (every 30 min)
 *   WF3 — Rainfall aggregation(every 15 min)
 *   WF4 — Lightweight AI run  (every 30 min)
 *   WF8 — SEPA RSS alerts     (every 15 min)
 */
export function activateFallbackJobs(): void {
  if (fallbackActive) return
  fallbackActive = true
  console.log('[Cron/Fallback] ⚡ Activating n8n fallback jobs')

  // WF1: SEPA gauge polling (already runs via §10, but ensure 5-min cadence)
  fallbackTasks.push(
    cron.schedule('*/5 * * * *', () => runJob('fallback_gauge_poll', fetchAndBroadcastLevels)),
  )

  // WF2: Weather forecast fetch
  fallbackTasks.push(
    cron.schedule('*/30 * * * *', () =>
      runJob('fallback_weather_fetch', async () => {
        try {
          const { ingestOpenMeteoData } = await import('./dataIngestionService.js')
          const r = await ingestOpenMeteoData()
          return r.rowsIngested
        } catch (e: any) {
          console.error(`[Fallback/WF2] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // WF3: Rainfall aggregation
  fallbackTasks.push(
    cron.schedule('*/15 * * * *', () =>
      runJob('fallback_rainfall', async () => {
        try {
          const { ingestEAFloodData } = await import('./dataIngestionService.js')
          const r = await ingestEAFloodData(50)
          return r.rowsIngested
        } catch (e: any) {
          console.error(`[Fallback/WF3] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // WF4-lite: Basic AI confidence monitoring (lighter than full retraining)
  fallbackTasks.push(
    cron.schedule('*/30 * * * *', () => runJob('fallback_ai_monitor', monitorAIConfidence)),
  )

  // WF8: SEPA RSS / alert ingestion
  fallbackTasks.push(
    cron.schedule('*/15 * * * *', () => runJob('fallback_sepa_alerts', ingestSEPAWarnings)),
  )

  // ─── WF7 Fallback: Wildfire — Fire Danger Index every 15 min ──────────────
  fallbackTasks.push(
    cron.schedule('*/15 * * * *', () =>
      runJob('fallback_wildfire_fdi', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('wildfire')
          if (!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF7] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── WF8 Fallback: Heatwave — temperature check hourly ────────────────────
  fallbackTasks.push(
    cron.schedule('0 * * * *', () =>
      runJob('fallback_heatwave_check', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('heatwave')
          if (!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF8] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── WF9 Fallback: Severe Storm — weather data every 10 min ───────────────
  fallbackTasks.push(
    cron.schedule('*/10 * * * *', () =>
      runJob('fallback_severe_storm', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('severe_storm')
          if (!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF9] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── WF10 Fallback: Landslide — rainfall + soil every 3h ──────────────────
  fallbackTasks.push(
    cron.schedule('0 */3 * * *', () =>
      runJob('fallback_landslide_risk', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('landslide')
          if (!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF10] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── WF11-14 Fallback: Rule-based incidents — evaluate every 5 min ────────
  const ruleBasedIncidents = [
    'power_outage',
    'water_supply_disruption',
    'infrastructure_damage',
    'public_safety_incident',
  ]
  for (const incidentId of ruleBasedIncidents) {
    fallbackTasks.push(
      cron.schedule('*/5 * * * *', () =>
        runJob(`fallback_${incidentId}_eval`, async () => {
          try {
            const { getIncidentModule } = await import('../incidents/index.js')
            const mod = getIncidentModule(incidentId)
            if (!mod) return 0
            const alerts = await mod.getAlerts(process.env.REGION_ID || 'aberdeen_scotland_uk')
            return alerts.length
          } catch (e: any) {
            console.warn(`[Fallback/${incidentId}] ${e.message}`)
            return 0
          }
        }),
      ),
    )
  }

  // ─── WF15 Fallback: Environmental Hazard — air quality every 20 min ───────
  fallbackTasks.push(
    cron.schedule('*/20 * * * *', () =>
      runJob('fallback_environmental_aqi', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('environmental_hazard')
          if (!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF15] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── WF16 Fallback: Drought — precipitation deficit every 6 hours ─────────
  fallbackTasks.push(
    cron.schedule('0 */6 * * *', () =>
      runJob('fallback_drought_monitor', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const mod = getIncidentModule('drought')
          if (!mod) return 0
          const predictions = await mod.getPredictions(process.env.REGION_ID || 'aberdeen_scotland_uk')
          return predictions.length
        } catch (e: any) {
          console.warn(`[Fallback/WF16] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  // ─── Real-time broadcast: push all active predictions to Socket.IO clients ──
  // Runs every 5 minutes so dashboards stay live without polling.
  fallbackTasks.push(
    cron.schedule('*/5 * * * *', () =>
      runJob('fallback_broadcast_predictions', async () => {
        try {
          const { getIncidentModule } = await import('../incidents/index.js')
          const regionId = process.env.REGION_ID || 'aberdeen_scotland_uk'
          const incidentTypes = [
            'flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide',
            'drought', 'environmental_hazard',
          ]
          const allPredictions: unknown[] = []
          for (const type of incidentTypes) {
            try {
              const mod = getIncidentModule(type)
              if (!mod) continue
              const preds = await mod.getPredictions(regionId)
              allPredictions.push(...preds)
              // Broadcast individual high/critical alerts immediately
              for (const p of preds as any[]) {
                if (p.riskLevel === 'High' || p.riskLevel === 'Critical') {
                  broadcastIncidentAlert({
                    incidentType: type,
                    regionId,
                    riskLevel: p.riskLevel,
                    probability: p.probability ?? 0,
                    confidence: p.confidence ?? 0,
                    title: `${type.replace(/_/g, ' ')} alert`,
                    description: p.summary ?? `${p.riskLevel} risk detected`,
                    timestamp: new Date().toISOString(),
                    sourceModel: p.modelVersion,
                  })
                }
              }
            } catch (_) { /* skip failed modules */ }
          }
          broadcastPredictionUpdate(regionId, allPredictions)
          return allPredictions.length
        } catch (e: any) {
          console.warn(`[Fallback/broadcast] ${e.message}`)
          return 0
        }
      }),
    ),
  )

  console.log(`[Cron/Fallback] ${fallbackTasks.length} fallback jobs activated (covering all 11 incident types)`)
}

/**
 * Stop all fallback jobs once n8n recovers.
 */
export function deactivateFallbackJobs(): void {
  if (!fallbackActive) return
  fallbackActive = false
  for (const task of fallbackTasks) {
    task.stop()
  }
  fallbackTasks.length = 0
  console.log('[Cron/Fallback] 🔄 n8n recovered — fallback jobs deactivated')
}

/** Whether fallback mode is currently active. */
export function isFallbackActive(): boolean {
  return fallbackActive
}
