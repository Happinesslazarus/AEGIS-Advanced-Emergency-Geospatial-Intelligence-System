/**
 * Command center dashboard (real-time operational overview).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import React, { useState, useEffect, useMemo, memo } from 'react'
import {
  AlertTriangle, CheckCircle, Clock, Users, Activity,
  FileText, Bell, Map, Download, RefreshCw, Flag, Siren, Brain,
  MapPin, ChevronRight, CheckCircle2, Radio,
  Database, Zap, Target, Copy,
  ChevronDown, ChevronUp, ShieldAlert, Trophy, Medal, Award, Mail
} from 'lucide-react'
import IncidentQueue from './IncidentQueue'
import ClimateRiskDashboard from '../shared/ClimateRiskDashboard'
import ErrorBoundary from '../shared/ErrorBoundary'
import { t } from '../../utils/i18n'
import type { Report } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'

/* Isolated clock component -- ticks every second without re-rendering the entire CommandCenter tree. */
const MissionClock = memo(function MissionClock({ dateLocale, lang }: { dateLocale: string; lang: string }) {
  const [clock, setClock] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <>
      <span className="text-white font-mono text-lg font-bold tabular-nums tracking-wider">
        {clock.toLocaleTimeString(dateLocale, { hour12: false })}
      </span>
      <span className="text-gray-400 text-xs font-mono">
        {clock.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
      </span>
    </>
  )
})

//THREAT LEVEL CONFIGURATION
const THREAT_LEVELS = {
  NORMAL:   { label: 'NORMAL',   color: 'from-emerald-600 to-green-700',  text: 'text-emerald-100', dot: 'bg-emerald-400', desc: 'No significant threats -- all systems nominal' },
  ELEVATED: { label: 'ELEVATED', color: 'from-blue-600 to-cyan-700',      text: 'text-blue-100',    dot: 'bg-blue-400',    desc: 'Increased monitoring recommended' },
  HIGH:     { label: 'HIGH',     color: 'from-amber-500 to-orange-600',   text: 'text-amber-100',   dot: 'bg-amber-400',   desc: 'Active incidents require coordinated response' },
  SEVERE:   { label: 'SEVERE',   color: 'from-orange-600 to-red-600',     text: 'text-orange-100',  dot: 'bg-orange-300',  desc: 'Multiple critical incidents -- elevated response posture' },
  CRITICAL: { label: 'CRITICAL', color: 'from-red-600 to-red-800',        text: 'text-red-100',     dot: 'bg-red-300',     desc: 'Maximum response posture -- immediate action required' },
} as const

type ThreatLevel = keyof typeof THREAT_LEVELS

function getLocalizedThreatLevels(lang: string) {
  return {
    NORMAL: { ...THREAT_LEVELS.NORMAL, label: 'NORMAL', desc: 'No significant threats - all systems nominal' },
    ELEVATED: { ...THREAT_LEVELS.ELEVATED, label: 'ELEVATED', desc: 'Increased monitoring recommended' },
    HIGH: { ...THREAT_LEVELS.HIGH, label: 'HIGH', desc: 'Active incidents require coordinated response' },
    SEVERE: { ...THREAT_LEVELS.SEVERE, label: 'SEVERE', desc: 'Multiple critical incidents - elevated response posture' },
    CRITICAL: { ...THREAT_LEVELS.CRITICAL, label: 'CRITICAL', desc: 'Maximum response posture - immediate action required' },
  } as const
}

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
  socketConnected?: boolean
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

const fmtMinsLocalized = (v: number, lang: string): string => {
  if (!v || v < 60) return `${v || 0}${'m'}`
  return `${Math.floor(v / 60)}${'h'} ${v % 60}${'m'}`
}

