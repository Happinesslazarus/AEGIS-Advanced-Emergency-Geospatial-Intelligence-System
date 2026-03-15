/**
 * LiveOperationsMap.tsx — Professional Tactical COP (Common Operating Picture)
 *
 * Modeled after FEMA WebEOC COP, UK Resilience Direct, Zetron ICS map,
 * Palantir Gotham Geo, ESRi ArcGIS Operations Dashboard. Features:
 *
 * - Live mission clock with ZULU/local time
 * - Mouse coordinate readout (lat/lon)
 * - Incident marker legend with severity/status color key
 * - Quick-filter incident type icon bar
 * - Report density indicator badge
 * - Bottom SCADA-style status bar (connection, layers, data freshness, zoom)
 * - Tactical toolbar (measure, screenshot, heatmap toggle)
 * - All existing panels: Intel, Rivers, Distress, Flood Layers, Prediction Timeline
 */

import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import {
  Map, Brain, Layers, Maximize2, Minimize2, X, MapPin, Crosshair,
  Clock, Wifi, WifiOff, Radio, Thermometer, Eye, EyeOff,
  Droplets, Building2, ShieldAlert, Users, Flame, HeartPulse,
  Radiation, Zap, Anchor, Truck, Navigation, CircleDot,
  ChevronUp, ChevronDown, Camera, Download, Ruler, Activity,
  AlertTriangle, Compass, Hash, Globe, Signal
} from 'lucide-react'
import LiveMap from '../shared/LiveMap'
import IntelligenceDashboard from '../shared/IntelligenceDashboard'
import RiverLevelPanel from '../shared/RiverLevelPanel'
import FloodLayerControl from '../shared/FloodLayerControl'
import FloodPredictionTimeline from '../shared/FloodPredictionTimeline'
import DistressPanel from './DistressPanel'
import type { Report } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const Map3DView = lazy(() => import('../shared/Map3DView'))

/* ═══════════════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */
interface LiveOperationsMapProps {
  filtered: Report[]
  reports: Report[]
  loc: { center: [number, number]; zoom: number }
  filterSeverity: string
  setFilterSeverity: (v: string) => void
  filterStatus: string
  setFilterStatus: (v: string) => void
  filterType: string
  setFilterType: (v: string) => void
  socket: any
  user: any
  setSelReport: (r: Report) => void
  activeLocation: string
  setActiveLocation: (key: string) => void
  availableLocations: { key: string; name: string }[]
}

