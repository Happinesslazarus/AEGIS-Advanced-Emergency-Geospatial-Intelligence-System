/**
 * Module: AITransparencyConsole.tsx
 *
 * AI transparency console (shows AI decision explanations and confidence scores).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Brain, Zap, Clock, Activity, TrendingUp, AlertTriangle, CheckCircle, Sparkles,
  Waves, Map, Package, Database, Radio,
  ArrowRight, ChevronDown, ChevronUp, Gauge, GitBranch,
  Keyboard, X, Eye, Target, BarChart3, Cpu,
  Crown, ShieldCheck, RotateCcw, Loader2,
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
  apiRetrainModel,
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
  onRefresh?: () => void
}

// HELPERS
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/** Strip technical region suffixes from area names: "River Dee (aberdeen_scotland_uk)" → "River Dee" */
const cleanAreaName = (area: string): string => {
  if (!area) return area
  return area.replace(/\s*\([a-z0-9_]+\)\s*$/i, '').trim()
}

/** Well-known region display names */
const REGION_DISPLAY: Record<string, string> = {
  uk: 'United Kingdom', scotland: 'Scotland', england: 'England', wales: 'Wales',
  northamerica: 'North America', europe: 'Europe', asia: 'Asia', africa: 'Africa',
  southamerica: 'South America', oceania: 'Oceania', global: 'Global',
}

/** Known abbreviations that should be ALL CAPS */
const KNOWN_ACRONYMS = new Set([
  'ai', 'ml', 'dem', 'sepa', 'api', 'id', 'url', 'gps', 'nlp', 'aws', 'ui', 'ux',
  'qgis', 'lidar', 'ndvi', 'dhm', 'uk', 'eu', 'un', 'ngo', 'sar', 'eo', 'csv',
  'pdf', 'iot', 'gpu', 'cpu', 'ram', 'sql', '3d',
])

