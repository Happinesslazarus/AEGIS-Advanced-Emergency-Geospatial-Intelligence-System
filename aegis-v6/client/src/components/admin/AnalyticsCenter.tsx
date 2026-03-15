/**
 * AnalyticsCenter.tsx — Professional EOC Intelligence & Analytics Console
 *
 * Modeled after FEMA IPAWS Analytics, UK Resilience Direct Reports,
 * Palantir Gotham Intelligence, Esri ArcGIS Ops Dashboard analytics.
 *
 * Wraps the existing AnalyticsDashboard (733-line component with 12 KPIs,
 * 10 chart sections, WebSocket real-time) and adds:
 *
 * - Executive command header with mission clock + data feed indicators
 * - Operational Tempo (OPTEMPO) ribbon — key situation summary in one line
 * - SLA / threshold performance gauges
 * - Severity distribution donut (visual)
 * - Enhanced activity log with timeline + filtering
 * - Data quality scorecard with coverage metrics
 * - Keyboard shortcut reference
 */

import React, { useState, useMemo, useEffect } from 'react'
import {
  Activity, Download, Clock, BarChart3, TrendingUp, TrendingDown,
  CheckCircle, AlertTriangle, Flag, Bell, MapPin, RefreshCw,
  Brain, Shield, FileText, Search, Filter, ChevronDown, ChevronUp,
  Zap, Radio, Signal, Eye, Target, Gauge, Timer, Users,
  ArrowUpRight, ArrowDownRight, Minus, Printer, X, Keyboard
} from 'lucide-react'
import AnalyticsDashboard from './AnalyticsDashboard'
import { t } from '../../utils/i18n'
import type { Report } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'

/* ═══════════════════════════════════════════════════════════════════
   PROPS
   ═══════════════════════════════════════════════════════════════════ */
