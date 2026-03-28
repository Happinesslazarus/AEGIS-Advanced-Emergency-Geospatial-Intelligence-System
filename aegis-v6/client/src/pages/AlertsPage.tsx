import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell, AlertTriangle, Info, ShieldAlert, ArrowLeft, RefreshCw,
  MapPin, Clock, Filter, ChevronDown, ChevronUp, Radio,
  Flame, Zap, Droplets, Wind, Thermometer, Shield,
  Search, X, Volume2, Eye, ExternalLink,
} from 'lucide-react'
import { useAlerts } from '../contexts/AlertsContext'
import { useLocation } from '../contexts/LocationContext'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import type { Alert } from '../types'

/* Severity config */
const SEVERITY_CONFIG: Record<string, {
  gradient: string; border: string; bg: string; text: string;
  icon: React.ElementType; pulse: string; badge: string; labelKey: string
}> = {
  critical: {
    gradient: 'from-red-600 via-red-500 to-rose-500',
    border: 'border-red-300 dark:border-red-700',
    bg: 'bg-red-50 dark:bg-red-950/20',
    text: 'text-red-700 dark:text-red-300',
    icon: ShieldAlert,
    pulse: 'animate-pulse',
    badge: 'bg-red-500 text-white',
    labelKey: 'alerts.severityCritical',
  },
  high: {
    gradient: 'from-orange-600 via-orange-500 to-amber-500',
    border: 'border-orange-300 dark:border-orange-700',
    bg: 'bg-orange-50 dark:bg-orange-950/20',
    text: 'text-orange-700 dark:text-orange-300',
    icon: AlertTriangle,
    pulse: '',
    badge: 'bg-orange-500 text-white',
    labelKey: 'alerts.severityHigh',
  },
  warning: {
    gradient: 'from-amber-500 via-yellow-500 to-amber-400',
    border: 'border-amber-300 dark:border-amber-700',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    text: 'text-amber-700 dark:text-amber-300',
    icon: AlertTriangle,
    pulse: '',
    badge: 'bg-amber-500 text-white',
    labelKey: 'alerts.severityWarning',
  },
  medium: {
    gradient: 'from-amber-500 via-yellow-500 to-amber-400',
    border: 'border-amber-300 dark:border-amber-700',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    text: 'text-amber-700 dark:text-amber-300',
    icon: AlertTriangle,
    pulse: '',
    badge: 'bg-amber-500 text-white',
    labelKey: 'alerts.severityWarning',
  },
  info: {
    gradient: 'from-blue-500 via-sky-500 to-blue-400',
    border: 'border-blue-300 dark:border-blue-700',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    text: 'text-blue-700 dark:text-blue-300',
    icon: Info,
    pulse: '',
    badge: 'bg-blue-500 text-white',
    labelKey: 'alerts.severityInfo',
  },
  low: {
    gradient: 'from-blue-500 via-sky-500 to-blue-400',
    border: 'border-blue-300 dark:border-blue-700',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    text: 'text-blue-700 dark:text-blue-300',
    icon: Info,
    pulse: '',
    badge: 'bg-blue-500 text-white',
    labelKey: 'alerts.severityInfo',
  },
}

const DISASTER_ICONS: Record<string, React.ElementType> = {
  fire: Flame, flood: Droplets, storm: Wind, earthquake: Zap,
  heatwave: Thermometer, general: Shield, default: Bell,
}

function getSeverityConfig(severity: string) {
  return SEVERITY_CONFIG[severity?.toLowerCase()] || SEVERITY_CONFIG.info
}

function getDisasterIcon(type: string): React.ElementType {
  return DISASTER_ICONS[type?.toLowerCase()] || DISASTER_ICONS.default
}

function formatTimeAgo(timestamp: string, lang: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const mins = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 1) return t('alerts.justNow', lang)
  if (mins < 60) return `${mins}${t('alerts.minsAgo', lang)}`
  if (hours < 24) return `${hours}${t('alerts.hoursAgo', lang)}`
  if (days < 7) return `${days}${t('alerts.daysAgo', lang)}`
  return then.toLocaleDateString()
}

