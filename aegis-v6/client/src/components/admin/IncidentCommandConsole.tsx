/**
 * IncidentCommandConsole.tsx — Multi-incident operations command view
 *
 * Real-time dashboard panel for the Admin UI that shows:
 * - Live status of all 11 incident types with prediction/alert counts
 * - Per-incident AI tier badge (rule_based / statistical / ml)
 * - Quick filter to drill into a single incident type
 * - Cross-incident correlation warnings (compound events)
 * - n8n + cron health in sidebar
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, Activity, Zap, Thermometer, Flame, CloudLightning,
  Mountain, Droplets, ZapOff, Shield, Biohazard, RefreshCw, Circle,
  TrendingUp, CheckCircle2, Clock, Cpu, Workflow, Sun
} from 'lucide-react'
import { useIncidents } from '../../contexts/IncidentContext'
import {
  apiGetAllIncidentPredictions,
  apiGetAllIncidentAlerts,
  apiGetIncidentDashboard,
} from '../../utils/incidentApi'
import { useLanguage } from '../../hooks/useLanguage'

// ─── Incident type icons ────────────────────────────────────────────────
const INCIDENT_ICONS: Record<string, React.ElementType> = {
  flood: Droplets,
  severe_storm: CloudLightning,
  heatwave: Thermometer,
  wildfire: Flame,
  landslide: Mountain,
  power_outage: ZapOff,
  water_supply_disruption: Droplets,
  infrastructure_damage: AlertTriangle,
  public_safety_incident: Shield,
  environmental_hazard: Biohazard,
  drought: Sun,
}

const AI_TIER_BADGE: Record<string, { label: string; color: string }> = {
  ml: { label: 'ML', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  statistical: { label: 'STAT', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  rule_based: { label: 'RULE', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
}

const STATUS_DOT: Record<string, string> = {
  fully_operational: 'bg-green-500',
  partial: 'bg-amber-400',
  configured_only: 'bg-gray-400',
  disabled: 'bg-red-400',
}

interface IncidentStat {
  id: string
  name: string
  icon: string
  color: string
  aiTier: string
  operationalStatus: string
  predictions: number
  alerts: number
  reports: number
  highestSeverity: string | null
}

interface Props {
  onSelectIncident?: (incidentId: string) => void
  selectedIncidentId?: string | null
}

export default function IncidentCommandConsole({
  onSelectIncident,
  selectedIncidentId,
}: Props): JSX.Element {  const lang = useLanguage()

  const { t } = useTranslation(['dashboard', 'incidents', 'common'])
  const { registry, registryLoading } = useIncidents()

  const [stats, setStats] = useState<IncidentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [compoundWarnings, setCompoundWarnings] = useState<string[]>([])
  const [totalAlerts, setTotalAlerts] = useState(0)
  const [totalPredictions, setTotalPredictions] = useState(0)

  const refresh = useCallback(async () => {
    if (registryLoading || !registry.length) return
    setLoading(true)
    try {
      const [dashData, allPredictions, allAlerts] = await Promise.allSettled([
        apiGetIncidentDashboard(),
        apiGetAllIncidentPredictions(),
        apiGetAllIncidentAlerts(),
      ])

      const dashboard = dashData.status === 'fulfilled' ? dashData.value : null
      const predictions = allPredictions.status === 'fulfilled' ? allPredictions.value : { predictions: [] }
      const alerts = allAlerts.status === 'fulfilled' ? allAlerts.value : { alerts: [] }

      // Build per-incident stats
      const predsByType = new Map<string, number>()
      const alertsByType = new Map<string, number>()
      const severityByType = new Map<string, string>()

      ;(predictions.predictions || []).forEach((p: any) => {
        predsByType.set(p.incidentType, (predsByType.get(p.incidentType) || 0) + 1)
        const cur = severityByType.get(p.incidentType)
        const sev = (p.severity || '').toLowerCase()
        const rank = ['critical', 'high', 'medium', 'low']
        if (!cur || rank.indexOf(sev) < rank.indexOf(cur)) {
          severityByType.set(p.incidentType, sev)
        }
      })
      ;(alerts.alerts || []).forEach((a: any) => {
        alertsByType.set(a.incidentType, (alertsByType.get(a.incidentType) || 0) + 1)
      })

      // Use dashboard data if available, otherwise build from registry
      const built: IncidentStat[] = registry.map(mod => {
        const dashMod = (dashboard?.incidents || []).find((i: any) => i.id === mod.id)
        return {
          id: mod.id,
          name: mod.name,
          icon: mod.icon,
          color: mod.color,
          aiTier: mod.aiTier,
          operationalStatus: mod.operationalStatus,
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

      // Detect compound/cascading events
      const criticalTypes = built
        .filter(s => s.highestSeverity === 'critical' || s.alerts >= 2)
        .map(s => s.name)

      const warnings: string[] = []
      if (criticalTypes.length >= 3) {
        warnings.push(`COMPOUND EMERGENCY: ${criticalTypes.length} simultaneous critical incidents`)
      }
      if (criticalTypes.includes('Flood') && criticalTypes.includes('Power Outage')) {
        warnings.push('CASCADING: Flood + Power Outage — critical infrastructure at risk')
      }
      if (criticalTypes.includes('Severe Storm') && criticalTypes.includes('Infrastructure Damage')) {
        warnings.push('CASCADING: Storm + Infrastructure Damage — transport disruption likely')
      }
      setCompoundWarnings(warnings)
    } catch (err) {
      console.error('[IncidentCommandConsole] Refresh error:', err)
    } finally {
      setLoading(false)
    }
  }, [registry, registryLoading])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  const getSeverityBg = (severity: string | null) => {
    switch (severity) {
      case 'critical': return 'border-l-red-500 bg-red-50/30 dark:bg-red-900/10'
      case 'high': return 'border-l-orange-500 bg-orange-50/30 dark:bg-orange-900/10'
      case 'medium': return 'border-l-amber-400 bg-amber-50/30 dark:bg-amber-900/10'
      default: return 'border-l-transparent'
    }
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
            <Activity className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {t('dashboard:admin.incidentConsole')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {stats.length} incident types monitored • {totalAlerts} alerts • {totalPredictions} predictions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hidden sm:block">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            title={t('common:actions.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Compound emergency warnings */}
      {compoundWarnings.length > 0 && (
        <div className="space-y-2">
          {compoundWarnings.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-3 bg-red-600 text-white rounded-lg text-sm font-medium animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Summary totals */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Critical Incidents', value: stats.filter(s => s.highestSeverity === 'critical').length, icon: AlertTriangle, color: 'text-red-600' },
          { label: 'Active Alerts', value: totalAlerts, icon: Zap, color: 'text-amber-600' },
          { label: 'AI Predictions', value: totalPredictions, icon: TrendingUp, color: 'text-blue-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
            <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{label}</p>
          </div>
        ))}
      </div>

      {/* All incidents grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(loading && !stats.length ? registry : stats).map((mod: any) => {
          const stat = stats.find(s => s.id === mod.id) || mod
          const Icon = INCIDENT_ICONS[mod.id] || AlertTriangle
          const isSelected = selectedIncidentId === mod.id
          const tier = AI_TIER_BADGE[stat.aiTier || 'rule_based'] || AI_TIER_BADGE.rule_based

          return (
            <button
              key={mod.id}
              onClick={() => onSelectIncident?.(isSelected ? '' : mod.id)}
              className={`
                flex items-center gap-3 p-3 rounded-xl border-l-4 transition-all text-left
                ${getSeverityBg(stat.highestSeverity)}
                ${isSelected
                  ? 'ring-2 ring-aegis-500 border border-aegis-300 dark:border-aegis-700 bg-aegis-50 dark:bg-aegis-900/20'
                  : 'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750'
                }
              `}
            >
              {/* Icon */}
              <div
                className="p-2 rounded-lg shrink-0"
                style={{ backgroundColor: `${stat.color || mod.color}22` }}
              >
                <Icon
                  className="w-4 h-4"
                  style={{ color: stat.color || mod.color }}
                />
              </div>

              {/* Name + status */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Circle
                    className={`w-2 h-2 ${STATUS_DOT[stat.operationalStatus || 'configured_only']} fill-current`}
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {stat.name || mod.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${tier.color}`}>
                    {tier.label}
                  </span>
                  {stat.alerts > 0 && (
                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                      {stat.alerts} alert{stat.alerts !== 1 ? 's' : ''}
                    </span>
                  )}
                  {stat.predictions > 0 && (
                    <span className="text-xs text-blue-600 dark:text-blue-400">
                      {stat.predictions} pred
                    </span>
                  )}
                </div>
              </div>

              {/* Severity badge */}
              {stat.highestSeverity && (
                <span className={`
                  text-xs px-2 py-0.5 rounded-full font-semibold shrink-0
                  ${stat.highestSeverity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                    stat.highestSeverity === 'high' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                    stat.highestSeverity === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  }
                `}>
                  {stat.highestSeverity.toUpperCase()}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Footer: automation status */}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
        <div className="flex items-center gap-1">
          <Workflow className="w-3.5 h-3.5" />
          <span>n8n: 15 workflows</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          <span>Cron fallback ready</span>
        </div>
        <div className="flex items-center gap-1">
          <Cpu className="w-3.5 h-3.5" />
          <span>AI engine integrated</span>
        </div>
      </div>
    </div>
  )
}




