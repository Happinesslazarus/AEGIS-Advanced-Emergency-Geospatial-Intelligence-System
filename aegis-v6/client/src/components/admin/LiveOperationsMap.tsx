/**
 * Live operations map (real-time geospatial situational awareness).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense, memo } from 'react'
import {
  Map, Brain, Layers, Maximize2, Minimize2, X, MapPin, Crosshair,
  Clock, Radio, Eye,
  Droplets, Building2, ShieldAlert, Users, Flame, HeartPulse, Camera, Download, Activity,
  AlertTriangle, Hash, Globe, Signal,
  Target, BellRing, Shield, Gauge, RefreshCw,
  ScanLine, ChevronRight, Copy, Siren} from 'lucide-react'
const LiveMap = lazy(() => import('../shared/LiveMap'))
import IntelligenceDashboard from '../shared/IntelligenceDashboard'
import RiverLevelPanel from '../shared/RiverLevelPanel'
import FloodLayerControl from '../shared/FloodLayerControl'
import FloodPredictionTimeline from '../shared/FloodPredictionTimeline'
import DistressPanel from './DistressPanel'
import LocationDropdown from '../shared/LocationDropdown'
import type { Report } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const Map3DView = lazy(() => import('../shared/Map3DView'))

//TYPES & CONSTANTS
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
  { key: 'all', labelKey: 'common.all', icon: Globe, color: 'text-gray-500 dark:text-gray-300' },
  { key: 'natural_disaster', labelKey: 'admin.filters.type.natural_disaster', icon: Droplets, color: 'text-blue-500' },
  { key: 'infrastructure', labelKey: 'admin.filters.type.infrastructure', icon: Building2, color: 'text-orange-500' },
  { key: 'public_safety', labelKey: 'admin.filters.type.public_safety', icon: ShieldAlert, color: 'text-red-500' },
  { key: 'community_safety', labelKey: 'admin.filters.type.community_safety', icon: Users, color: 'text-cyan-500' },
  { key: 'environmental', labelKey: 'admin.filters.type.environmental', icon: Flame, color: 'text-amber-500' },
  { key: 'medical', labelKey: 'admin.filters.type.medical', icon: HeartPulse, color: 'text-rose-500' },
] as const

const LiveOperationsMap = memo(function LiveOperationsMap(props: LiveOperationsMapProps) {
  const lang = useLanguage()
  const {
    filtered, reports, loc,
    filterSeverity, setFilterSeverity, filterStatus, setFilterStatus,
    filterType, setFilterType,
    socket, user, setSelReport,
    activeLocation, setActiveLocation, availableLocations,
  } = props

  // State
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
  const [showQuickActions, setShowQuickActions] = useState(false)
  const quickActionsRef = useRef<HTMLDivElement>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [recentReports, setRecentReports] = useState<Report[]>([])
  const [showThreatBanner, setShowThreatBanner] = useState(true)
  const [uplinkPulse] = useState(0) // kept for ref; animation now pure CSS
  const mapContainerRef = useRef<HTMLDivElement>(null)

  //Exit fullscreen when selecting a report so the detail modal is visible
  const handleReportClick = useCallback((r: Report) => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().then(() => { setIsFullscreen(false); setSelReport(r) }).catch(() => setSelReport(r))
    } else {
      setSelReport(r)
    }
  }, [setSelReport])

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  //Uplink pulse animation now handled by CSS @keyframes -- no state updates needed

  //Close Quick Actions on outside click
  useEffect(() => {
    if (!showQuickActions) return
    const handler = (e: MouseEvent) => {
      if (quickActionsRef.current && !quickActionsRef.current.contains(e.target as Node)) {
        setShowQuickActions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showQuickActions])

  //Track recently added reports (last 5 minutes) for the real-time feed badge
  const prevReportsRef = useRef<Set<string | number>>(new Set())
  useEffect(() => {
    const currentIds = new Set(reports.map(r => r.id))
    const newReports = reports.filter(r => !prevReportsRef.current.has(r.id))
    if (newReports.length > 0 && prevReportsRef.current.size > 0) {
      setRecentReports(prev => [...newReports, ...prev].slice(0, 5))
      setLastRefresh(new Date())
    }
    prevReportsRef.current = currentIds
  }, [reports])

  //Auto-dismiss recent report toasts after 8s
  useEffect(() => {
    if (recentReports.length === 0) return
    const t = setTimeout(() => setRecentReports(prev => prev.slice(0, -1)), 8000)
    return () => clearTimeout(t)
  }, [recentReports])

  // Mouse tracking (capture from map container -- throttled via rAF)
  const mouseCoordsRef = useRef<{ lat: number; lng: number } | null>(null)
  const rafRef = useRef<number>(0)
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const rect = el.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width
        const y = (e.clientY - rect.top) / rect.height
        const latSpan = 360 / Math.pow(2, loc.zoom)
        const lngSpan = 360 / Math.pow(2, loc.zoom)
        const lat = loc.center[0] + (0.5 - y) * latSpan
        const lng = loc.center[1] + (x - 0.5) * lngSpan
        const coords = { lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 }
        mouseCoordsRef.current = coords
        setMouseCoords(coords)
      })
    }
    el.addEventListener('mousemove', handler)
    return () => {
      el.removeEventListener('mousemove', handler)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
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

  //Keyboard shortcuts
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const kbHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'f') { e.preventDefault(); toggleFullscreen() }
      else if (key === 'l') { e.preventDefault(); setShowLegend(p => !p) }
      else if (key === 'p') { e.preventDefault(); setShowFloodPredictions(p => !p) }
      else if (key === 'e') { e.preventDefault(); setShowEvacuationRoutes(p => !p) }
      else if (key === 'b') { e.preventDefault(); setShowStatusBar(p => !p) }
      else if (key === 'q') { e.preventDefault(); setShowQuickActions(p => !p) }
      else if (key === 's' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); handleScreenshot() }
      else if (key === 'd' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); handleExportData() }
      else if (key === '2') { e.preventDefault(); setMapMode('2d') }
      else if (key === '3') { e.preventDefault(); setMapMode('3d') }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', kbHandler)
    return () => document.removeEventListener('keydown', kbHandler)
  }, [toggleFullscreen])

  // Computed stats for HUD
  const markerStats = useMemo(() => ({
    total: filtered.length,
    urgent: filtered.filter(r => r.status === 'Urgent').length,
    high: filtered.filter(r => r.severity === 'High').length,
    medium: filtered.filter(r => r.severity === 'Medium').length,
    low: filtered.filter(r => r.severity === 'Low').length,
    withMedia: filtered.filter(r => r.hasMedia).length,
    trapped: filtered.filter(r => r.trappedPersons === 'yes').length,
    verified: filtered.filter(r => r.status === 'Verified').length,
    unverified: filtered.filter(r => r.status === 'Unverified').length,
  }), [filtered])

  //Threat level computation (DEFCON-style based on report severity distribution)
  const threatLevel = useMemo(() => {
    const h = markerStats.high
    const u = markerStats.urgent
    const t = markerStats.trapped
    if (t > 0 || u >= 5 || h >= 10) return { level: 'CRITICAL', color: 'text-red-400', bg: 'bg-red-900/60', ring: 'ring-red-500/50', glow: 'shadow-red-500/30', icon: Siren }
    if (u >= 2 || h >= 5) return { level: 'HIGH', color: 'text-orange-400', bg: 'bg-orange-900/60', ring: 'ring-orange-500/50', glow: 'shadow-orange-500/20', icon: AlertTriangle }
    if (h >= 1 || markerStats.medium >= 5) return { level: 'ELEVATED', color: 'text-amber-400', bg: 'bg-amber-900/60', ring: 'ring-amber-500/50', glow: 'shadow-amber-500/20', icon: Shield }
    if (markerStats.total > 0) return { level: 'GUARDED', color: 'text-blue-400', bg: 'bg-blue-900/60', ring: 'ring-blue-500/50', glow: 'shadow-blue-500/20', icon: Eye }
    return { level: 'NOMINAL', color: 'text-green-400', bg: 'bg-green-900/60', ring: 'ring-green-500/50', glow: 'shadow-green-500/20', icon: Shield }
  }, [markerStats])

  const threatLabelMap: Record<string, string> = {
    CRITICAL: t('liveOps.threatCritical', lang),
    HIGH: t('liveOps.threatHigh', lang),
    ELEVATED: t('liveOps.threatElevated', lang),
    GUARDED: t('liveOps.threatGuarded', lang),
    NOMINAL: t('liveOps.threatNominal', lang),
  }

  //Data freshness computation
  const dataFreshness = useMemo(() => {
    const ageMs = clockNow.getTime() - lastRefresh.getTime()
    const ageSec = Math.floor(ageMs / 1000)
    if (ageSec < 60) return { label: `${ageSec}s`, fresh: true }
    if (ageSec < 300) return { label: `${Math.floor(ageSec / 60)}m`, fresh: true }
    return { label: `${Math.floor(ageSec / 60)}m`, fresh: false }
  }, [clockNow, lastRefresh])

  //Screenshot handler -- html2canvas capture
  const handleScreenshot = useCallback(async () => {
    if (!mapContainerRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(mapContainerRef.current, { useCORS: true, scale: 2, logging: false })
      const link = document.createElement('a')
      link.download = `aegis-cop-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch {
      window.print()
    }
  }, [])

  //Export data handler
  const handleExportData = useCallback(() => {
    const data = {
      exported: new Date().toISOString(),
      region: availableLocations.find(l => l.key === activeLocation)?.name || activeLocation,
      total: filtered.length,
      reports: filtered.map(r => ({
        id: r.id, title: r.type || r.location, severity: r.severity, status: r.status,
        location: r.location, latitude: r.coordinates?.[0] ?? null, longitude: r.coordinates?.[1] ?? null,
        type: r.type, category: r.incidentCategory,
      })),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.download = `aegis-reports-${new Date().toISOString().slice(0, 10)}.json`
    link.href = URL.createObjectURL(blob)
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }, [filtered, activeLocation, availableLocations])

  //ZULU time format
  const zuluTime = clockNow.toISOString().replace('T', ' ').substring(0, 19) + 'Z'
  const localTime = clockNow.toLocaleTimeString('en-GB', { hour12: false })
  const incidentTypeFilters = useMemo(
    () => INCIDENT_TYPE_FILTERS.map((filter) => ({ ...filter, label: t(filter.labelKey, lang) })),
    [lang],
  )

  return (
    <div
      ref={mapContainerRef}
      className={`animate-fade-in bg-gray-950 overflow-hidden isolate ${isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen' : 'rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-lg relative z-0'}`}
    >

      {/*
          HEADER TOOLBAR -- Tactical Command Bar
           */}
      <div className={`px-3 py-2 border-b border-gray-800/80 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 flex items-center justify-between flex-wrap gap-2 relative z-[1200]`}>

        {/* Left: Title + Threat Level + Live Clock */}
        <div className="flex items-center gap-3">
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

          {/* Threat Level Indicator -- DEFCON-style */}
          {showThreatBanner && (
            <div className={`hidden sm:flex items-center gap-1.5 ${threatLevel.bg} rounded-lg px-2.5 py-1 ring-1 ${threatLevel.ring} shadow-lg ${threatLevel.glow} transition-all duration-500`}>
              <threatLevel.icon className={`w-3.5 h-3.5 ${threatLevel.color} ${threatLevel.level === 'CRITICAL' ? 'animate-pulse' : ''}`} />
              <div className="flex flex-col">
                <span className={`text-[8px] font-mono uppercase tracking-widest ${threatLevel.color} font-black leading-none`}>{threatLabelMap[threatLevel.level] || threatLevel.level}</span>
                <span className="text-[7px] text-gray-500 leading-none mt-0.5">{t('liveOps.threat', lang)}</span>
              </div>
            </div>
          )}

          {/* Mission Clock */}
          <div className="hidden sm:flex items-center gap-2 bg-gray-900/80 rounded-lg px-3 py-1.5 ring-1 ring-gray-800">
            <Clock className="w-3 h-3 text-cyan-400" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-green-400 tabular-nums">{zuluTime}</span>
              <span className="text-[8px] text-gray-600">|</span>
              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-300 tabular-nums">{t('liveOps.local', lang)} {localTime}</span>
            </div>
          </div>

          {/* Marker Count + Severity Breakdown Badge */}
          <div className="flex items-center gap-2 bg-gray-900/80 rounded-lg px-2.5 py-1.5 ring-1 ring-gray-800">
            <MapPin className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-bold text-white tabular-nums">{markerStats.total}</span>
            <span className="text-[9px] text-gray-500 dark:text-gray-300">{t('liveOps.markers', lang)}</span>
            {/* Severity mini-bar */}
            {markerStats.total > 0 && (
              <div className="hidden md:flex items-center gap-0.5 ml-1">
                {markerStats.high > 0 && <span className="bg-red-500/80 text-white text-[8px] font-bold px-1 py-0.5 rounded tabular-nums">{markerStats.high}</span>}
                {markerStats.medium > 0 && <span className="bg-amber-500/80 text-white text-[8px] font-bold px-1 py-0.5 rounded tabular-nums">{markerStats.medium}</span>}
                {markerStats.low > 0 && <span className="bg-blue-500/80 text-white text-[8px] font-bold px-1 py-0.5 rounded tabular-nums">{markerStats.low}</span>}
              </div>
            )}
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

          {/* Data Freshness Indicator */}
          <div className="hidden lg:flex items-center gap-1.5 bg-gray-900/80 rounded-lg px-2 py-1.5 ring-1 ring-gray-800">
            <div className="relative">
              <RefreshCw className={`w-3 h-3 ${dataFreshness.fresh ? 'text-green-400' : 'text-amber-400'}`} />
              {dataFreshness.fresh && <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-400 rounded-full animate-ping" />}
            </div>
            <span className={`text-[9px] font-mono tabular-nums ${dataFreshness.fresh ? 'text-green-400' : 'text-amber-400'}`}>{dataFreshness.label}</span>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex gap-1.5 items-center flex-wrap">
          {/* Quick Actions */}
          <div className="relative" ref={quickActionsRef}>
            <button onClick={() => setShowQuickActions(!showQuickActions)} className={`p-1.5 rounded-lg transition-all ring-1 ring-gray-800 ${showQuickActions ? 'bg-cyan-600 text-white' : 'bg-gray-900/80 text-gray-400 dark:text-gray-300 hover:text-white'}`} title={t('liveOps.quickActions', lang)}>
              <Target className="w-3.5 h-3.5" />
            </button>
            {showQuickActions && (
              <div className="absolute top-full right-0 mt-1 bg-gray-900/95 backdrop-blur-md rounded-lg ring-1 ring-gray-700 p-1.5 z-[1100] shadow-xl min-w-[140px]">
                <button onClick={() => { handleScreenshot(); setShowQuickActions(false) }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-all font-medium">
                  <Camera className="w-3.5 h-3.5 text-cyan-400" /> {t('liveOps.screenshot', lang)}
                </button>
                <button onClick={() => { handleExportData(); setShowQuickActions(false) }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-all font-medium">
                  <Download className="w-3.5 h-3.5 text-green-400" /> {t('liveOps.exportData', lang)}
                </button>
                <div className="h-px bg-gray-700/60 my-1" />
                <button onClick={() => { setShowThreatBanner(b => !b); setShowQuickActions(false) }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-all font-medium">
                  <Shield className="w-3.5 h-3.5 text-amber-400" /> {showThreatBanner ? t('liveOps.hideThreat', lang) : t('liveOps.showThreat', lang)}
                </button>
              </div>
            )}
          </div>

          {/* Panel Toggles */}
          <div className="flex bg-gray-900/80 rounded-lg p-0.5 ring-1 ring-gray-800">
            <button onClick={() => setShowLeftPanel(!showLeftPanel)} className={`px-2 py-1.5 text-[9px] font-bold rounded-md transition-all ${showLeftPanel ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-400 dark:text-gray-300 hover:text-white'}`}>
              <span className="flex items-center gap-1"><Brain className="w-3 h-3" /> {t('liveOps.intel', lang)}</span>
            </button>
            <button onClick={() => setShowRightPanel(!showRightPanel)} className={`px-2 py-1.5 text-[9px] font-bold rounded-md transition-all ${showRightPanel ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-400 dark:text-gray-300 hover:text-white'}`}>
              <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {t('map.layers', lang)}</span>
            </button>
            <button onClick={() => setShowLegend(!showLegend)} className={`px-2 py-1.5 text-[9px] font-bold rounded-md transition-all ${showLegend ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-400 dark:text-gray-300 hover:text-white'}`}>
              <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {t('map.legend', lang)}</span>
            </button>
          </div>

          {/* Region Selector -- Advanced LocationDropdown */}
          <LocationDropdown compact />

          {/* 2D / 3D Toggle */}
          <div className="flex bg-gray-900/80 rounded-lg p-0.5 ring-1 ring-gray-800">
            <button onClick={() => setMapMode('2d')} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${mapMode === '2d' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-300 hover:text-white'}`}>
              {t('map.2dMode', lang)}
            </button>
            <button onClick={() => setMapMode('3d')} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${mapMode === '3d' ? 'bg-purple-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-300 hover:text-white'}`}>
              {t('map.3dMode', lang)}
            </button>
          </div>

          {/* Severity Filter */}
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="text-[10px] bg-gray-900/80 text-gray-300 dark:text-gray-300 px-2 py-1.5 rounded-lg ring-1 ring-gray-800">
            <option value="all">{t('admin.filters.severity.all', lang)}</option>
            <option value="High">{t('common.high', lang)}</option>
            <option value="Medium">{t('common.medium', lang)}</option>
            <option value="Low">{t('common.low', lang)}</option>
          </select>

          {/* Status Filter */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-[10px] bg-gray-900/80 text-gray-300 dark:text-gray-300 px-2 py-1.5 rounded-lg ring-1 ring-gray-800">
            <option value="all">{t('admin.filters.status.all', lang)}</option>
            <option value="Urgent">{t('common.urgent', lang)}</option>
            <option value="Unverified">{t('common.unverified', lang)}</option>
            <option value="Verified">{t('common.verified', lang)}</option>
            <option value="Flagged">{t('common.flagged', lang)}</option>
            <option value="Resolved">{t('common.resolved', lang)}</option>
          </select>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-900/80 ring-1 ring-gray-800 text-gray-400 dark:text-gray-300 hover:text-white transition-all">
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/*
          INCIDENT TYPE QUICK-FILTER BAR
           */}
      <div className="px-3 py-1.5 bg-gray-900/90 border-b border-gray-800/60 flex items-center gap-1.5 overflow-x-auto scrollbar-none relative z-[1100]">
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
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-300 dark:text-gray-300 hover:bg-gray-800/50'
              }`}
            >
              <Icon className={`w-3 h-3 ${isActive ? f.color : ''}`} />
              {f.label}
              <span className="tabular-nums text-[8px] opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {/*
          //MAP AREA
           */}
      <div className={`relative ${isFullscreen ? 'h-[calc(100vh-92px)]' : 'h-[calc(100vh-13rem)]'}`}>

        {/*  Map Engine  */}
        {mapMode === '2d' ? (
          <Suspense fallback={<div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-800 rounded" />}>
          <LiveMap
            reports={filtered}
            center={loc.center}
            zoom={loc.zoom}
            height="100%"
            showFloodPredictions={showFloodPredictions}
            showEvacuationRoutes={showEvacuationRoutes}
            onReportClick={handleReportClick}
          />
          </Suspense>
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
              onReportClick={handleReportClick}
            />
          </Suspense>
        )}

        {/*  LEFT HUD: Intel + River + Distress  */}
        {showLeftPanel && (
          <div className="absolute top-3 left-3 z-[900] flex-col gap-2 w-[260px] max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pointer-events-auto hidden md:flex">
            <IntelligenceDashboard socket={socket} collapsed={true} region={activeLocation} />
            <RiverLevelPanel socket={socket} />
            <DistressPanel operatorId={user?.id || ''} operatorName={user?.displayName || t('common.operator', lang)} />
          </div>
        )}

        {/*  RIGHT HUD: Flood Layers + Prediction  */}
        {showRightPanel && (
          <div className="absolute top-3 right-3 z-[900] flex-col gap-2 w-[240px] max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pointer-events-auto hidden md:flex">
            <FloodLayerControl onLayerChange={handleLayerChange} />
            <FloodPredictionTimeline onTimeChange={(h, extents) => {
              setShowFloodPredictions(h > 0)
            }} />
          </div>
        )}

        {/*  MAP LEGEND (floating bottom-left)  */}
        {showLegend && (
          <div className="absolute bottom-14 left-3 z-[900] bg-gray-950/90 backdrop-blur-md rounded-xl ring-1 ring-gray-800 p-3 w-[200px] pointer-events-auto shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-widest">{t('liveOps.mapLegend', lang)}</span>
              <button onClick={() => setShowLegend(false)} className="text-gray-600 hover:text-gray-400 dark:text-gray-300"><X className="w-3 h-3" /></button>
            </div>
            {/* Severity Colors */}
            <div className="space-y-1 mb-2.5">
              <p className="text-[8px] text-gray-500 dark:text-gray-300 font-bold uppercase tracking-wider">{t('common.severity', lang)}</p>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-500/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.highSeverity', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.mediumSeverity', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.lowSeverity', lang)}</span></div>
            </div>
            {/* Status Colors */}
            <div className="space-y-1 mb-2.5">
              <p className="text-[8px] text-gray-500 dark:text-gray-300 font-bold uppercase tracking-wider">{t('common.status', lang)}</p>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('common.urgent', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('common.unverified', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('common.verified', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('common.flagged', lang)}</span></div>
            </div>
            {/* Special Markers */}
            <div className="space-y-1">
              <p className="text-[8px] text-gray-500 dark:text-gray-300 font-bold uppercase tracking-wider">{t('liveOps.overlays', lang)}</p>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-blue-400/40 rounded-sm ring-1 ring-blue-400/60" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.floodZone', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-0.5 bg-green-400" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.evacuationRoutes', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('liveOps.riverStation', lang)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" /><span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.distressBeacons', lang)}</span></div>
            </div>
          </div>
        )}

        {/*  COORDINATE READOUT + ZOOM (bottom-right)  */}
        <div className="absolute bottom-2 right-3 z-[900] flex items-center gap-2 pointer-events-auto">
          {mouseCoords && (
            <button
              onClick={() => { navigator.clipboard?.writeText(`${mouseCoords.lat}, ${mouseCoords.lng}`) }}
              className="bg-gray-950/80 backdrop-blur-sm rounded-lg px-2.5 py-1 ring-1 ring-gray-800/80 flex items-center gap-2 hover:ring-cyan-600/50 transition-all group"
              title={t('liveOps.copyCoords', lang)}
            >
              <Crosshair className="w-3 h-3 text-cyan-400" />
              <span className="text-[9px] font-mono text-green-400 tabular-nums">
                {mouseCoords.lat >= 0 ? `${mouseCoords.lat}°N` : `${Math.abs(mouseCoords.lat)}°S`}
                {' '}
                {mouseCoords.lng >= 0 ? `${mouseCoords.lng}°E` : `${Math.abs(mouseCoords.lng)}°W`}
              </span>
              <Copy className="w-2.5 h-2.5 text-gray-600 group-hover:text-cyan-400 transition-colors" />
            </button>
          )}
          <div className="bg-gray-950/80 backdrop-blur-sm rounded-lg px-2.5 py-1 ring-1 ring-gray-800/80 flex items-center gap-1.5">
            <Gauge className="w-3 h-3 text-gray-500" />
            <span className="text-[9px] font-mono text-gray-400 dark:text-gray-300">Z{loc.zoom}</span>
          </div>
        </div>

        {/*  REAL-TIME REPORT TOASTS (top-center)  */}
        {recentReports.length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[950] flex flex-col gap-1.5 pointer-events-auto">
            {recentReports.map((r, i) => (
              <button
                key={r.id}
                onClick={() => handleReportClick(r)}
                className={`flex items-center gap-2 bg-gray-900/95 backdrop-blur-md rounded-lg px-3 py-2 ring-1 shadow-lg transition-all hover:ring-cyan-500/50 cursor-pointer ${
                  r.severity === 'High' ? 'ring-red-500/50 shadow-red-500/10' : r.severity === 'Medium' ? 'ring-amber-500/50 shadow-amber-500/10' : 'ring-blue-500/50 shadow-blue-500/10'
                }`}
                style={{ animation: `slideDown 0.3s ease-out ${i * 0.1}s both` }}
              >
                <div className={`w-2 h-2 rounded-full animate-pulse ${r.severity === 'High' ? 'bg-red-500' : r.severity === 'Medium' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                <BellRing className="w-3 h-3 text-cyan-400" />
                <span className="text-[10px] text-white font-semibold max-w-[200px] truncate">{r.type || t('liveOps.newReport', lang)}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${r.severity === 'High' ? 'bg-red-900/50 text-red-400' : r.severity === 'Medium' ? 'bg-amber-900/50 text-amber-400' : 'bg-blue-900/50 text-blue-400'}`}>{r.severity}</span>
                <ChevronRight className="w-3 h-3 text-gray-500" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/*
          BOTTOM STATUS BAR -- SCADA / Tactical Data Strip (Enhanced)
           */}
      {showStatusBar && (
        <div className="px-3 py-1.5 bg-gray-950 border-t border-gray-800/80 flex items-center justify-between text-[9px] font-mono">
          {/* Left: Connection + Uplink Status + Data Stream Indicator */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Signal className="w-3 h-3 text-green-400" />
              <span className="text-green-400">{t('common.connected', lang).toUpperCase()}</span>
            </span>
            <span className="text-gray-700">|</span>
            {/* Animated data stream bar */}
            <span className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span className="text-gray-400 dark:text-gray-300">{t('liveOps.feed', lang)}:</span>
              <div className="flex items-center gap-px">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full bg-cyan-400"
                    style={{ animation: `uplinkPulse 1.5s ease-in-out ${i * 0.12}s infinite`, height: '4px' }}
                  />
                ))}
              </div>
              <span className="text-cyan-400 font-bold">{t('common.live', lang).toUpperCase()}</span>
            </span>
            <span className="text-gray-700">|</span>
            <span className="flex items-center gap-1">
              <Radio className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400">{availableLocations.find(l => l.key === activeLocation)?.name || activeLocation}</span>
            </span>
          </div>

          {/* Center: Severity Breakdown with visual bars */}
          <div className="flex items-center gap-3">
            <span className="text-gray-500 dark:text-gray-300">
              {t('liveOps.incidents', lang)}: <span className="text-slate-900 dark:text-white font-bold">{markerStats.total}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-red-400 font-bold">{markerStats.high}</span>
              </span>
              <span className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-amber-400 font-bold">{markerStats.medium}</span>
              </span>
              <span className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-blue-400 font-bold">{markerStats.low}</span>
              </span>
            </div>
            <span className="text-gray-700">|</span>
            <span className="text-gray-500 dark:text-gray-300">
              {t('common.verified', lang)}: <span className="text-emerald-400 font-bold">{markerStats.verified}</span>/<span className="text-gray-400">{markerStats.total}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-300">
              {t('liveOps.media', lang)}: <span className="text-blue-400 font-bold">{markerStats.withMedia}</span>
            </span>
          </div>

          {/* Right: Mode + Threat + Freshness */}
          <div className="flex items-center gap-3">
            <span className={`${threatLevel.color} font-black`}>{threatLabelMap[threatLevel.level] || threatLevel.level}</span>
            <span className="text-gray-700">|</span>
            <span className="text-gray-500 dark:text-gray-300">
              {t('liveOps.mode', lang)}: <span className={mapMode === '3d' ? 'text-purple-400' : 'text-blue-400'}>{mapMode.toUpperCase()}</span>
            </span>
            <span className="text-gray-500 dark:text-gray-300">
              {t('map.layers', lang)}: <span className="text-cyan-400">{(showFloodPredictions ? 1 : 0) + (showEvacuationRoutes ? 1 : 0) + 1}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${dataFreshness.fresh ? 'bg-green-400' : 'bg-amber-400 animate-pulse'}`} />
              <span className={`${dataFreshness.fresh ? 'text-green-400' : 'text-amber-400'}`}>{dataFreshness.label}</span>
            </span>
          </div>
        </div>
      )}

      {showKeyboard && (
        <div className="bg-gray-900 text-white rounded-b-xl p-3 flex items-center gap-3 flex-wrap text-[10px] font-mono ring-1 ring-gray-700/50 border-t border-gray-800">
          <span className="font-bold text-cyan-400 uppercase tracking-wider mr-1 flex items-center gap-1"><ScanLine className="w-3 h-3" /> {t('common.shortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">F</kbd> {t('map.fullscreen', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">L</kbd> {t('liveOps.mapLegend', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">P</kbd> {t('liveOps.predictions', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">E</kbd> {t('liveOps.evacuation', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">B</kbd> {t('liveOps.statusBar', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">Q</kbd> {t('liveOps.quickActions', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">2</kbd> {t('map.2dMode', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">3</kbd> {t('map.3dMode', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white text-[8px]">Ctrl+S</kbd> {t('liveOps.screenshot', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white text-[8px]">Ctrl+D</kbd> {t('common.export', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {t('liveOps.toggleHelp', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{t('common.esc', lang)}</kbd> {t('common.close', lang)}</span>
        </div>
      )}
    </div>
  )
})

LiveOperationsMap.displayName = 'LiveOperationsMap'

export default LiveOperationsMap

