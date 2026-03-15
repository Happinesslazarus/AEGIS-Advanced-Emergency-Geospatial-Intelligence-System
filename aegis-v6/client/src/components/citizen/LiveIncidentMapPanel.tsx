/**
 * LiveIncidentMapPanel.tsx — Professional-grade Live Incident Map wrapper
 *
 * Wraps DisasterMap with professional dashboard features:
 * - LIVE pulse indicator with refresh timer
 * - Incident type filter pills
 * - Time range selector (1h / 6h / 24h / 7d)
 * - Quick stats row (Active, Critical, Under Control, Resolved, Trend)
 * - Severity distribution bar
 * - Activity feed overlay (scrollable incident timeline)
 * - Status footer with connection info
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  MapPin, Activity, AlertTriangle, Shield, Clock, ChevronDown, ChevronUp,
  Radio, TrendingUp, TrendingDown, Minus, Filter, Crosshair,
  Zap, Flame, Droplets, Building2, Heart, Eye, EyeOff, RefreshCw,
  Users, CloudLightning, ShieldCheck, Waves, CheckCircle,
} from 'lucide-react'
import type { Report, SeverityLevel, IncidentCategoryKey } from '../../types'
import DisasterMap from '../shared/DisasterMap'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

type TimeRange = '1h' | '6h' | '24h' | '7d'

const TIME_RANGES: { key: TimeRange; label: string; ms: number }[] = [
  { key: '1h', label: '1H', ms: 3600_000 },
  { key: '6h', label: '6H', ms: 21600_000 },
  { key: '24h', label: '24H', ms: 86400_000 },
  { key: '7d', label: '7D', ms: 604800_000 },
]

interface CategoryDef {
  key: string
  label: string
  icon: typeof Flame
  color: string       // tailwind text class
  bg: string          // tailwind bg class
  match: (r: Report) => boolean
}

const CATEGORIES: CategoryDef[] = [
  { key: 'all', label: 'All', icon: Activity, color: 'text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700', match: () => true },
  { key: 'natural_disaster', label: 'Natural', icon: CloudLightning, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', match: r => r.incidentCategory === 'natural_disaster' },
  { key: 'infrastructure', label: 'Infra', icon: Building2, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', match: r => r.incidentCategory === 'infrastructure' },
  { key: 'public_safety', label: 'Safety', icon: Shield, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', match: r => r.incidentCategory === 'public_safety' },
  { key: 'medical', label: 'Medical', icon: Heart, color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-950/30', match: r => r.incidentCategory === 'medical' },
  { key: 'environmental', label: 'Environ', icon: Waves, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', match: r => r.incidentCategory === 'environmental' },
  { key: 'community_safety', label: 'Community', icon: Users, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/30', match: r => r.incidentCategory === 'community_safety' },
]

const SEVERITY_CFG: Record<SeverityLevel, { color: string; hex: string; bg: string; label: string }> = {
  High:   { color: 'text-red-500', hex: '#ef4444', bg: 'bg-red-500', label: 'Critical' },
  Medium: { color: 'text-amber-500', hex: '#f59e0b', bg: 'bg-amber-500', label: 'Moderate' },
  Low:    { color: 'text-blue-500', hex: '#3b82f6', bg: 'bg-blue-500', label: 'Low' },
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function timeAgoShort(ts: string | number): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
  return `${Math.floor(diff / 86400_000)}d`
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─────────────────────────────────────────────────────────────
// SVG mini-components
// ─────────────────────────────────────────────────────────────

/** Tiny severity donut chart */
function SeverityDonut({ high, medium, low }: { high: number; medium: number; low: number }) {
  const total = high + medium + low || 1
  const r = 16, cx = 20, cy = 20, C = 2 * Math.PI * r
  const pHigh = (high / total) * C
  const pMed = (medium / total) * C
  const pLow = (low / total) * C
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="flex-shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" className="dark:stroke-gray-700" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ef4444" strokeWidth="5" strokeDasharray={`${pHigh} ${C - pHigh}`} strokeDashoffset="0" strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f59e0b" strokeWidth="5" strokeDasharray={`${pMed} ${C - pMed}`} strokeDashoffset={`${-pHigh}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#3b82f6" strokeWidth="5" strokeDasharray={`${pLow} ${C - pLow}`} strokeDashoffset={`${-pHigh - pMed}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="fill-gray-800 dark:fill-gray-200 text-[9px] font-bold">{total}</text>
    </svg>
  )
}

