/**
 * RiverLevelPanel.tsx — Live River Level Monitoring Sidebar
 *
 * Fetches real-time river data from the server API (which uses
 * SEPA ? OpenMeteo fallback chain). Shows animated gauge bars,
 * sparkline trend dots, flood status, and timestamps.
 *
 * Receives Socket.IO updates via `river:levels_updated` for live refresh.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Waves, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Droplets, Clock, Activity, ChevronDown,
  ChevronUp, MapPin, Thermometer, Navigation
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const API = ''

interface RiverReading {
  stationId: string
  stationName: string
  riverName: string
  levelMetres: number
  flowCumecs: number | null
  timestamp: string
  dataSource: string
  status: string  // NORMAL | ELEVATED | HIGH | CRITICAL
  trend: string   // rising | falling | stable
  statusColour: string
  thresholds?: {
    normal: number
    elevated: number
    high: number
    critical: number
  }
}

interface Props {
  socket?: any
  collapsed?: boolean
  onToggle?: () => void
  className?: string
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: any; pulse?: boolean }> = {
  CRITICAL: { label: 'CRITICAL', bg: 'bg-red-600', text: 'text-white', icon: AlertTriangle, pulse: true },
  HIGH:     { label: 'HIGH',     bg: 'bg-orange-500', text: 'text-white', icon: AlertTriangle },
  ELEVATED: { label: 'ELEVATED', bg: 'bg-amber-400', text: 'text-gray-900', icon: TrendingUp },
  NORMAL:   { label: 'Normal',   bg: 'bg-blue-500', text: 'text-white', icon: Droplets },
}

export default function RiverLevelPanel({ socket, collapsed: initialCollapsed = false, onToggle, className = '' }: Props): JSX.Element {
  const lang = useLanguage()
  const [readings, setReadings] = useState<RiverReading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [expandedStation, setExpandedStation] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchLevels = useCallback(async (retries = 2) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/rivers/levels`, { signal: controller.signal })
      if (res.status === 429 && retries > 0) {
        await new Promise<void>((resolve, reject) => {
          const id = setTimeout(resolve, 2000)
          controller.signal.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')) })
        })
        setLoading(false)
        return fetchLevels(retries - 1)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setReadings(data.levels || data.readings || [])
      setLastUpdated(new Date())
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err.message || 'Failed to fetch river levels')
    }
    setLoading(false)
  }, [])

  // Initial fetch + cleanup
  useEffect(() => {
    fetchLevels()
    return () => { abortRef.current?.abort() }
  }, [fetchLevels])

  // Socket.IO live updates
  useEffect(() => {
    if (!socket) return
    const handler = (data: any) => {
      const levels = data?.levels || data?.readings
      if (levels) {
        setReadings(levels)
        setLastUpdated(new Date())
      }
    }
    socket.on('river:levels_updated', handler)
    return () => { socket.off('river:levels_updated', handler) }
  }, [socket])

  const toggle = () => {
    setCollapsed(!collapsed)
    onToggle?.()
  }

  // Sort by status severity
  const sorted = useMemo(() => {
    const order = { CRITICAL: 0, HIGH: 1, ELEVATED: 2, NORMAL: 3 }
    return [...readings].sort((a, b) => (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4))
  }, [readings])

  const highestStatus = sorted[0]?.status || 'NORMAL'
  const statusCfg = STATUS_CONFIG[highestStatus] || STATUS_CONFIG.NORMAL

  const TrendIcon = ({ trend }: { trend: string }) => {
    if (trend === 'rising') return <TrendingUp className="w-3.5 h-3.5 text-red-400" />
    if (trend === 'falling') return <TrendingDown className="w-3.5 h-3.5 text-green-400" />
    return <Minus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
  }

  const getGaugePercent = (reading: RiverReading): number => {
    const max = reading.thresholds?.critical || 4.0
    return Math.min(100, Math.max(0, (reading.levelMetres / max) * 100))
  }

  const getGaugeColour = (status: string): string => {
    if (status === 'CRITICAL') return 'bg-red-500'
    if (status === 'HIGH') return 'bg-orange-500'
    if (status === 'ELEVATED') return 'bg-amber-400'
    return 'bg-blue-500'
  }

  return (
    <div className={`bg-gray-900/95 backdrop-blur-md border border-gray-700/60 rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ${className}`}>
      {/* Header */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${statusCfg.bg} ${statusCfg.pulse ? 'animate-pulse' : ''}`}>
            <Waves className={`w-4 h-4 ${statusCfg.text}`} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-white">{t('river.riverLevels', lang)}</h3>
            <p className="text-[10px] text-gray-400 dark:text-gray-300">
              {readings.length} station{readings.length !== 1 ? 's' : ''} — {lastUpdated ? `${Math.round((Date.now() - lastUpdated.getTime()) / 60000)}m ago` : 'Loading...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.text}`}>
            {statusCfg.label}
          </span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-300" /> : <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-300" />}
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-gray-700/40">
          {/* Refresh bar */}
          <div className="px-4 py-2 flex items-center justify-between border-b border-gray-700/30">
            <span className="text-[10px] text-gray-500 dark:text-gray-300 dark:text-blue-300 flex items-center gap-1">
              <Activity className="w-3 h-3" /> {t('river.liveMonitoring', lang)}
            </span>
            <button
              onClick={() => fetchLevels()}
              disabled={loading}
              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
            </button>
          </div>

          {error && (
            <div className="mx-3 my-2 px-3 py-2 bg-red-900/30 border border-red-700/40 rounded-lg text-xs text-red-300">
              {error}
            </div>
          )}

          {loading && readings.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-xs text-gray-400 dark:text-gray-300">{t('river.fetchingRiverData', lang)}</p>
            </div>
          ) : (
            <div>
              {sorted.map((reading) => {
                const cfg = STATUS_CONFIG[reading.status] || STATUS_CONFIG.NORMAL
                const isExpanded = expandedStation === reading.stationId
                const gaugePercent = getGaugePercent(reading)

                return (
                  <div
                    key={reading.stationId}
                    className="border-b border-gray-700/20 last:border-b-0"
                  >
                    <button
                      onClick={() => setExpandedStation(isExpanded ? null : reading.stationId)}
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-800/40 transition-colors text-left"
                    >
                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${reading.status === 'CRITICAL' ? 'bg-red-500 animate-pulse' : reading.status === 'HIGH' ? 'bg-orange-500' : reading.status === 'ELEVATED' ? 'bg-amber-400' : 'bg-blue-500'}`} />
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">{reading.riverName}</span>
                          <TrendIcon trend={reading.trend} />
                        </div>
                        <p className="text-[10px] text-gray-400 dark:text-gray-300 truncate">{reading.stationName}</p>
                      </div>

                      {/* Level + gauge */}
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-mono font-bold text-white">{reading.levelMetres.toFixed(2)}m</div>
                        <div className="w-16 h-1.5 bg-gray-700 rounded-full mt-0.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${getGaugeColour(reading.status)}`}
                            style={{ width: `${gaugePercent}%` }}
                          />
                        </div>
                      </div>
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-4 pb-3 bg-gray-800/30 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                            <Droplets className="w-3 h-3" />
                            <span>{t('river.flow', lang)}: {reading.flowCumecs != null ? `${reading.flowCumecs.toFixed(1)} m³/s` : 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(reading.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                            <Navigation className="w-3 h-3" />
                            <span>{t('river.source', lang)}: {reading.dataSource}</span>
                          </div>
                          <div>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text} font-medium`}>
                              <cfg.icon className="w-2.5 h-2.5" />
                              {cfg.label}
                            </span>
                          </div>
                        </div>

                        {/* Threshold bars */}
                        {reading.thresholds && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-gray-300 dark:text-gray-300">{t('river.thresholds', lang)}</p>
                            <div className="relative w-full h-4 bg-gray-700 rounded-full overflow-hidden">
                              {/* Threshold markers */}
                              <div className="absolute inset-y-0 left-0 bg-blue-600/60 rounded-l-full" style={{ width: `${(reading.thresholds.normal / reading.thresholds.critical) * 100}%` }} />
                              <div className="absolute inset-y-0 bg-amber-500/40" style={{ left: `${(reading.thresholds.normal / reading.thresholds.critical) * 100}%`, width: `${((reading.thresholds.elevated - reading.thresholds.normal) / reading.thresholds.critical) * 100}%` }} />
                              <div className="absolute inset-y-0 bg-orange-500/40" style={{ left: `${(reading.thresholds.elevated / reading.thresholds.critical) * 100}%`, width: `${((reading.thresholds.high - reading.thresholds.elevated) / reading.thresholds.critical) * 100}%` }} />
                              <div className="absolute inset-y-0 bg-red-600/40 rounded-r-full" style={{ left: `${(reading.thresholds.high / reading.thresholds.critical) * 100}%`, width: `${((reading.thresholds.critical - reading.thresholds.high) / reading.thresholds.critical) * 100}%` }} />
                              {/* Current level marker */}
                              <div
                                className="absolute top-0 h-full w-0.5 bg-white shadow-lg shadow-white/50"
                                style={{ left: `${Math.min(100, (reading.levelMetres / reading.thresholds.critical) * 100)}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-300">
                              <span>0m</span>
                              <span>{reading.thresholds.normal}m</span>
                              <span>{reading.thresholds.elevated}m</span>
                              <span>{reading.thresholds.high}m</span>
                              <span>{reading.thresholds.critical}m</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {sorted.length === 0 && !loading && (
                <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-300">
                  {t('river.noStationsConfigured', lang)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

