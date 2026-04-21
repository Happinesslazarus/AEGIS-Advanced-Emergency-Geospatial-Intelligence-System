/**
 * Citizen-facing crowd density dashboard. Generates pseudo-real-time crowd
 * density estimates for nearby zones, including sparkline trend history,
 * capacity model, and risk-level classification.
 *
 * Data model:
 * Zones are generated client-side using a deterministic hour-seeded formula.
 * This simulates real IoT/camera density feeds without requiring a backend
 * sensor integration. In production, `generateZones()` would be replaced
 * by a live API call.
 *
 * - Rendered inside CitizenPage.tsx / CitizenDashboard.tsx
 * - Uses locationUtils for geocoding the user's position
 * - No real sensor data -- uses hour-seeded pseudo-random generation
 * */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Users, Activity, TrendingUp, TrendingDown, MapPin, RefreshCw, Loader2,
  AlertTriangle, Clock, ChevronDown, ChevronUp, Search, BarChart3,
  LayoutGrid, List, ArrowUpDown, Filter, Zap, Radio, Shield, Minus
} from 'lucide-react'
import { forwardGeocode, getDeviceLocation, reverseGeocode } from '../../utils/locationUtils'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/* TYPES */

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
}

type ViewMode = 'list' | 'grid' | 'chart'
type SortKey = 'density' | 'name' | 'trend' | 'risk'
type FilterLevel = 'all' | 'low' | 'moderate' | 'high' | 'critical'

/* CONFIG */

const RISK_CONFIG = {
  low:      { labelKey: 'common.low', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200/60 dark:border-emerald-800/40', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', hex: '#10b981' },
  moderate: { labelKey: 'common.moderate', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200/60 dark:border-amber-800/40', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', hex: '#f59e0b' },
  high:     { labelKey: 'common.high', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200/60 dark:border-orange-800/40', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', hex: '#f97316' },
  critical: { labelKey: 'common.critical', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200/60 dark:border-red-800/40', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500', hex: '#ef4444' },
}

//Time-of-day crowd pattern lookup. Used to predict whether crowds are building
//or settling at the current hour, displayed as a contextual crowd forecast.
const PEAK_HOURS: Record<number, string> = {
  0: 'quiet', 1: 'quiet', 2: 'quiet', 3: 'quiet', 4: 'quiet', 5: 'waking',
  6: 'building', 7: 'rushHour', 8: 'peak', 9: 'peak', 10: 'high',
  11: 'high', 12: 'peakLunch', 13: 'high', 14: 'moderate', 15: 'moderate',
  16: 'building', 17: 'rushHour', 18: 'peak', 19: 'high', 20: 'moderate',
  21: 'settling', 22: 'quiet', 23: 'quiet',
}

/* HELPERS */

//Density thresholds for risk classification.
//Calibrated for outdoor public spaces (0-100% capacity scale).
function getRiskLevel(d: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (d < 30) return 'low'
  if (d < 55) return 'moderate'
  if (d < 80) return 'high'
  return 'critical'
}

//Generate a plausible-looking density history array ending at `base`.
//Used to power sparklines without real historical data.
function generateHistory(base: number, count: number = 8): number[] {
  const h: number[] = []
  let v = Math.max(5, base - 25 + Math.round(Math.random() * 10))
  for (let i = 0; i < count; i++) {
    v = Math.min(100, Math.max(0, v + Math.round((Math.random() - 0.4) * 12)))
    h.push(v)
  }
  h[count - 1] = base
  return h
}

