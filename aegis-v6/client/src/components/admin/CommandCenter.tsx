/**
 * CommandCenter.tsx — Professional Emergency Operations Command Interface
 *
 * Modeled after real-world EOC dashboards (Palantir Gotham, ESRI Ops Dashboard,
 * UK Cabinet Office COBR). Features: Threat Level Banner, Live Mission Clock,
 * Systems Status Ribbon, Auto-Generated SitRep, Threat Matrix, Resource Readiness,
 * Unified Ops Feed, and full incident awareness.
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  Shield, AlertTriangle, CheckCircle, Clock, Users, Activity, TrendingUp,
  FileText, Bell, Map, Download, RefreshCw, Flag, Siren, Brain,
  MapPin, ChevronRight, CheckCircle2, Radio, Wifi, Server,
  Database, Cpu, MessageSquare, Mail, Phone, Zap, Target,
  ChevronDown, ChevronUp, Eye, Signal, Monitor, ShieldAlert
} from 'lucide-react'
import IncidentCommandConsole from './IncidentCommandConsole'
import IncidentQueue from './IncidentQueue'
import ClimateRiskDashboard from '../shared/ClimateRiskDashboard'
import { t } from '../../utils/i18n'
import type { Report } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'

/* ═══════════════════════════════════════════════════════════════════
   THREAT LEVEL CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */
const THREAT_LEVELS = {
  NORMAL:   { label: 'NORMAL',   color: 'from-emerald-600 to-green-700',  text: 'text-emerald-100', dot: 'bg-emerald-400', desc: 'No significant threats — all systems nominal' },
  ELEVATED: { label: 'ELEVATED', color: 'from-blue-600 to-cyan-700',      text: 'text-blue-100',    dot: 'bg-blue-400',    desc: 'Increased monitoring recommended' },
  HIGH:     { label: 'HIGH',     color: 'from-amber-500 to-orange-600',   text: 'text-amber-100',   dot: 'bg-amber-400',   desc: 'Active incidents require coordinated response' },
  SEVERE:   { label: 'SEVERE',   color: 'from-orange-600 to-red-600',     text: 'text-orange-100',  dot: 'bg-orange-300',  desc: 'Multiple critical incidents — elevated response posture' },
  CRITICAL: { label: 'CRITICAL', color: 'from-red-600 to-red-800',        text: 'text-red-100',     dot: 'bg-red-300',     desc: 'Maximum response posture — immediate action required' },
} as const

type ThreatLevel = keyof typeof THREAT_LEVELS

function getLocalizedThreatLevels(lang: string) {
  return {
    NORMAL: { ...THREAT_LEVELS.NORMAL, label: t('command.normal', lang), desc: t('command.threatDescNormal', lang) },
    ELEVATED: { ...THREAT_LEVELS.ELEVATED, label: t('command.elevated', lang), desc: t('command.threatDescElevated', lang) },
    HIGH: { ...THREAT_LEVELS.HIGH, label: t('command.high', lang), desc: t('command.threatDescHigh', lang) },
    SEVERE: { ...THREAT_LEVELS.SEVERE, label: t('command.severe', lang), desc: t('command.threatDescSevere', lang) },
    CRITICAL: { ...THREAT_LEVELS.CRITICAL, label: t('command.critical', lang), desc: t('command.threatDescCritical', lang) },
  } as const
}

/* ═══════════════════════════════════════════════════════════════════
   PROPS
   ═══════════════════════════════════════════════════════════════════ */
