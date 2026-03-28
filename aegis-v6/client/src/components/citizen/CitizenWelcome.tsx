/**
 * CitizenWelcome.tsx — Stunning, animated, personalized welcome dashboard
 * First thing a signed-in citizen sees. Mind-blowing animations + glass design.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Shield, AlertTriangle, MapPin, FileText, Bell, Heart,
  Users, BookOpen, Activity, Phone, MessageSquare, ShieldAlert,
  CheckCircle, ArrowRight, Sparkles, Zap, Globe, Star,
  Clock, TrendingUp, ChevronRight, Info, Eye, HelpCircle,
  Sunrise, Sun, Moon
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/* animation keyframes injected once */
const STYLE_ID = 'citizen-welcome-animations'
function injectAnimations() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes cwFadeUp   { from { opacity:0; transform:translateY(28px) } to { opacity:1; transform:translateY(0) } }
    @keyframes cwFadeIn   { from { opacity:0 } to { opacity:1 } }
    @keyframes cwScaleIn  { from { opacity:0; transform:scale(.88) } to { opacity:1; transform:scale(1) } }
    @keyframes cwSlideR   { from { opacity:0; transform:translateX(-32px) } to { opacity:1; transform:translateX(0) } }
    @keyframes cwSlideL   { from { opacity:0; transform:translateX(32px) } to { opacity:1; transform:translateX(0) } }
    @keyframes cwFloat    { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-8px) } }
    @keyframes cwPulseRing{ 0% { transform:scale(.95); opacity:.7 } 50% { transform:scale(1.08); opacity:1 } 100% { transform:scale(.95); opacity:.7 } }
    @keyframes cwGlow     { 0%,100% { box-shadow:0 0 12px rgba(59,130,246,.15) } 50% { box-shadow:0 0 28px rgba(59,130,246,.35) } }
    @keyframes cwShimmer  { from { background-position:-200% 0 } to { background-position:200% 0 } }
    @keyframes cwGradient { 0% { background-position:0% 50% } 50% { background-position:100% 50% } 100% { background-position:0% 50% } }
    @keyframes cwBounce   { 0%,100%{ transform:translateY(0) } 40%{ transform:translateY(-6px) } 60%{ transform:translateY(-3px) } }
    @keyframes cwRotate   { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
    @keyframes cwTypewriter { from { width:0 } to { width:100% } }
    @keyframes cwBlink    { 0%,100% { opacity:1 } 50% { opacity:0 } }
    @keyframes cwRipple   { 0% { transform:scale(1); opacity:.3 } 100% { transform:scale(2.5); opacity:0 } }
    @keyframes cwParticle { 0% { transform:translateY(0) scale(1); opacity:.6 } 100% { transform:translateY(-60px) scale(0); opacity:0 } }
    @keyframes cwOrbit    { from { transform: rotate(0deg) translateX(120px) rotate(0deg) } to { transform: rotate(360deg) translateX(120px) rotate(-360deg) } }
    .cw-fade-up   { animation: cwFadeUp .7s cubic-bezier(.22,1,.36,1) both }
    .cw-fade-in   { animation: cwFadeIn .6s ease-out both }
    .cw-scale-in  { animation: cwScaleIn .6s cubic-bezier(.22,1,.36,1) both }
    .cw-slide-r   { animation: cwSlideR .6s cubic-bezier(.22,1,.36,1) both }
    .cw-slide-l   { animation: cwSlideL .6s cubic-bezier(.22,1,.36,1) both }
    .cw-float     { animation: cwFloat 4s ease-in-out infinite }
    .cw-glow      { animation: cwGlow 3s ease-in-out infinite }
    .cw-bounce    { animation: cwBounce 2s ease-in-out infinite }
    .cw-shimmer   { background: linear-gradient(90deg,transparent 30%,rgba(255,255,255,.25) 50%,transparent 70%); background-size:200% 100%; animation:cwShimmer 2.5s linear infinite }
    .cw-gradient-bg { background-size:200% 200%; animation:cwGradient 8s ease infinite }
    .cw-ripple::after { content:''; position:absolute; inset:0; border-radius:inherit; animation:cwRipple 2s ease-out infinite }
  `
  document.head.appendChild(style)
}

interface CitizenWelcomeProps {
  user: any
  reportStats: any
  totalUnread: number
  emergencyContacts: any[]
  recentSafety: any[]
  threads: any[]
  setActiveTab: (tab: string) => void
  onReportEmergency: () => void
  onCommunityHelp: () => void
  submitSafetyCheckIn: (status: 'safe' | 'help' | 'unsure') => Promise<any>
}

export default function CitizenWelcome({
  user, reportStats, totalUnread, emergencyContacts, recentSafety, threads,
  setActiveTab, onReportEmergency, onCommunityHelp, submitSafetyCheckIn
}: CitizenWelcomeProps) {
  const lang = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [timeStr, setTimeStr] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [quickSafety, setQuickSafety] = useState<'safe' | 'help' | 'unsure' | null>(null)
  const [safetySending, setSafetySending] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => { injectAnimations(); setMounted(true) }, [])

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTimeStr(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setDateStr(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening'
  const GreetingIcon = hour < 12 ? Sunrise : hour < 17 ? Sun : Moon

  const firstName = useMemo(() => {
    const name = user?.displayName || user?.username || user?.email?.split('@')[0] || 'Citizen'
    return name.split(' ')[0]
  }, [user])

  const stats = useMemo(() => ({
    total: reportStats?.total ?? 0,
    urgent: reportStats?.urgent ?? 0,
    high: reportStats?.high ?? 0,
    verified: reportStats?.verified ?? 0,
    alerts: reportStats?.alertCount ?? 0,
    unread: totalUnread,
    contacts: emergencyContacts?.length ?? 0,
    checkins: recentSafety?.length ?? 0,
    activeThreads: threads?.filter((t: any) => t.status !== 'closed' && t.status !== 'resolved').length ?? 0,
  }), [reportStats, totalUnread, emergencyContacts, recentSafety, threads])

  // Safety status
  const safetyStatus = useMemo(() => {
    if (!recentSafety?.length) return null
    return recentSafety[0]?.status as string | null
  }, [recentSafety])

  if (!mounted) return null

  const delay = (i: number) => ({ animationDelay: `${i * 100}ms` })

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-8">

      {/* HERO — Animated Welcome Banner */}
      <div
        ref={heroRef}
        className="cw-fade-up relative overflow-hidden rounded-3xl shadow-2xl"
        style={delay(0)}
      >
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-aegis-600 to-cyan-600 cw-gradient-bg" />

        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full bg-white/20"
              style={{
                left: `${8 + i * 8}%`,
                bottom: `${10 + (i % 3) * 20}%`,
                animation: `cwParticle ${3 + (i % 3)}s ease-out infinite`,
                animationDelay: `${i * 0.4}s`,
              }}
            />
          ))}
        </div>

        {/* Orbiting ring decorations */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] pointer-events-none opacity-10">
          <div className="absolute inset-0 rounded-full border-2 border-white/40 border-dashed" style={{ animation: 'cwRotate 30s linear infinite' }} />
          <div className="absolute inset-4 rounded-full border border-white/20" style={{ animation: 'cwRotate 20s linear infinite reverse' }} />
        </div>

        {/* SVG pattern overlay */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='g' width='60' height='60' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='white'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23g)'/%3E%3C/svg%3E")`
        }} />

        {/* Gradient orbs */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/5 rounded-full blur-3xl cw-float" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-cyan-400/10 rounded-full blur-2xl cw-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-10 right-20 w-24 h-24 bg-purple-400/10 rounded-full blur-xl cw-float" style={{ animationDelay: '2s' }} />

        <div className="relative z-10 px-6 sm:px-8 py-8 sm:py-10">
          {/* Top bar: Live time + Status */}
          <div className="flex items-center justify-between mb-6 cw-fade-in" style={delay(1)}>
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
                <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400" style={{ animation: 'cwRipple 2s ease-out infinite' }} />
              </div>
              <span className="text-white/60 text-xs font-medium tracking-wider uppercase">AEGIS Active</span>
            </div>
            <div className="text-right">
              <p className="text-white/90 text-sm font-mono font-bold tracking-wider">{timeStr}</p>
              <p className="text-white/40 text-[10px] font-medium">{dateStr}</p>
            </div>
          </div>

          {/* Main greeting */}
          <div className="flex flex-col sm:flex-row items-start gap-5 sm:gap-6">
            {/* Avatar */}
            <div className="cw-scale-in relative" style={delay(2)}>
              <div className="relative">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-white/10 backdrop-blur-sm border-2 border-white/20 shadow-2xl cw-glow">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/20 to-white/5">
                      <span className="text-3xl sm:text-4xl font-black text-white/80">
                        {firstName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                {/* Status badge */}
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg border-2 border-white/20">
                  <CheckCircle className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              {/* Sparkle decorations */}
              <Sparkles className="absolute -top-2 -right-2 w-5 h-5 text-yellow-300/70 cw-bounce" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <div className="cw-slide-r" style={delay(2)}>
                <p className="text-white/50 text-xs font-semibold tracking-[0.2em] uppercase mb-1.5 flex items-center gap-2">
                  <GreetingIcon className="w-4 h-4" /> {greeting}
                </p>
              </div>
              <h1 className="cw-slide-r text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-[1.1]" style={delay(3)}>
                Welcome, <span className="bg-gradient-to-r from-cyan-200 via-white to-purple-200 bg-clip-text text-transparent">{firstName}</span>
              </h1>
              <p className="cw-slide-r text-white/50 text-sm mt-2 max-w-md leading-relaxed" style={delay(4)}>
                Your safety command centre is ready. Stay informed, stay prepared, stay safe.
              </p>

              {/* Quick status pills */}
              <div className="flex flex-wrap gap-2 mt-4 cw-fade-in" style={delay(5)}>
                {stats.unread > 0 && (
                  <button onClick={() => setActiveTab('messages')} className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-105 active:scale-95">
                    <MessageSquare className="w-3 h-3" /> {stats.unread} unread
                  </button>
                )}
                {stats.alerts > 0 && (
                  <button onClick={() => setActiveTab('alerts')} className="inline-flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 backdrop-blur-sm border border-red-400/20 rounded-full px-3 py-1.5 text-xs font-semibold text-red-200 transition-all hover:scale-105 active:scale-95">
                    <Bell className="w-3 h-3" /> {stats.alerts} active alerts
                  </button>
                )}
                {safetyStatus && (
                  <div className={`inline-flex items-center gap-1.5 backdrop-blur-sm border rounded-full px-3 py-1.5 text-xs font-semibold ${
                    safetyStatus === 'safe' ? 'bg-emerald-500/20 border-emerald-400/20 text-emerald-200'
                    : safetyStatus === 'help' ? 'bg-red-500/20 border-red-400/20 text-red-200'
                    : 'bg-amber-500/20 border-amber-400/20 text-amber-200'
                  }`}>
                    <ShieldAlert className="w-3 h-3" /> {safetyStatus === 'safe' ? 'Marked Safe' : safetyStatus === 'help' ? 'Help Requested' : 'Status Unsure'}
                  </div>
                )}
              </div>
            </div>

            {/* CTA buttons */}
            <div className="flex flex-row sm:flex-col gap-2 cw-slide-l flex-shrink-0" style={delay(4)}>
              <button
                onClick={onReportEmergency}
                className="group relative bg-white/10 hover:bg-red-500/80 backdrop-blur-sm border border-white/15 hover:border-red-400/50 rounded-xl px-5 py-3 text-sm font-bold text-white transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-xl hover:shadow-red-500/20 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <span className="relative flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 group-hover:animate-pulse" /> Report
                </span>
              </button>
              <button
                onClick={() => setActiveTab('livemap')}
                className="group bg-white hover:bg-cyan-50 text-aegis-700 rounded-xl px-5 py-3 text-sm font-bold transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] shadow-xl shadow-black/10 flex items-center gap-2"
              >
                <Globe className="w-4 h-4 group-hover:animate-spin" style={{ animationDuration: '3s' }} /> Live Map
              </button>
            </div>
          </div>
        </div>

        {/* Bottom shimmer bar */}
        <div className="h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent cw-shimmer" />
      </div>

      {/* LIVE STATS — Animated Counter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        {[
          { label: 'Total Reports',  value: stats.total,    icon: FileText,      gradient: 'from-blue-500 to-blue-700',     bg: 'bg-blue-50 dark:bg-blue-950/40',     border: 'border-blue-200 dark:border-blue-800/60',     num: 'text-blue-700 dark:text-blue-300',   lbl: 'text-blue-600 dark:text-blue-400', tap: () => setActiveTab('reports') },
          { label: 'Urgent',         value: stats.urgent,   icon: AlertTriangle, gradient: 'from-red-500 to-red-700',       bg: 'bg-red-50 dark:bg-red-950/40',       border: 'border-red-200 dark:border-red-800/60',       num: 'text-red-700 dark:text-red-300',     lbl: 'text-red-600 dark:text-red-400', tap: () => setActiveTab('reports') },
          { label: 'High Severity',  value: stats.high,     icon: Activity,      gradient: 'from-orange-500 to-orange-700', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800/60', num: 'text-orange-700 dark:text-orange-300', lbl: 'text-orange-600 dark:text-orange-400', tap: () => setActiveTab('reports') },
          { label: 'Verified',       value: stats.verified, icon: CheckCircle,   gradient: 'from-green-500 to-green-700',   bg: 'bg-green-50 dark:bg-green-950/40',   border: 'border-green-200 dark:border-green-800/60',   num: 'text-green-700 dark:text-green-300', lbl: 'text-green-600 dark:text-green-400', tap: () => setActiveTab('reports') },
          { label: 'Active Alerts',  value: stats.alerts,   icon: Bell,          gradient: 'from-purple-500 to-purple-700', bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800/60', num: 'text-purple-700 dark:text-purple-300', lbl: 'text-purple-600 dark:text-purple-400', tap: () => setActiveTab('alerts') },
        ].map((s, i) => (
          <button
            key={i}
            onClick={s.tap}
            className={`cw-scale-in ${s.bg} border ${s.border} rounded-2xl p-4 text-left transition-all duration-300 group hover:shadow-lg hover:scale-[1.03] active:scale-[0.97] cursor-pointer`}
            style={delay(i + 5)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-300`}>
                <s.icon className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </div>
            <AnimatedCounter value={s.value} className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${s.num}`} />
            <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${s.lbl}`}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* QUICK SAFETY CHECK-IN */}
      <div className="cw-fade-up glass-card rounded-2xl p-4 shadow-lg" style={delay(9)}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
              <ShieldAlert className="w-3.5 h-3.5 text-white" />
            </div>
            Are you safe right now?
          </h3>
          {quickSafety && (
            <button onClick={() => setQuickSafety(null)} className="text-[10px] font-bold text-gray-400 dark:text-gray-300 hover:text-gray-600 transition-colors">Update</button>
          )}
        </div>
        {quickSafety ? (
          <div className={`p-3.5 rounded-xl text-sm font-semibold flex items-center gap-3 ${quickSafety === 'safe' ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 text-green-700 dark:text-green-300 border border-green-200/50 dark:border-green-800/50' : quickSafety === 'help' ? 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/20 text-red-700 dark:text-red-300 border border-red-200/50 dark:border-red-800/50' : 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50'}`}>
            {quickSafety === 'safe' && <><CheckCircle className="w-5 h-5" /> You are marked safe. Stay alert.</>}
            {quickSafety === 'help' && <><AlertTriangle className="w-5 h-5" /> Help request sent. Responders are on their way.</>}
            {quickSafety === 'unsure' && <><HelpCircle className="w-5 h-5" /> Status noted. Stay cautious and check updates.</>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { status: 'safe' as const, label: "I'm Safe", icon: CheckCircle, from: 'from-green-50', to: 'to-emerald-100', darkFrom: 'dark:from-green-900/30', darkTo: 'dark:to-emerald-900/20', text: 'text-green-800 dark:text-green-200', border: 'border-green-200/60 dark:border-green-800/50', hover: 'hover:shadow-green-500/10' },
              { status: 'help' as const, label: 'Need Help', icon: AlertTriangle, from: 'from-red-50', to: 'to-rose-100', darkFrom: 'dark:from-red-900/30', darkTo: 'dark:to-rose-900/20', text: 'text-red-800 dark:text-red-200', border: 'border-red-200/60 dark:border-red-800/50', hover: 'hover:shadow-red-500/10' },
              { status: 'unsure' as const, label: 'Not Sure', icon: HelpCircle, from: 'from-amber-50', to: 'to-yellow-100', darkFrom: 'dark:from-amber-900/30', darkTo: 'dark:to-yellow-900/20', text: 'text-amber-800 dark:text-amber-200', border: 'border-amber-200/60 dark:border-amber-800/50', hover: 'hover:shadow-amber-500/10' },
            ].map(btn => (
              <button
                key={btn.status}
                disabled={safetySending}
                onClick={async () => {
                  setSafetySending(true)
                  try { await submitSafetyCheckIn(btn.status) } catch {}
                  setQuickSafety(btn.status)
                  setSafetySending(false)
                }}
                className={`bg-gradient-to-br ${btn.from} ${btn.to} ${btn.darkFrom} ${btn.darkTo} ${btn.text} rounded-xl py-3.5 sm:py-3.5 text-xs font-bold flex flex-row sm:flex-col items-center justify-center gap-2 sm:gap-1.5 transition-all border ${btn.border} hover:shadow-lg ${btn.hover} hover:scale-[1.02] active:scale-[0.98] min-h-[48px]`}
              >
                <btn.icon className="w-5 h-5" />
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* QUICK ACTIONS — Interactive Action Grid */}
      <div className="cw-fade-up" style={delay(10)}>
        <div className="glass-card rounded-2xl overflow-hidden">
          {/* Section header */}
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-sm">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Quick Actions</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: 'Report Emergency', desc: 'Submit an incident report', icon: AlertTriangle, color: 'from-red-500 to-rose-600', textColor: 'text-red-600 dark:text-red-400', hoverBorder: 'hover:border-red-300 dark:hover:border-red-700', action: onReportEmergency },
                { label: 'Subscribe to Alerts', desc: 'Get real-time notifications', icon: Bell, color: 'from-purple-500 to-violet-600', textColor: 'text-purple-600 dark:text-purple-400', hoverBorder: 'hover:border-purple-300 dark:hover:border-purple-700', action: () => setActiveTab('alerts') },
                { label: 'Community Support', desc: 'Volunteer or request aid', icon: Heart, color: 'from-pink-500 to-rose-500', textColor: 'text-pink-600 dark:text-pink-400', hoverBorder: 'hover:border-pink-300 dark:hover:border-pink-700', action: onCommunityHelp },
                { label: 'Safety Check-In', desc: 'Mark yourself safe', icon: ShieldAlert, color: 'from-emerald-500 to-teal-600', textColor: 'text-emerald-600 dark:text-emerald-400', hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-700', action: () => setActiveTab('safety') },
                { label: 'Live Map', desc: 'See incidents in real time', icon: MapPin, color: 'from-blue-500 to-cyan-600', textColor: 'text-blue-600 dark:text-blue-400', hoverBorder: 'hover:border-blue-300 dark:hover:border-blue-700', action: () => setActiveTab('livemap') },
                { label: 'Risk Assessment', desc: 'Know your local risk level', icon: Activity, color: 'from-orange-500 to-amber-600', textColor: 'text-orange-600 dark:text-orange-400', hoverBorder: 'hover:border-orange-300 dark:hover:border-orange-700', action: () => setActiveTab('risk') },
                { label: 'Emergency Card', desc: 'Offline emergency info', icon: Shield, color: 'from-amber-500 to-orange-600', textColor: 'text-amber-600 dark:text-amber-400', hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-700', action: () => setActiveTab('emergency') },
                { label: 'My Messages', desc: `${stats.unread} unread conversations`, icon: MessageSquare, color: 'from-sky-500 to-blue-600', textColor: 'text-sky-600 dark:text-sky-400', hoverBorder: 'hover:border-sky-300 dark:hover:border-sky-700', action: () => setActiveTab('messages') },
              ].map((a, i) => (
                <button
                  key={i}
                  onClick={a.action}
                  className={`group relative bg-white dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/50 rounded-xl p-3.5 text-left ${a.hoverBorder} transition-all duration-300 hover:shadow-lg hover:scale-[1.02] active:scale-[0.97] overflow-hidden`}
                >
                  {/* Hover gradient overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${a.color} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300`} />
                  <div className="relative">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${a.color} flex items-center justify-center shadow-md mb-2.5 group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}>
                      <a.icon className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{a.label}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{a.desc}</p>
                    <ArrowRight className={`w-3 h-3 ${a.textColor} mt-1.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300`} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* PERSONAL INSIGHTS — Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 cw-fade-up" style={delay(11)}>
        {/* Left - Your Activity */}
        <div className="lg:col-span-2 glass-card rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-aegis-600" /> Your Activity
          </h3>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Unread Messages', value: stats.unread,         icon: MessageSquare, color: 'from-sky-500 to-cyan-600',      tap: () => setActiveTab('messages') },
              { label: 'Active Threads',  value: stats.activeThreads,  icon: FileText,      color: 'from-violet-500 to-purple-600', tap: () => setActiveTab('messages') },
              { label: 'Safety Check-Ins', value: stats.checkins,      icon: ShieldAlert,   color: 'from-emerald-500 to-teal-600',  tap: () => setActiveTab('safety') },
              { label: 'Emergency Contacts', value: stats.contacts,    icon: Phone,         color: 'from-amber-500 to-orange-600',  tap: () => setActiveTab('profile') },
            ].map((s, i) => (
              <button key={i} onClick={s.tap} className="bg-gray-50/80 dark:bg-gray-800/40 border border-gray-200/60 dark:border-gray-700/40 rounded-xl p-3.5 text-left hover:shadow-md transition-all duration-300 group hover:scale-[1.02] active:scale-[0.97]">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center mb-2.5 shadow-sm group-hover:scale-110 transition-transform`}>
                  <s.icon className="w-3.5 h-3.5 text-white" />
                </div>
                <p className="text-xl font-extrabold text-gray-900 dark:text-white">{s.value}</p>
                <p className="text-[9px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">{s.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Right - Safety Journey */}
        <div className="lg:col-span-3 glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500" /> Preparedness Journey
            </h3>
            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full border border-amber-200/50 dark:border-amber-800/50">Recommended</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                { step: 1, label: 'Risk Assessment', desc: 'Check your local disaster risk', icon: Activity, color: 'from-rose-500 to-red-600', bg: 'from-rose-50 to-red-50 dark:from-rose-950/20 dark:to-red-950/10', border: 'border-rose-200/60 dark:border-rose-800/40', text: 'text-rose-600 dark:text-rose-400', tab: 'risk' },
                { step: 2, label: 'Preparedness', desc: 'Learn survival skills & first aid', icon: BookOpen, color: 'from-emerald-500 to-teal-600', bg: 'from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/10', border: 'border-emerald-200/60 dark:border-emerald-800/40', text: 'text-emerald-600 dark:text-emerald-400', tab: 'prepare' },
                { step: 3, label: 'Emergency Card', desc: 'Create your offline info card', icon: Shield, color: 'from-amber-500 to-orange-600', bg: 'from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10', border: 'border-amber-200/60 dark:border-amber-800/40', text: 'text-amber-600 dark:text-amber-400', tab: 'emergency' },
              ].map((s) => (
                <button
                  key={s.step}
                  onClick={() => setActiveTab(s.tab)}
                  className={`group bg-gradient-to-br ${s.bg} border ${s.border} rounded-xl p-4 text-left hover:shadow-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.97]`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${s.color} text-white text-[9px] font-black flex items-center justify-center shadow-sm`}>{s.step}</span>
                    <span className={`text-[8px] font-bold ${s.text} uppercase tracking-wider`}>Step {s.step}</span>
                  </div>
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform`}>
                    <s.icon className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-xs font-bold text-gray-900 dark:text-white">{s.label}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* RECENT CONVERSATIONS */}
      {threads && threads.length > 0 && (
        <div className="cw-fade-up glass-card rounded-2xl overflow-hidden" style={delay(12)}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-aegis-600" /> Recent Conversations
            </h3>
            <button onClick={() => setActiveTab('messages')} className="text-[11px] text-aegis-600 hover:text-aegis-700 font-semibold flex items-center gap-1 transition-colors">
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60">
            {threads.slice(0, 3).map((th: any) => (
              <button key={th.id} onClick={() => setActiveTab('messages')} className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors text-left group">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-4 ${
                  th.is_emergency ? 'bg-red-500 ring-red-100 dark:ring-red-950/50' : th.status === 'open' ? 'bg-emerald-500 ring-emerald-100 dark:ring-emerald-950/50' : 'bg-gray-300 ring-gray-100 dark:ring-gray-800'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-aegis-600 transition-colors">{th.subject}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{th.last_message || 'No messages yet'}</p>
                </div>
                {th.citizen_unread > 0 && (
                  <span className="bg-aegis-600 text-white text-[10px] font-bold min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full">{th.citizen_unread}</span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* EMERGENCY CONTACTS */}
      {emergencyContacts && emergencyContacts.length > 0 && (
        <div className="cw-fade-up glass-card rounded-2xl p-4" style={delay(13)}>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Phone className="w-4 h-4 text-red-500" /> Emergency Quick Dial
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {emergencyContacts.slice(0, 4).map((c: any, i: number) => (
              <a
                key={i}
                href={`tel:${c.phone}`}
                className="flex items-center gap-2.5 bg-white dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/50 rounded-xl px-3 py-2.5 hover:border-red-300 dark:hover:border-red-800 transition-all group hover:shadow-md hover:scale-[1.02] active:scale-[0.97]"
              >
                <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center group-hover:bg-red-100 dark:group-hover:bg-red-900/30 transition-colors">
                  <Phone className="w-3.5 h-3.5 text-red-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{c.name}</p>
                  <p className="text-[10px] text-gray-400 truncate">{c.phone || c.relationship}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

/* Animated number counter */
function AnimatedCounter({ value, className }: { value: number; className: string }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    const from = prev.current
    const to = value
    prev.current = to
    if (from === to) { setDisplay(to); return }
    const duration = 800
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [value])

  return <p className={className}>{display}</p>
}
