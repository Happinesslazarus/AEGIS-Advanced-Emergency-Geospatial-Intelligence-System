/**
 * FloodPredictionTimeline.tsx — Interactive timeline slider for flood predictions
 *
 * Shows predicted flood extents at 1h, 2h, 4h, 6h horizons.
 * Animates predictions forward/backward with auto-play.
 * Displays confidence levels and affected property counts.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play, Pause, SkipForward, SkipBack, Clock,
  AlertTriangle, Droplets, Home, Users, TrendingUp
} from 'lucide-react'

const API = ''

interface PredictionPoint {
  hoursAhead: number
  predictedLevel: number
  predictedStatus: string
  confidence: number
  affectedProperties?: number
  affectedPeople?: number
  extent?: any
}

interface RiverPrediction {
  stationId: string
  riverName: string
  stationName: string
  currentLevel: number
  currentStatus: string
  predictions: PredictionPoint[]
}

interface Props {
  onTimeChange?: (hoursAhead: number, extents: any[]) => void
  className?: string
}

const STATUS_COLOURS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  ELEVATED: '#eab308',
  NORMAL: '#3b82f6',
}

export default function FloodPredictionTimeline({ onTimeChange, className = '' }: Props): JSX.Element {
  const [predictions, setPredictions] = useState<RiverPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedHour, setSelectedHour] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const timePoints = [0, 1, 2, 4, 6]

  const fetchPredictions = useCallback(async (retries = 2) => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/incidents/flood/prediction`)
      if (res.status === 429 && retries > 0) {
        await new Promise(r => setTimeout(r, 2000))
        return fetchPredictions(retries - 1)
      }
      if (res.ok) {
        const data = await res.json()
        // Map API field names to component interface
        const mapped = (data.predictions || []).map((river: any) => ({
          stationId: river.stationId || '',
          riverName: river.riverName || '',
          stationName: river.riverName || river.stationId || '',
          currentLevel: river.currentLevel ?? 0,
          currentStatus: river.status || river.currentStatus || 'NORMAL',
          predictions: (river.predictions || []).map((p: any) => ({
            hoursAhead: p.hoursAhead ?? p.hours ?? 0,
            predictedLevel: p.predictedLevel ?? p.level ?? 0,
            predictedStatus: p.predictedStatus || p.status || 'NORMAL',
            confidence: p.confidence ?? 0,
            affectedProperties: p.affectedProperties ?? river.estimatedProperties ?? 0,
            affectedPeople: p.affectedPeople ?? river.estimatedPeople ?? 0,
            extent: p.extent || null,
          })),
        }))
        setPredictions(mapped)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchPredictions() }, [fetchPredictions])

  // Auto-play animation
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setSelectedHour(prev => {
          const idx = timePoints.indexOf(prev)
          const next = idx < timePoints.length - 1 ? timePoints[idx + 1] : timePoints[0]
          return next
        })
      }, 2000)
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [isPlaying])

  // Notify parent of time changes
  useEffect(() => {
    if (!onTimeChange) return
    const extents: any[] = []
    for (const river of predictions) {
      const pred = river.predictions?.find(p => p.hoursAhead === selectedHour)
      if (pred?.extent) extents.push(pred.extent)
    }
    onTimeChange(selectedHour, extents)
  }, [selectedHour, predictions, onTimeChange])

  const stepForward = () => {
    const idx = timePoints.indexOf(selectedHour)
    if (idx < timePoints.length - 1) setSelectedHour(timePoints[idx + 1])
  }

  const stepBack = () => {
    const idx = timePoints.indexOf(selectedHour)
    if (idx > 0) setSelectedHour(timePoints[idx - 1])
  }

  // Aggregate stats for selected time
  const currentStats = predictions.reduce((acc, river) => {
    const pred = river.predictions?.find(p => p.hoursAhead === selectedHour) ||
      (selectedHour === 0 ? { predictedLevel: river.currentLevel, predictedStatus: river.currentStatus, confidence: 100, affectedProperties: 0, affectedPeople: 0 } : null)
    if (pred) {
      if (pred.predictedStatus === 'CRITICAL' || pred.predictedStatus === 'HIGH') acc.criticalRivers++
      acc.totalProperties += pred.affectedProperties || 0
      acc.totalPeople += pred.affectedPeople || 0
      acc.avgConfidence += pred.confidence || 0
      acc.rivers++
    }
    return acc
  }, { criticalRivers: 0, totalProperties: 0, totalPeople: 0, avgConfidence: 0, rivers: 0 })

  if (currentStats.rivers > 0) currentStats.avgConfidence = Math.round(currentStats.avgConfidence / currentStats.rivers)

  return (
    <div className={`bg-gray-900/95 backdrop-blur-md border border-gray-700/60 rounded-xl shadow-2xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-700/40 flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-orange-600">
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Flood Prediction</h3>
          <p className="text-[10px] text-gray-400">{predictions.length} river{predictions.length !== 1 ? 's' : ''} monitored</p>
        </div>
      </div>

      {/* Timeline slider */}
      <div className="px-4 py-3 border-b border-gray-700/30">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={stepBack} className="p-1 text-gray-400 hover:text-white transition disabled:opacity-30" disabled={selectedHour === 0}>
            <SkipBack className="w-4 h-4" />
          </button>
          <button onClick={() => setIsPlaying(!isPlaying)} className="p-1.5 bg-blue-600 rounded-lg text-white hover:bg-blue-500 transition">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={stepForward} className="p-1 text-gray-400 hover:text-white transition disabled:opacity-30" disabled={selectedHour === 6}>
            <SkipForward className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <span className="text-sm font-mono font-bold text-white flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {selectedHour === 0 ? 'NOW' : `+${selectedHour}h`}
          </span>
        </div>

        {/* Scrubber */}
        <div className="relative flex items-center">
          <div className="w-full h-1.5 bg-gray-700 rounded-full relative">
            {timePoints.map((tp, i) => {
              const pct = (i / (timePoints.length - 1)) * 100
              const isActive = tp === selectedHour
              return (
                <button
                  key={tp}
                  onClick={() => setSelectedHour(tp)}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                  style={{ left: `${pct}%` }}
                >
                  <div className={`w-3 h-3 rounded-full border-2 transition-all ${isActive ? 'bg-blue-500 border-blue-400 scale-125' : 'bg-gray-600 border-gray-500 hover:bg-gray-500'}`} />
                </button>
              )
            })}
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${(timePoints.indexOf(selectedHour) / (timePoints.length - 1)) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex justify-between mt-1">
          {timePoints.map(tp => (
            <span key={tp} className="text-[9px] text-gray-500">{tp === 0 ? 'Now' : `+${tp}h`}</span>
          ))}
        </div>
      </div>

      {/* Stats summary */}
      <div className="px-4 py-2 grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold text-white">{currentStats.criticalRivers}</div>
          <div className="text-[9px] text-gray-400 flex items-center justify-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> At Risk</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{currentStats.totalProperties.toLocaleString()}</div>
          <div className="text-[9px] text-gray-400 flex items-center justify-center gap-0.5"><Home className="w-2.5 h-2.5" /> Properties</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{currentStats.totalPeople.toLocaleString()}</div>
          <div className="text-[9px] text-gray-400 flex items-center justify-center gap-0.5"><Users className="w-2.5 h-2.5" /> People</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{currentStats.avgConfidence}%</div>
          <div className="text-[9px] text-gray-400">Confidence</div>
        </div>
      </div>

      {/* Per-river breakdown */}
      {!loading && predictions.length > 0 && (
        <div className="border-t border-gray-700/30 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
          {predictions.map(river => {
            const pred = river.predictions?.find(p => p.hoursAhead === selectedHour) ||
              (selectedHour === 0 ? { predictedLevel: river.currentLevel, predictedStatus: river.currentStatus, confidence: 100 } : null)
            if (!pred) return null
            const colour = STATUS_COLOURS[pred.predictedStatus] || '#6b7280'

            return (
              <div key={river.stationId} className="px-4 py-2 flex items-center gap-3 border-b border-gray-700/20 last:border-b-0">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{river.riverName}</p>
                  <p className="text-[10px] text-gray-400">{river.stationName}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-mono font-bold text-white">{pred.predictedLevel?.toFixed(2)}m</div>
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: colour + '30', color: colour }}>
                    {pred.predictedStatus}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {loading && (
        <div className="px-4 py-4 text-center text-xs text-gray-400">
          Loading predictions...
        </div>
      )}
    </div>
  )
}
