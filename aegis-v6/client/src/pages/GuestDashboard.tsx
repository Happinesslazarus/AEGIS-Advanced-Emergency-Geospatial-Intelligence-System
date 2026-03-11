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

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Activity, MapPin, Shield, Bell, Clock,
  ChevronRight, Globe, RefreshCw, Droplets, CloudLightning,
  Thermometer, Flame, Mountain, ZapOff, Biohazard, Eye, Sun,
  Moon, Menu, X, Radio, Users, Lock, LogIn, ArrowRight,
  Siren, ChevronDown, Wifi, WifiOff
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
import { useTheme } from '../contexts/ThemeContext'

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
  const { dark, toggle: toggleTheme } = useTheme()

  const [alerts, setAlerts] = useState<IncidentAlert[]>([])
  const [predictions, setPredictions] = useState<IncidentPrediction[]>([])
  const [incidents, setIncidents] = useState<IncidentDashboardIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const signInRef = useRef<HTMLDivElement>(null)

  // Close sign-in dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (signInRef.current && !signInRef.current.contains(e.target as Node)) setSignInOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">

      {/* ══════════════════════════════════════════════════════════
          MAIN NAVBAR — Glassmorphic dark gradient
          ══════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50">
        <nav className="bg-gradient-to-r from-slate-900/98 via-aegis-900/95 to-slate-900/98 backdrop-blur-xl border-b border-white/8 shadow-2xl shadow-black/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">

              {/* ── LEFT: Logo ── */}
              <div className="flex items-center gap-3 min-w-0">
                <Link to="/" className="flex items-center gap-2.5 group flex-shrink-0">
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-900/40 group-hover:shadow-aegis-500/30 transition-all group-hover:scale-105">
                    <Shield className="w-5 h-5 text-white" />
                    {/* live pulse ring */}
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-slate-900 animate-pulse" />
                  </div>
                  <div className="hidden sm:block leading-none">
                    <span className="font-extrabold text-white text-sm tracking-wide">AEGIS</span>
                    <span className="block text-[9px] text-white/45 font-medium tracking-widest uppercase">Public Dashboard</span>
                  </div>
                </Link>

                {/* Live status pill */}
                <div className="hidden md:flex items-center gap-1.5 bg-green-500/12 border border-green-500/20 px-2.5 py-1 rounded-full">
                  <Wifi className="w-3 h-3 text-green-400" />
                  <span className="text-[10px] font-semibold text-green-300">Live</span>
                  <span className="text-[10px] text-white/35">
                    {lastUpdated ? lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>
              </div>

              {/* ── CENTER: Quick stats ── */}
              <div className="hidden lg:flex items-center gap-1 mx-4">
                {[
                  { label: 'Incidents', value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-red-300' : 'text-white/50', dot: activeIncidents.length > 0 ? 'bg-red-400' : 'bg-white/20' },
                  { label: 'Alerts', value: alerts.length, color: alerts.length > 0 ? 'text-amber-300' : 'text-white/50', dot: alerts.length > 0 ? 'bg-amber-400' : 'bg-white/20' },
                  { label: 'Critical', value: criticalAlerts.length, color: criticalAlerts.length > 0 ? 'text-red-400' : 'text-white/50', dot: criticalAlerts.length > 0 ? 'bg-red-500 animate-pulse' : 'bg-white/20' },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/8 border border-white/6 px-3 py-1.5 rounded-lg transition-colors cursor-default">
                    <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <span className={`text-[11px] font-bold tabular-nums ${s.color}`}>{loading ? '—' : s.value}</span>
                    <span className="text-[10px] text-white/30">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* ── RIGHT: Controls ── */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Refresh */}
                <button onClick={refresh} disabled={loading} title="Refresh data"
                  className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/8 transition-all active:scale-95">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-aegis-400' : ''}`} />
                </button>

                {/* Theme toggle */}
                <button onClick={toggleTheme} title="Toggle theme"
                  className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/8 transition-all active:scale-95">
                  {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>

                {/* Language */}
                <LanguageSelector darkNav className="hidden sm:flex" />

                {/* Sign In dropdown */}
                <div className="relative" ref={signInRef}>
                  <button onClick={() => setSignInOpen(v => !v)}
                    className="hidden sm:flex items-center gap-1.5 bg-white/10 hover:bg-white/15 border border-white/15 hover:border-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition-all active:scale-95">
                    <LogIn className="w-3.5 h-3.5" />
                    Sign In
                    <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${signInOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {signInOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-slate-900/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                      <div className="px-4 py-3 border-b border-white/8">
                        <p className="text-[10px] text-white/40 font-semibold uppercase tracking-widest">Choose your portal</p>
                      </div>
                      <div className="p-1.5 space-y-0.5">
                        <Link to="/citizen/login" onClick={() => setSignInOpen(false)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors group">
                          <div className="w-7 h-7 rounded-lg bg-aegis-600/20 flex items-center justify-center group-hover:bg-aegis-600/30 transition-colors">
                            <Users className="w-3.5 h-3.5 text-aegis-400" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-white">Citizen Portal</p>
                            <p className="text-[9px] text-white/40">Report & receive alerts</p>
                          </div>
                          <ArrowRight className="w-3 h-3 text-white/20 ml-auto group-hover:text-white/50 transition-colors" />
                        </Link>
                        <Link to="/admin" onClick={() => setSignInOpen(false)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors group">
                          <div className="w-7 h-7 rounded-lg bg-red-600/20 flex items-center justify-center group-hover:bg-red-600/30 transition-colors">
                            <Lock className="w-3.5 h-3.5 text-red-400" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-white">Operator Login</p>
                            <p className="text-[9px] text-white/40">Admin & operator access</p>
                          </div>
                          <ArrowRight className="w-3 h-3 text-white/20 ml-auto group-hover:text-white/50 transition-colors" />
                        </Link>
                      </div>
                      <div className="px-4 py-2.5 border-t border-white/8">
                        <Link to="/citizen/register" onClick={() => setSignInOpen(false)}
                          className="text-[10px] text-aegis-400 hover:text-aegis-300 transition-colors">
                          Don't have an account? <span className="font-semibold underline">Register free →</span>
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mobile: Sign In simple link */}
                <Link to="/citizen/login"
                  className="sm:hidden flex items-center gap-1 bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all active:scale-95">
                  <LogIn className="w-3.5 h-3.5" />
                </Link>

                {/* Mobile hamburger */}
                <button onClick={() => setMobileOpen(v => !v)}
                  className="sm:hidden p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/8 transition-all">
                  {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* ── Mobile menu ── */}
          {mobileOpen && (
            <div className="sm:hidden border-t border-white/8 bg-slate-900/98 px-4 py-3 space-y-1">
              {[
                { to: '/citizen/login', icon: Users, label: 'Citizen Sign In', sub: 'Report & receive alerts' },
                { to: '/admin', icon: Lock, label: 'Operator Login', sub: 'Restricted access' },
                { to: '/citizen/register', icon: ArrowRight, label: 'Register Account', sub: 'Free for residents' },
              ].map(item => (
                <Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors">
                  <item.icon className="w-4 h-4 text-aegis-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <p className="text-[10px] text-white/40">{item.sub}</p>
                  </div>
                </Link>
              ))}
              <div className="pt-2 border-t border-white/8 flex items-center gap-3 text-[11px] text-white/35">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  <span>{criticalAlerts.length} critical</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>{alerts.length} alerts</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span>{activeIncidents.length} incidents</span>
                </div>
              </div>
            </div>
          )}
        </nav>

        {/* ── Alert ticker / banner ── */}
        {criticalAlerts.length > 0 ? (
          <div className="bg-gradient-to-r from-red-700 via-red-600 to-red-700 border-b border-red-500/50 shadow-lg shadow-red-900/30">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
              <div className="flex items-center gap-2 flex-shrink-0 bg-white/15 rounded-lg px-2.5 py-1">
                <Siren className="w-3.5 h-3.5 text-white animate-pulse" />
                <span className="text-[10px] font-extrabold text-white uppercase tracking-wider">Live Alert</span>
              </div>
              {/* Scrolling ticker */}
              <div className="flex-1 overflow-hidden">
                <div className="flex gap-8 animate-marquee whitespace-nowrap">
                  {[...criticalAlerts, ...criticalAlerts].map((a, i) => (
                    <span key={i} className="text-[11px] text-white/90 font-medium inline-flex items-center gap-2">
                      <span className="text-red-200">◆</span>
                      {a.title}
                      {a.location?.name && <span className="text-red-200/70">— {a.location.name}</span>}
                    </span>
                  ))}
                </div>
              </div>
              <span className="flex-shrink-0 text-[10px] text-red-200/60 hidden sm:inline">
                {criticalAlerts.length} active
              </span>
            </div>
          </div>
        ) : alerts.length > 0 ? (
          <div className="bg-amber-600/90 backdrop-blur-sm border-b border-amber-500/40">
            <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-amber-200 flex-shrink-0" />
              <span className="text-[11px] text-amber-100 font-medium">
                {alerts.length} active alert{alerts.length !== 1 ? 's' : ''} in your region —{' '}
                <span className="font-semibold">{alerts.slice(0, 2).map(a => a.title).join(', ')}</span>
                {alerts.length > 2 && ` +${alerts.length - 2} more`}
              </span>
            </div>
          </div>
        ) : null}
      </header>
      {/* Add marquee animation to global styles inline */}
      <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}.animate-marquee{animation:marquee 25s linear infinite}`}</style>

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
          <span>{t('common:app.name')} v6 — {t('common:app.fullName')}</span>
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
