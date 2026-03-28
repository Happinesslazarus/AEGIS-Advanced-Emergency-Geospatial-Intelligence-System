 /*
 * GuestDashboard.tsx — Public/Guest read-only dashboard
 * Provides a read-only view of:
 * Regional incident overview
 * Active alerts
 * Public safety guidance
 * Read-only map visualization
 * No authentication required.
  */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { t as ct } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { resetConsent } from '../utils/cookiePreferences'
import { SEVERITY_PILL, SEVERITY_BG } from '../utils/colorTokens'
import {
  AlertTriangle, Activity, MapPin, Shield, Bell, Clock,
  ChevronRight, Globe, RefreshCw, Droplets, CloudLightning,
  Thermometer, Flame, Mountain, ZapOff, Biohazard, Eye, Sun,
  Menu, X, Radio, Users, Lock, LogIn, ArrowRight,
  Siren, ChevronDown, Wifi, WifiOff, Zap, Heart, BarChart3,
  Phone, BookOpen, FileText, TrendingUp, Satellite, Signal,
  ShieldCheck, Layers, Navigation, Compass, Search
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
import ThemeSelector from '../components/ui/ThemeSelector'
import { useTheme } from '../contexts/ThemeContext'
import { SkeletonCard, SkeletonList } from '../components/ui/Skeleton'

//  Icon mapping
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

const SEVERITY_COLORS = SEVERITY_PILL

// SEVERITY_BG imported from colorTokens

export default function GuestDashboard(): JSX.Element {
  const { t } = useTranslation(['common', 'incidents', 'alerts', 'dashboard'])
  const { registry, registryLoading } = useIncidents()
  const { dark } = useTheme()
  const lang = useLanguage()

  const [alerts, setAlerts] = useState<IncidentAlert[]>([])
  const [predictions, setPredictions] = useState<IncidentPrediction[]>([])
  const [incidents, setIncidents] = useState<IncidentDashboardIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [navSearchOpen, setNavSearchOpen] = useState(false)
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
    const iv = setInterval(refresh, 60_000)
    return () => clearInterval(iv)
  }, [refresh])

  const criticalAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'high')
  const activeIncidents = incidents.filter(i => i.activeAlerts > 0 || i.activePredictions > 0)

  // Threat level calculation
  const threatLevel = criticalAlerts.length > 2 ? 'SEVERE' : criticalAlerts.length > 0 ? 'ELEVATED' : activeIncidents.length > 0 ? 'GUARDED' : 'LOW'
  const threatColor = { SEVERE: 'text-red-500', ELEVATED: 'text-orange-500', GUARDED: 'text-amber-500', LOW: 'text-green-500' }[threatLevel]
  const threatBg = { SEVERE: 'bg-red-500/10 border-red-500/20', ELEVATED: 'bg-orange-500/10 border-orange-500/20', GUARDED: 'bg-amber-500/10 border-amber-500/20', LOW: 'bg-green-500/10 border-green-500/20' }[threatLevel]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-50/30 dark:from-gray-950 dark:via-surface-ultra-dark dark:to-gray-950">

      {/*
          MEGA NAVBAR — Dual-tier glassmorphic command center
           */}
      <header className="sticky top-0 z-50">
        {/*  Top accent line with animated gradient  */}
        <div className="h-[2px] bg-gradient-to-r from-aegis-600 via-amber-400 to-aegis-600 dark:from-aegis-500/60 dark:via-amber-400/80 dark:to-aegis-500/60 animate-gradient-x" style={{ backgroundSize: '200% 200%' }} />

        {/*  PRIMARY NAV BAR  */}
        <nav className="relative bg-white/95 dark:bg-surface-ultra-dark/95 backdrop-blur-2xl border-b border-gray-200/80 dark:border-white/[0.06] shadow-lg shadow-gray-200/40 dark:shadow-black/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">

              {/*  LEFT: Logo + Brand + System Status  */}
              <div className="flex items-center gap-3 min-w-0">
                <Link to="/" className="flex items-center gap-3 group flex-shrink-0">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-aegis-500 via-aegis-600 to-aegis-700 flex items-center justify-center shadow-xl shadow-aegis-500/30 group-hover:shadow-aegis-400/50 transition-all duration-300 group-hover:scale-105">
                      <Shield className="w-5.5 h-5.5 text-white drop-shadow-md" />
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    </div>
                    {/* Live pulse indicator */}
                    <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-400 border-2 border-white dark:border-surface-ultra-dark" />
                    </span>
                  </div>
                  <div className="hidden sm:block leading-none">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-base tracking-tight text-gray-900 dark:text-white">AEGIS</span>
                      <span className="text-[8px] font-bold bg-aegis-100 dark:bg-aegis-900/40 text-aegis-700 dark:text-aegis-300 px-1.5 py-0.5 rounded tracking-widest">v6</span>
                    </div>
                    <span className="block text-[9px] text-gray-400 dark:text-gray-300 dark:text-white/60 font-medium tracking-[0.2em] uppercase mt-0.5">{ct('guest.emergencyIntelligence',lang)}</span>
                  </div>
                </Link>

                {/* Separator */}
                <div className="hidden md:block w-px h-8 bg-gradient-to-b from-transparent via-gray-300 dark:via-white/10 to-transparent" />

                {/* Live status + threat level */}
                <div className="hidden md:flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 px-2.5 py-1.5 rounded-xl">
                    <div className="relative">
                      <Wifi className="w-3 h-3 text-green-500" />
                    </div>
                    <span className="text-[10px] font-bold text-green-600 dark:text-green-400">{ct('guest.live',lang)}</span>
                    <span className="text-[9px] text-gray-400 dark:text-gray-300 dark:text-white/50 font-medium">
                      {lastUpdated ? lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${threatBg} border px-2.5 py-1.5 rounded-xl`}>
                    <Signal className={`w-3 h-3 ${threatColor}`} />
                    <span className={`text-[10px] font-bold ${threatColor}`}>{threatLevel}</span>
                  </div>
                </div>
              </div>

              {/*  CENTER: Command stats + mini nav  */}
              <div className="hidden xl:flex items-center gap-3 mx-6">
                {/* Inline stats */}
                <div className="flex items-center gap-1 bg-gray-50/80 dark:bg-white/[0.03] border border-gray-200/60 dark:border-white/[0.06] rounded-2xl p-1">
                  {[
                    { label: ct('guest.stats.incidents',lang), value: activeIncidents.length, icon: Activity, color: activeIncidents.length > 0 ? 'text-red-500' : 'text-gray-400 dark:text-gray-300', pulse: activeIncidents.length > 0 },
                    { label: ct('guest.stats.alerts',lang), value: alerts.length, icon: Bell, color: alerts.length > 0 ? 'text-amber-500' : 'text-gray-400 dark:text-gray-300', pulse: false },
                    { label: ct('guest.stats.critical',lang), value: criticalAlerts.length, icon: AlertTriangle, color: criticalAlerts.length > 0 ? 'text-red-600' : 'text-gray-400 dark:text-gray-300', pulse: criticalAlerts.length > 0 },
                    { label: ct('guest.stats.forecasts',lang), value: predictions.length, icon: TrendingUp, color: predictions.length > 0 ? 'text-aegis-500' : 'text-gray-400 dark:text-gray-300', pulse: false },
                  ].map(s => (
                    <div key={s.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors cursor-default group">
                      <s.icon className={`w-3.5 h-3.5 ${s.color} ${s.pulse ? 'animate-pulse' : ''}`} />
                      <span className={`text-xs font-bold tabular-nums ${s.color}`}>{loading ? '—' : s.value}</span>
                      <span className="text-[9px] text-gray-400 dark:text-gray-300 dark:text-white/50 font-medium hidden 2xl:inline">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/*  RIGHT: Action controls  */}
              <div className="flex items-center gap-1 sm:gap-1.5">
                {/* Refresh */}
                <button onClick={refresh} disabled={loading} title={ct('guest.refreshAll',lang)}
                  className="relative p-2.5 rounded-xl text-gray-400 dark:text-gray-300 dark:text-white/60 hover:text-aegis-500 hover:bg-aegis-50 dark:hover:bg-aegis-500/10 transition-all active:scale-95 group">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-aegis-500' : 'group-hover:rotate-45 transition-transform duration-300'}`} />
                </button>

                {/* Theme toggle */}
                <ThemeSelector darkNav={dark} />

                {/* Language */}
                <LanguageSelector darkNav={dark} />

                {/* Separator */}
                <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-white/8 mx-0.5" />

                {/* Sign In dropdown */}
                <div className="relative" ref={signInRef}>
                  <button onClick={() => setSignInOpen(v => !v)}
                    className="hidden sm:flex items-center gap-2 bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-400 hover:to-aegis-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95 shadow-lg shadow-aegis-500/25 hover:shadow-aegis-400/40 group">
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{ct('guest.signIn',lang)}</span>
                    <ChevronDown className={`w-3 h-3 opacity-70 transition-transform duration-200 ${signInOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {signInOpen && (
                    <div className="absolute right-0 top-full mt-2.5 w-64 bg-white dark:bg-surface-ultra-dark backdrop-blur-2xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/20 dark:shadow-black/60 overflow-hidden z-50 animate-scale-in">
                      <div className="px-4 py-3 bg-gradient-to-r from-aegis-50 dark:from-aegis-950/30 to-transparent border-b border-gray-200 dark:border-white/8">
                        <p className="text-[10px] text-aegis-600 dark:text-aegis-400 font-bold uppercase tracking-[0.15em]">{ct('guest.choosePortal',lang)}</p>
                      </div>
                      <div className="p-2 space-y-1">
                        <Link to="/citizen/login" onClick={() => setSignInOpen(false)}
                          className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-aegis-50 dark:hover:bg-white/5 transition-all group">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-500/15 to-aegis-600/15 dark:from-aegis-500/20 dark:to-aegis-600/20 flex items-center justify-center group-hover:from-aegis-500/25 group-hover:to-aegis-600/25 transition-all">
                            <Users className="w-4 h-4 text-aegis-500 dark:text-aegis-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-bold text-gray-900 dark:text-white">{ct('guest.citizenPortal',lang)}</p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-300 dark:text-white/60">{ct('guest.citizenPortalDesc',lang)}</p>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-300 dark:text-white/30 group-hover:text-aegis-400 group-hover:translate-x-0.5 transition-all" />
                        </Link>
                        <Link to="/admin" onClick={() => setSignInOpen(false)}
                          className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/5 transition-all group">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500/10 to-red-600/10 dark:from-red-500/15 dark:to-red-600/15 flex items-center justify-center group-hover:from-red-500/20 group-hover:to-red-600/20 transition-all">
                            <Lock className="w-4 h-4 text-red-500 dark:text-red-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-bold text-gray-900 dark:text-white">{ct('guest.operatorConsole',lang)}</p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-300 dark:text-white/60">{ct('guest.operatorConsoleDesc',lang)}</p>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-300 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      </div>
                      <div className="px-4 py-3 border-t border-gray-100 dark:border-white/6 bg-gray-50/50 dark:bg-white/[0.02]">
                        <Link to="/citizen/login" onClick={() => setSignInOpen(false)}
                          className="text-[11px] text-aegis-600 dark:text-aegis-400 hover:text-aegis-500 dark:hover:text-aegis-300 transition-colors font-medium">
                          {ct('guest.newHere',lang)} <span className="font-bold underline underline-offset-2">{ct('guest.createFreeAccount',lang)} →</span>
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mobile sign-in */}
                <Link to="/citizen/login"
                  className="sm:hidden flex items-center gap-1.5 bg-gradient-to-r from-aegis-500 to-aegis-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-95 shadow-lg shadow-aegis-500/30">
                  <LogIn className="w-3.5 h-3.5" />
                </Link>

                {/* Mobile hamburger */}
                <button onClick={() => setMobileOpen(v => !v)}
                  className="sm:hidden p-2 rounded-xl text-gray-500 dark:text-gray-300 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/8 transition-all">
                  {mobileOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>
          </div>

          {/*  SECONDARY NAV — Feature links row  */}
          <div className="hidden md:block border-t border-gray-100 dark:border-white/[0.04] bg-gray-50/50 dark:bg-white/[0.015]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-10">
                <div className="flex items-center gap-0.5">
                  {[
                    { icon: Activity, label: ct('guest.nav.liveOverview',lang), active: true },
                    { icon: MapPin, label: ct('guest.nav.incidentMap',lang), href: '/citizen' },
                    { icon: Bell, label: ct('guest.nav.allAlerts',lang) },
                    { icon: BarChart3, label: ct('guest.nav.analytics',lang) },
                    { icon: BookOpen, label: ct('guest.nav.safetyGuide',lang) },
                    { icon: Phone, label: ct('guest.nav.emergencyContacts',lang) },
                  ].map((item, i) => (
                    item.href ? (
                      <Link key={i} to={item.href} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-300 dark:text-white/40 hover:text-aegis-600 dark:hover:text-aegis-400 hover:bg-aegis-50/80 dark:hover:bg-aegis-500/5 rounded-lg transition-all">
                        <item.icon className="w-3.5 h-3.5" />
                        {item.label}
                      </Link>
                    ) : (
                      <button key={i} className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${item.active ? 'text-aegis-600 dark:text-aegis-400 bg-aegis-50 dark:bg-aegis-500/10' : 'text-gray-500 dark:text-gray-300 dark:text-white/40 hover:text-aegis-600 dark:hover:text-aegis-400 hover:bg-aegis-50/80 dark:hover:bg-aegis-500/5'}`}>
                        <item.icon className="w-3.5 h-3.5" />
                        {item.label}
                        {item.active && <div className="w-1 h-1 rounded-full bg-aegis-500 dark:bg-aegis-400 ml-0.5" />}
                      </button>
                    )
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-300 font-medium">
                  <Satellite className="w-3 h-3" />
                  <span>{ct('guest.lastSync',lang)}: {lastUpdated ? lastUpdated.toLocaleTimeString() : ct('guest.connecting',lang)}</span>
                </div>
              </div>
            </div>
          </div>

          {/*  Mobile menu  */}
          {mobileOpen && (
            <div className="sm:hidden border-t border-gray-200 dark:border-white/8 bg-white dark:bg-surface-ultra-dark px-4 py-4 space-y-2 animate-scale-in">
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center p-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/8">
                  <p className="text-lg font-black text-gray-900 dark:text-white">{loading ? '—' : activeIncidents.length}</p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-300 dark:text-white/35 font-bold uppercase tracking-wider">{ct('guest.stats.incidents',lang)}</p>
                </div>
                <div className="text-center p-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/8">
                  <p className="text-lg font-black text-gray-900 dark:text-white">{loading ? '—' : alerts.length}</p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-300 dark:text-white/35 font-bold uppercase tracking-wider">{ct('guest.stats.alerts',lang)}</p>
                </div>
                <div className={`text-center p-2.5 rounded-xl ${threatBg} border`}>
                  <p className={`text-lg font-black ${threatColor}`}>{threatLevel}</p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-300 dark:text-white/35 font-bold uppercase tracking-wider">{ct('guest.stats.threat',lang)}</p>
                </div>
              </div>
              {[
                { to: '/citizen/login', icon: Users, label: ct('guest.citizenPortal',lang), sub: ct('guest.citizenPortalDesc',lang), gradient: 'from-aegis-500/10 to-aegis-600/10' },
                { to: '/admin', icon: Lock, label: ct('guest.operatorConsole',lang), sub: ct('guest.mobile.restricted',lang), gradient: 'from-red-500/10 to-red-600/10' },
                { to: '/citizen/login', icon: Heart, label: ct('guest.mobile.createAccount',lang), sub: ct('guest.mobile.freeForAll',lang), gradient: 'from-green-500/10 to-emerald-500/10' },
              ].map(item => (
                <Link key={item.label} to={item.to} onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r ${item.gradient} hover:opacity-80 transition-all border border-gray-200/50 dark:border-white/5`}>
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-white/10 flex items-center justify-center">
                    <item.icon className="w-4 h-4 text-aegis-500 dark:text-aegis-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{item.label}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-300 dark:text-white/40">{item.sub}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-300 ml-auto" />
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/*  Alert ticker / banner  */}
        {criticalAlerts.length > 0 ? (
          <div className="bg-gradient-to-r from-red-700 via-red-600 to-red-700 border-b border-red-500/50 shadow-lg shadow-red-900/30">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
              <div className="flex items-center gap-2 flex-shrink-0 bg-white/15 rounded-lg px-2.5 py-1">
                <Siren className="w-3.5 h-3.5 text-white animate-pulse" />
                <span className="text-[10px] font-extrabold text-white uppercase tracking-wider">{ct('guest.liveAlert',lang)}</span>
              </div>
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
                {criticalAlerts.length} {ct('guest.active',lang)}
              </span>
            </div>
          </div>
        ) : alerts.length > 0 ? (
          <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 backdrop-blur-sm border-b border-amber-400/40">
            <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-amber-100 flex-shrink-0" />
              <span className="text-[11px] text-amber-50 font-medium">
                {alerts.length} active alert{alerts.length !== 1 ? 's' : ''} in your region —{' '}
                <span className="font-bold">{alerts.slice(0, 2).map(a => a.title).join(', ')}</span>
                {alerts.length > 2 && ` +${alerts.length - 2} more`}
              </span>
            </div>
          </div>
        ) : null}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/*  HERO OVERVIEW SECTION  */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-aegis-600 via-aegis-500 to-blue-600 dark:from-aegis-900 dark:via-aegis-800 dark:to-blue-900 p-6 sm:p-8 text-white shadow-2xl" style={{ boxShadow: '0 8px 40px rgba(var(--glow-color), 0.15)' }}>
          <div className="absolute inset-0 opacity-[0.07]">
            <svg width="100%" height="100%"><defs><pattern id="guestGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="white" strokeWidth="0.5"/></pattern></defs><rect width="100%" height="100%" fill="url(#guestGrid)"/></svg>
          </div>
          <div className="absolute top-0 right-0 w-72 h-72 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-56 h-56 bg-blue-400/10 rounded-full translate-y-1/2 -translate-x-1/4 blur-3xl" />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> {ct('guest.hero.badge',lang)}
                </span>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${threatLevel === 'LOW' ? 'bg-green-500/30 text-green-200' : threatLevel === 'GUARDED' ? 'bg-amber-500/30 text-amber-200' : threatLevel === 'ELEVATED' ? 'bg-orange-500/30 text-orange-200' : 'bg-red-500/30 text-red-200'}`}>
                  {threatLevel} {ct('guest.hero.threat',lang)}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black mb-1.5 leading-tight">{ct('guest.hero.title',lang)}</h1>
              <p className="text-sm text-white/80 max-w-lg">{ct('guest.hero.description',lang)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/citizen" className="bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/20 px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-lg">
                <MapPin className="w-4 h-4" /> {ct('guest.hero.fullMapView',lang)}
              </Link>
              <Link to="/citizen/login" className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-lg shadow-amber-500/30">
                <Zap className="w-4 h-4" /> {ct('guest.hero.getPersonalAlerts',lang)}
              </Link>
            </div>
          </div>
        </div>

        {/*  STATUS CARDS — Glassmorphic with glow  */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 stagger-children">
          {[
            { label: t('dashboard:incidents.active', 'Active Incidents'), value: activeIncidents.length, icon: Activity, gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/15', iconBg: 'bg-blue-500/10' },
            { label: t('alerts:totalAlerts', 'Total Alerts'), value: alerts.length, icon: Bell, gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/15', iconBg: 'bg-amber-500/10' },
            { label: t('dashboard:incidents.monitoring', 'Types Monitored'), value: incidents.length || registry.length, icon: Eye, gradient: 'from-green-500 to-emerald-600', shadow: 'shadow-green-500/15', iconBg: 'bg-green-500/10' },
            { label: t('dashboard:predictions.active', 'Predictions'), value: predictions.length, icon: TrendingUp, gradient: 'from-purple-500 to-violet-600', shadow: 'shadow-purple-500/15', iconBg: 'bg-purple-500/10' },
          ].map(({ label, value, icon: Icon, gradient, shadow, iconBg }) => (
            <div key={label} className={`glass-card rounded-2xl p-5 hover-lift transition-all duration-300 ${shadow}`}>
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-3xl font-black text-gray-900 dark:text-white tabular-nums">{loading ? '—' : value}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-300 font-bold uppercase tracking-wider mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/*  Active Alerts — Enhanced  */}
          <div className="lg:col-span-2 glass-card rounded-2xl overflow-hidden shadow-lg">
            <div className="px-5 py-4 border-b border-gray-200/50 dark:border-white/[0.06] flex items-center justify-between">
              <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-md">
                  <Bell className="w-4 h-4 text-white" />
                </div>
                {t('alerts:activeAlerts', 'Active Alerts')}
                {alerts.length > 0 && <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">{alerts.length}</span>}
              </h2>
              {lastUpdated && (
                <span className="text-[10px] text-gray-400 dark:text-gray-300 dark:text-white/30 flex items-center gap-1 font-medium">
                  <Clock className="w-3 h-3" />
                  {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04] max-h-[420px] overflow-y-auto custom-scrollbar">
              {alerts.length === 0 && !loading && (
                <div className="p-10 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center mx-auto mb-3">
                    <ShieldCheck className="w-7 h-7 text-green-500" />
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">{ct('guest.allClear',lang)}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-300 dark:text-white/40 mt-1">{t('alerts:noAlerts', 'No active alerts in your region')}</p>
                </div>
              )}
              {loading && alerts.length === 0 && (
                <div className="p-4 space-y-3">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              )}
              {alerts.slice(0, 10).map(alert => {
                const Icon = INCIDENT_ICONS[alert.incidentType] || AlertTriangle
                return (
                  <div key={alert.id} className={`px-5 py-3.5 border-l-4 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors ${SEVERITY_BG[alert.severity] || 'border-gray-300'}`}>
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 mt-0.5 shrink-0 text-gray-600 dark:text-gray-300" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-sm text-gray-900 dark:text-white">{alert.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${SEVERITY_COLORS[alert.severity] || 'bg-gray-200 text-gray-700'}`}>
                            {alert.severity.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-300 line-clamp-2">{alert.message}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-300 dark:text-white/30 mt-1 font-medium">
                          {alert.source} • {new Date(alert.issuedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/*  Incident Types Status — Enhanced  */}
          <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
            <div className="px-5 py-4 border-b border-gray-200/50 dark:border-white/[0.06]">
              <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center shadow-md">
                  <Activity className="w-4 h-4 text-white" />
                </div>
                {t('dashboard:incidents.status', 'Incident Status')}
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04] max-h-[420px] overflow-y-auto custom-scrollbar">
              {incidents.map(inc => {
                const Icon = INCIDENT_ICONS[inc.id] || AlertTriangle
                const hasActivity = inc.activeAlerts > 0 || inc.activePredictions > 0
                return (
                  <div key={inc.id} className="px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="p-2 rounded-xl" style={{ backgroundColor: `${inc.color}15` }}>
                      <Icon className="w-4.5 h-4.5" style={{ color: inc.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{inc.name}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-300 dark:text-white/35 font-medium">
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
              {loading && incidents.length === 0 && (
                <div className="p-4 space-y-3">
                  <SkeletonList count={4} />
                </div>
              )}
              {incidents.length === 0 && !loading && (
                <div className="p-6 text-center text-gray-400 dark:text-gray-300 text-sm">{t('common:noData', 'No data available')}</div>
              )}
            </div>
          </div>
        </div>

        {/*  SAFETY GUIDANCE — Enhanced with visual cards  */}
        <div className="glass-card rounded-2xl p-6 shadow-lg">
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-md">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            {t('common:safetyGuidance', 'Public Safety Guidance')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: t('common:safety.stayInformed', 'Stay Informed'), desc: t('common:safety.stayInformedDesc', 'Monitor official alerts and follow instructions from local authorities.'), icon: Bell, gradient: 'from-blue-500 to-indigo-600' },
              { title: t('common:safety.emergencyKit', 'Emergency Kit'), desc: t('common:safety.emergencyKitDesc', 'Keep an emergency kit ready with water, food, medications, and important documents.'), icon: Shield, gradient: 'from-amber-500 to-orange-600' },
              { title: t('common:safety.knowRoutes', 'Know Your Routes'), desc: t('common:safety.knowRoutesDesc', 'Familiarize yourself with evacuation routes and safe meeting points in your area.'), icon: Navigation, gradient: 'from-green-500 to-emerald-600' },
            ].map(({ title, desc, icon: Ico, gradient }) => (
              <div key={title} className="p-4 rounded-xl bg-gray-50/80 dark:bg-white/[0.03] border border-gray-200/60 dark:border-white/[0.06] hover:border-aegis-300/50 dark:hover:border-aegis-500/20 transition-all hover-lift group">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md mb-3 group-hover:scale-105 transition-transform`}>
                  <Ico className="w-5 h-5 text-white" />
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">{title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-300 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/*  CTA — Polished sign-in prompt  */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 dark:from-gray-800 dark:via-gray-900 dark:to-gray-800 p-8 text-center shadow-2xl">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-aegis-500/30 rounded-full blur-[100px]" />
          </div>
          <div className="relative z-10">
            <h3 className="text-xl font-black text-white mb-2">{ct('guest.cta.title',lang)}</h3>
            <p className="text-gray-400 dark:text-gray-300 text-sm max-w-md mx-auto mb-5">
              {t('common:guestCTA', 'Sign in to access detailed reports, personal alerts, and incident reporting.')}
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/citizen/login"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-400 hover:to-aegis-500 text-white px-6 py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] shadow-xl shadow-aegis-500/25">
                {t('common:citizenAccess', 'Citizen Access')}
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link to="/admin"
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white border border-white/15 hover:border-white/25 px-6 py-3 rounded-xl font-bold text-sm transition-all">
                {t('common:operatorConsole', 'Operator Console')}
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/*  Footer — Enhanced  */}
      <footer className="border-t border-gray-200 dark:border-white/[0.06] bg-white/80 dark:bg-surface-ultra-dark/80 backdrop-blur-lg py-6 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center">
                <Shield className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-300 dark:text-white/40 font-medium">{t('common:app.name')} v6 — {t('common:app.fullName')}</span>
            </div>
            <div className="flex items-center gap-5 text-xs text-gray-400 dark:text-gray-300 dark:text-white/30">
              <Link to="/about" className="hover:text-gray-600 dark:hover:text-white/60 transition-colors">{t('common:about', 'About')}</Link>
              <Link to="/privacy" className="hover:text-gray-600 dark:hover:text-white/60 transition-colors">{t('common:privacy', 'Privacy')}</Link>
              <Link to="/terms" className="hover:text-gray-600 dark:hover:text-white/60 transition-colors">{t('common:terms', 'Terms')}</Link>
              <Link to="/accessibility" className="hover:text-gray-600 dark:hover:text-white/60 transition-colors">{t('common:accessibility', 'Accessibility')}</Link>
              <button onClick={resetConsent} className="hover:text-gray-600 dark:hover:text-white/60 transition-colors">{t('common:footer.cookiePreferences', 'Cookie Preferences')}</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