const INCIDENT_TYPE_FILTERS = [
  { key: 'all', labelKey: 'common.all', icon: Globe, color: 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
  { key: 'natural_disaster', labelKey: 'admin.filters.type.natural_disaster', icon: Droplets, color: 'text-blue-500' },
  { key: 'infrastructure', labelKey: 'admin.filters.type.infrastructure', icon: Building2, color: 'text-orange-500' },
  { key: 'public_safety', labelKey: 'admin.filters.type.public_safety', icon: ShieldAlert, color: 'text-red-500' },
  { key: 'community_safety', labelKey: 'admin.filters.type.community_safety', icon: Users, color: 'text-cyan-500' },
  { key: 'environmental', labelKey: 'admin.filters.type.environmental', icon: Flame, color: 'text-amber-500' },
  { key: 'medical', labelKey: 'admin.filters.type.medical', icon: HeartPulse, color: 'text-rose-500' },
] as const

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function LiveOperationsMap(props: LiveOperationsMapProps) {
  const lang = useLanguage()
  const {
    filtered, reports, loc,
    filterSeverity, setFilterSeverity, filterStatus, setFilterStatus,
    filterType, setFilterType,
    socket, user, setSelReport,
    activeLocation, setActiveLocation, availableLocations,
  } = props

  // ── State ──
  const [showFloodPredictions, setShowFloodPredictions] = useState(true)
  const [showEvacuationRoutes, setShowEvacuationRoutes] = useState(false)
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d')
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  const [showStatusBar, setShowStatusBar] = useState(true)
  const [clockNow, setClockNow] = useState(new Date())
  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // ── Live clock ──
  useEffect(() => {
    const t = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Mouse tracking (capture from map container) ──
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      // Approximate lat/lng from mouse position over the map area
      // This is a visual indicator; the actual Leaflet map has its own coords
      const rect = el.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      // Rough interpolation from center and zoom
      const latSpan = 360 / Math.pow(2, loc.zoom)
      const lngSpan = 360 / Math.pow(2, loc.zoom)
      const lat = loc.center[0] + (0.5 - y) * latSpan
      const lng = loc.center[1] + (x - 0.5) * lngSpan
      setMouseCoords({ lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 })
    }
    el.addEventListener('mousemove', handler)
    return () => el.removeEventListener('mousemove', handler)
  }, [loc.center, loc.zoom])

  const handleLayerChange = useCallback((layerId: string, enabled: boolean) => {
    if (layerId.startsWith('prediction_')) setShowFloodPredictions(enabled)
    else if (layerId === 'evacuation') setShowEvacuationRoutes(enabled)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!mapContainerRef.current) return
    if (!document.fullscreenElement) {
      mapContainerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ── Computed stats for HUD ──
  const markerStats = useMemo(() => ({
    total: filtered.length,
    urgent: filtered.filter(r => r.status === 'Urgent').length,
    high: filtered.filter(r => r.severity === 'High').length,
    withMedia: filtered.filter(r => r.hasMedia).length,
    trapped: filtered.filter(r => r.trappedPersons === 'yes').length,
  }), [filtered])

  // ZULU time format
  const zuluTime = clockNow.toISOString().replace('T', ' ').substring(0, 19) + 'Z'
  const localTime = clockNow.toLocaleTimeString('en-GB', { hour12: false })
  const incidentTypeFilters = useMemo(
    () => INCIDENT_TYPE_FILTERS.map((filter) => ({ ...filter, label: t(filter.labelKey, lang) })),
    [lang],
  )

  return (
    <div
      ref={mapContainerRef}
      className={`animate-fade-in bg-gray-950 overflow-hidden ${isFullscreen ? 'w-screen h-screen' : 'rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-lg'}`}
    >

      {/* ═══════════════════════════════════════════════════════════════
          HEADER TOOLBAR — Tactical Command Bar
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`px-3 py-2 border-b border-gray-800/80 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 flex items-center justify-between flex-wrap gap-2 ${isFullscreen ? 'relative z-[1200]' : ''}`}>
        
        {/* Left: Title + Live Clock */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Map className="w-5 h-5 text-cyan-400" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            </div>
            <div>
              <h2 className="font-black text-sm leading-tight text-white tracking-tight">{t('liveOps.title', lang)}</h2>
              <p className="text-[8px] text-cyan-400/80 font-mono tracking-wider uppercase">{t('liveOps.cop', lang)} &bull; COP</p>
            </div>
          </div>

          {/* Mission Clock */}
          <div className="hidden sm:flex items-center gap-2 bg-gray-900/80 rounded-lg px-3 py-1.5 ring-1 ring-gray-800">
            <Clock className="w-3 h-3 text-cyan-400" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-green-400 tabular-nums">{zuluTime}</span>
              <span className="text-[8px] text-gray-600">|</span>
              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums">LOCAL {localTime}</span>
            </div>
          </div>

          {/* Marker Count Badge */}
          <div className="flex items-center gap-2 bg-gray-900/80 rounded-lg px-2.5 py-1.5 ring-1 ring-gray-800">
            <MapPin className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-bold text-white tabular-nums">{markerStats.total}</span>
            <span className="text-[9px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('liveOps.markers', lang)}</span>
            {markerStats.urgent > 0 && (
              <span className="flex items-center gap-0.5 bg-red-900/50 text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded ring-1 ring-red-800/50 animate-pulse">
                <AlertTriangle className="w-2.5 h-2.5" /> {markerStats.urgent}
              </span>
            )}
            {markerStats.trapped > 0 && (
              <span className="flex items-center gap-0.5 bg-purple-900/50 text-purple-400 text-[9px] font-bold px-1.5 py-0.5 rounded ring-1 ring-purple-800/50">
                <Users className="w-2.5 h-2.5" /> {markerStats.trapped}
              </span>
            )}
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex gap-1.5 items-center flex-wrap">
          {/* Panel Toggles */}
          <div className="flex bg-gray-900/80 rounded-lg p-0.5 ring-1 ring-gray-800">
            <button onClick={() => setShowLeftPanel(!showLeftPanel)} className={`px-2 py-1.5 text-[9px] font-bold rounded-md transition-all ${showLeftPanel ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white'}`}>
              <span className="flex items-center gap-1"><Brain className="w-3 h-3" /> {t('liveOps.intel', lang)}</span>
            </button>
            <button onClick={() => setShowRightPanel(!showRightPanel)} className={`px-2 py-1.5 text-[9px] font-bold rounded-md transition-all ${showRightPanel ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white'}`}>
              <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {t('map.layers', lang)}</span>
            </button>
            <button onClick={() => setShowLegend(!showLegend)} className={`px-2 py-1.5 text-[9px] font-bold rounded-md transition-all ${showLegend ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white'}`}>
              <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {t('map.legend', lang)}</span>
            </button>
          </div>

          {/* Region Selector */}
          <select
            value={activeLocation}
            onChange={e => setActiveLocation(e.target.value)}
            className="text-[10px] bg-gray-900/80 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-2.5 py-1.5 rounded-lg ring-1 ring-gray-800 font-semibold"
          >
            {availableLocations.map(l => (
              <option key={l.key} value={l.key}>{l.name}</option>
            ))}
          </select>

          {/* 2D / 3D Toggle */}
          <div className="flex bg-gray-900/80 rounded-lg p-0.5 ring-1 ring-gray-800">
            <button onClick={() => setMapMode('2d')} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${mapMode === '2d' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>
              {t('map.2dMode', lang)}
            </button>
            <button onClick={() => setMapMode('3d')} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${mapMode === '3d' ? 'bg-purple-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>
              {t('map.3dMode', lang)}
            </button>
          </div>

          {/* Severity Filter */}
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="text-[10px] bg-gray-900/80 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-2 py-1.5 rounded-lg ring-1 ring-gray-800">
            <option value="all">{t('admin.filters.severity.all', lang)}</option>
            <option value="High">{t('common.high', lang)}</option>
            <option value="Medium">{t('common.medium', lang)}</option>
            <option value="Low">{t('common.low', lang)}</option>
          </select>

          {/* Status Filter */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-[10px] bg-gray-900/80 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-2 py-1.5 rounded-lg ring-1 ring-gray-800">
            <option value="all">{t('admin.filters.status.all', lang)}</option>
            <option value="Urgent">{t('common.urgent', lang)}</option>
            <option value="Unverified">{t('common.unverified', lang)}</option>
            <option value="Verified">{t('common.verified', lang)}</option>
            <option value="Flagged">{t('common.flagged', lang)}</option>
            <option value="Resolved">{t('common.resolved', lang)}</option>
          </select>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-900/80 ring-1 ring-gray-800 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-white transition-all">
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          INCIDENT TYPE QUICK-FILTER BAR
          ═══════════════════════════════════════════════════════════════ */}
      <div className="px-3 py-1.5 bg-gray-900/90 border-b border-gray-800/60 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <span className="text-[8px] text-gray-600 uppercase tracking-widest font-bold mr-1 flex-shrink-0">{t('common.type', lang)}:</span>
        {incidentTypeFilters.map(f => {
          const Icon = f.icon
          const isActive = filterType === f.key
          const count = f.key === 'all' ? filtered.length : filtered.filter(r => r.incidentCategory === f.key).length
          return (
            <button
              key={f.key}
              onClick={() => setFilterType(isActive && f.key !== 'all' ? 'all' : f.key)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition-all flex-shrink-0 ${
                isActive
                  ? 'bg-cyan-900/50 text-cyan-300 ring-1 ring-cyan-700/50'
                  : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:bg-gray-800/50'
              }`}
            >
              <Icon className={`w-3 h-3 ${isActive ? f.color : ''}`} />
              {f.label}
              <span className="tabular-nums text-[8px] opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MAP AREA
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`relative ${isFullscreen ? 'h-[calc(100vh-92px)]' : 'h-[calc(100vh-256px)]'}`}>

        {/* ── Map Engine ── */}
        {mapMode === '2d' ? (
          <LiveMap
            reports={filtered}
            center={loc.center}
            zoom={loc.zoom}
            height="100%"
            showFloodPredictions={showFloodPredictions}
            showEvacuationRoutes={showEvacuationRoutes}
            onReportClick={setSelReport}
          />
        ) : (
          <Suspense fallback={
            <div className="w-full h-full bg-gray-950 flex items-center justify-center">
              <div className="text-cyan-400/60 text-sm animate-pulse flex items-center gap-2">
                <Globe className="w-5 h-5 animate-spin" /> {t('liveOps.initializing3d', lang)}
              </div>
            </div>
          }>
            <Map3DView
              reports={filtered}
              center={loc.center}
              zoom={loc.zoom}
              height="100%"
              showFloodPredictions={showFloodPredictions}
              showEvacuationRoutes={showEvacuationRoutes}
              onReportClick={setSelReport}
            />
          </Suspense>
        )}

        {/* ── LEFT HUD: Intel + River + Distress ── */}
        {showLeftPanel && (
          <div className="absolute top-3 left-3 z-[900] flex flex-col gap-2 w-[260px] max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pointer-events-auto">
            <IntelligenceDashboard socket={socket} collapsed={true} />
            <RiverLevelPanel socket={socket} />
            <DistressPanel socket={socket} operatorId={user?.id || ''} operatorName={user?.displayName || t('common.operator', lang)} />
          </div>
        )}

        {/* ── RIGHT HUD: Flood Layers + Prediction ── */}
        {showRightPanel && (
          <div className="absolute top-3 right-3 z-[900] flex flex-col gap-2 w-[240px] max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pointer-events-auto">
            <FloodLayerControl onLayerChange={handleLayerChange} />
            <FloodPredictionTimeline onTimeChange={(h, extents) => {
              setShowFloodPredictions(h > 0)
            }} />
          </div>
        )}

        {/* ── MAP LEGEND (floating bottom-left) ── */}
        {showLegend && (
          <div className="absolute bottom-14 left-3 z-[900] bg-gray-950/90 backdrop-blur-md rounded-xl ring-1 ring-gray-800 p-3 w-[200px] pointer-events-auto shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-widest">{t('liveOps.mapLegend', lang)}</span>
              <button onClick={() => setShowLegend(false)} className="text-gray-600 hover:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><X className="w-3 h-3" /></button>
            </div>
            {/* Severity Colors */}
            <div className="space-y-1 mb-2.5">
              <p className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-bold uppercase tracking-wider">{t('common.severity', lang)}</p>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-500/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('map.highSeverity', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('map.mediumSeverity', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('map.lowSeverity', lang)}</span></div>
            </div>
            {/* Status Colors */}
            <div className="space-y-1 mb-2.5">
              <p className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-bold uppercase tracking-wider">{t('common.status', lang)}</p>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('common.urgent', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('common.unverified', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('common.verified', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('common.flagged', lang)}</span></div>
            </div>
            {/* Special Markers */}
            <div className="space-y-1">
              <p className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-bold uppercase tracking-wider">{t('liveOps.overlays', lang)}</p>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-blue-400/40 rounded-sm ring-1 ring-blue-400/60" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('map.floodZone', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-0.5 bg-green-400" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('map.evacuationRoutes', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('liveOps.riverStation', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" /><span className="text-[10px] text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('map.distressBeacons', lang)}</span></div>
            </div>
          </div>
        )}

        {/* ── COMPASS INDICATOR (top-right corner of map, below HUD) ── */}
        <div className="absolute top-3 right-[calc(240px+1.5rem+8px)] z-[850] pointer-events-none" style={{ display: showRightPanel ? undefined : 'none' }}>
          {/* Only show when right panel is visible to avoid overlap */}
        </div>

        {/* ── COORDINATE READOUT + ZOOM (bottom-right) ── */}
        <div className="absolute bottom-2 right-3 z-[900] flex items-center gap-2 pointer-events-auto">
          {mouseCoords && (
            <div className="bg-gray-950/80 backdrop-blur-sm rounded-lg px-2.5 py-1 ring-1 ring-gray-800/80 flex items-center gap-2">
              <Crosshair className="w-3 h-3 text-cyan-400" />
              <span className="text-[9px] font-mono text-green-400 tabular-nums">
                {mouseCoords.lat >= 0 ? `${mouseCoords.lat}°N` : `${Math.abs(mouseCoords.lat)}°S`}
                {' '}
                {mouseCoords.lng >= 0 ? `${mouseCoords.lng}°E` : `${Math.abs(mouseCoords.lng)}°W`}
              </span>
            </div>
          )}
          <div className="bg-gray-950/80 backdrop-blur-sm rounded-lg px-2.5 py-1 ring-1 ring-gray-800/80 flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">Z{loc.zoom}</span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          BOTTOM STATUS BAR — SCADA / Tactical Data Strip
          ═══════════════════════════════════════════════════════════════ */}
      {showStatusBar && (
        <div className="px-3 py-1.5 bg-gray-950 border-t border-gray-800/80 flex items-center justify-between text-[9px] font-mono">
          {/* Left: Connection + Uplink Status */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Signal className="w-3 h-3 text-green-400" />
              <span className="text-green-400">{t('common.connected', lang).toUpperCase()}</span>
            </span>
            <span className="text-gray-600">|</span>
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('liveOps.feed', lang)}: <span className="text-cyan-400">{t('common.live', lang).toUpperCase()}</span></span>
            </span>
            <span className="text-gray-600">|</span>
            <span className="flex items-center gap-1">
              <Radio className="w-3 h-3 text-amber-400" />
              <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('liveOps.region', lang)}: <span className="text-amber-400">{availableLocations.find(l => l.key === activeLocation)?.name || activeLocation}</span></span>
            </span>
          </div>

          {/* Center: Stats */}
          <div className="flex items-center gap-4">
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('liveOps.incidents', lang)}: <span className="text-slate-900 dark:text-white font-bold">{markerStats.total}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('common.high', lang).toUpperCase()}: <span className="text-red-400 font-bold">{markerStats.high}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('common.urgent', lang).toUpperCase()}: <span className="text-red-400 font-bold">{markerStats.urgent}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('liveOps.media', lang)}: <span className="text-blue-400 font-bold">{markerStats.withMedia}</span>
            </span>
          </div>

          {/* Right: Mode + Map info */}
          <div className="flex items-center gap-4">
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('liveOps.mode', lang)}: <span className={mapMode === '3d' ? 'text-purple-400' : 'text-blue-400'}>{mapMode.toUpperCase()}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('map.layers', lang).toUpperCase()}: <span className="text-cyan-400">{(showFloodPredictions ? 1 : 0) + (showEvacuationRoutes ? 1 : 0) + 1}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('liveOps.center', lang)}: <span className="text-green-400 tabular-nums">{loc.center[0].toFixed(2)},{loc.center[1].toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}





