/**
 * routes/internalRoutes.ts — Internal API endpoints (SECURED)
 *
 * These endpoints are NOT meant for direct citizen/operator use.
 * They enable:
 *   1. n8n ? WebSocket bridge: n8n workflow POSTs here, and we broadcast
 *      the payload to all connected Socket.IO clients.
 *   2. Frontend error logging: React error boundaries POST here.
 *   3. System health dashboard: aggregated health state of all subsystems.
 *
 * SECURITY: All endpoints require internal API key or n8n webhook signature.
 * Set INTERNAL_API_KEY and N8N_WEBHOOK_SECRET environment variables.
 */

import { Router, Request, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { devLog } from '../utils/logger.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { getN8nHealthState } from '../services/n8nHealthCheck.js'
import { isFallbackActive } from '../services/cronJobs.js'
import { getCircuitBreakerStates } from '../services/externalApiWrapper.js'
import { getWorkflowDefinitions } from '../services/n8nWorkflowService.js'
import { internalAuth, n8nWebhookAuth, internalApiKeyAuth } from '../middleware/internalAuth.js'
import { AppError } from '../utils/AppError.js'
import { logger } from '../services/logger.js'

const router = Router()
const activeRegion = getActiveCityRegion()

// Apply internal authentication to all routes in this router
// Frontend error logging is public (no auth) - see individual route
router.use((req, res, next) => {
  // Allow error logging without auth (needed for frontend error boundaries)
  if (req.path === '/errors/frontend' && req.method === 'POST') {
    return next()
  }
  // All other internal endpoints require authentication
  internalAuth(req, res, next)
})

// —1  n8n ? WebSocket bridge
//
// n8n workflows call POST /api/internal/ws-broadcast with:
//   { event: "gauge:update", payload: { ... } }
// and we relay it via Socket.IO to all connected clients.

router.post('/ws-broadcast', (req: Request, res: Response) => {
  const { event, payload } = req.body

  if (!event || typeof event !== 'string') {
    throw AppError.badRequest('Missing or invalid "event" string')
  }

  const io = req.app.get('io')
  if (!io) {
    throw AppError.serviceUnavailable('Socket.IO not initialized')
  }

  io.emit(event, payload ?? {})
  devLog(`[ws-broadcast] Emitted "${event}" to all clients`)
  res.json({ ok: true, event, clients: io.engine?.clientsCount ?? 'unknown' })
})

// ?2  Frontend error logging

router.post('/errors/frontend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      error_message,
      error_stack,
      component_name,
      route,
      user_id,
      user_role,
      browser_info,
      extra,
    } = req.body

    await pool.query(
      `INSERT INTO frontend_errors
         (error_message, error_stack, component_name, route, user_id, user_role, browser_info, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        String(error_message || 'Unknown error').slice(0, 2000),
        String(error_stack || '').slice(0, 10000),
        component_name || null,
        route || null,
        user_id || null,
        user_role || null,
        browser_info || null,
        extra ? JSON.stringify(extra) : null,
      ],
    )

    res.json({ ok: true })
  } catch (err: any) {
    logger.error({ err }, '[ErrorLog] Failed to store frontend error')
    // Still 200 ? we don't want error logging failures to cascade
    res.json({ ok: false, reason: 'storage_failed' })
  }
})

// ?3  System health dashboard

router.get('/health/system', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Database
    let dbOk = false
    let dbLatency = 0
    try {
      const t0 = Date.now()
      await pool.query('SELECT 1')
      dbLatency = Date.now() - t0
      dbOk = true
    } catch { /* db down */ }

    // AI Engine
    let aiOk = false
    let aiLatency = 0
    const aiUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
    try {
      const t0 = Date.now()
      const r = await fetch(`${aiUrl}/health`, { signal: AbortSignal.timeout(5000) })
      aiLatency = Date.now() - t0
      aiOk = r.ok
    } catch { /* ai engine down */ }

    // n8n health
    const n8nHealth = getN8nHealthState()

    // External API circuit breakers
    const circuitBreakers = getCircuitBreakerStates()

    // Cron fallback mode
    const cronFallback = isFallbackActive()

    // Recent errors (last hour)
    let recentErrors = { frontend: 0, system: 0, external: 0 }
    try {
      const { rows } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM frontend_errors WHERE created_at > NOW() - INTERVAL '1 hour')::int AS frontend,
          (SELECT COUNT(*) FROM system_errors WHERE created_at > NOW() - INTERVAL '1 hour')::int AS system,
          (SELECT COUNT(*) FROM external_api_errors WHERE created_at > NOW() - INTERVAL '1 hour')::int AS external
      `)
      recentErrors = rows[0] || recentErrors
    } catch { /* tables might not exist yet */ }

    // Recent cron jobs
    let recentJobs: any[] = []
    try {
      const { rows } = await pool.query(`
        SELECT job_name, status, duration_ms, records_affected, completed_at
        FROM scheduled_jobs
        ORDER BY completed_at DESC
        LIMIT 10
      `)
      recentJobs = rows
    } catch { /* table might not exist */ }

    res.json({
      timestamp: new Date().toISOString(),
      server_uptime_s: Math.floor(process.uptime()),
      memory: {
        rss_mb: Math.round(process.memoryUsage().rss / 1048576),
        heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1048576),
        heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1048576),
      },
      database: { ok: dbOk, latency_ms: dbLatency },
      ai_engine: { ok: aiOk, url: aiUrl, latency_ms: aiLatency },
      n8n: {
        healthy: n8nHealth.isHealthy || n8nHealth.fallbackActive,
        status: n8nHealth.status,
        consecutive_failures: n8nHealth.consecutiveFailures,
        last_check: n8nHealth.lastChecked,
        fallback_active: n8nHealth.fallbackActive,
        version: n8nHealth.version,
        workflow_count: n8nHealth.workflowCount,
        active_workflow_count: n8nHealth.activeWorkflowCount,
      },
      cron_fallback_active: cronFallback,
      circuit_breakers: circuitBreakers,
      recent_errors: recentErrors,
      recent_jobs: recentJobs,
      workflow_definitions: getWorkflowDefinitions(),
    })
  } catch (err) {
    next(err)
  }
})

