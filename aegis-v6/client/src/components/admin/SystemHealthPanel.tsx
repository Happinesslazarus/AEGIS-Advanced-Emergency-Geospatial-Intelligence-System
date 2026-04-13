/**
 * File: SystemHealthPanel.tsx
 *
 * What this file does:
 * Real-time dashboard card showing the operational health of all AEGIS backend services.
 * Displays a computed health score (0-100), server uptime, memory usage, and per-service
 * status cards for database, AI engine, scheduler (n8n), and circuit breakers.
 * Auto-refreshes every 30 seconds; also supports keyboard shortcut R to refresh.
 *
 * How it connects:
 * - Fetches from GET /api/internal/health/system (server/src/routes/internalRoutes.ts)
 * - Rendered inside AdminDashboard.tsx as the "System Health" section
 * - Uses apiFetch() from client/src/utils/api.ts (attaches auth token automatically)
 *
 * Simple explanation:
 * The ops dashboard for the admin. Shows whether the database, AI engine, and
 * automation workflows are running, how fast they are, and if any circuit breakers
 * have tripped. Refreshes automatically every 30 seconds.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Activity, Database, Brain, Workflow, Globe, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw, Zap, Shield,
  Server, Radio, ArrowRight, Layers, Keyboard, Cpu, HardDrive,
  Timer, MemoryStick, MonitorCheck, TrendingUp,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { apiFetch } from '../../utils/api'

interface SystemHealth {
  timestamp: string
  server_uptime_s?: number
  memory?: { rss_mb: number; heap_used_mb: number; heap_total_mb: number }
  database: { ok: boolean; latency_ms: number }
  ai_engine: { ok: boolean; url: string; latency_ms: number }
  n8n: {
    healthy: boolean
    status?: 'not_configured' | 'connected' | 'unreachable' | 'checking'
    consecutive_failures: number
    last_check: string | null
    fallback_active: boolean
    version?: string | null
    workflow_count?: number
    active_workflow_count?: number
  }
  cron_fallback_active: boolean
  circuit_breakers: Record<string, { failures: number; open: boolean; lastFailure: string | null }>
  recent_errors: { frontend: number; system: number; external: number }
  recent_jobs: Array<{
    job_name: string
    status: string
    duration_ms: number
    records_affected: number
    completed_at: string
  }>
  workflow_definitions?: Array<{ name: string; nodeCount: number; active: boolean }>
}

// Helpers -------------------------------------------------------------------

// Convert seconds into a human-readable uptime string, e.g. "3d 2h 45m"
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Map a latency value to a visual quality label + colour + bar percentage.
// Thresholds are tuned for a local/LAN backend (≤50ms is great, >500ms is critical).
function latencyQuality(ms: number): { label: string; color: string; barColor: string; pct: number } {
  if (ms <= 5)   return { label: 'Excellent', color: 'text-emerald-600 dark:text-emerald-400', barColor: 'bg-emerald-500', pct: 100 }
  if (ms <= 20)  return { label: 'Excellent', color: 'text-emerald-600 dark:text-emerald-400', barColor: 'bg-emerald-500', pct: 95 }
  if (ms <= 50)  return { label: 'Good',      color: 'text-green-600 dark:text-green-400',     barColor: 'bg-green-500',    pct: 80 }
  if (ms <= 150) return { label: 'Fair',      color: 'text-amber-600 dark:text-amber-400',     barColor: 'bg-amber-500',    pct: 55 }
  if (ms <= 500) return { label: 'Slow',      color: 'text-orange-600 dark:text-orange-400',   barColor: 'bg-orange-500',   pct: 35 }
  return                { label: 'Critical',  color: 'text-red-600 dark:text-red-400',         barColor: 'bg-red-500',      pct: 15 }
}

// Health score formula (0-100):
// - Database down: -40 points (most critical single-point failure)
// - AI engine down: -25 points
// - Scheduler unavailable: -15 points
// - High recent error count: -8 to -15 points
// - Open circuit breakers: -5 points each
function computeHealthScore(h: SystemHealth): number {
  let score = 100
  if (!h.database.ok) score -= 40
  else if (h.database.latency_ms > 100) score -= 10 // sluggish but alive
  else if (h.database.latency_ms > 50) score -= 5
  if (!h.ai_engine.ok) score -= 25
  else if (h.ai_engine.latency_ms > 500) score -= 10
  else if (h.ai_engine.latency_ms > 200) score -= 5
  // Scheduler is OK if n8n is healthy, OR if cron fallback is handling it, OR if n8n was never configured
  const schedulerOk = h.n8n.healthy || h.n8n.fallback_active || h.n8n.status === 'not_configured'
  if (!schedulerOk) score -= 15
  const totalErrors = h.recent_errors.frontend + h.recent_errors.system + h.recent_errors.external
  if (totalErrors > 20) score -= 15
  else if (totalErrors > 5) score -= 8
  else if (totalErrors > 0) score -= 3
  const openBreakers = Object.values(h.circuit_breakers || {}).filter(cb => cb.open).length
  score -= openBreakers * 5 // each open circuit breaker further degrades score
  return Math.max(0, Math.min(100, score))
}

function scoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function scoreBarColor(score: number): string {
  if (score >= 90) return 'bg-gradient-to-r from-emerald-500 to-green-400'
  if (score >= 70) return 'bg-gradient-to-r from-amber-500 to-yellow-400'
  return 'bg-gradient-to-r from-red-500 to-rose-400'
}

function scoreLabel(score: number, lang: string): string {
  if (score >= 95) return t('admin.health.scoreExcellent', lang)
  if (score >= 85) return t('admin.health.scoreGood', lang)
  if (score >= 70) return t('admin.health.scoreFair', lang)
  return t('admin.health.scorePoor', lang)
}

// Sub-components -------------------------------------------------------------

// Small pill badge showing a green tick or red X with healthy/down label.
function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  const lang = useLanguage()
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
      ok
        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    }`}>
      {ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label || (ok ? t('admin.health.healthy', lang) : t('admin.health.down', lang))}
    </span>
  )
}

function LatencyBar({ ms, ok }: { ms: number; ok: boolean }) {
  if (!ok) return <div className="h-1.5 w-full rounded-full bg-red-200 dark:bg-red-900/40 mt-2"><div className="h-full rounded-full bg-red-500 w-full animate-pulse" /></div>
  const q = latencyQuality(ms)
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
        <div className={`h-full rounded-full ${q.barColor} transition-all duration-700 ease-out`} style={{ width: `${q.pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className={`text-[9px] font-bold ${q.color}`}>{q.label}</span>
        <span className="text-[9px] text-gray-400 dark:text-gray-400">{ms}ms</span>
      </div>
    </div>
  )
}

// Main component -------------------------------------------------------------
export default function SystemHealthPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lang = useLanguage()

  const fetchHealth = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/api/internal/health/system')
      setHealth(data)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + 30-second auto-refresh. Cleans up the interval on unmount.
  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  // Keyboard shortcuts: R = refresh, ? = toggle shortcut help, Esc = close help
  // Guard against firing while typing in form fields.
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fetchHealth() }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [fetchHealth])

  // Memoised so the expensive score computation only re-runs when health data changes
  const healthScore = useMemo(() => health ? computeHealthScore(health) : 0, [health])

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500 dark:text-gray-300">{t('admin.health.loading', lang)}</span>
      </div>
    )
  }

  if (error && !health) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 dark:text-red-400 font-semibold">{t('admin.health.failed', lang)}</p>
        <p className="text-sm text-red-500 mt-1">{error}</p>
        <button onClick={fetchHealth} className="mt-3 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700">
          {t('admin.health.retry', lang)}
        </button>
      </div>
    )
  }

  if (!health) return null

  const totalErrors = health.recent_errors.frontend + health.recent_errors.system + health.recent_errors.external
  const circuitBreakerEntries = Object.entries(health.circuit_breakers || {})
  const dbUp = health.database.ok
  const aiUp = health.ai_engine.ok
  const schedulerUp = health.n8n.healthy || health.n8n.fallback_active || health.n8n.status === 'not_configured'
  const allUp = dbUp && aiUp && schedulerUp && totalErrors === 0

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-gray-900 to-slate-800 text-white p-6">
        {/* Animated background */}
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-white/5 animate-pulse" style={{
              width: `${40 + i * 30}px`, height: `${40 + i * 30}px`,
              top: `${5 + i * 22}%`, right: `${5 + i * 12}%`,
              animationDelay: `${i * 0.8}s`, animationDuration: `${3 + i}s`,
            }} />
          ))}
        </div>

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">{t('admin.health.title', lang)}</h2>
                <p className="text-white/50 text-xs">{t('admin.health.updated', lang)}: {new Date(health.timestamp).toLocaleTimeString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Overall status badge */}
              {(() => {
                const critical = !dbUp
                const label = critical
                  ? t('admin.health.critical', lang)
                  : allUp
                    ? t('admin.health.allOperational', lang)
                    : t('admin.health.degraded', lang)
                const bg = critical ? 'bg-red-500/20 border-red-400/30' : allUp ? 'bg-emerald-500/20 border-emerald-400/30' : 'bg-amber-500/20 border-amber-400/30'
                return (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border backdrop-blur-sm ${bg}`}>
                    <span className={`w-2 h-2 rounded-full animate-pulse ${critical ? 'bg-red-400' : allUp ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {label}
                  </span>
                )
              })()}
              <button onClick={() => setShowKeyboard(p => !p)} className="p-2 rounded-lg hover:bg-white/10 transition" title={t('admin.health.shortcutsLabel', lang)}>
                <Keyboard className="w-4 h-4 text-white/60" />
              </button>
              <button onClick={fetchHealth} className="p-2 rounded-lg hover:bg-white/10 transition" title={t('admin.health.refresh', lang)}>
                <RefreshCw className="w-4 h-4 text-white/60" />
              </button>
            </div>
          </div>

          {/* Health Score + Uptime + Memory row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* System Health Score */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-white/60" />
                <span className="text-xs font-bold text-white/60 uppercase tracking-wider">{t('admin.health.healthScore', lang)}</span>
              </div>
              <div className="flex items-end gap-3">
                <span className={`text-3xl font-black tabular-nums ${scoreColor(healthScore)}`}>{healthScore}</span>
                <span className="text-white/40 text-sm font-bold mb-1">/ 100</span>
                <span className={`text-xs font-bold mb-1.5 ${scoreColor(healthScore)}`}>{scoreLabel(healthScore, lang)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10 mt-3">
                <div className={`h-full rounded-full ${scoreBarColor(healthScore)} transition-all duration-1000 ease-out`} style={{ width: `${healthScore}%` }} />
              </div>
            </div>

            {/* Server Uptime */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Timer className="w-4 h-4 text-white/60" />
                <span className="text-xs font-bold text-white/60 uppercase tracking-wider">{t('admin.health.serverUptime', lang)}</span>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black tabular-nums text-white">
                  {health.server_uptime_s != null ? formatUptime(health.server_uptime_s) : '—'}
                </span>
              </div>
              <p className="text-xs text-white/30 mt-2">{t('admin.health.uptimeDesc', lang)}</p>
            </div>

            {/* Memory Usage */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-white/60" />
                <span className="text-xs font-bold text-white/60 uppercase tracking-wider">{t('admin.health.memoryUsage', lang)}</span>
              </div>
              {health.memory ? (
                <>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-black tabular-nums text-white">{health.memory.heap_used_mb}</span>
                    <span className="text-white/40 text-sm font-bold mb-1">/ {health.memory.heap_total_mb} MB</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10 mt-3">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        health.memory.heap_used_mb / health.memory.heap_total_mb > 0.85 ? 'bg-red-500' :
                        health.memory.heap_used_mb / health.memory.heap_total_mb > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, (health.memory.heap_used_mb / health.memory.heap_total_mb) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-white/30 mt-1">RSS: {health.memory.rss_mb} MB</p>
                </>
              ) : (
                <span className="text-2xl font-black text-white/40">—</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Core Services */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Database */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${dbUp ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                <Database className={`w-4 h-4 ${dbUp ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`} />
              </div>
              <span className="font-bold text-gray-700 dark:text-gray-300 text-sm">{t('admin.health.database', lang)}</span>
            </div>
            {dbUp && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          <StatusBadge ok={dbUp} />
          <LatencyBar ms={health.database.latency_ms} ok={dbUp} />
        </div>

        {/* AI Engine */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${aiUp ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                <Brain className={`w-4 h-4 ${aiUp ? 'text-purple-600 dark:text-purple-400' : 'text-red-600 dark:text-red-400'}`} />
              </div>
              <span className="font-bold text-gray-700 dark:text-gray-300 text-sm">{t('admin.health.aiEngine', lang)}</span>
            </div>
            {aiUp && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          <StatusBadge ok={aiUp} />
          <LatencyBar ms={health.ai_engine.latency_ms} ok={aiUp} />
        </div>

        {/* Job Scheduler */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${schedulerUp ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                <Workflow className={`w-4 h-4 ${schedulerUp ? 'text-orange-600 dark:text-orange-400' : 'text-red-600 dark:text-red-400'}`} />
              </div>
              <span className="font-bold text-gray-700 dark:text-gray-300 text-sm">{t('admin.health.jobScheduler', lang)}</span>
            </div>
            {schedulerUp && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          {(() => {
            const n8nConnected = health.n8n.status === 'connected' && health.n8n.healthy
            const fallbackActive = health.n8n.fallback_active
            const notConfigured = health.n8n.status === 'not_configured'
            const label = n8nConnected
              ? t('admin.health.n8nConnected', lang)
              : fallbackActive
                ? t('admin.health.fallbackActive', lang)
                : notConfigured
                  ? t('admin.health.active', lang)
                  : health.n8n.status === 'checking'
                    ? t('admin.health.checking', lang)
                    : t('admin.health.starting', lang)
            return <StatusBadge ok={schedulerUp} label={label} />
          })()}
          <div className="text-xs text-gray-400 dark:text-gray-400 mt-2 space-y-0.5">
            {health.n8n.status === 'connected' && (
              <>
                {health.n8n.version && <p>n8n v{health.n8n.version}</p>}
                <p>{health.n8n.active_workflow_count || 0}/{health.n8n.workflow_count || 0} {t('admin.health.workflowsActive', lang)}</p>
              </>
            )}
            {(health.n8n.status === 'not_configured' || health.n8n.fallback_active) && (
              <p className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-green-500" />
                {t('admin.health.internalCron', lang)}
              </p>
            )}
          </div>
        </div>

        {/* Error Summary */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totalErrors === 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                <Shield className={`w-4 h-4 ${totalErrors === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`} />
              </div>
              <span className="font-bold text-gray-700 dark:text-gray-300 text-sm">{t('admin.health.errors1h', lang)}</span>
            </div>
            {totalErrors === 0 && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          <StatusBadge ok={totalErrors === 0} label={totalErrors === 0 ? t('admin.health.clean', lang) : `${totalErrors} ${t('admin.health.errors', lang)}`} />
          <div className="text-xs text-gray-400 dark:text-gray-400 mt-3 space-y-1">
            {[
              { label: t('admin.health.frontend', lang), val: health.recent_errors.frontend },
              { label: t('admin.health.backend', lang), val: health.recent_errors.system },
              { label: t('admin.health.externalApi', lang), val: health.recent_errors.external },
            ].map(({ label, val }) => (
              <div key={label} className="flex items-center justify-between">
                <span>{label}</span>
                <span className={`font-bold ${val > 0 ? 'text-red-500' : 'text-gray-300 dark:text-gray-400'}`}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Circuit Breakers */}
      {circuitBreakerEntries.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-5 h-5 text-cyan-500" />
            <h3 className="font-bold text-gray-700 dark:text-gray-300">{t('admin.health.circuitBreakers', lang)}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {circuitBreakerEntries.map(([name, state]) => (
              <div
                key={name}
                className={`p-3 rounded-lg border transition-all ${
                  state.open
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20 shadow-sm shadow-red-200 dark:shadow-red-900/20'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono font-bold text-gray-700 dark:text-gray-300">{name}</span>
                  <StatusBadge ok={!state.open} label={state.open ? t('admin.health.open', lang) : t('admin.health.closed', lang)} />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">
                  {t('admin.health.failures', lang)}: {state.failures}
                  {state.lastFailure && ` — ${t('admin.health.lastFailure', lang)}: ${new Date(state.lastFailure).toLocaleTimeString()}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Architecture Data Flow */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-5">
          <Server className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="font-bold text-gray-700 dark:text-gray-300">{t('admin.health.architecture', lang)}</h3>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
          {/* External Sources */}
          <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 min-w-[90px] relative">
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
            <Radio className="w-5 h-5 text-blue-500" />
            <span className="text-blue-700 dark:text-blue-400 font-bold">SEPA / EA</span>
            <span className="text-blue-500/70 text-[10px]">{t('admin.health.dataSources', lang)}</span>
          </div>

          <div className="flex items-center"><ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-400" /><div className="w-4 h-px bg-gradient-to-r from-gray-300 to-transparent dark:from-gray-600" /></div>

          {/* Orchestrator */}
          <div className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border min-w-[90px] relative ${
            health.n8n.status === 'connected'
              ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800'
              : 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
          }`}>
            {schedulerUp && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />}
            <Workflow className="w-5 h-5 text-orange-500" />
            <span className="text-orange-700 dark:text-orange-400 font-bold">
              {health.n8n.status === 'connected' ? 'n8n' : 'Cron'}
            </span>
            <span className="text-orange-500/70 text-[10px]">
              {health.n8n.status === 'connected' ? t('admin.health.orchestrator', lang) : t('admin.health.cronFallback', lang)}
            </span>
          </div>

          <div className="flex items-center"><ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-400" /><div className="w-4 h-px bg-gradient-to-r from-gray-300 to-transparent dark:from-gray-600" /></div>

          {/* AEGIS Backend */}
          <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 min-w-[90px] relative">
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
            <Server className="w-5 h-5 text-green-500" />
            <span className="text-green-700 dark:text-green-400 font-bold">{t('admin.health.backend', lang)}</span>
            <span className="text-green-500/70 text-[10px]">Express + Socket.IO</span>
          </div>

          <div className="flex items-center"><ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-400" /><div className="w-4 h-px bg-gradient-to-r from-gray-300 to-transparent dark:from-gray-600" /></div>

          {/* PostgreSQL */}
          <div className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border min-w-[90px] relative ${
            dbUp ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800' : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
          }`}>
            {dbUp && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />}
            <Database className="w-5 h-5 text-blue-500" />
            <span className="text-blue-700 dark:text-blue-400 font-bold">PostgreSQL</span>
            <span className="text-blue-500/70 text-[10px]">{health.database.latency_ms}ms</span>
          </div>

          <div className="w-full sm:hidden" />

          {/* AI Engine */}
          <div className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border min-w-[90px] relative ${
            aiUp ? 'bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800' : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
          }`}>
            {aiUp && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />}
            <Brain className="w-5 h-5 text-purple-500" />
            <span className="text-purple-700 dark:text-purple-400 font-bold">{t('admin.health.aiEngine', lang)}</span>
            <span className="text-purple-500/70 text-[10px]">FastAPI {aiUp ? `${health.ai_engine.latency_ms}ms` : t('admin.health.down', lang)}</span>
          </div>

          <div className="flex items-center"><ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-400" /><div className="w-4 h-px bg-gradient-to-r from-gray-300 to-transparent dark:from-gray-600" /></div>

          {/* Frontend */}
          <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 min-w-[90px] relative">
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
            <Globe className="w-5 h-5 text-cyan-500" />
            <span className="text-cyan-700 dark:text-cyan-400 font-bold">{t('admin.health.frontend', lang)}</span>
            <span className="text-cyan-500/70 text-[10px]">React + Leaflet</span>
          </div>
        </div>
      </div>

      {/* Recent Cron Jobs */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-indigo-500" />
          <h3 className="font-bold text-gray-700 dark:text-gray-300">{t('admin.health.recentJobs', lang)}</h3>
        </div>
        {health.recent_jobs.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-400 text-center py-4">{t('admin.health.noJobs', lang)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <th className="text-left py-2 pr-4">{t('admin.health.jobName', lang)}</th>
                  <th className="text-left py-2 pr-4">{t('common.status', lang)}</th>
                  <th className="text-right py-2 pr-4">{t('admin.health.duration', lang)}</th>
                  <th className="text-right py-2 pr-4">{t('admin.health.records', lang)}</th>
                  <th className="text-right py-2">{t('admin.health.completedAt', lang)}</th>
                </tr>
              </thead>
              <tbody>
                {health.recent_jobs.map((job, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{job.job_name}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold ${
                        job.status === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {job.status === 'success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right text-xs text-gray-500 dark:text-gray-400">{job.duration_ms}ms</td>
                    <td className="py-2 pr-4 text-right text-xs text-gray-500 dark:text-gray-400">{job.records_affected ?? '-'}</td>
                    <td className="py-2 text-right text-xs text-gray-400 dark:text-gray-400">{job.completed_at ? new Date(job.completed_at).toLocaleTimeString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Workflow Definitions */}
      {health.workflow_definitions && health.workflow_definitions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-5 h-5 text-orange-500" />
            <h3 className="font-bold text-gray-700 dark:text-gray-300">{t('admin.health.workflows', lang)}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.workflow_definitions.map((wf, i) => (
              <div key={i} className="p-3 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{wf.name}</span>
                  <StatusBadge ok={wf.active} label={wf.active ? t('admin.health.active', lang) : t('common.inactive', lang)} />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-400">{wf.nodeCount} {t('admin.health.nodes', lang)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technology Stack */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <MonitorCheck className="w-5 h-5 text-violet-500" />
          <h3 className="font-bold text-gray-700 dark:text-gray-300">{t('admin.health.techStack', lang)}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-cyan-50/50 dark:bg-cyan-950/10 border border-cyan-200/60 dark:border-cyan-800/40">
            <p className="text-[9px] uppercase font-bold tracking-wider text-cyan-600 dark:text-cyan-400 mb-1">{t('admin.health.frontend', lang)}</p>
            <p className="text-xs font-bold text-gray-700 dark:text-gray-300">React 18 + TypeScript</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5">Tailwind CSS + Leaflet + Vite</p>
          </div>
          <div className="p-3 rounded-lg bg-green-50/50 dark:bg-green-950/10 border border-green-200/60 dark:border-green-800/40">
            <p className="text-[9px] uppercase font-bold tracking-wider text-green-600 dark:text-green-400 mb-1">{t('admin.health.backend', lang)}</p>
            <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Express.js + Socket.IO</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5">PostgreSQL + PostGIS</p>
          </div>
          <div className="p-3 rounded-lg bg-purple-50/50 dark:bg-purple-950/10 border border-purple-200/60 dark:border-purple-800/40">
            <p className="text-[9px] uppercase font-bold tracking-wider text-purple-600 dark:text-purple-400 mb-1">{t('admin.health.aiEngine', lang)}</p>
            <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Python FastAPI</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5">XGBoost + LSTM + CatBoost</p>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      {showKeyboard && (
        <div className="bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{t('admin.health.shortcutsLabel', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> {t('admin.health.shortcutRefresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {t('admin.health.shortcutToggle', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{t('common.esc', lang)}</kbd> {t('admin.health.shortcutClose', lang)}</span>
        </div>
      )}
    </div>
  )
}

