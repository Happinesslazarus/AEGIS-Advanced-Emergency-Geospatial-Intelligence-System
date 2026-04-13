/**
 * File: n8nHealthCheck.ts
 *
 * n8n workflow server health monitor — pings n8n every 60 seconds and
 * activates fallback cron jobs after 3 consecutive failures. Deactivates
 * fallbacks when n8n reconnects.
 *
 * How it connects:
 * - Pings the n8n server at N8N_HOST on a 60-second interval
 * - Calls activateFallbackJobs/deactivateFallbackJobs from cronJobs
 * - Triggers workflow re-registration via n8nWorkflowService on reconnect
 *
 * Simple explanation:
 * Checks if the n8n automation server is alive and switches to backup jobs if it's not.
 */

import { activateFallbackJobs, deactivateFallbackJobs } from './cronJobs.js'
import { tryRegisterWorkflows, resetRegistration } from './n8nWorkflowService.js'
import { logger } from './logger.js'

export interface N8nHealthState {
  isHealthy: boolean
  consecutiveFailures: number
  fallbackActive: boolean
  lastChecked: Date | null
  lastHealthy: Date | null
  status: 'not_configured' | 'standalone' | 'connected' | 'unreachable' | 'checking'
  version: string | null
  workflowCount: number
  activeWorkflowCount: number
}

const MAX_FAILURES_BEFORE_FALLBACK = 3
const CHECK_INTERVAL_MS = 60_000 // every 60 seconds

let state: N8nHealthState = {
  isHealthy: true,
  consecutiveFailures: 0,
  fallbackActive: false,
  lastChecked: null,
  lastHealthy: null,
  status: 'checking',
  version: null,
  workflowCount: 0,
  activeWorkflowCount: 0,
}

let intervalId: ReturnType<typeof setInterval> | null = null

function n8nHeaders(): Record<string, string> {
  const apiKey = process.env.N8N_API_KEY
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey
  return headers
}

/**
 * Check if n8n is reachable and fetch version/workflow stats.
 */
async function checkN8nHealth(): Promise<boolean> {
  const n8nUrl = process.env.N8N_BASE_URL

  // If n8n is not configured, assume it's not available — run fallback mode
  if (!n8nUrl) {
    return false
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const headers = n8nHeaders()

    // Fetch workflows (also proves API is reachable)
    const response = await fetch(`${n8nUrl}/api/v1/workflows?limit=100`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    if (!response.ok) return false

    // Parse workflow stats
    try {
      const body = await response.json()
      const workflows = body.data || body || []
      if (Array.isArray(workflows)) {
        state.workflowCount = workflows.length
        state.activeWorkflowCount = workflows.filter((w: any) => w.active).length
      }
    } catch { /* parse failure — still reachable */ }

    // Try to get n8n version from /api/v1/info or /healthz
    try {
      const versionRes = await fetch(`${n8nUrl}/api/v1/info`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(3000),
      })
      if (versionRes.ok) {
        const info = await versionRes.json()
        state.version = info.versionCli || info.version || null
      }
    } catch {
      // Version endpoint not available — try healthz
      try {
        const hz = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(3000) })
        if (hz.ok) {
          const hzData = await hz.json().catch(() => ({}))
          state.version = hzData.version || state.version
        }
      } catch { /* no version info */ }
    }

    return true
  } catch {
    return false
  }
}

/**
 * Main health check loop iteration
 */
async function runCheck(): Promise<void> {
  const healthy = await checkN8nHealth()
  state.lastChecked = new Date()

  if (healthy) {
    const wasDown = state.consecutiveFailures >= MAX_FAILURES_BEFORE_FALLBACK
    state.isHealthy = true
    state.consecutiveFailures = 0
    state.lastHealthy = new Date()
    state.status = 'connected'

    // Auto-register workflows on first connect or recovery
    tryRegisterWorkflows().catch(() => {})

    if (wasDown && state.fallbackActive) {
      // n8n recovered — deactivate fallback
      logger.info('[n8n] n8n recovered — deactivating fallback cron jobs')
      state.fallbackActive = false
      deactivateFallbackJobs()
    }
  } else {
    state.isHealthy = false
    state.consecutiveFailures++
    state.status = 'unreachable'

    if (state.consecutiveFailures >= MAX_FAILURES_BEFORE_FALLBACK && !state.fallbackActive) {
      // n8n has been down for 3+ checks — activate fallback
      logger.warn({ failures: state.consecutiveFailures }, '[n8n] n8n unreachable — activating fallback cron jobs')
      state.fallbackActive = true
      resetRegistration() // re-register workflows when n8n recovers
      activateFallbackJobs()
    } else if (state.consecutiveFailures < MAX_FAILURES_BEFORE_FALLBACK) {
      logger.warn({ failures: state.consecutiveFailures, maxFailures: MAX_FAILURES_BEFORE_FALLBACK }, '[n8n] Health check failed')
    }
  }
}

/**
 * Start the n8n health monitor.
 * Called from server startup (index.ts).
 */
export function startN8nHealthMonitor(): void {
  if (intervalId) return // already running

  // If N8N_BASE_URL is not configured, immediately activate fallback
  if (!process.env.N8N_BASE_URL) {
    logger.info('[n8n] Standalone mode — built-in scheduler active (no external orchestrator)')
    state.isHealthy = true
    state.fallbackActive = true
    state.lastChecked = new Date()
    state.status = 'standalone'
    activateFallbackJobs()
    return
  }

  logger.info({ intervalSec: CHECK_INTERVAL_MS / 1000, maxFailures: MAX_FAILURES_BEFORE_FALLBACK }, '[n8n] Starting health monitor')

  // Initial check
  runCheck()

  // Periodic checks
  intervalId = setInterval(runCheck, CHECK_INTERVAL_MS)
}

/**
 * Stop the health monitor (for graceful shutdown).
 */
export function stopN8nHealthMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/**
 * Get current n8n health state for the System Health dashboard.
 */
export function getN8nHealthState(): N8nHealthState {
  return { ...state }
}
