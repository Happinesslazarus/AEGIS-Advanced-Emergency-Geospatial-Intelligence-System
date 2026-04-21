/**
 * Multi-hazard version of FloodPredictionTimeline. Shows side-by-side
 * timelines for flood, wildfire, drought, and other hazards with
 * per-hazard colour coding and a shared time axis.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useAsync } from '../../hooks/useAsync'
import {
  Play, Pause, SkipForward, SkipBack, Clock,
  AlertTriangle, Home, Users, TrendingUp, ChevronDown,
  Droplets, Flame, Thermometer, CloudLightning, Wind,
  Mountain, Zap, ShieldAlert, Building, Leaf, AlertOctagon,
  RefreshCw, BarChart3, Target,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { STATUS_HEX } from '../../utils/colorTokens'
import { getCitizenToken } from '../../contexts/CitizenAuthContext'
import { getToken } from '../../utils/api'

const API = ''

/* Hazard type config */

interface HazardConfig {
  label: string
  icon: React.ComponentType<any>
  colour: string
  bgColour: string
  timePointsHours: number[]
  unitLabel: string
  regionLabel: string
}

const HAZARD_CONFIGS: Record<string, HazardConfig> = {
  flood:                  { label: 'Flood',                  icon: Droplets,      colour: '#3b82f6', bgColour: 'bg-blue-600',    timePointsHours: [0, 1, 2, 4, 6],  unitLabel: 'Water Level',      regionLabel: 'Rivers' },
  drought:                { label: 'Drought',                icon: Thermometer,   colour: '#d97706', bgColour: 'bg-amber-600',   timePointsHours: [0, 6, 12, 24, 48], unitLabel: 'Severity Index', regionLabel: 'Regions' },
  heatwave:               { label: 'Heatwave',               icon: Thermometer,   colour: '#ef4444', bgColour: 'bg-red-500',     timePointsHours: [0, 3, 6, 12, 24], unitLabel: 'Temperature',     regionLabel: 'Zones' },
  severe_storm:           { label: 'Severe Storm',           icon: CloudLightning,colour: '#8b5cf6', bgColour: 'bg-violet-600',  timePointsHours: [0, 1, 2, 4, 6],  unitLabel: 'Wind Speed',       regionLabel: 'Areas' },
  wildfire:               { label: 'Wildfire',               icon: Flame,         colour: '#f97316', bgColour: 'bg-orange-600',  timePointsHours: [0, 2, 6, 12, 24], unitLabel: 'Fire Index',      regionLabel: 'Zones' },
  landslide:              { label: 'Landslide',              icon: Mountain,      colour: '#92400e', bgColour: 'bg-amber-800',   timePointsHours: [0, 3, 6, 12, 24], unitLabel: 'Risk Score',      regionLabel: 'Slopes' },
  power_outage:           { label: 'Power Outage',           icon: Zap,           colour: '#eab308', bgColour: 'bg-yellow-500',  timePointsHours: [0, 1, 2, 4, 8],  unitLabel: 'Load %',           regionLabel: 'Grids' },
  water_supply_disruption:{ label: 'Water Supply',           icon: Droplets,      colour: '#06b6d4', bgColour: 'bg-cyan-600',    timePointsHours: [0, 4, 8, 16, 24], unitLabel: 'Supply %',        regionLabel: 'Networks' },
  infrastructure_damage:  { label: 'Infrastructure',         icon: Building,      colour: '#64748b', bgColour: 'bg-slate-600',   timePointsHours: [0, 6, 12, 24, 48], unitLabel: 'Damage Score',  regionLabel: 'Assets' },
  public_safety_incident: { label: 'Public Safety',          icon: ShieldAlert,   colour: '#dc2626', bgColour: 'bg-red-600',     timePointsHours: [0, 1, 2, 4, 6],  unitLabel: 'Threat Level',     regionLabel: 'Sectors' },
  environmental_hazard:   { label: 'Environmental',          icon: Leaf,          colour: '#16a34a', bgColour: 'bg-green-600',   timePointsHours: [0, 6, 12, 24, 48], unitLabel: 'Hazard Index',  regionLabel: 'Areas' },
}

