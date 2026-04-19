/**
 * Core Prometheus metrics — defines histograms and counters for HTTP requests,
 * WebSocket connections, distress events, alert delivery, AI predictions, and
 * report submissions. Also collects default Node.js process metrics.
 *
 * - Imported by middleware, routes, and services to record observations
 * - Exposes a /metrics endpoint handler for Prometheus scraping
 * - Separate from cacheMetrics.ts which covers cache-specific metrics
 * */

import { Request, Response, NextFunction } from 'express'
import client from 'prom-client'

// Collect default Node.js process metrics (CPU, memory, event loop, GC)
client.collectDefaultMetrics({ prefix: 'aegis_' })

// HTTP Metrics

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
})

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
})

// WebSocket Metrics

export const activeWebsocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
})

// Distress Metrics

export const distressEventsTotal = new client.Counter({
  name: 'distress_events_total',
  help: 'Total distress events by type',
  labelNames: ['event'] as const,  // activate, acknowledge, resolve, cancel
})

export const distressActiveGauge = new client.Gauge({
  name: 'distress_active_count',
  help: 'Number of currently active distress calls',
})

export const distressResponseLatency = new client.Histogram({
  name: 'distress_response_seconds',
  help: 'Time from distress activation to first acknowledgement',
  buckets: [5, 15, 30, 60, 120, 300, 600],
})

// Alert Delivery Metrics

export const alertBroadcastsTotal = new client.Counter({
  name: 'alert_broadcasts_total',
  help: 'Total number of alert broadcasts sent',
})

export const alertDeliveryTotal = new client.Counter({
  name: 'alert_delivery_total',
  help: 'Alert delivery attempts by channel and status',
  labelNames: ['channel', 'status'] as const,  // channel: sms/email/push/telegram; status: sent/failed
})