/** Stacked severity distribution bar */
function SeverityBar({ high, medium, low }: { high: number; medium: number; low: number }) {
  const total = high + medium + low || 1
  const pH = (high / total) * 100
  const pM = (medium / total) * 100
  const pL = (low / total) * 100
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40 flex">
        {pH > 0 && <div className="h-full bg-red-500 transition-all duration-700" style={{ width: `${pH}%` }} />}
        {pM > 0 && <div className="h-full bg-amber-500 transition-all duration-700" style={{ width: `${pM}%` }} />}
        {pL > 0 && <div className="h-full bg-blue-500 transition-all duration-700" style={{ width: `${pL}%` }} />}
      </div>
      <div className="flex gap-2 text-[9px] font-medium flex-shrink-0">
        {pH > 0 && <span className="text-red-500">{high}H</span>}
        {pM > 0 && <span className="text-amber-500">{medium}M</span>}
        {pL > 0 && <span className="text-blue-500">{low}L</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

interface Props {
  reports: Report[]
  userPosition: [number, number] | null
  center: [number, number]
  zoom: number
}

export default function LiveIncidentMapPanel({ reports, userPosition, center, zoom }: Props) {
  const lang = useLanguage()
  const [expanded, setExpanded] = useState(true)
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showFeed, setShowFeed] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [refreshAgo, setRefreshAgo] = useState('0s')
  const refreshRef = useRef<ReturnType<typeof setInterval>>()

  // Refresh timer
  useEffect(() => {
    refreshRef.current = setInterval(() => {
      const diff = Date.now() - lastRefresh
      if (diff < 60_000) setRefreshAgo(`${Math.floor(diff / 1000)}s`)
      else setRefreshAgo(`${Math.floor(diff / 60_000)}m`)
    }, 1000)
    return () => clearInterval(refreshRef.current)
  }, [lastRefresh])

  // Refresh when reports change
  useEffect(() => { setLastRefresh(Date.now()) }, [reports])

  // ── Filtered reports ──
  const filteredReports = useMemo(() => {
    const now = Date.now()
    const range = TIME_RANGES.find(t => t.key === timeRange)!
    const cutoff = now - range.ms
    const cat = CATEGORIES.find(c => c.key === categoryFilter) || CATEGORIES[0]
    return reports.filter(r => {
      const ts = new Date(r.timestamp).getTime()
      if (ts < cutoff) return false
      if (!cat.match(r)) return false
      return true
    })
  }, [reports, timeRange, categoryFilter])

  // ── Stats derived from filtered reports ──
  const stats = useMemo(() => {
    const active = filteredReports.filter(r => r.status !== 'Resolved' && r.status !== 'Archived' && r.status !== 'False_Report')
    const critical = active.filter(r => r.severity === 'High')
    const verified = active.filter(r => r.status === 'Verified')
    const resolved = filteredReports.filter(r => r.status === 'Resolved')
    const high = filteredReports.filter(r => r.severity === 'High').length
    const medium = filteredReports.filter(r => r.severity === 'Medium').length
    const low = filteredReports.filter(r => r.severity === 'Low').length

    // Trend: compare first half vs second half of time window
    const sorted = [...filteredReports].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    const mid = Math.floor(sorted.length / 2)
    const firstHalf = sorted.slice(0, mid).length
    const secondHalf = sorted.slice(mid).length
    const trend = sorted.length < 4 ? 0 : secondHalf - firstHalf

    // Nearby (within 10km of user)
    const nearby = userPosition
      ? active.filter(r => r.coordinates?.length === 2 && haversineKm(userPosition[0], userPosition[1], r.coordinates[0], r.coordinates[1]) <= 10).length
      : null

    return { active: active.length, critical: critical.length, verified: verified.length, resolved: resolved.length, high, medium, low, trend, nearby }
  }, [filteredReports, userPosition])

  // ── Category counts for pill badges ──
  const categoryCounts = useMemo(() => {
    const now = Date.now()
    const range = TIME_RANGES.find(t => t.key === timeRange)!
    const cutoff = now - range.ms
    const inRange = reports.filter(r => new Date(r.timestamp).getTime() >= cutoff)
    const counts: Record<string, number> = {}
    for (const cat of CATEGORIES) {
      counts[cat.key] = cat.key === 'all' ? inRange.length : inRange.filter(cat.match).length
    }
    return counts
  }, [reports, timeRange])

  // ── Feed items (sorted by time, most recent first) ──
  const feedItems = useMemo(() => {
    return [...filteredReports]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30)
      .map(r => {
        const dist = userPosition && r.coordinates?.length === 2
          ? haversineKm(userPosition[0], userPosition[1], r.coordinates[0], r.coordinates[1])
          : null
        return { ...r, distance: dist }
      })
  }, [filteredReports, userPosition])

  // ── Reports passed to DisasterMap (filtered) ──
  const mapReports = useMemo(() => filteredReports, [filteredReports])

  const TrendIcon = stats.trend > 0 ? TrendingUp : stats.trend < 0 ? TrendingDown : Minus

  return (
    <div className="glass-card rounded-2xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden shadow-xl shadow-gray-900/5 dark:shadow-black/20">
      {/* ═══════ HEADER ═══════ */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
      >
        {/* LIVE pulse */}
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/30">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900">
            <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
          </span>
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight">{t('incident.liveMap', lang)}</h2>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold text-green-700 dark:text-green-300 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">
            {stats.active} active · {stats.critical} critical · Updated {refreshAgo} ago
          </p>
        </div>

        {/* Right side: donut + expand */}
        <SeverityDonut high={stats.high} medium={stats.medium} low={stats.low} />
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />}
      </button>

      {expanded && (
        <>
          {/* ═══════ FILTER BAR ═══════ */}
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              {/* Category pills */}
              <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
                {CATEGORIES.map(cat => {
                  const active = categoryFilter === cat.key
                  const Icon = cat.icon
                  const count = categoryCounts[cat.key] || 0
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setCategoryFilter(cat.key)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                        active
                          ? `${cat.bg} ${cat.color} ring-1 ring-current/20 shadow-sm`
                          : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {cat.label}
                      {count > 0 && <span className={`ml-0.5 px-1.5 py-0 rounded-full text-[8px] ${active ? 'bg-current/10' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>{count}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Divider */}
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />

              {/* Time range */}
              <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5 flex-shrink-0">
                {TIME_RANGES.map(tr => (
                  <button
                    key={tr.key}
                    onClick={() => setTimeRange(tr.key)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${
                      timeRange === tr.key
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'
                    }`}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ═══════ STATS ROW ═══════ */}
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800/50">
            <div className="grid grid-cols-5 gap-2">
              {/* Active */}
              <div className="bg-white/80 dark:bg-gray-800/40 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/30">
                <Activity className="w-3.5 h-3.5 mx-auto text-orange-500 mb-0.5" />
                <div className="text-lg font-black text-gray-900 dark:text-white leading-none">{stats.active}</div>
                <div className="text-[8px] font-semibold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider mt-0.5">Active</div>
              </div>
              {/* Critical */}
              <div className={`rounded-xl p-2 text-center border ${stats.critical > 0 ? 'bg-red-50/80 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/30' : 'bg-white/80 dark:bg-gray-800/40 border-gray-100 dark:border-gray-700/30'}`}>
                <AlertTriangle className={`w-3.5 h-3.5 mx-auto mb-0.5 ${stats.critical > 0 ? 'text-red-500 animate-pulse' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`} />
                <div className={`text-lg font-black leading-none ${stats.critical > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{stats.critical}</div>
                <div className="text-[8px] font-semibold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider mt-0.5">Critical</div>
              </div>
              {/* Verified */}
              <div className="bg-white/80 dark:bg-gray-800/40 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/30">
                <CheckCircle className="w-3.5 h-3.5 mx-auto text-emerald-500 mb-0.5" />
                <div className="text-lg font-black text-gray-900 dark:text-white leading-none">{stats.verified}</div>
                <div className="text-[8px] font-semibold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider mt-0.5">Verified</div>
              </div>
              {/* Resolved */}
              <div className="bg-white/80 dark:bg-gray-800/40 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/30">
                <ShieldCheck className="w-3.5 h-3.5 mx-auto text-blue-500 mb-0.5" />
                <div className="text-lg font-black text-gray-900 dark:text-white leading-none">{stats.resolved}</div>
                <div className="text-[8px] font-semibold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider mt-0.5">Resolved</div>
              </div>
              {/* Trend */}
              <div className="bg-white/80 dark:bg-gray-800/40 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/30">
                <TrendIcon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${stats.trend > 0 ? 'text-red-500' : stats.trend < 0 ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`} />
                <div className={`text-lg font-black leading-none ${stats.trend > 0 ? 'text-red-600 dark:text-red-400' : stats.trend < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>
                  {stats.trend > 0 ? `+${stats.trend}` : stats.trend === 0 ? '—' : stats.trend}
                </div>
                <div className="text-[8px] font-semibold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider mt-0.5">Trend</div>
              </div>
            </div>

            {/* Severity distribution bar */}
            <div className="mt-2">
              <SeverityBar high={stats.high} medium={stats.medium} low={stats.low} />
            </div>
          </div>

          {/* ═══════ MAP + FEED ═══════ */}
          <div className="relative border-t border-gray-100 dark:border-gray-800/50">
            {/* Map container */}
            <div className="h-[320px] sm:h-[420px] lg:h-[480px]">
              <DisasterMap
                reports={mapReports}
                center={userPosition || center}
                zoom={userPosition ? 14 : zoom}
                showDistress
                showPredictions
                showRiskLayer
                showFloodMonitoring
              />
            </div>

            {/* Activity feed overlay (right side) */}
            {showFeed && feedItems.length > 0 && (
              <div className="absolute top-2 right-2 z-[700] w-[220px] max-h-[calc(100%-16px)] flex flex-col">
                <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl border border-gray-200/60 dark:border-gray-700/40 shadow-2xl overflow-hidden flex flex-col max-h-full">
                  {/* Feed header */}
                  <div className="flex items-center justify-between px-2.5 py-2 border-b border-gray-100 dark:border-gray-800/50 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Radio className="w-3 h-3 text-red-500 animate-pulse" />
                      <span className="text-[10px] font-extrabold text-gray-700 dark:text-gray-200 uppercase tracking-wider">{t('incident.activity', lang)}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowFeed(false) }}
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <EyeOff className="w-3 h-3 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                    </button>
                  </div>

                  {/* Feed items */}
                  <div className="overflow-y-auto flex-1 p-1.5 space-y-1" style={{ maxHeight: 320 }}>
                    {feedItems.slice(0, 15).map(item => {
                      const sev = SEVERITY_CFG[item.severity] || SEVERITY_CFG.Low
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-2 p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                        >
                          {/* Severity dot */}
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${sev.bg}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold text-gray-800 dark:text-gray-200 truncate leading-tight">
                              {item.type || item.incidentCategory?.replace(/_/g, ' ') || 'Incident'}
                            </p>
                            <p className="text-[9px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate">{item.location}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[8px] font-medium text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{timeAgoShort(item.timestamp)}</span>
                              {item.distance !== null && (
                                <span className="text-[8px] font-medium text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{item.distance < 1 ? `${Math.round(item.distance * 1000)}m` : `${item.distance.toFixed(1)}km`}</span>
                              )}
                              <span className={`text-[8px] font-bold ${sev.color}`}>{item.severity}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {feedItems.length > 15 && (
                    <div className="px-2.5 py-1.5 border-t border-gray-100 dark:border-gray-800/50 text-center flex-shrink-0">
                      <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">+{feedItems.length - 15} more</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Toggle feed button (when hidden) */}
            {!showFeed && (
              <button
                onClick={() => setShowFeed(true)}
                className="absolute top-2 right-2 z-[700] bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-lg border border-gray-200/60 dark:border-gray-700/40 shadow-xl p-2 hover:bg-white dark:hover:bg-gray-800 transition-colors"
                title="Show activity feed"
              >
                <Eye className="w-3.5 h-3.5 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
              </button>
            )}
          </div>

          {/* ═══════ FOOTER BAR ═══════ */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            {/* Connection status */}
            <div className="flex items-center gap-3 text-[9px] font-medium">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
              <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                <Clock className="w-3 h-3 inline mr-0.5" />
                {refreshAgo} ago
              </span>
            </div>

            {/* Center info */}
            {userPosition && (
              <div className="flex items-center gap-1 text-[9px] font-medium text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                <Crosshair className="w-3 h-3 text-green-500" />
                <span>{userPosition[0].toFixed(4)}, {userPosition[1].toFixed(4)}</span>
                {stats.nearby !== null && stats.nearby > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 font-bold">{stats.nearby} nearby</span>
                )}
              </div>
            )}

            {/* Sources */}
            <div className="flex items-center gap-1.5 text-[9px] font-medium text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              <span>Reports · Sensors · AI</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40 font-bold">{filteredReports.length} total</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}