function getHazardConfig(type: string): HazardConfig {
  return HAZARD_CONFIGS[type] || {
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: AlertOctagon,
    colour: '#6b7280',
    bgColour: 'bg-gray-600',
    timePointsHours: [0, 1, 2, 4, 6],
    unitLabel: 'Risk',
    regionLabel: 'Regions',
  }
}

/* Types */

interface PredictionRecord {
  id: string
  hazard_type: string
  region_id: string
  probability: number
  risk_level: string
  predicted_label: string
  predicted_severity: string
  confidence: number
  predicted_peak_time: string | null
  model_version: string
  top_shap_contributors: any[]
  contributing_factors: any[]
  location: any
  affected_area_geojson: any
  generated_at: string
  expires_at: string | null
}

interface RegionPrediction {
  regionId: string
  regionName: string
  currentRisk: string
  probability: number
  confidence: number
  predictions: PredictionRecord[]
  peakTime: string | null
  topFactors: Array<{ factor: string; importance: number }>
}

interface Props {
  hazardType: string
  onTimeChange?: (hoursAhead: number, areas: any[]) => void
  className?: string
  /* If true, show in compact card mode */
  compact?: boolean
}

const STATUS_COLOURS: Record<string, string> = STATUS_HEX

const RISK_ORDER: Record<string, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, MINIMAL: 0, NORMAL: 0,
}

function riskColour(risk: string): string {
  const r = (risk || '').toUpperCase()
  if (r === 'CRITICAL') return '#ef4444'
  if (r === 'HIGH') return '#f97316'
  if (r === 'MEDIUM') return '#eab308'
  if (r === 'LOW') return '#22c55e'
  return '#6b7280'
}

function riskBgClass(risk: string): string {
  const r = (risk || '').toUpperCase()
  if (r === 'CRITICAL') return 'bg-red-500/20 text-red-400'
  if (r === 'HIGH') return 'bg-orange-500/20 text-orange-400'
  if (r === 'MEDIUM') return 'bg-yellow-500/20 text-yellow-400'
  if (r === 'LOW') return 'bg-green-500/20 text-green-400'
  return 'bg-gray-500/20 text-gray-400'
}

/* Component */

