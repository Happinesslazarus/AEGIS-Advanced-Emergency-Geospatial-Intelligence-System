/**
 * Admin-facing AI governance and observability dashboard. Shows model metrics
 * (accuracy, F1, precision, recall), data drift detection, prediction audit
 * trails, LLM provider status, and model comparison tables.
 *
 * Tabs:
 * - Overview: KPI summary cards, governance decision feed, avg accuracy
 * - Models: per-model cards with confusion matrix, feature importance, retrain
 * - Drift: per-model drift detection results and magnitude visualization
 * - Audit: timestamped AI decision log with input/output pairs
 * - LLM Providers: chat model availability and health indicators
 *
 * Data flow:
 * - Polls six API endpoints every 30s via Promise.allSettled
 * - Partial failures are surfaced as amber warnings (not catastrophic errors)
 * - Retrain triggers POST /api/ai/governance/retrain/:hazardType
 *
 * - Rendered inside AdminPage.tsx when the AI view is active
 * - Uses apiGetGovernanceModels, apiGetAIDrift, apiGetAIAuditLog, etc. from utils/api.ts
 * */

import { useState, useEffect, useRef, Component, type ReactNode, type ErrorInfo, useCallback } from 'react'
import {
  Brain, Target, BarChart3, Activity, Calendar, Database, AlertTriangle, CheckCircle,
  Loader2, RefreshCw, Shield, Zap, Eye, GitBranch,
  Clock, Layers, ChevronDown, ChevronUp,
  Server, Gauge, FlaskConical, PieChart, LineChart, Sparkles,
  ShieldCheck, ShieldAlert, Hash, FileSearch, RotateCcw, Download, GitCompare,
  TrendingUp, TrendingDown, Minus
} from 'lucide-react'
import {
  apiGetGovernanceModels, apiGetConfidenceDistribution, apiGetAIAuditLog,
  apiGetAIStatus, apiGetAIDrift, apiGetAIPredictionStats, apiGetGovernanceDrift,
  apiGetChatStatus, apiRetrainModel,
} from '../../utils/api'
import { t, getLanguage } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