export const alertDeliveryLatency = new client.Histogram({
  name: 'alert_delivery_seconds',
  help: 'Time to deliver an alert by channel',
  labelNames: ['channel'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
})

// AI Prediction Metrics

export const reportSubmissionsTotal = new client.Counter({
  name: 'report_submissions_total',
  help: 'Total number of emergency report submissions',
})

export const aiPredictionsTotal = new client.Counter({
  name: 'ai_predictions_total',
  help: 'Total number of AI predictions requested',
  labelNames: ['hazard_type'] as const,
})

export const aiPredictionLatency = new client.Histogram({
  name: 'ai_prediction_seconds',
  help: 'AI prediction request latency',
  labelNames: ['hazard_type'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
})

export const aegisModelPredictionsTotal = new client.Counter({
  name: 'aegis_model_predictions_total',
  help: 'Total predictions by deployed model version',
  labelNames: ['hazard', 'region', 'version'] as const,
})

export const aegisModelAvgConfidence = new client.Gauge({
  name: 'aegis_model_avg_confidence',
  help: 'Rolling average confidence by deployed model version',
  labelNames: ['hazard', 'region', 'version'] as const,
})

export const aegisModelDriftScore = new client.Gauge({
  name: 'aegis_model_drift_score',
  help: 'Current drift score by deployed model version',
  labelNames: ['hazard', 'region', 'version'] as const,
})

export const aegisModelAlertStatus = new client.Gauge({
  name: 'aegis_model_alert_status',
  help: 'Current model alert level as numeric status (healthy=0, info=1, warning=2, critical=3)',
  labelNames: ['hazard', 'region', 'version'] as const,
})

export const aegisModelDegradedGauge = new client.Gauge({
  name: 'aegis_model_degraded',
  help: 'Whether a model version is marked degraded (1=degraded, 0=healthy)',
  labelNames: ['hazard', 'region', 'version'] as const,
})

export const aegisModelFallbackTotal = new client.Counter({
  name: 'aegis_model_fallback_total',
  help: 'Total fallback events by hazard and region',
  labelNames: ['hazard', 'region'] as const,
})

// SSE / Chat Metrics

export const sseConnectionsActive = new client.Gauge({
  name: 'sse_connections_active',
  help: 'Number of active SSE chat streaming connections',
})

export const chatStreamTotal = new client.Counter({
  name: 'chat_stream_total',
  help: 'Total chat stream requests by outcome',
  labelNames: ['status'] as const,  // success, error, client_disconnect
})

export const chatStreamLatency = new client.Histogram({
  name: 'chat_stream_seconds',
  help: 'Chat stream duration from start to done/error',
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
})

// Security Metrics

export const securityEventsTotal = new client.Counter({
  name: 'security_events_total',
  help: 'Total security events by type',
  labelNames: ['event_type'] as const,
})

export const authFailuresTotal = new client.Counter({
  name: 'auth_failures_total',
  help: 'Total authentication failures by type and user_type',
  labelNames: ['failure_type', 'user_type'] as const,
})

export const accountLockoutsTotal = new client.Counter({
  name: 'account_lockouts_total',
  help: 'Total account lockouts',
  labelNames: ['user_type'] as const,
})

export const twoFactorAuthTotal = new client.Counter({
  name: 'two_factor_auth_total',
  help: 'Total 2FA authentication attempts by outcome',
  labelNames: ['outcome', 'method'] as const, // outcome: success/failure, method: totp/backup
})

export const trustedDevicesGauge = new client.Gauge({
  name: 'trusted_devices_active',
  help: 'Number of active trusted devices',
})

export const riskAssessmentTotal = new client.Counter({
  name: 'risk_assessment_total',
  help: 'Total risk assessments by level',
  labelNames: ['level'] as const, // low, medium, high
})

// DB Metrics

export const dbPoolActiveConnections = new client.Gauge({
  name: 'db_pool_active_connections',
  help: 'Number of active (checked-out) database connections',
})

export const dbPoolIdleConnections = new client.Gauge({
  name: 'db_pool_idle_connections',
  help: 'Number of idle database connections in the pool',
})

export const dbPoolWaitingCount = new client.Gauge({
  name: 'db_pool_waiting_count',
  help: 'Number of requests waiting for a DB connection',
})

// Cron Job Metrics

export const cronJobDuration = new client.Histogram({
  name: 'cron_job_duration_seconds',
  help: 'Cron job execution duration',
  labelNames: ['job'] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
})

export const cronJobTotal = new client.Counter({
  name: 'cron_job_total',
  help: 'Total cron job executions by outcome',
  labelNames: ['job', 'status'] as const,  // status: success, failure
})

export const cronJobLastSuccess = new client.Gauge({
  name: 'cron_job_last_success_timestamp',
  help: 'Unix timestamp of last successful cron run',
  labelNames: ['job'] as const,
})

// Helpers

/**
 * Normalize an Express request path into a low-cardinality route label.
 * Replaces UUID-like segments and numeric IDs with placeholders.
 */
function normalizeRoute(req: Request): string {
  // Use the matched Express route pattern if available (best option)
  if (req.route?.path) {
    return req.baseUrl + req.route.path
  }
  // Fallback: collapse dynamic segments in the raw path
  let route = req.path || '/'
  // Replace UUIDs
  route = route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  // Replace numeric IDs
  route = route.replace(/\/\d+/g, '/:id')
  return route
}

/**
 * Express middleware that records request duration and count.
 * Mount early in the middleware chain (after security, before routes).
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip metrics endpoint itself to avoid self-referential noise
  if (req.path === '/metrics') return next()

  const end = httpRequestDuration.startTimer()

  res.on('finish', () => {
    const route = normalizeRoute(req)
    const labels = { method: req.method, route, status: String(res.statusCode) }
    end(labels)
    httpRequestsTotal.inc(labels)
  })

  next()
}

/**
 * Handler for GET /metrics - returns Prometheus exposition format.
 */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', client.register.contentType)
  res.end(await client.register.metrics())
}

/**
 * Sync pg pool stats into Prometheus gauges.
 * Call this on an interval (e.g. every 5s) or from the metrics handler.
 */
export function collectDBPoolMetrics(pool: any): void {
  const total = pool.totalCount ?? 0
  const idle = pool.idleCount ?? 0
  const waiting = pool.waitingCount ?? 0
  dbPoolActiveConnections.set(total - idle)
  dbPoolIdleConnections.set(idle)
  dbPoolWaitingCount.set(waiting)
}
