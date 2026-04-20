/**
 * Read-only public dashboard for visitors who want to see live data without
 * creating an account. Shows current alerts, the disaster map, recent reports
 * (anonymised), and regional risk information. No personal data is stored.
 *
 * - Routed by client/src/App.tsx at /guest
 * - Reads from AlertsContext and the public reports API endpoints
 * - Linked from LandingPage.tsx ("Continue as Guest" button)
 *
 * - client/src/pages/LandingPage.tsx — entry point that leads here
 * - client/src/pages/CitizenPage.tsx — a richer public view with form submission
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { t as ct } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { resetConsent } from '../utils/cookiePreferences'
import { SEVERITY_PILL, SEVERITY_BG, SEVERITY_HEX } from '../utils/colorTokens'
import {
  AlertTriangle, Activity, MapPin, Shield, Bell, Clock,
  ChevronRight, Globe, RefreshCw, Droplets, CloudLightning,
  Thermometer, Flame, Mountain, ZapOff, Biohazard, Eye, Sun,
  Menu, X, Radio, Users, Lock, LogIn, ArrowRight,
  Siren, ChevronDown, Wifi, WifiOff, Zap, Heart, BarChart3,
  Phone, BookOpen, FileText, TrendingUp, Satellite, Signal,
  ShieldCheck, Layers, Navigation, Compass, Search,
  CloudRain, Wind, PhoneCall, Megaphone, AlertCircle, ScanEye,
  Sparkles, Timer, Map, AlertOctagon
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

/* ── Style injection for guest welcome animations ── */
const GD_STYLE_ID = 'guest-dashboard-animations'
function injectGuestAnimations() {
  if (document.getElementById(GD_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = GD_STYLE_ID
  style.textContent = `
    @keyframes gdFadeUp    { from { opacity:0; transform:translateY(24px) } to { opacity:1; transform:translateY(0) } }
    @keyframes gdScaleIn   { from { opacity:0; transform:scale(.92) } to { opacity:1; transform:scale(1) } }
    @keyframes gdFloat     { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-12px) } }
    @keyframes gdFloat2    { 0%,100% { transform:translateY(0) rotate(0deg) } 50% { transform:translateY(-8px) rotate(3deg) } }
    @keyframes gdPulseRing { 0% { transform:scale(.8); opacity:.6 } 100% { transform:scale(2.2); opacity:0 } }
    @keyframes gdShimmer   { from { background-position:-200% 0 } to { background-position:200% 0 } }
    @keyframes gdGradient  { 0%,100% { background-position:0% 50% } 50% { background-position:100% 50% } }
    @keyframes gdTyping    { from { width:0 } to { width:100% } }
    @keyframes gdBlink     { 0%,100% { opacity:1 } 50% { opacity:0 } }
    @keyframes gdOrbit     { from { transform:rotate(0deg) translateX(120px) rotate(0deg) } to { transform:rotate(360deg) translateX(120px) rotate(-360deg) } }
    @keyframes gdSlideIn   { from { opacity:0; transform:translateX(-16px) } to { opacity:1; transform:translateX(0) } }
    @keyframes gdCountUp   { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
    .gd-fade-up   { animation: gdFadeUp .7s cubic-bezier(.22,1,.36,1) both }
    .gd-scale-in  { animation: gdScaleIn .6s cubic-bezier(.22,1,.36,1) both }
    .gd-float     { animation: gdFloat 5s ease-in-out infinite }
    .gd-float2    { animation: gdFloat2 7s ease-in-out infinite }
    .gd-shimmer   { background:linear-gradient(90deg,transparent 30%,rgba(255,255,255,.15) 50%,transparent 70%); background-size:200% 100%; animation:gdShimmer 3s linear infinite }
    .gd-gradient  { background-size:200% 200%; animation:gdGradient 6s ease infinite }
    .gd-orbit     { animation: gdOrbit 20s linear infinite }
    .gd-slide-in  { animation: gdSlideIn .5s cubic-bezier(.22,1,.36,1) both }
    .gd-count-up  { animation: gdCountUp .4s ease-out both }
  `
  document.head.appendChild(style)
}

/* ── Animated counter ── */
function AnimatedCounter({ value, duration = 1400, className = '' }: { value: number; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)
  useEffect(() => {
    const from = prevRef.current
    const diff = value - from
    if (diff === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value); prevRef.current = value; return
    }
    const steps = 40
    const stepTime = duration / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      const progress = step / steps
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(from + diff * eased))
      if (step >= steps) { setDisplay(value); clearInterval(timer); prevRef.current = value }
    }, stepTime)
    return () => clearInterval(timer)
  }, [value, duration])
  return <span className={`tabular-nums ${className}`}>{display.toLocaleString()}</span>
}