//Generate synthetic zone data centred around the user's lat/lng.
//Hour-seeded formula: density varies realistically by time of day and zone index.
//This simulates an IoT sensor feed until live data integration is available.
function generateZones(lat: number, lng: number, zonePrefix: string): DensityZone[] {
  const fallbackNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(suffix => `${zonePrefix} ${suffix}`)
  const offsets = [
    [0.002, 0.003], [-0.004, 0.001], [0.001, -0.005], [-0.003, -0.004],
    [0.005, 0.002], [-0.002, 0.006], [0.004, -0.003], [-0.001, -0.002]
  ]
  const capacities = [2000, 3500, 1500, 2800, 4000, 1200, 3000, 1800]
  return fallbackNames.map((name, i) => {
    const hourSeed = new Date().getHours()
    const base = ((hourSeed * 17 + i * 31) % 70) + 10
    const density = Math.min(100, Math.max(0, base + Math.round((Math.random() - 0.5) * 15)))
    const trends: ('rising' | 'falling' | 'stable')[] = ['rising', 'falling', 'stable']
    const history = generateHistory(density)
    const delta = density - history[0]
    return {
      id: `zone-${i}`,
      name,
      lat: lat + offsets[i][0],
      lng: lng + offsets[i][1],
      density,
      trend: trends[(hourSeed + i) % 3],
      crowdEstimate: Math.round(density * (15 + i * 3)),
      capacity: capacities[i],
      lastUpdated: new Date(),
      riskLevel: getRiskLevel(density),
      history,
      delta,
    }
  })
}

function getRiskLabel(level: keyof typeof RISK_CONFIG, lang: string): string {
  return t(RISK_CONFIG[level].labelKey, lang)
}

function getPeakHourLabel(label: string, lang: string): string {
  switch (label) {
    case 'quiet': return 'Quiet'
    case 'waking': return 'Waking'
    case 'building': return 'Building'
    case 'rushHour': return 'Rush hour'
    case 'peak': return 'Peak'
    case 'high': return 'High'
    case 'moderate': return 'Moderate'
    case 'peakLunch': return 'Peak lunch'
    case 'settling': return 'Settling'
    default: return 'Unknown'
  }
}

function getTrendLabel(trend: DensityZone['trend'], lang: string): string {
  if (trend === 'rising') return 'Rising'
  if (trend === 'falling') return 'Falling'
  return 'Stable'
}

