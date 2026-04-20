/**
 * Historical intelligence dashboard (past incident analysis).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react'
import {
  History, Map, Clock, FileText, Search, Waves, Droplets,
  Download, ChevronDown, MapPin, Calendar,
  TrendingUp, TrendingDown, AlertTriangle,
  BarChart3, Maximize2, Minimize2, Eye, X
} from 'lucide-react'
import { HISTORICAL_EVENTS as STATIC_EVENTS, SEASONAL_TRENDS as STATIC_TRENDS } from '../../data/historical'
import { useLocation } from '../../contexts/LocationContext'
import { apiGetHeatmapData, apiGetHistoricalEvents, apiGetSeasonalTrends } from '../../utils/api'
const LiveMap = lazy(() => import('../shared/LiveMap'))
import type { HistoricalEvent } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/*  Helpers  */

function parseDamage(raw: string): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[£,\s]/g, '')
  const mMatch = cleaned.match(/([\d.]+)M/i)
  if (mMatch) return parseFloat(mMatch[1]) * 1_000_000
  const kMatch = cleaned.match(/([\d.]+)K/i)
  if (kMatch) return parseFloat(kMatch[1]) * 1_000
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function formatDamage(total: number): string {
  if (total >= 1_000_000) return `£${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `£${(total / 1_000).toFixed(0)}K`
  return `£${total.toFixed(0)}`
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return dateStr }
}

function getYearRange(events: HistoricalEvent[]): string {
  const dates = events.map(e => new Date(e.date).getFullYear())
  if (dates.length === 0) return 'N/A'
  const min = Math.min(...dates)
  const max = Math.max(...dates)
  return min === max ? `${min}` : `${min}-${max}`
}

/*  CSV Export  */

function exportCSV(events: HistoricalEvent[]) {
  const headers = ['ID', 'Date', 'Type', 'Location', 'Severity', 'Affected People', 'Damage', 'Description']
  const rows = events.map(e => [
    e.id, e.date, e.type, `"${e.location}"`, e.severity,
    String(e.affectedPeople || 0), `"${e.damage || ''}"`, `"${(e.description || '').replace(/"/g, '""')}"`
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `historical_events_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/*  Severity config  */

const SEV_CONFIG = {
  High:   { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', icon: 'text-red-600', dot: 'bg-red-500', border: 'border-red-200 dark:border-red-800' },
  Medium: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', icon: 'text-amber-600', dot: 'bg-amber-500', border: 'border-amber-200 dark:border-amber-800' },
  Low:    { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-600', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800' },
} as const

type SevKey = keyof typeof SEV_CONFIG

interface HeatmapZone {
  zone?: string
  intensity?: number
  eventCount?: number
}

export default function AdminHistoricalIntelligence() {
  const lang = useLanguage()
  const { location: loc } = useLocation()

  //State
  const [heatmapData, setHeatmapData] = useState<HeatmapZone[]>([])
  const [heatmapError, setHeatmapError] = useState(false)
  const [histSearch, setHistSearch] = useState('')
  const [histSort, setHistSort] = useState<'date-desc' | 'date-asc' | 'severity' | 'affected'>('date-desc')
  const [histFilter, setHistFilter] = useState<'all' | 'High' | 'Medium' | 'Low'>('all')
  const [histType, setHistType] = useState<'all' | 'Flood' | 'Storm'>('all')
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [eventsView, setEventsView] = useState<'list' | 'timeline'>('list')
  const [mapExpanded, setMapExpanded] = useState(false)
  const [seasonalMetric, setSeasonalMetric] = useState<'floods' | 'rainfall' | 'severity'>('floods')
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 6

  //Live data state with static fallback
  const [HISTORICAL_EVENTS, setHistoricalEvents] = useState<HistoricalEvent[]>(STATIC_EVENTS)
  const [SEASONAL_TRENDS, setSeasonalTrends] = useState(STATIC_TRENDS)
  const [dataSource, setDataSource] = useState<'loading' | 'database' | 'demo'>('loading')
  const [loading, setLoading] = useState(true)

  //Fetch live data from APIs with fallback to static demo data
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      const results = await Promise.allSettled([
        apiGetHistoricalEvents(),
        apiGetSeasonalTrends(),
        apiGetHeatmapData(),
      ])

      if (cancelled) return

      const [eventsResult, trendsResult, heatmapResult] = results
      let source: 'database' | 'demo' = 'demo'

      //Historical events
      if (eventsResult.status === 'fulfilled' && eventsResult.value?.events?.length > 0) {
        setHistoricalEvents(eventsResult.value.events as HistoricalEvent[])
        source = 'database'
      } else {
        setHistoricalEvents(STATIC_EVENTS)
      }

      //Seasonal trends
      if (trendsResult.status === 'fulfilled' && trendsResult.value?.trends?.some((t: any) => t.floodCount > 0)) {
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        setSeasonalTrends(trendsResult.value.trends as any)
      } else {
        setSeasonalTrends(STATIC_TRENDS)
      }

      //Heatmap
      if (heatmapResult.status === 'fulfilled') {
        const d = heatmapResult.value as any
        setHeatmapData(d?.intensity_data || [])
        setHeatmapError(false)
      } else {
        console.warn('[Historical] Heatmap API unavailable, using local data')
        setHeatmapData([])
        setHeatmapError(true)
      }

      setDataSource(source)
      setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

  // Computed stats
  const stats = useMemo(() => {
    const totalDamage = HISTORICAL_EVENTS.reduce((s, e) => s + parseDamage(e.damage), 0)
    const totalAffected = HISTORICAL_EVENTS.reduce((s, e) => s + (e.affectedPeople || 0), 0)
    const highCount = HISTORICAL_EVENTS.filter(e => e.severity === 'High').length
    const avgAffected = HISTORICAL_EVENTS.length > 0 ? Math.round(totalAffected / HISTORICAL_EVENTS.length) : 0
    const types = [...new Set(HISTORICAL_EVENTS.map(e => e.type))]
    return { totalDamage, totalAffected, highCount, avgAffected, types }
  }, [HISTORICAL_EVENTS])

  // Seasonal stats
  const seasonalStats = useMemo(() => {
    const totalFloods = SEASONAL_TRENDS.reduce((s, t) => s + t.floodCount, 0)
    const totalRainfall = SEASONAL_TRENDS.reduce((s, t) => s + t.rainfallMm, 0)
    const peakMonth = SEASONAL_TRENDS.reduce((best, t) => t.floodCount > best.floodCount ? t : best, SEASONAL_TRENDS[0])
    const avgSeverity = SEASONAL_TRENDS.filter(t => t.avgSeverity > 0).reduce((s, t, _, a) => s + t.avgSeverity / a.length, 0)
    return { totalFloods, totalRainfall, peakMonth, avgSeverity }
  }, [SEASONAL_TRENDS])

  // Filtered + sorted events (memoized)
  const sortedEvents = useMemo(() => {
    let items = [...HISTORICAL_EVENTS]
    if (histFilter !== 'all') items = items.filter(e => e.severity === histFilter)
    if (histType !== 'all') items = items.filter(e => e.type === histType)
    if (histSearch.trim()) {
      const q = histSearch.toLowerCase()
      items = items.filter(e =>
        (e.location || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.type || '').toLowerCase().includes(q) ||
        (e.date || '').includes(q)
      )
    }
    switch (histSort) {
      case 'date-desc': items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); break
      case 'date-asc': items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); break
      case 'severity': items.sort((a, b) => { const o: Record<string, number> = { High: 3, Medium: 2, Low: 1 }; return (o[b.severity] || 0) - (o[a.severity] || 0) }); break
      case 'affected': items.sort((a, b) => (b.affectedPeople || 0) - (a.affectedPeople || 0)); break
    }
    return items
  }, [HISTORICAL_EVENTS, histSearch, histSort, histFilter, histType])

  // Year-grouped events
  const yearGroups = useMemo(() => {
    const groups: Record<string, HistoricalEvent[]> = {}
    for (const e of sortedEvents) {
      const year = new Date(e.date).getFullYear().toString()
      if (!groups[year]) groups[year] = []
      groups[year].push(e)
    }
    return Object.entries(groups).sort(([a], [b]) => Number(b) - Number(a))
  }, [sortedEvents])

  //Pagination
  const paginatedEvents = useMemo(() => sortedEvents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedEvents, page])
  const totalPages = Math.ceil(sortedEvents.length / PAGE_SIZE)

  //Reset page on filter change
  useEffect(() => { setPage(0) }, [histSearch, histFilter, histType, histSort])

  // Heatmap zone cards
  const zoneCards = useMemo(() => {
    if (heatmapData.length > 0) {
      return heatmapData.slice(0, 4).map((h) => {
        const risk = Math.round((h.intensity || 0) * 100)
        const color = risk >= 80 ? 'from-red-600 to-red-700' : risk >= 65 ? 'from-red-500 to-red-600' : risk >= 50 ? 'from-orange-500 to-orange-600' : 'from-cyan-600 to-cyan-700'
        return { area: h.zone || 'Zone', risk, events: h.eventCount || 0, color }
      })
    }
    return (loc.floodZones || []).slice(0, 4).map((z: { name?: string }, i: number) => {
      const risks = [92, 78, 65, 55]
      const evts = [12, 8, 6, 5]
      const colors = ['from-red-600 to-red-700', 'from-red-500 to-red-600', 'from-orange-500 to-orange-600', 'from-cyan-600 to-cyan-700']
      return { area: z.name || `Zone ${i + 1}`, risk: risks[i] || 50, events: evts[i] || 3, color: colors[i] || colors[3] }
    })
  }, [heatmapData, loc])

  // Event type distribution for header
  const typeDist = useMemo(() => {
    const total = HISTORICAL_EVENTS.length
    if (total === 0) return []
    const map: Record<string, number> = {}
    HISTORICAL_EVENTS.forEach(e => { map[e.type] = (map[e.type] || 0) + 1 })
    return Object.entries(map).sort(([, a], [, b]) => b - a)
  }, [HISTORICAL_EVENTS])

  //Keyboard shortcuts -- use ref to avoid re-attaching listener on every sort change
  const [showKeyboard, setShowKeyboard] = useState(false)
  const sortedEventsRef = useRef(sortedEvents)
  sortedEventsRef.current = sortedEvents
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'm') { e.preventDefault(); setMapExpanded(p => !p) }
      else if (key === 'v') { e.preventDefault(); setEventsView(p => p === 'list' ? 'timeline' : 'list') }
      else if (key === 'e') { e.preventDefault(); exportCSV(sortedEventsRef.current) }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="space-y-5 animate-fade-in">

      {/*  HEADER PANEL  */}
      <div className="bg-gradient-to-br from-slate-900 via-gray-900 to-zinc-900 rounded-2xl shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10 p-6">
          {/* Title row */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl flex items-center justify-center border border-cyan-400/20">
                <History className="w-6 h-6 text-cyan-300" />
              </div>
              <div>
                <h2 className="text-white font-bold text-xl tracking-tight">{t('historical.title', lang)}</h2>
                <p className="text-gray-300 text-sm">{t('historical.subtitle', lang)} &middot; {loc.name || t('historical.allRegions', lang)} &middot; {getYearRange(HISTORICAL_EVENTS)}</p>
              </div>
              {/* Data source indicator */}
              <span
                className={`ml-2 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider cursor-help ${
                  dataSource === 'loading' ? 'bg-gray-600/30 text-gray-400 animate-pulse' :
                  dataSource === 'database' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                  'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}
                title={dataSource === 'demo' ? t('historical.demoTooltip', lang) : dataSource === 'database' ? t('historical.liveTooltip', lang) : ''}
              >
                {dataSource === 'loading' ? t('common.loading', lang) : dataSource === 'database' ? t('historical.liveData', lang) : t('historical.sampleData', lang)}
              </span>
            </div>
            <button
              onClick={() => exportCSV(HISTORICAL_EVENTS)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-gray-300 dark:text-gray-300 hover:text-white transition-all"
            >
              <Download className="w-3.5 h-3.5" /> {t('common.exportAllCSV', lang)}
            </button>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: t('historical.totalEvents', lang), value: HISTORICAL_EVENTS.length, icon: FileText, color: 'text-cyan-300', accent: 'from-cyan-500/10 to-cyan-600/5' },
              { label: t('historical.highSeverity', lang), value: stats.highCount, icon: AlertTriangle, color: 'text-red-300', accent: 'from-red-500/10 to-red-600/5' },
              { label: t('historical.peopleAffected', lang), value: stats.totalAffected.toLocaleString(), icon: MapPin, color: 'text-amber-300', accent: 'from-amber-500/10 to-amber-600/5' },
              { label: t('historical.totalDamage', lang), value: formatDamage(stats.totalDamage), icon: TrendingDown, color: 'text-emerald-300', accent: 'from-emerald-500/10 to-emerald-600/5' },
              { label: t('historical.avgAffected', lang), value: stats.avgAffected.toLocaleString(), icon: TrendingUp, color: 'text-blue-300', accent: 'from-blue-500/10 to-blue-600/5' },
              { label: t('historical.eventTypes', lang), value: stats.types.length, icon: BarChart3, color: 'text-purple-300', accent: 'from-purple-500/10 to-purple-600/5' },
            ].map((s, i) => (
              <div key={i} className={`bg-gradient-to-br ${s.accent} rounded-xl p-3 border border-white/5 hover:border-white/10 transition-colors`}>
                <div className="flex items-center gap-2 mb-1">
                  <s.icon className={`w-3.5 h-3.5 ${s.color} opacity-70`} />
                  <p className="text-[10px] text-gray-300 uppercase tracking-wider font-semibold">{s.label}</p>
                </div>
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Event type distribution */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] text-gray-300 uppercase tracking-wider font-semibold">{t('historical.distribution', lang)}:</span>
            {typeDist.map(([type, count]) => {
              const pct = Math.round((count / HISTORICAL_EVENTS.length) * 100)
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    {type === 'Storm' ? <Waves className="w-3 h-3 text-purple-400" /> : <Droplets className="w-3 h-3 text-blue-400" />}
                    <span className="text-xs text-gray-300 font-medium">{type}</span>
                  </div>
                  <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${type === 'Storm' ? 'bg-purple-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-300">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/*  FLOOD RISK HEATMAP  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-red-100 to-orange-100 dark:from-red-900/30 dark:to-orange-900/30 rounded-lg flex items-center justify-center">
              <Map className="w-4.5 h-4.5 text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">{t('historical.floodRiskHeatmap', lang)}</h3>
              <p className="text-[10px] text-gray-500 dark:text-gray-300">{loc.name || t('historical.activeRegion', lang)} &middot; {t('historical.heatmapSubtitle', lang)} &middot; {HISTORICAL_EVENTS.length} {t('historical.recorded', lang)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {['High', 'Medium', 'Low'].map(r => (
                <span key={r} className={`text-[10px] px-2 py-0.5 rounded-full font-bold text-white ${r === 'High' ? 'bg-red-600' : r === 'Medium' ? 'bg-amber-500' : 'bg-blue-500'}`}>
                  {t(`common.${r.toLowerCase()}`, lang)}
                </span>
              ))}
            </div>
            <button
              onClick={() => setMapExpanded(!mapExpanded)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 transition-colors"
              title={mapExpanded ? 'Collapse map' : 'Expand map'}
            >
              {mapExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Suspense fallback={<div className="animate-pulse bg-gray-200 dark:bg-gray-800 rounded" style={{ height: mapExpanded ? '620px' : '420px' }} />}>
          <LiveMap showFloodPredictions height={mapExpanded ? '620px' : '420px'} className="w-full transition-all duration-300" />
        </Suspense>

        {/* Zone risk summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4" aria-busy={loading} aria-label={loading ? 'Loading zone risk data' : 'Zone risk summary'}>
          {loading ? Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-200 dark:bg-gray-700 rounded-xl p-3.5 shadow-lg animate-pulse">
              <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-3/4 mb-2" />
              <div className="h-7 bg-gray-300 dark:bg-gray-600 rounded w-1/2 mb-1" />
              <div className="h-2.5 bg-gray-300 dark:bg-gray-600 rounded w-2/3" />
            </div>
          )) : zoneCards.map((z, i) => (
            <div key={i} className={`bg-gradient-to-r ${z.color} rounded-xl p-3.5 text-white shadow-lg hover:shadow-xl transition-shadow`}>
              <p className="font-bold text-xs truncate mb-0.5">{z.area}</p>
              <div className="flex items-baseline gap-1">
                <p className="text-2xl font-extrabold">{z.risk}%</p>
                <span className="text-[10px] opacity-70">{t('common.risk', lang).toLowerCase()}</span>
              </div>
              <p className="text-[10px] opacity-80 mt-0.5">{z.events} {t('historical.historicalEvents', lang)}</p>
            </div>
          ))}
        </div>

        {/* Risk summary footer */}
        <div className="px-4 pb-3 flex items-center justify-between">
          <p className="text-[10px] text-gray-400 dark:text-gray-300 italic">
            {heatmapError
              ? t('historical.heatmapFallback', lang) || 'Showing local flood zone data (live heatmap unavailable)'
              : heatmapData.length > 0
                ? `${heatmapData.length} ${t('historical.historicalEvents', lang)}`
                : `${t('common.risk', lang)} ${t('map.floodZone', lang).toLowerCase()}`}
          </p>
          {zoneCards.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-300">{t('historical.avgRisk', lang)}:</span>
              <span className="text-xs font-bold text-red-500">
                {Math.round(zoneCards.reduce((s, z) => s + z.risk, 0) / zoneCards.length)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/*  SEASONAL FLOOD TRENDS (DUAL AXIS)  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-lg flex items-center justify-center">
                <Clock className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-gray-900 dark:text-white">{t('historical.seasonalTrends', lang)}</h3>
                <p className="text-[10px] text-gray-500 dark:text-gray-300">{t('historical.seasonalSubtitle', lang)}</p>
              </div>
            </div>
            {/* Metric toggle */}
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              {([['floods', t('historical.floods', lang)], ['rainfall', t('weather.rainfall', lang)], ['severity', t('common.severity', lang)]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSeasonalMetric(key)}
                  className={`px-3 py-1.5 text-[10px] font-semibold rounded-md transition-all ${
                    seasonalMetric === key
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary stats strip */}
          <div className="flex items-center gap-6 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('historical.totalFloods', lang)}:</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">{seasonalStats.totalFloods}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-cyan-500" />
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('historical.totalRainfall', lang)}:</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">{seasonalStats.totalRainfall}mm</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('historical.peakMonth', lang)}:</span>
              <span className="text-xs font-bold text-red-600">{seasonalStats.peakMonth.month} ({seasonalStats.peakMonth.floodCount} {t('historical.floods', lang).toLowerCase()})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('historical.avgSeverity', lang)}:</span>
              <span className="text-xs font-bold text-amber-600">{seasonalStats.avgSeverity.toFixed(1)}/5</span>
            </div>
          </div>
        </div>

        <div className="p-5">
          {/* Chart area */}
          <div className="relative">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-[9px] text-gray-400 dark:text-gray-300 font-mono">
              {seasonalMetric === 'floods' && <><span>5</span><span>3</span><span>0</span></>}
              {seasonalMetric === 'rainfall' && <><span>90mm</span><span>60mm</span><span>30mm</span></>}
              {seasonalMetric === 'severity' && <><span>3.0</span><span>1.5</span><span>0</span></>}
            </div>

            {/* Chart bars */}
            <div className="ml-10 flex items-end gap-2 h-52 mb-1">
              {SEASONAL_TRENDS.map((s, i) => {
                const maxFlood = Math.max(...SEASONAL_TRENDS.map(x => x.floodCount))
                const maxRain = Math.max(...SEASONAL_TRENDS.map(x => x.rainfallMm))
                const maxSev = Math.max(...SEASONAL_TRENDS.filter(x => x.avgSeverity > 0).map(x => x.avgSeverity))

                let pct: number
                let barColor: string
                let displayValue: string

                if (seasonalMetric === 'floods') {
                  const count = s.floodCount
                  pct = maxFlood > 0 ? (count / maxFlood) * 100 : 10
                  const risk = count >= 4 ? 'High' : count >= 2 ? 'Medium' : 'Low'
                  barColor = risk === 'High' ? 'from-red-500 to-red-400' : risk === 'Medium' ? 'from-amber-500 to-amber-400' : 'from-emerald-500 to-emerald-400'
                  displayValue = `${count} ${t('historical.floods', lang).toLowerCase()}`
                } else if (seasonalMetric === 'rainfall') {
                  pct = maxRain > 0 ? (s.rainfallMm / maxRain) * 100 : 10
                  barColor = s.rainfallMm >= 80 ? 'from-blue-600 to-blue-500' : s.rainfallMm >= 65 ? 'from-blue-500 to-cyan-500' : 'from-cyan-400 to-cyan-300'
                  displayValue = `${s.rainfallMm}mm`
                } else {
                  pct = maxSev > 0 ? (s.avgSeverity / maxSev) * 100 : 10
                  barColor = s.avgSeverity >= 2.0 ? 'from-red-500 to-orange-500' : s.avgSeverity >= 1.0 ? 'from-amber-500 to-yellow-500' : 'from-emerald-400 to-green-400'
                  displayValue = s.avgSeverity > 0 ? `${s.avgSeverity.toFixed(1)}` : '--'
                }

                const isPeak = s.month === seasonalStats.peakMonth.month

                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center gap-1 group relative"
                    onMouseEnter={() => setHoveredMonth(i)}
                    onMouseLeave={() => setHoveredMonth(null)}
                  >
                    {/* Hover tooltip */}
                    {hoveredMonth === i && (
                      <div className="absolute -top-24 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg shadow-xl px-3 py-2 z-20 whitespace-nowrap pointer-events-none">
                        <p className="text-[10px] font-bold border-b border-gray-700 dark:border-gray-600 pb-1 mb-1">{s.month}</p>
                        <div className="space-y-0.5 text-[9px]">
                          <p><span className="text-blue-300">{t('historical.floods', lang)}:</span> {s.floodCount}</p>
                          <p><span className="text-cyan-300">{t('weather.rainfall', lang)}:</span> {s.rainfallMm}mm</p>
                          <p><span className="text-amber-300">{t('common.severity', lang)}:</span> {s.avgSeverity > 0 ? s.avgSeverity.toFixed(1) : '--'}</p>
                        </div>
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
                      </div>
                    )}

                    {/* Value label on hover */}
                    <div className="text-[9px] font-bold text-gray-500 dark:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">{displayValue}</div>

                    {/* Bar */}
                    <div className="w-full relative" style={{ height: '180px' }}>
                      <div
                        className={`absolute bottom-0 w-full rounded-t-lg bg-gradient-to-t ${barColor} transition-all duration-300 shadow-sm group-hover:shadow-lg ${isPeak ? 'ring-2 ring-red-400 ring-offset-1 dark:ring-offset-gray-900' : ''}`}
                        style={{ height: `${Math.max(pct, 6)}%` }}
                      />
                      {/* Rainfall line overlay when in floods mode */}
                      {seasonalMetric === 'floods' && (
                        <div
                          className="absolute w-full flex justify-center"
                          style={{ bottom: `${maxRain > 0 ? (s.rainfallMm / maxRain) * 100 : 0}%` }}
                        >
                          <div className="w-2 h-2 rounded-full bg-cyan-400 border-2 border-white dark:border-gray-900 shadow-sm z-10" />
                        </div>
                      )}
                    </div>

                    {/* Month label */}
                    <span className={`text-[10px] font-medium transition-colors ${isPeak ? 'text-red-500 font-bold' : 'text-gray-500 dark:text-gray-300'}`}>
                      {s.month}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Rainfall line connector (SVG overlay) */}
            {seasonalMetric === 'floods' && (
              <svg className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none" style={{ height: '180px', marginTop: '24px' }}>
                {SEASONAL_TRENDS.map((s, i) => {
                  if (i === SEASONAL_TRENDS.length - 1) return null
                  const maxRain = Math.max(...SEASONAL_TRENDS.map(x => x.rainfallMm))
                  const barWidth = 100 / SEASONAL_TRENDS.length
                  const x1 = (i + 0.5) * barWidth
                  const x2 = (i + 1.5) * barWidth
                  const y1 = 100 - (maxRain > 0 ? (s.rainfallMm / maxRain) * 100 : 0)
                  const y2 = 100 - (maxRain > 0 ? (SEASONAL_TRENDS[i + 1].rainfallMm / maxRain) * 100 : 0)
                  return (
                    <line
                      key={i}
                      x1={`${x1}%`} y1={`${y1}%`}
                      x2={`${x2}%`} y2={`${y2}%`}
                      stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 2" opacity={0.6}
                    />
                  )
                })}
              </svg>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-4 flex-wrap">
            {seasonalMetric === 'floods' && (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-red-500" />{t('common.high', lang)} (&ge;4)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-amber-500" />{t('common.medium', lang)} (2-3)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-emerald-500" />{t('common.low', lang)} (0-1)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-2 h-2 rounded-full bg-cyan-400 border border-gray-300" />{t('weather.rainfall', lang)} (mm)</span>
              </>
            )}
            {seasonalMetric === 'rainfall' && (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-blue-600" />Heavy (&ge;80mm)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-blue-400" />Moderate (65-79mm)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-cyan-400" />Light (&lt;65mm)</span>
              </>
            )}
            {seasonalMetric === 'severity' && (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-red-500" />High (&ge;2.0)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-amber-500" />Medium (1.0-1.9)</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-300"><div className="w-3 h-3 rounded bg-emerald-400" />Low (&lt;1.0)</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/*  PAST EVENTS BOARD  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        {/* Header + controls */}
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900/30 dark:to-blue-900/30 rounded-lg flex items-center justify-center">
                <FileText className="w-4.5 h-4.5 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-gray-900 dark:text-white">{t('historical.pastEventsBoard', lang)}</h3>
                <p className="text-[10px] text-gray-500 dark:text-gray-300">{sortedEvents.length} {t('common.of', lang)} {HISTORICAL_EVENTS.length} {t('history.events', lang).toLowerCase()} &middot; {t('common.page', lang)} {page + 1} {t('common.of', lang)} {totalPages || 1}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                <button
                  onClick={() => setEventsView('list')}
                  className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-md transition-all ${eventsView === 'list' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-300'}`}
                >
                  {t('common.list', lang)}
                </button>
                <button
                  onClick={() => setEventsView('timeline')}
                  className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-md transition-all ${eventsView === 'timeline' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-300'}`}
                >
                  {t('admin.historical.timeline', lang)}
                </button>
              </div>
              <button
                onClick={() => exportCSV(sortedEvents)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 transition-colors"
              >
                <Download className="w-3 h-3" /> {t('common.csv', lang)}
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
              <input
                value={histSearch}
                onChange={e => setHistSearch(e.target.value)}
                placeholder={t('historical.searchPlaceholder', lang)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-aegis-500 outline-none"
              />
              {histSearch && (
                <button onClick={() => setHistSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-300 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select value={histFilter} onChange={e => setHistFilter(e.target.value as any)} className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('historical.allSeverity', lang)}</option>
              <option value="High">{t('common.high', lang)}</option>
              <option value="Medium">{t('common.medium', lang)}</option>
              <option value="Low">{t('common.low', lang)}</option>
            </select>
            <select value={histType} onChange={e => setHistType(e.target.value as any)} className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('historical.allTypes', lang)}</option>
              <option value="Flood">{t('common.flood', lang)}</option>
              <option value="Storm">{t('common.storm', lang)}</option>
            </select>
            <select value={histSort} onChange={e => setHistSort(e.target.value as any)} className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="date-desc">{t('historical.newestFirst', lang)}</option>
              <option value="date-asc">{t('historical.oldestFirst', lang)}</option>
              <option value="severity">{t('common.severity', lang)}</option>
              <option value="affected">{t('historical.mostAffected', lang)}</option>
            </select>
            {(histFilter !== 'all' || histType !== 'all' || histSearch) && (
              <button
                onClick={() => { setHistFilter('all'); setHistType('all'); setHistSearch('') }}
                className="flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <X className="w-3 h-3" /> {t('common.clear', lang)}
              </button>
            )}
          </div>
        </div>

        {/* Event List View */}
        {eventsView === 'list' && (
          <div>
            {sortedEvents.length === 0 ? (
              <div className="text-center py-14">
                <Search className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-300 font-medium">{t('historical.noEventsMatch', lang)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-300 mt-1">{t('historical.tryAdjustingFilters', lang)}</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {paginatedEvents.map((e) => {
                    const sev = (e.severity || 'Medium') as SevKey
                    const config = SEV_CONFIG[sev] || SEV_CONFIG.Medium
                    const isExpanded = expandedEvent === e.id

                    return (
                      <div key={e.id}>
                        <div
                          className="px-5 py-4 flex items-start gap-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group"
                          onClick={() => setExpandedEvent(isExpanded ? null : e.id)}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                            {e.type === 'Storm'
                              ? <Waves className={`w-5 h-5 ${config.icon}`} />
                              : <Droplets className={`w-5 h-5 ${config.icon}`} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${config.bg} ${config.text}`}>{sev}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{e.type}</span>
                              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-300">{formatDate(e.date)}</span>
                            </div>
                            <h4 className="font-bold text-sm text-gray-900 dark:text-white">{e.location}</h4>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2">{e.description}</p>
                          </div>
                          <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                            {e.affectedPeople > 0 && (
                              <>
                                <p className="text-sm font-bold text-red-600">{e.affectedPeople.toLocaleString()}</p>
                                <p className="text-[10px] text-gray-400 dark:text-gray-300">{t('historical.affected', lang)}</p>
                              </>
                            )}
                            {e.damage && <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{e.damage}</p>}
                            <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <div className="px-5 pb-4 pt-0 animate-fade-in">
                            <div className="ml-14 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                                <div>
                                  <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('common.date', lang)}</p>
                                  <p className="text-xs font-bold text-gray-900 dark:text-white">{formatDate(e.date)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('historical.coordinates', lang)}</p>
                                  <p className="text-xs font-bold text-gray-900 dark:text-white font-mono">{e.coordinates[0].toFixed(3)}, {e.coordinates[1].toFixed(3)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('historical.impact', lang)}</p>
                                  <p className="text-xs font-bold text-red-600">{e.affectedPeople.toLocaleString()} {t('common.people', lang)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('historical.damageCost', lang)}</p>
                                  <p className="text-xs font-bold text-gray-900 dark:text-white">{e.damage}</p>
                                </div>
                              </div>
                              <div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase font-semibold mb-1">{t('historical.fullDescription', lang)}</p>
                                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{e.description}</p>
                              </div>
                              {/* Severity indicator bar */}
                              <div className="mt-3 flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 dark:text-gray-300 font-semibold">{t('common.severity', lang)}:</span>
                                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${sev === 'High' ? 'bg-red-500 w-full' : sev === 'Medium' ? 'bg-amber-500 w-2/3' : 'bg-emerald-500 w-1/3'}`}
                                  />
                                </div>
                                <span className={`text-[10px] font-bold ${config.text}`}>{sev}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('common.previous', lang)}
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setPage(i)}
                          className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-colors ${
                            page === i
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('common.next', lang)}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Timeline View */}
        {eventsView === 'timeline' && (
          <div className="p-5">
            {sortedEvents.length === 0 ? (
              <div className="text-center py-14">
                <Calendar className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-300 font-medium">{t('historical.noEvents', lang)}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {yearGroups.map(([year, events]) => (
                  <div key={year}>
                    {/* Year header */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-xl flex items-center justify-center shadow-sm">
                        <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">{year}</span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-gray-300 dark:from-gray-700 to-transparent" />
                      <span className="text-[10px] text-gray-500 dark:text-gray-300 font-semibold px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                        {events.length} {t('historical.event', lang)}{events.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Timeline entries */}
                    <div className="relative ml-5 pl-6 border-l-2 border-gray-200 dark:border-gray-700 space-y-4">
                      {events.map((e) => {
                        const sev = (e.severity || 'Medium') as SevKey
                        const config = SEV_CONFIG[sev] || SEV_CONFIG.Medium
                        return (
                          <div key={e.id} className="relative group">
                            {/* Timeline dot */}
                            <div className={`absolute -left-[31px] top-2 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 shadow-sm ${config.dot}`} />

                            <div className={`rounded-xl border ${config.border} ${config.bg} p-4 hover:shadow-md transition-shadow`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${config.bg} ${config.text}`}>{sev}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{e.type}</span>
                                    <span className="text-[10px] font-mono text-gray-500 dark:text-gray-300">{formatDate(e.date)}</span>
                                  </div>
                                  <h4 className="font-bold text-sm text-gray-900 dark:text-white mb-0.5">{e.location}</h4>
                                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{e.description}</p>

                                  {/* Impact bar */}
                                  <div className="flex items-center gap-4 mt-2.5">
                                    {e.affectedPeople > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <MapPin className="w-3 h-3 text-red-500" />
                                        <span className="text-[10px] font-bold text-red-600">{e.affectedPeople.toLocaleString()} {t('historical.affected', lang)}</span>
                                      </div>
                                    )}
                                    {e.damage && (
                                      <div className="flex items-center gap-1.5">
                                        <TrendingDown className="w-3 h-3 text-gray-500 dark:text-gray-300" />
                                        <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300">{e.damage}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                      <Eye className="w-3 h-3 text-gray-400 dark:text-gray-300" />
                                      <span className="text-[10px] text-gray-500 dark:text-gray-300 font-mono">{e.coordinates[0].toFixed(3)}, {e.coordinates[1].toFixed(3)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{t('common.shortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">M</kbd> {t('shortcuts.toggleMap', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">V</kbd> {t('shortcuts.listTimeline', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">E</kbd> {t('shortcuts.exportCsv', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {t('shortcuts.toggleShortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{t('common.esc', lang)}</kbd> {t('shortcuts.close', lang)}</span>
        </div>
      )}
    </div>
  )
}

