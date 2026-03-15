/**
 * AITransparencyConsole.tsx — Professional {t('ai.commandGovernance', lang)} Console
 *
 * Modeled after IBM Watson OpenScale, Google Vertex AI Model Monitoring,
 * Palantir Gotham ML Ops, FEMA IPAWS AI Decision Support, UK Met Office
 * Hazard Manager AI/ML Transparency frameworks.
 *
 * Wraps the existing AITransparencyDashboard (~840 lines, 5 tabs, 7 API
 * endpoints, WebSocket) and the inline Flood Intelligence section, adding:
 *
 * - Dark tactical command header with ZULU clock & system feed indicators
 * - AI Pipeline Status Strip (Ingest → Classify → Predict → Alert)
 * - Model Health Traffic Light Board (all models at one glance)
 * - Inference Performance Gauges (latency, throughput, queue)
 * - Data Lineage & Training Recency summary
 * - Flood Intelligence Engine (predictions, on-demand analysis)
 * - Existing AITransparencyDashboard component
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  Brain, Zap, Clock, Activity, TrendingUp, AlertTriangle, CheckCircle,
  Waves, Map, Package, Shield, Server, Database, Radio,
  ArrowRight, ChevronDown, ChevronUp, Gauge, GitBranch,
  Keyboard, X, Eye, Target, BarChart3, Cpu, Signal
} from 'lucide-react'
import AITransparencyDashboard from './AITransparencyDashboard'
import { apiRunPrediction, apiGetPredictions, apiSendPreAlert } from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/* ═══════════════════════════════════════════════════════════════════
   PROPS
   ═══════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
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

  // Live clock
  useEffect(() => {
    const iv = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const zuluTime = clockNow.toISOString().replace('T', ' ').substring(0, 19) + 'Z'

  // ── Prediction computations (moved from inline) ──
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

  // ── Run prediction handler ──
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

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — COMMAND HEADER
          ═══════════════════════════════════════════════════════════════ */}
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
            <button onClick={() => setShowKeyboard(p => !p)} className="text-[10px] bg-gray-800 hover:bg-gray-700 p-1.5 rounded-lg ring-1 ring-gray-700 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 transition-all">
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── AI Pipeline Status Strip ── */}
        <button
          onClick={() => setPipelineExpanded(p => !p)}
          className="w-full px-5 py-2 bg-gray-950/60 border-t border-gray-800/60 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-[8px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('ai.pipeline', lang)}</span>
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
                      <p className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{stage.desc}</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-600 flex-shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { label: t('ai.activePredictions', lang), value: predictions.length, icon: Zap, color: predictions.length > 0 ? 'text-green-400' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
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
                    <p className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider">{m.label}</p>
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
          <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-bold uppercase tracking-wider text-[9px]">{t('common.shortcuts', lang)}:</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">R</kbd> {t('common.refresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">P</kbd> {t('ai.runPrediction', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">E</kbd> {t('common.export', lang)}</span>
          <button onClick={() => setShowKeyboard(false)} className="ml-auto text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — FLOOD INTELLIGENCE ENGINE (moved from inline)
          ═══════════════════════════════════════════════════════════════ */}
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
                  <Waves className="w-10 h-10 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('ai.noActivePredictions', lang)}</p>
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
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-1"><Clock className="w-3 h-3" /> {ttf}</span>
                              <span className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('ai.confShort', lang)} {confDisplay}%</span>
                            </div>
                            <div className="flex items-center gap-4 mb-2">
                              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${probPct > 70 ? 'bg-gradient-to-r from-red-500 to-red-600' : probPct > 40 ? 'bg-gradient-to-r from-aegis-400 to-aegis-500' : 'bg-gradient-to-r from-blue-400 to-blue-500'}`} style={{ width: `${probPct}%` }} />
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1"><span className="font-semibold">{t('ai.pattern', lang)}:</span> {pattern}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-2"><span className="font-semibold">{t('ai.nextAreas', lang)}:</span> {(Array.isArray(pred.next_areas) ? pred.next_areas : []).join(', ') || t('common.notAvailable', lang)}</p>
                            <div className="flex gap-1 flex-wrap">{(Array.isArray(pred.data_sources) ? pred.data_sources : []).map((s: string, j: number) => <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{String(s)}</span>)}</div>
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
                            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm ${pred.pre_alert_sent ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md hover:shadow-lg'}`}
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
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1.5 uppercase tracking-wider">{t('ai.targetArea', lang)}</label>
                  <select className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" value={predictionArea} onChange={e => setPredictionArea(e.target.value)}>
                    {predictionAreaOptions.map(opt => <option key={opt.area} value={opt.area}>{opt.area}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1.5 uppercase tracking-wider">{t('ai.model', lang)}</label>
                  <div className="px-3 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl font-mono text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{predictionResult?.model_version || t('ai.defaultModelVersion', lang)}</div>
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
                          <div className="flex items-center justify-between mb-1"><span className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase">{m.label}</span><Icon className="w-3.5 h-3.5 opacity-50" /></div>
                          <p className={`font-bold text-sm ${m.tc}`}>{m.value}</p>
                        </div>
                      )
                    })}
                  </div>

                  {predictionResult.contributing_factors?.length > 0 && (
                    <div className="bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                      <h5 className="font-bold text-xs mb-3 uppercase tracking-wider text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('ai.contributingFactors', lang)}</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(predictionResult.contributing_factors || []).map((f: any, idx: number) => {
                          const imp = typeof f.importance === 'number' ? Math.round(f.importance * 100) : 0
                          const name = typeof f === 'string' ? f : (f.factor || f.name || t('common.unknown', lang))
                          const barColor = imp >= 50 ? 'from-red-500 to-red-600' : imp >= 30 ? 'from-aegis-400 to-aegis-500' : 'from-blue-400 to-blue-500'
                          return (
                            <div key={idx}>
                              <div className="flex justify-between text-xs mb-0.5"><span className="font-medium text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate">{name}</span><span className="font-bold text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{imp}%</span></div>
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
                  <div className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
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

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — AI TRANSPARENCY DASHBOARD (existing component)
          ═══════════════════════════════════════════════════════════════ */}
      <AITransparencyDashboard />
    </div>
  )
}