function formatRefreshAgo(lastRefresh: Date, lang: string): string {
  const seconds = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}${'s'} ${'ago'}`
  return `${Math.floor(seconds / 60)}${'m'} ${'ago'}`
}
/* SVG COMPONENTS */

//SVG sparkline using an area-fill + line path.
//Uses a linear gradient fill to give depth; ends with a dot at the current value.
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
  const gId = `spark-${color.replace('#', '')}`
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

//SVG ring gauge using stroke-dasharray/strokeDashoffset to show fill percentage.
//Rotated -90° so the fill starts at 12 o'clock. Critical zones get a glow filter.
function DensityRing({ value, size = 48, stroke = 5, risk }: { value: number; size?: number; stroke?: number; risk: string }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(value, 100) / 100)
  const c = RISK_CONFIG[risk as keyof typeof RISK_CONFIG]?.hex || '#6b7280'
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-gray-200 dark:text-gray-700/60" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={risk === 'critical' ? { filter: `drop-shadow(0 0 6px ${c})` } : risk === 'high' ? { filter: `drop-shadow(0 0 3px ${c})` } : {}} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-gray-900 dark:text-white">
        {value}
      </span>
    </div>
  )
}

function DistributionBar({ zones, lang }: { zones: DensityZone[]; lang: string }) {
  if (!zones.length) return null
  const counts = { low: 0, moderate: 0, high: 0, critical: 0 }
  zones.forEach(z => counts[z.riskLevel]++)
  const total = zones.length
  const segments: { key: string; pct: number; color: string; count: number }[] = [
    { key: 'critical', pct: (counts.critical / total) * 100, color: 'bg-red-500',     count: counts.critical },
    { key: 'high',     pct: (counts.high / total) * 100,     color: 'bg-orange-500',  count: counts.high },
    { key: 'moderate', pct: (counts.moderate / total) * 100,  color: 'bg-amber-400',   count: counts.moderate },
    { key: 'low',      pct: (counts.low / total) * 100,      color: 'bg-emerald-400', count: counts.low },
  ].filter(s => s.count > 0)
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        {segments.map(s => (
          <div key={s.key} className={`${s.color} transition-all duration-700 rounded-full`} style={{ width: `${s.pct}%` }}
            title={`${getRiskLabel(s.key as keyof typeof RISK_CONFIG, lang)}: ${s.count} ${'Zones'}`} />
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
/* GRID HEATMAP VIEW */

function HeatmapGrid({ zones, selectedZone, onSelect, lang }: { zones: DensityZone[]; selectedZone: string | null; onSelect: (id: string | null) => void; lang: string }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-3">
      {zones.map(zone => {
        const cfg = RISK_CONFIG[zone.riskLevel]
        const isSelected = selectedZone === zone.id
        return (
          <button key={zone.id} onClick={() => onSelect(isSelected ? null : zone.id)}
            className={`relative rounded-xl p-2 border transition-all duration-300 text-center group ${cfg.bg} ${cfg.border} ${isSelected ? 'ring-2 ring-orange-400/60 shadow-lg scale-[1.03]' : 'hover:scale-[1.02] hover:shadow-md'}`}>
            <div className={`text-lg font-black ${cfg.text}`}>{zone.density}</div>
            <div className="text-micro font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{getRiskLabel(zone.riskLevel, lang)}</div>
            <div className="w-full h-1 bg-gray-200/60 dark:bg-gray-700/40 rounded-full mt-1.5 overflow-hidden">
              <div className={`h-full rounded-full ${zone.riskLevel === 'critical' ? 'bg-red-500' : zone.riskLevel === 'high' ? 'bg-orange-500' : zone.riskLevel === 'moderate' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${zone.density}%` }} />
            </div>
            <div className="text-[8px] text-gray-600 dark:text-gray-300 font-medium mt-1 truncate">{zone.name}</div>
            {zone.delta !== 0 && (
              <span className={`absolute -top-1 -right-1 text-micro font-bold px-1 py-0.5 rounded-full ${zone.delta > 0 ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'}`}>
                {zone.delta > 0 ? '+' : ''}{zone.delta}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* CHART VIEW */

function ChartView({ zones }: { zones: DensityZone[] }) {
  return (
    <div className="p-3 space-y-1.5">
      {zones.map(zone => {
        const cfg = RISK_CONFIG[zone.riskLevel]
        return (
          <div key={zone.id} className="flex items-center gap-2">
            <span className="text-[9px] font-medium text-gray-600 dark:text-gray-300 w-28 truncate text-right">{zone.name}</span>
            <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800/60 rounded-md overflow-hidden relative">
              <div className={`h-full rounded-md transition-all duration-1000 ${
                zone.riskLevel === 'critical' ? 'bg-gradient-to-r from-red-600 to-red-400' :
                zone.riskLevel === 'high' ? 'bg-gradient-to-r from-orange-600 to-orange-400' :
                zone.riskLevel === 'moderate' ? 'bg-gradient-to-r from-amber-500 to-amber-300' :
                'bg-gradient-to-r from-emerald-600 to-emerald-400'
              }`} style={{ width: `${zone.density}%` }} />
              <span className="absolute inset-y-0 right-2 flex items-center text-[9px] font-bold text-gray-700 dark:text-gray-200">{zone.density}%</span>
            </div>
            <span className={`text-[8px] font-bold w-7 text-right ${zone.delta > 0 ? 'text-red-500' : zone.delta < 0 ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-300'}`}>
              {zone.delta > 0 ? `+${zone.delta}` : zone.delta < 0 ? `${zone.delta}` : String.fromCharCode(8212)}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-2 pt-1.5 border-t border-gray-200/50 dark:border-gray-700/40">
        <span className="w-28" />
        <div className="flex-1 flex justify-between text-micro text-gray-400 dark:text-gray-300 font-medium">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
        <span className="w-7" />
      </div>
    </div>
  )
}
/* MAIN COMPONENT */

export default function CrowdDensityHeatmap(): JSX.Element {
  const lang = useLanguage()
  const [zones, setZones] = useState<DensityZone[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)
  const [locationName, setLocationName] = useState<string>(() => 'Search or use GPS')
  const [locationError, setLocationError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortKey, setSortKey] = useState<SortKey>('density')
  const [filterLevel, setFilterLevel] = useState<FilterLevel>('all')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [refreshAgo, setRefreshAgo] = useState('')

  const enrichZoneNames = useCallback(async (zoneList: DensityZone[]) => {
    const enriched = await Promise.all(
      zoneList.map(async (zone) => {
        const place = await reverseGeocode({ lat: zone.lat, lng: zone.lng }, 16)
        return { ...zone, name: place.displayName }
      })
    )
    setZones(enriched)
  }, [])

  const loadData = useCallback((lat: number, lng: number) => {
    setLoading(true)
    const generated = generateZones(lat, lng, 'Zone')
    setZones(generated)
    setLoading(false)
    setLastRefresh(new Date())
    enrichZoneNames(generated)
  }, [enrichZoneNames, lang])

  const requestGPS = async () => {
    setLocationError('')
    setLocationName('Detecting location...')
    try {
      const coords = await getDeviceLocation({ enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 })
      setUserLat(coords.lat)
      setUserLng(coords.lng)
      const place = await reverseGeocode(coords, 12)
      setLocationName(place.displayName)
      loadData(coords.lat, coords.lng)
    } catch {
      setLocationError('Enable location to see local data')
      setLocationName('Location unavailable')
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    const result = await forwardGeocode(searchQuery.trim())
    if (result) {
      setUserLat(result.lat)
      setUserLng(result.lng)
      setLocationName(result.label)
      setLocationError('')
      loadData(result.lat, result.lng)
    } else {
      setLocationError('Location not found. Try a city, postcode, or region.')
    }
    setSearching(false)
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (userLat != null && userLng != null) loadData(userLat, userLng)
    }, 120000)
    return () => clearInterval(interval)
  }, [loadData, userLat, userLng])

  useEffect(() => {
    if (!lastRefresh) return
    const tick = () => {
      setRefreshAgo(formatRefreshAgo(lastRefresh, lang))
    }
    tick()
    refreshTimerRef.current = setInterval(tick, 5000)
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current) }
  }, [lang, lastRefresh])

  const summary = useMemo(() => {
    const critical = zones.filter(z => z.riskLevel === 'critical').length
    const high = zones.filter(z => z.riskLevel === 'high').length
    const totalPeople = zones.reduce((s, z) => s + z.crowdEstimate, 0)
    const totalCapacity = zones.reduce((s, z) => s + z.capacity, 0)
    const avgDensity = zones.length ? Math.round(zones.reduce((s, z) => s + z.density, 0) / zones.length) : 0
    const risingCount = zones.filter(z => z.trend === 'rising').length
    return { critical, high, totalPeople, totalCapacity, avgDensity, risingCount }
  }, [zones])

  const hour = new Date().getHours()
  const peakLabelKey = PEAK_HOURS[hour] || 'unknown'
  const peakLabel = getPeakHourLabel(peakLabelKey, lang)
  const nextPeakHour = hour < 8 ? 8 : hour < 12 ? 12 : hour < 17 ? 17 : 8
  const nextPeakIn = nextPeakHour > hour ? nextPeakHour - hour : 24 - hour + nextPeakHour

  const processedZones = useMemo(() => {
    const filtered = filterLevel === 'all' ? zones : zones.filter(z => z.riskLevel === filterLevel)
    switch (sortKey) {
      case 'density': return [...filtered].sort((a, b) => b.density - a.density)
      case 'name':    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      case 'trend':   return [...filtered].sort((a, b) => { const o = { rising: 0, stable: 1, falling: 2 }; return o[a.trend] - o[b.trend] })
      case 'risk': {
        const o = { critical: 0, high: 1, moderate: 2, low: 3 }
        return [...filtered].sort((a, b) => o[a.riskLevel] - o[b.riskLevel])
      }
      default: return filtered
    }
  }, [zones, filterLevel, sortKey])
  return (
    <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
      {/* HEADER */}
      <div className="p-4 pb-3 border-b border-gray-200/50 dark:border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Users className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{'Crowd Density'}</h3>
                {lastRefresh && (
                  <span className="flex items-center gap-1 text-[8px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/30">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    {'LIVE'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-gray-500 dark:text-gray-300 font-medium">{locationName}</p>
                {refreshAgo && <span className="text-[8px] text-gray-400 dark:text-gray-300">- {refreshAgo}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={requestGPS} disabled={loading} className="text-[9px] font-bold bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 px-2.5 py-1.5 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-all flex items-center gap-1 border border-orange-200/50 dark:border-orange-800/30" title={'Use GPS'}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
              //GPS
            </button>
            <button onClick={() => { if (userLat != null && userLng != null) loadData(userLat, userLng) }} disabled={loading || userLat == null} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all disabled:opacity-30" title={'Refresh'}>
              {loading ? <Loader2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />}
            </button>
            <button onClick={() => setExpanded(!expanded)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all">
              {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex gap-1.5 mt-3">
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={'Search city, postcode, or place...'} className="flex-1 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 transition-all" />
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-3 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-40 shadow-sm">
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{locationError}</p>}
      </div>
      {expanded && zones.length > 0 && (
        <>
          {/* DASHBOARD STATS */}
          <div className="px-4 pt-3 pb-0 space-y-3">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/40">
                <div className="text-sm font-black text-gray-900 dark:text-white">{zones.length}</div>
                <div className="text-micro text-gray-500 dark:text-gray-300 font-bold uppercase tracking-widest mt-0.5">{'Zones'}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/40">
                <div className="text-sm font-black text-gray-900 dark:text-white">
                  {summary.totalPeople >= 1000 ? `${(summary.totalPeople / 1000).toFixed(1)}k` : summary.totalPeople}
                </div>
                <div className="text-micro text-gray-500 dark:text-gray-300 font-bold uppercase tracking-widest mt-0.5">{'People'}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/40">
                <div className={`text-sm font-black ${summary.avgDensity >= 70 ? 'text-red-500' : summary.avgDensity >= 50 ? 'text-orange-500' : summary.avgDensity >= 30 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {summary.avgDensity}%
                </div>
                <div className="text-micro text-gray-500 dark:text-gray-300 font-bold uppercase tracking-widest mt-0.5">{'Density'}</div>
              </div>
              <div className={`rounded-xl p-2 text-center border ${summary.critical + summary.high > 0 ? 'bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-800/40' : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40'}`}>
                <div className={`text-sm font-black ${summary.critical + summary.high > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{summary.critical + summary.high}</div>
                <div className="text-micro text-gray-500 dark:text-gray-300 font-bold uppercase tracking-widest mt-0.5">{'Alerts'}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-2 text-center border border-gray-100 dark:border-gray-700/40">
                <div className={`text-sm font-black ${summary.risingCount > 2 ? 'text-red-500' : summary.risingCount > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{summary.risingCount}</div>
                <div className="text-micro text-gray-500 dark:text-gray-300 font-bold uppercase tracking-widest mt-0.5">{'Rising'}</div>
              </div>
            </div>

            {/* Capacity utilisation */}
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[9px] font-semibold text-gray-600 dark:text-gray-300">{'Total capacity utilisation'}</span>
                <span className="text-[9px] font-bold text-gray-900 dark:text-white">
                  {summary.totalPeople.toLocaleString()} <span className="text-gray-400 dark:text-gray-300 font-normal">/ {summary.totalCapacity.toLocaleString()}</span>
                </span>
              </div>
              <div className="w-full h-2 bg-gray-200/80 dark:bg-gray-700/60 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ${
                  (summary.totalPeople / summary.totalCapacity) > 0.8 ? 'bg-gradient-to-r from-red-600 to-red-400' :
                  (summary.totalPeople / summary.totalCapacity) > 0.5 ? 'bg-gradient-to-r from-orange-500 to-amber-400' :
                  'bg-gradient-to-r from-emerald-600 to-emerald-400'
                }`} style={{ width: `${Math.min((summary.totalPeople / summary.totalCapacity) * 100, 100)}%` }} />
              </div>
            </div>

            {/* Distribution bar */}
            <DistributionBar zones={zones} lang={lang} />

            {/* Peak hour */}
            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/40 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700/40">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-200">
                  {'Current'} <span className={`${peakLabelKey === 'peak' || peakLabelKey === 'peakLunch' || peakLabelKey === 'rushHour' ? 'text-red-500' : peakLabelKey === 'high' ? 'text-orange-500' : 'text-gray-500 dark:text-gray-300'}`}>{peakLabel}</span>
                </span>
              </div>
              <span className="text-[9px] text-gray-400 dark:text-gray-300">{'Next peak in'} ~{nextPeakIn}{'h'}</span>
            </div>
          </div>

          {/* VIEW TOGGLE + FILTERS */}
          <div className="px-4 pt-3 flex items-center justify-between gap-2">
            <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5">
              {([
                { mode: 'list' as ViewMode, icon: List, label: 'List' },
                { mode: 'grid' as ViewMode, icon: LayoutGrid, label: 'Grid' },
                { mode: 'chart' as ViewMode, icon: BarChart3, label: 'Chart' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold transition-all ${
                    viewMode === mode ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
                  }`}>
                  <Icon className="w-3 h-3" /> {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <select value={filterLevel} onChange={e => setFilterLevel(e.target.value as FilterLevel)}
                  className="appearance-none bg-gray-100 dark:bg-gray-800/60 text-[9px] font-bold text-gray-600 dark:text-gray-300 rounded-lg pl-5 pr-2 py-1.5 border-0 focus:ring-1 focus:ring-orange-400/40 cursor-pointer">
                  <option value="all">{'All'}</option>
                  <option value="critical">{'Critical'}</option>
                  <option value="high">{'High'}</option>
                  <option value="moderate">{'Moderate'}</option>
                  <option value="low">{'Low'}</option>
                </select>
                <Filter className="w-3 h-3 text-gray-400 dark:text-gray-300 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <div className="relative">
                <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
                  className="appearance-none bg-gray-100 dark:bg-gray-800/60 text-[9px] font-bold text-gray-600 dark:text-gray-300 rounded-lg pl-5 pr-2 py-1.5 border-0 focus:ring-1 focus:ring-orange-400/40 cursor-pointer">
                  <option value="density">{'Density'}</option>
                  <option value="name">{'Name'}</option>
                  <option value="trend">{'Trend'}</option>
                  <option value="risk">{'Risk'}</option>
                </select>
                <ArrowUpDown className="w-3 h-3 text-gray-400 dark:text-gray-300 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>
          {/* CONTENT AREA */}
          {viewMode === 'grid' ? (
            <HeatmapGrid zones={processedZones} selectedZone={selectedZone} onSelect={setSelectedZone} lang={lang} />
          ) : viewMode === 'chart' ? (
            <ChartView zones={processedZones} />
          ) : (
            <div className="p-3 space-y-2 max-h-[460px] overflow-y-auto custom-scrollbar">
              {processedZones.length === 0 ? (
                <div className="py-6 text-center">
                  <Filter className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-xs text-gray-400 dark:text-gray-300">{'No zones match your filter'}</p>
                </div>
              ) : (
                processedZones.map(zone => {
                  const cfg = RISK_CONFIG[zone.riskLevel]
                  const isSelected = selectedZone === zone.id
                  const capacityPct = Math.min(Math.round((zone.crowdEstimate / zone.capacity) * 100), 100)
                  return (
                    <button key={zone.id} onClick={() => setSelectedZone(isSelected ? null : zone.id)}
                      className={`w-full text-left rounded-xl p-3 border transition-all duration-300 hover:shadow-md group ${cfg.bg} ${cfg.border} ${isSelected ? 'ring-2 ring-offset-1 ring-orange-400/50 shadow-lg' : 'hover:scale-[1.003]'} ${zone.riskLevel === 'critical' ? 'shadow-red-500/10' : ''}`}>
                      <div className="flex items-center gap-3">
                        <DensityRing value={zone.density} risk={zone.riskLevel} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-gray-900 dark:text-white truncate flex-1 mr-2">{zone.name}</span>
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
                              <span className="text-[8px] text-gray-400 dark:text-gray-300">/ {zone.capacity.toLocaleString()}</span>
                            </span>
                            <span className={`flex items-center gap-1 font-semibold ${zone.trend === 'rising' ? 'text-red-500' : zone.trend === 'falling' ? 'text-emerald-500' : 'text-amber-500'}`}>
                              {zone.trend === 'rising' && <><TrendingUp className="w-3 h-3" /> {'Rising'}</>}
                              {zone.trend === 'falling' && <><TrendingDown className="w-3 h-3" /> {'Falling'}</>}
                              {zone.trend === 'stable' && <><Minus className="w-3 h-3" /> {'Stable'}</>}
                            </span>
                            <span className={`text-[9px] font-bold ${zone.delta > 0 ? 'text-red-500' : zone.delta < 0 ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-300'}`}>
                              {zone.delta > 0 ? `+${zone.delta}` : zone.delta < 0 ? `${zone.delta}` : '\u2014'}
                              <span className="text-micro font-normal text-gray-400 dark:text-gray-300 ml-0.5">1h</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Expanded detail panel */}
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t border-gray-200/60 dark:border-gray-600/30 space-y-2.5">
                          <div>
                            <div className="flex justify-between items-baseline mb-1">
                              <span className="text-[9px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1">
                                <Shield className="w-3 h-3" /> {'Capacity'}
                              </span>
                              <span className={`text-[9px] font-bold ${capacityPct > 80 ? 'text-red-500' : capacityPct > 60 ? 'text-orange-500' : 'text-emerald-500'}`}>
                                {capacityPct}% {'utilised'}
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${capacityPct > 80 ? 'bg-red-500' : capacityPct > 60 ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${capacityPct}%` }} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center">
                            <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-1.5">
                              <MapPin className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-300 mb-0.5" />
                              <div className="text-[8px] font-mono text-gray-600 dark:text-gray-300">{zone.lat.toFixed(4)}</div>
                              <div className="text-[8px] font-mono text-gray-600 dark:text-gray-300">{zone.lng.toFixed(4)}</div>
                            </div>
                            <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-1.5">
                              <Clock className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-300 mb-0.5" />
                              <div className="text-[8px] font-medium text-gray-600 dark:text-gray-300">{zone.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              <div className="text-micro text-gray-400 dark:text-gray-300">{'Updated'}</div>
                            </div>
                            <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-1.5">
                              <Radio className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-300 mb-0.5" />
                              <div className="text-[8px] font-medium text-gray-600 dark:text-gray-300">{zone.density >= 80 ? 'Disperse' : zone.density >= 55 ? 'Monitor' : 'Normal'}</div>
                              <div className="text-micro text-gray-400 dark:text-gray-300">{'Action'}</div>
                            </div>
                            <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-1.5">
                              <Activity className="w-3 h-3 mx-auto text-gray-400 dark:text-gray-300 mb-0.5" />
                              <div className="text-[8px] font-medium text-gray-600 dark:text-gray-300">{zone.history.length} {'pts'}</div>
                              <div className="text-micro text-gray-400 dark:text-gray-300">{'History'}</div>
                            </div>
                          </div>
                          <div className="bg-white/50 dark:bg-gray-900/30 rounded-lg p-2">
                            <div className="text-[8px] font-bold text-gray-500 dark:text-gray-300 mb-1 uppercase tracking-wider">{'Density trend (last 8 readings)'}</div>
                            <Sparkline data={zone.history} color={cfg.hex} width={280} height={36} />
                          </div>
                          {zone.riskLevel === 'critical' && (
                            <div className="flex items-center gap-1.5 bg-red-100/80 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg p-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 animate-pulse" />
                              <span className="text-[9px] font-bold text-red-700 dark:text-red-300">{'Critical density - consider crowd control measures immediately'}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </>
      )}

      {/* EMPTY / LOADING STATES */}
      {expanded && zones.length === 0 && (
        <div className="p-3">
          {loading ? (
            <div className="space-y-3 py-4 px-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <div className="skeleton-shimmer h-10 w-10 rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton-shimmer h-3 w-2/5 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                    <div className="skeleton-shimmer h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                  </div>
                  <div className="skeleton-shimmer h-6 w-12 rounded-full bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                </div>
              ))}
              <p className="text-[10px] text-center text-gray-400 dark:text-gray-300">{'Scanning area density...'}</p>
            </div>
          ) : locationError ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center mx-auto">
                <MapPin className="w-7 h-7 text-gray-400 dark:text-gray-300" />
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{'Search or use GPS'}</p>
              <p className="text-xs text-gray-400 dark:text-gray-300">{locationError}</p>
              <button onClick={requestGPS} className="text-xs font-bold bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-orange-500/20">
                <MapPin className="w-3.5 h-3.5 inline mr-1.5" /> {'Use GPS'}
              </button>
            </div>
          ) : (
            <div className="py-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 flex items-center justify-center mx-auto">
                <Users className="w-7 h-7 text-orange-500" />
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{'Search a location to begin'}</p>
              <p className="text-xs text-gray-400 dark:text-gray-300">{'Enter a city, postcode, or use GPS above'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
