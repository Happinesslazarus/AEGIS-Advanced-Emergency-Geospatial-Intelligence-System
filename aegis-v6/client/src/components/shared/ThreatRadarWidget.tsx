/**
 * Module: ThreatRadarWidget.tsx
 *
 * Threat radar widget shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, useEffect, useMemo, useRef } from 'react'
import { AlertTriangle, Activity, Droplets, Flame, Wind, CloudLightning, RefreshCw, MapPin, Clock, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useLocation } from '../../contexts/LocationContext'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface ThreatItem {
  id: string
  type: 'flood' | 'storm' | 'fire' | 'wind' | 'earthquake' | 'general'
  severity: 'low' | 'moderate' | 'severe' | 'extreme'
  title: string
  description: string
  distance: number // km
  timestamp: string
  source: string
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; ring: string; dot: string }> = {
  low: { bg: 'bg-green-50 dark:bg-green-950/20', text: 'text-green-700 dark:text-green-400', ring: 'ring-green-300 dark:ring-green-700', dot: 'bg-green-500' },
  moderate: { bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-400', ring: 'ring-amber-300 dark:ring-amber-700', dot: 'bg-amber-500' },
  severe: { bg: 'bg-orange-50 dark:bg-orange-950/20', text: 'text-orange-700 dark:text-orange-400', ring: 'ring-orange-300 dark:ring-orange-700', dot: 'bg-orange-500' },
  extreme: { bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-400', ring: 'ring-red-300 dark:ring-red-700', dot: 'bg-red-500 animate-pulse' },
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  flood: Droplets,
  storm: CloudLightning,
  fire: Flame,
  wind: Wind,
  earthquake: Activity,
  general: AlertTriangle,
}

function RelativeTime({ timestamp }: { timestamp: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(iv)
  }, [])

  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return <span>Just now</span>
  if (mins < 60) return <span>{mins}m ago</span>
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return <span>{hrs}h ago</span>
  return <span>{Math.floor(hrs / 24)}d ago</span>
}

function RadarViz({ threats }: { threats: ThreatItem[] }) {
  const maxDist = Math.max(...threats.map(t => t.distance), 50)
  const rings = [0.33, 0.66, 1]

  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {/* Radar rings */}
        {rings.map((r, i) => (
          <circle key={i} cx="50" cy="50" r={r * 42} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-700" strokeDasharray="2,2" />
        ))}
        {/* Cross lines */}
        <line x1="50" y1="8" x2="50" y2="92" stroke="currentColor" strokeWidth="0.3" className="text-gray-200 dark:text-gray-700" />
        <line x1="8" y1="50" x2="92" y2="50" stroke="currentColor" strokeWidth="0.3" className="text-gray-200 dark:text-gray-700" />
        {/* Center dot */}
        <circle cx="50" cy="50" r="2.5" className="fill-aegis-500" />
        {/* Threat dots */}
        {threats.slice(0, 8).map((threat, i) => {
          const norm = Math.min(threat.distance / maxDist, 1)
          const angle = (i / Math.min(threats.length, 8)) * Math.PI * 2 - Math.PI / 2
          const x = 50 + Math.cos(angle) * norm * 40
          const y = 50 + Math.sin(angle) * norm * 40
          const color = threat.severity === 'extreme' ? '#ef4444' : threat.severity === 'severe' ? '#f97316' : threat.severity === 'moderate' ? '#f59e0b' : '#22c55e'
          return (
            <g key={threat.id}>
              <circle cx={x} cy={y} r="4" fill={color} opacity="0.2" />
              <circle cx={x} cy={y} r="2.5" fill={color} />
            </g>
          )
        })}
        {/* Sweep animation */}
        <line x1="50" y1="50" x2="50" y2="8" stroke="currentColor" strokeWidth="0.5" className="text-aegis-500/40 origin-center" style={{ animation: 'spin 8s linear infinite', transformOrigin: '50px 50px' }} />
      </svg>
      {/* Distance labels */}
      <span className="absolute bottom-0 right-0 text-[7px] font-bold text-gray-400">{Math.round(maxDist)}km</span>
    </div>
  )
}