interface CommandCenterProps {
  stats: {
    total: number; urgent: number; unverified: number; verified: number
    flagged: number; resolved: number; avgConf: number; trapped: number
    high: number; medium: number; low: number; withMedia: number; verifyRate: number
  }
  commandCenter: {
    generatedAt: string
    activity: Array<{ id: string; action: string; action_type: string; operator_name: string; created_at: string }>
    leaderboard: Array<{ operator: string; actions: number; handled: number; avgResponseMinutes: number }>
    recommendations: Array<{ priority: 'critical' | 'high' | 'medium'; message: string }>
    comparative: { today: number; yesterday: number; dayDeltaPct: number; thisWeek: number; previousWeek: number; weekDeltaPct: number }
  } | null
  reports: Report[]
  alerts: any[]
  user: any
  lang: string
  onViewChange: (view: string) => void
  onSelectReport: (report: any) => void
  onRefresh: () => void
  onFilterType: (type: string) => void
  filterType: string
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
  exportCommandCenter: (format: 'csv' | 'json') => void
  recentSort: string
  setRecentSort: (sort: string) => void
  activityShowAll: boolean
  setActivityShowAll: (val: boolean | ((prev: boolean) => boolean)) => void
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */
const fmtMins = (v: number): string => {
  if (!v || v < 60) return `${v || 0}m`
  return `${Math.floor(v / 60)}h ${v % 60}m`
}

const fmtMinsLocalized = (v: number, lang: string): string => {
  if (!v || v < 60) return `${v || 0}${t('common.minutesShort', lang)}`
  return `${Math.floor(v / 60)}${t('common.hoursShort', lang)} ${v % 60}${t('common.minutesShort', lang)}`
}

const formatRelativeTime = (mins: number, lang: string): string => {
  if (mins < 1) return t('command.justNow', lang)
  if (mins < 60) return `${mins}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  if (mins < 1440) return `${Math.floor(mins / 60)}${t('common.hoursShort', lang)} ${t('common.ago', lang)}`
  return `${Math.floor(mins / 1440)}${t('common.daysShort', lang)} ${t('common.ago', lang)}`
}

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function CommandCenter({
  stats, commandCenter, reports, alerts, user,
  onViewChange, onSelectReport, onRefresh, onFilterType, filterType,
  pushNotification, exportCommandCenter,
  recentSort, setRecentSort, activityShowAll, setActivityShowAll,
}: CommandCenterProps) {
  const lang = useLanguage()

  const [clock, setClock] = useState(new Date())
  const [sitrepOpen, setSitrepOpen] = useState(true)

  // ── Live clock ──
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // ── Auto-calculate threat level ──
  const threatLevel: ThreatLevel = useMemo(() => {
    if (stats.urgent >= 5 || (stats.urgent >= 3 && stats.trapped > 0)) return 'CRITICAL'
    if (stats.urgent >= 3 || stats.trapped > 0) return 'SEVERE'
    if (stats.urgent >= 1 || stats.high >= 4) return 'HIGH'
    if (stats.high >= 2 || stats.flagged >= 3) return 'ELEVATED'
    return 'NORMAL'
  }, [stats])

  const threat = getLocalizedThreatLevels(lang)[threatLevel]

  // ── Threat matrix: incident types × severity ──
  const threatMatrix = useMemo(() => {
    const matrix: Record<string, { high: number; medium: number; low: number; total: number }> = {}
    reports.forEach(r => {
      const cat = r.type || r.incidentCategory || t('common.unknown', lang)
      if (!matrix[cat]) matrix[cat] = { high: 0, medium: 0, low: 0, total: 0 }
      matrix[cat].total++
      if (r.severity === 'High') matrix[cat].high++
      else if (r.severity === 'Medium') matrix[cat].medium++
      else matrix[cat].low++
    })
    return Object.entries(matrix)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
  }, [reports, lang])

  // ── Auto-generated SitRep ──
  const sitrepLines = useMemo(() => {
    const lines: Array<{ text: string; alert?: boolean }> = []
    const resRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0
    const delta = commandCenter?.comparative?.weekDeltaPct ?? 0

    lines.push({ text: `${stats.total} ${t('command.sitrepIncidentsManaged', lang)}.` })
    if (stats.urgent > 0) lines.push({ text: `${stats.urgent} ${t(stats.urgent === 1 ? 'command.urgentIncidentSingular' : 'command.urgentIncidentPlural', lang)}` })
    if (stats.unverified > 0) lines.push({ text: `${stats.unverified} ${t('command.pendingVerificationSuffix', lang)} (${stats.total > 0 ? Math.round((stats.unverified / stats.total) * 100) : 0}% ${t('command.backlog', lang)}).` })
    lines.push({ text: `${stats.verified} ${t('command.verifiedResolvedSuffix', lang)} ${stats.resolved} ${t('command.resolvedSuffix', lang)} - ${resRate}% ${t('command.clearanceRate', lang)}.` })
    if (stats.trapped > 0) lines.push({ text: `${t('command.sitrepSarAlert', lang)}: ${stats.trapped} ${t(stats.trapped === 1 ? 'command.personTrappedSingular' : 'command.personTrappedPlural', lang)}`, alert: true })
    lines.push({ text: `${t('command.sitrepAiConfidence', lang)} ${stats.avgConf}% ${t('command.aiConfidenceSuffix', lang)}` })
    if (delta !== 0) lines.push({ text: `${t('command.weeklyIncidentVolume', lang)} ${delta > 0 ? t('common.up', lang) : t('common.down', lang)} ${Math.abs(delta)}% ${t('command.vsPreviousPeriod', lang)}` })
    if ((commandCenter?.recommendations?.length ?? 0) > 0) lines.push({ text: `${commandCenter!.recommendations.length} ${t(commandCenter!.recommendations.length === 1 ? 'command.recommendationPendingSingular' : 'command.recommendationPendingPlural', lang)}` })

    return lines
  }, [stats, commandCenter, lang])

  // ── Systems status (simulated from what we know) ──
  const systems = [
    { name: t('command.aiEngine', lang), icon: Brain, ok: true },
    { name: 'Workflows', icon: Zap, ok: true },
    { name: t('command.database', lang), icon: Database, ok: true },
    { name: t('command.realTime', lang), icon: Radio, ok: true },
    { name: t('command.comms', lang), icon: Mail, ok: true },
  ]

  // ── Sorted recent reports ──
  const sortedReports = useMemo(() => {
    const sorted = [...reports].sort((a, b) => {
      if (recentSort === 'newest') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      if (recentSort === 'oldest') return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      if (recentSort === 'severity') { const o: Record<string, number> = { High: 3, Medium: 2, Low: 1 }; return (o[b.severity] || 0) - (o[a.severity] || 0) }
      if (recentSort === 'ai-high') return (b.confidence || 0) - (a.confidence || 0)
      if (recentSort === 'ai-low') return (a.confidence || 0) - (b.confidence || 0)
      return 0
    })
    return sorted.slice(0, 12)
  }, [reports, recentSort])

  const severityLabel = (v: string) => v === 'High' ? t('admin.filters.severity.high', lang) : v === 'Medium' ? t('admin.filters.severity.medium', lang) : t('admin.filters.severity.low', lang)

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — THREAT LEVEL BANNER
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`relative overflow-hidden bg-gradient-to-r ${threat.color} rounded-2xl p-4 shadow-lg`}>
        {/* Subtle grid overlay for tactical feel */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(255,255,255,.05) 25%, rgba(255,255,255,.05) 26%, transparent 27%, transparent 74%, rgba(255,255,255,.05) 75%, rgba(255,255,255,.05) 76%, transparent 77%), linear-gradient(90deg, transparent 24%, rgba(255,255,255,.05) 25%, rgba(255,255,255,.05) 26%, transparent 27%, transparent 74%, rgba(255,255,255,.05) 75%, rgba(255,255,255,.05) 76%, transparent 77%)',
          backgroundSize: '20px 20px'
        }} />
        {threatLevel === 'CRITICAL' && <div className="absolute inset-0 bg-red-500/20 animate-pulse rounded-2xl" />}

        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className={`w-6 h-6 ${threat.text}`} />
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase tracking-[0.2em] ${threat.text} opacity-80`}>{t('command.threatLevel', lang)}</span>
                  <span className={`text-lg font-black tracking-wide ${threat.text}`}>{threat.label}</span>
                  <span className={`w-2 h-2 rounded-full ${threat.dot} ${threatLevel !== 'NORMAL' ? 'animate-pulse' : ''}`} />
                </div>
                <p className={`text-xs ${threat.text} opacity-90 mt-0.5`}>{threat.desc}</p>
              </div>
            </div>
          </div>

