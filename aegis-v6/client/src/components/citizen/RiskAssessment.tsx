/**
 * Risk assessment citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

/* RiskAssessment.tsx — Professional Location-Aware Hazard Assessment
   Arc gauge · radar chart · 24-hour trend forecasts · real-time data */

import { useMemo, useState } from 'react'
import {
  Shield,
  AlertTriangle,
  MapPin,
  Loader2,
  ChevronRight,
  Droplets,
  Wind,
  Flame,
  Waves,
  CloudLightning,
  Thermometer,
  BarChart3,
  RefreshCw,
  CheckCircle,
  Info,
  Search,
  Compass,
  Activity,
  TrendingUp,
  ShieldCheck,
  AlertCircle,
  Clock,
  Eye,
  TrendingDown,
  Minus,
  ArrowRight,
} from 'lucide-react'
import { forwardGeocode, getDeviceLocation, reverseGeocode, type Coordinates } from '../../utils/locationUtils'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface RiskFactor {
  id: string
  name: string
  icon: typeof Droplets
  score: number
  level: 'low' | 'moderate' | 'elevated' | 'high'
  description: string
  recommendation: string
  source: string
  tomorrowScore: number
  trend: 'rising' | 'falling' | 'stable'
}

const RISK_LEVELS = {
  low:      { label: 'Low',      color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/20', bar: 'from-emerald-500 to-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-800/40', ring: 'ring-emerald-500/30', dot: 'bg-emerald-500', gradient: 'from-emerald-500 to-teal-600' },
  moderate: { label: 'Moderate', color: 'text-amber-700 dark:text-amber-300',     bg: 'bg-amber-50 dark:bg-amber-950/20',    bar: 'from-amber-500 to-amber-400',    border: 'border-amber-200/60 dark:border-amber-800/40',    ring: 'ring-amber-500/30',   dot: 'bg-amber-500',   gradient: 'from-amber-500 to-orange-600' },
  elevated: { label: 'Elevated', color: 'text-orange-700 dark:text-orange-300',   bg: 'bg-orange-50 dark:bg-orange-950/20',   bar: 'from-orange-500 to-orange-400',  border: 'border-orange-200/60 dark:border-orange-800/40',  ring: 'ring-orange-500/30',  dot: 'bg-orange-500',  gradient: 'from-orange-500 to-red-600' },
  high:     { label: 'High',     color: 'text-red-700 dark:text-red-300',         bg: 'bg-red-50 dark:bg-red-950/20',         bar: 'from-red-500 to-red-400',        border: 'border-red-200/60 dark:border-red-800/40',        ring: 'ring-red-500/30',     dot: 'bg-red-500',     gradient: 'from-red-500 to-rose-600' },
} as const

const LEVEL_COLORS: Record<string, string> = { low: '#22c55e', moderate: '#f59e0b', elevated: '#f97316', high: '#ef4444' }

const TREND_CFG = {
  rising:  { Icon: TrendingUp,   label: 'Rising',  color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-950/30' },
  falling: { Icon: TrendingDown, label: 'Falling', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  stable:  { Icon: Minus,        label: 'Stable',  color: 'text-gray-500 dark:text-gray-300',       bg: 'bg-gray-100 dark:bg-gray-800/30' },
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.round(Math.max(min, Math.min(max, n)) * 100) / 100
}

function getLevel(score: number): 'low' | 'moderate' | 'elevated' | 'high' {
  if (score < 25) return 'low'
  if (score < 50) return 'moderate'
  if (score < 75) return 'elevated'
  return 'high'
}

function computeTrend(today: number, tomorrow: number): 'rising' | 'falling' | 'stable' {
  const diff = tomorrow - today
  if (diff > 5) return 'rising'
  if (diff < -5) return 'falling'
  return 'stable'
}

/* Inline SVG: Semicircular Arc Gauge */
function ArcGauge({ score, level }: { score: number; level: string }) {
  const r = 56, sw = 9, cx = 66, cy = 64
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  const totalLen = Math.PI * r
  const offset = totalLen - totalLen * (score / 100)
  const clr = LEVEL_COLORS[level] || '#3b82f6'

  return (
    <svg viewBox="0 0 132 72" className="w-full max-w-[200px] mx-auto drop-shadow-sm">
      <path d={path} fill="none" strokeWidth={sw} strokeLinecap="round" className="stroke-gray-200 dark:stroke-gray-700/60" />
      <path d={path} fill="none" stroke={clr} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={totalLen} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)' }} />
      {[0, 25, 50, 75, 100].map(tick => {
        const a = Math.PI * (1 - tick / 100)
        return <text key={tick} x={cx + (r + 7) * Math.cos(a)} y={cy - (r + 7) * Math.sin(a)} textAnchor="middle" dominantBaseline="central" className="text-[5.5px] font-bold fill-gray-300 dark:fill-gray-600">{tick}</text>
      })}
      <text x={cx} y={cy - 18} textAnchor="middle" dominantBaseline="central" className="text-[28px] font-black" style={{ fill: clr }}>{score}</text>
      <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central" className="text-[8px] font-bold fill-gray-400 dark:fill-gray-500">/ 100</text>
    </svg>
  )
}

/* Inline SVG: Hexagonal Radar Chart */
function RadarChart({ factors }: { factors: RiskFactor[] }) {
  const cx = 80, cy = 80, maxR = 58
  const n = factors.length
  if (n < 3) return null

  const pt = (i: number, val: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2
    const rr = (val / 100) * maxR
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) }
  }

  return (
    <svg viewBox="0 0 160 160" className="w-full max-w-[200px] mx-auto drop-shadow-sm">
      {[25, 50, 75, 100].map(v => (
        <polygon key={v}
          points={Array.from({ length: n }, (_, i) => { const p = pt(i, v); return `${p.x},${p.y}` }).join(' ')}
          fill="none" strokeWidth={v === 100 ? '0.7' : '0.4'} className="stroke-gray-200 dark:stroke-gray-700/60" />
      ))}
      {factors.map((_, i) => { const p = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} strokeWidth="0.4" className="stroke-gray-200 dark:stroke-gray-700/60" /> })}
      <polygon
        points={factors.map((f, i) => { const p = pt(i, f.tomorrowScore); return `${p.x},${p.y}` }).join(' ')}
        fill="rgba(168,85,247,0.06)" stroke="#a855f7" strokeWidth="1" strokeDasharray="3 2" opacity="0.5"
        style={{ transition: 'all 0.8s ease-out' }} />
      <polygon
        points={factors.map((f, i) => { const p = pt(i, f.score); return `${p.x},${p.y}` }).join(' ')}
        fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1.5"
        style={{ transition: 'all 0.8s ease-out' }} />
      {factors.map((f, i) => { const p = pt(i, f.score); return <circle key={i} cx={p.x} cy={p.y} r="3" fill={LEVEL_COLORS[f.level] || '#3b82f6'} stroke="white" strokeWidth="1.5" /> })}
      {factors.map((f, i) => {
        const p = pt(i, 118)
        return <text key={`l${i}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" className="text-[6.5px] font-bold fill-gray-500 dark:fill-gray-400">{f.name.split(' ')[0]}</text>
      })}
    </svg>
  )
}

const weatherCache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes (shorter to avoid stale location data)

function cacheKey(lat: number, lng: number): string {
  // Round to 0.01° (~1km) instead of 0.05° (~5km) for finer location sensitivity
  return `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`
}

async function cachedFetch(url: string, key: string): Promise<any> {
  const cached = weatherCache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
  const res = await fetch(url)
  if (!res.ok) throw new Error('Weather fetch failed')
  const data = await res.json()
  weatherCache.set(key, { data, ts: Date.now() })
  return data
}

interface FloodSignal { floodBoost: number; source: string }
const NO_FLOOD: FloodSignal = { floodBoost: 0, source: 'Open-Meteo' }

async function getGbFloodSignal(coords: Coordinates): Promise<FloodSignal> {
  try {
    const params = new URLSearchParams({ lat: String(coords.lat), lng: String(coords.lng), dist: '120' })
    const res = await fetch(`/api/flood-data/stations?${params.toString()}`)
    if (!res.ok) return NO_FLOOD
    const payload = await res.json()
    const features: any[] = payload?.features || []
    if (!features.length) return NO_FLOOD
    let worst = 0
    for (const f of features) {
      const p = f?.properties || {}
      const level = Number(p.level_m || 0)
      const typical = Number(p.typical_high_m || 0)
      const status = String(p.level_status || '').toLowerCase()
      const ratio = typical > 0 ? (level / typical) * 100 : 0
      let boost = Math.max(0, ratio - 75)
      if (status.includes('severe') || status.includes('high')) boost = Math.max(boost, 40)
      else if (status.includes('above')) boost = Math.max(boost, 20)
      worst = Math.max(worst, boost)
    }
    return { floodBoost: clamp(worst, 0, 45), source: 'SEPA/EA telemetry + Open-Meteo' }
  } catch { return NO_FLOOD }
}

async function getUsFloodSignal(coords: Coordinates): Promise<FloodSignal> {
  try {
    const d = 0.5
    const box = `${(coords.lng - d).toFixed(4)},${(coords.lat - d).toFixed(4)},${(coords.lng + d).toFixed(4)},${(coords.lat + d).toFixed(4)}`
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${box}&parameterCd=00065&siteStatus=active&period=PT3H`
    const res = await fetch(url)
    if (!res.ok) return NO_FLOOD
    const data = await res.json()
    const ts = data?.value?.timeSeries || []
    if (!ts.length) return NO_FLOOD
    let worst = 0
    for (const series of ts.slice(0, 20)) {
      const values = series?.values?.[0]?.value || []
      if (!values.length) continue
      const latest = Number(values[values.length - 1]?.value || 0)
      // USGS gage height in feet — flood stage varies, but >10ft is generally elevated, >15ft is high
      if (latest > 20) worst = Math.max(worst, 45)
      else if (latest > 15) worst = Math.max(worst, 35)
      else if (latest > 10) worst = Math.max(worst, 20)
      else if (latest > 6) worst = Math.max(worst, 10)
    }
    return { floodBoost: clamp(worst, 0, 45), source: 'USGS NWIS + Open-Meteo' }
  } catch { return NO_FLOOD }
}

async function getAuFloodSignal(coords: Coordinates): Promise<FloodSignal> {
  // BOM (Australia) doesn't have a public CORS-enabled API; use our server proxy
  try {
    const params = new URLSearchParams({ lat: String(coords.lat), lng: String(coords.lng), dist: '100' })
    const res = await fetch(`/api/flood-data/stations?${params.toString()}`)
    if (!res.ok) return NO_FLOOD
    const payload = await res.json()
    const features: any[] = payload?.features || []
    if (!features.length) return NO_FLOOD
    let worst = 0
    for (const f of features) {
      const p = f?.properties || {}
      const level = Number(p.level_m || 0)
      const typical = Number(p.typical_high_m || 0)
      const ratio = typical > 0 ? (level / typical) * 100 : 0
      worst = Math.max(worst, Math.max(0, ratio - 75))
    }
    return { floodBoost: clamp(worst, 0, 45), source: 'BOM/Server + Open-Meteo' }
  } catch { return NO_FLOOD }
}

async function getEuFloodSignal(coords: Coordinates): Promise<FloodSignal> {
  // EU countries — try the server flood endpoint which may have EFAS/national data
  try {
    const params = new URLSearchParams({ lat: String(coords.lat), lng: String(coords.lng), dist: '80' })
    const res = await fetch(`/api/flood-data/stations?${params.toString()}`)
    if (!res.ok) return NO_FLOOD
    const payload = await res.json()
    const features: any[] = payload?.features || []
    if (!features.length) return NO_FLOOD
    let worst = 0
    for (const f of features) {
      const p = f?.properties || {}
      const level = Number(p.level_m || 0)
      const typical = Number(p.typical_high_m || 0)
      const status = String(p.level_status || '').toLowerCase()
      const ratio = typical > 0 ? (level / typical) * 100 : 0
      let boost = Math.max(0, ratio - 75)
      if (status.includes('severe') || status.includes('high')) boost = Math.max(boost, 35)
      else if (status.includes('above')) boost = Math.max(boost, 15)
      worst = Math.max(worst, boost)
    }
    return { floodBoost: clamp(worst, 0, 45), source: 'EFAS/National + Open-Meteo' }
  } catch { return NO_FLOOD }
}

const EU_CODES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','NO','CH','IS'])

async function getGlobalFloodSignal(coords: Coordinates): Promise<FloodSignal> {
  try {
    const key = `flood_glofas_${cacheKey(coords.lat, coords.lng)}`
    const data = await cachedFetch(
      `https://flood-api.open-meteo.com/v1/flood?latitude=${coords.lat}&longitude=${coords.lng}` +
      `&daily=river_discharge,river_discharge_mean,river_discharge_median&forecast_days=7`,
      key
    )
    const daily = data?.daily || {}
    const discharge: number[] = daily?.river_discharge || []
    const mean: number[] = daily?.river_discharge_mean || []
    const median: number[] = daily?.river_discharge_median || []
    if (!discharge.length || !mean.length) return NO_FLOOD

    const currentQ = Number(discharge[0] || 0)
    const meanQ = Number(mean[0] || 0)
    const medianQ = Number(median[0] || 0)
    if (currentQ <= 0 || meanQ <= 0) return NO_FLOOD

    // Ratio of current discharge to climatological mean
    const ratio = currentQ / meanQ
    let boost = 0
    if (ratio > 5) boost = 45
    else if (ratio > 3) boost = 35
    else if (ratio > 2) boost = 25
    else if (ratio > 1.5) boost = 15
    else if (ratio > 1.2) boost = 8

    // Cross-check against median — large exceedances confirm flood
    if (medianQ > 0) {
      const medRatio = currentQ / medianQ
      if (medRatio > 3 && boost < 30) boost = 30
    }

    // If discharge is forecast to spike in the next 7 days, flag rising risk
    const maxForecast = Math.max(...discharge.slice(0, 7).map(Number).filter(v => !isNaN(v)))
    if (maxForecast > currentQ * 1.5 && boost < 20) boost = 20

    return { floodBoost: clamp(boost, 0, 45), source: 'GloFAS/Copernicus + Open-Meteo' }
  } catch { return NO_FLOOD }
}

async function getFloodSignal(coords: Coordinates, countryCode: string): Promise<FloodSignal> {
  // Try country-specific premium sources first
  let signal: FloodSignal = NO_FLOOD
  if (countryCode === 'GB') signal = await getGbFloodSignal(coords)
  else if (countryCode === 'US') signal = await getUsFloodSignal(coords)
  else if (countryCode === 'AU') signal = await getAuFloodSignal(coords)
  else if (EU_CODES.has(countryCode)) signal = await getEuFloodSignal(coords)

  // Global fallback via GloFAS for ALL countries (including when premium source found nothing)
  if (signal.floodBoost < 5) {
    const global = await getGlobalFloodSignal(coords)
    if (global.floodBoost > signal.floodBoost) return global
  }
  return signal
}

async function getMarineSignal(coords: Coordinates): Promise<{ waveBoost: number; waveBoostTomorrow: number; source: string }> {
  try {
    const key = `marine_${cacheKey(coords.lat, coords.lng)}`
    const cached = weatherCache.get(key)
    let data: any
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      data = cached.data
    } else {
      const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${coords.lat}&longitude=${coords.lng}&daily=wave_height_max,wave_period_max&forecast_days=2&timezone=auto`
      const res = await fetch(url)
      if (!res.ok) return { waveBoost: 0, waveBoostTomorrow: 0, source: '' }
      data = await res.json()
      weatherCache.set(key, { data, ts: Date.now() })
    }
    const daily = data?.daily || {}
    const waveMax = Number(daily?.wave_height_max?.[0] || 0)
    const waveMax2 = Number(daily?.wave_height_max?.[1] || 0)
    const period = Number(daily?.wave_period_max?.[0] || 0)
    // Wave scoring: 0-2m calm, 2-4m moderate, 4-6m elevated, 6m+ high swell
    const waveScore = (waveMax: number, period: number) => {
      let s = 0
      if (waveMax > 6) s = 40
      else if (waveMax > 4) s = 28
      else if (waveMax > 2.5) s = 15
      else if (waveMax > 1.5) s = 5
      // Long-period swells (>12s) are more dangerous
      if (period > 14) s += 10
      else if (period > 12) s += 5
      return clamp(s, 0, 45)
    }
    return {
      waveBoost: waveScore(waveMax, period),
      waveBoostTomorrow: waveScore(waveMax2, Number(daily?.wave_period_max?.[1] || 0)),
      source: waveMax > 0 ? 'Open-Meteo Marine' : '',
    }
  } catch {
    return { waveBoost: 0, waveBoostTomorrow: 0, source: '' }
  }
}

function getRecommendation(id: string, level: 'low' | 'moderate' | 'elevated' | 'high'): string {
  const tips: Record<string, Record<string, string>> = {
    flood: {
      high: 'Immediate flood risk — evacuate low-lying areas now, move to higher ground, and follow official emergency orders.',
      elevated: 'Significant flood potential — prepare evacuation routes, move valuables off ground level, and monitor emergency alerts.',
      moderate: 'Moderate flood risk — stay alert to rising water levels and ensure drainage is clear around your property.',
      low: 'Low flood risk — monitor rainfall updates and remain aware of local flood alert channels.',
    },
    storm: {
      high: 'Dangerous storm conditions — shelter immediately, stay away from windows, and avoid all non-essential travel.',
      elevated: 'Strong storm activity likely — secure outdoor objects, charge devices, and avoid exposed areas.',
      moderate: 'Storm activity possible — keep an eye on weather updates and have a plan if conditions worsen.',
      low: 'Minor storm risk — stay weather-aware and check forecasts before extended outdoor activity.',
    },
    wind: {
      high: 'Severe wind warning — avoid trees, scaffolding, and bridges. Stay indoors and brace for power outages.',
      elevated: 'High winds expected — secure loose items outside, avoid driving high-profile vehicles, and stay sheltered.',
      moderate: 'Moderate wind conditions — take care near coastal or exposed areas and secure lightweight outdoor items.',
      low: 'Light winds — no special precautions needed. Routine wind awareness is sufficient.',
    },
    heat: {
      high: 'Extreme heat emergency — stay indoors with cooling, hydrate constantly, and check on vulnerable neighbors.',
      elevated: 'Intense heat expected — reduce outdoor exertion during peak hours (11am-4pm) and drink water frequently.',
      moderate: 'Warm conditions ahead — wear sun protection, stay hydrated, and take breaks in shade when outdoors.',
      low: 'Comfortable temperatures — no heat-related precautions needed at this time.',
    },
    fire: {
      high: 'Critical fire danger — avoid all open flames, have evacuation bags ready, and follow local fire authority orders.',
      elevated: 'High fire risk — no outdoor burning, avoid activities that create sparks, and keep emergency supplies ready.',
      moderate: 'Moderate fire conditions — exercise caution with fire and keep informed of any local fire bans.',
      low: 'Low fire risk — follow standard fire-safety guidance and stay aware of local conditions.',
    },
    coastal: {
      high: 'Severe coastal hazard — stay well away from shorelines, sea walls, and tidal zones. Expect flooding in low areas.',
      elevated: 'Significant coastal risk — avoid cliff edges and sea fronts, and monitor official surge and tide warnings.',
      moderate: 'Moderate coastal conditions — exercise caution near the water and be aware of higher-than-normal tides.',
      low: 'Calm coastal conditions — no immediate risk, but always respect tidal schedules and warning signs.',
    },
  }
  return tips[id]?.[level] || 'Monitor local updates and follow official guidance.'
}

async function buildRiskProfile(coords: Coordinates, countryCode: string): Promise<RiskFactor[]> {
  // Fetch weather with hourly weather_code for thunder detection on both days
  const wKey = `wx_${cacheKey(coords.lat, coords.lng)}`
  const weather = await cachedFetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code` +
    `&daily=temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
    `&hourly=weather_code` +
    `&forecast_days=2&timezone=auto`,
    wKey
  )

  const current = weather?.current || {}
  const daily = weather?.daily || {}
  const hourlyWC: number[] = weather?.hourly?.weather_code || []

  const temp = Number(current.temperature_2m || 0)
  const humidity = Number(current.relative_humidity_2m || 0)
  const rainNow = Number(current.precipitation || 0)
  const windNow = Number(current.wind_speed_10m || 0)
  const weatherCode = Number(current.weather_code || 0)

  const rainDay = Number(daily?.precipitation_sum?.[0] || 0)
  const rainChance = Number(daily?.precipitation_probability_max?.[0] || 0)
  const windMax = Number(daily?.wind_speed_10m_max?.[0] || windNow)
  const tempMax = Number(daily?.temperature_2m_max?.[0] || temp)

  // Fetch flood signal for this country
  const flood = await getFloodSignal(coords, countryCode)

  // Fetch marine/wave data in parallel (non-blocking — coastal bonus)
  const marine = await getMarineSignal(coords)

  // Thunder detection from hourly weather_code
  // Codes 95-99 = thunderstorm, 80-84 = rain showers (stormy)
  // Today = hours 0-23, Tomorrow = hours 24-47
  const thunderFromHourly = (startH: number, endH: number): number => {
    let maxCode = 0
    for (let h = startH; h < Math.min(endH, hourlyWC.length); h++) {
      maxCode = Math.max(maxCode, hourlyWC[h] || 0)
    }
    return maxCode >= 95 ? 30 : maxCode >= 80 ? 15 : 0
  }

  const thunderBoost = Math.max(
    weatherCode >= 95 ? 30 : weatherCode >= 80 ? 15 : 0,
    thunderFromHourly(0, 24)
  )
  const thunderBoost2 = thunderFromHourly(24, 48)

  // Build source string
  const sources: string[] = ['Open-Meteo']
  if (flood.source !== 'Open-Meteo' && flood.floodBoost > 0) sources.push(flood.source.replace(' + Open-Meteo', ''))
  if (marine.source) sources.push(marine.source.replace('Open-Meteo ', ''))
  const primarySource = sources.join(' + ')

  // Today scores
  const floodScore = clamp((rainDay * 4) + (rainChance * 0.35) + (rainNow * 10) + flood.floodBoost)
  const stormScore = clamp((windMax * 1.6) + thunderBoost)
  const windScore = clamp((windMax * 1.8) + (windNow * 0.4))
  const heatScore = clamp((tempMax - 24) * 7)
  const fireScore = clamp(((tempMax - 20) * 4) + ((50 - humidity) * 1.2) - (rainDay * 1.8))
  const coastalScore = clamp((windMax * 0.9) + (rainChance * 0.25) + (flood.floodBoost * 0.7) + marine.waveBoost)

  // Tomorrow (Day-2) scores
  const rainDay2 = Number(daily?.precipitation_sum?.[1] || 0)
  const rainChance2 = Number(daily?.precipitation_probability_max?.[1] || 0)
  const windMax2 = Number(daily?.wind_speed_10m_max?.[1] || 0)
  const tempMax2 = Number(daily?.temperature_2m_max?.[1] || 0)

  const floodScore2 = clamp((rainDay2 * 4) + (rainChance2 * 0.35) + (flood.floodBoost * 0.7))
  const stormScore2 = clamp((windMax2 * 1.6) + thunderBoost2)
  const windScore2 = clamp((windMax2 * 1.8))
  const heatScore2 = clamp((tempMax2 - 24) * 7)
  const fireScore2 = clamp(((tempMax2 - 20) * 4) + ((50 - humidity) * 1.2) - (rainDay2 * 1.8))
  const coastalScore2 = clamp((windMax2 * 0.9) + (rainChance2 * 0.25) + (flood.floodBoost * 0.5) + marine.waveBoostTomorrow)

  return [
    {
      id: 'flood', name: 'Flood Risk', icon: Droplets,
      score: floodScore, level: getLevel(floodScore), tomorrowScore: floodScore2, trend: computeTrend(floodScore, floodScore2),
      description: 'Real-time flood risk from rainfall intensity, forecast precipitation, and regional gauge telemetry where available.',
      recommendation: getRecommendation('flood', getLevel(floodScore)),
      source: primarySource,
    },
    {
      id: 'storm', name: 'Severe Storm', icon: CloudLightning,
      score: stormScore, level: getLevel(stormScore), tomorrowScore: stormScore2, trend: computeTrend(stormScore, stormScore2),
      description: 'Storm risk derived from wind speed maxima and hourly thunderstorm probability analysis.',
      recommendation: getRecommendation('storm', getLevel(stormScore)),
      source: 'Open-Meteo hourly + daily forecast',
    },
    {
      id: 'wind', name: 'High Wind', icon: Wind,
      score: windScore, level: getLevel(windScore), tomorrowScore: windScore2, trend: computeTrend(windScore, windScore2),
      description: 'Wind hazard from current observations and near-term daily wind speed forecast.',
      recommendation: getRecommendation('wind', getLevel(windScore)),
      source: 'Open-Meteo wind model',
    },
    {
      id: 'heat', name: 'Extreme Heat', icon: Thermometer,
      score: heatScore, level: getLevel(heatScore), tomorrowScore: heatScore2, trend: computeTrend(heatScore, heatScore2),
      description: 'Heat stress estimate from forecast daily maximum temperature thresholds.',
      recommendation: getRecommendation('heat', getLevel(heatScore)),
      source: 'Open-Meteo temperature forecast',
    },
    {
      id: 'fire', name: 'Wildfire', icon: Flame,
      score: fireScore, level: getLevel(fireScore), tomorrowScore: fireScore2, trend: computeTrend(fireScore, fireScore2),
      description: 'Fire weather index based on temperature, humidity deficit, and rainfall suppression.',
      recommendation: getRecommendation('fire', getLevel(fireScore)),
      source: 'Open-Meteo humidity/temperature model',
    },
    {
      id: 'coastal', name: 'Coastal/Tidal', icon: Waves,
      score: coastalScore, level: getLevel(coastalScore), tomorrowScore: coastalScore2, trend: computeTrend(coastalScore, coastalScore2),
      description: marine.source
        ? 'Coastal hazard from real-time wave height, swell period, wind pressure, and flood gauge data.'
        : 'Coastal surge proxy from wind, precipitation pressure, and flood indicators.',
      recommendation: getRecommendation('coastal', getLevel(coastalScore)),
      source: primarySource,
    },
  ]
}

export default function RiskAssessment(): JSX.Element {
  const lang = useLanguage()
  const [risks, setRisks] = useState<RiskFactor[]>([])
  const [loading, setLoading] = useState(false)
  const [coords, setCoords] = useState<Coordinates | null>(null)
  const [locationName, setLocationName] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [locationError, setLocationError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [expandedRisk, setExpandedRisk] = useState<string | null>(null)
  const [lastAssessed, setLastAssessed] = useState<Date | null>(null)

  const runAssessment = async (target: Coordinates, fallbackCountry = countryCode) => {
    setLoading(true)
    setLocationError('')
    try {
      const profile = await buildRiskProfile(target, fallbackCountry || 'ZZ')
      setRisks(profile)
      setLastAssessed(new Date())
    } catch (err: any) {
      setLocationError(err?.message || 'Unable to calculate risk profile')
      setRisks([])
    } finally {
      setLoading(false)
    }
  }

  const requestGPS = async () => {
    setLocationError('')
    setLoading(true)
    try {
      const detected = await getDeviceLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 180000 })
      setCoords(detected)
      const place = await reverseGeocode(detected, 10)
      setLocationName(place.displayName)
      setCountryCode(place.countryCode || 'ZZ')
      await runAssessment(detected, place.countryCode || 'ZZ')
    } catch {
      setLocationError('Enable location to see local data')
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    const result = await forwardGeocode(searchQuery.trim())
    if (!result) {
      setSearching(false)
      setLocationError('Location not found. Try a city, postcode, or region.')
      return
    }
    const target = { lat: result.lat, lng: result.lng }
    setCoords(target)
    setLocationName(result.label)
    const place = await reverseGeocode(target, 10)
    setCountryCode(place.countryCode || 'ZZ')
    await runAssessment(target, place.countryCode || 'ZZ')
    setSearching(false)
  }

  const overallScore = useMemo(() => {
    if (!risks.length) return 0
    return Math.round(risks.reduce((sum, risk) => sum + risk.score, 0) / risks.length)
  }, [risks])

  const overallTomorrow = useMemo(() => {
    if (!risks.length) return 0
    return Math.round(risks.reduce((sum, r) => sum + r.tomorrowScore, 0) / risks.length)
  }, [risks])

  const overallLevel = getLevel(overallScore)
  const overallCfg = RISK_LEVELS[overallLevel]
  const overallTrend = risks.length ? computeTrend(overallScore, overallTomorrow) : 'stable'
  const highRisks = risks.filter((risk) => risk.level === 'high' || risk.level === 'elevated')
  const sortedRisks = useMemo(() => [...risks].sort((a, b) => b.score - a.score), [risks])

  /* Bucket counts */
  const buckets = useMemo(() => {
    const b = { low: 0, moderate: 0, elevated: 0, high: 0 }
    for (const r of risks) b[r.level]++
    return b
  }, [risks])

  const trendCounts = useMemo(() => {
    const c = { rising: 0, falling: 0, stable: 0 }
    for (const r of risks) c[r.trend]++
    return c
  }, [risks])

  const hasData = risks.length > 0

  return (
    <div className="animate-fade-in space-y-4">

      {/* HEADER*/}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${hasData ? overallCfg.gradient : 'from-blue-500 to-indigo-700'} flex items-center justify-center shadow-lg`}>
              <BarChart3 className="w-[22px] h-[22px] text-white" />
            </div>
            {hasData && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${overallCfg.dot} opacity-60`} />
                <span className={`relative inline-flex rounded-full h-4 w-4 ${overallCfg.dot} border-2 border-white dark:border-gray-900 items-center justify-center`}>
                  <span className="text-micro font-black text-white">{overallScore}</span>
                </span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">Risk Assessment</h2>
              {hasData && (
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${overallCfg.bg} ${overallCfg.color}`}>
                  {overallCfg.label}
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-300 font-medium mt-0.5">
              {loading ? 'Analyzing local hazard data...' : locationName || 'Search or use GPS to assess risks'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={requestGPS}
            disabled={loading}
            className="flex items-center gap-1.5 text-[10px] font-bold bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all border border-blue-200/50 dark:border-blue-800/50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
            // GPS
          </button>
          {hasData && (
            <button
              onClick={() => coords && runAssessment(coords, countryCode || 'ZZ')}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-white"
              title="Re-assess"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* SEARCH BAR*/}
      <div className="glass-card rounded-2xl p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search city, postcode, or address..."
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-400 transition text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-md shadow-blue-500/20">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Assess'}
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 font-medium mt-1.5 ml-1">{locationError}</p>}
      </div>

      {/* CONTENT*/}
      {!hasData && !loading ? (
        /* Empty state */
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="py-14 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950/40 dark:to-indigo-950/40 flex items-center justify-center mx-auto">
              <Shield className="w-8 h-8 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Know Your Local Risks</p>
              <p className="text-xs text-gray-400 dark:text-gray-300 mt-1 max-w-xs mx-auto">Enable GPS or search a location to get a live, data-driven hazard assessment.</p>
            </div>
            <button onClick={requestGPS} className="inline-flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white px-5 py-2.5 rounded-xl transition-all shadow-md shadow-blue-500/20">
              <Compass className="w-4 h-4" /> Use My Location
            </button>
          </div>
        </div>
      ) : loading ? (
        /* Loading skeleton matching the data layout */
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-5">
              <div className="flex-shrink-0 w-[200px] h-[120px] skeleton-shimmer rounded-xl bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
              <div className="flex-1 space-y-3">
                <div className="skeleton-shimmer h-5 w-40 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                <div className="skeleton-shimmer h-3 w-56 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                <div className="grid grid-cols-3 gap-3 pt-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="space-y-2">
                      <div className="skeleton-shimmer h-8 w-12 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                      <div className="skeleton-shimmer h-3 w-20 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-200/50 dark:border-white/[0.06] p-5">
            <div className="skeleton-shimmer h-4 w-32 rounded bg-gray-200 dark:bg-gray-700 mb-3 motion-reduce:animate-none motion-reduce:opacity-70" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <div className="skeleton-shimmer h-3 w-16 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                  <div className="skeleton-shimmer h-6 w-10 rounded bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                  <div className="skeleton-shimmer h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 motion-reduce:animate-none motion-reduce:opacity-70" />
                </div>
              ))}
            </div>
          </div>
          <div className="px-5 pb-4 text-center">
            <p className="text-[10px] text-gray-400 dark:text-gray-300">Analyzing hazard data — weather, flood gauges, wind models & more</p>
          </div>
        </div>
      ) : (
        <>
          {/* HERO: ARC GAUGE + STATS*/}
          <div className={`relative glass-card rounded-2xl overflow-hidden border ${overallCfg.border}`}>
            <div className={`absolute inset-0 bg-gradient-to-br ${overallCfg.gradient} opacity-[0.04]`} />
            <div className="relative p-5">
              <div className="flex items-center gap-5">
                {/* Arc Gauge */}
                <div className="flex-shrink-0 w-[200px]">
                  <ArcGauge score={overallScore} level={overallLevel} />
                </div>
                {/* Stats */}
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-extrabold text-gray-500 dark:text-gray-300 uppercase tracking-widest mb-1">Overall Threat Level</p>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase ${overallCfg.bg} ${overallCfg.color}`}>{overallCfg.label}</span>
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${overallCfg.gradient} flex items-center justify-center shadow-md`}>
                      {overallLevel === 'low' ? <ShieldCheck className="w-[18px] h-[18px] text-white" /> :
                       overallLevel === 'moderate' ? <Activity className="w-[18px] h-[18px] text-white" /> :
                       overallLevel === 'elevated' ? <TrendingUp className="w-[18px] h-[18px] text-white" /> :
                       <AlertCircle className="w-[18px] h-[18px] text-white" />}
                    </div>
                  </div>

                  {highRisks.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {highRisks.length} risk{highRisks.length > 1 ? 's' : ''} need{highRisks.length === 1 ? 's' : ''} attention
                    </div>
                  )}

                  {/* 24h trend summary */}
                  <div className="flex items-center gap-3 text-[9px] font-bold">
                    {(() => { const TI = TREND_CFG[overallTrend].Icon; return (
                      <span className={`${TREND_CFG[overallTrend].color} flex items-center gap-1`}>
                        <TI className="w-3 h-3" /> {overallScore} <ArrowRight className="w-2.5 h-2.5 opacity-50" /> {overallTomorrow} 24h
                      </span>
                    ) })()}
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    {trendCounts.rising > 0 && <span className="text-red-500 flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />{trendCounts.rising}</span>}
                    {trendCounts.falling > 0 && <span className="text-emerald-500 flex items-center gap-0.5"><TrendingDown className="w-2.5 h-2.5" />{trendCounts.falling}</span>}
                    {trendCounts.stable > 0 && <span className="text-gray-400 dark:text-gray-300 flex items-center gap-0.5"><Minus className="w-2.5 h-2.5" />{trendCounts.stable}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RADAR + 24H FORECAST*/}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Radar Chart */}
            <div className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Eye className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Risk Profile</span>
              </div>
              <RadarChart factors={risks} />
              <div className="flex items-center justify-center gap-4 mt-2 text-[8px] font-medium text-gray-500 dark:text-gray-300">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-sm bg-blue-500/70" /> Today</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-sm bg-purple-400/40 border border-purple-400/60 border-dashed" /> Tomorrow</span>
              </div>
            </div>

            {/* 24h Outlook Comparison */}
            <div className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Clock className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">24h Outlook</span>
              </div>
              <div className="space-y-2.5">
                {risks.map(risk => {
                  const cfg = RISK_LEVELS[risk.level]
                  const tr = TREND_CFG[risk.trend]
                  const tCfg = RISK_LEVELS[getLevel(risk.tomorrowScore)]
                  return (
                    <div key={risk.id} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200 w-14 truncate">{risk.name.split(' ')[0]}</span>
                      <span className={`text-[10px] font-black w-5 text-right ${cfg.color}`}>{Math.round(risk.score * 100) / 100}</span>
                      {(() => { const TI = tr.Icon; return <span className={`w-4 flex items-center justify-center ${tr.color}`}><TI className="w-3.5 h-3.5" /></span> })()}
                      <span className={`text-[10px] font-black w-5 ${tCfg.color}`}>{Math.round(risk.tomorrowScore * 100) / 100}</span>
                      <div className="flex-1 h-2 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden relative">
                        <div className="absolute inset-y-0 left-0 h-full rounded-full bg-purple-300/30 dark:bg-purple-400/20" style={{ width: `${risk.tomorrowScore}%` }} />
                        <div className={`relative h-full rounded-full bg-gradient-to-r ${cfg.bar}`} style={{ width: `${risk.score}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800/40">
                <div className="flex items-center gap-3 text-[8px] font-medium text-gray-400 dark:text-gray-300">
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-sm bg-gradient-to-r from-blue-500 to-blue-400" /> Now</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-sm bg-purple-300/30 dark:bg-purple-400/20" /> +24h</span>
                </div>
              </div>
            </div>
          </div>

          {/* RISK LEVEL BUCKETS*/}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['high', 'elevated', 'moderate', 'low'] as const).map((level) => {
              const cfg = RISK_LEVELS[level]
              return (
                <div key={level} className={`glass-card rounded-xl p-3 text-center border ${cfg.border}`}>
                  <div className={`text-2xl font-black leading-none ${cfg.color}`}>{buckets[level]}</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase">{cfg.label}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* RISK DISTRIBUTION BAR*/}
          <div className="glass-card rounded-xl px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Risk Distribution</span>
              <span className="text-[9px] font-medium text-gray-400 dark:text-gray-300">{risks.length} factors analysed</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40">
              {(['high', 'elevated', 'moderate', 'low'] as const).map((level) => {
                const pct = risks.length ? (buckets[level] / risks.length) * 100 : 0
                if (pct === 0) return null
                const cfg = RISK_LEVELS[level]
                return <div key={level} className={`h-full bg-gradient-to-r ${cfg.bar} transition-all duration-700`} style={{ width: `${pct}%` }} title={`${cfg.label}: ${buckets[level]}`} />
              })}
            </div>
            <div className="flex gap-3 mt-1.5">
              {(['high', 'elevated', 'moderate', 'low'] as const).map((level) => {
                if (buckets[level] === 0) return null
                const cfg = RISK_LEVELS[level]
                return (
                  <span key={level} className="flex items-center gap-1 text-[9px] font-medium text-gray-600 dark:text-gray-300">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />{cfg.label} {buckets[level]}
                  </span>
                )
              })}
            </div>
          </div>

          {/* RISK FACTOR CARDS*/}
          <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
            <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[520px] overflow-y-auto custom-scrollbar">
              {sortedRisks.map((risk, idx) => {
                const cfg = RISK_LEVELS[risk.level]
                const RiskIcon = risk.icon
                const isExpanded = expandedRisk === risk.id
                const isTop = idx < 3 && risk.score >= 25
                const tr = TREND_CFG[risk.trend]

                return (
                  <button
                    key={risk.id}
                    onClick={() => setExpandedRisk(isExpanded ? null : risk.id)}
                    className={`w-full text-left p-4 transition-all duration-200 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 ${isExpanded ? `${cfg.bg} ${cfg.ring} ring-2 ring-inset` : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-md flex-shrink-0`}>
                        <RiskIcon className="w-5 h-5 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{risk.name}</span>
                            {isTop && <span className="text-micro font-black px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 uppercase">Priority</span>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={`text-lg font-black ${cfg.color}`}>{Math.round(risk.score * 100) / 100}</span>
                            <span className={`text-[8px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                            {(() => { const TI = tr.Icon; return <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${tr.bg} ${tr.color} flex items-center gap-0.5`} title={`${tr.label}: ${risk.score} to ${risk.tomorrowScore}`}><TI className="w-3 h-3" /></span> })()}
                          </div>
                        </div>

                        {/* Dual score bar (today solid, tomorrow faded) */}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 h-2 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden relative">
                            <div className="absolute inset-y-0 left-0 h-full rounded-full bg-purple-300/25 dark:bg-purple-400/15 transition-all duration-700" style={{ width: `${risk.tomorrowScore}%` }} />
                            <div className={`relative h-full rounded-full bg-gradient-to-r ${cfg.bar} transition-all duration-700`} style={{ width: `${risk.score}%` }} />
                          </div>
                          <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 flex-shrink-0">{Math.round(risk.score * 100) / 100}/100</span>
                        </div>
                      </div>

                      {/* Arrow */}
                      <ChevronRight className={`w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mt-4 pt-3 border-t border-gray-200/50 dark:border-gray-700/30 space-y-3 ml-[52px]">
                        <div className="flex items-start gap-2">
                          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 dark:text-gray-300" />
                          <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">{risk.description}</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-500" />
                          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 leading-relaxed font-medium">{risk.recommendation}</p>
                        </div>
                        <div className="flex items-center gap-4 text-[9px] text-gray-400 dark:text-gray-300">
                          <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {risk.source}</span>
                          {(() => { const TI = tr.Icon; return <span className={`flex items-center gap-1 font-bold ${tr.color}`}><TI className="w-3 h-3" /> {tr.label}: {Math.round(risk.score * 100) / 100} <ArrowRight className="w-2.5 h-2.5 opacity-50" /> {Math.round(risk.tomorrowScore * 100) / 100} in 24h</span> })()}
                        </div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
              <div className="flex items-center gap-3 text-[9px] font-medium">
                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> Live &middot; {risks[0]?.source || 'Open-Meteo'}
                </span>
                {lastAssessed && (
                  <span className="text-gray-400 dark:text-gray-300">Assessed {lastAssessed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {coords && <span className="text-[9px] text-gray-400 dark:text-gray-300">{coords.lat.toFixed(3)}, {coords.lng.toFixed(3)} ({countryCode})</span>}
                <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">{risks.length} factors &middot; 2-day forecast</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