export default function HazardPredictionTimeline({ hazardType, onTimeChange, className = '', compact = false }: Props): JSX.Element {
  const lang = useLanguage()
  const config = useMemo(() => getHazardConfig(hazardType), [hazardType])
  const Icon = config.icon

  const [collapsed, setCollapsed] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const timePoints = config.timePointsHours

  const { data: fetchResult, loading, refresh: fetchPredictions } = useAsync(
    async ({ signal }) => {
      const attempt = async (retries: number) => {
        const token = getToken() || getCitizenToken()
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const res = await fetch(`${API}/api/ai/predictions?hazard_type=${encodeURIComponent(hazardType)}&limit=100`, { signal, headers })
        if (res.status === 429 && retries > 0) {
          await new Promise<void>((resolve, reject) => {
            const id = setTimeout(resolve, 2000)
            signal.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')) })
          })
          return attempt(retries - 1)
        }
        if (!res.ok) return { predictions: [], rawRecords: [], lastRefresh: null }
        const data: PredictionRecord[] = await res.json()
        const byRegion = new Map<string, PredictionRecord[]>()
        for (const rec of data) {
          const group = byRegion.get(rec.region_id) || []; group.push(rec); byRegion.set(rec.region_id, group)
        }
        const mapped: RegionPrediction[] = Array.from(byRegion.entries()).map(([regionId, recs]) => {
          const sorted = [...recs].sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())
          const latest = sorted[0]
          const topFactors = Array.isArray(latest.top_shap_contributors)
            ? latest.top_shap_contributors.slice(0, 3).map((f: any) => ({ factor: f.factor || f.name || 'Unknown', importance: Math.abs(f.importance || 0) }))
            : []
          return {
            regionId,
            regionName: regionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            currentRisk: latest.risk_level || 'LOW',
            probability: latest.probability ?? 0,
            confidence: latest.confidence ?? 0,
            predictions: sorted,
            peakTime: latest.predicted_peak_time || null,
            topFactors,
          }
        })
        mapped.sort((a, b) => (RISK_ORDER[b.currentRisk?.toUpperCase()] || 0) - (RISK_ORDER[a.currentRisk?.toUpperCase()] || 0))
        return { predictions: mapped, rawRecords: data, lastRefresh: new Date() }
      }
      return attempt(2)
    },
    [hazardType],
    { pollMs: 60000 },
  )
  const predictions = fetchResult?.predictions ?? []
  const rawRecords = fetchResult?.rawRecords ?? []
  const lastRefresh = fetchResult?.lastRefresh ?? null

  /* Auto-play */
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setSelectedIdx(prev => prev < timePoints.length - 1 ? prev + 1 : 0)
      }, 2000)
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current) }
  }, [isPlaying, timePoints.length])

  /* Notify parent */
  useEffect(() => {
    if (!onTimeChange) return
    const areas: any[] = []
    for (const region of predictions) {
      for (const pred of region.predictions) {
        if (pred.affected_area_geojson) areas.push(pred.affected_area_geojson)
      }
    }
    onTimeChange(timePoints[selectedIdx], areas)
  }, [selectedIdx, predictions, onTimeChange, timePoints])

  /* Step controls */
  const stepForward = () => { if (selectedIdx < timePoints.length - 1) setSelectedIdx(selectedIdx + 1) }
  const stepBack = () => { if (selectedIdx > 0) setSelectedIdx(selectedIdx - 1) }

  /* Aggregate stats */
  const stats = useMemo(() => {
    let criticalCount = 0
    let totalProbability = 0
    let totalConfidence = 0
    let count = 0
    let highestRisk = 'LOW'

    for (const region of predictions) {
      count++
      totalProbability += region.probability
      totalConfidence += region.confidence
      const riskUpper = (region.currentRisk || '').toUpperCase()
      if (riskUpper === 'CRITICAL' || riskUpper === 'HIGH') criticalCount++
      if ((RISK_ORDER[riskUpper] || 0) > (RISK_ORDER[highestRisk] || 0)) highestRisk = riskUpper
    }

    return {
      criticalCount,
      regionCount: count,
      avgProbability: count > 0 ? Math.round(totalProbability / count) : 0,
      avgConfidence: count > 0 ? Math.round(totalConfidence / count) : 0,
      highestRisk,
    }
  }, [predictions])

  const selectedHour = timePoints[selectedIdx]

  /* Render */
  return (
    <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl shadow-2xl overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-2.5 border-b border-gray-200 dark:border-gray-700/40 flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className={`p-1.5 rounded-lg ${config.bgColour}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 text-left">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            {t(`hazardPred.${hazardType}`, lang) || config.label} {t('hazardPred.prediction', lang)}
          </h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-300">
            {predictions.length} {config.regionLabel.toLowerCase()} {t('hazardPred.monitored', lang)}
            {stats.highestRisk !== 'LOW' && stats.highestRisk !== 'MINIMAL' && (
              <span className="ml-1.5 font-bold" style={{ color: riskColour(stats.highestRisk) }}>
                -- {stats.highestRisk}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); fetchPredictions() }}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
          title="Refresh predictions"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-300 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      {!collapsed && (
        <>
          {/* Timeline scrubber */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/30">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={stepBack} className="p-1 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition disabled:opacity-30" disabled={selectedIdx === 0}>
                <SkipBack className="w-4 h-4" />
              </button>
              <button onClick={() => setIsPlaying(!isPlaying)} className="p-1.5 rounded-lg text-white hover:opacity-80 transition" style={{ backgroundColor: config.colour }}>
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button onClick={stepForward} className="p-1 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition disabled:opacity-30" disabled={selectedIdx === timePoints.length - 1}>
                <SkipForward className="w-4 h-4" />
              </button>
              <div className="flex-1" />
              <span className="text-sm font-mono font-bold text-gray-900 dark:text-white flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {selectedHour === 0 ? t('hazardPred.now', lang) : `+${selectedHour}h`}
              </span>
            </div>

            {/* Scrubber track */}
            <div className="relative flex items-center">
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full relative">
                {timePoints.map((tp, i) => {
                  const pct = (i / (timePoints.length - 1)) * 100
                  const isActive = i === selectedIdx
                  return (
                    <button
                      key={tp}
                      onClick={() => setSelectedIdx(i)}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                      style={{ left: `${pct}%` }}
                    >
                      <div
                        className={`w-3 h-3 rounded-full border-2 transition-all ${isActive ? 'scale-125' : 'hover:opacity-80'}`}
                        style={{
                          backgroundColor: isActive ? config.colour : '#4b5563',
                          borderColor: isActive ? config.colour : '#6b7280',
                        }}
                      />
                    </button>
                  )
                })}
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                  style={{
                    width: `${(selectedIdx / (timePoints.length - 1)) * 100}%`,
                    backgroundColor: config.colour,
                  }}
                />
              </div>
            </div>
            <div className="flex justify-between mt-1">
              {timePoints.map(tp => (
                <span key={tp} className="text-[9px] text-gray-500 dark:text-gray-300">
                  {tp === 0 ? 'Now' : `+${tp}h`}
                </span>
              ))}
            </div>
          </div>

          {/* Stats summary */}
          <div className="px-4 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{stats.criticalCount}</div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <AlertTriangle className="w-2.5 h-2.5" /> {t('hazardPred.atRisk', lang)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{stats.regionCount}</div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <Target className="w-2.5 h-2.5" /> {config.regionLabel}
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{stats.avgProbability}%</div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <BarChart3 className="w-2.5 h-2.5" /> {t('hazardPred.probability', lang)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{stats.avgConfidence}%</div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('hazardPred.confidence', lang)}</div>
            </div>
          </div>

          {/* Per-region breakdown */}
          {!loading && predictions.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700/30 max-h-[240px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
              {predictions.map(region => {
                const colour = riskColour(region.currentRisk)
                const latest = region.predictions[0]

                return (
                  <div key={region.regionId} className="px-4 py-2.5 flex items-start gap-3 border-b border-gray-100 dark:border-gray-700/20 last:border-b-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: colour }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{region.regionName}</p>
                      {/* Contributing factors */}
                      {region.topFactors.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {region.topFactors.map((f, i) => (
                            <span key={i} className="text-[8px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                              {f.factor}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Peak time */}
                      {region.peakTime && (
                        <p className="text-[9px] text-gray-400 dark:text-gray-400 mt-0.5 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          Peak: {new Date(region.peakTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-mono font-bold text-gray-900 dark:text-white">{region.probability}%</div>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${riskBgClass(region.currentRisk)}`}>
                        {region.currentRisk}
                      </span>
                      <div className="text-[8px] text-gray-400 mt-0.5">{region.confidence}% conf</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Empty state */}
          {!loading && predictions.length === 0 && (
            <div className="px-4 py-6 text-center">
              <Icon className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('hazardPred.noPredictions', lang)}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1">{t('hazardPred.runPrediction', lang)}</p>
            </div>
          )}

          {loading && (
            <div className="px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-300">
              <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin" />
              {t('hazardPred.loading', lang)}
            </div>
          )}

          {/* Last refresh timestamp */}
          {lastRefresh && !loading && (
            <div className="px-4 py-1.5 border-t border-gray-100 dark:border-gray-700/30">
              <p className="text-[8px] text-gray-400 dark:text-gray-500 text-right">
                {t('hazardPred.updated', lang)} {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                {rawRecords.length > 0 && ` -- ${rawRecords[0]?.model_version || ''}`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* Multi-hazard panel (shows all hazards at once) */

interface MultiHazardProps {
  hazardTypes?: string[]
  onTimeChange?: (hazardType: string, hoursAhead: number, areas: any[]) => void
  className?: string
}

export function MultiHazardPredictionPanel({ hazardTypes, onTimeChange, className = '' }: MultiHazardProps): JSX.Element {
  const lang = useLanguage()
  const types = hazardTypes || Object.keys(HAZARD_CONFIGS)
  const [activeTab, setActiveTab] = useState(types[0] || 'flood')

  return (
    <div className={`${className}`}>
      {/* Hazard type tabs */}
      <div className="flex flex-wrap gap-1 mb-2">
        {types.map(type => {
          const cfg = getHazardConfig(type)
          const HIcon = cfg.icon
          const isActive = type === activeTab
          return (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                isActive
                  ? 'text-white shadow-lg'
                  : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              style={isActive ? { backgroundColor: cfg.colour } : undefined}
            >
              <HIcon className="w-3 h-3" />
              {cfg.label}
            </button>
          )
        })}
      </div>

      {/* Active hazard timeline */}
      <HazardPredictionTimeline
        hazardType={activeTab}
        onTimeChange={onTimeChange ? (h, a) => onTimeChange(activeTab, h, a) : undefined}
      />
    </div>
  )
}