// ?4  n8n Webhook Callbacks
//
// These endpoints are called by n8n workflows to push data back into AEGIS.

 /**
 * POST /api/internal/n8n-webhook/weather
 * Receives weather data from n8n WF2 and broadcasts via Socket.IO.
 */
router.post('/n8n-webhook/weather', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body
    const io = req.app.get('io')

    // Try to ingest the weather data into the database
    try {
      const { ingestOpenMeteoData } = await import('../services/dataIngestionService.js')
      const result = await ingestOpenMeteoData()
      devLog(`[n8n-webhook/weather] Ingested ${result.rowsIngested} weather records`)
    } catch (err: any) {
      logger.warn({ err }, '[n8n-webhook/weather] Ingestion error')
    }

    // Broadcast to connected clients
    if (io) {
      io.emit('weather:update', { source: 'n8n', timestamp: new Date().toISOString(), ...data })
    }

    res.json({ ok: true, source: 'n8n_wf2' })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/internal/n8n-webhook/alerts
 * Receives flood alert data from n8n WF3 and processes it.
 */
router.post('/n8n-webhook/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { source, ea_data, sepa_data } = req.body
    const io = req.app.get('io')
    let alertCount = 0

    // Process EA flood data
    if (ea_data?.items && Array.isArray(ea_data.items)) {
      for (const item of ea_data.items.slice(0, 50)) {
        try {
          await pool.query(
            `INSERT INTO alerts (title, description, severity, source, location_name, created_at)
             VALUES ($1, $2, $3, 'EA', $4, NOW())
             ON CONFLICT DO NOTHING`,
            [
              item.description || item.message || 'EA Flood Warning',
              item.message || item.description || '',
              item.severityLevel <= 2 ? 'Critical' : item.severityLevel === 3 ? 'Warning' : 'Info',
              item.floodArea?.county || item.floodArea?.label || 'Unknown',
            ],
          )
          alertCount++
        } catch { /* skip duplicates */ }
      }
    }

    // Process SEPA warnings data
    if (sepa_data && Array.isArray(sepa_data)) {
      for (const item of sepa_data.slice(0, 50)) {
        try {
          await pool.query(
            `INSERT INTO alerts (title, description, severity, source, location_name, created_at)
             VALUES ($1, $2, $3, 'SEPA', $4, NOW())
             ON CONFLICT DO NOTHING`,
            [
              item.title || item.headline || 'SEPA Flood Warning',
              item.description || item.summary || '',
              item.severity || 'Warning',
              item.area || item.region || activeRegion.name,
            ],
          )
          alertCount++
        } catch { /* skip duplicates */ }
      }
    }

    // Broadcast alert update
    if (io) {
      io.emit('alerts:update', { source: source || 'n8n_wf3', count: alertCount, timestamp: new Date().toISOString() })
    }

    devLog(`[n8n-webhook/alerts] Processed ${alertCount} alerts from ${source || 'n8n'}`)
    res.json({ ok: true, alerts_processed: alertCount })
  } catch (err) {
    next(err)
  }
})

 /**
 * POST /api/internal/n8n-webhook/gauges
 * Receives river gauge data from n8n WF1.
 */
