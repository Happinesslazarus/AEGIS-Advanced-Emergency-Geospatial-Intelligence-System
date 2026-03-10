/**
 * GuestDashboard.tsx — Public/Guest read-only dashboard
 *
 * Provides a read-only view of:
 * - Regional incident overview
 * - Active alerts
 * - Public safety guidance
 * - Read-only map visualization
 *
 * No authentication required.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Activity, MapPin, Shield, Bell, Clock,
  ChevronRight, Globe, RefreshCw, Droplets, CloudLightning,
  Thermometer, Flame, Mountain, ZapOff, Biohazard, Eye, Sun
} from 'lucide-react'
import { useIncidents } from '../contexts/IncidentContext'
import {
  apiGetAllIncidentAlerts,
  apiGetAllIncidentPredictions,
  apiGetIncidentDashboard,
  type IncidentAlert,
  type IncidentPrediction,
  type IncidentDashboardIncident,
} from '../utils/incidentApi'
import LanguageSelector from '../components/shared/LanguageSelector'

// ── Icon mapping ────────────────────────────────────────────────────────
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

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-400 text-gray-900',
  low: 'bg-blue-400 text-white',
}

const SEVERITY_BG: Record<string, string> = {
  critical: 'border-red-500 bg-red-50 dark:bg-red-900/20',
  high: 'border-orange-500 bg-orange-50 dark:bg-orange-900/20',
  medium: 'border-amber-400 bg-amber-50 dark:bg-amber-900/20',
  low: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20',
}

export default function GuestDashboard(): JSX.Element {
  const { t } = useTranslation(['common', 'incidents', 'alerts', 'dashboard'])
  const { registry, registryLoading } = useIncidents()

  const [alerts, setAlerts] = useState<IncidentAlert[]>([])
  const [predictions, setPredictions] = useState<IncidentPrediction[]>([])
  const [incidents, setIncidents] = useState<IncidentDashboardIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [dashRes, alertsRes, predsRes] = await Promise.allSettled([
        apiGetIncidentDashboard(),
        apiGetAllIncidentAlerts(),
        apiGetAllIncidentPredictions(),
      ])

      if (dashRes.status === 'fulfilled' && dashRes.value?.incidents) {
        setIncidents(dashRes.value.incidents)
      }
      if (alertsRes.status === 'fulfilled') {
        setAlerts(alertsRes.value?.alerts || [])
      }
      if (predsRes.status === 'fulfilled') {
        setPredictions(predsRes.value?.predictions || [])
      }
      setLastUpdated(new Date())
    } catch (err) {
      console.error('[GuestDashboard] Error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 60_000) // Refresh every minute
    return () => clearInterval(iv)
  }, [refresh])

  const criticalAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'high')
  const activeIncidents = incidents.filter(i => i.activeAlerts > 0 || i.activePredictions > 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  AEGIS <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">{t('common:guestDashboard', 'Public Dashboard')}</span>
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('common:tagline', 'Advanced Emergency Geospatial Intelligence System')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageSelector />
              <button
                onClick={refresh}
                disabled={loading}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Link
                to="/citizen/login"
                className="hidden sm:flex items-center gap-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
              >
                {t('common:signIn', 'Sign In')}
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Critical Alert Banner */}
      {criticalAlerts.length > 0 && (
        <div className="bg-red-600 text-white px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 animate-pulse" />
            <div className="flex-1">
              <span className="font-bold">{t('alerts:criticalWarning', 'CRITICAL ALERTS')}:</span>{' '}
              {criticalAlerts.slice(0, 3).map(a => a.title).join(' • ')}
              {criticalAlerts.length > 3 && ` (+${criticalAlerts.length - 3} more)`}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Status cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: t('dashboard:incidents.active', 'Active Incidents'),
              value: activeIncidents.length,
              icon: Activity,
              color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
            },
            {
              label: t('alerts:totalAlerts', 'Total Alerts'),
              value: alerts.length,
              icon: Bell,
              color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30',
            },
            {
              label: t('dashboard:incidents.monitoring', 'Types Monitored'),
              value: incidents.length || registry.length,
              icon: Eye,
              color: 'text-green-600 bg-green-100 dark:bg-green-900/30',
            },
            {
              label: t('dashboard:predictions.active', 'Predictions'),
              value: predictions.length,
              icon: Globe,
              color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className={`p-2 rounded-lg w-fit ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">{loading ? '...' : value}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Alerts */}
          <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                {t('alerts:activeAlerts', 'Active Alerts')}
              </h2>
              {lastUpdated && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[400px] overflow-y-auto">
              {alerts.length === 0 && !loading && (
                <div className="p-8 text-center text-gray-400">
                  <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>{t('alerts:noAlerts', 'No active alerts in your region')}</p>
                </div>
              )}
              {loading && alerts.length === 0 && (
                <div className="p-8 text-center text-gray-400">
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  <p>{t('common:loading', 'Loading...')}</p>
                </div>
              )}
              {alerts.slice(0, 10).map(alert => {
                const Icon = INCIDENT_ICONS[alert.incidentType] || AlertTriangle
                return (
                  <div
                    key={alert.id}
                    className={`px-5 py-3 border-l-4 ${SEVERITY_BG[alert.severity] || 'border-gray-300'}`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 mt-0.5 shrink-0 text-gray-600 dark:text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-sm text-gray-900 dark:text-white">{alert.title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${SEVERITY_COLORS[alert.severity] || 'bg-gray-200 text-gray-700'}`}>
                            {alert.severity.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{alert.message}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {alert.source} • {new Date(alert.issuedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Incident Types Status */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500" />
                {t('dashboard:incidents.status', 'Incident Status')}
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[400px] overflow-y-auto">
              {incidents.map(inc => {
                const Icon = INCIDENT_ICONS[inc.id] || AlertTriangle
                const hasActivity = inc.activeAlerts > 0 || inc.activePredictions > 0
                return (
                  <div key={inc.id} className="px-4 py-3 flex items-center gap-3">
                    <div
                      className="p-1.5 rounded-lg"
                      style={{ backgroundColor: `${inc.color}22` }}
                    >
                      <Icon className="w-4 h-4" style={{ color: inc.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{inc.name}</p>
                      <p className="text-xs text-gray-400">
                        {inc.activeAlerts > 0 && `${inc.activeAlerts} alert${inc.activeAlerts > 1 ? 's' : ''}`}
                        {inc.activeAlerts > 0 && inc.activePredictions > 0 && ' • '}
                        {inc.activePredictions > 0 && `${inc.activePredictions} prediction${inc.activePredictions > 1 ? 's' : ''}`}
                        {!hasActivity && t('dashboard:incidents.normal', 'Normal')}
                      </p>
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full ${hasActivity ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
                  </div>
                )
              })}
              {incidents.length === 0 && !loading && (
                <div className="p-6 text-center text-gray-400 text-sm">
                  {t('common:noData', 'No data available')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Safety Guidance */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-green-500" />
            {t('common:safetyGuidance', 'Public Safety Guidance')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                title: t('common:safety.stayInformed', 'Stay Informed'),
                desc: t('common:safety.stayInformedDesc', 'Monitor official alerts and follow instructions from local authorities.'),
                icon: Bell,
              },
              {
                title: t('common:safety.emergencyKit', 'Emergency Kit'),
                desc: t('common:safety.emergencyKitDesc', 'Keep an emergency kit ready with water, food, medications, and important documents.'),
                icon: Shield,
              },
              {
                title: t('common:safety.knowRoutes', 'Know Your Routes'),
                desc: t('common:safety.knowRoutesDesc', 'Familiarize yourself with evacuation routes and safe meeting points in your area.'),
                icon: MapPin,
              },
            ].map(({ title, desc, icon: Ico }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                <Ico className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA to sign in */}
        <div className="text-center py-4">
          <p className="text-gray-500 dark:text-gray-400 mb-3">
            {t('common:guestCTA', 'Sign in to access detailed reports, personal alerts, and incident reporting.')}
          </p>
          <div className="flex justify-center gap-3">
            <Link
              to="/citizen/login"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              {t('common:citizenAccess', 'Citizen Access')}
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              {t('common:operatorConsole', 'Operator Console')}
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-gray-400">
          <span>AEGIS v6 — Advanced Emergency Geospatial Intelligence System</span>
          <div className="flex items-center gap-4">
            <Link to="/about" className="hover:text-gray-600 dark:hover:text-gray-300">{t('common:about', 'About')}</Link>
            <Link to="/privacy" className="hover:text-gray-600 dark:hover:text-gray-300">{t('common:privacy', 'Privacy')}</Link>
            <Link to="/terms" className="hover:text-gray-600 dark:hover:text-gray-300">{t('common:terms', 'Terms')}</Link>
            <Link to="/accessibility" className="hover:text-gray-600 dark:hover:text-gray-300">{t('common:accessibility', 'Accessibility')}</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