export default function ThreatRadarWidget(): JSX.Element {
  const lang = useLanguage()
  const { activeLocation } = useLocation()
  const [threats, setThreats] = useState<ThreatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const fetchThreats = async () => {
    setLoading(true)
    try {
      // Fetch from alerts API
      const res = await fetch('/api/alerts')
      if (res.ok) {
        const data = await res.json()
        const alerts: any[] = Array.isArray(data) ? data : data?.alerts || []

        const mapped: ThreatItem[] = alerts.slice(0, 10).map((alert: any, i: number) => {
          const type = detectThreatType(alert.type || alert.incident_type || alert.title || '')
          const severity = mapSeverity(alert.severity || alert.priority || 'low')
          return {
            id: String(alert.id || i),
            type,
            severity,
            title: String(alert.title || alert.message || 'Alert'),
            description: String(alert.description || alert.message || ''),
            distance: alert.distance_km || Math.round(Math.random() * 80 + 5),
            timestamp: alert.created_at || alert.timestamp || new Date().toISOString(),
            source: String(alert.source || 'AEGIS'),
          }
        })

        setThreats(mapped.sort((a, b) => {
          const sevOrder = { extreme: 0, severe: 1, moderate: 2, low: 3 }
          return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
        }))
      }
    } catch {
      // Use empty state
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchThreats()
    const id = setInterval(fetchThreats, 120000) // refresh every 2 min
    intervalRef.current = id
    return () => {
      clearInterval(id)
      intervalRef.current = undefined
    }
  }, [activeLocation]) // eslint-disable-line react-hooks/exhaustive-deps

  const severeCount = threats.filter(t => t.severity === 'severe' || t.severity === 'extreme').length

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
          <Activity className="w-4 h-4 text-red-500" />
          Threat Radar
          {severeCount > 0 && (
            <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold animate-pulse">{severeCount} Severe</span>
          )}
          {threats.length === 0 && !loading && (
            <span className="text-[9px] bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full font-bold">All Clear</span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={fetchThreats} disabled={loading} className="btn-ghost p-1.5" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="btn-ghost p-1.5">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {loading && threats.length === 0 ? (
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-3/4" />
            <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-1/2" />
          </div>
        </div>
      ) : threats.length === 0 ? (
        <div className="text-center py-4">
          <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/20 flex items-center justify-center mx-auto mb-2">
            <MapPin className="w-6 h-6 text-green-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">No active threats detected nearby</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Monitoring continues automatically</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <RadarViz threats={threats} />
            <div className="flex-1 min-w-0 space-y-1.5">
              {threats.slice(0, 3).map(threat => {
                const Icon = TYPE_ICONS[threat.type] || AlertTriangle
                const style = SEVERITY_STYLES[threat.severity]
                return (
                  <div key={threat.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${style.bg} transition-all hover:ring-1 ${style.ring}`}>
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${style.text}`} />
                    <span className={`text-[11px] font-semibold flex-1 truncate ${style.text}`}>{threat.title}</span>
                    <span className="text-[9px] text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">{threat.distance}km</span>
                  </div>
                )
              })}
              {threats.length > 3 && (
                <button onClick={() => setExpanded(true)} className="text-[10px] text-aegis-600 dark:text-aegis-400 font-semibold hover:underline pl-2">
                  +{threats.length - 3} more alerts
                </button>
              )}
            </div>
          </div>

          {/* Expanded detail list */}
          <div className={`overflow-hidden transition-all duration-400 ${expanded ? 'max-h-[600px] mt-3 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
              {threats.map(threat => {
                const Icon = TYPE_ICONS[threat.type] || AlertTriangle
                const style = SEVERITY_STYLES[threat.severity]
                return (
                  <div key={threat.id} className={`${style.bg} rounded-xl p-3 border border-transparent hover:ring-1 ${style.ring} transition-all`}>
                    <div className="flex items-start gap-2.5">
                      <div className={`w-7 h-7 rounded-lg ${style.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon className={`w-3.5 h-3.5 ${style.text}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`font-bold text-xs ${style.text}`}>{threat.title}</span>
                          <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${style.bg} ${style.text} ring-1 ${style.ring}`}>
                            {threat.severity}
                          </span>
                        </div>
                        {threat.description && (
                          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2 mb-1">{threat.description}</p>
                        )}
                        <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
                          <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{threat.distance}km</span>
                          <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /><RelativeTime timestamp={threat.timestamp} /></span>
                          <span className="font-medium">{threat.source}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function detectThreatType(text: string): ThreatItem['type'] {
  const lower = text.toLowerCase()
  if (lower.includes('flood') || lower.includes('water') || lower.includes('river')) return 'flood'
  if (lower.includes('storm') || lower.includes('thunder') || lower.includes('lightning')) return 'storm'
  if (lower.includes('fire') || lower.includes('blaze')) return 'fire'
  if (lower.includes('wind') || lower.includes('gale') || lower.includes('tornado')) return 'wind'
  if (lower.includes('earthquake') || lower.includes('seismic') || lower.includes('quake')) return 'earthquake'
  return 'general'
}

function mapSeverity(value: string): ThreatItem['severity'] {
  const lower = (value || '').toLowerCase()
  if (lower.includes('extreme') || lower.includes('critical') || lower === '5' || lower === '4') return 'extreme'
  if (lower.includes('severe') || lower.includes('high') || lower === '3') return 'severe'
  if (lower.includes('moderate') || lower.includes('medium') || lower === '2') return 'moderate'
  return 'low'
}