/** Convert snake_case / kebab-case to Title Case, uppercasing known acronyms */
const humanizeName = (name: string): string => {
  if (!name) return name
  const normalized = name.toLowerCase().replace(/[_\-\/]/g, ' ').trim()
  const noSpaces = normalized.replace(/\s/g, '')
  if (REGION_DISPLAY[noSpaces]) return REGION_DISPLAY[noSpaces]
  return normalized.split(/\s+/).filter(Boolean).map(word =>
    KNOWN_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}

/** Fix corrupted unicode characters in pattern text */
const fixEncoding = (text: string): string => {
  if (!text) return text
  return text
    .replace(/\?/g, '→')         // corrupted right arrow
    .replace(/â†'/g, '→')
    .replace(/Â/g, '')
    .replace(/â€"/g, '—')
    .replace(/â€"/g, '–')
}

/** Derive human-readable risk status from severity or probability */
const deriveRiskStatus = (severity: string | undefined, probPct: number): string => {
  const sev = (severity || '').toLowerCase()
  if (sev === 'critical') return 'Immediate action needed'
  if (sev === 'high') return 'Elevated risk'
  if (sev === 'medium') return 'Monitor conditions'
  if (sev === 'low') return 'No immediate risk'
  // Fallback: derive from probability
  if (probPct >= 80) return 'Immediate action needed'
  if (probPct >= 60) return 'Elevated risk'
  if (probPct >= 35) return 'Monitor conditions'
  return 'No immediate risk'
}

/** Get severity color class */
const severityColor = (severity: string | undefined, probPct: number): string => {
  const sev = (severity || '').toLowerCase()
  if (sev === 'critical' || probPct >= 80) return 'bg-red-600 text-white'
  if (sev === 'high' || probPct >= 60) return 'bg-orange-500 text-white'
  if (sev === 'medium' || probPct >= 35) return 'bg-amber-500 text-white'
  return 'bg-green-600 text-white'
}

/** Get a human-readable risk label from severity */
const severityLabel = (severity: string | undefined, probPct: number): string => {
  const sev = (severity || '').toLowerCase()
  if (sev === 'critical' || probPct >= 80) return 'Critical'
  if (sev === 'high' || probPct >= 60) return 'High'
  if (sev === 'medium' || probPct >= 35) return 'Moderate'
  return 'Low'
}

/** Check if a pattern string is actually useful (not just a risk level word) */
const isRealPattern = (pattern: string): boolean => {
  const normalized = pattern.trim().toLowerCase()
  return !['low', 'medium', 'high', 'critical', 'unknown', 'n/a', 'on-demand model inference'].includes(normalized)
}

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
  const [consoleTab, setConsoleTab] = useState<'feed' | 'analysis' | 'models' | 'drift' | 'audit'>('feed')
  const [showKeyboard, setShowKeyboard] = useState(false)

  // Model lifecycle state
  const [selectedHazard, setSelectedHazard] = useState('flood')
  const defaultRegionId = activeLocation === 'scotland' ? 'uk-default' : `${activeLocation}-default`
  const [selectedRegion, setSelectedRegion] = useState(defaultRegionId)
  const [versions, setVersions] = useState<any[]>([])
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [lifecycleAction, setLifecycleAction] = useState<string | null>(null)
  const [modelHealth, setModelHealth] = useState<any | null>(null)
  const [driftSnapshot, setDriftSnapshot] = useState<any | null>(null)
  const [rollbackHint, setRollbackHint] = useState<any | null>(null)

  // Interactive Model Explorer state
  const [explorerModels, setExplorerModels] = useState<any[]>([])
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [selectedExplorerModel, setSelectedExplorerModel] = useState<any | null>(null)

  // Drift Monitoring Panel state
  const [driftEntries, setDriftEntries] = useState<any[]>([])
  const [driftLoading, setDriftLoading] = useState(false)
  const [retrainingDrift, setRetrainingDrift] = useState<string | null>(null)

  // Enhanced Audit Trail state
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

  // Sync region when activeLocation changes
  useEffect(() => {
    setSelectedRegion(activeLocation === 'scotland' ? 'uk-default' : `${activeLocation}-default`)
  }, [activeLocation])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); props.onRefresh?.() }
      else if (e.key === 'p' || e.key === 'P') { if (!predictionRunning) runPrediction?.() }
      else if (e.key === '1') { setConsoleTab('feed') }
      else if (e.key === '2') { setConsoleTab('analysis') }
      else if (e.key === '?') { setShowKeyboard(p => !p) }
      else if (e.key === 'Escape') { setShowKeyboard(false) }
      else if (e.key === 'm' || e.key === 'M') { setConsoleTab('models') }
      else if (e.key === 'd' || e.key === 'D') { setConsoleTab('drift') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [predictionRunning])

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
    if (consoleTab === 'models') fetchVersions()
  }, [consoleTab, fetchVersions])

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

  useEffect(() => { if (consoleTab === 'models') fetchExplorerModels() }, [consoleTab, fetchExplorerModels])

  // Fetch drift data
  const fetchDriftData = useCallback(async () => {
    setDriftLoading(true)
    try {
      const data = await apiGetGovernanceDrift()
      setDriftEntries(Array.isArray(data) ? data : data?.drift ? [data] : [])
    } catch { setDriftEntries([]) }
    finally { setDriftLoading(false) }
  }, [])

  useEffect(() => { if (consoleTab === 'drift') fetchDriftData() }, [consoleTab, fetchDriftData])

  // Fetch audit data
  const fetchAuditData = useCallback(async () => {
    setAuditLoading(true)
    try {
      const data = await apiGetAIAuditLog(100, 0)
      setAuditEntries(Array.isArray(data) ? data : (data as any)?.entries || [])
    } catch { setAuditEntries([]) }
    finally { setAuditLoading(false) }
  }, [])

  useEffect(() => { if (consoleTab === 'audit') fetchAuditData() }, [consoleTab, fetchAuditData])

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
      pushNotification(`${t('ai.promoted', lang)} ${humanizeName(selectedHazard)} v${version}`, 'success')
      await fetchVersions()
    } catch (err: any) {
      pushNotification(err?.message || t('ai.promotionFailed', lang), 'error')
    } finally {
      setLifecycleAction(null)
    }
  }

  const handleDemote = async () => {
    setLifecycleAction('demote')
    try {
      await apiDemoteModel(selectedHazard, selectedRegion)
      pushNotification(`${t('ai.overrideRemoved', lang)} — ${humanizeName(selectedHazard)}`, 'success')
      await fetchVersions()
    } catch (err: any) {
      pushNotification(err?.message || t('ai.demotionFailed', lang), 'error')
    } finally {
      setLifecycleAction(null)
    }
  }

  const handleValidate = async (version: string) => {
    setLifecycleAction(`validate-${version}`)
    try {
      const result: any = await apiValidateModel(selectedHazard, selectedRegion, version)
      if (result.valid) {
        pushNotification(`${version}: ${t('ai.integrityOk', lang)}`, 'success')
      } else {
        pushNotification(`${version}: ${result.issues?.join(', ') || t('ai.validationIssues', lang)}`, 'warning')
      }
    } catch (err: any) {
      pushNotification(err?.message || t('ai.validationFailed', lang), 'error')
    } finally {
      setLifecycleAction(null)
    }
  }

  //  Filter predictions to those matching the current location's configured areas
  //  Falls back to all predictions if no match (e.g., on initial load before options are set)
  const localPredictions = useMemo(() => {
    if (!predictions.length) return predictions
    if (!predictionAreaOptions.length) return predictions
    const validAreas = new Set(predictionAreaOptions.map(o => (o.area || '').toLowerCase().trim()))
    const filtered = predictions.filter((p: any) => validAreas.has((p.area || '').toLowerCase().trim()))
    return filtered.length > 0 ? filtered : predictions
  }, [predictions, predictionAreaOptions])

  //  Prediction computations (moved from inline)
  const predMetrics = useMemo(() => {
    const highRisk = localPredictions.filter((p: any) => {
      const prob = typeof p.probability === 'number' ? p.probability : parseFloat(String(p.probability)) || 0
      return (prob <= 1 ? prob : prob / 100) > 0.5
    }).length
    const avgConf = localPredictions.length > 0
      ? Math.round(localPredictions.reduce((s: number, p: any) => {
          const c = typeof p.confidence === 'number' ? p.confidence : parseFloat(String(p.confidence)) || 0
          return s + (c <= 1 ? c * 100 : c)
        }, 0) / localPredictions.length)
      : 0
    const dataSources = [...new Set(localPredictions.flatMap((p: any) => Array.isArray(p.data_sources) ? p.data_sources : []))].length || 0
    return { highRisk, avgConf, dataSources }
  }, [localPredictions])

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

      {/* Unified AI Command Console — dark header + KPI strip + 5 horizontal tabs */}
      <div className="rounded-2xl overflow-hidden shadow-2xl ring-1 ring-slate-800/60">

        {/* HEADER */}
        <div className="bg-gradient-to-br from-slate-950 via-gray-900 to-slate-900 px-6 pt-5 pb-0">

          {/* Title row */}
          <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white tracking-tight">{t('ai.commandGovernance', lang)}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${predictionRunning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-pulse'}`} />
                  <span className="text-xs text-gray-400">{loc.name || t('common.global', lang)}</span>
                  <span className="text-gray-500">·</span>
                  <span className="text-xs font-mono text-gray-400">{zuluTime}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {localPredictions.length > 0 && (
                <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg">
                  {localPredictions.length} {t(localPredictions.length === 1 ? 'ai.activePrediction' : 'ai.activePredictionPlural', lang)}
                </span>
              )}
              <button
                onClick={() => setShowKeyboard(p => !p)}
                title={t('common.shortcuts', lang)}
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors ring-1 ring-gray-700"
              >
                <Keyboard className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
            {[
              { label: t('ai.activePredictions', lang), value: localPredictions.length, icon: Zap, color: localPredictions.length > 0 ? 'text-emerald-400' : 'text-gray-500', bg: 'bg-emerald-500/5 border-emerald-500/10' },
              { label: t('ai.highRiskAreas', lang), value: predMetrics.highRisk, icon: AlertTriangle, color: predMetrics.highRisk > 0 ? 'text-red-400' : 'text-gray-500', bg: 'bg-red-500/5 border-red-500/10' },
              { label: t('ai.avgConfidence', lang), value: predMetrics.avgConf > 0 ? `${predMetrics.avgConf}%` : '—', icon: Gauge, color: predMetrics.avgConf >= 70 ? 'text-emerald-400' : 'text-amber-400', bg: 'bg-indigo-500/5 border-indigo-500/10' },
              { label: t('ai.dataSources', lang), value: predMetrics.dataSources, icon: Database, color: 'text-cyan-400', bg: 'bg-cyan-500/5 border-cyan-500/10' },
              { label: t('ai.heatmapPoints', lang), value: heatmapData.length, icon: Map, color: 'text-purple-400', bg: 'bg-purple-500/5 border-purple-500/10' },
              { label: t('ai.engineStatus', lang), value: predictionRunning ? t('common.processing', lang) : t('common.ready', lang), icon: Cpu, color: predictionRunning ? 'text-amber-400' : 'text-emerald-400', bg: 'bg-gray-500/5 border-gray-500/10' },
            ].map((kpi, i) => (
              <div key={i} className={`${kpi.bg} rounded-lg px-3 py-2.5 border flex items-center gap-2.5`}>
                <kpi.icon className={`w-4 h-4 ${kpi.color} flex-shrink-0`} />
                <div className="min-w-0">
                  <p className={`text-sm font-bold tabular-nums ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide truncate">{kpi.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Tab bar */}
          <div className="flex items-center overflow-x-auto scrollbar-none -mb-px">
            {([
              { id: 'feed' as const,     label: t('ai.livePredictionFeed', lang), icon: Radio },
              { id: 'analysis' as const, label: t('ai.runOnDemandAnalysis', lang), icon: Zap },
              { id: 'models' as const,   label: t('ai.models', lang),             icon: Brain },
              { id: 'drift' as const,    label: t('ai.driftHealth', lang),        icon: Activity },
              { id: 'audit' as const,    label: t('ai.enhancedAuditTrail', lang), icon: Eye },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setConsoleTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
                  consoleTab === tab.id
                    ? 'border-indigo-400 text-indigo-300 bg-white/5'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* TAB CONTENT */}
        <div className="bg-white dark:bg-gray-900 border-t border-slate-800/50 p-5 space-y-5 min-h-[320px]">

          {/* TAB: LIVE FEED */}
          {consoleTab === 'feed' && (
            <div className="space-y-5">
              {/* Intelligence Summary Banner */}
              <div className={`rounded-xl p-4 border flex items-start gap-3 ${localPredictions.length === 0 ? 'bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700' : predMetrics.highRisk > 0 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'}`}>
                <Sparkles className={`w-4 h-4 flex-shrink-0 mt-0.5 ${localPredictions.length === 0 ? 'text-slate-500 dark:text-slate-400' : predMetrics.highRisk > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`} />
                <div>
                  <p className={`text-sm font-bold ${localPredictions.length === 0 ? 'text-slate-700 dark:text-slate-300' : predMetrics.highRisk > 0 ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                    {localPredictions.length === 0
                      ? 'AI engine ready — no active predictions at this location'
                      : predMetrics.highRisk > 0
                        ? `${predMetrics.highRisk} area${predMetrics.highRisk > 1 ? 's' : ''} at elevated flood risk — action may be required`
                        : `${localPredictions.length} area${localPredictions.length > 1 ? 's' : ''} monitored — all within acceptable risk thresholds`}
                  </p>
                  <p className={`text-xs mt-0.5 ${localPredictions.length === 0 ? 'text-slate-500 dark:text-slate-400' : predMetrics.highRisk > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {localPredictions.length > 0
                      ? `Average AI confidence: ${predMetrics.avgConf}% · ${predMetrics.dataSources} data source${predMetrics.dataSources !== 1 ? 's' : ''} active · ${heatmapData.length} heatmap point${heatmapData.length !== 1 ? 's' : ''}`
                      : 'Switch to the Analysis tab to run an on-demand flood risk prediction for any area'}
                  </p>
                </div>
              </div>

              {/* Pipeline flow */}
              <div>
                <h4 className="text-xs font-bold text-gray-400 dark:text-gray-400 uppercase tracking-wider mb-3">{t('ai.pipeline', lang)}</h4>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 flex-wrap sm:flex-nowrap">
                  {[
                    { label: t('ai.ingest', lang),   desc: t('ai.dataCollection', lang),    icon: Database, color: 'text-cyan-700 dark:text-cyan-400',   bg: 'bg-cyan-50   dark:bg-cyan-900/20   border-cyan-200   dark:border-cyan-800' },
                    { label: t('ai.classify', lang),  desc: t('ai.aiClassification', lang),  icon: Brain,    color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800' },
                    { label: t('ai.predict', lang),   desc: t('ai.riskScoring', lang),       icon: Target,   color: 'text-amber-700 dark:text-amber-400',   bg: 'bg-amber-50  dark:bg-amber-900/20  border-amber-200  dark:border-amber-800' },
                    { label: t('ai.verify', lang),    desc: t('ai.humanReview', lang),       icon: Eye,      color: 'text-blue-700 dark:text-blue-400',     bg: 'bg-blue-50   dark:bg-blue-900/20   border-blue-200   dark:border-blue-800' },
                    { label: t('ai.alertStep', lang), desc: t('ai.notification', lang),      icon: Radio,    color: 'text-red-700 dark:text-red-400',       bg: 'bg-red-50    dark:bg-red-900/20    border-red-200    dark:border-red-800' },
                  ].map((stage, i, arr) => (
                    <React.Fragment key={stage.label}>
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${stage.bg} flex-shrink-0`}>
                        <stage.icon className={`w-3.5 h-3.5 ${stage.color}`} />
                        <div>
                          <p className={`text-xs font-bold ${stage.color}`}>{stage.label}</p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">{stage.desc}</p>
                        </div>
                      </div>
                      {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300 dark:text-gray-400 flex-shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Live predictions */}
              <div>
                <h4 className="font-bold text-sm mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
                  <TrendingUp className="w-4 h-4 text-indigo-600" /> {t('ai.livePredictionFeed', lang)}
                </h4>
                {localPredictions.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Waves className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('ai.noActivePredictions', lang)}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {localPredictions.map((pred: any, i: number) => {
                      const prob = typeof pred.probability === 'number' ? pred.probability : parseFloat(String(pred.probability)) || 0
                      const conf = typeof pred.confidence === 'number' ? pred.confidence : parseFloat(String(pred.confidence)) || 0
                      const confDisplay = conf <= 1 ? Math.round(conf * 100) : Math.round(conf)
                      const probPct = prob <= 1 ? Math.round(prob * 100) : Math.round(prob)
                      const riskBorder = probPct > 70 ? 'border-red-300 dark:border-red-700' : probPct > 40 ? 'border-amber-300 dark:border-amber-700' : 'border-blue-200 dark:border-blue-800'
                      const riskBg    = probPct > 70 ? 'bg-red-50/60 dark:bg-red-950/10' : probPct > 40 ? 'bg-amber-50/60 dark:bg-amber-950/10' : 'bg-blue-50/40 dark:bg-blue-950/5'
                      const rawTtf = (typeof pred.time_to_flood === 'object' && pred.time_to_flood !== null) ? JSON.stringify(pred.time_to_flood) : String(pred.time_to_flood || '')
                      const ttf = (!rawTtf || rawTtf === 'Unknown' || rawTtf === 'unknown') ? deriveRiskStatus(pred.severity, probPct) : fixEncoding(rawTtf)
                      const rawPattern = (typeof pred.matched_pattern === 'object' && pred.matched_pattern !== null) ? JSON.stringify(pred.matched_pattern) : String(pred.matched_pattern || '')
                      const pattern = rawPattern && isRealPattern(rawPattern) ? fixEncoding(rawPattern) : ''
                      const displayArea = cleanAreaName(pred.area || '')
                      const riskLabel = severityLabel(pred.severity, probPct)
                      return (
                        <div key={pred.id || i} className={`border rounded-xl p-4 ${riskBorder} ${riskBg} transition-all hover:shadow-md`}>
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <h4 className="font-bold text-sm text-gray-900 dark:text-white">{displayArea}</h4>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold text-white ${probPct > 70 ? 'bg-red-600' : probPct > 40 ? 'bg-amber-500' : 'bg-blue-600'}`}>{probPct}%</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${severityColor(pred.severity, probPct)}`}>{riskLabel}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> {ttf}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">{t('ai.confShort', lang)} {confDisplay}%</span>
                              </div>
                              <div className="flex items-center gap-3 mb-2">
                                <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${probPct > 70 ? 'bg-red-500' : probPct > 40 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${probPct}%` }} />
                                </div>
                              </div>
                              <p className={`text-xs font-medium mb-2 ${probPct > 70 ? 'text-red-700 dark:text-red-300' : probPct > 40 ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}`}>
                                {probPct > 70 ? 'Immediate attention required — consider escalating to emergency services.' : probPct > 40 ? 'Elevated risk detected — prepare response and consider sending a pre-alert.' : 'Risk within acceptable range — continue monitoring.'}
                              </p>
                              {pattern && <p className="text-xs text-gray-600 dark:text-gray-400 mb-1"><span className="font-semibold">{t('ai.pattern', lang)}:</span> {pattern}</p>}
                              {(Array.isArray(pred.next_areas) && pred.next_areas.length > 0) && (
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                  <span className="font-semibold">{t('ai.nextAreas', lang)}:</span> {pred.next_areas.map((a: string) => cleanAreaName(a)).join(', ')}
                                </p>
                              )}
                              <div className="flex gap-1 flex-wrap">
                                {(Array.isArray(pred.data_sources) ? pred.data_sources : []).map((s: string, j: number) => (
                                  <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{humanizeName(String(s))}</span>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => askConfirm(
                                t('ai.preAlertConfirmTitle', lang),
                                `${t('ai.preAlertConfirmPrefix', lang)} ${cleanAreaName(pred.area)}? ${t('ai.preAlertConfirmSuffix', lang)}`,
                                'warning',
                                async () => {
                                  try {
                                    await apiSendPreAlert(pred.id, user?.id)
                                    setPredictions(p => p.map(x => x.id === pred.id ? { ...x, pre_alert_sent: true } : x))
                                    pushNotification(t('ai.preAlertSent', lang), 'success')
                                  } catch (err: any) {
                                    pushNotification(err?.message || t('ai.preAlertFailed', lang), 'error')
                                  }
                                }
                              )}
                              disabled={pred.pre_alert_sent}
                              className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                                pred.pre_alert_sent
                                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md'
                              }`}
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

              {/* Heatmap summary */}
              <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/10 rounded-xl p-4 border border-indigo-200 dark:border-indigo-800">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                    <Map className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900 dark:text-white">{t('ai.heatmapCoverage', lang)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {heatmapData.length} {t('ai.dataPoints', lang).toLowerCase()} · {t('common.updated', lang)}: {new Date().toLocaleString(lang || 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <span className="px-3 py-1.5 bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-200 text-xs font-bold rounded-full">
                  {heatmapData.length} {t('ai.pts', lang)}
                </span>
              </div>
            </div>
          )}

          {/* TAB: ON-DEMAND ANALYSIS */}
          {consoleTab === 'analysis' && (
            <div className="space-y-5">
              <div className="bg-gray-50 dark:bg-gray-800/30 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                <h4 className="font-bold text-sm mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-600" /> {t('ai.runOnDemandAnalysis', lang)}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('ai.targetArea', lang)}</label>
                    <select
                      className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      value={predictionArea}
                      onChange={e => setPredictionArea(e.target.value)}
                    >
                      {predictionAreaOptions.map(opt => <option key={opt.area} value={opt.area}>{cleanAreaName(opt.area)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('ai.model', lang)}</label>
                    <div className="px-3 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl font-mono text-gray-600 dark:text-gray-400">
                      {predictionResult?.model_version || t('ai.defaultModelVersion', lang)}
                    </div>
                  </div>
                  <div className="flex flex-col justify-end">
                    <button
                      onClick={runPrediction}
                      disabled={predictionRunning}
                      className={`w-full px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        predictionRunning
                          ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg'
                      }`}
                    >
                      <Package className="w-4 h-4" />
                      {predictionRunning ? `${t('common.analyzing', lang)}...` : t('ai.runAnalysis', lang)}
                    </button>
                  </div>
                </div>

                {predictionResult && (() => {
                  const resultProb = (Number(predictionResult.probability) || 0) <= 1 ? Math.round((Number(predictionResult.probability) || 0) * 100) : Math.round(Number(predictionResult.probability) || 0)
                  const resultConf = (Number(predictionResult.confidence) || 0) <= 1 ? Math.round((Number(predictionResult.confidence) || 0) * 100) : Math.round(Number(predictionResult.confidence) || 0)
                  const resultRisk = predictionResult.risk_level && predictionResult.risk_level.toLowerCase() !== 'unknown'
                    ? humanizeName(predictionResult.risk_level)
                    : severityLabel(undefined, resultProb)
                  return (
                    <div className="mt-5 space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {[
                          { label: t('common.risk', lang), value: resultRisk, icon: AlertTriangle, bg: 'bg-red-50 dark:bg-red-900/20', tc: 'text-red-700 dark:text-red-300' },
                          { label: t('ai.probability', lang), value: `${resultProb}%`, icon: TrendingUp, bg: 'bg-blue-50 dark:bg-blue-900/20', tc: 'text-blue-700 dark:text-blue-300' },
                          { label: t('ai.confidence', lang), value: `${resultConf}%`, icon: CheckCircle, bg: 'bg-green-50 dark:bg-green-900/20', tc: 'text-green-700 dark:text-green-300' },
                          { label: t('ai.peakTime', lang), value: predictionResult.predicted_peak_time ? new Date(predictionResult.predicted_peak_time).toLocaleString(lang || 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—', icon: Clock, bg: 'bg-purple-50 dark:bg-purple-900/20', tc: 'text-purple-700 dark:text-purple-300' },
                          { label: t('ai.radius', lang), value: `${(predictionResult.affected_radius_km || 0).toFixed?.(1) || predictionResult.affected_radius_km || 0} km`, icon: Waves, bg: 'bg-cyan-50 dark:bg-cyan-900/20', tc: 'text-cyan-700 dark:text-cyan-300' },
                        ].map((m, i) => {
                          const Icon = m.icon
                          return (
                            <div key={i} className={`${m.bg} rounded-xl p-3 border border-gray-200 dark:border-gray-700`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">{m.label}</span>
                                <Icon className="w-3.5 h-3.5 opacity-40" />
                              </div>
                              <p className={`font-bold text-sm ${m.tc}`}>{m.value}</p>
                            </div>
                          )
                        })}
                      </div>
                      {predictionResult.contributing_factors?.length > 0 && (
                        <div className="bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                          <h5 className="font-bold text-xs mb-3 uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('ai.contributingFactors', lang)}</h5>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(predictionResult.contributing_factors || []).map((f: any, idx: number) => {
                              const imp = typeof f.importance === 'number' ? Math.round(f.importance * 100) : 0
                              const name = typeof f === 'string' ? humanizeName(f) : humanizeName(f.factor || f.name || t('common.unknown', lang))
                              const bc = imp >= 50 ? 'from-red-500 to-red-400' : imp >= 30 ? 'from-amber-400 to-amber-500' : 'from-blue-400 to-blue-500'
                              return (
                                <div key={idx}>
                                  <div className="flex justify-between text-xs mb-0.5">
                                    <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{name}</span>
                                    <span className="font-bold text-gray-600 dark:text-gray-400">{imp}%</span>
                                  </div>
                                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className={`h-full bg-gradient-to-r ${bc} rounded-full`} style={{ width: `${imp}%` }} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {/* Recommended Action */}
                      <div className={`rounded-xl p-4 border flex items-start gap-3 ${resultProb > 70 ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' : resultProb > 40 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'}`}>
                        <Sparkles className={`w-4 h-4 flex-shrink-0 mt-0.5 ${resultProb > 70 ? 'text-red-600 dark:text-red-400' : resultProb > 40 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`} />
                        <div>
                          <p className={`text-sm font-bold ${resultProb > 70 ? 'text-red-800 dark:text-red-200' : resultProb > 40 ? 'text-amber-800 dark:text-amber-200' : 'text-blue-800 dark:text-blue-200'}`}>
                            {resultProb > 70 ? 'Immediate Action Required' : resultProb > 40 ? 'Elevated Risk — Monitor Closely' : 'Risk Within Normal Range'}
                          </p>
                          <p className={`text-xs mt-0.5 ${resultProb > 70 ? 'text-red-700 dark:text-red-300' : resultProb > 40 ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
                            {resultProb > 70
                              ? `${predictionArea} is at high flood risk (${resultProb}% probability). Consider notifying emergency services and sending pre-alerts to at-risk residents.`
                              : resultProb > 40
                                ? `${predictionArea} shows elevated flood probability. Prepare response teams and issue advance notice to local authorities.`
                                : `${predictionArea} is currently within acceptable risk parameters. Continue scheduled monitoring.`}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* TAB: MODELS (Explorer + Versions) */}
          {consoleTab === 'models' && (
            <div className="space-y-6">

              {/* Model Explorer */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
                    <Brain className="w-4 h-4 text-purple-600" /> {t('ai.interactiveModelExplorer', lang)}
                  </h4>
                  <button
                    onClick={fetchExplorerModels}
                    disabled={explorerLoading}
                    className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${explorerLoading ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
                  </button>
                </div>
                {explorerLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                ) : explorerModels.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Brain className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('ai.noModelsAvailable', lang)}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {explorerModels.map((model: any, mi: number) => {
                        const name = humanizeName(model.name || model.model_name || `Model ${mi + 1}`)
                        const isSelected = selectedExplorerModel && humanizeName(selectedExplorerModel.name || selectedExplorerModel.model_name || '') === name
                        return (
                          <button key={mi} onClick={() => setSelectedExplorerModel(model)}
                            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
                                : 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-purple-300 hover:text-purple-600'
                            }`}>
                            <Brain className="w-3.5 h-3.5" />{name}
                          </button>
                        )
                      })}
                    </div>

                    {selectedExplorerModel && (() => {
                      const m = selectedExplorerModel
                      const fi = m.fi || m.feature_importance || []
                      const cm = m.cm || m.confusion_matrix || { labels: [], matrix: [] }
                      const cd = m.cd || m.confidence_distribution || []
                      const accuracy  = parseFloat(m.accuracy) || 0
                      const precision = parseFloat(m.precision ?? m.precision_score) || 0
                      const recall    = parseFloat(m.recall) || 0
                      const f1        = parseFloat(m.f1 ?? m.f1_score) || 0
                      return (
                        <div className="mt-4 space-y-5">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                              { label: t('ai.accuracy', lang), value: accuracy },
                              { label: t('ai.precision', lang), value: precision },
                              { label: t('ai.recall', lang), value: recall },
                              { label: t('ai.f1Score', lang), value: f1 },
                            ].map((metric, mi2) => (
                              <div key={mi2} className={`rounded-xl p-4 border-2 ${
                                metric.value >= 0.85 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                                  : metric.value >= 0.7  ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                                  : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                              }`}>
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{metric.label}</span>
                                <p className={`text-2xl font-bold mt-1 ${
                                  metric.value >= 0.9 ? 'text-emerald-600 dark:text-emerald-400'
                                  : metric.value >= 0.8 ? 'text-blue-600 dark:text-blue-400'
                                  : metric.value >= 0.7 ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-red-600 dark:text-red-400'
                                }`}>{(metric.value * 100).toFixed(1)}%</p>
                              </div>
                            ))}
                          </div>

                          {Array.isArray(fi) && fi.length > 0 && (
                            <div className="bg-white dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                              <h4 className="font-bold text-sm flex items-center gap-2 mb-4 text-gray-900 dark:text-white">
                                <Activity className="w-4 h-4 text-purple-600" /> {t('ai.featureImportance', lang)}
                              </h4>
                              <div className="space-y-2.5">
                                {fi.slice(0, 12).map((f: any, fIdx: number) => {
                                  const name = humanizeName(f.n || f.name || f.feature || `Feature ${fIdx}`)
                                  const value = f.v || f.value || f.importance || 0
                                  const widthPct = Math.min(value * 100, 100)
                                  return (
                                    <div key={fIdx}>
                                      <div className="flex justify-between text-xs mb-0.5">
                                        <span className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[70%]">{name}</span>
                                        <span className="font-bold text-gray-500 dark:text-gray-400 tabular-nums">{(value * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                        <div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2.5 rounded-full transition-all duration-700" style={{ width: `${widthPct}%` }} />
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {cm.matrix && Array.isArray(cm.matrix) && cm.matrix.length > 0 && (
                            <div className="bg-white dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                              <h4 className="font-bold text-sm flex items-center gap-2 mb-4 text-gray-900 dark:text-white">
                                <BarChart3 className="w-4 h-4 text-purple-600" /> {t('ai.confusionMatrix', lang)}
                              </h4>
                              <div className="overflow-x-auto">
                                <table className="text-xs">
                                  <thead>
                                    <tr>
                                      <th className="p-2 text-left text-gray-500 dark:text-gray-400 font-semibold">{t('ai.actualVsPredicted', lang)}</th>
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

                          {Array.isArray(cd) && cd.length > 0 && (
                            <div className="bg-white dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                              <h4 className="font-bold text-sm flex items-center gap-2 mb-4 text-gray-900 dark:text-white">
                                <Gauge className="w-4 h-4 text-purple-600" /> {t('ai.confidenceDistribution', lang)}
                              </h4>
                              <div className="flex items-end gap-1.5 h-36 px-2">
                                {cd.map((bucket: any, bi: number) => {
                                  const count = bucket.c || bucket.count || 0
                                  const maxC = Math.max(...cd.map((b: any) => b.c || b.count || 0), 1)
                                  const h = (count / maxC) * 100
                                  const isLow = (bucket.l || bucket.label || '').includes('<50') || (bucket.l || bucket.label || '').includes('0-')
                                  return (
                                    <div key={bi} className="flex-1 flex flex-col items-center group">
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity font-mono">{count}</span>
                                      <div
                                        className={`w-full rounded-t-lg transition-all duration-500 ${isLow ? 'bg-red-400' : 'bg-gradient-to-t from-purple-600 to-indigo-400'}`}
                                        style={{ height: `${h}%`, minHeight: '4px' }}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                              <div className="flex gap-1.5 mt-1 px-2">
                                {cd.map((bucket: any, bi: number) => (
                                  <div key={bi} className="flex-1 text-center text-[10px] text-gray-400 dark:text-gray-400 truncate">{bucket.l || bucket.label || ''}</div>
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

              <div className="border-t border-gray-200 dark:border-gray-700" />

              {/* Version Management */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
                    <GitBranch className="w-4 h-4 text-emerald-600" /> {t('ai.modelVersionManagement', lang)}
                  </h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t('ai.hazardType', lang)}</label>
                    <select
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl"
                      value={selectedHazard}
                      onChange={e => setSelectedHazard(e.target.value)}
                    >
                      {HAZARD_OPTIONS.map(h => <option key={h} value={h}>{humanizeName(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t('ai.region', lang)}</label>
                    <select
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl"
                      value={selectedRegion}
                      onChange={e => setSelectedRegion(e.target.value)}
                    >
                      {(() => {
                        const regionSet = new Set<string>()
                        predictionAreaOptions.forEach(opt => regionSet.add(opt.regionId))
                        regionSet.add(defaultRegionId)
                        return [...regionSet].sort().map(r => (
                          <option key={r} value={r}>{humanizeName(r.replace(/-default$/, ''))}</option>
                        ))
                      })()}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      onClick={fetchVersions}
                      disabled={versionsLoading}
                      className="flex-1 px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {versionsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {t('common.refresh', lang)}
                    </button>
                    <button
                      onClick={() => askConfirm(t('ai.removeOverride', lang), t('ai.revertAutoSelection', lang), 'warning', handleDemote)}
                      disabled={lifecycleAction === 'demote'}
                      className="p-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {currentKey && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl mb-3">
                    <Crown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300">{t('ai.activeLabel', lang)} {currentKey}</span>
                  </div>
                )}

                {(modelHealth || driftSnapshot || rollbackHint) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/20 p-4 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">{t('ai.modelHealth', lang)}</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><p className="text-gray-500 dark:text-gray-400">{t('ai.currentVersion', lang)}</p><p className="font-mono font-bold text-gray-900 dark:text-white">{modelHealth?.current_version || '—'}</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400">{t('ai.healthBadge', lang)}</p><p className="font-bold text-gray-900 dark:text-white">{String(modelHealth?.health_status || 'healthy').toUpperCase()}</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400">{t('ai.driftScore', lang)}</p><p className="font-bold text-gray-900 dark:text-white">{Number(modelHealth?.drift_score ?? driftSnapshot?.drift_score ?? 0).toFixed(3)}</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400">{t('ai.confidenceTrend', lang)}</p><p className="font-bold text-gray-900 dark:text-white">{Number(driftSnapshot?.avg_confidence ?? 0).toFixed(3)}</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400">{t('ai.fallbackCount', lang)}</p><p className="font-bold text-gray-900 dark:text-white">{modelHealth?.fallback_count ?? 0}</p></div>
                        <div><p className="text-gray-500 dark:text-gray-400">{t('ai.lastSnapshot', lang)}</p><p className="font-bold text-gray-900 dark:text-white">{modelHealth?.last_monitoring_snapshot ? new Date(modelHealth.last_monitoring_snapshot).toLocaleString() : '—'}</p></div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{t('ai.versionTrend', lang)}</h4>
                      <div className="space-y-1 text-xs">
                        <p><span className="text-gray-500 dark:text-gray-400">{t('ai.promotedVersion', lang)}</span> <span className="font-mono font-bold">{versions.find((v: any) => v.promotion_status === 'promoted')?.version || '—'}</span></p>
                        <p><span className="text-gray-500 dark:text-gray-400">{t('ai.currentLiveVersion', lang)}</span> <span className="font-mono font-bold">{modelHealth?.current_version || versions.find((v: any) => v.is_current)?.version || '—'}</span></p>
                        <p><span className="text-gray-500 dark:text-gray-400">{t('ai.previousCandidate', lang)}</span> <span className="font-mono font-bold">{versions.find((v: any) => !v.is_current)?.version || '—'}</span></p>
                        <p><span className="text-gray-500 dark:text-gray-400">{t('ai.rollbackRecommendation', lang)}</span> <span className="font-mono font-bold">{modelHealth?.recommended_rollback_version || rollbackHint?.recommended_rollback_version || '—'}</span></p>
                      </div>
                    </div>
                  </div>
                )}

                {versionsLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                ) : versions.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Package className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('ai.noVersionsFound', lang)}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((v: any) => {
                      const auc = v.performance_metrics?.roc_auc
                      const aucStr = typeof auc === 'number' ? `AUC ${auc.toFixed(4)}` : ''
                      return (
                        <div key={v.version} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                          v.is_current
                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                            : v.promotion_status === 'rejected'
                            ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/5'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/30'
                        }`}>
                          <div className="flex items-center gap-3 min-w-0">
                            {v.is_current && <Crown className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-sm font-mono font-bold text-gray-900 dark:text-white truncate">{v.version}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  v.promotion_status === 'promoted' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                  : v.promotion_status === 'rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                  : v.promotion_status === 'candidate' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                }`}>{humanizeName(v.promotion_status || 'pending')}</span>
                                {aucStr && <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">{aucStr}</span>}
                                <span className="text-[10px] text-gray-400 dark:text-gray-400">{v.trained_at?.split('T')[0]}</span>
                                {!v.has_model_file && <span className="text-[10px] text-red-500 font-bold">{t('ai.noFile', lang)}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleValidate(v.version)}
                              disabled={!!lifecycleAction}
                              title={t('ai.validateIntegrity', lang)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-30"
                            >
                              {lifecycleAction === `validate-${v.version}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                            </button>
                            {!v.is_current && (
                              <button
                                onClick={() => askConfirm(t('ai.promoteModel', lang), `${t('ai.setActiveModel', lang)} ${v.version} — ${humanizeName(selectedHazard)}?`, 'warning', () => handlePromote(v.version))}
                                disabled={!!lifecycleAction}
                                title={t('ai.promoteAsActive', lang)}
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
            </div>
          )}

          {/* TAB: DRIFT & HEALTH */}
          {consoleTab === 'drift' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
                  <Activity className="w-4 h-4 text-amber-600" /> {t('ai.modelDriftMonitoring', lang)}
                </h4>
                <button
                  onClick={fetchDriftData}
                  disabled={driftLoading}
                  className="text-xs px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-100 transition-colors font-semibold flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${driftLoading ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
                </button>
              </div>

              {/* Drift Intelligence Summary */}
              {!driftLoading && driftEntries.length > 0 && (() => {
                const driftCount = driftEntries.filter((d: any) => d.driftDetected || d.drift_detected).length
                const critCount = driftEntries.filter((d: any) => (d.driftMagnitude || d.drift_magnitude || 0) > 0.1 && (d.driftDetected || d.drift_detected)).length
                return (
                  <div className={`rounded-xl p-4 border flex items-start gap-3 ${driftCount === 0 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' : critCount > 0 ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'}`}>
                    {driftCount === 0
                      ? <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                      : <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${critCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />}
                    <div>
                      <p className={`text-sm font-bold ${driftCount === 0 ? 'text-emerald-800 dark:text-emerald-200' : critCount > 0 ? 'text-red-800 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'}`}>
                        {driftCount === 0
                          ? 'All models performing within baseline — no retraining required.'
                          : critCount > 0
                            ? `${critCount} model${critCount > 1 ? 's' : ''} require immediate retraining — significant accuracy degradation detected.`
                            : `${driftCount} model${driftCount > 1 ? 's' : ''} showing minor drift — schedule retraining soon to maintain accuracy.`}
                      </p>
                      <p className={`text-xs mt-0.5 ${driftCount === 0 ? 'text-emerald-700 dark:text-emerald-300' : critCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        {driftCount === 0
                          ? `${driftEntries.length} model${driftEntries.length > 1 ? 's' : ''} monitored — all metrics within acceptable variance`
                          : 'Model drift occurs when real-world data patterns diverge from training data — retraining restores accuracy.'}
                      </p>
                    </div>
                  </div>
                )
              })()}

              {driftLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : driftEntries.length === 0 ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-6 text-center">
                  <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                  <p className="font-semibold text-emerald-700 dark:text-emerald-300">{t('ai.allModelsStable', lang)}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {driftEntries.map((d: any, di: number) => {
                    const hasDrift = d.driftDetected || d.drift_detected
                    const magnitude = d.driftMagnitude || d.drift_magnitude || 0
                    const magPct = (magnitude * 100).toFixed(1)
                    const baseVal = d.baselineValue || d.baseline_value || 0
                    const curVal  = d.currentValue  || d.current_value  || 0
                    const driftColor = !hasDrift ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20'
                      : magnitude > 0.1 ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20'
                      : magnitude > 0.05 ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20'
                      : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20'
                    const statusColor = !hasDrift ? 'text-emerald-600' : magnitude > 0.1 ? 'text-red-600' : magnitude > 0.05 ? 'text-amber-600' : 'text-emerald-600'
                    const statusLabel = !hasDrift ? t('ai.stable', lang) : magnitude > 0.1 ? t('ai.significantDrift', lang) : magnitude > 0.05 ? t('ai.minorDrift', lang) : t('ai.minimal', lang)
                    return (
                      <div key={di} className={`rounded-xl p-4 border-2 transition-all ${driftColor}`}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-3">
                            {hasDrift ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <ShieldCheck className="w-5 h-5 text-emerald-600" />}
                            <div>
                              <p className="font-semibold text-sm text-gray-900 dark:text-white">{humanizeName(d.modelName || d.model_name || t('ai.model', lang))}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{humanizeName(d.metricName || d.metric_name || t('ai.accuracy', lang))} — v{d.modelVersion || d.model_version || '?'}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`text-sm font-bold ${statusColor}`}>{statusLabel}</span>
                            {magnitude > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">{t('ai.driftMagnitude', lang)}: {magPct}%</p>}
                          </div>
                        </div>
                        {(baseVal || curVal) ? (
                          <div className="flex items-center gap-4 mt-3">
                            <div className="flex-1">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-500 dark:text-gray-400">{t('ai.baseline', lang)}</span>
                                <span className="font-bold">{pct(baseVal)}</span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${baseVal * 100}%` }} />
                              </div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-500 dark:text-gray-400">{t('ai.current', lang)}</span>
                                <span className={`font-bold ${hasDrift ? 'text-red-600' : ''}`}>{pct(curVal)}</span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div className={`h-2 rounded-full transition-all ${hasDrift ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${curVal * 100}%` }} />
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {hasDrift && (() => {
                          const rawHazard = (d.modelName || d.model_name || 'flood').replace(/_predictor|_classifier|_model|_detector/gi, '').trim()
                          const hazardName = rawHazard || 'flood'
                          const isRetraining = retrainingDrift === hazardName
                          return (
                            <div className="mt-3">
                              <button
                                disabled={!!retrainingDrift}
                                onClick={async () => {
                                  setRetrainingDrift(hazardName)
                                  pushNotification(`${t('ai.retrainingScheduled', lang)} — ${humanizeName(hazardName)}`, 'info')
                                  try {
                                    await apiRetrainModel(hazardName)
                                    pushNotification(`${t('ai.retrainQueued', lang)} — ${humanizeName(hazardName)}`, 'success')
                                  } catch (err: any) {
                                    pushNotification(err?.message || t('ai.retrainFailed', lang), 'error')
                                  } finally {
                                    setRetrainingDrift(null)
                                  }
                                }}
                                className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-all shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                              >
                                {isRetraining ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                {isRetraining ? t('ai.submittingRetrain', lang) : t('ai.scheduleRetraining', lang)}
                              </button>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB: AUDIT TRAIL */}
          {consoleTab === 'audit' && (
            <div className="space-y-4">
              {/* Activity Intelligence Bar */}
              {auditStats.total > 0 && (
                <div className="bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-800/50 dark:to-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex items-center gap-3 flex-wrap">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                    <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {auditStats.total.toLocaleString()} inference{auditStats.total !== 1 ? 's' : ''} logged{auditStats.total > 0 ? ` · Avg ${auditStats.avgLatency}ms response` : ''}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {parseFloat(auditStats.errorRate) < 2
                        ? 'AI engine operating normally — all inference pipelines healthy'
                        : parseFloat(auditStats.errorRate) < 10
                          ? `${auditStats.errorRate}% error rate detected — review flagged entries below`
                          : `High error rate (${auditStats.errorRate}%) — immediate investigation recommended`}
                    </p>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold flex-shrink-0 ${parseFloat(auditStats.errorRate) < 2 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : parseFloat(auditStats.errorRate) < 10 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                    {parseFloat(auditStats.errorRate) < 2 ? 'Healthy' : parseFloat(auditStats.errorRate) < 10 ? 'Warning' : 'Critical'}
                  </span>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: t('ai.totalExecutions', lang), value: auditStats.total, color: 'text-gray-900 dark:text-white' },
                  { label: t('ai.avgLatency', lang), value: auditStats.total > 0 ? `${auditStats.avgLatency}ms` : '—', color: 'text-blue-600 dark:text-blue-400' },
                  { label: t('ai.errors', lang), value: auditStats.errorCount, color: auditStats.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400' },
                  { label: t('ai.errorRate', lang), value: `${auditStats.errorRate}%`, color: parseFloat(auditStats.errorRate) > 5 ? 'text-red-600' : 'text-emerald-600' },
                ].map((s, i) => (
                  <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{s.label}</p>
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  {(['All', 'Governance', 'Analysis', 'Classification'] as const).map(f => {
                    const filterLabels: Record<string, string> = {
                      'All': t('ai.filterAll', lang), 'Governance': t('ai.filterGovernance', lang),
                      'Analysis': t('ai.filterAnalysis', lang), 'Classification': t('ai.filterClassification', lang),
                    }
                    return (
                      <button key={f} onClick={() => setAuditFilter(f)}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                          auditFilter === f
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}>
                        {filterLabels[f]}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <input type="date" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg" />
                  <span className="text-gray-400">{t('common.to', lang)}</span>
                  <input type="date" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg" />
                </div>
                <button onClick={exportAuditCSV} disabled={filteredAuditEntries.length === 0}
                  className="ml-auto px-3 py-1.5 text-xs font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                  <Download className="w-3 h-3" /> {t('ai.exportCsv', lang)}
                </button>
              </div>

              {/* Table */}
              {auditLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : filteredAuditEntries.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                  <Eye className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('ai.noAuditEntries', lang)}</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.thModel', lang)}</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.thAction', lang)}</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.thTarget', lang)}</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.thStatus', lang)}</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.thLatency', lang)}</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300">{t('ai.thTimestamp', lang)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {filteredAuditEntries.slice(0, 50).map((entry: any, ei: number) => {
                        const ts = entry.createdAt || entry.created_at || ''
                        const fmtTs = ts ? (() => { try { const d = new Date(ts); return isNaN(d.getTime()) ? ts : d.toLocaleDateString(lang || 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return ts } })() : '—'
                        return (
                          <tr key={entry.id || ei} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-300">{humanizeName(entry.modelName || entry.model_name || '') || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 truncate max-w-[180px]">{humanizeName(entry.action || entry.inputSummary || entry.input_summary || '') || '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400 text-[10px]">
                                {humanizeName(entry.targetType || entry.target_type || '') || '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                (entry.status || '').toLowerCase() === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : (entry.status || '').toLowerCase() === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                              }`}>{humanizeName(entry.status || '') || '—'}</span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-600 dark:text-gray-400">
                              {entry.executionTimeMs != null ? `${entry.executionTimeMs}ms` : entry.execution_time_ms != null ? `${entry.execution_time_ms}ms` : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{fmtTs}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filteredAuditEntries.length > 50 && (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 text-center border-t border-gray-200 dark:border-gray-700">
                      {`${t('ai.showingOf', lang)} ${filteredAuditEntries.length} ${t('common.entries', lang)}.`} {t('ai.exportCsv', lang)}.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Keyboard shortcuts overlay */}
      {showKeyboard && (
        <div className="bg-slate-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-xs font-mono ring-1 ring-slate-700">
          <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">{t('common.shortcuts', lang)}:</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 ring-1 ring-gray-700">R</kbd> {t('common.refresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 ring-1 ring-gray-700">P</kbd> {t('ai.runPrediction', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 ring-1 ring-gray-700">M</kbd> {t('ai.models', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 ring-1 ring-gray-700">D</kbd> {t('ai.driftHealth', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 ring-1 ring-gray-700">?</kbd> {t('common.shortcuts', lang)}</span>
          <button onClick={() => setShowKeyboard(false)} className="ml-auto text-gray-400 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* AI Transparency Dashboard (5-tab analytics deep-dive) */}
      <AITransparencyDashboard />
    </div>
  )
}