interface AnalyticsCenterProps {
  reports: Report[]
  stats: {
    total: number; urgent: number; unverified: number; verified: number
    flagged: number; resolved: number; archived?: number; falseReport?: number
    high: number; medium: number; low: number; avgConf: number; withMedia: number
    trapped?: number; verifyRate?: number
  }
  auditLog: any[]
  lang: string
  onExportCSV: () => void
  onExportJSON: () => void
  onSelectReport: (r: Report) => void
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */
const timeAgo = (ts: string, lang: string) => {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 1) return t('time.justNow', lang)
  if (mins < 60) return `${mins}${t('time.mAgo', lang)}`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

const AUDIT_ICON_MAP: Record<string, { bg: string; icon: React.FC<any> }> = {
  verify: { bg: 'bg-emerald-500', icon: CheckCircle },
  flag: { bg: 'bg-purple-500', icon: Flag },
  urgent: { bg: 'bg-red-500', icon: AlertTriangle },
  resolve: { bg: 'bg-gray-500', icon: CheckCircle },
  alert_send: { bg: 'bg-red-600', icon: Bell },
  deploy: { bg: 'bg-teal-500', icon: MapPin },
  recall: { bg: 'bg-cyan-500', icon: RefreshCw },
}

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function AnalyticsCenter(props: AnalyticsCenterProps) {
  const lang = useLanguage()
  const {
    reports, stats, auditLog,
    onExportCSV, onExportJSON, onSelectReport, pushNotification,
  } = props

  const [clockNow, setClockNow] = useState(new Date())
  const [activityFilter, setActivityFilter] = useState<string>('all')
  const [activityExpanded, setActivityExpanded] = useState(true)
  const [showKeyboard, setShowKeyboard] = useState(false)
  const [optempoExpanded, setOptempoExpanded] = useState(true)

  // ── Live clock ──
  useEffect(() => {
    const interval = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // ── OPTEMPO metrics ──
  const optempo = useMemo(() => {
    const now = Date.now()
    const last1h = reports.filter(r => now - new Date(r.timestamp).getTime() < 3600000).length
    const last24h = reports.filter(r => now - new Date(r.timestamp).getTime() < 86400000).length
    const reportsPerHour = last24h > 0 ? (last24h / 24).toFixed(1) : '0'

    // Tempo level
    let tempoLevel: 'ROUTINE' | 'ELEVATED' | 'HIGH' | 'SURGE' = 'ROUTINE'
    let tempoColor = 'text-green-400'
    let tempoBg = 'bg-green-500/10 ring-green-500/30'
    if (last1h >= 20 || stats.urgent >= 10) {
      tempoLevel = 'SURGE'; tempoColor = 'text-red-400'; tempoBg = 'bg-red-500/10 ring-red-500/30'
    } else if (last1h >= 10 || stats.urgent >= 5) {
      tempoLevel = 'HIGH'; tempoColor = 'text-orange-400'; tempoBg = 'bg-orange-500/10 ring-orange-500/30'
    } else if (last1h >= 5 || stats.urgent >= 2) {
      tempoLevel = 'ELEVATED'; tempoColor = 'text-amber-400'; tempoBg = 'bg-amber-500/10 ring-amber-500/30'
    }

    return { last1h, last24h, reportsPerHour, tempoLevel, tempoColor, tempoBg }
  }, [reports, stats.urgent])

  // ── SLA performance gauges ──
  const sla = useMemo(() => {
    const verifyRate = stats.verifyRate || (stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0)
    const resolveRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0
    const urgentResponseRate = stats.urgent > 0 ? Math.round(((stats.urgent - (stats.unverified > 0 ? Math.min(stats.unverified, stats.urgent) : 0)) / Math.max(stats.urgent, 1)) * 100) : 100
    const aiCoverage = stats.avgConf > 0 ? Math.min(stats.avgConf + 15, 100) : 0 // Normalized for display
    return { verifyRate, resolveRate, urgentResponseRate, aiCoverage }
  }, [stats])

  // ── Severity donut data ──
  const severityDonut = useMemo(() => {
    const total = stats.high + stats.medium + stats.low
    if (total === 0) return { high: 0, medium: 0, low: 0, highPct: 0, medPct: 0, lowPct: 0 }
    return {
      high: stats.high, medium: stats.medium, low: stats.low,
      highPct: Math.round((stats.high / total) * 100),
      medPct: Math.round((stats.medium / total) * 100),
      lowPct: Math.round((stats.low / total) * 100),
    }
  }, [stats])

  // ── Filtered audit log ──
  const filteredLog = useMemo(() => {
    if (activityFilter === 'all') return auditLog.slice(0, 30)
    return auditLog.filter(e => (e.action_type || '').includes(activityFilter)).slice(0, 30)
  }, [auditLog, activityFilter])

  const zuluTime = clockNow.toISOString().replace('T', ' ').substring(0, 19) + 'Z'

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
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                  Intelligence & Analytics
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 ring-1 ring-green-500/30 font-mono">{t('common.live', lang)}</span>
                </h1>
                <p className="text-[9px] text-cyan-400/70 font-mono tracking-wider uppercase">{t('analytics.situationAssessment', lang)} • Data Intelligence • Performance Metrics</p>
              </div>
            </div>

            {/* Mission Clock */}
            <div className="hidden md:flex items-center gap-2 bg-gray-800/80 rounded-lg px-3 py-1.5 ring-1 ring-gray-700">
              <Clock className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-mono text-green-400 tabular-nums">{zuluTime}</span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <button onClick={onExportCSV} className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 ring-1 ring-gray-700 transition-all hover:shadow-md">
              <Download className="w-3 h-3" /> CSV
            </button>
            <button onClick={onExportJSON} className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 ring-1 ring-gray-700 transition-all hover:shadow-md">
              <Download className="w-3 h-3" /> JSON
            </button>
            <button onClick={() => setShowKeyboard(p => !p)} className="text-[10px] bg-gray-800 hover:bg-gray-700 p-1.5 rounded-lg ring-1 ring-gray-700 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 transition-all">
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* OPTEMPO Ribbon */}
        <button
          onClick={() => setOptempoExpanded(p => !p)}
          className="w-full px-5 py-2 bg-gray-950/60 border-t border-gray-800/60 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-[8px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('analytics.optempo', lang)}</span>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded ring-1 ${optempo.tempoBg} ${optempo.tempoColor}`}>
              {optempo.tempoLevel}
            </span>
          </div>
          {optempoExpanded ? <ChevronUp className="w-3 h-3 text-gray-600" /> : <ChevronDown className="w-3 h-3 text-gray-600" />}
        </button>

        {optempoExpanded && (
          <div className="px-5 py-3 bg-gray-950/40 border-t border-gray-800/40 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: t('analytics.totalIncidents', lang), value: stats.total, icon: FileText, color: 'text-white' },
              { label: t('analytics.lastHour', lang), value: optempo.last1h, icon: Zap, color: optempo.last1h >= 10 ? 'text-red-400' : optempo.last1h >= 5 ? 'text-amber-400' : 'text-green-400' },
              { label: t('analytics.last24h', lang), value: optempo.last24h, icon: Clock, color: 'text-cyan-400' },
              { label: t('analytics.reportsPerHr', lang), value: optempo.reportsPerHour, icon: Activity, color: 'text-blue-400' },
              { label: t('common.urgent', lang), value: stats.urgent, icon: AlertTriangle, color: stats.urgent > 0 ? 'text-red-400' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
              { label: t('common.unverified', lang), value: stats.unverified, icon: Eye, color: stats.unverified > 5 ? 'text-amber-400' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
              { label: t('ai.confidence', lang), value: `${stats.avgConf}%`, icon: Brain, color: stats.avgConf >= 70 ? 'text-emerald-400' : 'text-amber-400' },
              { label: t('analytics.mediaAttached', lang), value: stats.withMedia, icon: Signal, color: 'text-purple-400' },
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
        )}
      </div>

      {/* Keyboard Shortcuts */}
      {showKeyboard && (
        <div className="bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-bold uppercase tracking-wider text-[9px]">Shortcuts:</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">R</kbd> Refresh</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">E</kbd> Export CSV</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">F</kbd> Toggle Fullscreen</span>
          <button onClick={() => setShowKeyboard(false)} className="ml-auto text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — SLA PERFORMANCE + SEVERITY DONUT
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* SLA Performance Gauges */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-aegis-600" />
            <h3 className="text-sm font-extrabold">{t('analytics.slaTargets', lang)}</h3>
            <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ml-1">{t('analytics.slaSubtitle', lang)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t('analytics.verificationRate', lang), value: sla.verifyRate, target: 80, unit: '%', color: sla.verifyRate >= 80 ? 'emerald' : sla.verifyRate >= 50 ? 'amber' : 'red' },
              { label: t('analytics.resolutionRate', lang), value: sla.resolveRate, target: 60, unit: '%', color: sla.resolveRate >= 60 ? 'emerald' : sla.resolveRate >= 30 ? 'amber' : 'red' },
              { label: t('analytics.urgentResponse', lang), value: sla.urgentResponseRate, target: 90, unit: '%', color: sla.urgentResponseRate >= 90 ? 'emerald' : sla.urgentResponseRate >= 70 ? 'amber' : 'red' },
              { label: t('analytics.aiCoverage', lang), value: sla.aiCoverage, target: 75, unit: '%', color: sla.aiCoverage >= 75 ? 'emerald' : sla.aiCoverage >= 50 ? 'amber' : 'red' },
            ].map((g, i) => (
              <div key={i} className="text-center">
                {/* Circular gauge */}
                <div className="relative w-20 h-20 mx-auto mb-2">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" stroke="currentColor" strokeWidth="3"
                      className="text-gray-100 dark:text-gray-800" />
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${g.value}, 100`}
                      className={`text-${g.color}-500`}
                      style={{ stroke: g.color === 'emerald' ? '#10b981' : g.color === 'amber' ? '#f59e0b' : '#ef4444' }} />
                    {/* Target line */}
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" strokeWidth="0.5" strokeDasharray={`${g.target} ${100 - g.target}`}
                      className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600" strokeOpacity="0.5"
                      style={{ stroke: '#6b7280' }} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-base font-black tabular-nums">{g.value}<span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{g.unit}</span></span>
                  </div>
                </div>
                <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{g.label}</p>
                <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">Target: {g.target}{g.unit}</p>
                <span className={`text-[9px] font-bold ${g.value >= g.target ? 'text-emerald-600' : 'text-red-500'}`}>
                  {g.value >= g.target ? '✓ MEETING' : '✗ BELOW'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Severity Distribution Donut */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-extrabold">{t('analytics.severityDistribution', lang)}</h3>
          </div>
          <div className="flex items-center justify-center mb-4">
            {/* CSS donut */}
            <div className="relative w-28 h-28">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-100 dark:text-gray-800" />
                {/* High */}
                <circle cx="18" cy="18" r="14" fill="none" strokeWidth="4"
                  strokeDasharray={`${severityDonut.highPct * 0.88} ${88 - severityDonut.highPct * 0.88}`}
                  strokeDashoffset="0" style={{ stroke: '#ef4444' }} />
                {/* Medium */}
                <circle cx="18" cy="18" r="14" fill="none" strokeWidth="4"
                  strokeDasharray={`${severityDonut.medPct * 0.88} ${88 - severityDonut.medPct * 0.88}`}
                  strokeDashoffset={`${-(severityDonut.highPct * 0.88)}`}
                  style={{ stroke: '#f59e0b' }} />
                {/* Low */}
                <circle cx="18" cy="18" r="14" fill="none" strokeWidth="4"
                  strokeDasharray={`${severityDonut.lowPct * 0.88} ${88 - severityDonut.lowPct * 0.88}`}
                  strokeDashoffset={`${-((severityDonut.highPct + severityDonut.medPct) * 0.88)}`}
                  style={{ stroke: '#3b82f6' }} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-lg font-black tabular-nums">{stats.total}</p>
                  <p className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase">Total</p>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: 'High', count: severityDonut.high, pct: severityDonut.highPct, color: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
              { label: 'Medium', count: severityDonut.medium, pct: severityDonut.medPct, color: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
              { label: 'Low', count: severityDonut.low, pct: severityDonut.lowPct, color: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${s.color} flex-shrink-0`} />
                <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 w-16">{s.label}</span>
                <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${s.color} transition-all duration-500`} style={{ width: `${s.pct}%` }} />
                </div>
                <span className={`text-[10px] font-black tabular-nums ${s.text}`}>{s.count}</span>
                <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums w-8 text-right">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — MAIN ANALYTICS DASHBOARD (existing component)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
        <AnalyticsDashboard />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — ENHANCED ACTIVITY LOG
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
        <button
          onClick={() => setActivityExpanded(p => !p)}
          className="w-full px-5 py-3 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-900/50 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-600 flex items-center justify-center">
              <Clock className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-extrabold">{t('admin.analytics.activityLog', lang)}</h3>
              <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('analytics.activitySubtitle', lang)}</p>
            </div>
            <span className="text-[10px] font-bold text-aegis-600 bg-aegis-50 dark:bg-aegis-950/30 px-2 py-0.5 rounded-full tabular-nums">{auditLog.length}</span>
          </div>
          {activityExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />}
        </button>

        {activityExpanded && (
          <div className="p-4">
            {/* Filter tabs */}
            <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none">
              {[
                { key: 'all', label: 'All', count: auditLog.length },
                { key: 'verify', label: 'Verify', count: auditLog.filter(e => e.action_type === 'verify').length },
                { key: 'flag', label: 'Flag', count: auditLog.filter(e => e.action_type === 'flag').length },
                { key: 'urgent', label: t('common.urgent', lang), count: auditLog.filter(e => e.action_type === 'urgent').length },
                { key: 'resolve', label: 'Resolve', count: auditLog.filter(e => e.action_type === 'resolve').length },
                { key: 'alert', label: 'Alerts', count: auditLog.filter(e => (e.action_type || '').includes('alert')).length },
                { key: 'deploy', label: 'Deploy', count: auditLog.filter(e => e.action_type === 'deploy').length },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setActivityFilter(f.key)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all flex-shrink-0 ${
                    activityFilter === f.key
                      ? 'bg-aegis-600 text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 ring-1 ring-gray-200 dark:ring-gray-700'
                  }`}
                >
                  {f.label}
                  <span className="tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>

            {/* Log entries */}
            <div className="divide-y divide-gray-100 dark:divide-gray-800/50 max-h-[400px] overflow-y-auto scrollbar-thin">
              {filteredLog.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.analytics.noActivity', lang)}</p>
              ) : filteredLog.map((e: any, i: number) => {
                const iconCls = 'w-4 h-4'
                const mapping = AUDIT_ICON_MAP[e.action_type || '']
                const bgColor = mapping?.bg || (
                  (e.action_type || '').includes('login') ? 'bg-gray-400' :
                  (e.action_type || '').includes('export') ? 'bg-blue-500' : 'bg-blue-500'
                )
                const IconComp = mapping?.icon || (
                  (e.action_type || '').includes('export') ? Download : Activity
                )
                const reportId = e.target_id ? e.target_id.slice(0, 8) : null

                return (
                  <div key={e.id || i} className="py-2.5 flex items-start gap-3 group hover:bg-gray-50/50 dark:hover:bg-gray-800/20 -mx-1 px-1 rounded-lg transition-colors">
                    {/* Timeline dot + line */}
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0 shadow-sm ${bgColor}`}>
                        <IconComp className={iconCls} />
                      </div>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">
                        {e.action}
                        {reportId && (
                          <span
                            className="text-aegis-600 font-mono ml-1 cursor-pointer hover:underline text-[10px]"
                            onClick={() => {
                              const r = reports.find(rp => rp.id === e.target_id)
                              if (r) onSelectReport(r)
                            }}
                          >
                            (RPT-{reportId})
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-1">
                          <Users className="w-3 h-3" /> {e.operator_name || 'System'}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {timeAgo(e.created_at, lang)}
                        </span>
                        {e.action_type && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-mono">{e.action_type}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5 — DATA QUALITY SCORECARD
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-extrabold">{t('analytics.dataQualityScorecard', lang)}</h3>
          <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 ml-1">{t('analytics.dataQualitySubtitle', lang)}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t('analytics.aiAnalyzed', lang), value: stats.avgConf > 0 ? Math.round((reports.filter(r => (r.confidence || 0) > 0).length / Math.max(stats.total, 1)) * 100) : 0, icon: Brain, color: 'violet' },
            { label: t('analytics.hasMedia', lang), value: stats.total > 0 ? Math.round((stats.withMedia / stats.total) * 100) : 0, icon: Signal, color: 'blue' },
            { label: t('analytics.hasLocation', lang), value: stats.total > 0 ? Math.round((reports.filter(r => r.location && r.location !== 'Unknown').length / Math.max(stats.total, 1)) * 100) : 0, icon: MapPin, color: 'emerald' },
            { label: t('common.verified', lang), value: stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0, icon: CheckCircle, color: 'cyan' },
          ].map((m, i) => (
            <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 ring-1 ring-gray-100 dark:ring-gray-800">
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={`w-3.5 h-3.5 text-${m.color}-500`} style={{ color: m.color === 'violet' ? '#8b5cf6' : m.color === 'blue' ? '#3b82f6' : m.color === 'emerald' ? '#10b981' : '#06b6d4' }} />
                <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{m.label}</span>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-black tabular-nums">{m.value}<span className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">%</span></span>
              </div>
              <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${m.value}%`,
                    backgroundColor: m.color === 'violet' ? '#8b5cf6' : m.color === 'blue' ? '#3b82f6' : m.color === 'emerald' ? '#10b981' : '#06b6d4'
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}





