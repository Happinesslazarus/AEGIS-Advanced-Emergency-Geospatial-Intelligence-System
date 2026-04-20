/**
 * Incident command console (manage active incidents).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  AlertTriangle, Activity, Zap, Thermometer, Flame, CloudLightning,
  Mountain, Droplets, ZapOff, Shield, Biohazard, RefreshCw, Circle,
  TrendingUp, Clock, Cpu, Workflow, Sun, Radio, Radar,
  ChevronRight, Layers, Gauge, Sparkles
} from 'lucide-react'
import { useIncidents } from '../../contexts/IncidentContext'
import {
  apiGetAllIncidentPredictions,
  apiGetAllIncidentAlerts,
  apiGetIncidentDashboard,
} from '../../utils/incidentApi'
import { useLanguage } from '../../hooks/useLanguage'
import { t as i18n } from '../../utils/i18n'

/* Icon map*/
const INCIDENT_ICONS: Record<string, React.ElementType> = {
  flood: Droplets, severe_storm: CloudLightning, heatwave: Thermometer,
  wildfire: Flame, landslide: Mountain, power_outage: ZapOff,
  // both short and full-form IDs used across server / AI engine
  water_supply: Droplets, water_supply_disruption: Droplets,
  infrastructure: AlertTriangle, infrastructure_damage: AlertTriangle,
  public_safety: Shield, public_safety_incident: Shield,
  environmental_hazard: Biohazard, drought: Sun,
  // additional incident types from registry / AI engine
  earthquake: Mountain, tsunami: Droplets, storm: CloudLightning,
  chemical_spill: Biohazard, industrial: Biohazard,
  crowd: AlertTriangle, crowd_crush: AlertTriangle,
}

/* AI Tier config*/
const AI_TIER: Record<string, { label: string; gradient: string; glow: string }> = {
  ml:          { label: 'ML',   gradient: 'from-purple-500 to-violet-600', glow: 'shadow-purple-500/20' },
  statistical: { label: 'STAT', gradient: 'from-blue-500 to-cyan-600',    glow: 'shadow-blue-500/20' },
  rule_based:  { label: 'RULE', gradient: 'from-gray-400 to-gray-500',    glow: 'shadow-gray-400/10' },
}

/* Status config*/
const STATUS_CFG: Record<string, { dot: string; label: string }> = {
  fully_operational: { dot: 'bg-emerald-400', label: 'icc.statusOperational' },
  partial:           { dot: 'bg-amber-400',   label: 'icc.statusPartial' },
  configured_only:   { dot: 'bg-gray-400',    label: 'icc.statusConfigured' },
  disabled:          { dot: 'bg-red-400',      label: 'icc.statusDisabled' },
}

/* Severity palette*/
const SEV_PALETTE: Record<string, { ring: string; bg: string; text: string; glow: string; gradient: string }> = {
  critical: { ring: 'ring-red-500/40',    bg: 'bg-red-500',    text: 'text-red-400',    glow: 'shadow-red-500/30',    gradient: 'from-red-500 to-rose-600' },
  high:     { ring: 'ring-orange-500/40', bg: 'bg-orange-500', text: 'text-orange-400', glow: 'shadow-orange-500/30', gradient: 'from-orange-500 to-amber-600' },
  medium:   { ring: 'ring-amber-400/40',  bg: 'bg-amber-400',  text: 'text-amber-400',  glow: 'shadow-amber-400/20',  gradient: 'from-amber-400 to-yellow-500' },
  low:      { ring: 'ring-blue-400/40',   bg: 'bg-blue-400',   text: 'text-blue-400',   glow: 'shadow-blue-400/20',   gradient: 'from-blue-400 to-cyan-500' },
}

interface IncidentStat {
  id: string; name: string; icon: string; color: string
  aiTier: string; operationalStatus: string
  predictions: number; alerts: number; reports: number
  highestSeverity: string | null
}