router.post('/n8n-webhook/gauges', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body
    const io = req.app.get('io')

    if (io) {
      io.emit('gauge:update', { source: 'n8n', timestamp: new Date().toISOString(), ...data })
    }

    res.json({ ok: true, source: 'n8n_wf1' })
  } catch (err) {
    next(err)
  }
})

// ?5  Multi-incident n8n webhook endpoints

 /**
 * WF4 ? Multi-hazard weather alerts
 * n8n posts evaluated multi-hazard weather alerts here.
 */
router.post('/n8n-webhook/multi-hazard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { hazard_type, severity, region, description, data } = req.body
    if (!hazard_type || !severity) {
      throw AppError.badRequest('Missing hazard_type or severity')
    }

    // Insert alert into database
    await pool.query(
      `INSERT INTO alerts (alert_type, severity::alert_severity, title, message, location_text, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())`,
      [hazard_type, severity, `${hazard_type} Alert`, description || `${hazard_type} alert detected`,
       region || activeRegion.name]
    )

    // Broadcast via Socket.IO
    const io = req.app.get('io')
    if (io) {
      io.emit('incident:alert', { type: hazard_type, severity, description, region, data, source: 'n8n_wf4' })
    }

    devLog(`[n8n-webhook/multi-hazard] ${hazard_type} alert (${severity}) ingested`)
    res.json({ ok: true, source: 'n8n_wf4', hazard_type, severity })
  } catch (err) {
    next(err)
  }
})

 /**
 * WF5 ? Air quality monitoring alerts
 */
router.post('/n8n-webhook/air-quality', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { aqi, pollutant, severity, region, description, data } = req.body
    if (!severity) {
      throw AppError.badRequest('Missing severity')
    }

    await pool.query(
      `INSERT INTO alerts (alert_type, severity::alert_severity, title, message, location_text, is_active, created_at)
       VALUES ('environmental_hazard', $1, $2, $3, $4, true, NOW())`,
      [severity, `Air Quality Alert - AQI ${aqi || 'unknown'}`,
       description || `Air quality alert: ${pollutant || 'multiple pollutants'}`,
       region || activeRegion.name]
    )

    const io = req.app.get('io')
    if (io) {
      io.emit('incident:alert', { type: 'environmental_hazard', severity, aqi, pollutant, region, source: 'n8n_wf5' })
    }

    devLog(`[n8n-webhook/air-quality] AQI alert (${severity}) ingested`)
    res.json({ ok: true, source: 'n8n_wf5', severity, aqi })
  } catch (err) {
    next(err)
  }
})

 /**
 * WF6 ? Cross-incident escalation alerts
 * Receives compound/cascading emergency alerts from the incident alert evaluator.
 */
