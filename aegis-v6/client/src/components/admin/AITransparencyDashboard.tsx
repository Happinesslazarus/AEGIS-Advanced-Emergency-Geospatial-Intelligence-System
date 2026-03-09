import { useState, useEffect, Component, type ReactNode, type ErrorInfo, useCallback, useRef } from 'react'
import { io as socketIo } from 'socket.io-client'
import {
  Brain, Target, BarChart3, Activity, Calendar, Database, AlertTriangle, CheckCircle,
  Loader2, RefreshCw, Shield, Zap, Eye, GitBranch,
  Clock, Layers, ChevronDown, ChevronUp,
  Server, Gauge, FlaskConical, PieChart, LineChart, Sparkles,
  ShieldCheck, ShieldAlert, Hash, FileSearch, RotateCcw, Download, GitCompare
} from 'lucide-react'
import {
  apiGetGovernanceModels, apiGetConfidenceDistribution, apiGetAIAuditLog,
  apiGetAIStatus, apiGetAIDrift, apiGetAIPredictionStats, apiGetGovernanceDrift,
  apiGetChatStatus, apiRetrainModel
} from '../../utils/api'

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

/* ─── Error Boundary ─── */
class AIErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('AITransparencyDashboard crash:', error, info) }
  render() {
    if (this.state.hasError) return (
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 dark:text-red-300 font-semibold mb-1">Dashboard Error</p>
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{this.state.error}</p>
        <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Retry</button>
      </div>
    )
    return this.props.children
  }
}

