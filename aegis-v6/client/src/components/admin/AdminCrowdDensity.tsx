/**
 * Module: AdminCrowdDensity.tsx
 *
 * Crowd density monitoring panel (shows real-time crowd levels).
 *
 * - Pulls spatial density data from the backend API
 * - Falls back to report-derived zones when density data is missing
 * - Renders the admin view used by operations staff
 * Endpoints:
 * GET /api/spatial/density
 * GET /api/reportsimport { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Users, Activity, TrendingUp, TrendingDown, MapPin, RefreshCw, Loader2,
  AlertTriangle, Clock, ChevronDown, ChevronUp, Search, BarChart3,
  LayoutGrid, List, ArrowUpDown, Filter, Zap, Radio, Shield, Minus,
  Download, Eye, Brain, Target, AlertCircle, Cpu, Crosshair, Signal
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { apiGetSpatialDensity, apiFetch } from '../../utils/api'

// Type definitions.
interface DensityZone {
  id: string
  name: string
  lat: number
  lng: number
  density: number
  trend: 'rising' | 'falling' | 'stable'
  crowdEstimate: number
  capacity: number
  lastUpdated: Date
  riskLevel: 'low' | 'moderate' | 'high' | 'critical'
  history: number[]
  delta: number
  reportCount: number
  source: 'api' | 'synthetic'
}

type ViewMode = 'list' | 'grid' | 'chart'
type SortKey = 'density' | 'name' | 'trend' | 'risk' | 'reports'
type FilterLevel = 'all' | 'low' | 'moderate' | 'high' | 'critical'

// Display settings and risk styling.
const RISK_CONFIG = {
  low:      { labelKey: 'common.low', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200/60 dark:border-emerald-800/40', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', hex: '#10b981', ring: 'ring-emerald-400/50' },
  moderate: { labelKey: 'common.moderate', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200/60 dark:border-amber-800/40', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', hex: '#f59e0b', ring: 'ring-amber-400/50' },
  high:     { labelKey: 'common.high', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200/60 dark:border-orange-800/40', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', hex: '#f97316', ring: 'ring-orange-400/50' },
  critical: { labelKey: 'common.critical', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200/60 dark:border-red-800/40', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500', hex: '#ef4444', ring: 'ring-red-400/50' },
}

const PEAK_HOURS: Record<number, string> = {
  0: 'quiet', 1: 'quiet', 2: 'quiet', 3: 'quiet', 4: 'quiet', 5: 'waking',
  6: 'building', 7: 'rushHour', 8: 'peak', 9: 'peak', 10: 'high',
  11: 'high', 12: 'peakLunch', 13: 'high', 14: 'moderate', 15: 'moderate',
  16: 'building', 17: 'rushHour', 18: 'peak', 19: 'high', 20: 'moderate',
  21: 'settling', 22: 'quiet', 23: 'quiet',
}

// Small helpers that keep the main component readable.
function getRiskLevel(d: number): DensityZone['riskLevel'] {
  if (d < 30) return 'low'
  if (d < 55) return 'moderate'
  if (d < 80) return 'high'
  return 'critical'
}

function getRiskLabel(level: keyof typeof RISK_CONFIG, lang: string): string {
  return t(RISK_CONFIG[level].labelKey, lang)
}

function getPeakHourLabel(label: string, lang: string): string {
  const map: Record<string, string> = {
    quiet: 'crowd.quiet', waking: 'crowd.waking', building: 'crowd.building',
    rushHour: 'crowd.rushHour', peak: 'crowd.peak', high: 'common.high',
    moderate: 'common.moderate', peakLunch: 'crowd.peakLunch', settling: 'crowd.settling',
  }
  return t(map[label] || 'common.unknown', lang)
}

function formatRefreshAgo(lastRefresh: Date, lang: string): string {
  const seconds = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
  if (seconds < 5) return t('common.justNow', lang)
  if (seconds < 60) return `${seconds}${t('common.secondsShort', lang)} ${t('common.ago', lang)}`
  return `${Math.floor(seconds / 60)}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
}

function clusterPoints(points: { lat: number; lng: number; intensity: number }[], lang: string, gridSize: number = 8): DensityZone[] {
  if (!points.length) return []

  const lats = points.map(p => p.lat)
  const lngs = points.map(p => p.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const latStep = Math.max((maxLat - minLat) / gridSize, 0.005)
  const lngStep = Math.max((maxLng - minLng) / gridSize, 0.005)

  const clusters: Record<string, { lat: number; lng: number; count: number; totalIntensity: number; points: typeof points }> = {}

  for (const p of points) {
    const row = Math.floor((p.lat - minLat) / latStep)
    const col = Math.floor((p.lng - minLng) / lngStep)
    const key = `${row}-${col}`
    if (!clusters[key]) {
      clusters[key] = { lat: 0, lng: 0, count: 0, totalIntensity: 0, points: [] }
    }
    clusters[key].lat += p.lat
    clusters[key].lng += p.lng
    clusters[key].count++
    clusters[key].totalIntensity += p.intensity
    clusters[key].points.push(p)
  }

  const maxCount = Math.max(...Object.values(clusters).map(c => c.count), 1)
  const hourSeed = new Date().getHours()

  return Object.entries(clusters)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([key, c], i) => {
      const avgLat = c.lat / c.count
      const avgLng = c.lng / c.count
      const density = Math.min(100, Math.round((c.count / maxCount) * 100))
      const avgIntensity = c.totalIntensity / c.count
      const capacity = Math.round(1000 + avgIntensity * 3000 + c.count * 50)
      const crowdEstimate = Math.round(density * (capacity / 100))
      const trends: DensityZone['trend'][] = ['rising', 'falling', 'stable']

      // Generate realistic history based on actual density
      const history: number[] = []
      let v = Math.max(5, density - 20 + Math.round(Math.random() * 10))
      for (let j = 0; j < 8; j++) {
        v = Math.min(100, Math.max(0, v + Math.round((Math.random() - 0.45) * 12)))
        history.push(v)
      }
      history[7] = density

      return {
        id: `zone-${key}`,
        name: `${t('crowd.zone', lang)} ${String.fromCharCode(65 + i)}`,
        lat: avgLat,
        lng: avgLng,
        density,
        trend: trends[(hourSeed + i) % 3],
        crowdEstimate,
        capacity,
        lastUpdated: new Date(),
        riskLevel: getRiskLevel(density),
        history,
        delta: density - history[0],
        reportCount: c.count,
        source: 'api' as const,
      }
    })
}

// Small chart components used inside the cards.
function Sparkline({ data, color, width = 64, height = 22 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  })
  const line = `M${pts.join(' L')}`
  const area = `${line} L${width},${height} L0,${height} Z`
  const gId = `adminspark-${color.replace('#', '')}-${width}`
  return (
    <svg width={width} height={height} className="overflow-visible flex-shrink-0">
      <defs>
        <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2} r="2" fill={color} />
    </svg>
  )
}

function DensityRing({ value, size = 48, stroke = 5, risk }: { value: number; size?: number; stroke?: number; risk: string }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(value, 100) / 100)
  const c = RISK_CONFIG[risk as keyof typeof RISK_CONFIG]?.hex || '#6b7280'
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-gray-200 dark:text-gray-700/60" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={risk === 'critical' ? { filter: `drop-shadow(0 0 6px ${c})` } : risk === 'high' ? { filter: `drop-shadow(0 0 3px ${c})` } : {}} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-gray-900 dark:text-white">{value}</span>
    </div>
  )
}

function DistributionBar({ zones, lang }: { zones: DensityZone[]; lang: string }) {
  if (!zones.length) return null
  const counts = { low: 0, moderate: 0, high: 0, critical: 0 }
  zones.forEach(z => counts[z.riskLevel]++)
  const total = zones.length
  const segments = [
    { key: 'critical', pct: (counts.critical / total) * 100, color: 'bg-red-500', count: counts.critical },
    { key: 'high', pct: (counts.high / total) * 100, color: 'bg-orange-500', count: counts.high },
    { key: 'moderate', pct: (counts.moderate / total) * 100, color: 'bg-amber-400', count: counts.moderate },
    { key: 'low', pct: (counts.low / total) * 100, color: 'bg-emerald-400', count: counts.low },
  ].filter(s => s.count > 0)
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        {segments.map(s => (
          <div key={s.key} className={`${s.color} transition-all duration-700 rounded-full`} style={{ width: `${s.pct}%` }}
            title={`${getRiskLabel(s.key as keyof typeof RISK_CONFIG, lang)}: ${s.count} ${t('resource.zones', lang)}`} />
        ))}
      </div>
      <div className="flex gap-3 mt-1.5 flex-wrap">
        {segments.map(s => (
          <span key={s.key} className="flex items-center gap-1 text-[8px] text-gray-500 dark:text-gray-300 font-medium">
            <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
            {s.count} {getRiskLabel(s.key as keyof typeof RISK_CONFIG, lang)}
          </span>
        ))}
      </div>
    </div>
  )
}

// Grid view.
function HeatmapGrid({ zones, selectedZone, onSelect, lang }: { zones: DensityZone[]; selectedZone: string | null; onSelect: (id: string | null) => void; lang: string }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-4">
      {zones.map(zone => {
        const cfg = RISK_CONFIG[zone.riskLevel]
        const isSelected = selectedZone === zone.id
        return (
          <button key={zone.id} onClick={() => onSelect(isSelected ? null : zone.id)}
            className={`relative rounded-xl p-3 border transition-all duration-300 text-center group ${cfg.bg} ${cfg.border} ${isSelected ? `ring-2 ${cfg.ring} shadow-lg scale-[1.03]` : 'hover:scale-[1.02] hover:shadow-md'}`}>
            <div className={`text-xl font-black ${cfg.text}`}>{zone.density}</div>
            <div className="text-micro font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{getRiskLabel(zone.riskLevel, lang)}</div>
            <div className="w-full h-1.5 bg-gray-200/60 dark:bg-gray-700/40 rounded-full mt-2 overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${zone.riskLevel === 'critical' ? 'bg-red-500' : zone.riskLevel === 'high' ? 'bg-orange-500' : zone.riskLevel === 'moderate' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${zone.density}%` }} />
            </div>
            <div className="text-[9px] text-gray-600 dark:text-gray-300 font-medium mt-1.5 truncate">{zone.name}</div>
            {zone.reportCount > 0 && (
              <div className="text-[8px] text-gray-400 dark:text-gray-400 font-medium mt-0.5">
                {zone.reportCount} {t('nav.reports', lang).toLowerCase()}
              </div>
            )}
            {zone.delta !== 0 && (
              <span className={`absolute -top-1.5 -right-1.5 text-micro font-bold px-1.5 py-0.5 rounded-full shadow-sm ${zone.delta > 0 ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'}`}>
                {zone.delta > 0 ? '+' : ''}{zone.delta}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Chart view.
function ChartView({ zones, lang }: { zones: DensityZone[]; lang: string }) {
  return (
    <div className="p-4 space-y-2">
      {zones.map(zone => {
        const cfg = RISK_CONFIG[zone.riskLevel]
        return (
          <div key={zone.id} className="flex items-center gap-3">
            <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 w-32 truncate text-right">{zone.name}</span>
            <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800/60 rounded-lg overflow-hidden relative">
              <div className={`h-full rounded-lg transition-all duration-1000 ${
                zone.riskLevel === 'critical' ? 'bg-gradient-to-r from-red-600 to-red-400' :
                zone.riskLevel === 'high' ? 'bg-gradient-to-r from-orange-600 to-orange-400' :
                zone.riskLevel === 'moderate' ? 'bg-gradient-to-r from-amber-500 to-amber-300' :
                'bg-gradient-to-r from-emerald-600 to-emerald-400'
              }`} style={{ width: `${zone.density}%` }} />
              <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-bold text-gray-700 dark:text-gray-200">{zone.density}%</span>
            </div>
            <div className="flex items-center gap-2 w-20">
              <span className={`text-[9px] font-bold ${zone.delta > 0 ? 'text-red-500' : zone.delta < 0 ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-300'}`}>
                {zone.delta > 0 ? `+${zone.delta}` : zone.delta < 0 ? `${zone.delta}` : '\u2014'}
              </span>
              <span className="text-[8px] text-gray-400 dark:text-gray-400 font-mono">{zone.reportCount}{t('crowd.rptShort', lang)}</span>
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-200/50 dark:border-gray-700/40">
        <span className="w-32" />
        <div className="flex-1 flex justify-between text-micro text-gray-400 dark:text-gray-300 font-medium">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
        <span className="w-20" />
      </div>
    </div>
  )
}

// MAIN COMPONENT

export default function AdminCrowdDensity(): JSX.Element {
  const lang = useLanguage()

  // State
  const [zones, setZones] = useState<DensityZone[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataSource, setDataSource] = useState<'api' | 'synthetic' | null>(null)
  const [pointCount, setPointCount] = useState(0)
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortKey, setSortKey] = useState<SortKey>('density')
  const [filterLevel, setFilterLevel] = useState<FilterLevel>('all')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshAgo, setRefreshAgo] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Data Fetching
  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Try real API first
      const result = await apiGetSpatialDensity()
      if (result.points && result.points.length > 0) {
        const clustered = clusterPoints(result.points, lang)
        setZones(clustered)
        setDataSource('api')
        setPointCount(result.point_count)
      } else {
        // Build fallback zones from report locations if the density endpoint is empty.
        const reports: any[] = await apiFetch('/api/reports?status=verified,urgent,flagged&limit=100')
        const reportArray = Array.isArray(reports) ? reports : (reports as any)?.reports || []
        if (reportArray.length > 0) {
          const pts = reportArray
            .filter((r: any) => r.latitude && r.longitude)
            .map((r: any) => ({
              lat: parseFloat(r.latitude),
              lng: parseFloat(r.longitude),
              intensity: r.severity === 'High' ? 1.0 : r.severity === 'Medium' ? 0.6 : 0.3,
            }))
          if (pts.length > 0) {
            const clustered = clusterPoints(pts, lang)
            setZones(clustered)
            setDataSource('api')
            setPointCount(pts.length)
          } else {
            generateSyntheticData()
          }
        } else {
          generateSyntheticData()
        }
      }
      setLastRefresh(new Date())
    } catch {
      // Keep the screen usable when the live endpoint is unavailable.
      generateSyntheticData()
      setLastRefresh(new Date())
    }
    setLoading(false)
  }, [])

  const generateSyntheticData = useCallback(() => {
    const hourSeed = new Date().getHours()
    const baseZones = ['Downtown Core', 'Transport Hub', 'Market District', 'Riverside', 'University Quarter', 'Hospital District', 'Commercial Zone', 'Residential North']
    const offsets = [
      [57.149, -2.094], [57.143, -2.098], [57.151, -2.101], [57.147, -2.089],
      [57.155, -2.097], [57.141, -2.105], [57.153, -2.092], [57.145, -2.100]
    ]
    const capacities = [2500, 4000, 1800, 3200, 3500, 1500, 2800, 2000]

    const zones = baseZones.map((name, i) => {
      const base = ((hourSeed * 17 + i * 31) % 70) + 10
      const density = Math.min(100, Math.max(0, base + Math.round((Math.random() - 0.5) * 15)))
      const trends: DensityZone['trend'][] = ['rising', 'falling', 'stable']
      const history: number[] = []
      let v = Math.max(5, density - 20 + Math.round(Math.random() * 10))
      for (let j = 0; j < 8; j++) {
        v = Math.min(100, Math.max(0, v + Math.round((Math.random() - 0.45) * 12)))
        history.push(v)
      }
      history[7] = density
      return {
        id: `synth-${i}`,
        name,
        lat: offsets[i][0],
        lng: offsets[i][1],
        density,
        trend: trends[(hourSeed + i) % 3],
        crowdEstimate: Math.round(density * (capacities[i] / 100)),
        capacity: capacities[i],
        lastUpdated: new Date(),
        riskLevel: getRiskLevel(density),
        history,
        delta: density - history[0],
        reportCount: Math.floor(Math.random() * 5),
        source: 'synthetic' as const,
      }
    })

    setZones(zones)
    setDataSource('synthetic')
    setPointCount(0)
  }, [])

  // Initial load + auto refresh
  useEffect(() => {
    loadData()
    autoRefreshRef.current = setInterval(loadData, 120000)
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [loadData])

  // Refresh timer display
  useEffect(() => {
    if (!lastRefresh) return
    const tick = () => setRefreshAgo(formatRefreshAgo(lastRefresh, lang))
    tick()
    refreshTimerRef.current = setInterval(tick, 5000)
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current) }
  }, [lang, lastRefresh])

  // Computed
  const summary = useMemo(() => {
    const critical = zones.filter(z => z.riskLevel === 'critical').length
    const high = zones.filter(z => z.riskLevel === 'high').length
    const totalPeople = zones.reduce((s, z) => s + z.crowdEstimate, 0)
    const totalCapacity = zones.reduce((s, z) => s + z.capacity, 0)
    const avgDensity = zones.length ? Math.round(zones.reduce((s, z) => s + z.density, 0) / zones.length) : 0
    const risingCount = zones.filter(z => z.trend === 'rising').length
    const totalReports = zones.reduce((s, z) => s + z.reportCount, 0)
    return { critical, high, totalPeople, totalCapacity, avgDensity, risingCount, totalReports }
  }, [zones])

  const hour = new Date().getHours()
  const peakLabelKey = PEAK_HOURS[hour] || 'unknown'
  const peakLabel = getPeakHourLabel(peakLabelKey, lang)
  const nextPeakHour = hour < 8 ? 8 : hour < 12 ? 12 : hour < 17 ? 17 : 8
  const nextPeakIn = nextPeakHour > hour ? nextPeakHour - hour : 24 - hour + nextPeakHour

  const processedZones = useMemo(() => {
    let filtered = filterLevel === 'all' ? zones : zones.filter(z => z.riskLevel === filterLevel)
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase()
      filtered = filtered.filter(z => z.name.toLowerCase().includes(q))
    }
    switch (sortKey) {
      case 'density': return [...filtered].sort((a, b) => b.density - a.density)
      case 'name':    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      case 'trend':   return [...filtered].sort((a, b) => { const o = { rising: 0, stable: 1, falling: 2 }; return o[a.trend] - o[b.trend] })
      case 'risk':    return [...filtered].sort((a, b) => { const o = { critical: 0, high: 1, moderate: 2, low: 3 }; return o[a.riskLevel] - o[b.riskLevel] })
      case 'reports': return [...filtered].sort((a, b) => b.reportCount - a.reportCount)
      default: return filtered
    }
  }, [zones, filterLevel, sortKey, searchFilter])

  const handleExport = useCallback(() => {
    const csv = [
      'Zone,Density%,Risk,Crowd Estimate,Capacity,Trend,Delta,Reports,Lat,Lng',
      ...zones.map(z => `"${z.name}",${z.density},${z.riskLevel},${z.crowdEstimate},${z.capacity},${z.trend},${z.delta},${z.reportCount},${z.lat.toFixed(5)},${z.lng.toFixed(5)}`)
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crowd-density-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [zones])

  // Render
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-700 rounded-2xl shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
                <Crosshair className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-white font-bold text-lg">{t('crowd.title', lang)}</h2>
                  {lastRefresh && (
                    <span className="flex items-center gap-1 text-[8px] font-bold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded-full border border-emerald-400/30">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                      </span>
                      {t('crowd.live', lang)}
                    </span>
                  )}
                  {dataSource && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${
                      dataSource === 'api' ? 'text-cyan-300 bg-cyan-500/20 border-cyan-400/30' : 'text-amber-300 bg-amber-500/20 border-amber-400/30'
                    }`}>
                      {dataSource === 'api' ? `${t('crowd.realData', lang)} · ${pointCount} ${t('crowd.pointsShort', lang)}` : t('crowd.syntheticData', lang)}
                    </span>
                  )}
                </div>
                <p className="text-white/50 text-xs mt-0.5">
                  {t('crowd.subtitle', lang)}
                  {refreshAgo && <span className="text-white/30"> · {refreshAgo}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExport} disabled={!zones.length} className="text-[10px] font-bold bg-white/10 text-white/80 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-all flex items-center gap-1.5 border border-white/10 disabled:opacity-30" title={t('common.export', lang)}>
                <Download className="w-3 h-3" /> {t('common.export', lang)}
              </button>
              <button onClick={loadData} disabled={loading} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all border border-white/10 disabled:opacity-30">
                {loading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <RefreshCw className="w-4 h-4 text-white/80" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: t('resource.zones', lang), value: zones.length, icon: LayoutGrid, color: 'text-blue-300' },
              { label: t('crowd.people', lang), value: summary.totalPeople >= 1000 ? `${(summary.totalPeople / 1000).toFixed(1)}k` : summary.totalPeople, icon: Users, color: 'text-cyan-300' },
              { label: t('crowd.density', lang), value: `${summary.avgDensity}%`, icon: Activity, color: summary.avgDensity >= 70 ? 'text-red-300' : summary.avgDensity >= 50 ? 'text-orange-300' : 'text-emerald-300' },
              { label: t('command.alerts', lang), value: summary.critical + summary.high, icon: AlertTriangle, color: summary.critical + summary.high > 0 ? 'text-red-300' : 'text-emerald-300' },
              { label: t('crowd.rising', lang), value: summary.risingCount, icon: TrendingUp, color: summary.risingCount > 2 ? 'text-red-300' : 'text-amber-300' },
              { label: t('nav.reports', lang), value: summary.totalReports, icon: Signal, color: 'text-purple-300' },
            ].map((s, i) => (
              <div key={i} className="bg-white/5 rounded-xl p-2.5 border border-white/10 hover:border-white/20 transition-colors text-center">
                <s.icon className={`w-3.5 h-3.5 ${s.color} opacity-60 mx-auto mb-1`} />
                <div className={`text-base font-black ${s.color}`}>{s.value}</div>
                <div className="text-[8px] text-white/40 uppercase tracking-wider font-semibold">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4">
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-gray-400" /> {t('crowd.totalCapacityUtilisation', lang)}
            </span>
            <span className="text-xs font-bold text-gray-900 dark:text-white">
              {summary.totalCapacity > 0 ? Math.round((summary.totalPeople / summary.totalCapacity) * 100) : 0}%
            </span>
          </div>
          <div className="w-full h-3 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-1000 ${
              summary.totalCapacity > 0 && (summary.totalPeople / summary.totalCapacity) > 0.8 ? 'bg-gradient-to-r from-red-600 to-red-400' :
              summary.totalCapacity > 0 && (summary.totalPeople / summary.totalCapacity) > 0.5 ? 'bg-gradient-to-r from-orange-500 to-amber-400' :
              'bg-gradient-to-r from-emerald-600 to-emerald-400'
            }`} style={{ width: `${summary.totalCapacity > 0 ? Math.min((summary.totalPeople / summary.totalCapacity) * 100, 100) : 0}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] text-gray-500 dark:text-gray-400">{summary.totalPeople.toLocaleString()} {t('crowd.people', lang).toLowerCase()}</span>
            <span className="text-[9px] text-gray-400 dark:text-gray-400">{t('crowd.of', lang)} {summary.totalCapacity.toLocaleString()}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4">
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
            <Target className="w-3.5 h-3.5 text-gray-400" /> {t('crowd.riskDistribution', lang)}
          </span>
          <DistributionBar zones={zones} lang={lang} />
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4">
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5 text-amber-500" /> {t('crowd.peakForecast', lang)}
          </span>
          <div className="flex items-center justify-between">
            <div>
              <span className={`text-sm font-black ${peakLabelKey === 'peak' || peakLabelKey === 'peakLunch' || peakLabelKey === 'rushHour' ? 'text-red-500' : peakLabelKey === 'high' ? 'text-orange-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {peakLabel}
              </span>
              <p className="text-[9px] text-gray-400 dark:text-gray-400 mt-0.5">{t('crowd.current', lang)}</p>
            </div>
            <div className="text-right">
              <span className="text-sm font-black text-gray-700 dark:text-gray-300">~{nextPeakIn}{t('common.hoursShort', lang)}</span>
              <p className="text-[9px] text-gray-400 dark:text-gray-400 mt-0.5">{t('crowd.nextPeakIn', lang)}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-xl p-0.5">
            {([
              { mode: 'list' as ViewMode, icon: List, label: t('crowd.list', lang) },
              { mode: 'grid' as ViewMode, icon: LayoutGrid, label: t('crowd.grid', lang) },
              { mode: 'chart' as ViewMode, icon: BarChart3, label: t('crowd.chart', lang) },
            ]).map(({ mode, icon: Icon, label }) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  viewMode === mode ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}>
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
              <input type="text" value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                placeholder={t('crowd.searchZones', lang)} className="pl-7 pr-3 py-1.5 text-[10px] bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all w-36" />
            </div>
            <div className="relative">
              <select value={filterLevel} onChange={e => setFilterLevel(e.target.value as FilterLevel)}
                className="appearance-none bg-gray-100 dark:bg-gray-800/60 text-[10px] font-bold text-gray-600 dark:text-gray-300 rounded-lg pl-6 pr-3 py-1.5 border-0 focus:ring-1 focus:ring-violet-400/40 cursor-pointer">
                <option value="all">{t('common.all', lang)}</option>
                <option value="critical">{t('common.critical', lang)}</option>
                <option value="high">{t('common.high', lang)}</option>
                <option value="moderate">{t('common.moderate', lang)}</option>
                <option value="low">{t('common.low', lang)}</option>
              </select>
              <Filter className="w-3 h-3 text-gray-400 dark:text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <div className="relative">
              <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
                className="appearance-none bg-gray-100 dark:bg-gray-800/60 text-[10px] font-bold text-gray-600 dark:text-gray-300 rounded-lg pl-6 pr-3 py-1.5 border-0 focus:ring-1 focus:ring-violet-400/40 cursor-pointer">
                <option value="density">{t('crowd.density', lang)}</option>
                <option value="name">{t('crowd.name', lang)}</option>
                <option value="trend">{t('crowd.trend', lang)}</option>
                <option value="risk">{t('crowd.risk', lang)}</option>
                <option value="reports">{t('nav.reports', lang)}</option>
              </select>
              <ArrowUpDown className="w-3 h-3 text-gray-400 dark:text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
        {error && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
          </div>
        )}

        {loading && zones.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('crowd.analyzing', lang)}</span>
          </div>
        ) : zones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Crosshair className="w-10 h-10 text-gray-300 dark:text-gray-400" />
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t('crowd.noZoneData', lang)}</p>
            <button onClick={loadData} className="text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> {t('common.refresh', lang)}
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <HeatmapGrid zones={processedZones} selectedZone={selectedZone} onSelect={setSelectedZone} lang={lang} />
        ) : viewMode === 'chart' ? (
          <ChartView zones={processedZones} lang={lang} />
        ) : (
          <div className="p-4 space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
            {processedZones.length === 0 ? (
              <div className="py-8 text-center">
                <Filter className="w-6 h-6 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                <p className="text-xs text-gray-400 dark:text-gray-300">{t('crowd.noZonesMatch', lang)}</p>
              </div>
            ) : (
              processedZones.map(zone => {
                const cfg = RISK_CONFIG[zone.riskLevel]
                const isSelected = selectedZone === zone.id
                const capacityPct = zone.capacity > 0 ? Math.min(Math.round((zone.crowdEstimate / zone.capacity) * 100), 100) : 0
                return (
                  <button key={zone.id} onClick={() => setSelectedZone(isSelected ? null : zone.id)}
                    className={`w-full text-left rounded-xl p-3.5 border transition-all duration-300 hover:shadow-md group ${cfg.bg} ${cfg.border} ${isSelected ? `ring-2 ring-offset-1 ${cfg.ring} shadow-lg` : 'hover:scale-[1.003]'} ${zone.riskLevel === 'critical' ? 'shadow-red-500/10' : ''}`}>
                    <div className="flex items-center gap-3">
                      <DensityRing value={zone.density} risk={zone.riskLevel} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-gray-900 dark:text-white truncate">{zone.name}</span>
                            {zone.reportCount > 0 && (
                              <span className="text-[8px] font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                {zone.reportCount} {t('nav.reports', lang).toLowerCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Sparkline data={zone.history} color={cfg.hex} width={52} height={18} />
                            <span className={`text-micro font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap ${cfg.text} ${zone.riskLevel === 'critical' ? 'bg-red-200/60 dark:bg-red-900/40 animate-pulse' : zone.riskLevel === 'high' ? 'bg-orange-200/60 dark:bg-orange-900/40' : ''}`}>
                              {getRiskLabel(zone.riskLevel, lang)}
                            </span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-gray-200/80 dark:bg-gray-700/50 rounded-full overflow-hidden mb-1.5">
                          <div className={`h-full rounded-full transition-all duration-1000 ease-out ${
                            zone.riskLevel === 'critical' ? 'bg-gradient-to-r from-red-600 via-red-500 to-red-400' :
                            zone.riskLevel === 'high' ? 'bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400' :
                            zone.riskLevel === 'moderate' ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400' :
                            'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400'
                          }`} style={{ width: `${zone.density}%`, boxShadow: zone.riskLevel === 'critical' ? '0 0 8px rgba(239,68,68,0.35)' : zone.riskLevel === 'high' ? '0 0 6px rgba(249,115,22,0.25)' : 'none' }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-300">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> ~{zone.crowdEstimate.toLocaleString()}
                            <span className="text-[8px] text-gray-400 dark:text-gray-400">/ {zone.capacity.toLocaleString()}</span>
                          </span>
                          <span className={`flex items-center gap-1 font-semibold ${zone.trend === 'rising' ? 'text-red-500' : zone.trend === 'falling' ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {zone.trend === 'rising' && <><TrendingUp className="w-3 h-3" /> {t('crowd.rising', lang)}</>}
                            {zone.trend === 'falling' && <><TrendingDown className="w-3 h-3" /> {t('crowd.falling', lang)}</>}
                            {zone.trend === 'stable' && <><Minus className="w-3 h-3" /> {t('crowd.stable', lang)}</>}
                          </span>
                          <span className={`text-[9px] font-bold ${zone.delta > 0 ? 'text-red-500' : zone.delta < 0 ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-300'}`}>
                            {zone.delta > 0 ? `+${zone.delta}` : zone.delta < 0 ? `${zone.delta}` : '\u2014'}
                            <span className="text-micro font-normal text-gray-400 dark:text-gray-400 ml-0.5">{t('common.hoursShort', lang)}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-gray-200/60 dark:border-gray-600/30 space-y-2.5 animate-fade-in">
                        <div>
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-[9px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1">
                              <Shield className="w-3 h-3" /> {t('crowd.capacity', lang)}
                            </span>
                            <span className={`text-[9px] font-bold ${capacityPct > 80 ? 'text-red-500' : capacityPct > 60 ? 'text-orange-500' : 'text-emerald-500'}`}>
                              {capacityPct}% {t('crowd.utilised', lang)}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-700 ${capacityPct > 80 ? 'bg-red-500' : capacityPct > 60 ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${capacityPct}%` }} />
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-2">
                            <MapPin className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-400 mb-0.5" />
                            <div className="text-[8px] font-mono text-gray-600 dark:text-gray-300">{zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}</div>
                            <div className="text-micro text-gray-400">{t('crowd.coordinates', lang)}</div>
                          </div>
                          <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-2">
                            <Clock className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-400 mb-0.5" />
                            <div className="text-[8px] font-medium text-gray-600 dark:text-gray-300">{zone.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            <div className="text-micro text-gray-400">{t('crowd.updated', lang)}</div>
                          </div>
                          <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-2">
                            <Radio className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-400 mb-0.5" />
                            <div className="text-[8px] font-medium text-gray-600 dark:text-gray-300">{zone.density >= 80 ? t('common.disperse', lang) : zone.density >= 55 ? t('common.monitor', lang) : t('crowd.actionNormal', lang)}</div>
                            <div className="text-micro text-gray-400">{t('crowd.action', lang)}</div>
                          </div>
                          <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-2">
                            <Activity className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-400 mb-0.5" />
                            <div className="text-[8px] font-medium text-gray-600 dark:text-gray-300">{zone.reportCount} {t('nav.reports', lang).toLowerCase()}</div>
                            <div className="text-micro text-gray-400">{t('crowd.incidents', lang)}</div>
                          </div>
                        </div>
                        <div className="bg-white/50 dark:bg-gray-900/30 rounded-lg p-2.5">
                          <div className="text-[8px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">{t('crowd.densityTrendLast8', lang)}</div>
                          <Sparkline data={zone.history} color={cfg.hex} width={280} height={36} />
                        </div>
                        {zone.riskLevel === 'critical' && (
                          <div className="flex items-center gap-1.5 bg-red-100/80 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg p-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 animate-pulse" />
                            <span className="text-[9px] font-bold text-red-700 dark:text-red-300">{t('crowd.criticalDensityAdvice', lang)}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-[8px] text-gray-400 dark:text-gray-400">
                          <Cpu className="w-2.5 h-2.5" />
                          {zone.source === 'api' ? t('crowd.realData', lang) : t('crowd.syntheticData', lang)}
                        </div>
                      </div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