const formatRelativeTime = (mins: number, lang: string): string => {
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}${'m'} ${'ago'}`
  if (mins < 1440) return `${Math.floor(mins / 60)}${'h'} ${'ago'}`
  return `${Math.floor(mins / 1440)}${'d'} ${'ago'}`
}

export default function CommandCenter({
  stats, commandCenter, reports, alerts, user,
  socketConnected,
  onViewChange, onSelectReport, onRefresh, onFilterType, filterType,
  pushNotification, exportCommandCenter,
  recentSort, setRecentSort, activityShowAll, setActivityShowAll,
}: CommandCenterProps) {
  const lang = useLanguage() // authoritative source -- ignores lang prop

  const [sitrepOpen, setSitrepOpen] = useState(true)
  const [sitrepCopied, setSitrepCopied] = useState(false)
  const [showKeyboard, setShowKeyboard] = useState(false)
  const now = useMemo(() => new Date(), [commandCenter]) // refresh timestamp when data updates

  const dateLocale = useMemo(() => {
    const map: Record<string, string> = { ar: 'ar-EG', es: 'es-ES', fr: 'fr-FR', zh: 'zh-CN', hi: 'hi-IN', pt: 'pt-BR', pl: 'pl-PL', ur: 'ur-PK' }
    return map[lang] || 'en-GB'
  }, [lang])

  // Auto-calculate threat level
  const threatLevel: ThreatLevel = useMemo(() => {
    if (stats.urgent >= 5 || (stats.urgent >= 3 && stats.trapped > 0)) return 'CRITICAL'
    if (stats.urgent >= 3 || stats.trapped > 0) return 'SEVERE'
    if (stats.urgent >= 1 || stats.high >= 4) return 'HIGH'
    if (stats.high >= 2 || stats.flagged >= 3) return 'ELEVATED'
    return 'NORMAL'
  }, [stats])

  const threat = getLocalizedThreatLevels(lang)[threatLevel]

  // Threat matrix: incident types × severity
  const threatMatrix = useMemo(() => {
    const matrix: Record<string, { high: number; medium: number; low: number; total: number }> = {}
    reports.forEach(r => {
      const cat = r.type || r.incidentCategory || 'Unknown'
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

  // Auto-generated SitRep -- Advanced Intelligence Briefing
  const sitrepLines = useMemo(() => {
    const lines: Array<{ text: string; alert?: boolean; section?: string }> = []
    const resRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0
    const delta = commandCenter?.comparative?.weekDeltaPct ?? 0
    const dayDelta = commandCenter?.comparative?.dayDeltaPct ?? 0
    const today = commandCenter?.comparative?.today ?? 0
    const yesterday = commandCenter?.comparative?.yesterday ?? 0
    const backlogPct = stats.total > 0 ? Math.round((stats.unverified / stats.total) * 100) : 0

    // SECTION: EXECUTIVE SUMMARY
    lines.push({ text: 'EXECUTIVE SUMMARY', section: 'header' })
    lines.push({ text: `${stats.total} incident${stats.total !== 1 ? 's' : ''} currently under management across all monitored regions. Operational readiness: ${resRate >= 80 ? 'OPTIMAL' : resRate >= 50 ? 'DEGRADED' : 'CRITICAL'}.` })

    // SECTION: CRITICAL ALERTS
    if (stats.urgent > 0 || stats.trapped > 0) {
      lines.push({ text: 'PRIORITY ALERTS', section: 'header' })
      if (stats.urgent > 0) lines.push({ text: `${stats.urgent} incident${stats.urgent !== 1 ? 's' : ''} classified URGENT -- immediate operator action required.`, alert: true })
      if (stats.trapped > 0) lines.push({ text: `SEARCH AND RESCUE: ${stats.trapped} person${stats.trapped !== 1 ? 's' : ''} reported trapped -- life-safety operations in progress.`, alert: true })
    }

    // SECTION: OPERATIONAL METRICS
    lines.push({ text: 'OPERATIONAL METRICS', section: 'header' })
    lines.push({ text: `Verification pipeline: ${stats.verified} verified, ${stats.unverified} pending (${backlogPct}% backlog). Clearance rate: ${resRate}%.` })
    if (stats.flagged > 0) lines.push({ text: `${stats.flagged} report${stats.flagged !== 1 ? 's' : ''} flagged for priority review -- elevated scrutiny recommended.` })
    lines.push({ text: `AI triage engine confidence: ${stats.avgConf}% average accuracy across all classifications.` })
    if (stats.withMedia > 0) lines.push({ text: `Evidence base: ${stats.withMedia} report${stats.withMedia !== 1 ? 's' : ''} include media attachments (${stats.total > 0 ? Math.round((stats.withMedia / stats.total) * 100) : 0}% coverage).` })

    // SECTION: SEVERITY DISTRIBUTION
    lines.push({ text: 'SEVERITY DISTRIBUTION', section: 'header' })
    const sevTotal = stats.high + stats.medium + stats.low
    if (sevTotal > 0) {
      const highPct = Math.round((stats.high / sevTotal) * 100)
      const medPct = Math.round((stats.medium / sevTotal) * 100)
      const lowPct = Math.round((stats.low / sevTotal) * 100)
      lines.push({ text: `HIGH: ${stats.high} (${highPct}%) | MEDIUM: ${stats.medium} (${medPct}%) | LOW: ${stats.low} (${lowPct}%)` })
      if (highPct > 40) lines.push({ text: 'WARNING: High-severity incidents exceed 40% threshold -- additional resources may be required.', alert: true })
    } else {
      lines.push({ text: 'No severity data available.' })
    }

    // SECTION: DISASTER TYPE ANALYSIS
    if (threatMatrix.length > 0) {
      lines.push({ text: 'DISASTER TYPE ANALYSIS', section: 'header' })
      const topType = threatMatrix[0]
      lines.push({ text: `Primary threat vector: ${topType[0]} (${topType[1].total} incident${topType[1].total !== 1 ? 's' : ''}, ${topType[1].high} high-severity).` })
      if (threatMatrix.length > 1) {
        const activeTypes = threatMatrix.filter(([, c]) => c.total > 0).map(([t]) => t)
        lines.push({ text: `Active disaster categories (${activeTypes.length}): ${activeTypes.slice(0, 5).join(', ')}${activeTypes.length > 5 ? ` +${activeTypes.length - 5} more` : ''}.` })
      }
      //Multi-hazard warning
      const multiHigh = threatMatrix.filter(([, c]) => c.high >= 2)
      if (multiHigh.length >= 2) {
        lines.push({ text: `MULTI-HAZARD CONDITION: ${multiHigh.length} disaster types with 2+ high-severity incidents simultaneously -- compound risk elevated.`, alert: true })
      }
    }

    // SECTION: GEOGRAPHIC INTELLIGENCE
    if (reports.length > 0) {
      lines.push({ text: 'GEOGRAPHIC INTELLIGENCE', section: 'header' })
      const locationCounts: Record<string, number> = {}
      reports.forEach(r => {
        const loc = (r.location || '').split(',').map(s => s.trim()).filter(Boolean)
        const region = loc.length >= 2 ? loc[loc.length - 1] : loc[0] || 'Unknown'
        locationCounts[region] = (locationCounts[region] || 0) + 1
      })
      const sortedLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1])
      if (sortedLocations.length > 0) {
        const hotspot = sortedLocations[0]
        lines.push({ text: `Incident concentration hotspot: ${hotspot[0]} (${hotspot[1]} report${hotspot[1] !== 1 ? 's' : ''}).` })
        if (sortedLocations.length > 1) {
          const affected = sortedLocations.filter(([, c]) => c > 0).length
          lines.push({ text: `${affected} distinct region${affected !== 1 ? 's' : ''} reporting incidents. Geographic spread: ${affected >= 5 ? 'WIDESPREAD' : affected >= 3 ? 'MODERATE' : 'LOCALIZED'}.` })
        }
      }
    }

    // SECTION: TREND ANALYSIS
    lines.push({ text: 'TREND ANALYSIS', section: 'header' })
    if (dayDelta !== 0) {
      lines.push({ text: `24h trend: ${dayDelta > 0 ? 'ESCALATING' : 'DE-ESCALATING'} -- ${Math.abs(dayDelta)}% ${dayDelta > 0 ? 'increase' : 'decrease'} vs. yesterday (${today} today vs. ${yesterday} yesterday).` })
    } else if (today > 0) {
      lines.push({ text: `24h trend: STABLE -- incident volume unchanged from previous day (${today} incidents).` })
    }
    if (delta !== 0) {
      lines.push({ text: `7-day trend: ${delta > 0 ? 'RISING' : 'DECLINING'} -- weekly volume ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}% vs. prior period.` })
      if (delta > 50) lines.push({ text: 'ALERT: Weekly incident volume surge exceeds 50% -- potential emerging crisis pattern.', alert: true })
    }

    // SECTION: RESPONSE EFFECTIVENESS
    lines.push({ text: 'RESPONSE EFFECTIVENESS', section: 'header' })
    if (resRate >= 80) {
      lines.push({ text: `Resolution rate at ${resRate}% -- exceeds 80% operational benchmark. Response posture: EFFECTIVE.` })
    } else if (resRate >= 50) {
      lines.push({ text: `Resolution rate at ${resRate}% -- below 80% benchmark. Recommend: increase operator allocation or escalate to mutual aid.` })
    } else {
      lines.push({ text: `Resolution rate at ${resRate}% -- CRITICAL. Significant backlog accumulating. Immediate resource reinforcement required.`, alert: true })
    }
    const leaderboard = commandCenter?.leaderboard || []
    if (leaderboard.length > 0) {
      const totalHandled = leaderboard.reduce((s, r) => s + r.handled, 0)
      const avgResp = leaderboard.length > 0 ? Math.round(leaderboard.reduce((s, r) => s + r.avgResponseMinutes, 0) / leaderboard.length) : 0
      lines.push({ text: `${leaderboard.length} operator${leaderboard.length !== 1 ? 's' : ''} active -- ${totalHandled} incidents handled, avg. response: ${fmtMinsLocalized(avgResp, lang)}.` })
    }

    // SECTION: AI RECOMMENDATIONS
    const recs = commandCenter?.recommendations || []
    if (recs.length > 0) {
      lines.push({ text: 'AI RECOMMENDATIONS', section: 'header' })
      const critRecs = recs.filter(r => r.priority === 'critical')
      const highRecs = recs.filter(r => r.priority === 'high')
      lines.push({ text: `${recs.length} AI-generated recommendation${recs.length !== 1 ? 's' : ''} pending: ${critRecs.length} critical, ${highRecs.length} high, ${recs.length - critRecs.length - highRecs.length} medium.` })
      critRecs.slice(0, 2).forEach(r => lines.push({ text: `[CRITICAL] ${r.message}`, alert: true }))
    }

    // FOOTER
    lines.push({ text: 'END OF BRIEFING', section: 'header' })

    return lines
  }, [stats, commandCenter, reports, threatMatrix, lang])

  // Systems status -- derived from available data
  const systems = useMemo(() => [
    { name: 'AI Engine',  icon: Brain,    ok: stats.avgConf > 0 },
    { name: 'Workflows', icon: Zap,      ok: commandCenter !== null && stats.total > 0 },
    { name: 'Database',  icon: Database, ok: commandCenter !== null },
    { name: 'Real-time',  icon: Radio,    ok: socketConnected === true },
    { name: 'Comms',     icon: Mail,     ok: Array.isArray(alerts) },
  ], [stats.avgConf, stats.total, commandCenter, socketConnected, alerts, lang])

  // Sorted recent reports
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

  const severityLabel = (v: string) => v === 'High' ? 'High' : v === 'Medium' ? 'Medium' : 'Low'

  //Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onRefresh() }
      else if (key === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const text = `${'OPBRIEF'} -- ${now.toLocaleDateString(dateLocale)}\n${'THREAT POSTURE'}: ${threat.label}\n${sitrepLines.map(l => l.text).join('\n')}`
        navigator.clipboard.writeText(text).then(() => { setSitrepCopied(true); setTimeout(() => setSitrepCopied(false), 2000) }).catch(() => {})
      }
      else if (key === 'e') { e.preventDefault(); exportCommandCenter('csv') }
      else if (key === 'j') { e.preventDefault(); exportCommandCenter('json') }
      else if (key === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setSitrepOpen(p => !p) }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onRefresh, exportCommandCenter, lang, now, dateLocale, threat.label, sitrepLines])

  return (
    <div className="space-y-4 animate-fade-in">

      {/*
          SECTION 1 -- THREAT LEVEL BANNER
           */}
      <div role="alert" aria-live="assertive" className={`relative overflow-hidden bg-gradient-to-r ${threat.color} rounded-2xl p-4 shadow-lg animate-scale-in`}>
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
                  <span className={`text-xs font-bold uppercase tracking-[0.2em] ${threat.text} opacity-80`}>{'Threat Level'}</span>
                  <span className={`text-lg font-black tracking-wide ${threat.text}`}>{threat.label}</span>
                  <span className={`w-2 h-2 rounded-full ${threat.dot} ${threatLevel !== 'NORMAL' ? 'animate-pulse' : ''}`} />
                </div>
                <p className={`text-xs ${threat.text} opacity-90 mt-0.5`}>{threat.desc}</p>
              </div>
            </div>
          </div>

          <div className={`flex items-center gap-4 ${threat.text}`}>
            <div className="text-right">
              <p className="text-xs opacity-90 uppercase tracking-wider font-semibold">{'Urgent'}</p>
              <p className="text-xl font-black tabular-nums">{stats.urgent}</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-right">
              <p className="text-xs opacity-90 uppercase tracking-wider font-semibold">{'Total'}</p>
              <p className="text-xl font-black tabular-nums">{stats.total}</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-right">
              <p className="text-xs opacity-90 uppercase tracking-wider font-semibold">{'Trapped'}</p>
              <p className="text-xl font-black tabular-nums">{stats.trapped}</p>
            </div>
          </div>
        </div>
      </div>

      {/*
          SECTION 2 -- MISSION CLOCK + SYSTEMS STATUS BAR
           */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-gray-900 dark:bg-gray-950 rounded-xl px-4 py-2.5 ring-1 ring-gray-800">
        {/* Live Clock -- isolated component to prevent 1/sec re-render of entire tree */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest">{'Live'}</span>
          </div>
          <MissionClock dateLocale={dateLocale} lang={lang} />
        </div>

        {/* Systems Status */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {systems.map(sys => (
            <div key={sys.name} className="flex items-center gap-1 sm:gap-1.5" title={sys.name}>
              <sys.icon className="w-3 h-3 text-gray-500 dark:text-gray-300" />
              <span className="text-[10px] text-gray-400 dark:text-gray-300 font-medium hidden sm:inline">{sys.name}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${sys.ok ? 'bg-green-400' : 'bg-red-400'}`} />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-300 font-mono tabular-nums">
            {commandCenter?.generatedAt ? `${'DATA'} ${new Date(commandCenter.generatedAt).toLocaleTimeString(dateLocale, { hour12: false })}` : ''}
          </span>
          <button onClick={() => exportCommandCenter('csv')} disabled={!commandCenter} aria-label={'Export as CSV'} className="text-[10px] text-gray-400 dark:text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded font-mono transition-colors disabled:opacity-30"><Download className="w-3 h-3 inline mr-1" />CSV</button>
          <button onClick={() => exportCommandCenter('json')} disabled={!commandCenter} aria-label={'Export as JSON'} className="text-[10px] text-gray-400 dark:text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded font-mono transition-colors disabled:opacity-30"><Download className="w-3 h-3 inline mr-1" />JSON</button>
          <button onClick={onRefresh} aria-label={'REFRESH'} className="text-[10px] text-gray-400 dark:text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded font-mono transition-colors"><RefreshCw className="w-3 h-3 inline mr-1" />{'REFRESH'}</button>
        </div>
      </div>

      {/*
          SECTION 3 -- KPI METRICS (8 cards)
           */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {([
          { l: 'Total',      v: stats.total,          g: 'from-slate-500/10 to-slate-500/5 dark:from-slate-400/10 dark:to-slate-400/5',   ring: 'ring-slate-200 dark:ring-slate-700',    c: 'text-slate-900 dark:text-white',            i: FileText,     ic: 'text-slate-400',                    filter: '' },
          { l: 'Urgent',     v: stats.urgent,         g: 'from-red-500/10 to-red-500/5 dark:from-red-500/15 dark:to-red-500/5',            ring: 'ring-red-200 dark:ring-red-800',        c: 'text-red-600 dark:text-red-400',            i: Siren,        ic: 'text-red-400',     pulse: stats.urgent > 0, filter: 'urgent' },
          { l: 'Unverified', v: stats.unverified,     g: 'from-aegis-500/10 to-aegis-500/5 dark:from-aegis-500/15 dark:to-aegis-500/5',    ring: 'ring-aegis-200 dark:ring-aegis-800',    c: 'text-aegis-600 dark:text-aegis-400',        i: Clock,        ic: 'text-aegis-400',                    filter: 'unverified' },
          { l: 'Verified',   v: stats.verified,       g: 'from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/15 dark:to-emerald-500/5', ring: 'ring-emerald-200 dark:ring-emerald-800', c: 'text-emerald-600 dark:text-emerald-400', i: CheckCircle,  ic: 'text-emerald-400',                  filter: 'verified' },
          { l: 'Flagged',    v: stats.flagged,        g: 'from-orange-500/10 to-orange-500/5 dark:from-orange-500/15 dark:to-orange-500/5',  ring: 'ring-orange-200 dark:ring-orange-800',  c: 'text-orange-600 dark:text-orange-400',      i: Flag,         ic: 'text-orange-400',                   filter: 'flagged' },
          { l: 'Resolved',   v: stats.resolved,       g: 'from-gray-500/10 to-gray-500/5 dark:from-gray-400/10 dark:to-gray-400/5',          ring: 'ring-gray-200 dark:ring-gray-700',      c: 'text-gray-500 dark:text-gray-300',          i: CheckCircle2, ic: 'text-gray-400 dark:text-gray-300',  filter: 'resolved' },
          { l: 'Avg AI',      v: `${stats.avgConf}%`,  g: 'from-violet-500/10 to-violet-500/5 dark:from-violet-500/15 dark:to-violet-500/5',  ring: 'ring-violet-200 dark:ring-violet-800',  c: 'text-violet-600 dark:text-violet-400',      i: Brain,        ic: 'text-violet-400',                   filter: '' },
          { l: 'Trapped',    v: stats.trapped,        g: 'from-fuchsia-500/10 to-fuchsia-500/5 dark:from-fuchsia-500/15 dark:to-fuchsia-500/5', ring: 'ring-fuchsia-200 dark:ring-fuchsia-800', c: 'text-fuchsia-600 dark:text-fuchsia-400', i: AlertTriangle, ic: 'text-fuchsia-400',                  filter: 'trapped' },
        ] as const).map((s, i) => (
          <button
            key={i}
            onClick={() => { if (s.filter) { onFilterType(s.filter); onViewChange('reports') } }}
            className={`stat-card-enter relative overflow-hidden bg-gradient-to-br ${s.g} backdrop-blur-sm rounded-2xl p-3 ring-1 ${s.ring} hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 group text-left ${s.filter ? 'cursor-pointer' : 'cursor-default'}`}
            style={{ animationDelay: `${i * 60}ms` }}
            title={s.filter ? `View ${s.l} reports` : undefined}
          >
            <div className="flex items-center justify-between mb-1.5">
              <s.i className={`w-4 h-4 ${s.ic} group-hover:scale-110 transition-transform`} />
              {'pulse' in s && s.pulse && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />}
            </div>
            <p className={`text-2xl font-black tabular-nums tracking-tight ${s.c}`}>{s.v}</p>
            <p className="text-[9px] text-gray-500 dark:text-gray-300 font-bold uppercase tracking-wider mt-0.5">{s.l}</p>
            {s.filter && <ChevronRight className="absolute bottom-2 right-2 w-3 h-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </button>
        ))}
      </div>

      {/*
          SECTION 4 -- SITUATION BRIEFING + THREAT MATRIX + ASSESSMENT
           */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>

        {/*  SITREP -- Advanced Situation Intelligence Brief  */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          {/* Header bar */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-slate-50 to-gray-50 dark:from-gray-900 dark:to-gray-900/50">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center">
                <FileText className="w-3 h-3 text-white dark:text-gray-900" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">{'Situation Brief'}</h3>
                <p className="text-[9px] text-gray-400 dark:text-gray-300">
                  {now.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()} {now.toLocaleTimeString(dateLocale, { hour12: false })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { const text = `${'OPBRIEF'} -- ${now.toLocaleDateString(dateLocale)}\n${'THREAT POSTURE'}: ${threat.label}\n${sitrepLines.map(l => l.text).join('\n')}`; navigator.clipboard.writeText(text).then(() => { setSitrepCopied(true); setTimeout(() => setSitrepCopied(false), 2000) }).catch(() => {}) }}
                className="flex items-center gap-1 text-[9px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-white dark:bg-gray-700 px-2 py-1 rounded-lg ring-1 ring-gray-200 dark:ring-gray-600 transition-all hover:shadow-sm"
                title={'Copy SitRep to clipboard'}
              >
                {sitrepCopied ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                {sitrepCopied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={() => setSitrepOpen(p => !p)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                {sitrepOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
            </div>
          </div>

          {/* Threat posture mini-bar */}
          <div className={`flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r ${threat.color} flex-shrink-0`}>
            <div className="flex items-center gap-2">
              <ShieldAlert className={`w-3.5 h-3.5 ${threat.text}`} />
              <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${threat.text}`}>
                {'THREAT POSTURE'}: {threat.label}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${threat.dot} ${threatLevel !== 'NORMAL' ? 'animate-pulse' : ''}`} />
            </div>
            <div className={`flex items-center gap-3 text-[10px] font-bold tabular-nums ${threat.text}`}>
              <span>{stats.total} incidents</span>
              <span className="w-px h-3 bg-white/30" />
              <span>{stats.urgent} urgent</span>
              {stats.trapped > 0 && <><span className="w-px h-3 bg-white/30" /><span className="animate-pulse">{stats.trapped} trapped</span></>}
            </div>
          </div>

          {/* Collapsible brief body -- fixed height, internal scroll */}
          {sitrepOpen && (
            <div className="overflow-y-auto max-h-[280px] p-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700">
              {/* Quick summary badges row */}
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const alertCount = sitrepLines.filter(l => l.alert).length
                  const resRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0
                  return (
                    <>
                      {alertCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-1 ring-red-200/50 dark:ring-red-800/50 animate-pulse">
                          <AlertTriangle className="w-2.5 h-2.5" /> {alertCount} alerts
                        </span>
                      )}
                      {stats.avgConf > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 ring-1 ring-violet-200/50 dark:ring-violet-800/50">
                          <Brain className="w-2.5 h-2.5" /> AI {stats.avgConf}%
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ring-1 ${resRate >= 80 ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 ring-green-200/50 dark:ring-green-800/50' : resRate >= 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 ring-amber-200/50 dark:ring-amber-800/50' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-red-200/50 dark:ring-red-800/50'}`}>
                        <CheckCircle className="w-2.5 h-2.5" /> {resRate}% resolved
                      </span>
                    </>
                  )
                })()}
              </div>
              {/* Monospace intelligence writeup */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 ring-1 ring-gray-100 dark:ring-gray-700 font-mono text-[11px] text-gray-700 dark:text-gray-300 space-y-1.5 leading-relaxed">
                {sitrepLines.map((line, i) => (
                  line.section === 'header' ? (
                    <p key={i} className="text-[8px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-[0.2em] mt-2 mb-0.5 border-t border-gray-200/50 dark:border-gray-700/50 pt-2 first:border-t-0 first:pt-0 first:mt-0">
                      {line.text}
                    </p>
                  ) : (
                    <p key={i} className={`flex items-start gap-2 ${line.alert ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${line.alert ? 'bg-red-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span>{line.text}</span>
                    </p>
                  )
                ))}
              </div>
              {/* AI Recommendations */}
              {(commandCenter?.recommendations || []).length > 0 && (
                <div className="bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-950/20 dark:to-purple-950/10 rounded-xl p-3 ring-1 ring-violet-200/60 dark:ring-violet-800/30">
                  <p className="text-[9px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Brain className="w-3 h-3" />
                    {'AI Recommendations'}
                  </p>
                  <div className="space-y-1 font-mono">
                    {commandCenter!.recommendations.slice(0, 3).map((rec, i) => (
                      <p key={i} className="text-[11px] text-violet-800 dark:text-violet-300 flex items-start gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${rec.priority === 'critical' ? 'bg-red-500 animate-pulse' : rec.priority === 'high' ? 'bg-amber-500' : 'bg-blue-400'}`} />
                        <span>{rec.message}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/*  THREAT MATRIX -- Incident Type × Severity  */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/10 dark:to-orange-950/10">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                <Target className="w-3 h-3 text-white" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">{'Threat Matrix'}</h3>
                <p className="text-[9px] text-gray-400 dark:text-gray-300">{'Incident types × severity'}</p>
              </div>
            </div>
          </div>
          <div className="p-3">
            {/* Header */}
            <div className="grid grid-cols-[1fr_32px_32px_32px_36px] sm:grid-cols-[1fr_40px_40px_40px_44px] gap-1 mb-1.5 px-1">
              <span className="text-[8px] font-bold text-gray-400 dark:text-gray-300 uppercase">{'Type'}</span>
              <span className="text-[8px] font-bold text-red-400 uppercase text-center">{'HI'}</span>
              <span className="text-[8px] font-bold text-amber-400 uppercase text-center">{'MD'}</span>
              <span className="text-[8px] font-bold text-blue-400 uppercase text-center">{'LO'}</span>
              <span className="text-[8px] font-bold text-gray-500 dark:text-gray-400 uppercase text-center">{'Σ'}</span>
            </div>
            {/* Rows */}
            <div className="space-y-1">
              {threatMatrix.length === 0 ? (
                <div className="text-center py-4">
                  <Target className="w-6 h-6 text-gray-300 dark:text-gray-700 mx-auto mb-1" />
                  <p className="text-[10px] text-gray-400 dark:text-gray-300">{'No incident data'}</p>
                </div>
              ) : (<>
                {threatMatrix.map(([type, counts], idx) => {
                  const isDominant = idx === 0 && counts.total > 0
                  const intensity = Math.min(counts.total / Math.max(1, threatMatrix[0][1].total), 1)
                  return (
                    <div key={type}
                      role="button" tabIndex={0}
                      onClick={() => { onFilterType(type); onViewChange('reports') }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFilterType(type); onViewChange('reports') } }}
                      className={`grid grid-cols-[1fr_32px_32px_32px_36px] sm:grid-cols-[1fr_40px_40px_40px_44px] gap-1 items-center px-1.5 py-1.5 rounded-lg cursor-pointer transition-all animate-fade-in ${
                        isDominant ? 'bg-red-50/60 dark:bg-red-950/15 ring-1 ring-red-200/50 dark:ring-red-800/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }`}
                      style={{ opacity: 0.5 + intensity * 0.5 }}
                      title={'Filter by {type}'.replace('{type}', type)}
                    >
                      <span className={`text-[10px] font-semibold truncate flex items-center gap-1.5 ${isDominant ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>
                        {isDominant && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                        {type}
                      </span>
                      <div className="flex justify-center">
                        {counts.high > 0 ? (
                          <span className="w-7 h-5 rounded bg-red-500/20 text-red-700 dark:text-red-300 text-[10px] font-bold flex items-center justify-center">{counts.high}</span>
                        ) : (
                          <span className="text-[10px] text-gray-300 dark:text-gray-700">--</span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        {counts.medium > 0 ? (
                          <span className="w-7 h-5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center justify-center">{counts.medium}</span>
                        ) : (
                          <span className="text-[10px] text-gray-300 dark:text-gray-700">--</span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        {counts.low > 0 ? (
                          <span className="w-7 h-5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center">{counts.low}</span>
                        ) : (
                          <span className="text-[10px] text-gray-300 dark:text-gray-700">--</span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        <span className="w-8 h-5 rounded bg-gray-100 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 text-[10px] font-black flex items-center justify-center">{counts.total}</span>
                      </div>
                    </div>
                  )
                })}
                {/* Totals footer */}
                <div className="grid grid-cols-[1fr_32px_32px_32px_36px] sm:grid-cols-[1fr_40px_40px_40px_44px] gap-1 items-center px-1.5 py-1.5 mt-1 border-t border-gray-100 dark:border-gray-700/50">
                  <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase">{'Total'}</span>
                  <span className="text-[10px] font-bold text-red-600 dark:text-red-400 text-center">{stats.high}</span>
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 text-center">{stats.medium}</span>
                  <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 text-center">{stats.low}</span>
                  <span className="text-[10px] font-black text-gray-900 dark:text-white text-center">{stats.total}</span>
                </div>
              </>)}
            </div>
          </div>
        </div>

        {/*  OPERATIONAL ASSESSMENT -- Donut + Gauge + Trends  */}
        <div className="space-y-3">
          {/* Severity Breakdown -- Donut */}
          <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{'Severity Distribution'}</span>
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
              <div className="space-y-2 flex-1">
                {([{ s: 'High', n: stats.high, c: 'bg-red-500', bar: 'bg-red-400' }, { s: 'Medium', n: stats.medium, c: 'bg-amber-500', bar: 'bg-amber-400' }, { s: 'Low', n: stats.low, c: 'bg-blue-500', bar: 'bg-blue-400' }] as const).map(v => {
                  const pct = stats.total > 0 ? Math.round((v.n / stats.total) * 100) : 0
                  return (
                    <div key={v.s}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className={`w-2 h-2 rounded-full ${v.c}`} />
                        <span className="text-[10px] text-gray-600 dark:text-gray-300 flex-1">{severityLabel(v.s)}</span>
                        <span className="text-[10px] font-bold tabular-nums">{v.n}</span>
                        <span className="text-[9px] text-gray-400 dark:text-gray-400 tabular-nums w-7 text-right">{pct}%</span>
                      </div>
                      <div className="h-1 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden ml-4">
                        <div className={`h-full rounded-full ${v.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Verification + Resolution Gauge */}
          <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{'Verification Rate'}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                stats.verifyRate >= 80 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                : stats.verifyRate >= 50 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
              }`}>
                {stats.verifyRate >= 80 ? 'Excellent' : stats.verifyRate >= 50 ? 'Needs Attention' : 'CRITICAL'}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div className="relative w-14 h-14 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-gray-800" />
                  <circle cx="18" cy="18" r="15.9" fill="none"
                    stroke={stats.verifyRate >= 80 ? '#10b981' : stats.verifyRate >= 50 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${stats.verifyRate} ${100 - stats.verifyRate}`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-[10px] font-black ${
                    stats.verifyRate >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                    : stats.verifyRate >= 50 ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400'
                  }`}>{stats.verifyRate}%</span>
                </div>
              </div>
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-500 dark:text-gray-300">{'Media Attached'}</p>
                  <p className="text-xs font-bold tabular-nums">{stats.withMedia}<span className="text-gray-400 dark:text-gray-300 font-normal">/{stats.total}</span></p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-500 dark:text-gray-300">{'Resolution Rate'}</p>
                  <p className="text-xs font-bold tabular-nums">{stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0}%</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-400 dark:text-gray-400">{'Target benchmark'}</p>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-gray-400 tabular-nums">80%</p>
                </div>
              </div>
            </div>
          </div>

          {/* Trend Deltas -- Enhanced */}
          <div className="grid grid-cols-2 gap-2">
            {/* Daily */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 p-3 shadow-sm">
              <span className="text-[8px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-widest">{'Daily'}</span>
              {(() => {
                const delta = commandCenter?.comparative?.dayDeltaPct ?? 0
                const today = commandCenter?.comparative?.today ?? 0
                const yesterday = commandCenter?.comparative?.yesterday ?? 0
                const isNew = yesterday === 0 && today > 0
                const maxBar = Math.max(today, yesterday, 1)
                return <>
                  <p className={`text-xl font-black tabular-nums mt-1 ${delta > 0 ? 'text-red-600 dark:text-red-400' : delta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-300'}`}>
 {isNew ? 'New' : `${delta > 0 ? '^+' : delta < 0 ? 'v' : ''}${delta}%`}
                  </p>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] text-gray-400 dark:text-gray-300 w-12 text-right tabular-nums">{'Today'}</span>
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${delta > 0 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${(today / maxBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] font-bold tabular-nums w-5 text-right">{today}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] text-gray-400 dark:text-gray-300 w-12 text-right tabular-nums">{'Yest.'}</span>
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gray-300 dark:bg-gray-600 transition-all duration-500" style={{ width: `${(yesterday / maxBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] font-bold tabular-nums w-5 text-right text-gray-400 dark:text-gray-300">{yesterday}</span>
                    </div>
                  </div>
                </>
              })()}
            </div>
            {/* Weekly */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 p-3 shadow-sm">
              <span className="text-[8px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-widest">{'Weekly'}</span>
              {(() => {
                const delta = commandCenter?.comparative?.weekDeltaPct ?? 0
                const thisW = commandCenter?.comparative?.thisWeek ?? 0
                const prevW = commandCenter?.comparative?.previousWeek ?? 0
                const isNew = prevW === 0 && thisW > 0
                const maxBar = Math.max(thisW, prevW, 1)
                return <>
                  <p className={`text-xl font-black tabular-nums mt-1 ${delta > 0 ? 'text-red-600 dark:text-red-400' : delta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-300'}`}>
 {isNew ? 'New' : `${delta > 0 ? '^+' : delta < 0 ? 'v' : ''}${delta}%`}
                  </p>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] text-gray-400 dark:text-gray-300 w-12 text-right tabular-nums">{'This wk'}</span>
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${delta > 0 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${(thisW / maxBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] font-bold tabular-nums w-5 text-right">{thisW}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] text-gray-400 dark:text-gray-300 w-12 text-right tabular-nums">{'Last wk'}</span>
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gray-300 dark:bg-gray-600 transition-all duration-500" style={{ width: `${(prevW / maxBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] font-bold tabular-nums w-5 text-right text-gray-400 dark:text-gray-300">{prevW}</span>
                    </div>
                  </div>
                </>
              })()}
            </div>
          </div>
        </div>
      </div>

      {/*
          SECTION 5 -- RECENT REPORTS + AI RECS + QUICK ACTIONS
           */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: '0.15s' }}>
        {/* Recent Reports -- 2 col span */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2 bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-900/50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-aegis-600 flex items-center justify-center"><FileText className="w-3.5 h-3.5 text-white" /></div>
              <div><h2 className="font-bold text-sm">{'Recent Reports'}</h2><p className="text-[10px] text-gray-400 dark:text-gray-300">{'Latest incident reports'}</p></div>
            </div>
            <div className="flex items-center gap-1.5">
              <select value={recentSort} onChange={e => setRecentSort(e.target.value)} aria-label={'Sort reports'} className="text-[10px] px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold">
                <option value="newest">{'Newest'}</option>
                <option value="oldest">{'Oldest'}</option>
                <option value="severity">{'Severity'}</option>
                <option value="ai-high">{'AI High->Low'}</option>
                <option value="ai-low">{'AI Low->High'}</option>
              </select>
 <button onClick={() => onViewChange('reports')} className="text-[10px] font-semibold text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/30 px-2.5 py-1 rounded-lg transition-colors">{'All Reports'} {'->'}</button>
              <button onClick={onRefresh} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /></button>
            </div>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50 max-h-[380px] overflow-y-auto">
            {reports.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-300">{'No reports yet'}</p>
              </div>
            ) : sortedReports.map(r => (
              <div key={r.id} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectReport(r) } }} className="px-5 py-2.5 hover:bg-gray-50/80 dark:hover:bg-gray-800/30 cursor-pointer flex items-center gap-3 transition-all group focus:outline-none focus:ring-2 focus:ring-aegis-400 focus:ring-inset rounded-lg" onClick={() => onSelectReport(r)}>
                <div className="relative flex-shrink-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-bold shadow-sm ${r.status === 'Urgent' ? 'bg-gradient-to-br from-red-500 to-red-600' : r.status === 'Verified' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : r.status === 'Flagged' ? 'bg-gradient-to-br from-aegis-500 to-aegis-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                    {r.status === 'Urgent' ? <Siren className="w-3.5 h-3.5" /> : r.status === 'Verified' ? <CheckCircle className="w-3.5 h-3.5" /> : r.status === 'Flagged' ? <Flag className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  </div>
                  {r.status === 'Urgent' && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-ping" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate group-hover:text-aegis-600 transition-colors">{r.type || r.incidentCategory}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-300 truncate flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0" />{r.location}</p>
                </div>
                <div className="text-right flex-shrink-0 space-y-0.5">
                  <span className={`inline-block text-[10px] px-2 py-0.5 rounded-md font-bold ${r.severity === 'High' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : r.severity === 'Medium' ? 'bg-aegis-100 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{severityLabel(r.severity)}</span>
                  <p className="text-[10px] text-gray-400 dark:text-gray-300 tabular-nums">{(r.confidence || 0)}{'% AI'}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-300 group-hover:text-aegis-500 transition-colors flex-shrink-0" />
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
                <span className="text-xs font-bold text-red-800 dark:text-red-300">{'Alerts'}</span>
                <span className="ml-auto text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">{alerts.length}</span>
              </div>
              {alerts.slice(0, 3).map((a: any, idx: number) => (
                <div key={a.id} className="mb-1.5 last:mb-0 bg-white/60 dark:bg-gray-900/40 backdrop-blur rounded-xl px-3 py-2 ring-1 ring-red-100 dark:ring-red-900/30 animate-slide-in-right" style={{ animationDelay: `${idx * 80}ms` }}>
                  <p className="text-xs font-semibold text-red-900 dark:text-red-200">{a.title}</p>
                  <p className="text-[10px] text-red-600/70 dark:text-red-400/70 mt-0.5">{new Date(a.timestamp || Date.now()).toLocaleTimeString(dateLocale)}</p>
                </div>
              ))}
            </div>
          )}

          {/* AI Recommendations */}
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 rounded-2xl ring-1 ring-violet-200 dark:ring-violet-800/50 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Brain className="w-3.5 h-3.5 text-white" /></div>
              <span className="text-xs font-bold text-violet-800 dark:text-violet-300">{'AI Recommendations'}</span>
              {(commandCenter?.recommendations?.length ?? 0) > 0 && (
                <span className="ml-auto text-[10px] bg-violet-600 text-white px-2 py-0.5 rounded-full font-bold">{commandCenter!.recommendations.length}</span>
              )}
            </div>
            {(() => {
              const recs = commandCenter?.recommendations || []
              const critCount = recs.filter(r => r.priority === 'critical').length
              const highCount = recs.filter(r => r.priority === 'high').length
              const medCount = recs.filter(r => r.priority === 'medium').length
              return recs.length > 0 ? (
                <>
                  {/* Priority summary strip */}
                  <div className="flex items-center gap-2 mb-2">
                    {critCount > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">{critCount} {'Critical'}</span>}
                    {highCount > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{highCount} {'High'}</span>}
                    {medCount > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{medCount} {'Medium'}</span>}
                  </div>
                  <div className="space-y-1.5">
                    {recs.slice(0, 4).map((item, idx) => (
                      <div key={idx} className={`text-[11px] rounded-xl px-3 py-2 ring-1 backdrop-blur ${item.priority === 'critical' ? 'bg-red-100/60 dark:bg-red-900/20 ring-red-200 dark:ring-red-800/40 text-red-800 dark:text-red-300' : item.priority === 'high' ? 'bg-aegis-100/60 dark:bg-aegis-900/20 ring-aegis-200 dark:ring-aegis-800/40 text-aegis-800 dark:text-aegis-300' : 'bg-blue-100/60 dark:bg-blue-900/20 ring-blue-200 dark:ring-blue-800/40 text-blue-800 dark:text-blue-300'}`}>
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.priority === 'critical' ? 'bg-red-500 animate-pulse' : item.priority === 'high' ? 'bg-aegis-500' : 'bg-blue-500'}`} />
                          <span className="flex-1">{item.message}</span>
                          <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${item.priority === 'critical' ? 'bg-red-200/60 dark:bg-red-800/30 text-red-600 dark:text-red-400' : item.priority === 'high' ? 'bg-aegis-200/60 dark:bg-aegis-800/30 text-aegis-600 dark:text-aegis-400' : 'bg-blue-200/60 dark:bg-blue-800/30 text-blue-600 dark:text-blue-400'}`}>{item.priority}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                  </div>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{'All systems nominal'}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5">{'No actions required at this time'}</p>
                </div>
              )
            })()}
          </div>

          {/* Quick Actions */}
          <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{'Quick Actions'}</span>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => onViewChange('alert_send')} className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 px-3 py-2.5 rounded-xl ring-1 ring-red-200 dark:ring-red-800/40 transition-all hover:shadow-md">
                <Bell className="w-4 h-4" /> {'Send Alert'}
              </button>
              <button onClick={() => onViewChange('reports')} className="flex items-center gap-2 text-xs font-semibold text-aegis-700 dark:text-aegis-300 bg-aegis-50 dark:bg-aegis-950/30 hover:bg-aegis-100 dark:hover:bg-aegis-950/50 px-3 py-2.5 rounded-xl ring-1 ring-aegis-200 dark:ring-aegis-800/40 transition-all hover:shadow-md">
                <FileText className="w-4 h-4" /> {'All Reports'}
              </button>
              <button onClick={() => onViewChange('analytics')} className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 px-3 py-2.5 rounded-xl ring-1 ring-blue-200 dark:ring-blue-800/40 transition-all hover:shadow-md">
                <Activity className="w-4 h-4" /> {'Analytics'}
              </button>
              <button onClick={() => onViewChange('map')} className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 px-3 py-2.5 rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-800/40 transition-all hover:shadow-md">
                <Map className="w-4 h-4" /> {'Live Map'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/*
          SECTION 6 -- LEADERBOARD + LIVE ACTIVITY STREAM
           */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
        {/* Officer Leaderboard */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-aegis-50 to-orange-50 dark:from-aegis-950/10 dark:to-orange-950/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-orange-500 flex items-center justify-center"><Users className="w-3.5 h-3.5 text-white" /></div>
              <div><h3 className="font-bold text-sm">{'Officer Leaderboard'}</h3><p className="text-[10px] text-gray-400 dark:text-gray-300">{'Last 7 days performance'}</p></div>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {(() => {
              const lb = commandCenter?.leaderboard || []
              const maxHandled = Math.max(...lb.map(r => r.handled), 1)
              return lb.map((row, idx) => {
                const medal = idx === 0 ? <Trophy className="w-4 h-4 text-yellow-500" /> : idx === 1 ? <Medal className="w-4 h-4 text-gray-400" /> : idx === 2 ? <Award className="w-4 h-4 text-amber-600" /> : <span className="text-[10px] font-bold text-gray-400">#{idx + 1}</span>
                const respRating = row.avgResponseMinutes <= 10 ? 'Excellent' : row.avgResponseMinutes <= 30 ? 'Good' : row.avgResponseMinutes <= 60 ? 'Fair' : 'Slow'
                const respColor = row.avgResponseMinutes <= 10 ? 'text-emerald-600 dark:text-emerald-400' : row.avgResponseMinutes <= 30 ? 'text-blue-600 dark:text-blue-400' : row.avgResponseMinutes <= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                const respBarColor = row.avgResponseMinutes <= 10 ? 'bg-emerald-400' : row.avgResponseMinutes <= 30 ? 'bg-blue-400' : row.avgResponseMinutes <= 60 ? 'bg-amber-400' : 'bg-red-400'
                const handledPct = Math.round((row.handled / maxHandled) * 100)
                return (
                  <button
                    key={`${row.operator}-${idx}`}
                    onClick={() => { setActivityShowAll(true); onViewChange('audit') }}
                    title={`View ${row.operator}'s activity log`}
                    className={`w-full text-left rounded-xl px-4 py-2.5 ring-1 transition-all group cursor-pointer animate-fade-in ${idx === 0 ? 'bg-gradient-to-r from-yellow-50/80 to-amber-50/50 dark:from-yellow-950/10 dark:to-amber-950/5 ring-yellow-200/60 dark:ring-yellow-800/30 hover:ring-yellow-400/60 dark:hover:ring-yellow-600/40' : 'bg-gray-50 dark:bg-gray-800/40 ring-gray-100 dark:ring-gray-800 hover:ring-aegis-300 dark:hover:ring-aegis-700'}`}
                    style={{ animationDelay: `${idx * 80}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm w-7 text-center flex-shrink-0 flex items-center justify-center">{medal}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate group-hover:text-aegis-600 transition-colors">{row.operator}</p>
                        <div className="text-[10px] text-gray-500 dark:text-gray-300 tabular-nums flex items-center gap-1.5 flex-wrap">
                          <span>{row.handled} {'handled'}</span>
                          <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                          <span>{row.actions} {'actions'}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-xs font-black tabular-nums ${respColor}`}>{fmtMinsLocalized(row.avgResponseMinutes, lang)}</p>
                        <p className={`text-[8px] font-bold ${respColor}`}>{respRating}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                    </div>
                    {/* Performance bar */}
                    <div className="mt-1.5 ml-10 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${respBarColor} bar-grow transition-all duration-500`} style={{ width: `${handledPct}%` }} />
                      </div>
                      <span className="text-[8px] text-gray-400 dark:text-gray-300 tabular-nums">{handledPct}%</span>
                    </div>
                  </button>
                )
              })
            })()}
            {(!commandCenter?.leaderboard || commandCenter.leaderboard.length === 0) && (
              <div className="text-center py-6">
                <Users className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-500 dark:text-gray-300">{'No leaderboard data yet'}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-0.5">{'Operator actions will appear here'}</p>
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Stream */}
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/10 dark:to-blue-950/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"><Activity className="w-3.5 h-3.5 text-white" /></div>
              <div><h3 className="font-bold text-sm">{'Live Activity Stream'}</h3><p className="text-[10px] text-gray-400 dark:text-gray-300">{'Real-time operator actions'}</p></div>
              <span className="ml-auto flex items-center gap-1 text-[9px] text-green-500 font-bold"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />{'Live'}</span>
            </div>
          </div>
          <div className="p-4 space-y-1.5 max-h-[320px] overflow-y-auto">
            {(() => {
              const allEntries = commandCenter?.activity || []
              const visibleEntries = activityShowAll ? allEntries : allEntries.slice(0, 12)
              if (allEntries.length === 0) return (
                <div className="text-center py-6">
                  <Activity className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 dark:text-gray-300">{'No activity yet'}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-0.5">{'Operator actions will stream here in real-time'}</p>
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
                          <p className="text-[10px] text-gray-400 dark:text-gray-300">{entry.operator_name || 'System'}</p>
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-gray-300 flex-shrink-0 tabular-nums">{timeAgo}</span>
                      </div>
                    )
                  })}
                  {allEntries.length > 12 && (
                    <button
                      onClick={() => setActivityShowAll(prev => !prev)}
                      className="w-full text-[10px] font-semibold text-cyan-600 hover:text-cyan-700 py-2 border-t border-gray-100 dark:border-gray-800 mt-1 transition-colors"
                    >
                      {activityShowAll ? `${'Show less'} ▲` : `${'Show more'} ${allEntries.length - 12} ▼`}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      </div>

      {/*
          SECTION 8 -- INCIDENT QUEUE
           */}
      <ErrorBoundary name="IncidentQueue">
        <IncidentQueue
          reports={reports}
          currentUser={user}
          onNotify={pushNotification}
        />
      </ErrorBoundary>

      {/*
          SECTION 9 -- REPORT PIPELINE
           */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-5 shadow-sm animate-slide-up" style={{ animationDelay: '0.25s' }}>
        <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{'Report Pipeline'}</span>
        <div className="flex items-center gap-2 mt-4">
          {([
            { label: 'Urgent', count: stats.urgent, color: 'bg-red-500', pct: stats.total > 0 ? (stats.urgent / stats.total) * 100 : 0 },
            { label: 'Unverified', count: stats.unverified, color: 'bg-aegis-400', pct: stats.total > 0 ? (stats.unverified / stats.total) * 100 : 0 },
            { label: 'Verified', count: stats.verified, color: 'bg-emerald-500', pct: stats.total > 0 ? (stats.verified / stats.total) * 100 : 0 },
            { label: 'Flagged', count: stats.flagged, color: 'bg-orange-500', pct: stats.total > 0 ? (stats.flagged / stats.total) * 100 : 0 },
            { label: 'Resolved', count: stats.resolved, color: 'bg-gray-400', pct: stats.total > 0 ? (stats.resolved / stats.total) * 100 : 0 },
          ] as const).map((stage, i, arr) => (
            <React.Fragment key={stage.label}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">{stage.label}</span>
                  <span className="text-xs font-black tabular-nums">{stage.count}</span>
                </div>
                <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${stage.color} transition-all duration-700`} style={{ width: `${Math.max(stage.pct, stage.count > 0 ? 8 : 0)}%` }} />
                </div>
                <p className="text-[9px] text-gray-400 dark:text-gray-300 mt-1 text-center tabular-nums">{Math.round(stage.pct)}%</p>
              </div>
              {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-700 flex-shrink-0 mt-1" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/*
          SECTION 10 -- CLIMATE RISK DASHBOARD
           */}
      <ErrorBoundary name="ClimateRiskDashboard">
        <ClimateRiskDashboard />
      </ErrorBoundary>

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{'Shortcuts'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> {'Refresh'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">C</kbd> {'Copy SitRep'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">S</kbd> {'Toggle SitRep'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">E</kbd> {'Export CSV'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">J</kbd> {'Export JSON'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {'Toggle Shortcuts'}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{'Esc'}</kbd> {'Close'}</span>
        </div>
      )}
    </div>
  )
}