/* ─── Helpers ─── */
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
function fmt(d: string): string {
  if (!d) return 'Unknown'
  try { const x = new Date(d); return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) } catch { return d }
}
function pct(v: number): string { return `${(v * 100).toFixed(1)}%` }
function metricColor(v: number): string { return v >= 0.9 ? 'text-emerald-600 dark:text-emerald-400' : v >= 0.8 ? 'text-blue-600 dark:text-blue-400' : v >= 0.7 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400' }
function barColor(v: number): string { return v >= 0.9 ? 'from-emerald-500 to-green-400' : v >= 0.8 ? 'from-blue-500 to-cyan-400' : v >= 0.7 ? 'from-amber-500 to-yellow-400' : 'from-red-500 to-rose-400' }

interface ModelData {
  name: string; version: string; accuracy: number; precision: number; recall: number; f1: number
  lastTrained: string; trainingSamples: number; notes: string
  cm: { labels: string[]; matrix: number[][] }
  fi: Array<{ n: string; v: number }>
  cd: Array<{ l: string; c: number }>
}

type SubTab = 'overview' | 'models' | 'drift' | 'audit' | 'llm'

export default function AITransparencyDashboard(): JSX.Element {
  return <AIErrorBoundary><AITransparencyDashboardInner /></AIErrorBoundary>
}

function AITransparencyDashboardInner(): JSX.Element {
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
  const [livePredsCount, setLivePredsCount] = useState(0)
  const socketRef = useRef<ReturnType<typeof socketIo> | null>(null)

  const loadData = useCallback(async () => {
    setRefreshing(true)
    try {
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
            name: r.name || r.model_name || 'Unknown',
            version: r.version || r.model_version || 'v1.0',
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

  // M18: Real-time AI prediction updates via Socket.IO
  useEffect(() => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token')
    if (!token) return
    const socket = socketIo('http://localhost:3001', {
      auth: { token },
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket
    socket.on('ai:prediction', () => {
      setLivePredsCount(n => n + 1)
      // Refresh prediction stats when a new prediction arrives
      loadData()
    })
    return () => { socket.disconnect(); socketRef.current = null }
  }, [loadData])

  const handleRetrain = async (modelName: string) => {
    setRetraining(modelName)
    setRetrainStatus(prev => ({ ...prev, [modelName]: 'running' }))
    setRetrainMsg(prev => ({ ...prev, [modelName]: 'Submitting retrain job...' }))
    try {
      await apiRetrainModel(modelName)
      setRetrainStatus(prev => ({ ...prev, [modelName]: 'done' }))
      setRetrainMsg(prev => ({ ...prev, [modelName]: 'Retrain job queued successfully' }))
      await loadData()
    } catch (err: any) {
      setRetrainStatus(prev => ({ ...prev, [modelName]: 'error' }))
      setRetrainMsg(prev => ({ ...prev, [modelName]: err?.message || 'Retrain failed' }))
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
      <p className="font-semibold text-gray-700 dark:text-gray-300">Loading AI Intelligence Platform...</p>
      <p className="text-xs text-gray-500 mt-1">Fetching model metrics, drift analysis & audit logs</p>
      <Loader2 className="w-5 h-5 animate-spin text-purple-600 mt-3" />
    </div>
  )

  if (error && models.length === 0) return (
    <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
      <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
      <p className="text-red-700 dark:text-red-300 font-bold text-lg mb-1">Connection Error</p>
      <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
      <button onClick={loadData} className="px-6 py-2 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-all"><RefreshCw className="w-4 h-4 inline mr-2" /> Retry</button>
    </div>
  )

  const m = models[sel] || models[0]
  const TABS: { id: SubTab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: Gauge },
    { id: 'models', label: 'Models', icon: Brain },
    { id: 'drift', label: 'Drift & Health', icon: Activity },
    { id: 'audit', label: 'Audit Trail', icon: FileSearch },
    { id: 'llm', label: 'LLM Providers', icon: Sparkles },
  ]

  const avgAccuracy = models.length > 0 ? models.reduce((a, b) => a + b.accuracy, 0) / models.length : 0
  const avgF1 = models.length > 0 ? models.reduce((a, b) => a + b.f1, 0) / models.length : 0
  const totalSamples = models.reduce((a, b) => a + b.trainingSamples, 0)
  const driftAlerts = driftData.filter((d: any) => d.driftDetected || d.drift_detected).length

  return (
    <div className="space-y-5 animate-fade-in">
      {partialFailures.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Partial data unavailable</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">{partialFailures.join(', ')}. Dashboard remains operational with available sources.</p>
          </div>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="bg-gradient-to-r from-indigo-900 via-purple-900 to-violet-900 rounded-2xl p-6 shadow-xl shadow-purple-900/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-xl tracking-tight">AI Transparency & Model Governance</h2>
                <p className="text-purple-200 text-sm mt-0.5">Real-time model performance, drift detection, explainability & audit</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
                <div className={`w-2.5 h-2.5 rounded-full ${aiStatus ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                <span className="text-white text-sm font-medium">{aiStatus ? 'AI Engine Online' : 'Connecting...'}</span>
              </div>
              <button onClick={() => setCompareOpen(prev => !prev)} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10">
                <GitCompare className="w-4 h-4" /> Compare
              </button>
              <button
                onClick={() => exportData({ models, driftData, auditEntries: auditEntries.slice(0, 100), predStats, llmStatus }, 'csv', `aegis-ai-dashboard-${new Date().toISOString().slice(0,10)}`)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
              >
                <Download className="w-4 h-4" /> CSV
              </button>
              <button
                onClick={() => exportData({ models, driftData, auditEntries: auditEntries.slice(0, 100), predStats, llmStatus }, 'json', `aegis-ai-dashboard-${new Date().toISOString().slice(0,10)}`)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
              >
                <Download className="w-4 h-4" /> JSON
              </button>
              <button onClick={loadData} disabled={refreshing} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {/* Quick Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
            {[
              { label: 'Active Models', value: String(models.length), icon: Layers, color: 'text-cyan-300' },
              { label: 'Avg Accuracy', value: pct(avgAccuracy), icon: Target, color: avgAccuracy >= 0.8 ? 'text-emerald-300' : 'text-amber-300' },
              { label: 'Avg F1 Score', value: pct(avgF1), icon: BarChart3, color: avgF1 >= 0.8 ? 'text-emerald-300' : 'text-amber-300' },
              { label: 'Training Samples', value: totalSamples.toLocaleString(), icon: Database, color: 'text-blue-300' },
              { label: 'Drift Alerts', value: String(driftAlerts), icon: driftAlerts > 0 ? ShieldAlert : ShieldCheck, color: driftAlerts > 0 ? 'text-red-300' : 'text-emerald-300' },
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
        </div>
      </div>

      {/* ═══ MODEL COMPARISON TABLE ═══ */}
      {compareOpen && models.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden animate-fade-in">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2"><GitCompare className="w-4 h-4 text-purple-600" /> Model Comparison</h3>
            <button onClick={() => setCompareOpen(false)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 transition-colors">Close</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Model</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Version</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">Accuracy</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">Precision</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">Recall</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">F1 Score</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">Samples</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">Trained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[...models].sort((a, b) => b.accuracy - a.accuracy).map((model, i) => {
                  const best = i === 0
                  return (
                    <tr key={model.name} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${best ? 'bg-emerald-50/50 dark:bg-emerald-950/10' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        {best && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded font-bold">BEST</span>}
                        {fixEncoding(model.name)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-500">{model.version}</td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.accuracy)}`}>{pct(model.accuracy)}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.precision)}`}>{pct(model.precision)}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.recall)}`}>{pct(model.recall)}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${metricColor(model.f1)}`}>{pct(model.f1)}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{model.trainingSamples.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{fmt(model.lastTrained)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ SUB-TAB BAR ═══ */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800/50 rounded-xl p-1 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              subTab === tab.id
                ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-800'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
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
                          <h3 className="font-bold text-sm text-gray-900 dark:text-white">{fixEncoding(model.name)}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-mono">{model.version}</span>
                            <span className="text-[10px] text-gray-500 flex items-center gap-1"><Database className="w-3 h-3" />{model.trainingSamples.toLocaleString()} samples</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end gap-0.5">
                          <button onClick={(e) => { e.stopPropagation(); handleRetrain(model.name) }} disabled={retraining === model.name}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-purple-600 transition-colors" title="Retrain">
                            <RotateCcw className={`w-4 h-4 ${retraining === model.name ? 'animate-spin text-purple-600' : ''}`} />
                          </button>
                          {retrainMsg[model.name] && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${retrainStatus[model.name] === 'done' ? 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300' : retrainStatus[model.name] === 'error' ? 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300' : 'text-purple-700 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300'}`}>
                              {retrainMsg[model.name]}
                            </span>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Accuracy', value: model.accuracy },
                        { label: 'Precision', value: model.precision },
                        { label: 'Recall', value: model.recall },
                        { label: 'F1 Score', value: model.f1 },
                      ].map((metric, j) => (
                        <div key={j} className="text-center">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">{metric.label}</p>
                          <p className={`text-lg font-bold ${metricColor(metric.value)}`}>{pct(metric.value)}</p>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
                            <div className={`h-1.5 rounded-full bg-gradient-to-r ${barColor(metric.value)} transition-all duration-700`} style={{ width: `${metric.value * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between mt-3 text-[11px] text-gray-500">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmt(model.lastTrained)}</span>
                      {model.notes && <span className="italic truncate max-w-[50%]">{fixEncoding(model.notes)}</span>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-800 p-5 space-y-5 animate-fade-in">
                      <p className="text-xs text-gray-500 italic">Open the <strong>Models</strong> tab for full confusion matrix and feature importance detail.</p>

                      {model.cd.length > 0 && (
                        <div>
                          <h4 className="font-bold text-sm flex items-center gap-2 mb-3 text-gray-900 dark:text-white">
                            <PieChart className="w-4 h-4 text-purple-600" /> Confidence Distribution
                          </h4>
                          <p className="text-xs text-gray-500 mb-2">Cases below 60% require human-in-the-loop manual review.</p>
                          <div className="flex items-end gap-1 h-32 px-2">
                            {model.cd.map((r, ri) => {
                              const mxC = Math.max(...model.cd.map(x => x.c), 1)
                              const h = (r.c / mxC) * 100
                              const isLow = r.l?.includes('<50') || r.l?.includes('50-59') || r.l?.includes('0-')
                              return (
                                <div key={ri} className="flex-1 flex flex-col items-center group">
                                  <span className="text-[9px] text-gray-500 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">{r.c}</span>
                                  <div className={`w-full rounded-t-lg transition-all duration-500 ${isLow ? 'bg-gradient-to-t from-red-500 to-red-400' : 'bg-gradient-to-t from-purple-600 to-indigo-500'}`}
                                    style={{ height: `${h}%`, minHeight: '4px' }} />
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex gap-1 mt-1 px-2">
                            {model.cd.map((r, ri) => <div key={ri} className="flex-1 text-center text-[8px] text-gray-400 truncate">{r.l}</div>)}
                          </div>
                          <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 dark:text-amber-200">Cases below 60% confidence are automatically queued for operator review (human-in-the-loop governance).</p>
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
              <Brain className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-400 font-semibold">No Active Models</p>
              <p className="text-sm text-gray-500 mt-1">Models appear after training data is loaded and the AI engine processes them.</p>
            </div>
          )}

          {predStats && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
              <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
                <LineChart className="w-4 h-4 text-purple-600" /> Prediction Performance (Last 24h)
                {livePredsCount > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    +{livePredsCount} live
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Predictions', value: predStats.total_predictions ?? predStats.total ?? '0', icon: Zap },
                  { label: 'Correct', value: predStats.correct ?? predStats.correct_predictions ?? '0', icon: CheckCircle },
                  { label: 'Avg Confidence', value: `${Math.round(predStats.avg_confidence ?? predStats.average_confidence ?? 0)}%`, icon: Gauge },
                  { label: 'Processing Time', value: `${Math.round(predStats.avg_processing_time ?? predStats.average_processing_time_ms ?? 0)}ms`, icon: Clock },
                ].map((s, si) => (
                  <div key={si} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon className="w-4 h-4 text-purple-600" />
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{s.label}</span>
                    </div>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ MODELS TAB ═══ */}
      {subTab === 'models' && m && (
        <div className="space-y-5">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {models.map((model, i) => (
              <button key={i} onClick={() => setSel(i)}
                className={`px-5 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                  i === sel
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30'
                    : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-purple-300'
                }`}>
                <Brain className="w-4 h-4 inline mr-2" />{model.name} <span className="text-xs opacity-75 ml-1">{model.version}</span>
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-base flex items-center gap-2"><Target className="w-5 h-5 text-purple-600" /> {m.name} — Detailed Metrics</h3>
              <span className="text-xs font-mono bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full">{m.version}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Accuracy', value: m.accuracy, icon: Target, desc: 'Overall prediction correctness' },
                { label: 'Precision', value: m.precision, icon: Zap, desc: 'True positive rate among positives' },
                { label: 'Recall', value: m.recall, icon: Eye, desc: 'Proportion of actual positives found' },
                { label: 'F1 Score', value: m.f1, icon: BarChart3, desc: 'Harmonic mean of precision & recall' },
              ].map((metric, mi) => (
                <div key={mi} className={`rounded-xl p-5 border-2 transition-all ${
                  metric.value >= 0.85 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                    : metric.value >= 0.7 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                    : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <metric.icon className={`w-5 h-5 ${metricColor(metric.value)}`} />
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{metric.label}</span>
                  </div>
                  <p className={`text-3xl font-bold ${metricColor(metric.value)}`}>{pct(metric.value)}</p>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                    <div className={`h-2 rounded-full bg-gradient-to-r ${barColor(metric.value)} transition-all duration-700`} style={{ width: `${metric.value * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">{metric.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-4">
              <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Trained: {fmt(m.lastTrained)}</span>
              <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> {m.trainingSamples.toLocaleString()} training samples</span>
              <span className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> Version: {m.version}</span>
              {m.notes && <span className="flex items-center gap-1.5 italic"><Hash className="w-3.5 h-3.5" /> {fixEncoding(m.notes)}</span>}
            </div>
          </div>

          {m.cm.matrix.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
              <h3 className="font-bold text-sm flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-purple-600" /> Confusion Matrix — {m.name}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="p-2 text-left text-gray-500 font-semibold">Actual / Predicted</th>
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

          {m.fi.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
              <h3 className="font-bold text-sm flex items-center gap-2 mb-4"><Activity className="w-4 h-4 text-purple-600" /> eXplainable AI (XAI) — Feature Importance</h3>
              <p className="text-xs text-gray-500 mb-4">Shows which input features most influence model predictions — computed via SHAP-like permutation importance.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {m.fi.map((f, fi) => (
                  <div key={fi}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{fixEncoding(f.n)}</span>
                      <span className="font-bold text-gray-600 dark:text-gray-400">{(f.v * 100).toFixed(1)}%</span>
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

      {/* ═══ DRIFT & HEALTH TAB ═══ */}
      {subTab === 'drift' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-purple-600" /> Model Drift Detection</h3>
              <button onClick={loadData} className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 transition-colors font-semibold">
                <RefreshCw className="w-3 h-3 inline mr-1" /> Check Now
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
                            <p className="font-semibold text-sm">{d.modelName || d.model_name || 'Model'}</p>
                            <p className="text-xs text-gray-500">{d.metricName || d.metric_name || 'accuracy'} — v{d.modelVersion || d.model_version || '?'}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold ${hasDrift ? 'text-red-600' : 'text-green-600'}`}>
                            {hasDrift ? 'DRIFT DETECTED' : 'STABLE'}
                          </span>
                          {magnitude > 0 && <p className="text-xs text-gray-500">Magnitude: {(magnitude * 100).toFixed(1)}%</p>}
                        </div>
                      </div>
                      {(d.baselineValue || d.baseline_value) && (
                        <div className="flex gap-4 mt-3 text-xs">
                          <span className="text-gray-500">Baseline: <strong>{pct(d.baselineValue || d.baseline_value || 0)}</strong></span>
                          <span className="text-gray-500">Current: <strong className={hasDrift ? 'text-red-600' : ''}>{pct(d.currentValue || d.current_value || 0)}</strong></span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-6 text-center">
                <ShieldCheck className="w-10 h-10 text-green-500 mx-auto mb-2" />
                <p className="font-semibold text-green-700 dark:text-green-300">All Models Stable</p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">No drift detected across all active models in the last 24 hours.</p>
              </div>
            )}
          </div>

          {aiStatus && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
              <h3 className="font-bold text-base flex items-center gap-2 mb-4"><Server className="w-5 h-5 text-purple-600" /> AI Engine Status</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Engine', value: aiStatus.status || aiStatus.engine_status || 'Unknown', color: (aiStatus.status || '').toLowerCase() === 'healthy' ? 'text-green-600' : 'text-amber-600' },
                  { label: 'Models Loaded', value: String(aiStatus.models_loaded ?? aiStatus.modelsLoaded ?? '—') },
                  { label: 'Uptime', value: aiStatus.uptime || '—' },
                  { label: 'GPU', value: aiStatus.gpu_available ? 'Available' : 'CPU Mode' },
                ].map((s, si) => (
                  <div key={si} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{s.label}</span>
                    <p className={`text-lg font-bold mt-1 ${s.color || 'text-gray-900 dark:text-white'}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h3 className="font-bold text-base flex items-center gap-2 mb-4"><FlaskConical className="w-5 h-5 text-purple-600" /> Training Status</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {models.map((model, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-purple-600" />
                    <span className="font-semibold text-sm">{model.name}</span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex justify-between"><span>Version</span><span className="font-mono font-semibold">{model.version}</span></div>
                    <div className="flex justify-between"><span>Samples</span><span className="font-semibold">{model.trainingSamples.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Last Trained</span><span className="font-semibold">{fmt(model.lastTrained)}</span></div>
                    <div className="flex justify-between"><span>Accuracy</span><span className={`font-semibold ${metricColor(model.accuracy)}`}>{pct(model.accuracy)}</span></div>
                  </div>
                  <button onClick={() => handleRetrain(model.name)} disabled={retraining === model.name}
                    className="w-full mt-3 py-2 text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 transition-colors flex items-center justify-center gap-1">
                    <RotateCcw className={`w-3 h-3 ${retraining === model.name ? 'animate-spin' : ''}`} />
                    {retraining === model.name ? 'Submitting...' : retrainStatus[model.name] === 'done' ? 'Queued!' : retrainStatus[model.name] === 'error' ? 'Failed — Retry' : 'Retrain'}
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

      {/* ═══ AUDIT TRAIL TAB ═══ */}
      {subTab === 'audit' && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="font-bold text-base flex items-center gap-2"><FileSearch className="w-5 h-5 text-purple-600" /> AI Execution Audit Trail</h3>
            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-3 py-1 rounded-full font-mono">{auditEntries.length} entries</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Model</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Action</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Target</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Time (ms)</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {auditEntries.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    <FileSearch className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    {partialFailures.includes('Audit trail')
                      ? 'Audit trail unavailable — could not reach the database.'
                      : 'No audit entries yet. AI executions will be logged as models process data.'}
                  </td></tr>
                ) : auditEntries.map((entry: any, i: number) => (
                  <tr key={entry.id || i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">{entry.modelName || entry.model_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 truncate max-w-[200px]">{entry.inputSummary || entry.input_summary || entry.action || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-600 dark:text-gray-400 text-[10px]">
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
                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">{entry.executionTimeMs || entry.execution_time_ms || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{fmt(entry.createdAt || entry.created_at || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ LLM PROVIDERS TAB ═══ */}
      {subTab === 'llm' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base flex items-center gap-2"><Sparkles className="w-5 h-5 text-purple-600" /> LLM Provider Status</h3>
              <button onClick={loadData} className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg">
                <RefreshCw className="w-3 h-3 inline mr-1" /> Refresh
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
                          {isPreferred && <span className="text-[10px] px-2 py-0.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-full font-bold">ACTIVE</span>}
                        </div>
                        <span className={`text-xs font-semibold ${isActive ? 'text-green-600' : 'text-red-600'}`}>
                          {isActive ? 'Online' : p.rateLimited || p.rate_limited ? 'Rate Limited' : 'Backed Off'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <div><span className="text-gray-400">Model</span><br /><span className="font-semibold">{p.model || '—'}</span></div>
                        <div><span className="text-gray-400">Requests</span><br /><span className="font-semibold">{p.totalRequests ?? p.total_requests ?? '—'}</span></div>
                        <div><span className="text-gray-400">Errors</span><br /><span className="font-semibold text-red-600">{p.errors ?? p.error_count ?? 0}</span></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-8 text-center">
                <Sparkles className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-gray-600 dark:text-gray-400 font-semibold">
                  {partialFailures.includes('LLM status') ? 'LLM Service Unavailable' : 'No Providers Configured'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {partialFailures.includes('LLM status')
                    ? 'Could not reach the chat service. Check that the server is running and LLM API keys are configured.'
                    : 'Provider status will appear once the chat service processes a request.'}
                </p>
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-6">
            <h3 className="font-bold text-base flex items-center gap-2 mb-4 text-purple-900 dark:text-purple-100"><Shield className="w-5 h-5" /> AI Governance Framework</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(() => {
                const engineUp = aiStatus?.status === 'operational' || aiStatus?.ai_engine_available === true
                const auditActive = !partialFailures.includes('Audit trail')
                return [
                  { title: 'Human-in-the-Loop', desc: 'Reports below 60% confidence are automatically flagged for operator review', icon: Eye, active: true },
                  { title: 'Model Version Control', desc: 'All model versions tracked with rollback capability and performance history', icon: GitBranch, active: engineUp },
                  { title: 'Audit Logging', desc: 'Every AI execution logged with inputs, outputs, confidence and timing', icon: FileSearch, active: auditActive },
                ]
              })().map((g, i) => (
                <div key={i} className="bg-white/80 dark:bg-gray-900/80 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
                  <div className="flex items-center gap-2 mb-2">
                    <g.icon className="w-5 h-5 text-purple-600" />
                    <span className="font-bold text-sm">{g.title}</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{g.desc}</p>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    g.active
                      ? 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300'
                      : 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300'
                  }`}>
                    <CheckCircle className="w-3 h-3" /> {g.active ? 'Active' : 'Unavailable'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
