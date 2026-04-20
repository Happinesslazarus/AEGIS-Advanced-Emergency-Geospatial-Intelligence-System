/**
 * Default landing view inside the admin panel. Shows summary stat cards
 * (active incidents, pending reports, online operators), a recent
 * activity feed, and quick-action shortcuts.
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import {
  BarChart3, FileText, Users, Bell, Activity,
  AlertTriangle, CheckCircle, Clock, MapPin, Zap,
  TrendingUp, ArrowRight, Shield, Thermometer,
  Wind, Droplets, Server, Database, Cpu, Wifi
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { apiFetch } from '../../utils/api'

interface WelcomeDashboardProps {
  user: any
  stats: any
  alerts: any[]
  reports: any[]
  lang: string
  onNavigate: (view: string) => void
  socketConnected?: boolean
}

const LOCALE_MAP: Record<string, string> = {
  ar: 'ar-EG', es: 'es-ES', fr: 'fr-FR', zh: 'zh-CN',
  hi: 'hi-IN', pt: 'pt-BR', pl: 'pl-PL', ur: 'ur-PK',
}

const STATUS_I18N: Record<string, string> = {
  Urgent: 'admin.filters.status.urgent',
  Unverified: 'admin.filters.status.unverified',
  Verified: 'admin.filters.status.verified',
  Flagged: 'admin.filters.status.flagged',
  Resolved: 'admin.filters.status.resolved',
  Archived: 'admin.filters.status.archived',
  'False Report': 'admin.filters.status.falseReport',
}

export default function WelcomeDashboard({ user, stats, alerts, reports, lang, onNavigate, socketConnected }: WelcomeDashboardProps) {
  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return t('cdash.overview.goodMorning', lang)
    if (h < 17) return t('cdash.overview.goodAfternoon', lang)
    return t('cdash.overview.goodEvening', lang)
  })()

  const dateLocale = LOCALE_MAP[lang] || 'en-GB'
  const todayStr = new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  //Live clock
  const [clockStr, setClockStr] = useState(() => new Date().toLocaleTimeString(LOCALE_MAP[lang] || 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
  useEffect(() => {
    const id = setInterval(() => setClockStr(new Date().toLocaleTimeString(LOCALE_MAP[lang] || 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })), 1000)
    return () => clearInterval(id)
  }, [lang])

  //Weather data
  const [weather, setWeather] = useState<{ temp?: number; windSpeed?: number; humidity?: number; description?: string } | null>(null)
  useEffect(() => {
    apiFetch<any>('/api/weather/current')
      .then(data => {
        if (data) setWeather({
          temp: data.temperature ?? data.temp,
          windSpeed: data.wind_speed ?? data.windSpeed,
          humidity: data.humidity,
          description: data.description || data.weather_description,
        })
      })
      .catch(() => {})
  }, [])

  const recentReports = useMemo(() => {
    return [...reports]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5)
  }, [reports])

  const activeAlertsFull = useMemo(() => alerts.filter(a => a.active !== false), [alerts])
  const activeAlerts = useMemo(() => activeAlertsFull.slice(0, 3), [activeAlertsFull])
  const criticalCount = useMemo(() => reports.filter(r => r.severity === 'High' && r.status !== 'Resolved' && r.status !== 'Archived').length, [reports])

  const localizeStatus = (status: string) => {
    const key = STATUS_I18N[status]
    return key ? t(key, lang) : status
  }

  //Keyboard shortcuts
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'd') { e.preventDefault(); onNavigate('dashboard') }
      else if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onNavigate('reports') }
      else if (key === 'm') { e.preventDefault(); onNavigate('map') }
      else if (key === 'a') { e.preventDefault(); onNavigate('analytics') }
      else if (key === 'b') { e.preventDefault(); onNavigate('broadcast') }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onNavigate])

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Operational Status Bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-gray-900/60 ring-1 ring-gray-200 dark:ring-gray-800 overflow-x-auto scrollbar-thin stagger-children">
        <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">{t('admin.welcome.systemStatus', lang)}</span>
        <span className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
        {([
          { icon: Server, label: t('admin.welcome.statusApi', lang), ok: true },
          { icon: Database, label: t('admin.welcome.statusDatabase', lang), ok: true },
          { icon: Cpu, label: t('admin.welcome.statusAiEngine', lang), ok: true },
          { icon: Wifi, label: t('admin.welcome.statusWebSocket', lang), ok: socketConnected ?? true },
        ] as const).map(s => (
          <div key={s.label} className="flex items-center gap-1.5 whitespace-nowrap">
            <s.icon className="w-3 h-3 text-gray-400 dark:text-gray-400" />
            <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">{s.label}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${s.ok ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
          </div>
        ))}
        <span className="ml-auto text-[10px] font-mono text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">{clockStr}</span>
      </div>

      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-aegis-600 via-aegis-700 to-blue-900 p-8 text-white shadow-2xl animate-scale-in">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 animate-float" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4 animate-bounce-subtle" />
        <div className="absolute top-4 right-6 text-right hidden md:block z-10">
          {weather && (
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl px-4 py-2">
              <Thermometer className="w-4 h-4 text-amber-300 flex-shrink-0" />
              <div className="text-left">
                <span className="text-sm font-black tabular-nums">{weather.temp != null ? `${Math.round(weather.temp)}°C` : '--'}</span>
                <div className="flex items-center gap-2 text-[9px] text-white/60 font-medium">
                  {weather.windSpeed != null && <span className="flex items-center gap-0.5"><Wind className="w-2.5 h-2.5" />{Math.round(weather.windSpeed)} m/s</span>}
                  {weather.humidity != null && <span className="flex items-center gap-0.5"><Droplets className="w-2.5 h-2.5" />{weather.humidity}%</span>}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-xl border border-white/20">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full rounded-2xl object-cover" />
              ) : (
                <span className="text-2xl font-black text-white">{user?.displayName?.charAt(0) || 'A'}</span>
              )}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {greeting}, {user?.displayName?.split(' ')[0] || 'Admin'}
              </h1>
              <p className="text-white/70 text-sm font-medium mt-1 flex items-center gap-2 flex-wrap">
                {todayStr}
                {user?.role && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-white/10 border border-white/20 px-2 py-0.5 rounded-full text-white/80 uppercase tracking-wider font-bold">
                    <Shield className="w-2.5 h-2.5" />
                    {user.department || (user.role === 'admin' ? 'Administrator' : user.role === 'operator' ? 'Operator' : user.role === 'supervisor' ? 'Supervisor' : user.role === 'viewer' ? 'Viewer' : user.role.replace(/_/g, ' '))}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/20 border border-emerald-400/30 px-2 py-0.5 rounded-full text-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t('admin.welcome.live', lang)}
                </span>
              </p>
            </div>
          </div>
          <p className="text-white/80 text-sm max-w-xl leading-relaxed">
            {t('admin.welcome.commandCentre', lang)} {t('admin.welcome.youHave', lang)}{' '}
            <span className="font-bold text-white">{stats.unverified} {t('admin.welcome.unverifiedReports', lang)}</span>{' '}
            {t('admin.welcome.and', lang)}{' '}
            <span className="font-bold text-white">{stats.urgent} {t('admin.welcome.urgentIncidents', lang)}</span>{' '}
            {t('admin.welcome.requiringAttention', lang)}
          </p>

          {/* Priority Heatmap Strip */}
          {stats.total > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[9px] text-white/50 font-bold uppercase tracking-wider">{t('admin.welcome.severity', lang)}</span>
              <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-white/10">
                {stats.high > 0 && <div className="bg-red-500 transition-all duration-700" style={{ width: `${(stats.high / stats.total) * 100}%` }} />}
                {stats.medium > 0 && <div className="bg-amber-500 transition-all duration-700" style={{ width: `${(stats.medium / stats.total) * 100}%` }} />}
                {stats.low > 0 && <div className="bg-blue-400 transition-all duration-700" style={{ width: `${(stats.low / stats.total) * 100}%` }} />}
              </div>
              <div className="flex items-center gap-2 text-[9px] text-white/60 font-medium">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />{stats.high}</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{stats.medium}</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{stats.low}</span>
              </div>
            </div>
          )}

          {criticalCount > 0 && (
            <div className="mt-4 flex items-center gap-2 bg-red-500/20 backdrop-blur-sm border border-red-400/30 rounded-xl px-4 py-2.5 w-fit animate-glow-pulse">
              <AlertTriangle className="w-4 h-4 text-red-300" />
              <span className="text-sm font-bold text-red-100">{criticalCount} {t('admin.welcome.highSeverityActive', lang)}</span>
              <button onClick={() => onNavigate('reports')} className="ml-2 text-xs font-bold bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition">
                {t('admin.welcome.view', lang)} <ArrowRight className="w-3 h-3 inline ml-0.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
        <StatCard icon={FileText} label={t('stats.total', lang)} value={stats.total} color="blue" onClick={() => onNavigate('reports')} />
        <StatCard icon={AlertTriangle} label={t('stats.urgent', lang)} value={stats.urgent} color="red" onClick={() => onNavigate('reports')} pulse={stats.urgent > 0} />
        <StatCard icon={CheckCircle} label={t('stats.verified', lang)} value={stats.verified} color="emerald" onClick={() => onNavigate('reports')} />
        <StatCard icon={TrendingUp} label={t('admin.verificationRate', lang)} value={`${stats.verifyRate}%`} color="violet" gauge={stats.verifyRate} />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick Actions */}
        <div className="glass-card rounded-2xl p-5 animate-slide-up">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-amber-500" />
            {t('cdash.overview.quickActions', lang)}
          </h3>
          <div className="grid grid-cols-2 gap-2 stagger-children">
            <QuickAction icon={FileText} label={t('admin.welcome.viewReports', lang)} desc={`${stats.unverified} ${t('admin.welcome.pending', lang)}`} onClick={() => onNavigate('reports')} color="blue" />
            <QuickAction icon={Bell} label={t('admin.sendAlert', lang)} desc={t('admin.welcome.broadcastNow', lang)} onClick={() => onNavigate('alert_send')} color="red" />
            <QuickAction icon={BarChart3} label={t('admin.analytics', lang)} desc={t('admin.welcome.viewTrends', lang)} onClick={() => onNavigate('analytics')} color="violet" />
            <QuickAction icon={MapPin} label={t('admin.liveMap', lang)} desc={t('admin.welcome.realTimeView', lang)} onClick={() => onNavigate('map')} color="emerald" />
            <QuickAction icon={Users} label={t('admin.welcome.manageUsers', lang)} desc={t('admin.welcome.teamCitizens', lang)} onClick={() => onNavigate('users')} color="amber" />
            <QuickAction icon={Activity} label={t('admin.systemHealth', lang)} desc={t('admin.welcome.monitorStatus', lang)} onClick={() => onNavigate('system_health')} color="cyan" />
          </div>
        </div>

        {/* Active Alerts */}
        <div className="glass-card rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-red-500" />
              {t('stats.activeAlerts', lang)}
            </h3>
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg">
              {activeAlertsFull.length} {t('admin.welcome.active', lang)}
            </span>
          </div>
          {activeAlerts.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('admin.welcome.allClear', lang)}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeAlerts.map((alert, i) => (
                <div key={alert.id || i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/60 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 hover:shadow-sm transition-shadow">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    alert.severity === 'Critical' ? 'bg-red-500 animate-pulse' :
                    alert.severity === 'High' ? 'bg-orange-500' :
                    alert.severity === 'Medium' ? 'bg-amber-500' : 'bg-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{alert.title || alert.message || t('admin.welcome.alert', lang)}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{alert.severity || t('admin.welcome.info', lang)} | {alert.area || t('admin.welcome.allAreas', lang)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glass-card rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            {t('reports.title', lang)}
          </h3>
          <button onClick={() => onNavigate('reports')} className="text-[10px] font-bold text-aegis-600 hover:text-aegis-700 flex items-center gap-1 transition-colors">
            {t('admin.welcome.viewAll', lang)} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {recentReports.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">{t('admin.welcome.noReports', lang)}</p>
        ) : (
          <div className="space-y-2">
            {recentReports.map((r, i) => (
              <div key={r.id || i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-all hover:shadow-sm">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  r.severity === 'High' ? 'bg-red-100 dark:bg-red-950/30' :
                  r.severity === 'Medium' ? 'bg-amber-100 dark:bg-amber-950/30' : 'bg-blue-100 dark:bg-blue-950/30'
                }`}>
                  <AlertTriangle className={`w-4 h-4 ${
                    r.severity === 'High' ? 'text-red-600 dark:text-red-400' :
                    r.severity === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{r.type || t('admin.welcome.report', lang)} {r.reportNumber || ''}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{r.location || t('admin.welcome.unknownLocation', lang)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                    r.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' :
                    r.status === 'Verified' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                    r.status === 'Resolved' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' :
                    'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                  }`}>{localizeStatus(r.status)}</span>
                  <p className="text-[9px] text-gray-400 mt-0.5">
                    {new Date(r.timestamp).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Overview Footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 stagger-children">
        <MiniStat label={t('admin.welcome.highSev', lang)} value={stats.high} accent={stats.high > 0 ? 'red' : undefined} />
        <MiniStat label={t('admin.filters.severity.medium', lang)} value={stats.medium} accent={stats.medium > 0 ? 'amber' : undefined} />
        <MiniStat label={t('admin.filters.severity.low', lang)} value={stats.low} />
        <MiniStat label={t('admin.welcome.withMedia', lang)} value={stats.withMedia} />
        <MiniStat label={t('admin.welcome.trapped', lang)} value={stats.trapped} accent={stats.trapped > 0 ? 'red' : undefined} />
        <MiniStat label={t('admin.welcome.avgConf', lang)} value={`${stats.avgConf}%`} />
        <MiniStat label={t('admin.welcome.activeAlerts', lang)} value={activeAlertsFull.length} accent={activeAlertsFull.length > 0 ? 'amber' : undefined} />
        <MiniStat label={t('admin.welcome.resolutionRate', lang)} value={`${stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0}%`} />
      </div>

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{t('common.shortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">D</kbd> Command Center</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> Reports</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">M</kbd> Map</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">A</kbd> Analytics</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">B</kbd> Broadcast</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {t('common.toggleShortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{t('common.esc', lang)}</kbd> {t('common.close', lang)}</span>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, onClick, pulse, gauge }: { icon: any; label: string; value: string | number; color: string; onClick?: () => void; pulse?: boolean; gauge?: number }) {
  const colors: Record<string, string> = {
    blue: 'from-blue-500 to-indigo-600',
    red: 'from-red-500 to-rose-600',
    emerald: 'from-emerald-500 to-teal-600',
    violet: 'from-violet-500 to-purple-600',
    amber: 'from-amber-500 to-orange-600',
    cyan: 'from-cyan-500 to-teal-600',
  }

  //Animated counter for numeric values
  const numericValue = typeof value === 'number' ? value : null
  const [displayVal, setDisplayVal] = useState(0)
  const mounted = useRef(false)
  useEffect(() => {
    if (numericValue === null || numericValue === 0) return
    if (mounted.current) { setDisplayVal(numericValue); return }
    mounted.current = true
    const duration = 800
    const startTime = performance.now()
    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setDisplayVal(Math.round(eased * numericValue))
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [numericValue])

  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag onClick={onClick} className="glass-card rounded-2xl p-4 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group relative overflow-hidden">
      {/* Background gauge arc for percentage values */}
      {gauge != null && (
        <div className="absolute top-2 right-2 w-10 h-10 opacity-30">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-200 dark:text-gray-700" />
            <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="2.5" strokeLinecap="round"
              stroke={gauge >= 80 ? '#10b981' : gauge >= 50 ? '#f59e0b' : '#ef4444'}
              strokeDasharray={`${gauge} ${100 - gauge}`} />
          </svg>
        </div>
      )}
      <div className="flex items-center justify-between mb-1.5">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${colors[color] || colors.blue} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-200`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        {pulse && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />}
      </div>
      <div className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
        {numericValue !== null ? displayVal : value}
      </div>
      <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">{label}</div>
    </Tag>
  )
}

function QuickAction({ icon: Icon, label, desc, onClick, color }: { icon: any; label: string; desc: string; onClick: () => void; color: string }) {
  const bgColors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-950/40',
    red: 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40',
    violet: 'bg-violet-50 dark:bg-violet-950/20 hover:bg-violet-100 dark:hover:bg-violet-950/40',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40',
    amber: 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40',
    cyan: 'bg-cyan-50 dark:bg-cyan-950/20 hover:bg-cyan-100 dark:hover:bg-cyan-950/40',
  }
  const iconColors: Record<string, string> = {
    blue: 'text-blue-600 dark:text-blue-400',
    red: 'text-red-600 dark:text-red-400',
    violet: 'text-violet-600 dark:text-violet-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
  }

  return (
    <button onClick={onClick} className={`p-3 rounded-xl transition-all duration-200 text-left hover:shadow-md hover:-translate-y-0.5 ${bgColors[color] || bgColors.blue}`}>
      <Icon className={`w-5 h-5 ${iconColors[color] || iconColors.blue} mb-1.5`} />
      <p className="text-xs font-bold text-gray-900 dark:text-white">{label}</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{desc}</p>
    </button>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: 'red' | 'amber' }) {
  const accentColor = accent === 'red' ? 'text-red-600 dark:text-red-400' : accent === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'
  return (
    <div className="glass-card rounded-xl p-3 text-center hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className={`text-lg font-black ${accentColor}`}>{value}</div>
      <div className="text-[8px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</div>
    </div>
  )
}
