/**
 * SystemHealthPanel.tsx — Architecture Status Board
 *
 * Shows live status of all platform components:
 *   - Database connectivity & latency
 *   - AI Engine availability
 *   - n8n orchestration health, version, workflow count & fallback state
 *   - External API circuit breaker states
 *   - Recent error counts (frontend, backend, external)
 *   - Recent cron job executions
 *   - Data flow architecture overview
 *
 * Data is fetched from GET /api/internal/health/system
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Database, Brain, Workflow, Globe, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw, Zap, Shield,
  Server, Radio, ArrowRight, Layers,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface SystemHealth {
  timestamp: string
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

export default function SystemHealthPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lang = useLanguage()

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/internal/health/system')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setHealth(data)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchHealth])

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.loading', lang)}</span>
      </div>
    )
  }

  if (error && !health) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 dark:text-red-400 font-semibold">{t('admin.health.failed', lang)}</p>
        <p className="text-sm text-red-500 mt-1">{error}</p>
        <button
          onClick={fetchHealth}
          className="mt-3 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
        >
          {t('admin.health.retry', lang)}
        </button>
      </div>
    )
  }

  if (!health) return null

  const totalErrors = health.recent_errors.frontend + health.recent_errors.system + health.recent_errors.external
  const circuitBreakerEntries = Object.entries(health.circuit_breakers || {})

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">{t('admin.health.title', lang)}</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
            {t('admin.health.updated', lang)}: {new Date(health.timestamp).toLocaleTimeString()}
          </span>
          <button
            onClick={fetchHealth}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            title={t('admin.health.refresh', lang)}
          >
            <RefreshCw className="w-4 h-4 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
          </button>
        </div>
      </div>

      {/* Core Services */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Database */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-5 h-5 text-blue-500" />
            <span className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.database', lang)}</span>
          </div>
          <StatusBadge ok={health.database.ok} />
          <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-2">
            {t('admin.health.latency', lang)}: {health.database.latency_ms}ms
          </p>
        </div>

        {/* AI Engine */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-5 h-5 text-purple-500" />
            <span className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.aiEngine', lang)}</span>
          </div>
          <StatusBadge ok={health.ai_engine.ok} />
          <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-2">
            {health.ai_engine.ok ? `${t('admin.health.latency', lang)}: ${health.ai_engine.latency_ms}ms` : health.ai_engine.url}
          </p>
        </div>

        {/* n8n / Job Scheduler */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Workflow className="w-5 h-5 text-orange-500" />
            <span className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.jobScheduler', lang)}</span>
          </div>
          {(() => {
            const n8nConnected = health.n8n.status === 'connected' && health.n8n.healthy
            // Fallback counts as operational — cron jobs take over when n8n is absent
            const fallbackActive = health.n8n.fallback_active
            const notConfigured = health.n8n.status === 'not_configured'
            const isOperational = n8nConnected || fallbackActive || notConfigured
            const label = n8nConnected
              ? t('admin.health.n8nConnected', lang)
              : fallbackActive
                ? t('admin.health.fallbackActive', lang)
                : notConfigured
                  ? t('admin.health.active', lang)
                  : health.n8n.status === 'checking'
                    ? t('admin.health.checking', lang)
                    : t('admin.health.starting', lang)
            return <StatusBadge ok={isOperational} label={label} />
          })()}
          <div className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-2 space-y-0.5">
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
            {health.n8n.last_check && (
              <p>{t('admin.health.lastCheck', lang)}: {new Date(health.n8n.last_check).toLocaleTimeString()}</p>
            )}
          </div>
        </div>

        {/* Error Summary */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-red-500" />
            <span className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.errors1h', lang)}</span>
          </div>
          <StatusBadge ok={totalErrors === 0} label={totalErrors === 0 ? t('admin.health.clean', lang) : `${totalErrors} ${t('admin.health.errors', lang)}`} />
          <div className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-2 space-y-0.5">
            <p>{t('admin.health.frontend', lang)}: {health.recent_errors.frontend}</p>
            <p>{t('admin.health.backend', lang)}: {health.recent_errors.system}</p>
            <p>{t('admin.health.externalApi', lang)}: {health.recent_errors.external}</p>
          </div>
        </div>
      </div>

      {/* Circuit Breakers */}
      {circuitBreakerEntries.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-5 h-5 text-cyan-500" />
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.circuitBreakers', lang)}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {circuitBreakerEntries.map(([name, state]) => (
              <div
                key={name}
                className={`p-3 rounded-lg border ${
                  state.open
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                    {name}
                  </span>
                  <StatusBadge ok={!state.open} label={state.open ? t('admin.health.open', lang) : t('admin.health.closed', lang)} />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">
                  {t('admin.health.failures', lang)}: {state.failures}
                  {state.lastFailure && ` · ${t('admin.health.lastFailure', lang)}: ${new Date(state.lastFailure).toLocaleTimeString()}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Cron Jobs */}
      {health.recent_jobs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.recentJobs', lang)}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                  <th className="text-left py-2 pr-4">{t('admin.health.jobName', lang)}</th>
                  <th className="text-left py-2 pr-4">{t('common.status', lang)}</th>
                  <th className="text-right py-2 pr-4">{t('admin.health.duration', lang)}</th>
                  <th className="text-right py-2 pr-4">{t('admin.health.records', lang)}</th>
                  <th className="text-right py-2">{t('admin.health.completedAt', lang)}</th>
                </tr>
              </thead>
              <tbody>
                {health.recent_jobs.map((job, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                      {job.job_name}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className={`text-xs font-semibold ${
                        job.status === 'success' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-right text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                      {job.duration_ms}ms
                    </td>
                    <td className="py-1.5 pr-4 text-right text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                      {job.records_affected ?? '-'}
                    </td>
                    <td className="py-1.5 text-right text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                      {job.completed_at ? new Date(job.completed_at).toLocaleTimeString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Registered Workflow Definitions */}
      {health.workflow_definitions && health.workflow_definitions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.workflows', lang)}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.workflow_definitions.map((wf, i) => (
              <div key={i} className="p-3 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{wf.name}</span>
                  <StatusBadge ok={wf.active} label={wf.active ? t('admin.health.active', lang) : t('common.inactive', lang)} />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{wf.nodeCount} nodes</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Architecture Data Flow */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-5 h-5 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.health.architecture', lang)}</h3>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          {/* External Sources */}
          <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 min-w-[80px]">
            <Radio className="w-4 h-4 text-blue-500" />
            <span className="text-blue-700 dark:text-blue-400 font-semibold">SEPA / EA</span>
            <span className="text-blue-500 text-[10px]">Gauges, Alerts</span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />

          {/* n8n / Cron */}
          <div className={`flex flex-col items-center gap-1 p-2 rounded-lg border min-w-[80px] ${
            health.n8n.status === 'connected'
              ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800'
              : 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
          }`}>
            <Workflow className="w-4 h-4 text-orange-500" />
            <span className="text-orange-700 dark:text-orange-400 font-semibold">
              {health.n8n.status === 'connected' ? 'n8n' : 'Cron'}
            </span>
            <span className="text-orange-500 text-[10px]">
              {health.n8n.status === 'connected' ? 'Orchestrator' : 'Fallback'}
            </span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />

          {/* AEGIS Backend */}
          <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 min-w-[80px]">
            <Server className="w-4 h-4 text-green-500" />
            <span className="text-green-700 dark:text-green-400 font-semibold">{t('admin.health.backend', lang)}</span>
            <span className="text-green-500 text-[10px]">Express + Socket.IO</span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />

          {/* PostgreSQL */}
          <div className={`flex flex-col items-center gap-1 p-2 rounded-lg border min-w-[80px] ${
            health.database.ok
              ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
              : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
          }`}>
            <Database className="w-4 h-4 text-blue-500" />
            <span className="text-blue-700 dark:text-blue-400 font-semibold">PostgreSQL</span>
            <span className="text-blue-500 text-[10px]">{health.database.latency_ms}ms</span>
          </div>

          <div className="w-full sm:hidden" />

          {/* AI Engine */}
          <div className={`flex flex-col items-center gap-1 p-2 rounded-lg border min-w-[80px] ${
            health.ai_engine.ok
              ? 'bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800'
              : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
          }`}>
            <Brain className="w-4 h-4 text-purple-500" />
            <span className="text-purple-700 dark:text-purple-400 font-semibold">{t('admin.health.aiEngine', lang)}</span>
            <span className="text-purple-500 text-[10px]">FastAPI {health.ai_engine.ok ? `${health.ai_engine.latency_ms}ms` : t('admin.health.down', lang)}</span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />

          {/* Frontend */}
          <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 min-w-[80px]">
            <Globe className="w-4 h-4 text-cyan-500" />
            <span className="text-cyan-700 dark:text-cyan-400 font-semibold">{t('admin.health.frontend', lang)}</span>
            <span className="text-cyan-500 text-[10px]">React + Leaflet</span>
          </div>
        </div>
      </div>
    </div>
  )
}