export default function AlertsPage(): JSX.Element {
  const lang = useLanguage()
  const { alerts, loading, refreshAlerts } = useAlerts()
  const { activeLocation } = useLocation()
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'severity'>('newest')
  const headerRef = useRef<HTMLDivElement>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshAlerts()
    setRefreshing(false)
  }

  useEffect(() => { refreshAlerts() }, [activeLocation])

  // Severity priority for sorting
  const severityOrder: Record<string, number> = { critical: 0, high: 1, warning: 2, medium: 3, info: 4, low: 5 }

  const filteredAlerts = useMemo(() => {
    let result = alerts.filter(a => a.active)

    if (filterSeverity !== 'all') {
      result = result.filter(a => a.severity === filterSeverity)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        a.area?.toLowerCase().includes(q) ||
        a.disasterType?.toLowerCase().includes(q)
      )
    }

    if (sortBy === 'severity') {
      result.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
    } else {
      result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    }
    return result
  }, [alerts, filterSeverity, searchQuery, sortBy])

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, critical: 0, high: 0, warning: 0, medium: 0, info: 0, low: 0 }
    alerts.filter(a => a.active).forEach(a => {
      counts.all++
      counts[a.severity] = (counts[a.severity] || 0) + 1
    })
    return counts
  }, [alerts])

  const criticalCount = (severityCounts.critical || 0) + (severityCounts.high || 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero Header */}
      <div ref={headerRef} className="relative overflow-hidden">
        <div className={`bg-gradient-to-br ${criticalCount > 0 ? 'from-red-900 via-red-800 to-rose-900' : 'from-slate-900 via-gray-900 to-slate-800'} text-white transition-colors duration-1000`}>
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden">
            {criticalCount > 0 && (
              <>
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-red-500/10 via-transparent to-transparent animate-pulse" style={{ animationDuration: '3s' }} />
                <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-red-500/10 animate-pulse" style={{ animationDuration: '4s' }} />
                <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-rose-500/10 animate-pulse" style={{ animationDuration: '5s' }} />
              </>
            )}
            {[...Array(5)].map((_, i) => (
              <div key={i} className="absolute rounded-full bg-white/5 animate-pulse" style={{
                width: `${30 + i * 20}px`, height: `${30 + i * 20}px`,
                top: `${10 + i * 18}%`, left: `${10 + i * 18}%`,
                animationDelay: `${i * 0.7}s`, animationDuration: `${3 + i}s`
              }} />
            ))}
          </div>

          <div className="relative z-10 max-w-5xl mx-auto px-6 py-10 sm:py-14">
            <Link to="/citizen" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-5 transition-colors group">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> {t('alerts.backToAegis', lang)}
            </Link>

            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${
                  criticalCount > 0 ? 'bg-red-500/30 backdrop-blur-sm' : 'bg-white/15 backdrop-blur-sm'
                }`}>
                  <Bell className={`w-7 h-7 ${criticalCount > 0 ? 'animate-bounce' : ''}`} />
                </div>
                <div>
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{t('alerts.pageTitle', lang)}</h1>
                  <p className="text-white/60 text-sm mt-1">
                    {t('alerts.subtitle', lang)} <span className="text-white font-semibold">{activeLocation || 'your area'}</span>
                  </p>
                </div>
              </div>

              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold transition-all disabled:opacity-50 backdrop-blur-sm"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {t('alerts.refresh', lang)}
              </button>
            </div>

            {/* Summary badges */}
            <div className="flex flex-wrap gap-2 mt-6">
              {criticalCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/30 border border-red-400/30 text-xs font-bold backdrop-blur-sm animate-pulse">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {criticalCount} Critical
                </div>
              )}
              {(severityCounts.warning || 0) + (severityCounts.medium || 0) > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-xs font-bold backdrop-blur-sm">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {(severityCounts.warning || 0) + (severityCounts.medium || 0)} Warnings
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-bold backdrop-blur-sm">
                <Radio className="w-3.5 h-3.5" />
                {severityCounts.all} Total Active
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">

        {/* Search & Filter bar */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700/80 shadow-lg overflow-hidden">
          <div className="p-4 flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-200 dark:border-gray-700/50 focus-within:border-aegis-400 dark:focus-within:border-aegis-600 focus-within:ring-2 focus-within:ring-aegis-500/20 transition-all">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('alerts.searchPlaceholder', lang)}
                className="flex-1 bg-transparent text-sm font-medium outline-none text-gray-900 dark:text-white placeholder-gray-400"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                showFilters
                  ? 'bg-aegis-50 dark:bg-aegis-950/30 border-aegis-300 dark:border-aegis-700 text-aegis-700 dark:text-aegis-300'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Filter className="w-4 h-4" />
              {t('alerts.filters', lang)}
              {filterSeverity !== 'all' && <span className="w-2 h-2 rounded-full bg-aegis-500" />}
            </button>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'newest' | 'severity')}
              className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-bold text-gray-700 dark:text-gray-300 outline-none cursor-pointer"
            >
              <option value="newest">{t('alerts.sortNewest', lang)}</option>
              <option value="severity">{t('alerts.sortSeverity', lang)}</option>
            </select>
          </div>

          {/* Severity filter pills */}
          {showFilters && (
            <div className="px-4 pb-4 pt-1 flex flex-wrap gap-2 border-t border-gray-100 dark:border-gray-800">
              {['all', 'critical', 'warning', 'info'].map(sev => {
                const isActive = filterSeverity === sev
                const count = severityCounts[sev] || 0
                const cfg = sev !== 'all' ? getSeverityConfig(sev) : null
                return (
                  <button
                    key={sev}
                    onClick={() => setFilterSeverity(sev)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                      isActive
                        ? cfg ? `${cfg.badge}` : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {sev === 'all' ? t('alerts.filterAll', lang) : cfg ? t(cfg.labelKey, lang) : sev}
                    <span className={`text-[10px] ${isActive ? 'opacity-80' : ''}`}>({count})</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gray-200 dark:bg-gray-700" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredAlerts.length === 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-50 dark:bg-green-950/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('alerts.allClear', lang)}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              {searchQuery || filterSeverity !== 'all'
                ? t('alerts.noMatchFilters', lang)
                : t('alerts.noAlertsMessage', lang)}
            </p>
          </div>
        )}

        {/* Alert cards */}
        <div className="space-y-3">
          {filteredAlerts.map((alert, idx) => {
            const cfg = getSeverityConfig(alert.severity)
            const SevIcon = cfg.icon
            const DisasterIcon = getDisasterIcon(alert.disasterType)
            const isExpanded = expandedId === alert.id
            const timeAgo = formatTimeAgo(alert.timestamp, lang)

            return (
              <div
                key={alert.id}
                className={`group bg-white dark:bg-gray-900 rounded-2xl border ${cfg.border} shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden animate-fade-in`}
                style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
              >
                {/* Severity accent bar */}
                <div className={`h-1 bg-gradient-to-r ${cfg.gradient}`} />

                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-md flex-shrink-0 ${cfg.pulse}`}>
                      <SevIcon className="w-6 h-6 text-white" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full ${cfg.badge}`}>
                          {t(cfg.labelKey, lang)}
                        </span>
                        {alert.disasterType && alert.disasterType !== 'general' && (
                          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                            <DisasterIcon className="w-2.5 h-2.5" />
                            {alert.disasterType}
                          </span>
                        )}
                        {alert.channels && alert.channels.length > 0 && (
                          <span className="flex items-center gap-1 text-[9px] font-bold text-gray-400 dark:text-gray-500">
                            <Volume2 className="w-2.5 h-2.5" />
                            {alert.channels.join(', ')}
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug">{alert.title}</h3>

                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                        {alert.area && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {alert.area}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {timeAgo}
                        </span>
                        <span className="flex items-center gap-1 capitalize">
                          <Radio className="w-3 h-3" /> {alert.source}
                        </span>
                      </div>

                      {/* Collapsed preview */}
                      {!isExpanded && alert.message && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-2 leading-relaxed">
                          {alert.message}
                        </p>
                      )}

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="mt-3 space-y-3 animate-fade-in">
                          <div className={`${cfg.bg} rounded-xl p-4 border ${cfg.border}`}>
                            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                              {alert.message}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                              <span className="text-gray-400 dark:text-gray-500 font-bold block mb-0.5">{t('alerts.source', lang)}</span>
                              <span className="text-gray-700 dark:text-gray-300 font-semibold capitalize">{alert.source}</span>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                              <span className="text-gray-400 dark:text-gray-500 font-bold block mb-0.5">{t('alerts.type', lang)}</span>
                              <span className="text-gray-700 dark:text-gray-300 font-semibold capitalize">{alert.disasterType || t('alerts.general', lang)}</span>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                              <span className="text-gray-400 dark:text-gray-500 font-bold block mb-0.5">{t('alerts.issued', lang)}</span>
                              <span className="text-gray-700 dark:text-gray-300 font-semibold">{new Date(alert.timestamp).toLocaleString()}</span>
                            </div>
                            {alert.channels && alert.channels.length > 0 && (
                              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5 col-span-2 sm:col-span-3">
                                <span className="text-gray-400 dark:text-gray-500 font-bold block mb-0.5">{t('alerts.broadcastChannels', lang)}</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {alert.channels.map(ch => (
                                    <span key={ch} className="px-2 py-0.5 rounded-full bg-aegis-50 dark:bg-aegis-950/30 border border-aegis-200 dark:border-aegis-800 text-aegis-700 dark:text-aegis-300 text-[10px] font-bold uppercase">
                                      {ch}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Expand/collapse toggle */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                      className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Info footer */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700/80 p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center flex-shrink-0">
              <Info className="w-4.5 h-4.5 text-blue-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">{t('alerts.aboutTitle', lang)}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                {t('alerts.aboutDesc', lang)} <Link to="/citizen" className="text-aegis-600 hover:text-aegis-700 font-bold">{t('alerts.citizenPortal', lang)}</Link>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