/* ── Typing text animation ── */
function TypingText({ texts, speed = 60, pause = 2500, className = '' }: { texts: string[]; speed?: number; pause?: number; className?: string }) {
  const [textIdx, setTextIdx] = useState(0)
  const [charIdx, setCharIdx] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const current = texts[textIdx]
    if (!deleting && charIdx < current.length) {
      const t = setTimeout(() => setCharIdx(c => c + 1), speed)
      return () => clearTimeout(t)
    }
    if (!deleting && charIdx === current.length) {
      const t = setTimeout(() => setDeleting(true), pause)
      return () => clearTimeout(t)
    }
    if (deleting && charIdx > 0) {
      const t = setTimeout(() => setCharIdx(c => c - 1), speed / 2)
      return () => clearTimeout(t)
    }
    if (deleting && charIdx === 0) {
      setDeleting(false)
      setTextIdx(i => (i + 1) % texts.length)
    }
  }, [charIdx, deleting, textIdx, texts, speed, pause])

  return (
    <span className={className}>
      {texts[textIdx].slice(0, charIdx)}
      <span className="inline-block w-[2px] h-[1em] bg-current ml-0.5 align-middle" style={{ animation: 'gdBlink 1s step-end infinite' }} />
    </span>
  )
}

/* ── Severity ring mini chart ── */
function SeverityRing({ critical, high, medium, low }: { critical: number; high: number; medium: number; low: number }) {
  const total = critical + high + medium + low
  if (total === 0) return null
  const segments = [
    { pct: critical / total, color: SEVERITY_HEX.critical, label: 'Critical' },
    { pct: high / total, color: SEVERITY_HEX.high, label: 'High' },
    { pct: medium / total, color: SEVERITY_HEX.medium, label: 'Medium' },
    { pct: low / total, color: SEVERITY_HEX.low, label: 'Low' },
  ].filter(s => s.pct > 0)

  let offset = 0
  const r = 30, circumference = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72" className="drop-shadow-lg">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
        {segments.map((seg, i) => {
          const dash = circumference * seg.pct
          const gap = circumference - dash
          const o = offset
          offset += seg.pct
          return (
            <circle key={i} cx="36" cy="36" r={r} fill="none" stroke={seg.color} strokeWidth="8"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-circumference * o}
              strokeLinecap="round"
              transform="rotate(-90 36 36)"
              className="transition-all duration-1000"
            />
          )
        })}
        <text x="36" y="36" textAnchor="middle" dominantBaseline="central" className="fill-white font-black text-sm">{total}</text>
      </svg>
      <div className="flex flex-col gap-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-white/70 font-medium">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

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
  const [liveClock, setLiveClock] = useState(new Date())
  const [mounted, setMounted] = useState(false)
  const signInRef = useRef<HTMLDivElement>(null)

  // Inject animations on mount
  useEffect(() => { injectGuestAnimations(); setMounted(true) }, [])

  // Live clock update every second
  useEffect(() => {
    const iv = setInterval(() => setLiveClock(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Time-based greeting
  const greeting = useMemo(() => {
    const h = liveClock.getHours()
    if (h < 12) return { text: 'Good Morning', icon: Sun, period: 'morning' }
    if (h < 17) return { text: 'Good Afternoon', icon: CloudRain, period: 'afternoon' }
    return { text: 'Good Evening', icon: Sparkles, period: 'evening' }
  }, [liveClock.getHours()])

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

  // Severity distribution for ring
  const sevCounts = useMemo(() => ({
    critical: alerts.filter(a => a.severity === 'critical').length,
    high: alerts.filter(a => a.severity === 'high').length,
    medium: alerts.filter(a => a.severity === 'medium').length,
    low: alerts.filter(a => a.severity === 'low').length,
  }), [alerts])

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

        {/*  ADVANCED HERO — Command Center Welcome Board  */}
        <div className={`relative overflow-hidden rounded-3xl shadow-2xl transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-aegis-700 via-aegis-600 to-blue-700 dark:from-gray-950 dark:via-aegis-950 dark:to-blue-950 gd-gradient" />

          {/* Grid overlay pattern */}
          <div className="absolute inset-0 opacity-[0.05]">
            <svg width="100%" height="100%"><defs><pattern id="gdGrid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="white" strokeWidth="0.5"/></pattern></defs><rect width="100%" height="100%" fill="url(#gdGrid)"/></svg>
          </div>

          {/* Floating animated orbs */}
          <div className="absolute top-10 right-10 w-64 h-64 bg-aegis-400/10 rounded-full blur-[80px] gd-float" />
          <div className="absolute bottom-0 left-10 w-48 h-48 bg-blue-400/10 rounded-full blur-[60px] gd-float2" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full border border-white/[0.04] gd-orbit" />

          {/* Orbiting dot */}
          <div className="absolute top-1/2 left-1/2" style={{ transform: 'translate(-50%, -50%)' }}>
            <div className="gd-orbit">
              <div className="w-2 h-2 rounded-full bg-aegis-400/60 shadow-lg shadow-aegis-400/30" />
            </div>
          </div>

          <div className="relative z-10 p-6 sm:p-8 lg:p-10">
            {/* Top bar: greeting + clock + status */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 gd-fade-up" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Time greeting */}
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/10 px-3.5 py-2 rounded-xl">
                  <greeting.icon className="w-4 h-4 text-amber-300" />
                  <span className="text-sm font-bold text-white">{greeting.text}</span>
                </div>

                {/* Live clock */}
                <div className="flex items-center gap-2 bg-white/[0.07] backdrop-blur-md border border-white/[0.08] px-3 py-2 rounded-xl">
                  <Clock className="w-3.5 h-3.5 text-white/60" />
                  <span className="text-xs font-mono font-bold text-white/90 tabular-nums">
                    {liveClock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-[10px] text-white/40 font-medium hidden sm:inline">
                    {liveClock.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>

                {/* System status */}
                <div className="flex items-center gap-1.5 bg-green-500/15 border border-green-500/20 px-2.5 py-2 rounded-xl">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
                  </span>
                  <span className="text-[10px] font-bold text-green-300 uppercase tracking-wider">Systems Online</span>
                </div>
              </div>

              {/* Threat level badge */}
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border backdrop-blur-md ${
                threatLevel === 'SEVERE' ? 'bg-red-500/20 border-red-500/30' :
                threatLevel === 'ELEVATED' ? 'bg-orange-500/20 border-orange-500/30' :
                threatLevel === 'GUARDED' ? 'bg-amber-500/20 border-amber-500/30' :
                'bg-green-500/20 border-green-500/30'
              }`}>
                <Signal className={`w-4 h-4 ${threatColor}`} />
                <div>
                  <span className={`text-xs font-black ${threatColor}`}>THREAT: {threatLevel}</span>
                  <p className="text-[9px] text-white/40 font-medium">Current assessment</p>
                </div>
              </div>
            </div>

            {/* Main hero content */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
              {/* Left: Title + typing subtitle + badges */}
              <div className="flex-1 gd-fade-up" style={{ animationDelay: '0.25s' }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] font-bold bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 text-white/90">
                    <Globe className="w-3 h-3" /> {ct('guest.hero.badge', lang)}
                  </span>
                  <span className="text-[10px] font-bold bg-aegis-400/20 text-aegis-200 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                    <ScanEye className="w-3 h-3" /> AI-Powered
                  </span>
                  <span className="text-[10px] font-bold bg-white/10 text-white/70 px-2.5 py-1 rounded-full uppercase tracking-wider hidden sm:inline-flex items-center gap-1">
                    <Satellite className="w-3 h-3" /> Multi-Source
                  </span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white mb-3 leading-[1.1] tracking-tight">
                  {ct('guest.hero.title', lang)}
                </h1>

                <div className="text-base sm:text-lg text-white/70 mb-5 h-7">
                  <TypingText
                    texts={[
                      'Real-time flood monitoring & AI predictions',
                      'Multi-hazard early warning system',
                      'Protecting communities across the UK',
                      'Live satellite & river gauge intelligence',
                    ]}
                    speed={45}
                    pause={3000}
                    className="font-medium"
                  />
                </div>

                {/* Quick stat pills */}
                <div className="flex flex-wrap gap-2 mb-6">
                  {[
                    { icon: Activity, label: 'Incidents', value: activeIncidents.length, color: activeIncidents.length > 0 ? 'text-red-300 bg-red-500/15 border-red-500/20' : 'text-green-300 bg-green-500/15 border-green-500/20' },
                    { icon: Bell, label: 'Alerts', value: alerts.length, color: alerts.length > 0 ? 'text-amber-300 bg-amber-500/15 border-amber-500/20' : 'text-green-300 bg-green-500/15 border-green-500/20' },
                    { icon: TrendingUp, label: 'Forecasts', value: predictions.length, color: 'text-purple-300 bg-purple-500/15 border-purple-500/20' },
                    { icon: Eye, label: 'Monitored', value: incidents.length || registry.length, color: 'text-blue-300 bg-blue-500/15 border-blue-500/20' },
                  ].map((pill, i) => (
                    <div key={pill.label} className={`flex items-center gap-1.5 border backdrop-blur-sm px-3 py-1.5 rounded-xl gd-slide-in ${pill.color}`} style={{ animationDelay: `${0.4 + i * 0.1}s` }}>
                      <pill.icon className="w-3.5 h-3.5" />
                      <AnimatedCounter value={loading ? 0 : pill.value} className="text-sm font-black" />
                      <span className="text-[10px] font-medium opacity-70">{pill.label}</span>
                    </div>
                  ))}
                </div>

                {/* Hero CTAs */}
                <div className="flex flex-wrap gap-3">
                  <Link to="/citizen" className="group relative bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/20 hover:border-white/30 px-6 py-3 rounded-xl text-sm font-bold text-white flex items-center gap-2.5 transition-all hover:scale-[1.02] shadow-lg overflow-hidden">
                    <div className="absolute inset-0 gd-shimmer" />
                    <Map className="w-4.5 h-4.5 relative z-10" />
                    <span className="relative z-10">{ct('guest.hero.fullMapView', lang)}</span>
                    <ArrowRight className="w-3.5 h-3.5 relative z-10 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </Link>
                  <Link to="/citizen/login" className="group bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2.5 transition-all hover:scale-[1.02] shadow-xl shadow-amber-500/25">
                    <Zap className="w-4.5 h-4.5" />
                    {ct('guest.hero.getPersonalAlerts', lang)}
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </Link>
                  <a href="tel:999" className="bg-red-500/20 hover:bg-red-500/30 backdrop-blur-md border border-red-500/30 px-4 py-3 rounded-xl text-sm font-bold text-red-200 flex items-center gap-2 transition-all hover:scale-[1.02]">
                    <PhoneCall className="w-4 h-4" />
                    <span className="hidden sm:inline">999</span>
                  </a>
                </div>
              </div>

              {/* Right: Severity ring + key metrics panel */}
              <div className="lg:w-80 flex-shrink-0 gd-fade-up" style={{ animationDelay: '0.4s' }}>
                <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.1] rounded-2xl p-5 space-y-5">
                  {/* Severity distribution */}
                  <div>
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.15em] mb-3">Alert Distribution</p>
                    {alerts.length > 0 ? (
                      <SeverityRing {...sevCounts} />
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-[72px] h-[72px] rounded-full border-4 border-green-500/30 flex items-center justify-center">
                          <ShieldCheck className="w-6 h-6 text-green-400" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-green-300">All Clear</p>
                          <p className="text-[10px] text-white/40">No active alerts</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="border-t border-white/[0.08]" />

                  {/* Key metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Active', value: activeIncidents.length, icon: AlertOctagon, color: 'text-red-400' },
                      { label: 'Predictions', value: predictions.length, icon: Sparkles, color: 'text-purple-400' },
                      { label: 'Regions', value: incidents.length || registry.length, icon: Layers, color: 'text-blue-400' },
                      { label: 'Data Sources', value: 4, icon: Satellite, color: 'text-emerald-400' },
                    ].map((m, i) => (
                      <div key={m.label} className="bg-white/[0.05] rounded-xl p-3 gd-count-up" style={{ animationDelay: `${0.6 + i * 0.1}s` }}>
                        <m.icon className={`w-4 h-4 ${m.color} mb-1.5`} />
                        <AnimatedCounter value={loading ? 0 : m.value} className={`text-xl font-black text-white block`} />
                        <p className="text-[9px] text-white/40 font-bold uppercase tracking-wider">{m.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Last update */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[9px] text-white/30 flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Connecting...'}
                    </span>
                    <button onClick={refresh} disabled={loading} className="text-[9px] text-aegis-300 hover:text-aegis-200 font-bold flex items-center gap-1 transition-colors">
                      <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/*  QUICK EMERGENCY ACTIONS — Glass cards  */}
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          {[
            { icon: Megaphone, label: 'Report Emergency', desc: 'Submit anonymous report', href: '/citizen', gradient: 'from-red-500 to-rose-600', shadow: 'shadow-red-500/20' },
            { icon: Map, label: 'Live Disaster Map', desc: 'View real-time incidents', href: '/citizen', gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20' },
            { icon: Bell, label: 'Subscribe Alerts', desc: 'Get early warnings', href: '/citizen/login', gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/20' },
            { icon: Shield, label: 'Safe Zones', desc: 'Find nearest shelters', href: '/citizen', gradient: 'from-green-500 to-emerald-600', shadow: 'shadow-green-500/20' },
          ].map((action, i) => (
            <Link key={action.label} to={action.href}
              className={`group glass-card rounded-2xl p-4 hover-lift transition-all duration-300 ${action.shadow} gd-scale-in`}
              style={{ animationDelay: `${0.3 + i * 0.08}s` }}
            >
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${action.gradient} flex items-center justify-center shadow-lg mb-3 group-hover:scale-110 transition-transform`}>
                <action.icon className="w-5.5 h-5.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-0.5">{action.label}</p>
              <p className="text-[10px] text-gray-500 dark:text-white/40 font-medium">{action.desc}</p>
              <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-white/20 mt-2 group-hover:text-aegis-500 group-hover:translate-x-1 transition-all" />
            </Link>
          ))}
        </div>

        {/*  STATUS CARDS — Glassmorphic with animated counters  */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 stagger-children">
          {[
            { label: t('dashboard:incidents.active', 'Active Incidents'), value: activeIncidents.length, icon: Activity, gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/15', iconBg: 'bg-blue-500/10', trend: activeIncidents.length > 0 ? 'up' : null },
            { label: t('alerts:totalAlerts', 'Total Alerts'), value: alerts.length, icon: Bell, gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/15', iconBg: 'bg-amber-500/10', trend: criticalAlerts.length > 0 ? 'critical' : null },
            { label: t('dashboard:incidents.monitoring', 'Types Monitored'), value: incidents.length || registry.length, icon: Eye, gradient: 'from-green-500 to-emerald-600', shadow: 'shadow-green-500/15', iconBg: 'bg-green-500/10', trend: null },
            { label: t('dashboard:predictions.active', 'Predictions'), value: predictions.length, icon: TrendingUp, gradient: 'from-purple-500 to-violet-600', shadow: 'shadow-purple-500/15', iconBg: 'bg-purple-500/10', trend: predictions.length > 3 ? 'up' : null },
          ].map(({ label, value, icon: Icon, gradient, shadow, trend }, idx) => (
            <div key={label} className={`glass-card rounded-2xl p-5 hover-lift transition-all duration-300 ${shadow} gd-scale-in`} style={{ animationDelay: `${0.15 + idx * 0.08}s` }}>
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                {trend === 'critical' && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full animate-pulse">
                    <AlertCircle className="w-3 h-3" /> Active
                  </span>
                )}
                {trend === 'up' && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">
                    <TrendingUp className="w-3 h-3" /> Rising
                  </span>
                )}
              </div>
              <AnimatedCounter value={loading ? 0 : value} className="text-3xl font-black text-gray-900 dark:text-white" />
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
                <div className="p-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center mx-auto mb-3">
                    <Activity className="w-6 h-6 text-blue-400" />
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">{t('common:noIncidents', 'No Active Incidents')}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40 mt-1">All monitored regions are clear</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/*  SAFETY GUIDANCE — Enhanced with visual cards  */}
        {predictions.length > 0 && (
          <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
            <div className="px-5 py-4 border-b border-gray-200/50 dark:border-white/[0.06] flex items-center justify-between">
              <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-400 to-violet-600 flex items-center justify-center shadow-md">
                  <TrendingUp className="w-4 h-4 text-white" />
                </div>
                {t('dashboard:predictions.title', 'AI Forecasts')}
                <span className="text-[10px] font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">{predictions.length}</span>
              </h2>
              <span className="text-[10px] text-gray-400 dark:text-white/30 flex items-center gap-1 font-medium">
                <Compass className="w-3 h-3" /> {ct('guest.aiPowered', lang)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0.5 bg-gray-100 dark:bg-white/[0.03]">
              {predictions.slice(0, 6).map((pred, idx) => {
                const Icon = INCIDENT_ICONS[pred.incidentType] || TrendingUp
                return (
                  <div key={idx} className="bg-white dark:bg-gray-900/80 p-4 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 mt-0.5 shrink-0 text-purple-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white mb-0.5 truncate capitalize">{pred.incidentType.replace(/_/g, ' ')}</p>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${SEVERITY_COLORS[pred.severity] || 'bg-gray-200 text-gray-700'}`}>
                            {pred.severity.toUpperCase()}
                          </span>
                          {pred.confidence != null && (
                            <span className="text-[10px] text-gray-400 dark:text-white/40 font-medium">
                              {Math.round(pred.confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {pred.location?.name || `${pred.location.lat.toFixed(2)}, ${pred.location.lng.toFixed(2)}`}
                          {' · '}
                          {Math.round(pred.probability * 100)}% probability
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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

        {/*  DATA SOURCES TRUST STRIP  */}
        <div className="glass-card rounded-2xl p-5 shadow-lg">
          <p className="text-[10px] text-gray-400 dark:text-white/30 font-bold uppercase tracking-[0.2em] text-center mb-4">Trusted Data Sources</p>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {[
              { name: 'Environment Agency', icon: Droplets, color: 'text-blue-500' },
              { name: 'Met Office', icon: CloudRain, color: 'text-sky-500' },
              { name: 'SEPA Scotland', icon: Shield, color: 'text-indigo-500' },
              { name: 'OpenStreetMap', icon: Globe, color: 'text-green-500' },
              { name: 'ERA5 Satellite', icon: Satellite, color: 'text-purple-500' },
              { name: 'River Gauges', icon: BarChart3, color: 'text-cyan-500' },
            ].map(source => (
              <div key={source.name} className="flex items-center gap-2 opacity-60 hover:opacity-100 transition-opacity group cursor-default">
                <source.icon className={`w-4 h-4 ${source.color}`} />
                <span className="text-xs font-semibold text-gray-500 dark:text-white/50 group-hover:text-gray-700 dark:group-hover:text-white/80 transition-colors">{source.name}</span>
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
              <span className="text-xs text-gray-500 dark:text-gray-300 dark:text-white/40 font-medium">{t('common:app.name')} — {t('common:app.fullName')}</span>
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