          <div className={`flex items-center gap-4 ${threat.text}`}>
            <div className="text-right">
              <p className="text-xs opacity-90 uppercase tracking-wider font-semibold">{t('common.urgent', lang)}</p>
              <p className="text-xl font-black tabular-nums">{stats.urgent}</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-right">
              <p className="text-xs opacity-90 uppercase tracking-wider font-semibold">{t('command.total', lang)}</p>
              <p className="text-xl font-black tabular-nums">{stats.total}</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-right">
              <p className="text-xs opacity-90 uppercase tracking-wider font-semibold">{t('command.trapped', lang)}</p>
              <p className="text-xl font-black tabular-nums">{stats.trapped}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — MISSION CLOCK + SYSTEMS STATUS BAR
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-gray-900 dark:bg-gray-950 rounded-xl px-4 py-2.5 ring-1 ring-gray-800">
        {/* Live Clock */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest">{t('common.live', lang)}</span>
          </div>
          <span className="text-slate-900 dark:text-white font-mono text-lg font-bold tabular-nums tracking-wider">
            {clock.toLocaleTimeString('en-GB', { hour12: false })}
          </span>
          <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 text-xs font-mono">
            {clock.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
          </span>
        </div>

        {/* Systems Status */}
        <div className="flex items-center gap-3">
          {systems.map(sys => (
            <div key={sys.name} className="flex items-center gap-1.5" title={sys.name}>
              <sys.icon className="w-3 h-3 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
              <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium hidden sm:inline">{sys.name}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${sys.ok ? 'bg-green-400' : 'bg-red-400'}`} />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-mono tabular-nums">
            {commandCenter?.generatedAt ? `${t('command.dataLabel', lang)} ${new Date(commandCenter.generatedAt).toLocaleTimeString('en-GB', { hour12: false })}` : ''}
          </span>
          <button onClick={() => exportCommandCenter('csv')} disabled={!commandCenter} className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded font-mono transition-colors disabled:opacity-30"><Download className="w-3 h-3 inline mr-1" />CSV</button>
          <button onClick={() => exportCommandCenter('json')} disabled={!commandCenter} className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded font-mono transition-colors disabled:opacity-30"><Download className="w-3 h-3 inline mr-1" />JSON</button>
          <button onClick={onRefresh} className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded font-mono transition-colors"><RefreshCw className="w-3 h-3 inline mr-1" />{t('command.refreshLabel', lang)}</button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — KPI METRICS (8 cards)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {([
          { l: t('admin.stats.total', lang), v: stats.total, g: 'from-slate-500/10 to-slate-500/5 dark:from-slate-400/10 dark:to-slate-400/5', ring: 'ring-slate-200 dark:ring-slate-700', c: 'text-slate-900 dark:text-white', i: FileText, ic: 'text-slate-400' },
          { l: t('admin.stats.urgent', lang), v: stats.urgent, g: 'from-red-500/10 to-red-500/5 dark:from-red-500/15 dark:to-red-500/5', ring: 'ring-red-200 dark:ring-red-800', c: 'text-red-600 dark:text-red-400', i: Siren, ic: 'text-red-400', pulse: stats.urgent > 0 },
          { l: t('admin.stats.unverified', lang), v: stats.unverified, g: 'from-aegis-500/10 to-aegis-500/5 dark:from-aegis-500/15 dark:to-aegis-500/5', ring: 'ring-aegis-200 dark:ring-aegis-800', c: 'text-aegis-600 dark:text-aegis-400', i: Clock, ic: 'text-aegis-400' },
          { l: t('admin.stats.verified', lang), v: stats.verified, g: 'from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/15 dark:to-emerald-500/5', ring: 'ring-emerald-200 dark:ring-emerald-800', c: 'text-emerald-600 dark:text-emerald-400', i: CheckCircle, ic: 'text-emerald-400' },
          { l: t('admin.stats.flagged', lang), v: stats.flagged, g: 'from-orange-500/10 to-orange-500/5 dark:from-orange-500/15 dark:to-orange-500/5', ring: 'ring-orange-200 dark:ring-orange-800', c: 'text-orange-600 dark:text-orange-400', i: Flag, ic: 'text-orange-400' },
          { l: t('admin.stats.resolved', lang), v: stats.resolved, g: 'from-gray-500/10 to-gray-500/5 dark:from-gray-400/10 dark:to-gray-400/5', ring: 'ring-gray-200 dark:ring-gray-700', c: 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300', i: CheckCircle2, ic: 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
          { l: t('admin.stats.avgAi', lang), v: `${stats.avgConf}%`, g: 'from-violet-500/10 to-violet-500/5 dark:from-violet-500/15 dark:to-violet-500/5', ring: 'ring-violet-200 dark:ring-violet-800', c: 'text-violet-600 dark:text-violet-400', i: Brain, ic: 'text-violet-400' },
          { l: t('admin.stats.trapped', lang), v: stats.trapped, g: 'from-fuchsia-500/10 to-fuchsia-500/5 dark:from-fuchsia-500/15 dark:to-fuchsia-500/5', ring: 'ring-fuchsia-200 dark:ring-fuchsia-800', c: 'text-fuchsia-600 dark:text-fuchsia-400', i: AlertTriangle, ic: 'text-fuchsia-400' },
        ] as const).map((s, i) => (
          <div key={i} className={`relative overflow-hidden bg-gradient-to-br ${s.g} backdrop-blur-sm rounded-2xl p-3 ring-1 ${s.ring} hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-default group`}>
            <div className="flex items-center justify-between mb-1.5">
              <s.i className={`w-4 h-4 ${s.ic} group-hover:scale-110 transition-transform`} />
              {'pulse' in s && s.pulse && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />}
            </div>
            <p className={`text-2xl font-black tabular-nums tracking-tight ${s.c}`}>{s.v}</p>
            <p className="text-[9px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-bold uppercase tracking-wider mt-0.5">{s.l}</p>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — SITUATION BRIEFING + THREAT MATRIX + ASSESSMENT
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── SITREP — Auto-Generated Situation Report ── */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <button
            onClick={() => setSitrepOpen(p => !p)}
            className="w-full px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-slate-50 to-gray-50 dark:from-gray-900 dark:to-gray-900/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center">
                <FileText className="w-3 h-3 text-white dark:text-gray-900" />
              </div>
              <div className="text-left">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.situationBrief', lang)}</h3>
                <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.autoGenerated', lang)}</p>
              </div>
            </div>
            {sitrepOpen ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />}
          </button>
          {sitrepOpen && (
            <div className="p-4">
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 ring-1 ring-gray-100 dark:ring-gray-700 font-mono text-[11px] text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-1.5 leading-relaxed">
                <p className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest mb-2">
                  {t('command.opBrief', lang)} — {clock.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()} {clock.toLocaleTimeString('en-GB', { hour12: false })}
                </p>
                <p className="font-bold text-gray-900 dark:text-white">{t('command.threatPosture', lang)}: {threat.label}</p>
                {sitrepLines.map((line, i) => (
                  <p key={i} className={line.alert ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── THREAT MATRIX — Incident Type × Severity ── */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/10 dark:to-orange-950/10">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                <Target className="w-3 h-3 text-white" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.threatMatrix', lang)}</h3>
                <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.incidentTypesSeverity', lang)}</p>
              </div>
            </div>
          </div>
          <div className="p-3">
            {/* Header */}
            <div className="grid grid-cols-[1fr_40px_40px_40px] gap-1 mb-1.5 px-1">
              <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase">{t('command.type', lang)}</span>
              <span className="text-[8px] font-bold text-red-400 uppercase text-center">HI</span>
              <span className="text-[8px] font-bold text-amber-400 uppercase text-center">MD</span>
              <span className="text-[8px] font-bold text-blue-400 uppercase text-center">LO</span>
            </div>
            {/* Rows */}
            <div className="space-y-1">
              {threatMatrix.length === 0 ? (
                <div className="text-center py-4">
                  <Target className="w-6 h-6 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700 mx-auto mb-1" />
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.noIncidentData', lang)}</p>
                </div>
              ) : threatMatrix.map(([type, counts]) => (
                <div key={type} className="grid grid-cols-[1fr_40px_40px_40px] gap-1 items-center px-1 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                  <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate">{type}</span>
                  <div className="flex justify-center">
                    {counts.high > 0 ? (
                      <span className="w-7 h-5 rounded bg-red-500/20 text-red-700 dark:text-red-300 text-[10px] font-bold flex items-center justify-center">{counts.high}</span>
                    ) : (
                      <span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700">—</span>
                    )}
                  </div>
                  <div className="flex justify-center">
                    {counts.medium > 0 ? (
                      <span className="w-7 h-5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center justify-center">{counts.medium}</span>
                    ) : (
                      <span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700">—</span>
                    )}
                  </div>
                  <div className="flex justify-center">
                    {counts.low > 0 ? (
                      <span className="w-7 h-5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center">{counts.low}</span>
                    ) : (
                      <span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── OPERATIONAL ASSESSMENT — Donut + Gauge + Trends ── */}
        <div className="space-y-3">
          {/* Severity Breakdown — Donut */}
          <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('admin.severityDistribution', lang)}</span>
            <div className="flex items-center gap-4 mt-3">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-gray-800" />
                  {stats.total > 0 && <>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ef4444" strokeWidth="3"
                      strokeDasharray={`${(stats.high / stats.total) * 100} ${100 - (stats.high / stats.total) * 100}`} strokeDashoffset="0" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f59e0b" strokeWidth="3"
                      strokeDasharray={`${(stats.medium / stats.total) * 100} ${100 - (stats.medium / stats.total) * 100}`} strokeDashoffset={`${-(stats.high / stats.total) * 100}`} />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3"
                      strokeDasharray={`${(stats.low / stats.total) * 100} ${100 - (stats.low / stats.total) * 100}`} strokeDashoffset={`${-((stats.high + stats.medium) / stats.total) * 100}`} />
                  </>}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-black text-gray-700 dark:text-gray-200">{stats.total}</span>
                </div>
              </div>
              <div className="space-y-1.5 flex-1">
                {([{ s: 'High', n: stats.high, c: 'bg-red-500' }, { s: 'Medium', n: stats.medium, c: 'bg-amber-500' }, { s: 'Low', n: stats.low, c: 'bg-blue-500' }] as const).map(v => (
                  <div key={v.s} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${v.c}`} />
                    <span className="text-[10px] text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-1">{severityLabel(v.s)}</span>
                    <span className="text-[10px] font-bold tabular-nums">{v.n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Verification + Resolution Gauge */}
          <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('admin.verificationRate', lang)}</span>
            <div className="flex items-center gap-4 mt-3">
              <div className="relative w-14 h-14 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-gray-800" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${stats.verifyRate} ${100 - stats.verifyRate}`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400">{stats.verifyRate}%</span>
                </div>
              </div>
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('analytics.mediaAttached', lang)}</p>
                  <p className="text-xs font-bold tabular-nums">{stats.withMedia}<span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-normal">/{stats.total}</span></p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('analytics.resolutionRate', lang)}</p>
                  <p className="text-xs font-bold tabular-nums">{stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* Trend Deltas — Compact */}
          <div className="grid grid-cols-2 gap-2">
            {/* Daily */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 p-3 shadow-sm">
              <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('command.daily', lang)}</span>
              {(() => {
                const delta = commandCenter?.comparative?.dayDeltaPct ?? 0
                const today = commandCenter?.comparative?.today ?? 0
                const yesterday = commandCenter?.comparative?.yesterday ?? 0
                const isNew = yesterday === 0 && today > 0
                return <>
                  <p className={`text-xl font-black tabular-nums mt-1 ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {isNew ? t('command.new', lang) : `${delta > 0 ? '+' : ''}${delta}%`}
                  </p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums">{today} / {yesterday}</p>
                </>
              })()}
            </div>
            {/* Weekly */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 p-3 shadow-sm">
              <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('command.weekly', lang)}</span>
              {(() => {
                const delta = commandCenter?.comparative?.weekDeltaPct ?? 0
                const thisW = commandCenter?.comparative?.thisWeek ?? 0
                const prevW = commandCenter?.comparative?.previousWeek ?? 0
                const isNew = prevW === 0 && thisW > 0
                return <>
                  <p className={`text-xl font-black tabular-nums mt-1 ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {isNew ? t('command.new', lang) : `${delta > 0 ? '+' : ''}${delta}%`}
                  </p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums">{thisW} / {prevW}</p>
                </>
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5 — RECENT REPORTS + AI RECS + QUICK ACTIONS
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Reports — 2 col span */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2 bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-900/50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-aegis-600 flex items-center justify-center"><FileText className="w-3.5 h-3.5 text-white" /></div>
              <div><h2 className="font-bold text-sm">{t('reports.title', lang)}</h2><p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.latestReports', lang)}</p></div>
            </div>
            <div className="flex items-center gap-1.5">
              <select value={recentSort} onChange={e => setRecentSort(e.target.value)} className="text-[10px] px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold">
                <option value="newest">{t('command.newest', lang)}</option>
                <option value="oldest">{t('command.oldest', lang)}</option>
                <option value="severity">{t('common.severity', lang)}</option>
                <option value="ai-high">{t('command.aiHighLow', lang)}</option>
                <option value="ai-low">{t('command.aiLowHigh', lang)}</option>
              </select>
              <button onClick={() => onViewChange('reports')} className="text-[10px] font-semibold text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/30 px-2.5 py-1 rounded-lg transition-colors">{t('reports.all', lang)} {'→'}</button>
              <button onClick={onRefresh} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" /></button>
            </div>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50 max-h-[380px] overflow-y-auto">
            {reports.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-10 h-10 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.noReportsYet', lang)}</p>
              </div>
            ) : sortedReports.map(r => (
              <div key={r.id} className="px-5 py-2.5 hover:bg-gray-50/80 dark:hover:bg-gray-800/30 cursor-pointer flex items-center gap-3 transition-all group" onClick={() => onSelectReport(r)}>
                <div className="relative flex-shrink-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-bold shadow-sm ${r.status === 'Urgent' ? 'bg-gradient-to-br from-red-500 to-red-600' : r.status === 'Verified' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : r.status === 'Flagged' ? 'bg-gradient-to-br from-aegis-500 to-aegis-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                    {r.status === 'Urgent' ? <Siren className="w-3.5 h-3.5" /> : r.status === 'Verified' ? <CheckCircle className="w-3.5 h-3.5" /> : r.status === 'Flagged' ? <Flag className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  </div>
                  {r.status === 'Urgent' && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-ping" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate group-hover:text-aegis-600 transition-colors">{r.type || r.incidentCategory}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0" />{r.location}</p>
                </div>
                <div className="text-right flex-shrink-0 space-y-0.5">
                  <span className={`inline-block text-[10px] px-2 py-0.5 rounded-md font-bold ${r.severity === 'High' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : r.severity === 'Medium' ? 'bg-aegis-100 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{r.severity}</span>
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums">{(r.confidence || 0)}{t('command.percentAi', lang)}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 group-hover:text-aegis-500 transition-colors flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-3">
          {/* Active Alerts */}
          {alerts.length > 0 && (
            <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/20 rounded-2xl ring-1 ring-red-200 dark:ring-red-800/50 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-red-500 flex items-center justify-center"><Bell className="w-3.5 h-3.5 text-white" /></div>
                <span className="text-xs font-bold text-red-800 dark:text-red-300">{t('alerts.title', lang)}</span>
                <span className="ml-auto text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">{alerts.length}</span>
              </div>
              {alerts.slice(0, 3).map((a: any) => (
                <div key={a.id} className="mb-1.5 last:mb-0 bg-white/60 dark:bg-gray-900/40 backdrop-blur rounded-xl px-3 py-2 ring-1 ring-red-100 dark:ring-red-900/30">
                  <p className="text-xs font-semibold text-red-900 dark:text-red-200">{a.title}</p>
                  <p className="text-[10px] text-red-600/70 dark:text-red-400/70 mt-0.5">{new Date(a.timestamp || Date.now()).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          )}

          {/* AI Recommendations */}
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 rounded-2xl ring-1 ring-violet-200 dark:ring-violet-800/50 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Brain className="w-3.5 h-3.5 text-white" /></div>
              <span className="text-xs font-bold text-violet-800 dark:text-violet-300">{t('ai.recommendations', lang)}</span>
            </div>
            <div className="space-y-1.5">
              {(commandCenter?.recommendations || []).slice(0, 4).map((item, idx) => (
                <div key={idx} className={`text-[11px] rounded-xl px-3 py-2 ring-1 backdrop-blur ${item.priority === 'critical' ? 'bg-red-100/60 dark:bg-red-900/20 ring-red-200 dark:ring-red-800/40 text-red-800 dark:text-red-300' : item.priority === 'high' ? 'bg-aegis-100/60 dark:bg-aegis-900/20 ring-aegis-200 dark:ring-aegis-800/40 text-aegis-800 dark:text-aegis-300' : 'bg-blue-100/60 dark:bg-blue-900/20 ring-blue-200 dark:ring-blue-800/40 text-blue-800 dark:text-blue-300'}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.priority === 'critical' ? 'bg-red-500 animate-pulse' : item.priority === 'high' ? 'bg-aegis-500' : 'bg-blue-500'}`} />
                    {item.message}
                  </div>
                </div>
              ))}
              {(!commandCenter?.recommendations || commandCenter.recommendations.length === 0) && (
                <div className="text-center py-3">
                  <Brain className="w-7 h-7 text-violet-300 dark:text-violet-700 mx-auto mb-1" />
                  <p className="text-[11px] text-violet-500/70">{t('command.allSystemsNominal', lang)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('command.quickActions', lang)}</span>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => onViewChange('alert_send')} className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 px-3 py-2.5 rounded-xl ring-1 ring-red-200 dark:ring-red-800/40 transition-all hover:shadow-md">
                <Bell className="w-4 h-4" /> {t('command.sendAlert', lang)}
              </button>
              <button onClick={() => onViewChange('reports')} className="flex items-center gap-2 text-xs font-semibold text-aegis-700 dark:text-aegis-300 bg-aegis-50 dark:bg-aegis-950/30 hover:bg-aegis-100 dark:hover:bg-aegis-950/50 px-3 py-2.5 rounded-xl ring-1 ring-aegis-200 dark:ring-aegis-800/40 transition-all hover:shadow-md">
                <FileText className="w-4 h-4" /> {t('command.allReports', lang)}
              </button>
              <button onClick={() => onViewChange('analytics')} className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 px-3 py-2.5 rounded-xl ring-1 ring-blue-200 dark:ring-blue-800/40 transition-all hover:shadow-md">
                <Activity className="w-4 h-4" /> {t('command.analytics', lang)}
              </button>
              <button onClick={() => onViewChange('map')} className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 px-3 py-2.5 rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-800/40 transition-all hover:shadow-md">
                <Map className="w-4 h-4" /> {t('command.liveMap', lang)}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6 — LEADERBOARD + LIVE ACTIVITY STREAM
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Officer Leaderboard */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-aegis-50 to-orange-50 dark:from-aegis-950/10 dark:to-orange-950/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-orange-500 flex items-center justify-center"><Users className="w-3.5 h-3.5 text-white" /></div>
              <div><h3 className="font-bold text-sm">{t('command.officerLeaderboard', lang)}</h3><p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.last7DaysPerf', lang)}</p></div>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {(commandCenter?.leaderboard || []).map((row, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`
              return (
                <div key={`${row.operator}-${idx}`} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl px-4 py-2.5 ring-1 ring-gray-100 dark:ring-gray-800 hover:ring-aegis-300 dark:hover:ring-aegis-700 transition-all group">
                  <span className="text-sm w-7 text-center flex-shrink-0">{medal}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate group-hover:text-aegis-600 transition-colors">{row.operator}</p>
                    <div className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums flex items-center gap-1.5 flex-wrap">
                      <span>{row.handled} {t('command.handled', lang)}</span>
                      <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                      <span>{row.actions} {t('command.actions', lang)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-black text-aegis-600 tabular-nums">{fmtMinsLocalized(row.avgResponseMinutes, lang)}</p>
                    <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.avgResp', lang)}</p>
                  </div>
                </div>
              )
            })}
            {(!commandCenter?.leaderboard || commandCenter.leaderboard.length === 0) && (
              <div className="text-center py-6">
                <Users className="w-10 h-10 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.noLeaderboardData', lang)}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{t('command.operatorActionsAppear', lang)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Stream */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/10 dark:to-blue-950/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"><Activity className="w-3.5 h-3.5 text-white" /></div>
              <div><h3 className="font-bold text-sm">{t('command.liveActivityStream', lang)}</h3><p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.realTimeActions', lang)}</p></div>
              <span className="ml-auto flex items-center gap-1 text-[9px] text-green-500 font-bold"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />{t('common.live', lang)}</span>
            </div>
          </div>
          <div className="p-4 space-y-1.5 max-h-[320px] overflow-y-auto">
            {(() => {
              const allEntries = commandCenter?.activity || []
              const visibleEntries = activityShowAll ? allEntries : allEntries.slice(0, 12)
              if (allEntries.length === 0) return (
                <div className="text-center py-6">
                  <Activity className="w-10 h-10 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('command.noActivityYet', lang)}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{t('command.actionsStreamHere', lang)}</p>
                </div>
              )
              return (
                <>
                  {visibleEntries.map((entry, idx) => {
                    const mins = Math.floor((Date.now() - new Date(entry.created_at).getTime()) / 60000)
                    const timeAgo = formatRelativeTime(mins, lang)
                    const iconBg = entry.action_type === 'verify' ? 'from-emerald-500 to-green-500' : entry.action_type === 'flag' ? 'from-aegis-500 to-orange-500' : entry.action_type === 'urgent' ? 'from-red-500 to-rose-500' : entry.action_type === 'resolve' ? 'from-gray-400 to-gray-500' : entry.action_type === 'alert_send' ? 'from-red-600 to-rose-600' : 'from-blue-500 to-cyan-500'
                    return (
                      <div key={`${entry.id || idx}`} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors group">
                        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${iconBg} flex items-center justify-center text-white flex-shrink-0 shadow-sm`}>
                          {entry.action_type === 'verify' ? <CheckCircle className="w-3.5 h-3.5" /> : entry.action_type === 'flag' ? <Flag className="w-3.5 h-3.5" /> : entry.action_type === 'urgent' ? <Siren className="w-3.5 h-3.5" /> : <Activity className="w-3.5 h-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{entry.action}</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{entry.operator_name || t('common.system', lang)}</p>
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0 tabular-nums">{timeAgo}</span>
                      </div>
                    )
                  })}
                  {allEntries.length > 12 && (
                    <button
                      onClick={() => setActivityShowAll(prev => !prev)}
                      className="w-full text-[10px] font-semibold text-cyan-600 hover:text-cyan-700 py-2 border-t border-gray-100 dark:border-gray-800 mt-1 transition-colors"
                    >
                      {activityShowAll ? `${t('common.showLess', lang)} ▲` : `${t('common.showMore', lang)} ${allEntries.length - 12} ▼`}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 7 — INCIDENT COMMAND CONSOLE
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-5 shadow-sm">
        <IncidentCommandConsole
          onSelectIncident={(id) => { if (id) onFilterType(id); else onFilterType('all') }}
          selectedIncidentId={filterType !== 'all' ? filterType : null}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 8 — INCIDENT QUEUE
          ═══════════════════════════════════════════════════════════════ */}
      <IncidentQueue
        reports={reports}
        currentUser={user}
        onNotify={pushNotification}
      />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 9 — REPORT PIPELINE
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-5 shadow-sm">
        <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('command.reportPipeline', lang)}</span>
        <div className="flex items-center gap-2 mt-4">
          {([
            { label: t('command.urgent', lang), count: stats.urgent, color: 'bg-red-500', pct: stats.total > 0 ? (stats.urgent / stats.total) * 100 : 0 },
            { label: t('command.unverified', lang), count: stats.unverified, color: 'bg-aegis-400', pct: stats.total > 0 ? (stats.unverified / stats.total) * 100 : 0 },
            { label: t('command.verified', lang), count: stats.verified, color: 'bg-emerald-500', pct: stats.total > 0 ? (stats.verified / stats.total) * 100 : 0 },
            { label: t('command.flagged', lang), count: stats.flagged, color: 'bg-orange-500', pct: stats.total > 0 ? (stats.flagged / stats.total) * 100 : 0 },
            { label: t('command.resolved', lang), count: stats.resolved, color: 'bg-gray-400', pct: stats.total > 0 ? (stats.resolved / stats.total) * 100 : 0 },
          ] as const).map((stage, i, arr) => (
            <React.Fragment key={stage.label}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{stage.label}</span>
                  <span className="text-xs font-black tabular-nums">{stage.count}</span>
                </div>
                <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${stage.color} transition-all duration-700`} style={{ width: `${Math.max(stage.pct, stage.count > 0 ? 8 : 0)}%` }} />
                </div>
                <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1 text-center tabular-nums">{Math.round(stage.pct)}%</p>
              </div>
              {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-700 flex-shrink-0 mt-1" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 10 — CLIMATE RISK DASHBOARD
          ═══════════════════════════════════════════════════════════════ */}
      <ClimateRiskDashboard />
    </div>
  )
}





