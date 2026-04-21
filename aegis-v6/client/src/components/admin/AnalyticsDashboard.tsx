/**
 * Admin analytics dashboard showing KPIs, trend charts, severity/status
 * breakdowns, and spatial clusters for the selected time range.
 *
 * Data loading strategy:
 *   - Loads on mount and re-loads whenever the range selector changes.
 *   - WebSocket events (report:new, report:updated, report:bulk-updated) trigger
 *     a reload, debounced to 1200ms so bulk batch updates only fire one refresh.
 *   - Polls every 60 seconds as a silent fallback when the socket is disconnected.
 *   - inFlightRef prevents duplicate concurrent requests if multiple events arrive
 *     during a slow network response.
 *
 * Trend computation:
 *   hybrid useMemo produces: 3-point moving average, spike detection (mean+1.5σ),
 *   half-period trend, chart scale snap, and a 4-period rolling forecast -- all
 *   derived from the server series data client-side.
 *
 * Filter callbacks:
 *   onFilterCategory, onFilterSeverity, onFilterStatus are forwarded up to
 *   AdminPage so clicking a chart segment pre-fills the report list filter.
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, TrendingUp, PieChart, Clock, RefreshCw, Timer, CheckCircle2, ShieldCheck, Users, MapPin, Activity, Wifi, Download } from 'lucide-react'
import { apiGetReportAnalytics } from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { useSharedSocket } from '../../contexts/SocketContext'
import { useEventStream } from '../../hooks/useEventStream'

type RangeValue = '24h' | '7d' | '30d' | 'all' | 'custom'

type AnalyticsPayload = {
  range: RangeValue
  generatedAt: string
  kpis: {
    total: number
    reportsToday?: number
    reportsThisWeek?: number
    avgConfidence: number
    mediaRate: number
    withMedia: number
    trapped: number
    verificationRate: number
    falseReportRate?: number
    aiScored: number
    avgVerifyMinutes: number
    avgResolveMinutes: number
    adminResponseMinutes?: number
    investigationCompletionMinutes?: number
    aiAccuracyRate?: number
    geoCoverageKm?: number
    threatLevelIndex?: number
  }
  trend: { current: number; previous: number; percent: number }
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  byCategory: Array<{ category: string; count: number }>
  series: Array<{ label: string; count: number }>
  operationalMetrics?: {
    reportsToday: number
    reportsThisWeek: number
    verifiedRate: number
    falseReportRate: number
    avgVerificationTime: number
    avgResolutionTime: number
  }
  intelligenceMetrics?: {
    severityDistribution: Record<string, number>
    categoryHeatmap: Array<{ category: string; High: number; Medium: number; Low: number; total: number }>
    locationClusters: Array<{ lat: number; lng: number; count: number; label: string }>
  }
  performanceMetrics?: {
    adminResponseTime: number
    investigationCompletionTime: number
    reportsPerOfficer: Array<{ officer: string; count: number }>
  }
  trendMetrics?: {
    weekOverWeekGrowth: number
    monthlyTrend: number
    incidentSpikes: number
  }
  dataQuality?: {
    aiCoverageRate: number
    mediaCoverageRate: number
    verificationCoverageRate: number
  }
}

interface Props {
  onFilterCategory?: (cat: string) => void
  onFilterSeverity?: (sev: string) => void
  onFilterStatus?: (status: string) => void
}

//fmtMins: formats raw integer minutes into a compact h/m string.
//Values under 60 minutes show as "Nm"; values ≥60 show as "Nh Nm".
function fmtMins(value: number): string {
  if (!value || value < 60) return `${value || 0}m`
  const h = Math.floor(value / 60)
  const m = value % 60
  return `${h}h ${m}m`
}

//roundUpScale: snaps a chart Y maximum to a "nice" round number so bar heights
//don't end mid-step.  Steps are 10, 25, 50, 100, then 25-multiple ceiling.
function roundUpScale(value: number): number {
  if (value <= 10) return 10
  if (value <= 25) return 25
  if (value <= 50) return 50
  if (value <= 100) return 100
  return Math.ceil(value / 25) * 25
}

//safePct: percentage change from previous to current, guarded against
//division-by-zero.  Returns +100 if starting from 0 with new data.
function safePct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

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

const COLLAPSE_COUNT = 5

export default function AnalyticsDashboard({ onFilterCategory, onFilterSeverity, onFilterStatus }: Props): JSX.Element {
  const lang = useLanguage()
  const [range, setRange] = useState<RangeValue>('24h')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const { connected: socketConnected } = useSharedSocket()
  const latestReport = useEventStream('report:created')
  //inFlightRef: prevents duplicate concurrent API calls when range changes or
  //WebSocket events fire rapidly.  A ref avoids stale closure issues in the
  //useCallback.
  const inFlightRef = useRef(false)
  const lastRefreshRef = useRef(0)
  const rangeRef = useRef<RangeValue>('24h')
  const [nowTick, setNowTick] = useState(Date.now())

  // "Show more" toggle state for expandable sections
  const [heatmapExpanded, setHeatmapExpanded] = useState(false)
  const [clustersExpanded, setClustersExpanded] = useState(false)
  const [spikesExpanded, setSpikesExpanded] = useState(false)

  const load = useCallback(async (nextRange: RangeValue) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const apiRange: '24h' | '7d' | '30d' | 'all' = nextRange === 'custom' ? 'all' : nextRange
      const payload = await apiGetReportAnalytics(apiRange) as AnalyticsPayload
      setData(payload)
      lastRefreshRef.current = Date.now()
    } catch (err: any) {
      setError(err?.message || 'Failed to load live analytics')
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => { load(range) }, [range, load])

  useEffect(() => {
    rangeRef.current = range
  }, [range])

  // Reload when a new report arrives via the typed event spine (report:created).
  // Debounced to 1200ms so bulk batch updates only fire one refresh.
  useEffect(() => {
    if (!latestReport) return
    const now = Date.now()
    if (now - lastRefreshRef.current < 1200) return
    void load(rangeRef.current)
  }, [latestReport, load])

  useEffect(() => {
    const id = window.setInterval(() => {
      void load(range)
    }, 60000)
    return () => window.clearInterval(id)
  }, [range, load])

  //nowTick: drives the "Xs ago" staleness indicator in the toolbar.
  //Updates every 10 seconds, which is frequent enough to feel live but cheap.
  useEffect(() => {
    const tick = window.setInterval(() => setNowTick(Date.now()), 10000)
    return () => window.clearInterval(tick)
  }, [])

  const total = data?.kpis.total || 0
  const series = data?.series || []
  const maxSeries = Math.max(1, ...(series.map(s => s.count) || [1]))
  const maxCategory = Math.max(1, ...(data?.byCategory.map(c => c.count) || [1]))
  const trendClass = (data?.trend.percent || 0) >= 0 ? 'text-green-600' : 'text-red-600'

  const severity = useMemo(() => (
    Object.entries(data?.bySeverity || {}).map(([label, count]) => ({ label, count }))
  ), [data])

  //Dynamic status list derived from API data
  const statuses = useMemo(() => (
    Object.entries(data?.byStatus || {}).map(([label, count]) => ({ label, count }))
  ), [data])

  /**
   * hybrid useMemo -- all client-side analytics derived from the server series.
   *
   * movingAverage: 3-point backward-looking smooth, mirrors the server chart
   *   but computed here so hover tooltips can be accurate without an extra API.
   * spikeThreshold: mean + 1.5σ of the series -- same rule as reportRoutes.ts;
   *   any period at or above this value is flagged as an anomaly.
   * trendFromSeries: splits the series in half and computes second/first % change;
   *   a positive value means the second half had more reports than the first.
   * chartScaleMax: rounded-up Y axis max so bars always have headroom above the
   *   highest value (spike threshold included).
   * incidentSpikes: count of flagged periods, surfaced in the trend summary bar.
   */
  const hybrid = useMemo(() => {
    const points = series.map((p) => p.count)
    const mean = points.length ? points.reduce((a, b) => a + b, 0) / points.length : 0
    const variance = points.length ? points.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / points.length : 0
    const stdDev = Math.sqrt(variance)
    const spikeThreshold = Math.max(1, Math.round(mean + (stdDev * 1.5)))

    const movingAverage = series.map((_, idx) => {
      const start = Math.max(0, idx - 2)
      const segment = series.slice(start, idx + 1)
      const avg = segment.reduce((acc, row) => acc + row.count, 0) / Math.max(1, segment.length)
      return Math.round(avg * 10) / 10
    })

    const spikes = series.reduce((acc, point, idx) => {
      if (point.count >= spikeThreshold) {
        acc.push({ ...point, movingAvg: movingAverage[idx] || 0 })
      }
      return acc
    }, [] as Array<{ label: string; count: number; movingAvg: number }>)

    const half = Math.max(1, Math.floor(series.length / 2))
    const firstHalf = series.slice(0, half).reduce((acc, point) => acc + point.count, 0)
    const secondHalf = series.slice(half).reduce((acc, point) => acc + point.count, 0)
    const trendFromSeries = safePct(secondHalf, firstHalf)

    const scaleMax = roundUpScale(Math.max(maxSeries, ...movingAverage, spikeThreshold))

    return {
      movingAverage,
      spikes,
      spikeThreshold,
      trendFromSeries,
      chartScaleMax: scaleMax,
      incidentSpikes: spikes.length,
    }
  }, [series, maxSeries])

  const reportsToday = data?.operationalMetrics?.reportsToday ?? data?.kpis.reportsToday ?? 0
  const reportsThisWeek = data?.operationalMetrics?.reportsThisWeek ?? data?.kpis.reportsThisWeek ?? 0
  const falseReportRate = data?.operationalMetrics?.falseReportRate ?? data?.kpis.falseReportRate ?? 0
  const adminResponse = data?.performanceMetrics?.adminResponseTime ?? data?.kpis.adminResponseMinutes ?? 0
  const completionTime = data?.performanceMetrics?.investigationCompletionTime ?? data?.kpis.investigationCompletionMinutes ?? 0
  const weekOverWeek = data?.trendMetrics?.weekOverWeekGrowth ?? data?.trend.percent ?? 0
  const monthlyTrend = data?.trendMetrics?.monthlyTrend ?? hybrid.trendFromSeries
  const reportsPerOfficer = data?.performanceMetrics?.reportsPerOfficer || []
  const maxOfficer = Math.max(1, ...(reportsPerOfficer.map((row) => row.count) || [1]))
  const heatmap = data?.intelligenceMetrics?.categoryHeatmap || []
  const clusters = data?.intelligenceMetrics?.locationClusters || []
  const quality = data?.dataQuality
  const lastAgeSec = lastRefreshRef.current > 0 ? Math.max(0, Math.floor((nowTick - lastRefreshRef.current) / 1000)) : 0
  const trendLabel = hybrid.trendFromSeries > 0 ? 'Rising' : hybrid.trendFromSeries < 0 ? 'Falling' : 'Stable'
  const recentWindow = series.slice(Math.max(0, series.length - 4))
  //forecastNext: 4-period rolling average of the most recent data points.
  //Gives a rough "next period" estimate without a server round-trip.
  const forecastNext = recentWindow.length
    ? Math.round(recentWindow.reduce((sum, point) => sum + point.count, 0) / recentWindow.length)
    : 0

  const handleExport = (format: 'csv' | 'json') => {
    if (!data) return
    const payload = {
      kpis: data.kpis,
      series: data.series,
      bySeverity: data.bySeverity,
      byStatus: data.byStatus,
      byCategory: data.byCategory,
      clusters: clusters,
      heatmap: heatmap,
      reportsPerOfficer: reportsPerOfficer,
      trend: data.trend,
      generatedAt: data.generatedAt,
      range: data.range,
    }
    exportData(payload, format, `aegis-analytics-${data.range}-${new Date().toISOString().slice(0, 10)}`)
  }

  const emptyState = (title: string, subtitle: string) => (
    <div className="flex flex-col items-center justify-center h-24 text-center">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{title}</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-1">{subtitle}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeValue)}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-500 transition-colors"
          >
            <option value="24h">{'Last 24h'}</option>
            <option value="7d">{'Last 7 days'}</option>
            <option value="30d">{'Last 30 days'}</option>
            <option value="all">{'All time'}</option>
            <option value="custom">Custom Range...</option>
          </select>
          {range === 'custom' && (
            <div className="flex items-center gap-1.5 animate-fade-in">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                max={customTo || undefined}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-500 transition-colors"
              />
 <span className="text-[10px] text-gray-400">{'->'}</span>
              <input
                type="date"
                value={customTo}
                onChange={e => {
                  setCustomTo(e.target.value)
                  if (customFrom && e.target.value) load(range)
                }}
                min={customFrom || undefined}
                max={new Date().toISOString().slice(0,10)}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-500 transition-colors"
              />
            </div>
          )}
          <button
            onClick={() => load(range)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border ${socketConnected ? 'text-green-700 bg-green-50 border-green-200 dark:bg-green-950/20 dark:text-green-300 dark:border-green-800' : 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-800'}`}>
            <Wifi className="w-3 h-3" />
            {socketConnected ? 'Live stream connected' : 'Polling fallback active'}
          </span>
          {/* Export buttons */}
          <button
            onClick={() => handleExport('csv')}
            disabled={!data}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-40"
            title={'Export CSV'}
          >
            <Download className="w-3.5 h-3.5" /> {'CSV'}
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={!data}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-40"
            title={'Export JSON'}
          >
            <Download className="w-3.5 h-3.5" /> {'JSON'}
          </button>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-300">
          {data?.generatedAt ? `${'Live as of'} ${new Date(data.generatedAt).toLocaleTimeString()} - ${lastAgeSec}s ago` : 'Live data'}
        </p>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-2.5">{error}</div>}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3" aria-busy="true" aria-label="Loading analytics">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 shadow-sm animate-pulse">
              <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3" />
              <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {[
          { label: 'Reports Today', value: reportsToday, color: 'text-aegis-600' },
          { label: 'Reports This Week', value: reportsThisWeek, color: 'text-blue-600' },
          { label: 'Total Reports', value: total, color: 'text-gray-900 dark:text-white' },
          { label: 'Avg AI Confidence', value: `${data?.kpis.avgConfidence || 0}%`, color: 'text-aegis-600' },
          { label: 'AI Accuracy Rate', value: `${data?.kpis.aiAccuracyRate || 0}%`, color: 'text-emerald-600' },
          { label: 'False Report Rate', value: `${falseReportRate}%`, color: 'text-purple-600' },
          { label: 'Verification Rate', value: `${data?.kpis.verificationRate || 0}%`, color: 'text-green-600' },
          { label: 'Avg Response Time', value: fmtMins(adminResponse), color: 'text-cyan-600' },
          { label: 'Avg Verify Time', value: fmtMins(data?.kpis.avgVerifyMinutes || 0), color: 'text-indigo-600' },
          { label: 'Avg Resolution', value: fmtMins(data?.kpis.avgResolveMinutes || 0), color: 'text-amber-600' },
          { label: 'Geographic Coverage', value: `${data?.kpis.geoCoverageKm || 0} km`, color: 'text-teal-600' },
          { label: 'Threat Level Index', value: data?.kpis.threatLevelIndex || 0, color: data?.kpis.threatLevelIndex && data.kpis.threatLevelIndex >= 70 ? 'text-red-600' : data?.kpis.threatLevelIndex && data.kpis.threatLevelIndex >= 40 ? 'text-amber-600' : 'text-green-600' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 shadow-sm">
            <p className="text-[10px] text-gray-500 dark:text-gray-300 font-bold uppercase">{kpi.label}</p>
            <p className={`text-2xl font-extrabold ${kpi.color}`}>{loading ? <span className="inline-block w-12 h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /> : kpi.value}</p>
          </div>
        ))}
      </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200 col-span-2 md:col-span-2">
          <TrendingUp className="w-4 h-4 text-aegis-600" />
          {'Hybrid Trend (Live + Client Approximation)'}
        </div>
        <div className="text-right">
          <p className={`text-lg font-extrabold ${trendClass}`}>{weekOverWeek}%</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-300">{'Week-over-week'}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-extrabold ${monthlyTrend >= 0 ? 'text-green-600' : 'text-red-600'}`}>{monthlyTrend}%</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-300">{'Monthly trend'}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold text-amber-600">{hybrid.incidentSpikes}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-300">{'Detected spikes'}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-extrabold ${hybrid.trendFromSeries >= 0 ? 'text-green-600' : 'text-red-600'}`}>{hybrid.trendFromSeries}%</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-300">{'Client trend estimate'}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-aegis-600" />
          {'System Health'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="flex flex-col gap-1 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${data ? 'bg-green-500 animate-pulse' : error ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} />
              <span className="text-gray-600 dark:text-gray-300">{'Database'}</span>
            </div>
            <span className={`text-sm font-bold ${data ? 'text-green-600' : error ? 'text-red-600' : 'text-amber-600'}`}>
              {data ? 'Connected' : error ? 'Error' : 'Connecting'}
            </span>
          </div>
          <div className="flex flex-col gap-1 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="text-gray-600 dark:text-gray-300">{'Live Stream'}</span>
            </div>
            <span className={`text-sm font-bold ${socketConnected ? 'text-green-600' : 'text-amber-600'}`}>
              {socketConnected ? 'Active' : 'Polling'}
            </span>
          </div>
          <div className="flex flex-col gap-1 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${data?.kpis?.aiScored != null && data.kpis.aiScored > 0 ? 'bg-green-500 animate-pulse' : data ? 'bg-amber-500' : 'bg-gray-400'}`} />
              <span className="text-gray-600 dark:text-gray-300">{'Analytics Engine'}</span>
            </div>
            <span className={`text-sm font-bold ${data?.kpis?.aiScored != null && data.kpis.aiScored > 0 ? 'text-green-600' : data ? 'text-amber-600' : 'text-gray-500'}`}>
              {data?.kpis?.aiScored != null && data.kpis.aiScored > 0 ? 'Running' : data ? 'Idle' : '--'}
            </span>
          </div>
          <div className="flex flex-col gap-1 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-gray-600 dark:text-gray-300">{'Last Data Sync'}</span>
            </div>
            <span className="text-sm font-bold text-blue-600">
              {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '--:--:--'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-aegis-600" /> {'Report Volume + Moving Average'}</h3>
          {series.length === 0 ? (
            emptyState('No reports in selected range', 'Submit a report to generate analytics')
          ) : (
            <>
              {series.every(s => s.count === 0) && (
                <p className="text-xs text-gray-400 dark:text-gray-300 text-center py-2 italic">{'No reports in this time range - bars will populate as data arrives.'}</p>
              )}
              <div className="relative flex items-end gap-1 h-28">
                {series.map((point, i) => {
                  const barPct = point.count === 0 ? 0 : Math.max(4, Math.round((point.count / hybrid.chartScaleMax) * 100))
                  const maPct = hybrid.movingAverage[i] === 0 ? 0 : Math.max(2, Math.round((hybrid.movingAverage[i] / hybrid.chartScaleMax) * 100))
                  const isSpike = point.count >= hybrid.spikeThreshold && point.count > 0
                  return (
                    <div key={`${point.label}-${i}`} className="flex-1 flex flex-col items-center gap-0.5 relative">
                      <span className="text-[8px] text-gray-400 dark:text-gray-300">{point.count > 0 ? point.count : ''}</span>
                      <div className="w-full relative flex flex-col justify-end" style={{ height: '100%' }}>
                        {barPct > 0 && (
                          <div className={`w-full rounded-t ${isSpike ? 'bg-amber-500' : 'bg-aegis-500'}`} style={{ height: `${barPct}%` }} title={`${point.label}: ${point.count}`} />
                        )}
                        {barPct === 0 && (
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-t" style={{ height: '2px' }} title={`${point.label}: 0`} />
                        )}
                      </div>
                      {maPct > 0 && (
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-500 border border-white dark:border-gray-900 z-10"
                          style={{ bottom: `${maPct}%` }} title={`MA: ${hybrid.movingAverage[i]}`} />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-1 mt-1">
                {series.map((point, i) => (
                  <div key={`lbl-${i}`} className="flex-1 text-center text-micro text-gray-400 dark:text-gray-300">{i % Math.ceil(((series.length || 1) / 6)) === 0 ? point.label : ''}</div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500 dark:text-gray-300">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-aegis-500 inline-block" /> {'reports'}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {'Spike'}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> {'Moving avg'}</span>
                <span className="ml-auto">{'Scale'}: {hybrid.chartScaleMax} - {'Spike'} ≥ {hybrid.spikeThreshold}</span>
              </div>
            </>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><PieChart className="w-4 h-4 text-aegis-600" /> {'Severity Distribution'}</h3>
          {severity.length === 0 ? (
            emptyState('No severity data available', 'Reports will appear here once submitted')
          ) : (
            <div className="space-y-2">
            {severity.map(({ label, count }) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              const color = label === 'High' ? 'bg-red-500' : label === 'Medium' ? 'bg-amber-500' : 'bg-blue-500'
              return (
                <div key={label} className={onFilterSeverity ? 'cursor-pointer hover:opacity-80' : ''} onClick={() => onFilterSeverity?.(label)}>
                  <div className="flex justify-between text-xs mb-0.5"><span>{label}</span><span className="text-gray-500 dark:text-gray-300">{count} ({pct}%)</span></div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"><div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-aegis-600" /> {'Top Incident Types'}</h3>
          {(data?.byCategory || []).length === 0 ? (
            emptyState('No incident categories yet', 'Categories will populate as reports arrive')
          ) : (
            <div className="space-y-2">
            {(data?.byCategory || []).map((row) => {
              const pct = Math.round((row.count / maxCategory) * 100)
              return (
                <div key={row.category} className={onFilterCategory ? 'cursor-pointer hover:opacity-80' : ''} onClick={() => onFilterCategory?.(row.category)}>
                  <div className="flex justify-between text-xs mb-0.5"><span className="capitalize">{row.category.replace(/_/g, ' ')}</span><span className="text-gray-500 dark:text-gray-300">{row.count}</span></div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"><div className="bg-aegis-500 h-2 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-aegis-600" /> {'Status Distribution'}</h3>
          {statuses.length === 0 ? (
            emptyState('No status data available', 'Report statuses will appear here')
          ) : (
            <div className="space-y-2">
            {statuses.map(({ label, count }) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              const color = label === 'Urgent' ? 'bg-red-600' : label === 'Verified' ? 'bg-green-500' : label === 'Flagged' ? 'bg-amber-500' : label === 'Resolved' ? 'bg-gray-500' : label === 'Archived' ? 'bg-slate-500' : label === 'False_Report' ? 'bg-rose-700' : 'bg-blue-500'
              return (
                <div key={label} className={onFilterStatus ? 'cursor-pointer hover:opacity-80' : ''} onClick={() => onFilterStatus?.(label)}>
                  <div className="flex justify-between text-xs mb-0.5"><span>{label}</span><span className="text-gray-500 dark:text-gray-300">{count} ({pct}%)</span></div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"><div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-aegis-600" /> {'Category Heatmap (Severity)'}</h3>
          {!heatmap.length ? (
            emptyState('No heatmap data yet', 'Cross-category severity data will appear here')
          ) : (
            <div className="space-y-2">
            {(heatmapExpanded ? heatmap : heatmap.slice(0, COLLAPSE_COUNT)).map((row) => (
              <div key={row.category} className="text-xs">
                <div className="flex justify-between mb-1">
                  <span className="capitalize">{row.category.replace(/_/g, ' ')}</span>
                  <span className="text-gray-500 dark:text-gray-300">{row.total}</span>
                </div>
                <div className="w-full h-2 rounded overflow-hidden bg-gray-100 dark:bg-gray-800 flex">
                  <div className="bg-red-500" style={{ width: `${row.total > 0 ? Math.round((row.High / row.total) * 100) : 0}%` }} />
                  <div className="bg-amber-500" style={{ width: `${row.total > 0 ? Math.round((row.Medium / row.total) * 100) : 0}%` }} />
                  <div className="bg-blue-500" style={{ width: `${row.total > 0 ? Math.round((row.Low / row.total) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
            {heatmap.length > COLLAPSE_COUNT && (
              <button
                onClick={() => setHeatmapExpanded(!heatmapExpanded)}
                className="text-[10px] text-aegis-600 hover:text-aegis-700 font-semibold mt-1"
              >
                {heatmapExpanded ? `${'Show less'} ▲` : `${'Show more'} ${heatmap.length - COLLAPSE_COUNT} ▼`}
              </button>
            )}
          </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-aegis-600" /> {'Location Clusters'}</h3>
          {clusters.length === 0 ? (
            emptyState('No geospatial clusters detected', 'Location clusters will appear as reports arrive')
          ) : (
            <div className="space-y-2">
            {(clustersExpanded ? clusters : clusters.slice(0, COLLAPSE_COUNT)).map((cluster, idx) => (
              <div key={`${cluster.label}-${idx}`} className="flex items-center justify-between text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5">
                <span className="text-gray-700 dark:text-gray-200">{cluster.label}</span>
                <span className="font-semibold text-aegis-600">{cluster.count}</span>
              </div>
            ))}
            {clusters.length > COLLAPSE_COUNT && (
              <button
                onClick={() => setClustersExpanded(!clustersExpanded)}
                className="text-[10px] text-aegis-600 hover:text-aegis-700 font-semibold mt-1"
              >
                {clustersExpanded ? `${'Show less'} ▲` : `${'Show more'} ${clusters.length - COLLAPSE_COUNT} ▼`}
              </button>
            )}
          </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-aegis-600" /> {'Reports per Officer'}</h3>
          {reportsPerOfficer.length === 0 ? (
            emptyState('No officer activity yet', 'Officer performance will be tracked here')
          ) : (
            <div className="space-y-2">
            {reportsPerOfficer.map((row) => {
              const pct = Math.round((row.count / maxOfficer) * 100)
              return (
                <div key={row.officer}>
                  <div className="flex justify-between text-xs mb-0.5"><span className="truncate max-w-[120px] sm:max-w-[160px] md:max-w-[200px]">{row.officer}</span><span className="text-gray-500 dark:text-gray-300 shrink-0 ml-2">{row.count}</span></div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"><div className="bg-aegis-500 h-2 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-aegis-600" /> {'Performance Metrics'}</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-gray-500 dark:text-gray-300">{'Admin response time'}</p>
              <p className="text-base font-bold text-blue-600">{fmtMins(adminResponse)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-gray-500 dark:text-gray-300">{'Investigation completion'}</p>
              <p className="text-base font-bold text-green-600">{fmtMins(completionTime)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 col-span-2">
              <p className="text-gray-500 dark:text-gray-300">{'Moving average window'}</p>
              <p className="text-base font-bold text-aegis-600">{'3 buckets (client-side)'}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-aegis-600" /> {'Forecast & Anomaly Intelligence'}</h3>
          {series.length === 0 ? (
            emptyState('No forecast data yet', 'Predictions will appear once time-series builds')
          ) : (
            <>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-gray-500 dark:text-gray-300">{'Next bucket forecast'}</p>
              <p className="text-base font-bold text-aegis-600">{forecastNext}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-gray-500 dark:text-gray-300">{'Series direction'}</p>
              <p className="text-base font-bold text-blue-600">{trendLabel}</p>
            </div>
          </div>
          <div className="space-y-2">
            {hybrid.spikes.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-300">{'No anomalies currently above dynamic threshold.'}</p>}
            {(spikesExpanded ? hybrid.spikes : hybrid.spikes.slice(0, 4)).map((spike) => (
              <div key={`spike-${spike.label}`} className="text-xs border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 rounded-lg px-2 py-1.5 flex items-center justify-between">
                <span>{'Spike at'} {spike.label}</span>
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {spike.count} ({'Moving avg'.toLowerCase()} {spike.movingAvg})
                </span>
              </div>
            ))}
            {hybrid.spikes.length > 4 && (
              <button
                onClick={() => setSpikesExpanded(!spikesExpanded)}
                className="text-[10px] text-aegis-600 hover:text-aegis-700 font-semibold mt-1"
              >
                {spikesExpanded ? `${'Show less'} ▲` : `${'Show more'} ${hybrid.spikes.length - 4} ▼`}
              </button>
            )}
          </div>
          </>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-aegis-600" /> {'Data Quality & Coverage'}</h3>
          <div className="space-y-2">
            {[
              { label: 'AI Coverage', value: quality?.aiCoverageRate ?? (total > 0 ? Math.round(((data?.kpis.aiScored || 0) / total) * 100) : 0), color: 'bg-indigo-500' },
              { label: 'Media coverage', value: quality?.mediaCoverageRate ?? data?.kpis.mediaRate ?? 0, color: 'bg-purple-500' },
              { label: 'Verification coverage', value: quality?.verificationCoverageRate ?? data?.kpis.verificationRate ?? 0, color: 'bg-green-500' },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-0.5"><span>{item.label}</span><span className="text-gray-500 dark:text-gray-300">{item.value}%</span></div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"><div className={`${item.color} h-2 rounded-full`} style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-300 flex items-center gap-2">
        <Timer className="w-4 h-4 text-aegis-600" />
        {'Hybrid analytics: live DB aggregates + client approximations, with auto-refresh via WebSocket events and 60s polling fallback.'}
      </div>
    </div>
  )
}

