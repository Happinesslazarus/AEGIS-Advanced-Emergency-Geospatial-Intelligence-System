 /*
 * AITransparencyConsole.tsx — Professional {t('ai.commandGovernance', lang)} Console
 * Modeled after IBM Watson OpenScale, Google Vertex AI Model Monitoring,
 * Palantir Gotham ML Ops, FEMA IPAWS AI Decision Support, UK Met Office
 * Hazard Manager AI/ML Transparency frameworks.
 * Wraps the existing AITransparencyDashboard (~840 lines, 5 tabs, 7 API
 * endpoints, WebSocket) and the inline Flood Intelligence section, adding:
 * Dark tactical command header with ZULU clock & system feed indicators
 * AI Pipeline Status Strip (Ingest → Classify → Predict → Alert)
 * Model Health Traffic Light Board (all models at one glance)
 * Inference Performance Gauges (latency, throughput, queue)
 * Data Lineage & Training Recency summary
 * Flood Intelligence Engine (predictions, on-demand analysis)
 * Existing AITransparencyDashboard component
  */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Brain, Zap, Clock, Activity, TrendingUp, AlertTriangle, CheckCircle,
  Waves, Map, Package, Shield, Server, Database, Radio,
  ArrowRight, ChevronDown, ChevronUp, Gauge, GitBranch,
  Keyboard, X, Eye, Target, BarChart3, Cpu, Signal,
  Crown, Trash2, ShieldCheck, RotateCcw, Loader2,
  Download, Calendar, RefreshCw
} from 'lucide-react'
import AITransparencyDashboard from './AITransparencyDashboard'
import {
  apiRunPrediction,
  apiGetPredictions,
  apiSendPreAlert,
  apiGetRegistryVersions,
  apiPromoteModel,
  apiDemoteModel,
  apiValidateModel,
  apiGetModelHealth,
  apiGetModelDrift,
  apiRecommendRollback,
  apiGetGovernanceModels,
  apiGetAIAuditLog,
  apiGetGovernanceDrift,
} from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

// PROPS
interface AITransparencyConsoleProps {
  predictions: any[]
  setPredictions: React.Dispatch<React.SetStateAction<any[]>>
  predictionArea: string
  setPredictionArea: (v: string) => void
  predictionRunning: boolean
  setPredictionRunning: (v: boolean) => void
  predictionResult: any | null
  setPredictionResult: (v: any) => void
  heatmapData: any[]
  predictionAreaOptions: Array<{ area: string; lat: number; lng: number; regionId: string }>
  loc: { name?: string; center?: [number, number] }
  activeLocation: string
  user: any
  lang: string
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
  askConfirm: (title: string, message: string, type: string, action: () => void) => void
}

// HELPERS
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

