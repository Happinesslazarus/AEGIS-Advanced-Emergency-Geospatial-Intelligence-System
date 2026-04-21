/**
 * AI-powered intelligence summary panel. Pulls model confidence scores,
 * active threat counts, and anomaly flags from /api/intelligence and
 * renders them as gauge charts with trend arrows.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useEventBuffer, useEventCallbacks } from '../../hooks/useEventStream'
import {
  Shield, AlertTriangle, Droplets, Users,
  Activity, TrendingUp, TrendingDown, RefreshCw,
  Radio, ChevronDown, ChevronUp, Zap, Flame, Wind,
  CloudRain, Sun, Construction, Eye, Leaf
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { getAnyToken } from '../../utils/api'
import { useLanguage } from '../../hooks/useLanguage'
import { RISK_CLASSES, INCIDENT_CLASSES } from '../../utils/colorTokens'

const API = ''

interface IncidentSummary {
  id: string
  activeCount: number
  alertCount: number
  predictionCount: number
  maxSeverity: string
}

interface DashboardData {
  totalActiveIncidents: number
  totalAlerts: number
  totalPredictions: number
  highestRiskLevel: string
  byType: IncidentSummary[]
}

interface RiverSummary {
  stationId: string
  riverName: string
  levelMetres: number
  status: string
  trend: string
}

interface LiveIncidentAlert {
  incidentType: string
  riskLevel: string
  title: string
  description: string
  timestamp: string
}

interface IncidentCluster {
  cluster_id: string
  incident_type: string
  reports: number
  confidence: number
  radius_m: number
}

interface CascadingInsight {
  chain: string[]
  confidence: number
  recommended_actions: string[]
  likely_within_minutes?: number
  impact_score?: number
  confidence_band?: { p50: number; p90: number }
}

interface IncidentObject {
  incident_id: string
  incident_type: string
  confidence: number
  lifecycle_state: 'weak' | 'possible' | 'probable' | 'high' | 'confirmed'
  evidence_count: number
}

interface IncidentChangeFeed {
  lifecycle_counts: Record<string, number>
  totals: {
    new_count: number
    escalated_count: number
    downgraded_count: number
    resolved_count: number
  }
}

interface IncidentExplanation {
  summary: string
  drivers: string[]
  trace: Array<{ step: string; value: string }>
}

interface IncidentTimelinePoint {
  window_minutes: number
  snapshot_at: string
  present: boolean
  lifecycle_state: 'weak' | 'possible' | 'probable' | 'high' | 'confirmed' | null
  confidence: number | null
  evidence_count: number
}

interface Props {
  socket?: any
  className?: string
  collapsed?: boolean
  region?: string
}

const RISK_COLORS: Record<string, string> = RISK_CLASSES

const THREAT_CONFIG: Record<string, { bg: string; border: string; text: string; pulse?: boolean }> = {
  CRITICAL: { bg: 'bg-danger-surface',    border: 'border-red-500',   text: 'text-danger-text',   pulse: true },
  RED:      { bg: 'bg-danger-surface',    border: 'border-red-600',   text: 'text-danger-text',   pulse: true },
  AMBER:    { bg: 'bg-warning-surface',   border: 'border-amber-600', text: 'text-warning-text' },
  HIGH:     { bg: 'bg-orange-50 dark:bg-orange-900/40',border: 'border-orange-600',text: 'text-orange-600 dark:text-orange-400' },
  GREEN:    { bg: 'bg-success-surface',   border: 'border-green-700', text: 'text-success-text' },
}

const INCIDENT_ICONS: Record<string, any> = {
  flood:                  CloudRain,
  severe_storm:           Wind,
  heatwave:               Sun,
  wildfire:               Flame,
  landslide:              TrendingDown,
  power_outage:           Zap,
  water_supply:           Droplets,
  water_supply_disruption:Droplets,
  infrastructure_damage:  Construction,
  public_safety:          Users,
  public_safety_incident: Users,
  environmental_hazard:   Leaf,
  drought:                Sun,
}

const INCIDENT_COLORS: Record<string, string> = INCIDENT_CLASSES

function riskToScore(level: string): number {
  const map: Record<string, number> = { Critical: 92, HIGH: 72, High: 72, AMBER: 45, Medium: 45, Low: 15, NONE: 5, GREEN: 5 }
  return map[level] ?? 10
}

function scoreToThreatLevel(score: number): string {
  if (score >= 80) return 'CRITICAL'
  if (score >= 55) return 'RED'
  if (score >= 30) return 'AMBER'
  return 'GREEN'
}

function incidentLabel(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function IntelligenceDashboard({ socket, className = '', collapsed: initCollapsed = false, region }: Props): JSX.Element {
  const lang = useLanguage()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [rivers, setRivers] = useState<RiverSummary[]>([])
  const [distressCount, setDistressCount] = useState(0)
  const [liveAlerts, setLiveAlerts] = useState<LiveIncidentAlert[]>([])
  const [incidentClusters, setIncidentClusters] = useState<IncidentCluster[]>([])
  const [cascadingInsights, setCascadingInsights] = useState<CascadingInsight[]>([])
  const [incidentObjects, setIncidentObjects] = useState<IncidentObject[]>([])
  const [incidentChanges, setIncidentChanges] = useState<IncidentChangeFeed | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [selectedExplanation, setSelectedExplanation] = useState<IncidentExplanation | null>(null)
  const [selectedTimeline, setSelectedTimeline] = useState<IncidentTimelinePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(initCollapsed)
  const fetchAbortRef = useRef<AbortController | null>(null)

  const getAuthContext = useCallback((): { token: string | null; role: string | null } => {
    const token = getAnyToken()
    const rawUser = localStorage.getItem('aegis-user') || localStorage.getItem('aegis-citizen-user')
    let role: string | null = null
    try {
      role = rawUser ? String(JSON.parse(rawUser)?.role || '').toLowerCase() : null
    } catch {
      role = null
    }
    return { token, role }
  }, [])

  const safeFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response | null> => {
    try {
      const res = await fetch(url, init)
      //Optional intelligence endpoints may be unavailable by role or backend version.
      if ([401, 403, 404].includes(res.status)) return null
      return res
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('[Intelligence] fetch error:', err?.message)
      return null
    }
  }, [])

  const fetchAll = useCallback(async () => {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    const signal = controller.signal

    setLoading(true)
    try {
      const { token, role } = getAuthContext()
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      const isAuthenticated = Boolean(token)
      const canReadDistress = ['admin', 'operator', 'manager'].includes(String(role || ''))

      const [dashRes, riverRes, distressRes, clusterRes, cascadeRes, incidentsRes, changesRes] = await Promise.all([
        isAuthenticated ? safeFetch(`${API}/api/v1/incidents/all/dashboard${region ? `?region=${encodeURIComponent(region)}` : ''}`, { headers: authHeaders, signal }) : Promise.resolve(null),
        safeFetch(`${API}/api/rivers/levels`, { signal }),
        canReadDistress ? safeFetch(`${API}/api/distress/active`, { headers: authHeaders, signal }) : Promise.resolve(null),
        safeFetch(`${API}/api/reports/clusters?minutes=180&radiusMeters=1000&minReports=3`, { headers: authHeaders, signal }),
        safeFetch(`${API}/api/reports/cascading-insights?windowMinutes=180`, { headers: authHeaders, signal }),
        safeFetch(`${API}/api/reports/incident-objects?minutes=180&radiusMeters=1000&minReports=3`, { headers: authHeaders, signal }),
        safeFetch(`${API}/api/reports/incident-objects/changes?minutes=15&baselineMinutes=15&radiusMeters=1000&minReports=3`, { headers: authHeaders, signal }),
      ])

      if (dashRes?.ok) {
        const raw = await dashRes.json()
        //Map incident registry summary to our DashboardData shape
        const byType: IncidentSummary[] = (raw.incidents || []).map((inc: any) => ({
          id: inc.id || inc.incidentType || '',
          activeCount: inc.activeCount ?? inc.active ?? 0,
          alertCount: inc.alertCount ?? inc.alerts ?? 0,
          predictionCount: inc.predictionCount ?? inc.predictions ?? 0,
          maxSeverity: inc.maxSeverity ?? inc.severity ?? 'LOW',
        }))
        const totalActive = byType.reduce((s, t) => s + t.activeCount, 0) || raw.totalActiveIncidents || 0
        const totalAlerts = byType.reduce((s, t) => s + t.alertCount, 0) || raw.totalAlerts || 0
        const totalPredictions = byType.reduce((s, t) => s + t.predictionCount, 0) || raw.totalPredictions || 0
        const maxScore = byType.length
          ? Math.max(...byType.map(t => riskToScore(t.maxSeverity)))
          : riskToScore(raw.highestRiskLevel || 'LOW')
        setDashboard({
          totalActiveIncidents: totalActive,
          totalAlerts,
          totalPredictions,
          highestRiskLevel: scoreToThreatLevel(maxScore),
          byType,
        })
      }

      if (riverRes?.ok) {
        const data = await riverRes.json()
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

      if (clusterRes?.ok) {
        const data = await clusterRes.json()
        setIncidentClusters(Array.isArray(data?.clusters) ? data.clusters : [])
      }

      if (cascadeRes?.ok) {
        const data = await cascadeRes.json()
        setCascadingInsights(Array.isArray(data?.inferred_cascades) ? data.inferred_cascades : [])
      }

      if (incidentsRes?.ok) {
        const data = await incidentsRes.json()
        const incidents = Array.isArray(data?.incidents) ? data.incidents : []
        setIncidentObjects(incidents)
        if (!selectedIncidentId && incidents.length > 0) {
          setSelectedIncidentId(incidents[0].incident_id)
        }
      }

      if (changesRes?.ok) {
        const data = await changesRes.json()
        setIncidentChanges({
          lifecycle_counts: data?.lifecycle_counts || {},
          totals: data?.totals || { new_count: 0, escalated_count: 0, downgraded_count: 0, resolved_count: 0 },
        })
      }
    } catch {}
    setLoading(false)
  }, [getAuthContext, safeFetch, region])

  useEffect(() => {
    if (!selectedIncidentId) {
      setSelectedExplanation(null)
      setSelectedTimeline([])
      return
    }
    const { token } = getAuthContext()
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

    safeFetch(`${API}/api/reports/incident-objects/${encodeURIComponent(selectedIncidentId)}/explanation`, { headers })
      .then((r) => (r?.ok ? r.json() : null))
      .then((data) => {
        if (data?.explanation) setSelectedExplanation(data.explanation)
      })
      .catch(() => setSelectedExplanation(null))

    safeFetch(`${API}/api/reports/incident-objects/${encodeURIComponent(selectedIncidentId)}/timeline`, { headers })
      .then((r) => (r?.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.data)) setSelectedTimeline(data.data)
      })
      .catch(() => setSelectedTimeline([]))
  }, [getAuthContext, safeFetch, selectedIncidentId])

  useEffect(() => {
    fetchAll()
    return () => { fetchAbortRef.current?.abort() }
  }, [fetchAll])

  //Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(fetchAll, 60_000)
    return () => clearInterval(t)
  }, [fetchAll])

  // Typed hazard prediction events from the AI tick -- refresh counts whenever
  // a new prediction arrives. Replaces the legacy 'incident:predictions_updated' socket.on.
  const hazardEvents = useEventBuffer('hazard:predicted', 10)
  useEffect(() => {
    if (hazardEvents.length > 0) fetchAll()
  }, [hazardEvents, fetchAll])

  // Typed live-event subscriptions (replaces the old socket.on/off boilerplate).
  // Distress + incident-alert channels are still on the legacy rich payload
  // shape; useEventCallbacks gives them the same hook-based ergonomics as
  // anything on the spine, so this code never has to change again when those
  // channels migrate.
  useEventCallbacks({
    'distress:new_alert':     () => setDistressCount(prev => prev + 1),
    'distress:cancelled':     () => setDistressCount(prev => Math.max(0, prev - 1)),
    'distress:status_changed': (data) => {
      if (data.status === 'resolved') setDistressCount(prev => Math.max(0, prev - 1))
    },
    'incident:alert':          (payload) => handleIncidentAlert(payload),
    'incident:alert:priority': (payload) => handleIncidentAlert(payload),
  })

  function handleIncidentAlert(payload: { incidentType?: string; riskLevel?: string; title?: string; description?: string; timestamp?: string }) {
    setLiveAlerts(prev => [{
      incidentType: payload.incidentType || 'unknown',
      riskLevel:    payload.riskLevel || 'Low',
      title:        payload.title || `${payload.incidentType} alert`,
      description:  payload.description || '',
      timestamp:    payload.timestamp || new Date().toISOString(),
    }, ...prev].slice(0, 5))
    if (payload.riskLevel === 'High' || payload.riskLevel === 'Critical') fetchAll()
  }

  const threatLevel = dashboard?.highestRiskLevel || 'GREEN'
  const threatCfg   = THREAT_CONFIG[threatLevel] || THREAT_CONFIG.GREEN
  const score       = dashboard ? riskToScore(threatLevel) : 0
  const criticalRivers  = rivers.filter(r => r.status === 'CRITICAL' || r.status === 'HIGH').length
  const elevatedRivers  = rivers.filter(r => r.status === 'ELEVATED').length
  const activeIncidents = dashboard?.byType.filter(t => t.activeCount > 0) || []
  const lifecycleCounts = incidentChanges?.lifecycle_counts || {}

  const TrendIcon = ({ trend }: { trend: string }) => {
    if (trend === 'rising')  return <TrendingUp   className="w-3 h-3 text-red-400" />
    if (trend === 'falling') return <TrendingDown className="w-3 h-3 text-green-400" />
    return <Activity className="w-3 h-3 text-gray-400 dark:text-gray-300" />
  }

  const threatDescMap: Record<string, string> = {
    CRITICAL: t('intel.threatCritical', lang),
    RED:      t('intel.threatRed', lang),
    AMBER:    t('intel.threatAmber', lang),
    GREEN:    t('intel.threatGreen', lang),
  }
  const compactUpdates = [
    `${t('intel.active', lang)}: ${dashboard?.totalActiveIncidents ?? 0}`,
    `${t('intel.alerts', lang)}: ${dashboard?.totalAlerts ?? 0}`,
    `${t('intel.rivers', lang)}: ${criticalRivers}`,
    `SOS: ${distressCount}`,
    threatDescMap[threatLevel],
  ]

  return (
    <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl shadow-2xl overflow-hidden ${className}`}>
      {/* Header -- coloured by highest threat */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full px-4 py-3 flex items-center justify-between transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/50 ${threatCfg.bg}`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${threatLevel === 'CRITICAL' || threatLevel === 'RED' ? 'bg-red-600' : threatLevel === 'AMBER' ? 'bg-amber-600' : 'bg-green-700'} ${threatCfg.pulse ? 'animate-pulse' : ''}`}>
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('intel.title', lang)}</h3>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${threatLevel === 'CRITICAL' ? 'bg-red-600 text-white animate-pulse' : threatLevel === 'RED' ? 'bg-red-700 text-white' : threatLevel === 'AMBER' ? 'bg-amber-600 text-black' : 'bg-green-700 text-white'}`}>
                {threatLevel}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{threatDescMap[threatLevel]}</p>
          </div>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-300" /> : <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-300" />}
      </button>

      {collapsed && (
        <div className="border-t border-gray-200 dark:border-gray-700/40">
          {/* Mini score bar */}
          <div className="px-4 pt-2.5 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('intel.compositeScore', lang)}</span>
              <span className="text-[10px] font-mono font-bold text-gray-900 dark:text-white">{score}/100</span>
            </div>
            <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${score >= 75 ? 'bg-red-500' : score >= 50 ? 'bg-amber-500' : score >= 25 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
          {/* Mini stat grid */}
          <div className="px-4 pb-2.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-sm font-bold ${(dashboard?.totalActiveIncidents ?? 0) > 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-300'}`}>
                {dashboard?.totalActiveIncidents ?? 0}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.active', lang)}</div>
            </div>
            <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-sm font-bold ${(dashboard?.totalAlerts ?? 0) > 0 ? 'text-amber-400' : 'text-gray-400 dark:text-gray-300'}`}>
                {dashboard?.totalAlerts ?? 0}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.alerts', lang)}</div>
            </div>
            <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-sm font-bold ${criticalRivers > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {criticalRivers}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <Droplets className="w-2 h-2" />{t('intel.rivers', lang)}
              </div>
            </div>
            <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-sm font-bold ${distressCount > 0 ? 'text-red-400 animate-pulse' : 'text-gray-400 dark:text-gray-300'}`}>
                {distressCount}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <Radio className="w-2 h-2" />SOS
              </div>
            </div>
          </div>
          {/* Threat description */}
          <div className="px-4 pb-2.5">
            <p className="text-[10px] text-gray-500 dark:text-gray-300 italic">{threatDescMap[threatLevel]}</p>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="border-t border-gray-200 dark:border-gray-700/40">

          {/* Composite threat score bar */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/30">
            <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('intel.compositeScore', lang)}</span>
              <span className="text-xs font-mono font-bold text-gray-900 dark:text-white">{score}/100</span>
            </div>
            <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${score >= 75 ? 'bg-red-500' : score >= 50 ? 'bg-amber-500' : score >= 25 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${score}%` }}
              />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-green-500">{t('intel.safe', lang)}</span>
              <span className="text-[9px] text-amber-500">{t('intel.elevated', lang)}</span>
              <span className="text-[9px] text-red-500">{t('intel.critical', lang)}</span>
            </div>
          </div>

          {/* Cross-incident stats */}
          <div className="px-4 py-3 grid grid-cols-3 gap-2 border-b border-gray-100 dark:border-gray-700/30">
            <div className="text-center p-2 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${(dashboard?.totalActiveIncidents ?? 0) > 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-300'}`}>
                {dashboard?.totalActiveIncidents ?? 0}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.active', lang)}</div>
            </div>
            <div className="text-center p-2 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${(dashboard?.totalAlerts ?? 0) > 0 ? 'text-amber-400' : 'text-gray-400 dark:text-gray-300'}`}>
                {dashboard?.totalAlerts ?? 0}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.alerts', lang)}</div>
            </div>
            <div className="text-center p-2 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${criticalRivers > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {criticalRivers}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <Droplets className="w-2.5 h-2.5" /> {t('intel.rivers', lang)}
              </div>
            </div>
            <div className="text-center p-2 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${distressCount > 0 ? 'text-red-400 animate-pulse' : 'text-gray-400 dark:text-gray-300'}`}>
                {distressCount}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300 flex items-center justify-center gap-0.5">
                <Radio className="w-2.5 h-2.5" /> SOS
              </div>
            </div>
            <div className="text-center p-2 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${incidentClusters.length > 0 ? 'text-lime-400' : 'text-gray-400 dark:text-gray-300'}`}>
                {incidentClusters.length}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.clusters', lang)}</div>
            </div>
            <div className="text-center p-2 bg-gray-100 dark:bg-gray-800/40 rounded-lg">
              <div className={`text-lg font-bold ${cascadingInsights.length > 0 ? 'text-fuchsia-400' : 'text-gray-400 dark:text-gray-300'}`}>
                {cascadingInsights.length}
              </div>
              <div className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.cascades', lang)}</div>
            </div>
          </div>

          {/* Active incident types breakdown */}
          {activeIncidents.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/30">
              <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 mb-2 uppercase tracking-wide">{t('intel.activeByType', lang)}</p>
              <div className="space-y-1">
                {activeIncidents.map(inc => {
                  const Icon = INCIDENT_ICONS[inc.id] || Eye
                  const color = INCIDENT_COLORS[inc.id] || 'text-gray-400 dark:text-gray-300'
                  return (
                    <div key={inc.id} className="flex items-center gap-2 py-0.5">
                      <Icon className={`w-3 h-3 flex-shrink-0 ${color}`} />
                      <span className="text-[10px] text-gray-600 dark:text-gray-300 flex-1 truncate">{incidentLabel(inc.id)}</span>
                      <span className={`text-[10px] font-bold ${RISK_COLORS[inc.maxSeverity] || 'text-gray-400 dark:text-gray-300'}`}>{inc.maxSeverity}</span>
                      <span className="text-[10px] font-mono text-gray-800 dark:text-white bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded">{inc.activeCount}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {incidentChanges && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/30">
              <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 mb-2 uppercase tracking-wide">{t('intel.whatChanged', lang)}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded">
                  <p className="text-sm font-bold text-emerald-400">{incidentChanges.totals.new_count}</p>
                  <p className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.new', lang)}</p>
                </div>
                <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded">
                  <p className="text-sm font-bold text-red-400">{incidentChanges.totals.escalated_count}</p>
                  <p className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.escalated', lang)}</p>
                </div>
                <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded">
                  <p className="text-sm font-bold text-amber-400">{incidentChanges.totals.downgraded_count}</p>
                  <p className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.downgraded', lang)}</p>
                </div>
                <div className="text-center p-1.5 bg-gray-100 dark:bg-gray-800/40 rounded">
                  <p className="text-sm font-bold text-blue-400">{incidentChanges.totals.resolved_count}</p>
                  <p className="text-[9px] text-gray-500 dark:text-gray-300">{t('intel.resolved', lang)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(['weak', 'possible', 'probable', 'high', 'confirmed'] as const).map((state) => (
                  <span key={state} className="text-[9px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                    {t(`intel.lifecycle.${state}`, lang)}: {lifecycleCounts[state] || 0}
                  </span>
                ))}
              </div>
            </div>
          )}

          {incidentObjects.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/30">
              <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 mb-2 uppercase tracking-wide">{t('intel.whyConfidence', lang)}</p>
              <div className="space-y-1 max-h-[90px] overflow-y-auto mb-2">
                {incidentObjects.slice(0, 4).map((incident) => (
                  <button
                    key={incident.incident_id}
                    onClick={() => setSelectedIncidentId(incident.incident_id)}
                    className={`w-full text-left rounded px-2 py-1 text-[10px] border ${selectedIncidentId === incident.incident_id ? 'border-aegis-500 bg-gray-100 dark:bg-gray-800' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800/60'}`}
                  >
                    {incidentLabel(incident.incident_type)} -- {Math.round(incident.confidence * 100)}% -- {incident.lifecycle_state}
                  </button>
                ))}
              </div>
              {selectedExplanation && (
                <div className="rounded bg-gray-100 dark:bg-gray-800/50 p-2">
                  <p className="text-[10px] text-gray-800 dark:text-gray-200 font-semibold">{selectedExplanation.summary}</p>
                  <p className="text-[9px] text-gray-500 dark:text-gray-300 mt-1">
                    {selectedExplanation.drivers?.slice(0, 2).join(' | ') || t('intel.noDrivers', lang)}
                  </p>
                </div>
              )}
              {selectedTimeline.length > 0 && (
                <div className="rounded bg-gray-100 dark:bg-gray-800/50 p-2 mt-2">
                  <p className="text-[10px] text-gray-800 dark:text-gray-200 font-semibold mb-2">Incident evolution timeline</p>
                  <div className="space-y-1.5">
                    {selectedTimeline.map((point) => {
                      const pct = Math.round((point.confidence || 0) * 100)
                      const bar = Math.max(6, pct)
                      return (
                        <div key={point.window_minutes} className="grid grid-cols-[46px_1fr_52px] gap-2 items-center">
                          <span className="text-[9px] text-gray-500 dark:text-gray-400">{point.window_minutes}m</span>
                          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className={`h-full ${point.lifecycle_state === 'confirmed' ? 'bg-emerald-500' : point.lifecycle_state === 'high' ? 'bg-green-500' : point.lifecycle_state === 'probable' ? 'bg-amber-500' : point.lifecycle_state === 'possible' ? 'bg-orange-500' : 'bg-gray-400'}`}
                              style={{ width: `${bar}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-gray-600 dark:text-gray-300 text-right">{point.present ? `${pct}%` : 'N/A'}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live alerts feed (Socket.IO pushed) */}
          {liveAlerts.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/30">
              <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 mb-2 uppercase tracking-wide">{t('intel.liveAlerts', lang)}</p>
              <div className="space-y-1 max-h-[100px] overflow-y-auto">
                {liveAlerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 bg-gray-100 dark:bg-gray-800/40 rounded px-2 py-1">
                    <AlertTriangle className={`w-2.5 h-2.5 mt-0.5 flex-shrink-0 ${a.riskLevel === 'Critical' ? 'text-red-400 animate-pulse' : 'text-amber-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-gray-900 dark:text-white truncate">{a.title}</p>
                      <p className="text-[9px] text-gray-500 dark:text-gray-300">{incidentLabel(a.incidentType)} -- {a.riskLevel}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cascadingInsights.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/30">
              <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 mb-2 uppercase tracking-wide">{t('intel.cascadingChains', lang)}</p>
              <div className="space-y-1 max-h-[110px] overflow-y-auto">
                {cascadingInsights.slice(0, 4).map((insight, i) => (
                  <div key={i} className="flex items-start gap-1.5 bg-gray-100 dark:bg-gray-800/40 rounded px-2 py-1">
                    <AlertTriangle className={`w-2.5 h-2.5 mt-0.5 flex-shrink-0 ${insight.confidence >= 0.8 ? 'text-red-400 animate-pulse' : 'text-amber-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-gray-900 dark:text-white truncate">{insight.chain.join(' -> ')}</p>
                      <p className="text-[9px] text-gray-500 dark:text-gray-300">
                        Confidence {Math.round(insight.confidence * 100)}%{insight.confidence_band ? ` -- P50 ${Math.round(insight.confidence_band.p50 * 100)}% -- P90 ${Math.round(insight.confidence_band.p90 * 100)}%` : ''}
                      </p>
                      {insight.likely_within_minutes && (
                        <p className="text-[9px] text-gray-500 dark:text-gray-400">Likely within {insight.likely_within_minutes} min{insight.impact_score ? ` -- Impact ${insight.impact_score}/100` : ''}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* River gauge list (flood intelligence -- kept) */}
          {rivers.length > 0 && (
            <div className="max-h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
              <p className="px-4 py-1 text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700/20">{t('intel.riverGauges', lang)}</p>
              {rivers.map(river => (
                <div key={river.stationId} className="px-4 py-2 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700/20 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${river.status === 'CRITICAL' ? 'bg-red-500 animate-pulse' : river.status === 'HIGH' ? 'bg-orange-500' : river.status === 'ELEVATED' ? 'bg-amber-400' : 'bg-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-900 dark:text-white truncate">{river.riverName}</p>
                  </div>
                  <TrendIcon trend={river.trend} />
                  <span className="text-xs font-mono font-bold text-gray-900 dark:text-white">{river.levelMetres?.toFixed(2)}m</span>
                </div>
              ))}
            </div>
          )}

          {/* Refresh */}
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/30 flex items-center justify-between">
            <span className="text-[9px] text-gray-600">
              {dashboard ? `${dashboard.byType.length} ${t('intel.typesMonitored', lang)}` : t('common.loading', lang)}
            </span>
            <button onClick={fetchAll} disabled={loading} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t('intel.refresh', lang)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