router.post('/n8n-webhook/escalation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { escalation_type, severity, involved_incidents, description, data } = req.body
    if (!escalation_type || !severity) {
      throw AppError.badRequest('Missing escalation_type or severity')
    }

    await pool.query(
      `INSERT INTO alerts (alert_type, severity::alert_severity, title, message, location_text, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())`,
      [escalation_type, severity, `ESCALATION: ${escalation_type}`,
       description || `Compound emergency: ${(involved_incidents || []).join(', ')}`,
       activeRegion.name]
    )

    const io = req.app.get('io')
    if (io) {
      io.emit('incident:escalation', {
        type: escalation_type, severity, involved_incidents, description, source: 'n8n_wf6'
      })
    }

    devLog(`[n8n-webhook/escalation] ${escalation_type} (${severity}) ? involves: ${(involved_incidents || []).join(', ')}`)
    res.json({ ok: true, source: 'n8n_wf6', escalation_type, severity })
  } catch (err) {
    next(err)
  }
})

// —6  Generic Incident Alert Endpoint (WF7-WF15)
//
// All new per-incident n8n workflows post to this single endpoint.
// Body: { incidentType, severity, probability, message, source, metadata }

router.post('/incident-alert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { incidentType, severity, probability, message, source, metadata } = req.body

    if (!incidentType || !severity) {
      throw AppError.badRequest('Missing incidentType or severity')
    }

    // Normalise severity to DB enum values
    const severityMap: Record<string, string> = {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      Critical: 'Critical',
      High: 'High',
      Medium: 'Medium',
      Low: 'Low',
    }
    const normSeverity = severityMap[severity] || 'Medium'

    // Deduplicate: skip if identical alert was inserted in last 15 minutes
    let inserted = false
    try {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM alerts
         WHERE incident_type = $1 AND severity::text ILIKE $2
           AND created_at > NOW() - INTERVAL '15 minutes'
           AND source = $3
         LIMIT 1`,
        [incidentType, normSeverity, source || 'n8n']
      )
      if (!rowCount || rowCount === 0) {
        await pool.query(
          `INSERT INTO alerts
             (incident_type, alert_type, severity, title, message, location_text, source, is_active, metadata, created_at)
           VALUES ($1, $2, $3::alert_severity, $4, $5, $6, $7, true, $8, NOW())`,
          [
            incidentType,
            incidentType,
            normSeverity,
            `${incidentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} Alert`,
            message || `${incidentType} alert — ${normSeverity} severity`,
            activeRegion.name,
            source || 'n8n',
            JSON.stringify(metadata || {}),
          ]
        )
        inserted = true
      }
    } catch (dbErr: any) {
      // Alert table might have different schema — fall through to socket broadcast
      logger.warn({ err: dbErr }, '[incident-alert] DB insert warning')
    }

    // Always broadcast via Socket.IO regardless of DB outcome
    const io = req.app.get('io')
    if (io) {
      io.emit('incident:alert', {
        incidentType,
        severity: normSeverity,
        probability: probability || null,
        message,
        source: source || 'n8n',
        metadata: metadata || {},
        timestamp: new Date().toISOString(),
      })
    }

    devLog(`[incident-alert] ${incidentType} (${normSeverity}) from ${source || 'n8n'} — inserted:${inserted}`)
    res.json({ ok: true, incidentType, severity: normSeverity, inserted, source: source || 'n8n' })
  } catch (err) {
    next(err)
  }
})

export default router