interface Props {
  onSelectIncident?: (incidentId: string) => void
  selectedIncidentId?: string | null
}

/* Mini radial gauge*/
function MiniGauge({ value, max, color, size = 28 }: { value: number; max: number; color: string; size?: number }) {
  const r = (size - 4) / 2
  const circ = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2.5}
        className="text-gray-200 dark:text-gray-700/60" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={2.5}
        strokeLinecap="round" strokeDasharray={`${pct * circ} ${circ}`}
        className="transition-all duration-700 ease-out" />
    </svg>
  )
}

// MAIN COMPONENT

export default function IncidentCommandConsole({
  onSelectIncident,
  selectedIncidentId,
}: Props): JSX.Element {
  const lang = useLanguage()
  const { registry, registryLoading } = useIncidents()

  const [stats, setStats] = useState<IncidentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [compoundWarnings, setCompoundWarnings] = useState<string[]>([])
  const [totalAlerts, setTotalAlerts] = useState(0)
  const [totalPredictions, setTotalPredictions] = useState(0)

  /* Data fetching*/
  const refresh = useCallback(async () => {
    if (registryLoading) return
    if (!registry.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [dashData, allPredictions, allAlerts] = await Promise.allSettled([
        apiGetIncidentDashboard(),
        apiGetAllIncidentPredictions(),
        apiGetAllIncidentAlerts(),
      ])
      const dashboard = dashData.status === 'fulfilled' ? dashData.value : null
      const predictions = allPredictions.status === 'fulfilled' ? allPredictions.value : { predictions: [] }
      const alerts = allAlerts.status === 'fulfilled' ? allAlerts.value : { alerts: [] }

      const predsByType = new Map<string, number>()
      const alertsByType = new Map<string, number>()
      const severityByType = new Map<string, string>()

      ;(predictions.predictions || []).forEach((p: any) => {
        predsByType.set(p.incidentType, (predsByType.get(p.incidentType) || 0) + 1)
        const cur = severityByType.get(p.incidentType)
        const sev = (p.severity || '').toLowerCase()
        const rank = ['critical', 'high', 'medium', 'low']
        if (!cur || rank.indexOf(sev) < rank.indexOf(cur)) severityByType.set(p.incidentType, sev)
      })
      ;(alerts.alerts || []).forEach((a: any) => {
        alertsByType.set(a.incidentType, (alertsByType.get(a.incidentType) || 0) + 1)
      })

      const built: IncidentStat[] = registry.map(mod => {
        const dashMod = (dashboard?.incidents || []).find((i: any) => i.id === mod.id)
        return {
          id: mod.id, name: mod.name, icon: mod.icon, color: mod.color,
          aiTier: mod.aiTier, operationalStatus: mod.operationalStatus,
          predictions: predsByType.get(mod.id) || dashMod?.activePredictions || 0,
          alerts: alertsByType.get(mod.id) || dashMod?.activeAlerts || 0,
          reports: dashMod?.activeReports || 0,
          highestSeverity: severityByType.get(mod.id) || null,
        }
      })

      setStats(built)
      setTotalAlerts((alerts.alerts || []).length)
      setTotalPredictions((predictions.predictions || []).length)
      setLastUpdated(new Date())

      // Compound / cascading detection
      const criticalIds = built
        .filter(s => s.highestSeverity === 'critical' || s.alerts >= 2)
        .map(s => s.id)
      const warnings: string[] = []
      if (criticalIds.length >= 3) warnings.push(i18n('icc.compoundEmergency', lang).replace('{count}', String(criticalIds.length)))
      if (criticalIds.includes('flood') && criticalIds.includes('power_outage')) warnings.push(i18n('icc.cascadeFloodPower', lang))
      if (criticalIds.includes('severe_storm') && criticalIds.includes('infrastructure_damage')) warnings.push(i18n('icc.cascadeStormInfra', lang))
      setCompoundWarnings(warnings)
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n('icc.loadFailed', lang))
    } finally {
      setLoading(false)
    }
  }, [registry, registryLoading, lang])

  useEffect(() => { refresh(); const iv = setInterval(refresh, 30_000); return () => clearInterval(iv) }, [refresh])

  // Keyboard shortcuts
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); refreshRef.current() }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  
  /* Derived data*/
  const criticalCount = useMemo(() => stats.filter(s => s.highestSeverity === 'critical').length, [stats])
  const highCount = useMemo(() => stats.filter(s => s.highestSeverity === 'high').length, [stats])
  const activeTypes = useMemo(() => stats.filter(s => s.predictions > 0 || s.alerts > 0), [stats])
  const inactiveTypes = useMemo(() => stats.filter(s => s.predictions === 0 && s.alerts === 0), [stats])
  const maxPred = useMemo(() => Math.max(1, ...stats.map(s => s.predictions)), [stats])
  const overallThreat = criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : totalAlerts > 0 ? 'medium' : totalPredictions > 0 ? 'low' : 'nominal'
  const healthOk = !error && lastUpdated !== null

  const threatBannerCfg: Record<string, { bg: string; border: string; text: string; icon: React.ElementType }> = {
    critical: { bg: 'from-red-600 via-red-500 to-rose-600', border: 'border-red-400/30', text: 'text-white', icon: AlertTriangle },
    high:     { bg: 'from-orange-500 via-amber-500 to-orange-600', border: 'border-orange-400/30', text: 'text-white', icon: AlertTriangle },
    medium:   { bg: 'from-amber-500 via-yellow-500 to-amber-600', border: 'border-amber-400/30', text: 'text-amber-950', icon: Radio },
    low:      { bg: 'from-blue-500 via-cyan-500 to-blue-600', border: 'border-blue-400/30', text: 'text-white', icon: Radar },
    nominal:  { bg: 'from-emerald-600 via-green-500 to-emerald-600', border: 'border-emerald-400/30', text: 'text-white', icon: Shield },
  }
  const banner = threatBannerCfg[overallThreat]
  const BannerIcon = banner.icon

  // RENDER

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ERROR BANNER */}
      {error && (
        <div role="alert" className="flex items-center gap-3 p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-500" />
          <span className="flex-1">{error}</span>
          <button onClick={refresh} className="text-[11px] font-semibold underline hover:no-underline">{i18n('icc.retry', lang)}</button>
        </div>
      )}

      {/* REGISTRY EMPTY STATE */}
      {!loading && !registryLoading && registry.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-800/60 rounded-2xl ring-1 ring-gray-200 dark:ring-gray-700/60">
          <Activity className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">{i18n('icc.registryNotLoaded', lang)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">{i18n('icc.checkConnection', lang)}</p>
          <button onClick={refresh} className="mt-3 px-4 py-2 bg-aegis-600 hover:bg-aegis-500 text-white text-xs font-bold rounded-xl transition">
            {i18n('icc.retry', lang)}
          </button>
        </div>
      )}

      {/* LOADING STATE */}
      {loading && registry.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-7 h-7 text-aegis-400 animate-spin" />
        </div>
      )}

      {/* HEADER: Threat Banner (only when registry loaded) */}
      {registry.length > 0 && <div className={`relative overflow-hidden bg-gradient-to-r ${banner.bg} rounded-2xl p-4 shadow-lg border ${banner.border} transition-all duration-500`}>
        {/* Animated background grid overlay */}
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: 'linear-gradient(0deg, transparent 24%, currentColor 25%, currentColor 26%, transparent 27%, transparent 74%, currentColor 75%, currentColor 76%, transparent 77%), linear-gradient(90deg, transparent 24%, currentColor 25%, currentColor 26%, transparent 27%, transparent 74%, currentColor 75%, currentColor 76%, transparent 77%)',
          backgroundSize: '40px 40px'
        }} />
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-inner`}>
              <BannerIcon className={`w-5 h-5 ${banner.text}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-sm font-black uppercase tracking-widest ${banner.text}`}>
                  {i18n('icc.title', lang)}
                </h2>
                <span className={`flex items-center gap-1 text-[9px] font-bold ${banner.text} opacity-80`}>
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  {i18n('common.live', lang)}
                </span>
              </div>
              <p className={`text-[11px] ${banner.text} opacity-80 font-medium mt-0.5`}>
                {i18n('icc.subtitle', lang)
                  .replace('{types}', String(stats.length || registry.length))
                  .replace('{alerts}', String(totalAlerts))
                  .replace('{predictions}', String(totalPredictions))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className={`text-[10px] ${banner.text} opacity-60 font-mono tabular-nums hidden sm:block`}>
                {lastUpdated.toLocaleTimeString([], { hour12: false })}
              </span>
            )}
            <button onClick={refresh} disabled={loading}
              className={`p-2 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-sm ${banner.text} transition-all disabled:opacity-40`}
              aria-label={i18n('command.refreshLabel', lang)}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>}

      {/* COMPOUND WARNINGS */}
      {compoundWarnings.length > 0 && (
        <div className="space-y-2" role="alert" aria-live="assertive">
          {compoundWarnings.map((w, i) => (
            <div key={i} className="flex items-center gap-3 p-3.5 bg-gradient-to-r from-red-600 via-red-500 to-rose-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-red-500/20 animate-scale-in">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <span className="flex-1">{w}</span>
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            </div>
          ))}
        </div>
      )}

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        {[
          { label: i18n('icc.criticalIncidents', lang), value: criticalCount, icon: AlertTriangle, color: 'from-red-500 to-rose-600', glow: 'shadow-red-500/20', textColor: 'text-red-600 dark:text-red-400' },
          { label: i18n('icc.activeAlerts', lang), value: totalAlerts, icon: Zap, color: 'from-amber-500 to-orange-600', glow: 'shadow-amber-500/20', textColor: 'text-amber-600 dark:text-amber-400' },
          { label: i18n('icc.aiPredictions', lang), value: totalPredictions, icon: TrendingUp, color: 'from-blue-500 to-cyan-600', glow: 'shadow-blue-500/20', textColor: 'text-blue-600 dark:text-blue-400' },
          { label: i18n('icc.activeTypes', lang), value: activeTypes.length, icon: Layers, color: 'from-violet-500 to-purple-600', glow: 'shadow-violet-500/20', textColor: 'text-violet-600 dark:text-violet-400' },
        ].map(({ label, value, icon: Icon, color, glow, textColor }) => (
          <div key={label} className={`relative overflow-hidden bg-white dark:bg-gray-800/80 backdrop-blur rounded-xl ring-1 ring-gray-200 dark:ring-gray-700/60 p-3.5 shadow-sm hover:shadow-md ${glow} transition-all duration-300 group`}>
            <div className={`absolute -top-3 -right-3 w-14 h-14 rounded-full bg-gradient-to-br ${color} opacity-[0.08] group-hover:opacity-[0.15] transition-opacity duration-300`} />
            <div className="relative">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center shadow-sm mb-2`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <p className={`text-2xl font-black tabular-nums ${textColor}`}>{value}</p>
              <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* SEVERITY HEATMAP BAR */}
      {stats.length > 0 && (
        <div className="bg-white dark:bg-gray-800/80 backdrop-blur rounded-xl ring-1 ring-gray-200 dark:ring-gray-700/60 p-3.5 shadow-sm animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
              <Gauge className="w-3 h-3" />
              {i18n('icc.severityHeatmap', lang)}
            </span>
            <span className="text-[9px] text-gray-400 dark:text-gray-400 font-mono">
              {stats.filter(s => s.highestSeverity).length}/{stats.length} {i18n('icc.typesWithActivity', lang)}
            </span>
          </div>
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700/50">
            {stats.map((s, idx) => {
              const sev = s.highestSeverity
              const pal = sev ? SEV_PALETTE[sev] : null
              return (
                <div key={s.id} className={`flex-1 transition-all duration-500 ${pal ? pal.bg : 'bg-gray-200 dark:bg-gray-600'} ${
                  sev === 'critical' ? 'animate-pulse' : ''
                }`} style={{ animationDelay: `${idx * 0.05}s` }}
                  title={`${s.name}: ${sev || 'idle'}`} />
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-2">
            {['critical', 'high', 'medium', 'low'].map(sev => {
              const count = stats.filter(s => s.highestSeverity === sev).length
              const pal = SEV_PALETTE[sev]
              return (
                <div key={sev} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${pal.bg}`} />
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium capitalize">{sev}</span>
                  <span className={`text-[9px] font-bold ${pal.text}`}>{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ACTIVE INCIDENT CARDS */}
      {activeTypes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-aegis-500" />
            <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-widest">{i18n('icc.activeThreats', lang)}</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-400 font-mono">({activeTypes.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
            {activeTypes.map((mod) => {
              const stat = stats.find(s => s.id === mod.id) || mod
              const Icon = INCIDENT_ICONS[mod.id] || AlertTriangle
              const isSelected = selectedIncidentId === mod.id
              const tier = AI_TIER[stat.aiTier || 'rule_based'] || AI_TIER.rule_based
              const sev = stat.highestSeverity || 'low'
              const pal = SEV_PALETTE[sev] || SEV_PALETTE.low
              const statusCfg = STATUS_CFG[stat.operationalStatus || 'configured_only'] || STATUS_CFG.configured_only

              return (
                <button key={mod.id} onClick={() => onSelectIncident?.(isSelected ? '' : mod.id)}
                  className={`group relative overflow-hidden rounded-2xl text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${pal.glow} ${
                    isSelected
                      ? 'ring-2 ring-aegis-500 shadow-lg shadow-aegis-500/20'
                      : 'ring-1 ring-gray-200 dark:ring-gray-700/60 hover:ring-gray-300 dark:hover:ring-gray-600'
                  } bg-white dark:bg-gray-800/80 backdrop-blur`}>
                  {/* Top severity accent bar */}
                  <div className={`h-1 bg-gradient-to-r ${pal.gradient}`} />

                  <div className="p-4">
                    {/* Row 1: Icon + Name + Status */}
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
                          style={{ backgroundColor: `${stat.color || mod.color}18` }}>
                          <Icon className="w-5 h-5" style={{ color: stat.color || mod.color }} />
                        </div>
                        {/* Mini gauge overlay */}
                        <div className="absolute -bottom-1 -right-1">
                          <MiniGauge value={stat.predictions} max={maxPred} color={stat.color || mod.color} size={20} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot} ${
                            stat.operationalStatus === 'fully_operational' ? 'animate-pulse' : ''
                          }`} />
                          <span className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors">
                            {stat.name || mod.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-gradient-to-r ${tier.gradient} text-white shadow-sm ${tier.glow}`}>
                            {tier.label}
                          </span>
                          <span className={`text-[9px] font-medium ${pal.text}`}>{i18n(statusCfg.label, lang)}</span>
                        </div>
                      </div>
                      {/* Severity badge */}
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider ring-1 ${pal.ring} ${pal.text} bg-gradient-to-br ${
                        sev === 'critical' ? 'from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/30' :
                        sev === 'high' ? 'from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/30' :
                        sev === 'medium' ? 'from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/30' :
                        'from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30'
                      }`}>
                        {sev}
                      </span>
                    </div>

                    {/* Row 2: Stats bar */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                      {stat.alerts > 0 && (
                        <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">
                          <Zap className="w-3 h-3 text-red-500" />
                          <span className="text-[10px] font-bold text-red-600 dark:text-red-400">{stat.alerts}</span>
                          <span className="text-[9px] text-red-500/70 dark:text-red-400/70">{i18n('icc.alertsLabel', lang)}</span>
                        </div>
                      )}
                      {stat.predictions > 0 && (
                        <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-lg">
                          <TrendingUp className="w-3 h-3 text-blue-500" />
                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">{stat.predictions}</span>
                          <span className="text-[9px] text-blue-500/70 dark:text-blue-400/70">{i18n('icc.predsLabel', lang)}</span>
                        </div>
                      )}
                      {stat.reports > 0 && (
                        <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700/30 px-2 py-1 rounded-lg">
                          <Activity className="w-3 h-3 text-gray-500" />
                          <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{stat.reports}</span>
                        </div>
                      )}
                      <ChevronRight className={`w-3.5 h-3.5 ml-auto text-gray-300 dark:text-gray-400 group-hover:text-aegis-500 transition-all ${isSelected ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* IDLE / MONITORING INCIDENTS */}
      {inactiveTypes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest">{i18n('icc.monitoring', lang)}</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-400 font-mono">({inactiveTypes.length})</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {inactiveTypes.map((mod) => {
              const Icon = INCIDENT_ICONS[mod.id] || AlertTriangle
              const tier = AI_TIER[mod.aiTier || 'rule_based'] || AI_TIER.rule_based
              const statusCfg = STATUS_CFG[mod.operationalStatus || 'configured_only'] || STATUS_CFG.configured_only
              const isSelected = selectedIncidentId === mod.id

              return (
                <button key={mod.id} onClick={() => onSelectIncident?.(isSelected ? '' : mod.id)}
                  className={`group flex items-center gap-2.5 p-2.5 rounded-xl transition-all duration-200 ${
                    isSelected
                      ? 'ring-2 ring-aegis-500 bg-aegis-50 dark:bg-aegis-950/20'
                      : 'bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-100 dark:ring-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:ring-gray-200 dark:hover:ring-gray-600'
                  }`}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${mod.color}12` }}>
                    <Icon className="w-3.5 h-3.5 opacity-50" style={{ color: mod.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 truncate group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors">
                      {mod.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`w-1 h-1 rounded-full ${statusCfg.dot}`} />
                      <span className={`text-[8px] font-bold px-1 py-0.5 rounded bg-gradient-to-r ${tier.gradient} text-white`}>{tier.label}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* FOOTER: System Health Strip */}
      <div className="flex items-center gap-1 pt-3 border-t border-gray-100 dark:border-gray-800 flex-wrap">
        {[
          { icon: Workflow, label: i18n('icc.builtInScheduler', lang),  status: healthOk ? 'bg-emerald-400' : 'bg-red-400' },
          { icon: Clock,    label: i18n('icc.cronActive', lang),   status: healthOk ? 'bg-emerald-400' : 'bg-amber-400' },
          { icon: Cpu,      label: i18n('icc.aiIntegrated', lang),   status: healthOk ? 'bg-emerald-400' : 'bg-amber-400' },
        ].map(({ icon: SIcon, label, status }) => (
          <div key={label} className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 px-2.5 py-1.5 rounded-lg ring-1 ring-gray-100 dark:ring-gray-700/40">
            <span className={`w-1.5 h-1.5 rounded-full ${status}`} />
            <SIcon className="w-3 h-3" />
            <span className="font-medium">{label}</span>
          </div>
        ))}
        {lastUpdated && (
          <span className="ml-auto text-[9px] text-gray-400 dark:text-gray-400 font-mono">
            {i18n('icc.updated', lang)} {lastUpdated.toLocaleTimeString([], { hour12: false })}
          </span>
        )}
      </div>

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{i18n('icc.shortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> {i18n('common.refresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {i18n('icc.toggleShortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{i18n('common.esc', lang)}</kbd> {i18n('common.close', lang)}</span>
        </div>
      )}
    </div>
  )
}
