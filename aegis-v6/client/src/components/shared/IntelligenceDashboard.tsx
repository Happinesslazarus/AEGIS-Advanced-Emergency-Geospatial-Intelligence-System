/**
 * IntelligenceDashboard.tsx — Real-Time Flood Intelligence Panel
 *
 * Combines threat level indicator, river gauges, prediction summary,
 * evacuation status, and distress count into a compact dashboard
 * that updates in real-time via Socket.IO.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Shield, AlertTriangle, Droplets, Navigation, Users,
  Activity, TrendingUp, TrendingDown, RefreshCw,
  Radio, Thermometer, ChevronDown, ChevronUp
} from 'lucide-react'

const API = ''

interface ThreatAssessment {
  level: string        // GREEN | AMBER | RED | CRITICAL
  score: number        // 0-100
  description: string
  factors: string[]
  timestamp: string
}

interface RiverSummary {
  stationId: string
  riverName: string
  levelMetres: number
  status: string
  trend: string
}

interface Props {
  socket?: any
  className?: string
  collapsed?: boolean
}

const THREAT_CONFIG: Record<string, { bg: string; border: string; text: string; icon: any; pulse?: boolean }> = {
  CRITICAL: { bg: 'bg-red-900/60',    border: 'border-red-500',  text: 'text-red-400',    icon: AlertTriangle, pulse: true },
  RED:      { bg: 'bg-red-900/40',    border: 'border-red-600',  text: 'text-red-400',    icon: AlertTriangle, pulse: true },
  AMBER:    { bg: 'bg-amber-900/40',  border: 'border-amber-600', text: 'text-amber-400', icon: AlertTriangle },
  GREEN:    { bg: 'bg-green-900/30',  border: 'border-green-700', text: 'text-green-400', icon: Shield },
}

export default function IntelligenceDashboard({ socket, className = '', collapsed: initCollapsed = false }: Props): JSX.Element {
  const [threat, setThreat] = useState<ThreatAssessment | null>(null)
  const [rivers, setRivers] = useState<RiverSummary[]>([])
  const [distressCount, setDistressCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(initCollapsed)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('aegis-token')
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}
      const [threatRes, riverRes, distressRes] = await Promise.all([
        fetch(`${API}/api/incidents/flood/threat`).catch(() => null),
        fetch(`${API}/api/rivers/levels`).catch(() => null),
        fetch(`${API}/api/distress/active`, { headers: authHeaders }).catch(() => null),
      ])

      if (threatRes?.ok) {
        const raw = await threatRes.json()
        // Map API response to ThreatAssessment interface
        const scoreMap: Record<string, number> = { GREEN: 10, AMBER: 45, RED: 70, CRITICAL: 90 }
        const descMap: Record<string, string> = { GREEN: 'All rivers within normal levels', AMBER: 'Elevated levels detected — monitoring', RED: 'High risk — response teams on alert', CRITICAL: 'Severe flooding — evacuations may be required' }
        setThreat({
          level: raw.level || 'GREEN',
          score: scoreMap[raw.level] || 10,
          description: descMap[raw.level] || 'Assessing conditions...',
          factors: raw.reasons || [],
          timestamp: raw.calculatedAt || new Date().toISOString(),
        })
      }

      if (riverRes?.ok) {
        const data = await riverRes.json()
        // API returns "levels" array; map to RiverSummary shape
        const levels = data.levels || data.readings || []
        setRivers(levels.map((r: any) => ({
          stationId: r.stationId || '',
          riverName: r.riverName || r.name || '',
          levelMetres: r.levelMetres ?? r.level ?? 0,
          status: r.status || 'NORMAL',
          trend: r.trend || 'stable',
        })))
      }

      if (distressRes?.ok) {
        const data = await distressRes.json()
        setDistressCount(data.count || 0)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Socket.IO live updates
  useEffect(() => {
    if (!socket) return

    const onThreat = (data: any) => {
      if (data) setThreat(prev => ({ ...prev, ...data }))
    }
    const onRivers = (data: any) => {
      const levels = data?.levels || data?.readings
      if (levels) {
        setRivers(levels.map((r: any) => ({
          stationId: r.stationId || '',
          riverName: r.riverName || r.name || '',
          levelMetres: r.levelMetres ?? r.level ?? 0,
          status: r.status || 'NORMAL',
          trend: r.trend || 'stable',
        })))
      }
    }
    const onDistressNew = () => setDistressCount(prev => prev + 1)
    const onDistressCancelled = () => setDistressCount(prev => Math.max(0, prev - 1))
    const onDistressResolved = () => setDistressCount(prev => Math.max(0, prev - 1))

    socket.on('threat:level_changed', onThreat)
    socket.on('river:levels_updated', onRivers)
    socket.on('distress:new_alert', onDistressNew)
    socket.on('distress:cancelled', onDistressCancelled)
    socket.on('distress:status_changed', (data: any) => {
      if (data.status === 'resolved') onDistressResolved()
    })

    return () => {
      socket.off('threat:level_changed', onThreat)
      socket.off('river:levels_updated', onRivers)
      socket.off('distress:new_alert', onDistressNew)
      socket.off('distress:cancelled', onDistressCancelled)
      socket.off('distress:status_changed')
    }
  }, [socket])

  const threatCfg = THREAT_CONFIG[threat?.level || 'GREEN'] || THREAT_CONFIG.GREEN
  const criticalRivers = rivers.filter(r => r.status === 'CRITICAL' || r.status === 'HIGH').length
  const elevatedRivers = rivers.filter(r => r.status === 'ELEVATED').length

  const TrendIcon = ({ trend }: { trend: string }) => {
    if (trend === 'rising') return <TrendingUp className="w-3 h-3 text-red-400" />
    if (trend === 'falling') return <TrendingDown className="w-3 h-3 text-green-400" />
    return <Activity className="w-3 h-3 text-gray-400" />
  }

  return (
    <div className={`bg-gray-900/95 backdrop-blur-md border border-gray-700/60 rounded-xl shadow-2xl overflow-hidden ${className}`}>
      {/* Threat Level Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full px-4 py-3 flex items-center justify-between transition-colors hover:bg-gray-800/50 ${threatCfg.bg}`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${threat?.level === 'CRITICAL' || threat?.level === 'RED' ? 'bg-red-600' : threat?.level === 'AMBER' ? 'bg-amber-600' : 'bg-green-700'} ${threatCfg.pulse ? 'animate-pulse' : ''}`}>
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Threat Level</h3>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${threat?.level === 'CRITICAL' ? 'bg-red-600 text-white animate-pulse' : threat?.level === 'RED' ? 'bg-red-700 text-white' : threat?.level === 'AMBER' ? 'bg-amber-600 text-black' : 'bg-green-700 text-white'}`}>
                {threat?.level || 'LOADING'}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{threat?.description || 'Assessing...'}</p>
          </div>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
      </button>

      {!collapsed && (
        <div className="border-t border-gray-700/40">
          {/* Score gauge */}
          {threat && (
            <div className="px-4 py-3 border-b border-gray-700/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-400">Threat Score</span>
                <span className="text-xs font-mono font-bold text-white">{threat.score}/100</span>
              </div>
              <div className="w-full h-2.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${threat.score >= 75 ? 'bg-red-500' : threat.score >= 50 ? 'bg-amber-500' : threat.score >= 25 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${threat.score}%` }}
                />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-green-500">Safe</span>
                <span className="text-[9px] text-amber-500">Elevated</span>
                <span className="text-[9px] text-red-500">Critical</span>
              </div>
            </div>
          )}

          {/* Quick stats grid */}
          <div className="px-4 py-3 grid grid-cols-3 gap-2 border-b border-gray-700/30">
            <div className="text-center p-2 bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${criticalRivers > 0 ? 'text-red-400' : 'text-blue-400'}`}>{criticalRivers}</div>
              <div className="text-[9px] text-gray-400 flex items-center justify-center gap-0.5">
                <Droplets className="w-2.5 h-2.5" /> Critical Rivers
              </div>
            </div>
            <div className="text-center p-2 bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${distressCount > 0 ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>{distressCount}</div>
              <div className="text-[9px] text-gray-400 flex items-center justify-center gap-0.5">
                <Radio className="w-2.5 h-2.5" /> Active SOS
              </div>
            </div>
            <div className="text-center p-2 bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${elevatedRivers > 0 ? 'text-amber-400' : 'text-green-400'}`}>{elevatedRivers}</div>
              <div className="text-[9px] text-gray-400 flex items-center justify-center gap-0.5">
                <TrendingUp className="w-2.5 h-2.5" /> Elevated
              </div>
            </div>
          </div>

          {/* River status list */}
          <div className="max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
            {rivers.map(river => (
              <div key={river.stationId} className="px-4 py-2 flex items-center gap-3 border-b border-gray-700/20 last:border-b-0 hover:bg-gray-800/30 transition-colors">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${river.status === 'CRITICAL' ? 'bg-red-500 animate-pulse' : river.status === 'HIGH' ? 'bg-orange-500' : river.status === 'ELEVATED' ? 'bg-amber-400' : 'bg-blue-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{river.riverName}</p>
                </div>
                <TrendIcon trend={river.trend} />
                <span className="text-xs font-mono font-bold text-white">{river.levelMetres?.toFixed(2)}m</span>
              </div>
            ))}
          </div>

          {/* Threat factors */}
          {threat?.factors && threat.factors.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-700/30">
              <p className="text-[10px] font-semibold text-gray-400 mb-1">CONTRIBUTING FACTORS</p>
              <div className="space-y-1">
                {threat.factors.slice(0, 4).map((f, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <span className="text-[10px] text-gray-300">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Refresh */}
          <div className="px-4 py-2 border-t border-gray-700/30 flex justify-center">
            <button onClick={fetchAll} disabled={loading} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh Intelligence
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