// Exports all loaded dashboard data as CSV or JSON file download.
// CSV flattens nested objects into a section + field table.
function exportData(payload: object, format: 'csv' | 'json', filename: string): void {
  let content: string
  let mime: string
  if (format === 'json') {
    content = JSON.stringify(payload, null, 2)
    mime = 'application/json'
  } else {
    const rows = Object.entries(payload).flatMap(([key, val]) => {
      if (Array.isArray(val)) return val.map((item: any) => ({ section: key, ...item }))
      if (typeof val === 'object' && val !== null) return [{ section: key, ...val }]
      return [{ section: key, value: val }]
    })
    const headers = [...new Set(rows.flatMap(Object.keys))]
    content = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? '')).join(','))].join('\n')
    mime = 'text/csv'
  }
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${filename}.${format}`; a.click()
  URL.revokeObjectURL(url)
}

/*  Error Boundary  */
class AIErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('AITransparencyDashboard crash:', error, info) }
  render() {
    const lang = getLanguage()
    if (this.state.hasError) return (
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 dark:text-red-300 font-semibold mb-1">{t('ai.dashboardError', lang)}</p>
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{this.state.error}</p>
        <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">{t('common.retry', lang)}</button>
      </div>
    )
    return this.props.children
  }
}

/*  Helpers  */
// Fix double-encoded UTF-8 sequences that appear in some AI model output strings.
// These patterns arise from incorrect Latin-1 to UTF-8 double-encoding, commonly
// seen in model notes and API responses from misconfigured Python services.
function fixEncoding(text: string): string {
  if (!text || typeof text !== 'string') return text || ''
  return text
    .replace(/Â£/g, '£').replace(/Â©/g, '©').replace(/Â®/g, '®')
    .replace(/â€™/g, "'").replace(/â€œ/g, '"').replace(/â€\x9D/g, '"')
    .replace(/â€"/g, '—').replace(/â€"/g, '–')
    .replace(/Ã©/g, 'é').replace(/Ã¨/g, 'è').replace(/Ã¼/g, 'ü')
    .replace(/Ã¶/g, 'ö').replace(/Ã¤/g, 'ä').replace(/Ã±/g, 'ñ')
    .replace(/Ã¡/g, 'á').replace(/Ã­/g, 'í').replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú')
    .replace(/â€¦/g, '…').replace(/â€¢/g, '•').replace(/â€˜/g, "'")
    .replace(/Ã‚/g, '').replace(/Ã¢/g, 'â')
}
const REGION_DISPLAY: Record<string, string> = {
  uk: 'United Kingdom', scotland: 'Scotland', england: 'England', wales: 'Wales',
  northamerica: 'North America', europe: 'Europe', asia: 'Asia', africa: 'Africa',
  southamerica: 'South America', oceania: 'Oceania', global: 'Global',
}
// KNOWN_ACRONYMS: words that should stay UPPERCASE rather than getting title-cased.
const KNOWN_ACRONYMS = new Set([
  'ai', 'ml', 'dem', 'sepa', 'api', 'id', 'url', 'gps', 'nlp', 'aws', 'ui', 'ux',
  'qgis', 'lidar', 'ndvi', 'dhm', 'uk', 'eu', 'un', 'ngo', 'sar', 'eo', 'csv',
  'pdf', 'iot', 'gpu', 'cpu', 'ram', 'sql', '3d',
])
// Convert snake_case/kebab-case model names into readable title-case display names,
// preserving known acronyms (API, ML, etc.) in uppercase.
function humanizeName(name: string): string {
  if (!name) return name
  const normalized = name.toLowerCase().replace(/[_\-\/]/g, ' ').trim()
  const noSpaces = normalized.replace(/\s/g, '')
  if (REGION_DISPLAY[noSpaces]) return REGION_DISPLAY[noSpaces]
  return normalized.split(/\s+/).filter(Boolean).map(word =>
    KNOWN_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}
function fmt(d: string): string {
  if (!d) return '—'
  try { const x = new Date(d); return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) } catch { return d }
}
function pct(v: number): string { return `${(v * 100).toFixed(1)}%` }
function metricColor(v: number): string { return v >= 0.9 ? 'text-emerald-600 dark:text-emerald-400' : v >= 0.8 ? 'text-blue-600 dark:text-blue-400' : v >= 0.7 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400' }
function barColor(v: number): string { return v >= 0.9 ? 'from-emerald-500 to-green-400' : v >= 0.8 ? 'from-blue-500 to-cyan-400' : v >= 0.7 ? 'from-amber-500 to-yellow-400' : 'from-red-500 to-rose-400' }

/*  Staleness helpers  */
function daysSince(dateStr: string): number {
  if (!dateStr) return 999
  try { const d = new Date(dateStr); return isNaN(d.getTime()) ? 999 : Math.floor((Date.now() - d.getTime()) / 86400000) } catch { return 999 }
}
function stalenessLabel(days: number, lang?: string): { text: string; color: string } | null {
  if (days > 30) return { text: t('ai.stale', lang || 'en'), color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
  if (days > 7) return { text: t('ai.needsUpdate', lang || 'en'), color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
  return null
}
function trendArrow(current: number, _index: number, _models: ModelData[]): string {
  // Compare against healthy threshold — accuracy > 0.85 trending up, < 0.75 trending down
  if (current >= 0.85) return '\u2191'
  if (current < 0.75) return '\u2193'
  return '\u2192'
}
// Color-coded drift indicator for a named model.
// Green = no drift, yellow = minor drift (magnitude ≤0.1), red = significant drift (>0.1).
function driftCircle(modelName: string, driftData: any[], lang?: string): { color: string; label: string } {
  const l = lang || 'en'
  const entry = driftData.find((d: any) => (d.modelName || d.model_name || '') === modelName)
  if (!entry) return { color: 'bg-green-500', label: t('ai.noDrift', l) }
  const hasDrift = entry.driftDetected || entry.drift_detected
  const magnitude = entry.driftMagnitude || entry.drift_magnitude || 0
  if (!hasDrift) return { color: 'bg-green-500', label: t('ai.noDrift', l) }
  if (magnitude > 0.1) return { color: 'bg-red-500', label: t('ai.significantDrift', l) }
  return { color: 'bg-yellow-500', label: t('ai.minorDrift', l) }
}
function governanceEntryColor(entry: any): string {
  const action = (entry.action || entry.inputSummary || entry.input_summary || '').toLowerCase()
  const status = (entry.status || '').toLowerCase()
  if (action.includes('auto-flag') || action.includes('flag') || status === 'error')
    return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
  if (action.includes('human') || action.includes('review') || action.includes('manual'))
    return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
  return 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
}
// Fleet health roll-up: red if any model is >30 days stale or <70% accuracy.
// This drives the badge on the AI section's nav item.
function dataHealthScore(models: ModelData[], lang?: string): { label: string; color: string } {
  const l = lang || 'en'
  if (models.length === 0) return { label: t('ai.noData', l), color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  const avgDays = models.reduce((a, m) => a + daysSince(m.lastTrained), 0) / models.length
  const avgAcc = models.reduce((a, m) => a + m.accuracy, 0) / models.length
  if (avgDays > 30 || avgAcc < 0.7) return { label: t('ai.critical', l), color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
  if (avgDays > 7 || avgAcc < 0.8) return { label: t('common.warning', l), color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }
  return { label: t('ai.good', l), color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' }
}

interface ModelData {
  name: string; version: string; accuracy: number; precision: number; recall: number; f1: number
  lastTrained: string; trainingSamples: number; notes: string
  cm: { labels: string[]; matrix: number[][] }
  fi: Array<{ n: string; v: number }>
  cd: Array<{ l: string; c: number }>
}

type SubTab = 'overview' | 'models' | 'drift' | 'audit' | 'llm'

export default function AITransparencyDashboard(): JSX.Element {
  const lang = useLanguage()
  return <AIErrorBoundary><AITransparencyDashboardInner /></AIErrorBoundary>
}

function AITransparencyDashboardInner(): JSX.Element {
  const lang = useLanguage()
  const [models, setModels] = useState<ModelData[]>([])
  const [sel, setSel] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<SubTab>('overview')
  const [aiStatus, setAiStatus] = useState<any>(null)
  const [driftData, setDriftData] = useState<any[]>([])
  const [auditEntries, setAuditEntries] = useState<any[]>([])
  const [predStats, setPredStats] = useState<any>(null)
  const [llmStatus, setLlmStatus] = useState<any>(null)
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
  const [retraining, setRetraining] = useState<string | null>(null)
  const [retrainStatus, setRetrainStatus] = useState<Record<string, 'idle' | 'running' | 'done' | 'error'>>({})
  const [retrainMsg, setRetrainMsg] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [partialFailures, setPartialFailures] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [governanceDecisions, setGovernanceDecisions] = useState<any[]>([])
  const [governanceLoading, setGovernanceLoading] = useState(false)
  const dashboardRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    setRefreshing(true)
    try {
      // Use Promise.allSettled so partial failures don't block the whole dashboard.
      // Each rejected result is surfaced as an amber warning banner, not a crash.
      const [modelsData, distData, statusData, driftRes, auditRes, statsRes, llmRes] = await Promise.allSettled([
        apiGetGovernanceModels(),
        apiGetConfidenceDistribution(),
        apiGetAIStatus(),
        apiGetGovernanceDrift(),
        apiGetAIAuditLog(30, 0),
        apiGetAIPredictionStats(),
        apiGetChatStatus(),
      ])

      const failed: string[] = []
      if (modelsData.status === 'rejected') failed.push('Model metrics')
      if (distData.status === 'rejected') failed.push('Confidence distribution')
      if (statusData.status === 'rejected') failed.push('AI status')
      if (driftRes.status === 'rejected') failed.push('Drift checks')
      if (auditRes.status === 'rejected') failed.push('Audit trail')
      if (statsRes.status === 'rejected') failed.push('Prediction stats')
      if (llmRes.status === 'rejected') failed.push('LLM status')
      setPartialFailures(failed)

      const dist: Array<{ l: string; c: number }> = []
      if (distData.status === 'fulfilled' && Array.isArray(distData.value)) {
        dist.push(...distData.value.map((d: any) => ({ l: d.label || d.l, c: d.count || d.c })))
      }

      if (modelsData.status === 'fulfilled') {
        const raw = modelsData.value
        const transformed: ModelData[] = (Array.isArray(raw) ? raw : []).map((r: any) => {
          const rawFi = r.fi || r.feature_importance
          const rawCm = r.cm || r.confusion_matrix
          const rawCd = r.cd || r.confidence_distribution
          return {
            name: r.name || r.model_name || t('common.unknown', lang),
            version: r.version || r.model_version || '—',
            accuracy: parseFloat(r.accuracy) || 0,
            precision: parseFloat(r.precision ?? r.precision_score) || 0,
            recall: parseFloat(r.recall) || 0,
            f1: parseFloat(r.f1 ?? r.f1_score) || 0,
            lastTrained: r.lastTrained || r.last_trained || new Date().toISOString(),
            trainingSamples: r.trainingSamples || r.training_samples || 0,
            notes: r.notes || '',
            cm: (rawCm && typeof rawCm === 'object' && Array.isArray(rawCm.matrix)) ? rawCm : { labels: [], matrix: [] },
            fi: Array.isArray(rawFi) ? rawFi : [],
            cd: (Array.isArray(rawCd) && rawCd.length > 0) ? rawCd : dist,
          }
        })
        setModels(transformed)
      }

      if (statusData.status === 'fulfilled' && statusData.value) setAiStatus(statusData.value)
      else setAiStatus(null)
      if (driftRes.status === 'fulfilled') setDriftData(Array.isArray(driftRes.value) ? driftRes.value : driftRes.value?.drift ? [driftRes.value] : [])
      else setDriftData([])
      if (auditRes.status === 'fulfilled') setAuditEntries(Array.isArray(auditRes.value) ? auditRes.value : (auditRes.value as any)?.entries || [])
      else setAuditEntries([])
      if (statsRes.status === 'fulfilled' && statsRes.value) setPredStats(statsRes.value)
      else setPredStats(null)
      if (llmRes.status === 'fulfilled' && llmRes.value) setLlmStatus(llmRes.value)
      else setLlmStatus(null)

      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load AI model metrics')
      setPartialFailures([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Auto-refresh all data every 30 seconds (replaces duplicate Socket.IO connection)
  useEffect(() => {
    const iv = setInterval(() => { loadData() }, 30000)
    return () => clearInterval(iv)
  }, [loadData])

  // Governance decisions fetch + auto-refresh every 30s
  const loadGovernance = useCallback(async () => {
    setGovernanceLoading(true)
    try {
      const res = await apiGetAIAuditLog(10, 0)
      const entries = Array.isArray(res) ? res : (res as any)?.entries || []
      setGovernanceDecisions(entries)
    } catch { setGovernanceDecisions([]) }
    finally { setGovernanceLoading(false) }
  }, [])

  useEffect(() => { loadGovernance() }, [loadGovernance])
  useEffect(() => {
    const iv = setInterval(loadGovernance, 30000)
    return () => clearInterval(iv)
  }, [loadGovernance])

  const handleRetrain = async (modelName: string) => {
    setRetraining(modelName)
    setRetrainStatus(prev => ({ ...prev, [modelName]: 'running' }))
    setRetrainMsg(prev => ({ ...prev, [modelName]: t('ai.submittingRetrain', lang) }))
    try {
      // Strip model type suffix to get the bare hazard type used by the AI engine
      // e.g. "flood_predictor" → "flood", "earthquake_classifier" → "earthquake"
      const hazardType = modelName.replace(/_predictor|_classifier|_model|_detector/gi, '').trim() || modelName
      await apiRetrainModel(hazardType)
      setRetrainStatus(prev => ({ ...prev, [modelName]: 'done' }))
      setRetrainMsg(prev => ({ ...prev, [modelName]: t('ai.retrainQueued', lang) }))
      await loadData()
    } catch (err: any) {
      setRetrainStatus(prev => ({ ...prev, [modelName]: 'error' }))
      setRetrainMsg(prev => ({ ...prev, [modelName]: err?.message || t('ai.retrainFailed', lang) }))
    } finally {
      setRetraining(null)
      setTimeout(() => {
        setRetrainStatus(prev => ({ ...prev, [modelName]: 'idle' }))
        setRetrainMsg(prev => { const n = { ...prev }; delete n[modelName]; return n })
      }, 4000)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 animate-pulse">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-purple-500/30">
        <Brain className="w-8 h-8 text-white animate-pulse" />
      </div>
      <p className="font-semibold text-gray-700 dark:text-gray-300">{t('common.loading', lang)} {t('ai.title', lang)}</p>
      <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{t('ai.transparencySubtitle', lang)}</p>
      <Loader2 className="w-5 h-5 animate-spin text-purple-600 mt-3" />
    </div>
  )

  if (error && models.length === 0) return (
    <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
      <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
      <p className="text-red-700 dark:text-red-300 font-bold text-lg mb-1">{t('common.error', lang)}</p>
      <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
      <button onClick={loadData} className="px-6 py-2 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-all"><RefreshCw className="w-4 h-4 inline mr-2" /> {t('common.retry', lang)}</button>
    </div>
  )

  const m = models[sel] || models[0]
  const TABS: { id: SubTab; label: string; icon: any }[] = [
    { id: 'overview', label: t('ai.overview', lang), icon: Gauge },
    { id: 'models', label: t('ai.models', lang), icon: Brain },
    { id: 'drift', label: t('ai.driftHealth', lang), icon: Activity },
    { id: 'audit', label: t('ai.auditTrail', lang), icon: FileSearch },
    { id: 'llm', label: t('ai.llmProviders', lang), icon: Sparkles },
  ]

  const avgAccuracy = models.length > 0 ? models.reduce((a, b) => a + b.accuracy, 0) / models.length : 0
  const avgF1 = models.length > 0 ? models.reduce((a, b) => a + b.f1, 0) / models.length : 0
  const totalSamples = models.reduce((a, b) => a + b.trainingSamples, 0)
  const driftAlerts = driftData.filter((d: any) => d.driftDetected || d.drift_detected).length

  return (
    <div className="space-y-5 animate-fade-in">
      {partialFailures.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{t('common.warning', lang)} — {t('ai.someDataUnavailable', lang)}</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              Unavailable: <span className="font-semibold">{partialFailures.join(', ')}</span>. The AI engine may be offline or models may not yet be trained.
            </p>
          </div>
        </div>
      )}

      {/*  HEADER  */}
      <div className="bg-gradient-to-r from-aegis-800 to-aegis-900 dark:from-indigo-900 dark:via-purple-900 dark:to-violet-900 rounded-2xl p-6 shadow-xl shadow-purple-900/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-xl tracking-tight">{t('ai.title', lang)}</h2>
                <p className="text-purple-200 text-sm mt-0.5">{t('ai.transparencySubtitle', lang)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
                <div className={`w-2.5 h-2.5 rounded-full ${aiStatus ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                <span className="text-white text-sm font-medium">{aiStatus ? t('common.online', lang) : t('cdash.messages.connecting', lang)}</span>
              </div>
              <button onClick={() => setCompareOpen(prev => !prev)} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10">
                <GitCompare className="w-4 h-4" /> {t('ai.modelComparison', lang)}
              </button>
              <button
                onClick={() => exportData({ models, driftData, auditEntries: auditEntries.slice(0, 100), predStats, llmStatus }, 'csv', `aegis-ai-dashboard-${new Date().toISOString().slice(0,10)}`)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
              >
                <Download className="w-4 h-4" /> {t('common.csv', lang)}
              </button>
              <button
                onClick={() => exportData({ models, driftData, auditEntries: auditEntries.slice(0, 100), predStats, llmStatus }, 'json', `aegis-ai-dashboard-${new Date().toISOString().slice(0,10)}`)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
              >
                <Download className="w-4 h-4" /> {t('common.json', lang)}
              </button>
              <button onClick={loadData} disabled={refreshing} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
              </button>
            </div>
          </div>

          {/* Quick Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
            {[
              { label: t('ai.activeModels', lang), value: String(models.length), icon: Layers, color: 'text-cyan-300' },
              { label: t('ai.avgAccuracy', lang), value: models.length > 0 ? pct(avgAccuracy) : '—', icon: Target, color: models.length === 0 ? 'text-gray-400' : avgAccuracy >= 0.8 ? 'text-emerald-300' : 'text-amber-300' },
              { label: t('ai.avgF1Score', lang), value: models.length > 0 ? pct(avgF1) : '—', icon: BarChart3, color: models.length === 0 ? 'text-gray-400' : avgF1 >= 0.8 ? 'text-emerald-300' : 'text-amber-300' },
              { label: t('ai.trainingSamples', lang), value: models.length > 0 ? totalSamples.toLocaleString() : '—', icon: Database, color: models.length === 0 ? 'text-gray-400' : 'text-blue-300' },
              { label: t('ai.driftAlerts', lang), value: String(driftAlerts), icon: driftAlerts > 0 ? ShieldAlert : ShieldCheck, color: driftAlerts > 0 ? 'text-red-300' : 'text-emerald-300' },
            ].map((s, i) => (
              <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-purple-300 uppercase tracking-wider font-semibold">{s.label}</span>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* AEGIS AI Health Score */}
          {models.length > 0 && (() => {
            const staleCount = models.filter(m => daysSince(m.lastTrained) > 30).length
            const freshnessFactor = Math.max(0, 1 - staleCount / models.length)
            const driftFactor = Math.max(0, 1 - driftAlerts / Math.max(models.length, 1))
            const score = Math.round((Math.min(avgAccuracy, 1) * 40) + (driftFactor * 30) + (freshnessFactor * 30))
            const scoreLabel = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 55 ? 'Fair' : 'Needs Attention'
            const scoreColor = score >= 85 ? 'text-emerald-300' : score >= 70 ? 'text-cyan-300' : score >= 55 ? 'text-amber-300' : 'text-red-300'
            const barGradient = score >= 85 ? 'from-emerald-400 to-cyan-400' : score >= 70 ? 'from-cyan-400 to-blue-400' : score >= 55 ? 'from-amber-400 to-yellow-400' : 'from-red-400 to-rose-400'
            return (
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs text-purple-200 whitespace-nowrap">AEGIS AI Health</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-1000`} style={{ width: `${score}%` }} />
                </div>
                <span className={`text-sm font-bold whitespace-nowrap ${scoreColor}`}>{score}/100</span>
                <span className={`text-xs whitespace-nowrap ${scoreColor} opacity-80`}>{scoreLabel}</span>
              </div>
            )
          })()}
        </div>
      </div>

      {/*  MODEL COMPARISON TABLE  */}
      {compareOpen && models.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden animate-fade-in">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2"><GitCompare className="w-4 h-4 text-purple-600" /> {t('ai.modelComparison', lang)}</h3>
            <button onClick={() => setCompareOpen(false)} className="text-xs text-gray-500 dark:text-gray-300 hover:text-gray-700 px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 transition-colors">{t('common.close', lang)}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.model', lang)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.version', lang)}</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-300">{t('ai.accuracy', lang)}</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-300">{t('ai.precision', lang)}</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-300">{t('ai.recall', lang)}</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-300">{t('ai.f1Score', lang)}</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300">{t('ai.samples', lang)}</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300">{t('ai.trained', lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[...models].sort((a, b) => b.accuracy - a.accuracy).map((model, i) => {
                  const best = i === 0
                  return (
                    <tr key={model.name} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${best ? 'bg-emerald-50/50 dark:bg-emerald-950/10' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        {best && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded font-bold">{t('ai.best', lang)}</span>}
                        {humanizeName(fixEncoding(model.name))}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-300">{model.version}</td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.accuracy)}`}>{pct(model.accuracy)}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.precision)}`}>{pct(model.precision)}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.recall)}`}>{pct(model.recall)}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.f1)}`}>{pct(model.f1)}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{model.trainingSamples.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-300">{fmt(model.lastTrained)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*  SUB-TAB BAR  */}
      <div ref={dashboardRef} className="flex gap-1 bg-gray-100 dark:bg-gray-800/50 rounded-xl p-1 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => { setSubTab(tab.id); setTimeout(() => dashboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              subTab === tab.id
                ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-800'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/*  OVERVIEW TAB  */}
      {subTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {models.map((model, i) => {
              const isExpanded = expandedModel === model.name
              return (
                <div key={i} className={`bg-white dark:bg-gray-900 rounded-2xl border-2 transition-all duration-300 overflow-hidden ${
                  i === sel ? 'border-purple-300 dark:border-purple-700 shadow-lg shadow-purple-500/10' : 'border-gray-200 dark:border-gray-800 hover:border-purple-200 dark:hover:border-purple-800'
                }`}>
                  <div className="p-5 cursor-pointer" onClick={() => { setSel(i); setExpandedModel(isExpanded ? null : model.name) }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          model.accuracy >= 0.85 ? 'bg-emerald-100 dark:bg-emerald-900/30' : model.accuracy >= 0.7 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-red-100 dark:bg-red-900/30'
                        }`}>
                          <Brain className={`w-5 h-5 ${model.accuracy >= 0.85 ? 'text-emerald-600' : model.accuracy >= 0.7 ? 'text-amber-600' : 'text-red-600'}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-gray-900 dark:text-white">{humanizeName(fixEncoding(model.name))}</h3>
                            {/* Drift status circle */}
                            {(() => { const dc = driftCircle(model.name, driftData, lang); return (
                              <span title={dc.label} className={`w-2.5 h-2.5 rounded-full ${dc.color} inline-block flex-shrink-0`} />
                            ) })()}
                            {/* Staleness badge */}
                            {(() => { const sl = stalenessLabel(daysSince(model.lastTrained), lang); return sl ? (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${sl.color}`}>{sl.text}</span>
                            ) : null })()}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-mono">{model.version}</span>
                            <span className="text-[10px] text-gray-500 dark:text-gray-300 flex items-center gap-1"><Database className="w-3 h-3" />{model.trainingSamples.toLocaleString()} {t('ai.samples', lang)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end gap-0.5">
                          <button onClick={(e) => { e.stopPropagation(); handleRetrain(model.name) }} disabled={retraining === model.name}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300 hover:text-purple-600 transition-colors" title={t('ai.retrain', lang)}>
                            <RotateCcw className={`w-4 h-4 ${retraining === model.name ? 'animate-spin text-purple-600' : ''}`} />
                          </button>
                          {retrainMsg[model.name] && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${retrainStatus[model.name] === 'done' ? 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300' : retrainStatus[model.name] === 'error' ? 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300' : 'text-purple-700 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300'}`}>
                              {retrainMsg[model.name]}
                            </span>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-300" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-300" />}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: t('ai.accuracy', lang), value: model.accuracy, showTrend: true },
                        { label: t('ai.precision', lang), value: model.precision, showTrend: false },
                        { label: t('ai.recall', lang), value: model.recall, showTrend: false },
                        { label: t('ai.f1Score', lang), value: model.f1, showTrend: true },
                      ].map((metric, j) => (
                        <div key={j} className="text-center">
                          <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase tracking-wide font-semibold mb-1">{metric.label}</p>
                          <div className="flex items-center justify-center gap-1">
                            <p className={`text-lg font-bold ${metricColor(metric.value)}`}>{pct(metric.value)}</p>
                            {metric.showTrend && (() => {
                              const arrow = trendArrow(metric.value, i, models)
                              const Icon = arrow === '\u2191' ? TrendingUp : arrow === '\u2193' ? TrendingDown : Minus
                              const color = arrow === '\u2191' ? 'text-emerald-500' : arrow === '\u2193' ? 'text-red-500' : 'text-gray-400'
                              return <Icon className={`w-3.5 h-3.5 ${color}`} />
                            })()}
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
                            <div className={`h-1.5 rounded-full bg-gradient-to-r ${barColor(metric.value)} transition-all duration-700`} style={{ width: `${metric.value * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Mini prediction count bar (relative to max across models) */}
                    {(() => {
                      const maxSamples = Math.max(...models.map(mm => mm.trainingSamples), 1)
                      const pctWidth = (model.trainingSamples / maxSamples) * 100
                      return (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[9px] text-gray-400 dark:text-gray-400 mb-0.5">
                            <span>{t('ai.trainingVolume', lang)}</span>
                            <span>{Math.round(pctWidth)}%</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                            <div className="h-1 rounded-full bg-gradient-to-r from-indigo-400 to-purple-500 transition-all duration-700" style={{ width: `${pctWidth}%` }} />
                          </div>
                        </div>
                      )
                    })()}

                    <div className="flex items-center justify-between mt-3 text-[11px] text-gray-500 dark:text-gray-300">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmt(model.lastTrained)}</span>
                      {model.notes && <span className="italic truncate max-w-[50%]">{fixEncoding(model.notes)}</span>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-800 p-5 space-y-5 animate-fade-in">
                      {model.cd.length > 0 && (
                        <div>
                          <h4 className="font-bold text-sm flex items-center gap-2 mb-3 text-gray-900 dark:text-white">
                            <PieChart className="w-4 h-4 text-purple-600" /> {t('ai.confidenceDistribution', lang)}
                          </h4>
                          <div className="flex items-end gap-1 h-32 px-2">
                            {model.cd.map((r, ri) => {
                              const mxC = Math.max(...model.cd.map(x => x.c), 1)
                              const h = (r.c / mxC) * 100
                              const isLow = r.l?.includes('<50') || r.l?.includes('50-59') || r.l?.includes('0-')
                              return (
                                <div key={ri} className="flex-1 flex flex-col items-center group">
                                  <span className="text-[9px] text-gray-500 dark:text-gray-300 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">{r.c}</span>
                                  <div className={`w-full rounded-t-lg transition-all duration-500 ${isLow ? 'bg-gradient-to-t from-red-500 to-red-400' : 'bg-gradient-to-t from-purple-600 to-indigo-500'}`}
                                    style={{ height: `${h}%`, minHeight: '4px' }} />
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex gap-1 mt-1 px-2">
                            {model.cd.map((r, ri) => <div key={ri} className="flex-1 text-center text-[8px] text-gray-400 dark:text-gray-300 truncate">{r.l}</div>)}
                          </div>
                          <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 dark:text-amber-200">{t('ai.humanInTheLoop', lang)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {models.length === 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
              <Brain className="w-12 h-12 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-300 font-semibold">{t('ai.noActiveModels', lang)}</p>
              <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">{t('ai.modelsAppear', lang)}</p>
            </div>
          )}

          {/* System Status — always visible regardless of model count */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Gauge className="w-4 h-4 text-indigo-600" /> System Status
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: 'AI Engine',
                  value: aiStatus ? (aiStatus.status || 'Online') : 'Offline',
                  sub: aiStatus?.uptime ? `Up: ${aiStatus.uptime}` : 'Not connected',
                  color: aiStatus ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
                  dot: aiStatus ? 'bg-emerald-500' : 'bg-red-500',
                  icon: Zap,
                },
                {
                  label: 'LLM Providers',
                  value: llmStatus?.providers ? `${llmStatus.providers.length} online` : (llmStatus?.preferred ? '1 active' : 'None'),
                  sub: llmStatus?.preferred ? `Active: ${llmStatus.preferred}` : 'No active provider',
                  color: llmStatus ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500',
                  dot: llmStatus ? 'bg-purple-500' : 'bg-gray-400',
                  icon: Sparkles,
                },
                {
                  label: 'Models Registered',
                  value: models.length > 0 ? String(models.length) : 'None yet',
                  sub: models.length > 0 ? `Avg accuracy: ${pct(models.reduce((a, b) => a + b.accuracy, 0) / models.length)}` : 'Train models to populate',
                  color: models.length > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500',
                  dot: models.length > 0 ? 'bg-blue-500' : 'bg-gray-400',
                  icon: Brain,
                },
                {
                  label: 'Hazard Coverage',
                  value: '5 types',
                  sub: 'Flood · Fire · Storm · Quake · Slide',
                  color: 'text-cyan-600 dark:text-cyan-400',
                  dot: 'bg-cyan-500',
                  icon: ShieldCheck,
                },
              ].map((s, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-300 font-semibold">{s.label}</span>
                    <s.icon className={`w-3.5 h-3.5 ml-auto ${s.color}`} />
                  </div>
                  <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5 truncate">{s.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {predStats && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-4">
                <LineChart className="w-4 h-4 text-purple-600" /> {t('ai.predictionPerformance', lang)}
                <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {t('common.live', lang)}
                </span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: t('ai.totalPredictions', lang), value: predStats.total_predictions ?? predStats.total ?? '0', icon: Zap },
                  { label: t('ai.correct', lang), value: predStats.correct ?? predStats.correct_predictions ?? '0', icon: CheckCircle },
                  { label: t('ai.avgConfidence', lang), value: `${Math.round(predStats.avg_confidence ?? predStats.average_confidence ?? 0)}%`, icon: Gauge },
                  { label: t('ai.processingTime', lang), value: `${Math.round(predStats.avg_processing_time ?? predStats.average_processing_time_ms ?? 0)}ms`, icon: Clock },
                ].map((s, si) => (
                  <div key={si} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon className="w-4 h-4 text-purple-600" />
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-300 font-semibold">{s.label}</span>
                    </div>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Quality Indicators */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Database className="w-4 h-4 text-purple-600" /> {t('ai.dataQualityIndicators', lang)}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Training Data Recency */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-300 font-semibold">{t('ai.trainingRecency', lang)}</span>
                </div>
                {models.length > 0 ? (
                  <div className="space-y-1.5">
                    {models.map((model, mi) => {
                      const days = daysSince(model.lastTrained)
                      const sl = stalenessLabel(days, lang)
                      return (
                        <div key={mi} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 dark:text-gray-300 truncate max-w-[60%]">{humanizeName(model.name)}</span>
                          <span className={sl ? sl.color + ' px-1.5 py-0.5 rounded text-[10px] font-semibold' : 'text-emerald-600 dark:text-emerald-400 font-semibold'}>
                            {days === 0 ? t('ai.today', lang) : days === 1 ? t('ai.oneDayAgo', lang) : `${days}${t('ai.daysAgoShort', lang)}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : <p className="text-xs text-gray-400">{t('ai.noModelData', lang)}</p>}
              </div>

              {/* Average Confidence Trend */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-indigo-600" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-300 font-semibold">{t('ai.modelPerformance', lang)}</span>
                </div>
                {models.length > 0 ? (() => {
                  const avgConf = models.reduce((a, m) => a + (isNaN(m.accuracy) ? 0 : m.accuracy), 0) / models.length
                  const avgF1Val = models.reduce((a, m) => a + (isNaN(m.f1) ? 0 : m.f1), 0) / models.length
                  return (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-gray-300">{t('ai.accuracy', lang)}</span>
                          <span className={`font-bold ${metricColor(avgConf)}`}>{pct(avgConf)}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div className={`h-2 rounded-full bg-gradient-to-r ${barColor(avgConf)} transition-all duration-700`} style={{ width: `${isNaN(avgConf) ? 0 : avgConf * 100}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-gray-300">{t('ai.f1Score', lang)}</span>
                          <span className={`font-bold ${metricColor(avgF1Val)}`}>{pct(avgF1Val)}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div className={`h-2 rounded-full bg-gradient-to-r ${barColor(avgF1Val)} transition-all duration-700`} style={{ width: `${isNaN(avgF1Val) ? 0 : avgF1Val * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })() : <p className="text-xs text-gray-400">{t('ai.noModelData', lang)}</p>}
              </div>

              {/* Data Health Score */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-purple-600" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-300 font-semibold">{t('ai.dataHealth', lang)}</span>
                </div>
                {(() => {
                  const health = dataHealthScore(models, lang)
                  const driftCount = driftData.filter((d: any) => d.driftDetected || d.drift_detected).length
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className={`text-2xl font-black px-4 py-2 rounded-xl ${health.color}`}>{health.label}</span>
                      </div>
                      <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
                        <div className="flex items-center justify-between">
                          <span>{t('ai.modelsTracked', lang)}</span>
                          <span className="font-semibold">{models.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{t('ai.driftAlerts', lang)}</span>
                          <span className={`font-semibold ${driftCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{driftCount}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{t('ai.staleModels', lang)}</span>
                          <span className={`font-semibold ${models.filter(m => daysSince(m.lastTrained) > 30).length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {models.filter(m => daysSince(m.lastTrained) > 30).length}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* Governance Decision Stream */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-600" /> {t('ai.recentGovernance', lang)}
                <span className="text-[9px] px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-full font-mono">{t('ai.autoRefresh', lang)}</span>
              </h3>
              <button onClick={loadGovernance} disabled={governanceLoading} className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 transition-colors font-semibold flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${governanceLoading ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
              </button>
            </div>
            {governanceDecisions.length === 0 ? (
              <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <Shield className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">{governanceLoading ? t('ai.loadingGovernance', lang) : t('ai.noGovernance', lang)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {governanceDecisions.map((entry: any, gi: number) => (
                  <div key={entry.id || gi} className={`rounded-xl p-3 border transition-all ${governanceEntryColor(entry)}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {(() => {
                          const action = (entry.action || entry.inputSummary || entry.input_summary || '').toLowerCase()
                          const status = (entry.status || '').toLowerCase()
                          if (action.includes('flag') || status === 'error') return <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                          if (action.includes('human') || action.includes('review')) return <Eye className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          return <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        })()}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                            {humanizeName(entry.modelName || entry.model_name || '') || t('common.system', lang)}
                          </p>
                          <p className="text-[10px] text-gray-600 dark:text-gray-400 truncate">
                            {humanizeName(entry.action || entry.inputSummary || entry.input_summary || '') || t('ai.decision', lang)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(entry.confidence || entry.avg_confidence) && (
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-white/60 dark:bg-gray-800/60 rounded text-gray-600 dark:text-gray-300">
                            {Math.round((entry.confidence || entry.avg_confidence || 0) * 100)}%
                          </span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          (entry.status || '').toLowerCase() === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : (entry.status || '').toLowerCase() === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>{humanizeName(entry.status || 'processed')}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-400 whitespace-nowrap">{fmt(entry.createdAt || entry.created_at || '')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/*  MODELS TAB  */}
      {subTab === 'models' && (
        <div className="space-y-5">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {models.map((model, i) => (
              <button key={i} onClick={() => setSel(i)}
                className={`px-5 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                  i === sel
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30'
                    : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-purple-300'
                }`}>
                <Brain className="w-4 h-4 inline mr-2" />{humanizeName(model.name)} <span className="text-xs opacity-75 ml-1">{model.version}</span>
              </button>
            ))}
          </div>

          {models.length === 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
              <Brain className="w-12 h-12 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-300 font-semibold">{t('ai.noActiveModels', lang)}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('ai.modelsAppear', lang)}</p>
              <button onClick={loadData} className="mt-4 px-5 py-2 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-all flex items-center gap-2 mx-auto"><RefreshCw className="w-4 h-4" /> {t('common.retry', lang)}</button>
            </div>
          )}

          {m && (<div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2"><Target className="w-5 h-5 text-purple-600" /> {humanizeName(m.name)} — {t('ai.detailedMetrics', lang)}</h3>
              <span className="text-xs font-mono bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full">{m.version}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: t('ai.accuracy', lang), value: m.accuracy, icon: Target },
                { label: t('ai.precision', lang), value: m.precision, icon: Zap },
                { label: t('ai.recall', lang), value: m.recall, icon: Eye },
                { label: t('ai.f1Score', lang), value: m.f1, icon: BarChart3 },
              ].map((metric, mi) => (
                <div key={mi} className={`rounded-xl p-5 border-2 transition-all ${
                  metric.value >= 0.85 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                    : metric.value >= 0.7 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                    : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <metric.icon className={`w-5 h-5 ${metricColor(metric.value)}`} />
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">{metric.label}</span>
                  </div>
                  <p className={`text-3xl font-bold ${metricColor(metric.value)}`}>{pct(metric.value)}</p>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                    <div className={`h-2 rounded-full bg-gradient-to-r ${barColor(metric.value)} transition-all duration-700`} style={{ width: `${metric.value * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800 pt-4">
              <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {t('ai.trained', lang)}: {fmt(m.lastTrained)}</span>
              <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> {m.trainingSamples.toLocaleString()} {t('ai.trainingSamples', lang).toLowerCase()}</span>
              <span className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> {t('ai.version', lang)}: {m.version}</span>
              {m.notes && <span className="flex items-center gap-1.5 italic"><Hash className="w-3.5 h-3.5" /> {fixEncoding(m.notes)}</span>}
            </div>
          </div>)}

          {m && m.cm.matrix.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-purple-600" /> {t('ai.confusionMatrix', lang)} — {humanizeName(m.name)}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="p-2 text-left text-gray-500 dark:text-gray-300 font-semibold">{t('ai.actualPredicted', lang)}</th>
                      {m.cm.labels.map(l => <th key={l} className="p-2 text-center font-semibold">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {m.cm.matrix.map((row, ri) => {
                      const mx = Math.max(...m.cm.matrix.flat(), 1)
                      return (
                        <tr key={ri} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="p-2 font-semibold">{m.cm.labels[ri]}</td>
                          {(Array.isArray(row) ? row : []).map((val, ci) => (
                            <td key={ci} className="p-1">
                              <div className="rounded-lg px-3 py-2.5 text-center font-mono font-bold"
                                style={ri === ci
                                  ? { backgroundColor: `rgba(22,163,74,${0.2 + (val/mx) * 0.8})`, color: val/mx > 0.4 ? 'white' : '#166534' }
                                  : val > 10 ? { backgroundColor: 'rgba(239,68,68,0.12)', color: '#b91c1c' } : {}
                                }>{val}</div>
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {m && m.fi.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-4"><Activity className="w-4 h-4 text-purple-600" /> {t('ai.xaiFeatureImportance', lang)}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {m.fi.map((f, fi) => (
                  <div key={fi}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{humanizeName(fixEncoding(f.n))}</span>
                      <span className="font-bold text-gray-600 dark:text-gray-300">{(f.v * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-3.5 overflow-hidden">
                      <div className="bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-500 h-3.5 rounded-full transition-all duration-700 relative"
                        style={{ width: `${f.v * 100}%` }}>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20 rounded-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/*  DRIFT & HEALTH TAB  */}
      {subTab === 'drift' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-purple-600" /> {t('ai.modelDriftDetection', lang)}</h3>
              <button onClick={loadData} className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 transition-colors font-semibold">
                <RefreshCw className="w-3 h-3 inline mr-1" /> {t('ai.checkNow', lang)}
              </button>
            </div>

            {driftData.length > 0 ? (
              <div className="space-y-3">
                {driftData.map((d: any, i: number) => {
                  const hasDrift = d.driftDetected || d.drift_detected
                  const magnitude = d.driftMagnitude || d.drift_magnitude || 0
                  return (
                    <div key={i} className={`rounded-xl p-4 border-2 transition-all ${
                      hasDrift ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20' : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {hasDrift ? <ShieldAlert className="w-5 h-5 text-red-600" /> : <ShieldCheck className="w-5 h-5 text-green-600" />}
                          <div>
                            <p className="font-semibold text-sm">{humanizeName(d.modelName || d.model_name || '') || t('ai.model', lang)}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-300">{d.metricName || d.metric_name || t('ai.accuracy', lang)} - v{d.modelVersion || d.model_version || '?'}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold ${hasDrift ? 'text-red-600' : 'text-green-600'}`}>
                            {hasDrift ? t('ai.driftDetected', lang) : t('ai.stable', lang)}
                          </span>
                          {magnitude > 0 && <p className="text-xs text-gray-500 dark:text-gray-300">{(magnitude * 100).toFixed(1)}%</p>}
                        </div>
                      </div>
                      {(d.baselineValue || d.baseline_value) && (
                        <div className="flex gap-4 mt-3 text-xs">
                          <span className="text-gray-500 dark:text-gray-300">{t('ai.baseline', lang)}: <strong>{pct(d.baselineValue || d.baseline_value || 0)}</strong></span>
                          <span className="text-gray-500 dark:text-gray-300">{t('ai.current', lang)}: <strong className={hasDrift ? 'text-red-600' : ''}>{pct(d.currentValue || d.current_value || 0)}</strong></span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-6 text-center">
                <ShieldCheck className="w-10 h-10 text-green-500 mx-auto mb-2" />
                <p className="font-semibold text-green-700 dark:text-green-300">{t('ai.allModelsStable', lang)}</p>
              </div>
            )}
          </div>

          {aiStatus && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2 mb-4"><Server className="w-5 h-5 text-purple-600" /> {t('ai.engineStatusTitle', lang)}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: t('ai.engine', lang), value: aiStatus.status || aiStatus.engine_status || t('common.unknown', lang), color: (aiStatus.status || '').toLowerCase() === 'healthy' ? 'text-green-600' : 'text-amber-600' },
                  { label: t('ai.modelsLoaded', lang), value: String(aiStatus.models_loaded ?? aiStatus.modelsLoaded ?? t('common.na', lang)) },
                  { label: t('ai.uptime', lang), value: aiStatus.uptime || t('common.na', lang) },
                  { label: t('ai.gpu', lang), value: aiStatus.gpu_available ? t('common.available', lang) : t('ai.cpuMode', lang) },
                ].map((s, si) => (
                  <div key={si} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-300 font-semibold">{s.label}</span>
                    <p className={`text-lg font-bold mt-1 ${s.color || 'text-gray-900 dark:text-white'}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2 mb-4"><FlaskConical className="w-5 h-5 text-purple-600" /> {t('ai.trainingStatus', lang)}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {models.length === 0 && (
                <div className="col-span-full text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                  <Brain className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">{t('ai.noActiveModels', lang)}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">Train models through the AI engine to see their training status and enable retraining here.</p>
                  <button onClick={loadData} className="mt-3 px-4 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg text-xs font-semibold hover:bg-purple-200 transition-colors flex items-center gap-1.5 mx-auto"><RefreshCw className="w-3 h-3" /> {t('common.retry', lang)}</button>
                </div>
              )}
              {models.map((model, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-purple-600" />
                    <span className="font-semibold text-sm">{humanizeName(model.name)}</span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex justify-between"><span>{t('ai.version', lang)}</span><span className="font-mono font-semibold">{model.version}</span></div>
                    <div className="flex justify-between"><span>{t('ai.samples', lang)}</span><span className="font-semibold">{model.trainingSamples.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>{t('ai.lastTrained', lang)}</span><span className="font-semibold">{fmt(model.lastTrained)}</span></div>
                    <div className="flex justify-between"><span>{t('ai.accuracy', lang)}</span><span className={`font-semibold ${metricColor(model.accuracy)}`}>{pct(model.accuracy)}</span></div>
                  </div>
                  <button onClick={() => handleRetrain(model.name)} disabled={retraining === model.name}
                    className="w-full mt-3 py-2 text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 transition-colors flex items-center justify-center gap-1">
                    <RotateCcw className={`w-3 h-3 ${retraining === model.name ? 'animate-spin' : ''}`} />
                    {retraining === model.name ? t('ai.submitting', lang) : retrainStatus[model.name] === 'done' ? t('ai.queued', lang) : retrainStatus[model.name] === 'error' ? t('ai.failedRetry', lang) : t('ai.retrain', lang)}
                  </button>
                  {retrainMsg[model.name] && retrainStatus[model.name] !== 'running' && (
                    <p className={`text-[10px] mt-1 text-center font-medium ${retrainStatus[model.name] === 'done' ? 'text-green-600' : 'text-red-600'}`}>
                      {retrainMsg[model.name]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/*  AUDIT TRAIL TAB  */}
      {subTab === 'audit' && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2"><FileSearch className="w-5 h-5 text-purple-600" /> {t('ai.executionAuditTrail', lang)}</h3>
            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-3 py-1 rounded-full font-mono">{auditEntries.length} {t('common.entries', lang)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.model', lang)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('audit.action', lang)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('audit.target', lang)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('common.status', lang)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.timeMs', lang)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('audit.timestamp', lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {auditEntries.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center">
                    <FileSearch className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2 opacity-70" />
                    <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                      {partialFailures.includes('Audit trail') ? 'Audit trail service unavailable' : 'No audit entries yet'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">
                      {partialFailures.includes('Audit trail')
                        ? 'The AI audit log service is offline. Check that the AI engine is running.'
                        : 'Entries appear here after AI predictions, governance decisions, and model actions are made.'}
                    </p>
                  </td></tr>
                ) : auditEntries.map((entry: any, i: number) => (
                  <tr key={entry.id || i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">{humanizeName(entry.modelName || entry.model_name || '') || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 truncate max-w-[200px]">{humanizeName(fixEncoding(entry.inputSummary || entry.input_summary || entry.action || '')) || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-600 dark:text-gray-300 text-[10px]">
                        {entry.targetType || entry.target_type || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        (entry.status || '').toLowerCase() === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : (entry.status || '').toLowerCase() === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}>{entry.status || '—'}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300">{entry.executionTimeMs || entry.execution_time_ms || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-300">{fmt(entry.createdAt || entry.created_at || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*  LLM PROVIDERS TAB  */}
      {subTab === 'llm' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-purple-600" /> {t('ai.llmProviderStatus', lang)}</h3>
              <button onClick={loadData} className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg">
                <RefreshCw className="w-3 h-3 inline mr-1" /> {t('common.refresh', lang)}
              </button>
            </div>

            {llmStatus?.providers && Array.isArray(llmStatus.providers) && llmStatus.providers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {llmStatus.providers.map((p: any, i: number) => {
                  const isActive = !p.rateLimited && !p.backedOff && !p.rate_limited && !p.backed_off
                  const isPreferred = llmStatus.preferred === p.name
                  return (
                    <div key={i} className={`rounded-xl p-4 border-2 transition-all ${
                      isPreferred ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/20'
                        : isActive ? 'border-green-200 dark:border-green-800 bg-white dark:bg-gray-900'
                        : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                          <h4 className="font-bold text-sm">{p.name}</h4>
                          {isPreferred && <span className="text-[10px] px-2 py-0.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-full font-bold">{t('common.active', lang)}</span>}
                        </div>
                        <span className={`text-xs font-semibold ${isActive ? 'text-green-600' : 'text-red-600'}`}>
                          {isActive ? t('common.online', lang) : p.rateLimited || p.rate_limited ? t('ai.rateLimited', lang) : t('ai.backedOff', lang)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <div><span className="text-gray-400 dark:text-gray-300">{t('ai.model', lang)}</span><br /><span className="font-semibold">{p.model || '—'}</span></div>
                        <div><span className="text-gray-400 dark:text-gray-300">{t('ai.requests', lang)}</span><br /><span className="font-semibold">{p.totalRequests ?? p.total_requests ?? '—'}</span></div>
                        <div><span className="text-gray-400 dark:text-gray-300">{t('ai.errors', lang)}</span><br /><span className="font-semibold text-red-600">{p.errors ?? p.error_count ?? 0}</span></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {llmStatus && llmStatus.preferred && (
                  <div className="bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-sm text-indigo-900 dark:text-indigo-100">Active: <span className="font-mono text-purple-700 dark:text-purple-300">{llmStatus.preferred}</span></p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">Provider connected — detailed metrics appear when active chat sessions are running</p>
                    </div>
                  </div>
                )}
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 text-center">
                  <Sparkles className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 dark:text-gray-300 font-semibold">
                    {partialFailures.includes('LLM status') ? t('ai.llmUnavailable', lang) : t('ai.noProviders', lang)}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">Provider telemetry data appears once active AI chat sessions exist</p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-6">
            <h3 className="font-bold text-base flex items-center gap-2 mb-4 text-purple-900 dark:text-purple-100"><Shield className="w-5 h-5" /> {t('ai.governanceFramework', lang)}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(() => {
                const engineUp = aiStatus?.status === 'operational' || aiStatus?.ai_engine_available === true
                const auditActive = !partialFailures.includes('Audit trail')
                return [
                  { title: t('ai.humanInTheLoop', lang), icon: Eye, active: true },
                  { title: t('ai.modelVersionControl', lang), icon: GitBranch, active: engineUp },
                  { title: t('ai.auditLogging', lang), icon: FileSearch, active: auditActive },
                ]
              })().map((g, i) => (
                <div key={i} className="bg-white/80 dark:bg-gray-900/80 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
                  <div className="flex items-center gap-2 mb-2">
                    <g.icon className="w-5 h-5 text-purple-600" />
                    <span className="font-bold text-sm">{g.title}</span>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    g.active
                      ? 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300'
                      : 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300'
                  }`}>
                    <CheckCircle className="w-3 h-3" /> {g.active ? t('common.active', lang) : t('common.offline', lang)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* System Coverage & Scope */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-blue-600" /> System Coverage &amp; Scope
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
                <p className="font-bold text-sm text-blue-900 dark:text-blue-100 mb-1">Primary Region</p>
                <p className="text-base font-semibold text-blue-800 dark:text-blue-200">Scotland &amp; United Kingdom</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">SEPA flood zones · Glasgow · Edinburgh · Stirling · Aberdeen</p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-950/20 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
                <p className="font-bold text-sm text-purple-900 dark:text-purple-100 mb-2">Hazard Types Covered</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Flood', 'Fire', 'Storm', 'Earthquake', 'Landslide'].map(h => (
                    <span key={h} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 font-semibold">{h}</span>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 italic">
              AEGIS AI models are trained on Scottish and UK-wide emergency response data. Coverage regions are configurable per deployment. Primary data source: SEPA (Scottish Environment Protection Agency).
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