// COMPONENT
export default function AITransparencyConsole(props: AITransparencyConsoleProps) {
  const lang = useLanguage()
  const {
    predictions, setPredictions, predictionArea, setPredictionArea,
    predictionRunning, setPredictionRunning, predictionResult, setPredictionResult,
    heatmapData, predictionAreaOptions, loc, activeLocation, user,
    pushNotification, askConfirm,
  } = props

  const [clockNow, setClockNow] = useState(new Date())
  const [pipelineExpanded, setPipelineExpanded] = useState(true)
  const [floodExpanded, setFloodExpanded] = useState(true)
  const [showKeyboard, setShowKeyboard] = useState(false)

  // Model lifecycle state
  const [lifecycleExpanded, setLifecycleExpanded] = useState(false)
  const [selectedHazard, setSelectedHazard] = useState('flood')
  const [selectedRegion, setSelectedRegion] = useState('uk-default')
  const [versions, setVersions] = useState<any[]>([])
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [lifecycleAction, setLifecycleAction] = useState<string | null>(null)
  const [modelHealth, setModelHealth] = useState<any | null>(null)
  const [driftSnapshot, setDriftSnapshot] = useState<any | null>(null)
  const [rollbackHint, setRollbackHint] = useState<any | null>(null)

  // Interactive Model Explorer state
  const [explorerExpanded, setExplorerExpanded] = useState(false)
  const [explorerModels, setExplorerModels] = useState<any[]>([])
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [selectedExplorerModel, setSelectedExplorerModel] = useState<any | null>(null)

  // Drift Monitoring Panel state
  const [driftPanelExpanded, setDriftPanelExpanded] = useState(false)
  const [driftEntries, setDriftEntries] = useState<any[]>([])
  const [driftLoading, setDriftLoading] = useState(false)

  // Enhanced Audit Trail state
  const [auditExpanded, setAuditExpanded] = useState(false)
  const [auditEntries, setAuditEntries] = useState<any[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilter, setAuditFilter] = useState<'All' | 'Governance' | 'Analysis' | 'Classification'>('All')
  const [auditDateFrom, setAuditDateFrom] = useState('')
  const [auditDateTo, setAuditDateTo] = useState('')

  // Live clock
  useEffect(() => {
    const iv = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const zuluTime = clockNow.toISOString().replace('T', ' ').substring(0, 19) + 'Z'

  const HAZARD_OPTIONS = [
    'flood', 'drought', 'heatwave', 'severe_storm', 'wildfire',
    'landslide', 'power_outage', 'water_supply_disruption',
    'infrastructure_damage', 'public_safety_incident', 'environmental_hazard',
  ]

  const fetchVersions = useCallback(async () => {
    setVersionsLoading(true)
    try {
      const data: any = await apiGetRegistryVersions(selectedHazard, selectedRegion)
      setVersions(data.versions || [])
      setCurrentKey(data.current_key || null)

      const health: any = await apiGetModelHealth(selectedHazard, selectedRegion).catch(() => null)
      setModelHealth(health)

      const currentVersion = health?.current_version || data?.versions?.find((v: any) => v.is_current)?.version
      if (currentVersion) {
        const drift: any = await apiGetModelDrift(selectedHazard, selectedRegion, currentVersion).catch(() => null)
        setDriftSnapshot(drift?.snapshot || null)
      } else {
        setDriftSnapshot(null)
      }

      const rollback: any = await apiRecommendRollback(selectedHazard, selectedRegion).catch(() => null)
      setRollbackHint(rollback)
    } catch {
      setVersions([])
      setCurrentKey(null)
      setModelHealth(null)
      setDriftSnapshot(null)
      setRollbackHint(null)
    } finally {
      setVersionsLoading(false)
    }
  }, [selectedHazard, selectedRegion])

  useEffect(() => {
    if (lifecycleExpanded) fetchVersions()
  }, [lifecycleExpanded, fetchVersions])

  // Fetch explorer models
  const fetchExplorerModels = useCallback(async () => {
    setExplorerLoading(true)
    try {
      const data = await apiGetGovernanceModels()
      const arr = Array.isArray(data) ? data : []
      setExplorerModels(arr)
      if (arr.length > 0 && !selectedExplorerModel) setSelectedExplorerModel(arr[0])
    } catch { setExplorerModels([]) }
    finally { setExplorerLoading(false) }
  }, [selectedExplorerModel])

  useEffect(() => { if (explorerExpanded) fetchExplorerModels() }, [explorerExpanded, fetchExplorerModels])

  // Fetch drift data
  const fetchDriftData = useCallback(async () => {
    setDriftLoading(true)
    try {
      const data = await apiGetGovernanceDrift()
      setDriftEntries(Array.isArray(data) ? data : data?.drift ? [data] : [])
    } catch { setDriftEntries([]) }
    finally { setDriftLoading(false) }
  }, [])

  useEffect(() => { if (driftPanelExpanded) fetchDriftData() }, [driftPanelExpanded, fetchDriftData])

  // Fetch audit data
  const fetchAuditData = useCallback(async () => {
    setAuditLoading(true)
    try {
      const data = await apiGetAIAuditLog(100, 0)
      setAuditEntries(Array.isArray(data) ? data : (data as any)?.entries || [])
    } catch { setAuditEntries([]) }
    finally { setAuditLoading(false) }
  }, [])

  useEffect(() => { if (auditExpanded) fetchAuditData() }, [auditExpanded, fetchAuditData])

  // Audit filter + date range logic
  const filteredAuditEntries = useMemo(() => {
    let entries = auditEntries
    if (auditFilter !== 'All') {
      entries = entries.filter((e: any) => {
        const action = (e.action || e.inputSummary || e.input_summary || e.targetType || e.target_type || '').toLowerCase()
        if (auditFilter === 'Governance') return action.includes('governance') || action.includes('review') || action.includes('flag')
        if (auditFilter === 'Analysis') return action.includes('analysis') || action.includes('predict') || action.includes('inference')
        if (auditFilter === 'Classification') return action.includes('classif') || action.includes('classify')
        return true
      })
    }
    if (auditDateFrom) {
      const from = new Date(auditDateFrom).getTime()
      entries = entries.filter((e: any) => {
        const d = new Date(e.createdAt || e.created_at || '').getTime()
        return !isNaN(d) && d >= from
      })
    }
    if (auditDateTo) {
      const to = new Date(auditDateTo).getTime() + 86400000
      entries = entries.filter((e: any) => {
        const d = new Date(e.createdAt || e.created_at || '').getTime()
        return !isNaN(d) && d <= to
      })
    }
    return entries
  }, [auditEntries, auditFilter, auditDateFrom, auditDateTo])

  // Audit aggregate stats
  const auditStats = useMemo(() => {
    const total = filteredAuditEntries.length
    const avgLatency = total > 0
      ? Math.round(filteredAuditEntries.reduce((a: number, e: any) => a + (e.executionTimeMs || e.execution_time_ms || 0), 0) / total)
      : 0
    const errorCount = filteredAuditEntries.filter((e: any) => (e.status || '').toLowerCase() === 'error').length
    const errorRate = total > 0 ? ((errorCount / total) * 100).toFixed(1) : '0.0'
    return { total, avgLatency, errorCount, errorRate }
  }, [filteredAuditEntries])

  // CSV export for audit entries
  const exportAuditCSV = useCallback(() => {
    if (filteredAuditEntries.length === 0) return
    const headers = ['Model', 'Action', 'Target', 'Status', 'Latency (ms)', 'Timestamp']
    const rows = filteredAuditEntries.map((e: any) => [
      e.modelName || e.model_name || '',
      e.action || e.inputSummary || e.input_summary || '',
      e.targetType || e.target_type || '',
      e.status || '',
      String(e.executionTimeMs || e.execution_time_ms || ''),
      e.createdAt || e.created_at || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }, [filteredAuditEntries])

  const handlePromote = async (version: string) => {
    setLifecycleAction(version)
    try {
      await apiPromoteModel(selectedHazard, selectedRegion, version)
      pushNotification(`Promoted ${selectedHazard} v${version}`, 'success')
      await fetchVersions()
    } catch (err: any) {
      pushNotification(err?.message || 'Promotion failed', 'error')
    } finally {
      setLifecycleAction(null)
    }
  }

  const handleDemote = async () => {
    setLifecycleAction('demote')
    try {
      await apiDemoteModel(selectedHazard, selectedRegion)
      pushNotification(`Removed override for ${selectedHazard}`, 'success')
      await fetchVersions()
    } catch (err: any) {
      pushNotification(err?.message || 'Demotion failed', 'error')
    } finally {
      setLifecycleAction(null)
    }
  }

  const handleValidate = async (version: string) => {
    setLifecycleAction(`validate-${version}`)
    try {
      const result: any = await apiValidateModel(selectedHazard, selectedRegion, version)
      if (result.valid) {
        pushNotification(`${version}: Integrity OK`, 'success')
      } else {
        pushNotification(`${version}: ${result.issues?.join(', ')}`, 'warning')
      }
    } catch (err: any) {
      pushNotification(err?.message || 'Validation failed', 'error')
    } finally {
      setLifecycleAction(null)
    }
  }

  //  Prediction computations (moved from inline)
  const predMetrics = useMemo(() => {
    const highRisk = predictions.filter((p: any) => {
      const prob = typeof p.probability === 'number' ? p.probability : parseFloat(String(p.probability)) || 0
      return (prob <= 1 ? prob : prob / 100) > 0.5
    }).length
    const avgConf = predictions.length > 0
      ? Math.round(predictions.reduce((s: number, p: any) => {
          const c = typeof p.confidence === 'number' ? p.confidence : parseFloat(String(p.confidence)) || 0
          return s + (c <= 1 ? c * 100 : c)
        }, 0) / predictions.length)
      : 0
    const dataSources = [...new Set(predictions.flatMap((p: any) => Array.isArray(p.data_sources) ? p.data_sources : []))].length || 0
    return { highRisk, avgConf, dataSources }
  }, [predictions])

  //  Run prediction handler
  const runPrediction = async () => {
    try {
      setPredictionRunning(true)
      const option = predictionAreaOptions.find(x => x.area === predictionArea)
      const lat = option?.lat ?? loc.center?.[0] ?? 56.49
      const lng = option?.lng ?? loc.center?.[1] ?? -4.20
      const region_id = option?.regionId ?? (activeLocation === 'scotland' ? 'uk-default' : `${activeLocation}-default`)
      const result = await apiRunPrediction({ area: predictionArea, latitude: lat, longitude: lng, region_id })
      setPredictionResult(result)
      if (result?.saved_to_feed) {
        apiGetPredictions().then((raw: any[]) => {
          const byArea: Record<string, any> = {}
          for (const p of raw) {
            const key = (p.area || '').toLowerCase().trim()
            if (!key) continue
            const ex = byArea[key]
            if (!ex || (p.probability ?? 0) > (ex.probability ?? 0)) byArea[key] = p
          }
          setPredictions(Object.values(byArea))
        }).catch(() => {})
      }
    } catch {
      pushNotification(t('ai.predictionFailed', lang), 'error')
    } finally {
      setPredictionRunning(false)
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/*
          SECTION 1 — COMMAND HEADER
           */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-900 to-gray-950 rounded-2xl ring-1 ring-gray-800 shadow-lg overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
          {/* Left: Title + Clock */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  {t('ai.commandGovernance', lang)}
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 ring-1 ring-green-500/30 font-mono">{t('common.operational', lang)}</span>
                </h1>
                <p className="text-[9px] text-purple-400/70 font-mono tracking-wider uppercase">{t('ai.transparencySubtitle', lang)}</p>
              </div>
            </div>
            {/* Mission Clock */}
            <div className="hidden md:flex items-center gap-2 bg-gray-800/80 rounded-lg px-3 py-1.5 ring-1 ring-gray-700">
              <Clock className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] font-mono text-green-400 tabular-nums">{zuluTime}</span>
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            <button onClick={() => setShowKeyboard(p => !p)} className="text-[10px] bg-gray-800 hover:bg-gray-700 p-1.5 rounded-lg ring-1 ring-gray-700 text-gray-400 dark:text-gray-300 transition-all">
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/*  AI Pipeline Status Strip  */}
        <button
          onClick={() => setPipelineExpanded(p => !p)}
          className="w-full px-5 py-2 bg-gray-950/60 border-t border-gray-800/60 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-[8px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{t('ai.pipeline', lang)}</span>
            <span className="text-[10px] font-black px-2 py-0.5 rounded ring-1 bg-green-500/10 ring-green-500/30 text-green-400">{t('common.active', lang)}</span>
          </div>
          {pipelineExpanded ? <ChevronUp className="w-3 h-3 text-gray-600" /> : <ChevronDown className="w-3 h-3 text-gray-600" />}
        </button>

        {pipelineExpanded && (
          <div className="px-5 py-3 bg-gray-950/40 border-t border-gray-800/40">
            {/* Pipeline Flow */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none mb-3">
              {[
                { label: t('ai.ingest', lang), desc: t('ai.dataCollection', lang), icon: Database, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10 ring-cyan-500/30' },
                { label: t('ai.classify', lang), desc: t('ai.aiClassification', lang), icon: Brain, color: 'text-purple-400', bgColor: 'bg-purple-500/10 ring-purple-500/30' },
                { label: t('ai.predict', lang), desc: t('ai.riskScoring', lang), icon: Target, color: 'text-amber-400', bgColor: 'bg-amber-500/10 ring-amber-500/30' },
                { label: t('ai.verify', lang), desc: t('ai.humanReview', lang), icon: Eye, color: 'text-blue-400', bgColor: 'bg-blue-500/10 ring-blue-500/30' },
                { label: t('ai.alertStep', lang), desc: t('ai.notification', lang), icon: Radio, color: 'text-red-400', bgColor: 'bg-red-500/10 ring-red-500/30' },
              ].map((stage, i, arr) => (
                <React.Fragment key={stage.label}>
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ring-1 ${stage.bgColor} flex-shrink-0`}>
                    <stage.icon className={`w-3.5 h-3.5 ${stage.color}`} />
                    <div>
                      <p className={`text-[9px] font-black ${stage.color}`}>{stage.label}</p>
                      <p className="text-[8px] text-gray-500 dark:text-gray-300">{stage.desc}</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-600 flex-shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { label: t('ai.activePredictions', lang), value: predictions.length, icon: Zap, color: predictions.length > 0 ? 'text-green-400' : 'text-gray-500 dark:text-gray-300' },
                { label: t('ai.highRiskAreas', lang), value: predMetrics.highRisk, icon: AlertTriangle, color: predMetrics.highRisk > 0 ? 'text-red-400' : 'text-green-400' },
                { label: t('ai.avgConfidence', lang), value: `${predMetrics.avgConf}%`, icon: Gauge, color: predMetrics.avgConf >= 70 ? 'text-emerald-400' : 'text-amber-400' },
                { label: t('ai.dataSources', lang), value: predMetrics.dataSources, icon: Database, color: 'text-cyan-400' },
                { label: t('ai.heatmapPoints', lang), value: heatmapData.length, icon: Map, color: 'text-purple-400' },
                { label: t('ai.engineStatus', lang), value: predictionRunning ? t('common.processing', lang) : t('common.ready', lang), icon: Cpu, color: predictionRunning ? 'text-amber-400' : 'text-green-400' },
              ].map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <m.icon className={`w-3.5 h-3.5 ${m.color} flex-shrink-0`} />
                  <div>
                    <p className={`text-sm font-black tabular-nums ${m.color}`}>{m.value}</p>
                    <p className="text-[8px] text-gray-500 dark:text-gray-300 uppercase tracking-wider">{m.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Keyboard Shortcuts */}
      {showKeyboard && (
        <div className="bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="text-gray-400 dark:text-gray-300 font-bold uppercase tracking-wider text-[9px]">{t('common.shortcuts', lang)}:</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">R</kbd> {t('common.refresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">P</kbd> {t('ai.runPrediction', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">E</kbd> {t('common.export', lang)}</span>
          <button onClick={() => setShowKeyboard(false)} className="ml-auto text-gray-400 dark:text-gray-300 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/*
          SECTION 2 — FLOOD INTELLIGENCE ENGINE (moved from inline)
           */}
      <div className="bg-gradient-to-br from-white via-gray-50 to-white dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setFloodExpanded(p => !p)}
          className="w-full bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-700 dark:from-indigo-800 dark:via-blue-800 dark:to-cyan-800 px-6 py-5 relative overflow-hidden text-left"
        >
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
          <div className="relative z-10 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-lg">{t('ai.floodIntelligenceEngine', lang)}</h3>
                <div className="text-xs text-blue-200 flex items-center gap-2 flex-wrap">
                  <span>{t('ai.multiSourceAnalytics', lang)}</span>
                  <span aria-hidden="true" className="w-1 h-1 rounded-full bg-blue-200/70" />
                  <span>{loc.name || t('common.global', lang)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/80 bg-white/10 px-3 py-1.5 rounded-lg">{predictions.length} {t(predictions.length === 1 ? 'ai.activePrediction' : 'ai.activePredictionPlural', lang)}</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${predictionRunning ? 'bg-yellow-400 animate-pulse' : 'bg-green-400 animate-pulse'}`} />
                <span className="text-xs text-white font-medium">{predictionRunning ? `${t('common.processing', lang)}...` : t('common.online', lang)}</span>
              </div>
              {floodExpanded ? <ChevronUp className="w-4 h-4 text-white/60" /> : <ChevronDown className="w-4 h-4 text-white/60" />}
            </div>
          </div>

          {/* Quick stats */}
          <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {[
              { label: t('ai.highRiskAreas', lang), value: predMetrics.highRisk, color: 'text-red-300' },
              { label: t('ai.avgConfidence', lang), value: predMetrics.avgConf > 0 ? `${predMetrics.avgConf}%` : '--', color: 'text-cyan-300' },
              { label: t('ai.heatmapPoints', lang), value: heatmapData.length, color: 'text-aegis-300' },
              { label: t('ai.dataSources', lang), value: predMetrics.dataSources, color: 'text-green-300' },
            ].map((s, i) => (
              <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-2.5 border border-white/10">
                <p className="text-[10px] text-blue-200 uppercase tracking-wider font-semibold">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </button>

        {floodExpanded && (
          <div className="p-5 space-y-5">
            {/* Live Predictions Feed */}
            <div>
              <h4 className="font-bold text-sm mb-3 flex items-center gap-2 text-primary"><TrendingUp className="w-4 h-4 text-indigo-600" /> {t('ai.livePredictionFeed', lang)}</h4>
              {predictions.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                  <Waves className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-300">{t('ai.noActivePredictions', lang)}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {predictions.map((pred: any, i: number) => {
                    const prob = typeof pred.probability === 'number' ? pred.probability : parseFloat(String(pred.probability)) || 0
                    const conf = typeof pred.confidence === 'number' ? pred.confidence : parseFloat(String(pred.confidence)) || 0
                    const confDisplay = conf <= 1 ? Math.round(conf * 100) : Math.round(conf)
                    const probPct = prob <= 1 ? Math.round(prob * 100) : Math.round(prob)
                    const riskColor = probPct > 70 ? 'border-red-400 dark:border-red-700 bg-gradient-to-r from-red-50 to-red-25 dark:from-red-950/20 dark:to-red-950/5' : probPct > 40 ? 'border-aegis-400 dark:border-aegis-700 bg-gradient-to-r from-aegis-50 to-aegis-25 dark:from-aegis-950/20 dark:to-aegis-950/5' : 'border-blue-300 dark:border-blue-700 bg-gradient-to-r from-blue-50 to-blue-25 dark:from-blue-950/20 dark:to-blue-950/5'
                    const ttf = (typeof pred.time_to_flood === 'object' && pred.time_to_flood !== null) ? JSON.stringify(pred.time_to_flood) : String(pred.time_to_flood || t('common.notAvailable', lang))
                    const pattern = (typeof pred.matched_pattern === 'object' && pred.matched_pattern !== null) ? JSON.stringify(pred.matched_pattern) : String(pred.matched_pattern || t('common.notAvailable', lang))
                    return (
                      <div key={pred.id || i} className={`border-2 rounded-xl p-4 ${riskColor} transition-all hover:shadow-md`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-[200px]">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <h4 className="font-bold text-sm text-primary">{pred.area}</h4>
                              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold text-white ${probPct > 70 ? 'bg-red-600' : probPct > 40 ? 'bg-aegis-600' : 'bg-blue-600'}`}>{probPct}%</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center gap-1"><Clock className="w-3 h-3" /> {ttf}</span>
                              <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('ai.confShort', lang)} {confDisplay}%</span>
                            </div>
                            <div className="flex items-center gap-4 mb-2">
                              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${probPct > 70 ? 'bg-gradient-to-r from-red-500 to-red-600' : probPct > 40 ? 'bg-gradient-to-r from-aegis-400 to-aegis-500' : 'bg-gradient-to-r from-blue-400 to-blue-500'}`} style={{ width: `${probPct}%` }} />
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mb-1"><span className="font-semibold">{t('ai.pattern', lang)}:</span> {pattern}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mb-2"><span className="font-semibold">{t('ai.nextAreas', lang)}:</span> {(Array.isArray(pred.next_areas) ? pred.next_areas : []).join(', ') || t('common.notAvailable', lang)}</p>
                            <div className="flex gap-1 flex-wrap">{(Array.isArray(pred.data_sources) ? pred.data_sources : []).map((s: string, j: number) => <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{String(s)}</span>)}</div>
                          </div>
                          <button
                            onClick={() => askConfirm(t('ai.preAlertConfirmTitle', lang), `${t('ai.preAlertConfirmPrefix', lang)} ${pred.area}? ${t('ai.preAlertConfirmSuffix', lang)}`, 'warning', async () => {
                              try {
                                await apiSendPreAlert(pred.id, user?.id)
                                setPredictions(p => p.map(x => x.id === pred.id ? { ...x, pre_alert_sent: true } : x))
                                pushNotification(t('ai.preAlertSent', lang), 'success')
                              } catch (err: any) {
                                pushNotification(err?.message || t('ai.preAlertFailed', lang), 'error')
                              }
                            })}
                            disabled={pred.pre_alert_sent}
                            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm ${pred.pre_alert_sent ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md hover:shadow-lg'}`}
                          >
                            {pred.pre_alert_sent ? t('common.sent', lang) : t('ai.sendPreAlert', lang)}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Run New Prediction */}
            <div className="bg-gray-50 dark:bg-gray-800/30 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <h4 className="font-bold text-sm mb-4 text-primary flex items-center gap-2"><Zap className="w-4 h-4 text-aegis-600" /> {t('ai.runOnDemandAnalysis', lang)}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5 uppercase tracking-wider">{t('ai.targetArea', lang)}</label>
                  <select className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" value={predictionArea} onChange={e => setPredictionArea(e.target.value)}>
                    {predictionAreaOptions.map(opt => <option key={opt.area} value={opt.area}>{opt.area}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5 uppercase tracking-wider">{t('ai.model', lang)}</label>
                  <div className="px-3 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl font-mono text-gray-700 dark:text-gray-300">{predictionResult?.model_version || t('ai.defaultModelVersion', lang)}</div>
                </div>
                <div className="flex flex-col justify-end">
                  <button onClick={runPrediction} disabled={predictionRunning} className={`w-full px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md ${predictionRunning ? 'bg-gray-400 text-gray-600 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl'}`}>
                    <Package className="w-4 h-4" /> {predictionRunning ? `${t('common.analyzing', lang)}...` : t('ai.runAnalysis', lang)}
                  </button>
                </div>
              </div>

              {/* Results */}
              {predictionResult && (
                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      { label: t('common.risk', lang), value: predictionResult.risk_level || t('common.unknown', lang), icon: AlertTriangle, bg: 'bg-red-50 dark:bg-red-900/20', tc: 'text-red-700 dark:text-red-300' },
                      { label: t('ai.probability', lang), value: `${Math.round((Number(predictionResult.probability) || 0) <= 1 ? (Number(predictionResult.probability) || 0) * 100 : (Number(predictionResult.probability) || 0))}%`, icon: TrendingUp, bg: 'bg-blue-50 dark:bg-blue-900/20', tc: 'text-blue-700 dark:text-blue-300' },
                      { label: t('ai.confidence', lang), value: `${Math.round((Number(predictionResult.confidence) || 0) <= 1 ? (Number(predictionResult.confidence) || 0) * 100 : (Number(predictionResult.confidence) || 0))}%`, icon: CheckCircle, bg: 'bg-green-50 dark:bg-green-900/20', tc: 'text-green-700 dark:text-green-300' },
                      { label: t('ai.peakTime', lang), value: predictionResult.predicted_peak_time ? new Date(predictionResult.predicted_peak_time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('common.notAvailable', lang), icon: Clock, bg: 'bg-purple-50 dark:bg-purple-900/20', tc: 'text-purple-700 dark:text-purple-300' },
                      { label: t('ai.radius', lang), value: `${(predictionResult.affected_radius_km || 0).toFixed?.(1) || predictionResult.affected_radius_km || 0} km`, icon: Waves, bg: 'bg-cyan-50 dark:bg-cyan-900/20', tc: 'text-cyan-700 dark:text-cyan-300' },
                    ].map((m, i) => {
                      const Icon = m.icon
                      return (
                        <div key={i} className={`${m.bg} rounded-xl p-3 border border-gray-200 dark:border-gray-700`}>
                          <div className="flex items-center justify-between mb-1"><span className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase">{m.label}</span><Icon className="w-3.5 h-3.5 opacity-50" /></div>
                          <p className={`font-bold text-sm ${m.tc}`}>{m.value}</p>
                        </div>
                      )
                    })}
                  </div>

                  {predictionResult.contributing_factors?.length > 0 && (
                    <div className="bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                      <h5 className="font-bold text-xs mb-3 uppercase tracking-wider text-gray-500 dark:text-gray-300">{t('ai.contributingFactors', lang)}</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(predictionResult.contributing_factors || []).map((f: any, idx: number) => {
                          const imp = typeof f.importance === 'number' ? Math.round(f.importance * 100) : 0
                          const name = typeof f === 'string' ? f : (f.factor || f.name || t('common.unknown', lang))
                          const barColor = imp >= 50 ? 'from-red-500 to-red-600' : imp >= 30 ? 'from-aegis-400 to-aegis-500' : 'from-blue-400 to-blue-500'
                          return (
                            <div key={idx}>
                              <div className="flex justify-between text-xs mb-0.5"><span className="font-medium text-gray-700 dark:text-gray-300 truncate">{name}</span><span className="font-bold text-gray-600 dark:text-gray-300">{imp}%</span></div>
                              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"><div className={`h-full bg-gradient-to-r ${barColor} rounded-full`} style={{ width: `${imp}%` }} /></div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Heatmap Summary */}
            <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl p-4 border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center"><Map className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /></div>
                <div>
                  <p className="font-bold text-sm text-gray-900 dark:text-white">{t('ai.heatmapCoverage', lang)}</p>
                  <div className="text-xs text-gray-500 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
                    <span>{heatmapData.length} {t('ai.dataPoints', lang).toLowerCase()}</span>
                    <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                    <span>{t('common.updated', lang)}: {new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>
              <span className="px-3 py-1.5 bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-200 text-xs font-bold rounded-full">{heatmapData.length} {t('ai.pts', lang)}</span>
            </div>
          </div>
        )}
      </div>

      {/*
          SECTION 3 — MODEL VERSION MANAGEMENT
           */}
      <div className="bg-gradient-to-br from-white via-gray-50 to-white dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
        <button
          onClick={() => setLifecycleExpanded(p => !p)}
          className="w-full bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-700 dark:from-emerald-800 dark:via-teal-800 dark:to-cyan-800 px-6 py-4 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <GitBranch className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Model Version Management</h3>
                <p className="text-xs text-emerald-200">Promote, validate, and manage model lifecycle</p>
              </div>
            </div>
            {lifecycleExpanded ? <ChevronUp className="w-4 h-4 text-white/60" /> : <ChevronDown className="w-4 h-4 text-white/60" />}
          </div>
        </button>

        {lifecycleExpanded && (
          <div className="p-5 space-y-4">
            {/* Hazard + Region selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Hazard Type</label>
                <select
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl"
                  value={selectedHazard}
                  onChange={e => setSelectedHazard(e.target.value)}
                >
                  {HAZARD_OPTIONS.map(h => <option key={h} value={h}>{h.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Region</label>
                <select
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl"
                  value={selectedRegion}
                  onChange={e => setSelectedRegion(e.target.value)}
                >
                  <option value="uk-default">uk-default</option>
                  <option value="scotland">scotland</option>
                  <option value="england">england</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={fetchVersions}
                  disabled={versionsLoading}
                  className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50"
                >
                  {versionsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
                </button>
                <button
                  onClick={() => askConfirm('Remove Override', 'Revert to automatic model selection?', 'warning', handleDemote)}
                  disabled={lifecycleAction === 'demote'}
                  className="px-4 py-2 text-sm font-bold bg-gray-600 hover:bg-gray-700 text-white rounded-xl transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Current model indicator */}
            {currentKey && (
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                <Crown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300">Active: {currentKey}</span>
              </div>
            )}

            {(modelHealth || driftSnapshot || rollbackHint) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/20 p-4 space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-sky-700 dark:text-sky-300">Model Health</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Current version</p>
                      <p className="font-mono font-bold text-gray-900 dark:text-white">{modelHealth?.current_version || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Health badge</p>
                      <p className="font-bold text-gray-900 dark:text-white">{String(modelHealth?.health_status || 'healthy').toUpperCase()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Drift score</p>
                      <p className="font-bold text-gray-900 dark:text-white">{Number(modelHealth?.drift_score ?? driftSnapshot?.drift_score ?? 0).toFixed(3)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Confidence trend</p>
                      <p className="font-bold text-gray-900 dark:text-white">{Number(driftSnapshot?.avg_confidence ?? 0).toFixed(3)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Fallback count</p>
                      <p className="font-bold text-gray-900 dark:text-white">{modelHealth?.fallback_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Last snapshot</p>
                      <p className="font-bold text-gray-900 dark:text-white">{modelHealth?.last_monitoring_snapshot ? new Date(modelHealth.last_monitoring_snapshot).toLocaleString() : '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">Version Trend</h4>
                  <div className="space-y-1 text-xs">
                    <p><span className="text-gray-500 dark:text-gray-400">Promoted version:</span> <span className="font-mono font-bold text-gray-900 dark:text-white">{versions.find((v: any) => v.promotion_status === 'promoted')?.version || '-'}</span></p>
                    <p><span className="text-gray-500 dark:text-gray-400">Current live version:</span> <span className="font-mono font-bold text-gray-900 dark:text-white">{modelHealth?.current_version || versions.find((v: any) => v.is_current)?.version || '-'}</span></p>
                    <p><span className="text-gray-500 dark:text-gray-400">Previous candidate:</span> <span className="font-mono font-bold text-gray-900 dark:text-white">{versions.find((v: any) => !v.is_current)?.version || '-'}</span></p>
                    <p><span className="text-gray-500 dark:text-gray-400">Rollback recommendation:</span> <span className="font-mono font-bold text-gray-900 dark:text-white">{modelHealth?.recommended_rollback_version || rollbackHint?.recommended_rollback_version || '-'}</span></p>
                  </div>
                </div>
              </div>
            )}

            {/* Version list */}
            {versionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <Package className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No versions found for {selectedHazard}/{selectedRegion}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((v: any) => {
                  const auc = v.performance_metrics?.roc_auc
                  const aucStr = typeof auc === 'number' ? `AUC ${auc.toFixed(4)}` : ''
                  const isLoading = lifecycleAction === v.version || lifecycleAction === `validate-${v.version}`
                  return (
                    <div
                      key={v.version}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                        v.is_current
                          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                          : v.promotion_status === 'rejected'
                          ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/5'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {v.is_current && <Crown className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-mono font-bold text-gray-900 dark:text-white truncate">{v.version}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              v.promotion_status === 'promoted' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                              v.promotion_status === 'rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                              v.promotion_status === 'candidate' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                              'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}>{v.promotion_status}</span>
                            {aucStr && <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">{aucStr}</span>}
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">{v.trained_at?.split('T')[0]}</span>
                            {!v.has_model_file && <span className="text-[10px] text-red-500 font-bold">NO FILE</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => handleValidate(v.version)}
                          disabled={!!lifecycleAction}
                          title="Validate integrity"
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-30"
                        >
                          {lifecycleAction === `validate-${v.version}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        </button>
                        {!v.is_current && (
                          <button
                            onClick={() => askConfirm('Promote Model', `Set ${v.version} as the active model for ${selectedHazard}?`, 'warning', () => handlePromote(v.version))}
                            disabled={!!lifecycleAction}
                            title="Promote as active"
                            className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 transition-colors disabled:opacity-30"
                          >
                            {lifecycleAction === v.version ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/*
          SECTION 4 — INTERACTIVE MODEL EXPLORER
           */}
      <div className="bg-gradient-to-br from-white via-gray-50 to-white dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
        <button
          onClick={() => setExplorerExpanded(p => !p)}
          className="w-full bg-gradient-to-r from-purple-700 via-violet-700 to-indigo-700 dark:from-purple-800 dark:via-violet-800 dark:to-indigo-800 px-6 py-4 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Interactive Model Explorer</h3>
                <p className="text-xs text-purple-200">Feature importance, confusion matrix, and confidence distribution</p>
              </div>
            </div>
            {explorerExpanded ? <ChevronUp className="w-4 h-4 text-white/60" /> : <ChevronDown className="w-4 h-4 text-white/60" />}
          </div>
        </button>

        {explorerExpanded && (
          <div className="p-5 space-y-4">
            {explorerLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : explorerModels.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <Brain className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No models available</p>
              </div>
            ) : (
              <>
                {/* Model selector chips */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {explorerModels.map((model: any, mi: number) => {
                    const name = model.name || model.model_name || `Model ${mi + 1}`
                    const isSelected = selectedExplorerModel && (selectedExplorerModel.name || selectedExplorerModel.model_name) === name
                    return (
                      <button key={mi} onClick={() => setSelectedExplorerModel(model)}
                        className={`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                          isSelected
                            ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30'
                            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-purple-300'
                        }`}>
                        <Brain className="w-3.5 h-3.5 inline mr-1.5" />{name}
                      </button>
                    )
                  })}
                </div>

                {selectedExplorerModel && (() => {
                  const m = selectedExplorerModel
                  const fi = m.fi || m.feature_importance || []
                  const cm = m.cm || m.confusion_matrix || { labels: [], matrix: [] }
                  const cd = m.cd || m.confidence_distribution || []
                  const accuracy = parseFloat(m.accuracy) || 0
                  const precision = parseFloat(m.precision ?? m.precision_score) || 0
                  const recall = parseFloat(m.recall) || 0
                  const f1 = parseFloat(m.f1 ?? m.f1_score) || 0

                  return (
                    <div className="space-y-5">
                      {/* Expanded metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: 'Accuracy', value: accuracy },
                          { label: 'Precision', value: precision },
                          { label: 'Recall', value: recall },
                          { label: 'F1 Score', value: f1 },
                        ].map((metric, mi2) => (
                          <div key={mi2} className={`rounded-xl p-4 border-2 ${
                            metric.value >= 0.85 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                              : metric.value >= 0.7 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                              : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                          }`}>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{metric.label}</span>
                            <p className={`text-2xl font-bold mt-1 ${
                              metric.value >= 0.9 ? 'text-emerald-600 dark:text-emerald-400' : metric.value >= 0.8 ? 'text-blue-600 dark:text-blue-400' : metric.value >= 0.7 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                            }`}>{(metric.value * 100).toFixed(1)}%</p>
                          </div>
                        ))}
                      </div>

                      {/* Feature Importance - horizontal bar chart */}
                      {Array.isArray(fi) && fi.length > 0 && (
                        <div className="bg-white dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                          <h4 className="font-bold text-sm flex items-center gap-2 mb-4 text-gray-900 dark:text-white">
                            <Activity className="w-4 h-4 text-purple-600" /> Feature Importance
                          </h4>
                          <div className="space-y-2.5">
                            {fi.slice(0, 12).map((f: any, fIdx: number) => {
                              const name = f.n || f.name || f.feature || `Feature ${fIdx}`
                              const value = f.v || f.value || f.importance || 0
                              const widthPct = Math.min(value * 100, 100)
                              return (
                                <div key={fIdx}>
                                  <div className="flex justify-between text-xs mb-0.5">
                                    <span className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[70%]">{name}</span>
                                    <span className="font-bold text-gray-600 dark:text-gray-400 tabular-nums">{(value * 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                                    <div
                                      className="bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-500 h-3 rounded-full transition-all duration-700"
                                      style={{ width: `${widthPct}%` }}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Confusion Matrix - colored grid */}
                      {cm.matrix && Array.isArray(cm.matrix) && cm.matrix.length > 0 && (
                        <div className="bg-white dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                          <h4 className="font-bold text-sm flex items-center gap-2 mb-4 text-gray-900 dark:text-white">
                            <BarChart3 className="w-4 h-4 text-purple-600" /> Confusion Matrix
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="text-xs">
                              <thead>
                                <tr>
                                  <th className="p-2 text-left text-gray-500 dark:text-gray-400 font-semibold">Actual \ Predicted</th>
                                  {(cm.labels || []).map((l: string) => <th key={l} className="p-2 text-center font-semibold text-gray-700 dark:text-gray-300">{l}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {cm.matrix.map((row: number[], ri: number) => {
                                  const mx = Math.max(...cm.matrix.flat(), 1)
                                  return (
                                    <tr key={ri}>
                                      <td className="p-2 font-semibold text-gray-700 dark:text-gray-300">{(cm.labels || [])[ri] || `Class ${ri}`}</td>
                                      {(Array.isArray(row) ? row : []).map((val: number, ci: number) => {
                                        const intensity = val / mx
                                        const isDiag = ri === ci
                                        return (
                                          <td key={ci} className="p-1">
                                            <div
                                              className="rounded-lg px-3 py-2.5 text-center font-mono font-bold text-xs"
                                              style={isDiag
                                                ? { backgroundColor: `rgba(22,163,74,${0.15 + intensity * 0.85})`, color: intensity > 0.4 ? 'white' : '#166534' }
                                                : val > 0 ? { backgroundColor: `rgba(239,68,68,${Math.min(intensity * 0.5, 0.3)})`, color: '#b91c1c' } : {}
                                              }
                                            >{val}</div>
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Confidence Distribution - simple bar chart */}
                      {Array.isArray(cd) && cd.length > 0 && (
                        <div className="bg-white dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                          <h4 className="font-bold text-sm flex items-center gap-2 mb-4 text-gray-900 dark:text-white">
                            <Gauge className="w-4 h-4 text-purple-600" /> Confidence Distribution
                          </h4>
                          <div className="flex items-end gap-1.5 h-36 px-2">
                            {cd.map((bucket: any, bi: number) => {
                              const label = bucket.l || bucket.label || ''
                              const count = bucket.c || bucket.count || 0
                              const maxC = Math.max(...cd.map((b: any) => b.c || b.count || 0), 1)
                              const h = (count / maxC) * 100
                              const isLow = label.includes('<50') || label.includes('0-')
                              return (
                                <div key={bi} className="flex-1 flex flex-col items-center group">
                                  <span className="text-[9px] text-gray-500 dark:text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity font-mono">{count}</span>
                                  <div
                                    className={`w-full rounded-t-lg transition-all duration-500 ${isLow ? 'bg-gradient-to-t from-red-500 to-red-400' : 'bg-gradient-to-t from-purple-600 to-indigo-500'}`}
                                    style={{ height: `${h}%`, minHeight: '4px' }}
                                  />
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex gap-1.5 mt-1 px-2">
                            {cd.map((bucket: any, bi: number) => (
                              <div key={bi} className="flex-1 text-center text-[8px] text-gray-400 dark:text-gray-500 truncate">
                                {bucket.l || bucket.label || ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        )}
      </div>

      {/*
          SECTION 5 — DRIFT MONITORING PANEL
           */}
      <div className="bg-gradient-to-br from-white via-gray-50 to-white dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
        <button
          onClick={() => setDriftPanelExpanded(p => !p)}
          className="w-full bg-gradient-to-r from-amber-700 via-orange-700 to-red-700 dark:from-amber-800 dark:via-orange-800 dark:to-red-800 px-6 py-4 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Model Drift Monitoring</h3>
                <p className="text-xs text-amber-200">Detect performance degradation and schedule retraining</p>
              </div>
            </div>
            {driftPanelExpanded ? <ChevronUp className="w-4 h-4 text-white/60" /> : <ChevronDown className="w-4 h-4 text-white/60" />}
          </div>
        </button>

        {driftPanelExpanded && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600" /> Per-Model Drift Status
              </h4>
              <button onClick={fetchDriftData} disabled={driftLoading} className="text-xs px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-200 transition-colors font-semibold flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${driftLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {driftLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : driftEntries.length === 0 ? (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-6 text-center">
                <ShieldCheck className="w-10 h-10 text-green-500 mx-auto mb-2" />
                <p className="font-semibold text-green-700 dark:text-green-300">All models stable - no drift detected</p>
              </div>
            ) : (
              <div className="space-y-3">
                {driftEntries.map((d: any, di: number) => {
                  const hasDrift = d.driftDetected || d.drift_detected
                  const magnitude = d.driftMagnitude || d.drift_magnitude || 0
                  const magPct = (magnitude * 100).toFixed(1)
                  const baseVal = d.baselineValue || d.baseline_value || 0
                  const curVal = d.currentValue || d.current_value || 0
                  const driftColor = !hasDrift ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20'
                    : magnitude > 0.1 ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20'
                    : magnitude > 0.05 ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20'
                    : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20'
                  const statusColor = !hasDrift ? 'text-green-600' : magnitude > 0.1 ? 'text-red-600' : magnitude > 0.05 ? 'text-amber-600' : 'text-green-600'
                  const statusLabel = !hasDrift ? 'Stable' : magnitude > 0.1 ? 'Significant drift' : magnitude > 0.05 ? 'Minor drift' : 'Minimal'

                  return (
                    <div key={di} className={`rounded-xl p-4 border-2 transition-all ${driftColor}`}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          {hasDrift ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <ShieldCheck className="w-5 h-5 text-green-600" />}
                          <div>
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{d.modelName || d.model_name || 'Model'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{d.metricName || d.metric_name || 'Accuracy'} - v{d.modelVersion || d.model_version || '?'}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold ${statusColor}`}>{statusLabel}</span>
                          {magnitude > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">Drift: {magPct}%</p>}
                        </div>
                      </div>
                      {(baseVal || curVal) ? (
                        <div className="flex items-center gap-4 mt-3">
                          <div className="flex-1">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-500 dark:text-gray-400">Baseline</span>
                              <span className="font-bold">{pct(baseVal)}</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${baseVal * 100}%` }} />
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-500 dark:text-gray-400">Current</span>
                              <span className={`font-bold ${hasDrift ? 'text-red-600' : ''}`}>{pct(curVal)}</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div className={`h-2 rounded-full transition-all ${hasDrift ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${curVal * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {hasDrift && (
                        <div className="mt-3">
                          <button
                            onClick={() => {
                              pushNotification(`Retraining scheduled for ${d.modelName || d.model_name || 'model'}. This may take several minutes.`, 'info')
                            }}
                            className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg transition-all shadow-sm"
                          >
                            <RotateCcw className="w-3 h-3 inline mr-1" /> Schedule Retraining
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/*
          SECTION 6 — ENHANCED AUDIT TRAIL
           */}
      <div className="bg-gradient-to-br from-white via-gray-50 to-white dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
        <button
          onClick={() => setAuditExpanded(p => !p)}
          className="w-full bg-gradient-to-r from-slate-700 via-gray-700 to-zinc-700 dark:from-slate-800 dark:via-gray-800 dark:to-zinc-800 px-6 py-4 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <Eye className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Enhanced Audit Trail</h3>
                <p className="text-xs text-gray-300">Filter, search, and export AI execution history</p>
              </div>
            </div>
            {auditExpanded ? <ChevronUp className="w-4 h-4 text-white/60" /> : <ChevronDown className="w-4 h-4 text-white/60" />}
          </div>
        </button>

        {auditExpanded && (
          <div className="p-5 space-y-4">
            {/* Aggregate stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Executions', value: String(auditStats.total), icon: Zap, color: 'text-blue-600 dark:text-blue-400' },
                { label: 'Avg Latency', value: `${auditStats.avgLatency}ms`, icon: Clock, color: 'text-purple-600 dark:text-purple-400' },
                { label: 'Errors', value: String(auditStats.errorCount), icon: AlertTriangle, color: auditStats.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400' },
                { label: 'Error Rate', value: `${auditStats.errorRate}%`, icon: Activity, color: parseFloat(auditStats.errorRate) > 5 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400' },
              ].map((s, si) => (
                <div key={si} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-1">
                    <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">{s.label}</span>
                  </div>
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                {(['All', 'Governance', 'Analysis', 'Classification'] as const).map(f => (
                  <button key={f} onClick={() => setAuditFilter(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      auditFilter === f
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input type="date" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg" />
                <span className="text-gray-400">to</span>
                <input type="date" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg" />
              </div>
              <button onClick={exportAuditCSV} disabled={filteredAuditEntries.length === 0}
                className="ml-auto px-3 py-1.5 text-xs font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                <Download className="w-3 h-3" /> Export CSV
              </button>
            </div>

            {/* Audit entries table */}
            {auditLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : filteredAuditEntries.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <Eye className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No audit entries match filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Model</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Action</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Target</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Status</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Latency</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredAuditEntries.slice(0, 50).map((entry: any, ei: number) => {
                      const ts = entry.createdAt || entry.created_at || ''
                      const fmtTs = ts ? (() => { try { const d = new Date(ts); return isNaN(d.getTime()) ? ts : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return ts } })() : '-'
                      return (
                        <tr key={entry.id || ei} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                          <td className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-300">{entry.modelName || entry.model_name || '-'}</td>
                          <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 truncate max-w-[180px]">{entry.action || entry.inputSummary || entry.input_summary || '-'}</td>
                          <td className="px-3 py-2.5">
                            <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400 text-[10px]">
                              {entry.targetType || entry.target_type || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (entry.status || '').toLowerCase() === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                              : (entry.status || '').toLowerCase() === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                            }`}>{entry.status || '-'}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-gray-600 dark:text-gray-400">{entry.executionTimeMs || entry.execution_time_ms || '-'}ms</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{fmtTs}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filteredAuditEntries.length > 50 && (
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 text-center border-t border-gray-200 dark:border-gray-700">
                    Showing 50 of {filteredAuditEntries.length} entries. Export CSV for full data.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/*
          SECTION 7 — AI TRANSPARENCY DASHBOARD (existing component)
           */}
      <AITransparencyDashboard />
    </div>
  )
}
