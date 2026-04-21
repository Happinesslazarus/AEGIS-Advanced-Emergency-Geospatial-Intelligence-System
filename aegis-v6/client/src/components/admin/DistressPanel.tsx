/**
 * Distress signal management panel (SOS alerts from citizens).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { useEventCallbacks } from '../../hooks/useEventStream'
import { useSharedSocket } from '../../contexts/SocketContext'
import { getToken } from '../../utils/api'
import {
  Radio, Shield, MapPin, Phone, Clock, AlertTriangle,
  Check, RefreshCw, ChevronDown, ChevronUp,
  Navigation, Loader2, Volume2, VolumeX
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { formatRelativeTime } from '../../utils/i18nUtils'

const API = ''

interface DistressCall {
  id: string
  citizen_id: string
  citizen_name: string
  latitude: number
  longitude: number
  accuracy: number | null
  heading: number | null
  speed: number | null
  message: string | null
  contact_number: string | null
  is_vulnerable: boolean
  status: string         // active | acknowledged | resolved | cancelled
  triage_level: string   // low | medium | high | critical
  acknowledged_by: string | null
  acknowledged_at: string | null
  created_at: string
  last_gps_at: string | null
  //joined data
  phone?: string
  email?: string
  avatar_url?: string
}

interface Props {
  operatorId: string
  operatorName: string
  className?: string
}

const DistressPanel = memo(function DistressPanel({ operatorId, operatorName, className = '' }: Props): JSX.Element {
  const { socket } = useSharedSocket()
  const lang = useLanguage()
  const triageOptions = [
    { value: 'critical', label: 'Critical', colour: 'bg-red-600 text-white' },
    { value: 'high', label: 'High', colour: 'bg-orange-500 text-white' },
    { value: 'medium', label: 'Medium', colour: 'bg-amber-500 text-black' },
    { value: 'low', label: 'Low', colour: 'bg-blue-500 text-white' },
  ]
  const [distressCalls, setDistressCalls] = useState<DistressCall[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [triageValues, setTriageValues] = useState<Record<string, string>>({})
  const [resolutions, setResolutions] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState(false)
  const [alarmEnabled, setAlarmEnabled] = useState(true)
  const [socketError, setSocketError] = useState<string | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const fetchActive = useCallback(async () => {
    setLoading(true)
    try {
      const token = getToken()
      const res = await fetch(`${API}/api/distress/active`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setDistressCalls(data.distressCalls || [])
      }
    } catch (err) {
      console.warn('[DistressPanel] Failed to fetch active distress calls:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchActive() }, [fetchActive])

  //Socket.IO listeners (typed event hook)
  const onNewDistress = (data: { id?: string }) => {
    if (!data?.id) return
    setDistressCalls(prev => prev.find(d => d.id === data.id) ? prev : [data as unknown as DistressCall, ...prev])
    if (alarmEnabled) playAlarm()
  }
  useEventCallbacks({
    'distress:new_alert': onNewDistress,
    'distress:alarm':     onNewDistress,
    'distress:location': (data) => {
      const id = data.distressId
      if (!id) return
      setDistressCalls(prev => prev.map(d =>
        d.id === id
          ? {
              ...d,
              latitude: data.latitude ?? d.latitude,
              longitude: data.longitude ?? d.longitude,
              accuracy: data.accuracy ?? d.accuracy,
              heading: data.heading ?? d.heading,
              speed: data.speed ?? d.speed,
              last_gps_at: (data.timestamp ?? (d as DistressCall & { last_gps_at?: string | null }).last_gps_at ?? null) as string | null,
            } as DistressCall
          : d,
      ))
    },
    'distress:status_changed': (data) => {
      const id = data.distressId
      if (!id) return
      if (data.status === 'resolved' || data.status === 'cancelled') {
        setDistressCalls(prev => prev.filter(d => d.id !== id))
      } else {
        setDistressCalls(prev => prev.map(d => d.id === id ? { ...d, status: String(data.status || d.status) } : d))
      }
    },
    'distress:cancelled': (data) => {
      const id = data.distressId
      if (!id) return
      setDistressCalls(prev => prev.filter(d => d.id !== id))
    },
  })

  //Cleanup AudioContext on unmount
  useEffect(() => {
    return () => { audioCtxRef.current?.close().catch(() => {}) }
  }, [])

  const playAlarm = () => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.4)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.8)
    } catch {}
  }

  const handleAcknowledge = async (distressId: string) => {
    if (!socket) { setSocketError('Socket offline -- cannot connect at this time'); return }
    setSocketError(null)
    socket.emit('distress:acknowledge', { distressId, triageLevel: triageValues[distressId] || 'medium' }, (res: any) => {
      if (res?.success) {
        setDistressCalls(prev => prev.map(d =>
          d.id === distressId ? { ...d, status: 'acknowledged', triage_level: triageValues[distressId] || 'medium', acknowledged_by: operatorId } : d
        ))
      } else {
        setSocketError(res?.error || 'Acknowledge failed -- please try again')
      }
    })
  }

  const handleResolve = async (distressId: string) => {
    if (!socket) { setSocketError('Socket offline -- cannot connect at this time'); return }
    setSocketError(null)
    socket.emit('distress:resolve', { distressId, resolution: (resolutions[distressId] || '').trim() || 'Resolved by operator' }, (res: any) => {
      if (res?.success) {
        setDistressCalls(prev => prev.filter(d => d.id !== distressId))
        setResolutions(prev => { const n = { ...prev }; delete n[distressId]; return n })
        setSelectedId(null)
      } else {
        setSocketError(res?.error || 'Resolve failed -- please try again')
      }
    })
  }


  return (
    <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl shadow-2xl overflow-hidden ${className}`}>
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed) } }}
        className={`w-full px-4 py-3 flex items-center justify-between transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer ${distressCalls.length > 0 ? 'bg-red-100/60 dark:bg-red-900/30' : ''}`}
      >
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${distressCalls.length > 0 ? 'bg-red-600 animate-pulse' : 'bg-gray-300 dark:bg-gray-700'}`}>
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{'Distress Beacon Monitor'}</h3>
            <p className="text-[10px] text-gray-400 dark:text-gray-300">
              {distressCalls.length > 0 ? `${distressCalls.length} ${'Active Beacons'}` : 'No active distress calls'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {distressCalls.length > 0 && (
            <span className="text-xs font-bold text-red-400 animate-pulse">{distressCalls.length} {'Active'}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setAlarmEnabled(!alarmEnabled) }}
            className="p-1 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition"
            title={alarmEnabled ? 'Mute Alarm' : 'Audio Alarm'}
          >
            {alarmEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-300" /> : <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-300" />}
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-gray-200 dark:border-gray-700/40">
          {socketError && (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
              <span className="text-xs text-red-600 dark:text-red-400">{socketError}</span>
              <button onClick={() => setSocketError(null)} className="ml-auto text-red-400 hover:text-red-600" aria-label={'Dismiss'}>x</button>
            </div>
          )}
          {loading && distressCalls.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Loader2 className="w-6 h-6 text-gray-400 dark:text-gray-300 animate-spin mx-auto mb-2" />
              <p className="text-xs text-gray-400 dark:text-gray-300">{'Loading...'}</p>
            </div>
          ) : distressCalls.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Shield className="w-8 h-8 text-green-500/40 mx-auto mb-2" />
              <p className="text-xs text-gray-400 dark:text-gray-300">{'No active distress beacons'}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-1">{'SOS signals from citizens will appear here'}</p>
            </div>
          ) : (
            distressCalls.map(dc => {
              const isSelected = selectedId === dc.id
              const isAcknowledged = dc.status === 'acknowledged'

              return (
                <div key={dc.id} className={`border-b border-gray-100 dark:border-gray-700/20 last:border-b-0 ${dc.is_vulnerable ? 'border-l-2 border-l-red-500' : ''}`}>
                  <button
                    onClick={() => setSelectedId(isSelected ? null : dc.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800/40 transition-colors ${isSelected ? 'bg-gray-100 dark:bg-gray-800/60' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Status indicator */}
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isAcknowledged ? 'bg-amber-500' : 'bg-red-500 animate-pulse'}`} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900 dark:text-white truncate">{dc.citizen_name}</span>
                          {dc.is_vulnerable && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white">{'Vulnerable Person'}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 dark:text-gray-300">{formatRelativeTime(dc.created_at, lang)} -- {dc.latitude.toFixed(4)}, {dc.longitude.toFixed(4)}</p>
                      </div>

                      {/* Triage badge */}
                      {dc.triage_level && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${dc.triage_level === 'critical' ? 'bg-red-600 text-white' : dc.triage_level === 'high' ? 'bg-orange-500 text-white' : dc.triage_level === 'medium' ? 'bg-amber-500 text-black' : 'bg-blue-500 text-white'}`}>
                          {(triageOptions.find((option) => option.value === dc.triage_level)?.label || dc.triage_level).toUpperCase()}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isSelected && (
                    <div className="px-4 pb-3 space-y-3 bg-gray-50 dark:bg-gray-800/20">
                      {/* GPS info */}
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                          <MapPin className="w-3 h-3" />
                          <span>{dc.latitude.toFixed(6)}, {dc.longitude.toFixed(6)}</span>
                        </div>
                        {dc.contact_number && (
                          <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                            <Phone className="w-3 h-3" />
                            <span>{dc.contact_number}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                          <Clock className="w-3 h-3" />
                          <span>{'Last Seen'}: {dc.last_gps_at ? formatRelativeTime(dc.last_gps_at, lang) : 'N/A'}</span>
                        </div>
                        {dc.speed != null && dc.speed > 0 && (
                          <div className="flex items-center gap-1 text-gray-400 dark:text-gray-300">
                            <Navigation className="w-3 h-3" />
                            <span>{(dc.speed * 3.6).toFixed(1)} {'km/h'}</span>
                          </div>
                        )}
                      </div>

                      {dc.message && (
                        <div className="bg-gray-800/40 rounded-lg px-3 py-2 text-xs text-gray-300 dark:text-gray-300">
                          {dc.message}
                        </div>
                      )}

                      {/* Triage selector (for unacknowledged) */}
                      {!isAcknowledged && (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-300 mb-1">{'Triage'}</p>
                          <div className="flex gap-1.5">
                            {triageOptions.map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => setTriageValues(prev => ({ ...prev, [dc.id]: opt.value }))}
                                className={`flex-1 text-[10px] py-1.5 rounded-lg font-medium transition ${(triageValues[dc.id] || 'medium') === opt.value ? opt.colour + ' ring-2 ring-white/30' : 'bg-gray-700 text-gray-300 dark:text-gray-300 hover:bg-gray-600'}`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Resolution input (for acknowledged) */}
                      {isAcknowledged && (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-300 mb-1">{'Resolution Note'}</p>
                          <input
                            type="text"
                            value={resolutions[dc.id] || ''}
                            onChange={e => setResolutions(prev => ({ ...prev, [dc.id]: e.target.value }))}
                            placeholder={'e.g., Citizen evacuated safely'}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-aegis-500"
                          />
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        {!isAcknowledged ? (
                          <button
                            onClick={() => handleAcknowledge(dc.id)}
                            className="flex-1 py-2 bg-amber-600 rounded-lg text-xs font-bold text-white hover:bg-amber-500 transition flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" /> {'Acknowledge'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleResolve(dc.id)}
                            className="flex-1 py-2 bg-green-600 rounded-lg text-xs font-bold text-white hover:bg-green-500 transition flex items-center justify-center gap-1.5"
                          >
                            <Shield className="w-3.5 h-3.5" /> {'Resolve'}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            //Open Google Maps directions
                            window.open(`https://www.google.com/maps/dir/?api=1&destination=${dc.latitude},${dc.longitude}`, '_blank', 'noopener,noreferrer')
                          }}
                          className="px-3 py-2 bg-blue-600 rounded-lg text-xs font-bold text-white hover:bg-blue-500 transition flex items-center gap-1.5"
                        >
                          <Navigation className="w-3.5 h-3.5" /> {'Navigate'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* Refresh */}
          <div className="px-4 py-2 border-t border-gray-700/30 flex justify-center">
            <button onClick={fetchActive} disabled={loading} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {'Refresh'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

DistressPanel.displayName = 'DistressPanel'

export default DistressPanel

