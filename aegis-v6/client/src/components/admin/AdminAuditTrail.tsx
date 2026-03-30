 /*
 * AdminAuditTrail.tsx — Professional Compliance Audit Trail Dashboard
 * Enterprise-grade audit log viewer with expandable rows showing before/after
 * state diffs, IP forensics, activity timeline chart, date range filtering,
 * operator breakdown, CSV export, and pagination.
  */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Shield, CheckCircle, Flag, Siren, Package, AlertTriangle, Trash2, Ban,
  Activity, Search, RefreshCw, Download, X, ChevronDown,
  User, FileText, Send, LogIn, Edit2, Key, Eye, Archive, Lock,
  Globe, Monitor, Calendar, BarChart3, TrendingUp
} from 'lucide-react'
import { apiGetAuditLog, type AuditEntry } from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/*  Types  */

// Extends the base AuditEntry with additional audit-specific fields

interface Props {
  auditLog: AuditEntry[]
  setAuditLog: (log: AuditEntry[]) => void
}

/*  Action Type Config (comprehensive)  */

const ACTION_CONFIG: Record<string, { bg: string; text: string; icon: any; label: string }> = {
  verify:         { bg: 'bg-emerald-500', text: 'text-emerald-600', icon: CheckCircle,    label: 'Verify' },
  user_activate:  { bg: 'bg-emerald-500', text: 'text-emerald-600', icon: CheckCircle,    label: 'Activate' },
  flag:           { bg: 'bg-amber-500',   text: 'text-amber-600',   icon: Flag,            label: 'Flag' },
  urgent:         { bg: 'bg-red-500',     text: 'text-red-600',     icon: Siren,           label: 'Urgent' },
  resolve:        { bg: 'bg-gray-500',    text: 'text-gray-600',    icon: CheckCircle,     label: 'Resolve' },
  deploy:         { bg: 'bg-teal-500',    text: 'text-teal-600',    icon: Package,         label: 'Deploy' },
  recall:         { bg: 'bg-orange-500',  text: 'text-orange-600',  icon: AlertTriangle,   label: 'Recall' },
  user_delete:    { bg: 'bg-red-600',     text: 'text-red-600',     icon: Trash2,          label: 'Delete User' },
  user_suspend:   { bg: 'bg-rose-500',    text: 'text-rose-600',    icon: Ban,             label: 'Suspend' },
  alert_send:     { bg: 'bg-blue-500',    text: 'text-blue-600',    icon: Send,            label: 'Alert' },
  profile_edit:   { bg: 'bg-indigo-500',  text: 'text-indigo-600',  icon: Edit2,           label: 'Edit Profile' },
  export:         { bg: 'bg-cyan-500',    text: 'text-cyan-600',    icon: Download,        label: 'Export' },
  login:          { bg: 'bg-sky-500',     text: 'text-sky-600',     icon: LogIn,           label: 'Login' },
  archive:        { bg: 'bg-slate-500',   text: 'text-slate-600',   icon: Archive,         label: 'Archive' },
  false_report:   { bg: 'bg-pink-500',    text: 'text-pink-600',    icon: X,               label: 'False Report' },
  password_reset: { bg: 'bg-violet-500',  text: 'text-violet-600',  icon: Key,             label: 'Password Reset' },
  status_change:  { bg: 'bg-purple-500',  text: 'text-purple-600',  icon: Activity,        label: 'Status Change' },
  bulk_update:    { bg: 'bg-fuchsia-500', text: 'text-fuchsia-600', icon: FileText,        label: 'Bulk Update' },
}

const DEFAULT_CONFIG = { bg: 'bg-blue-500', text: 'text-blue-600', icon: Activity, label: 'Action' }

function getConfig(actionType: string) {
  return ACTION_CONFIG[actionType] || DEFAULT_CONFIG
}

/*  CSV Export  */

function exportAuditCSV(entries: AuditEntry[]) {
  const headers = ['Timestamp', 'Action Type', 'Action', 'Operator', 'Target Type', 'Target ID', 'IP Address', 'User Agent']
  const rows = entries.map(e => [
    e.created_at,
    e.action_type || '',
    `"${(e.action || '').replace(/"/g, '""')}"`,
    `"${(e.operator_name || 'System').replace(/"/g, '""')}"`,
    e.target_type || '',
    e.target_id || '',
    e.ip_address || '',
    `"${(e.user_agent || '').replace(/"/g, '""')}"`
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/*  Helpers  */

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
  } catch { return ts }
}

function relativeTime(ts: string, lang: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('common.justNow', lang)
  if (mins < 60) return `${mins}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}${t('common.hoursShort', lang)} ${t('common.ago', lang)}`
  const days = Math.floor(hours / 24)
  return `${days}${t('common.daysShort', lang)} ${t('common.ago', lang)}`
}

function parseUA(ua?: string): string {
  if (!ua) return 'Unknown'
  if (ua.includes('Chrome')) return 'Chrome'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Safari')) return 'Safari'
  if (ua.includes('Edge')) return 'Edge'
  return 'Other'
}

/* Status badge color mapping for human-friendly state rendering */
const STATUS_COLORS: Record<string, string> = {
  Verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Flagged: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  Resolved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Suspended: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  Deleted: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

function renderStateValue(key: string, value: unknown): JSX.Element {
  const strVal = String(value)
  const badgeColor = STATUS_COLORS[strVal]
  if (badgeColor) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}>
        {strVal}
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return <span className={`text-[10px] font-bold ${value ? 'text-green-600' : 'text-red-500'}`}>{value ? 'Yes' : 'No'}</span>
  }
  if (typeof value === 'object' && value !== null) {
    return <span className="text-[10px] font-mono text-gray-600 dark:text-gray-400">{JSON.stringify(value)}</span>
  }
  return <span className="text-xs text-gray-800 dark:text-gray-200 font-medium">{strVal}</span>
}

function renderStateBlock(state: Record<string, any> | string | null | undefined): JSX.Element | null {
  if (!state) return null
  const obj = typeof state === 'string' ? (() => { try { return JSON.parse(state) } catch { return { value: state } } })() : state
  const entries = Object.entries(obj)
  return (
    <div className="space-y-1.5">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold capitalize min-w-[60px]">{key.replace(/_/g, ' ')}:</span>
          {renderStateValue(key, val)}
        </div>
      ))}
    </div>
  )
}

export default function AdminAuditTrail({ auditLog, setAuditLog }: Props) {
  const lang = useLanguage()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [operatorFilter, setOperatorFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const PAGE_SIZE = 15

  //  Derived data
  const actionTypes = useMemo(() =>
    [...new Set(auditLog.map(a => a.action_type).filter(Boolean))].sort(),
  [auditLog])

  const operators = useMemo(() =>
    [...new Set(auditLog.map(a => a.operator_name).filter(Boolean))].sort(),
  [auditLog])

  //  Stats
  const stats = useMemo(() => {
    const today = new Date().toDateString()
    const todayCount = auditLog.filter(a => new Date(a.created_at).toDateString() === today).length
    const thisWeek = auditLog.filter(a => {
      const d = new Date(a.created_at)
      const now = new Date()
      return (now.getTime() - d.getTime()) < 7 * 24 * 60 * 60 * 1000
    }).length
    const criticalActions = auditLog.filter(a =>
      ['user_delete', 'user_suspend', 'urgent', 'password_reset'].includes(a.action_type)
    ).length
    return { todayCount, thisWeek, criticalActions, operatorCount: operators.length, typeCount: actionTypes.length }
  }, [auditLog, operators, actionTypes])

  //  7-day activity timeline
  const timeline = useMemo(() => {
    const days: { label: string; count: number; date: string }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toDateString()
      const label = d.toLocaleDateString('en-GB', { weekday: 'short' })
      const count = auditLog.filter(a => new Date(a.created_at).toDateString() === dateStr).length
      days.push({ label, count, date: dateStr })
    }
    return days
  }, [auditLog])

  const maxTimelineCount = useMemo(() => Math.max(...timeline.map(d => d.count), 1), [timeline])

  //  Filtered + sorted (memoized)
  const filteredAudit = useMemo(() => {
    let items = [...auditLog]
    if (typeFilter !== 'all') items = items.filter(a => a.action_type === typeFilter)
    if (operatorFilter !== 'all') items = items.filter(a => a.operator_name === operatorFilter)
    if (dateFrom) {
      const from = new Date(dateFrom).getTime()
      items = items.filter(a => new Date(a.created_at).getTime() >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59').getTime()
      items = items.filter(a => new Date(a.created_at).getTime() <= to)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(a =>
        (a.action || '').toLowerCase().includes(q) ||
        (a.operator_name || '').toLowerCase().includes(q) ||
        (a.target_id || '').toLowerCase().includes(q) ||
        (a.action_type || '').toLowerCase().includes(q) ||
        (a.ip_address || '').toLowerCase().includes(q)
      )
    }
    if (sortOrder === 'oldest') items.reverse()
    return items
  }, [auditLog, typeFilter, operatorFilter, dateFrom, dateTo, search, sortOrder])

  // Pagination
  const paginatedItems = useMemo(() => filteredAudit.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredAudit, page])
  const totalPages = Math.max(1, Math.ceil(filteredAudit.length / PAGE_SIZE))

  // Reset page on filter change
  const resetPage = useCallback(() => setPage(0), [])

  //  Refresh handler
  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setFetchError(null)
    apiGetAuditLog({ limit: '500' })
      .then(d => setAuditLog(d || []))
      .catch(() => setFetchError(t('audit.fetchError', lang) || 'Failed to refresh audit log'))
      .finally(() => setRefreshing(false))
  }, [setAuditLog, lang])

  //  Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(() => {
      apiGetAuditLog({ limit: '500' })
        .then(d => setAuditLog(d || []))
        .catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [setAuditLog])

  //  Active filters check
  const hasFilters = search || typeFilter !== 'all' || operatorFilter !== 'all' || dateFrom || dateTo

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setOperatorFilter('all')
    setDateFrom('')
    setDateTo('')
    resetPage()
  }

  // Keyboard shortcuts
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handleRefresh() }
      else if (key === 'e') { e.preventDefault(); exportAuditCSV(filteredAudit) }
      else if (key === 'n') { e.preventDefault(); setSortOrder('newest') }
      else if (key === 'o') { e.preventDefault(); setSortOrder('oldest') }
      else if (key === 'x') { e.preventDefault(); clearFilters() }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleRefresh, filteredAudit])

  //  Operator breakdown
  const operatorBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    auditLog.forEach(a => {
      const name = a.operator_name || 'System'
      map[name] = (map[name] || 0) + 1
    })
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 5)
  }, [auditLog])

  //  Type breakdown
  const typeBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    auditLog.forEach(a => {
      const t = a.action_type || 'unknown'
      map[t] = (map[t] || 0) + 1
    })
    return Object.entries(map).sort(([, a], [, b]) => b - a)
  }, [auditLog])

  return (
    <div className="space-y-5 animate-fade-in">

      {/*  HEADER  */}
      <div className="bg-gradient-to-br from-violet-900 via-purple-900 to-indigo-900 rounded-2xl shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative z-10 p-6">
          {/* Title row */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-indigo-500/20 rounded-xl flex items-center justify-center border border-purple-400/20">
                <Shield className="w-6 h-6 text-purple-300" />
              </div>
              <div>
                <h2 className="text-slate-900 dark:text-white font-bold text-xl tracking-tight">{t('audit.complianceTitle', lang)}</h2>
                <p className="text-purple-300 text-sm">{t('audit.subtitle', lang)} &middot; {t('audit.tamperEvident', lang)} &middot; {auditLog.length} {t('common.total', lang)} {t('common.entries', lang)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportAuditCSV(filteredAudit)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-gray-300 dark:text-gray-300 hover:text-white transition-all"
              >
                <Download className="w-3.5 h-3.5" /> {t('common.exportCsv', lang)}
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-xs text-white transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
              </button>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: t('audit.totalEntries', lang), value: auditLog.length, icon: FileText, color: 'text-cyan-300', accent: 'from-cyan-500/10 to-cyan-600/5' },
              { label: t('audit.today', lang), value: stats.todayCount, icon: Calendar, color: 'text-green-300', accent: 'from-green-500/10 to-green-600/5' },
              { label: t('audit.thisWeek', lang), value: stats.thisWeek, icon: TrendingUp, color: 'text-blue-300', accent: 'from-blue-500/10 to-blue-600/5' },
              { label: t('audit.criticalActions', lang), value: stats.criticalActions, icon: AlertTriangle, color: 'text-red-300', accent: 'from-red-500/10 to-red-600/5' },
              { label: t('audit.operators', lang), value: stats.operatorCount, icon: User, color: 'text-amber-300', accent: 'from-amber-500/10 to-amber-600/5' },
              { label: t('audit.actionTypes', lang), value: stats.typeCount, icon: BarChart3, color: 'text-purple-300', accent: 'from-purple-500/10 to-purple-600/5' },
            ].map((s, i) => (
              <div key={i} className={`bg-gradient-to-br ${s.accent} rounded-xl p-3 border border-white/5 hover:border-white/10 transition-colors`}>
                <div className="flex items-center gap-2 mb-1">
                  <s.icon className={`w-3.5 h-3.5 ${s.color} opacity-70`} />
                  <p className="text-[10px] text-purple-300/80 uppercase tracking-wider font-semibold">{s.label}</p>
                </div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*  ACTIVITY TIMELINE + BREAKDOWN  */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 7-Day Activity Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-600" />
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">{t('audit.sevenDayActivity', lang)}</h3>
            </div>
            <span className="text-[10px] text-gray-500 dark:text-gray-300">{stats.thisWeek} {t('audit.entriesThisWeek', lang)}</span>
          </div>
          <div className="flex items-end gap-2 h-28">
            {timeline.map((day, i) => {
              const pct = maxTimelineCount > 0 ? (day.count / maxTimelineCount) * 100 : 0
              const isToday = i === timeline.length - 1
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="text-[9px] font-bold text-gray-400 dark:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">{day.count}</div>
                  <div className="w-full relative" style={{ height: '80px' }}>
                    <div
                      className={`absolute bottom-0 w-full rounded-t-md transition-all shadow-sm group-hover:shadow-md ${
                        isToday ? 'bg-gradient-to-t from-purple-600 to-purple-400' : 'bg-gradient-to-t from-gray-300 to-gray-200 dark:from-gray-700 dark:to-gray-600'
                      }`}
                      style={{ height: `${Math.max(pct, 6)}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-medium ${isToday ? 'text-purple-600 font-bold' : 'text-gray-500 dark:text-gray-300'}`}>{day.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Operator & Type Breakdown */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-purple-600" />
            <h3 className="font-bold text-sm text-gray-900 dark:text-white">{t('audit.topOperators', lang)}</h3>
          </div>
          <div className="space-y-2.5">
            {operatorBreakdown.map(([name, count]) => {
              const pct = auditLog.length > 0 ? Math.round((count / auditLog.length) * 100) : 0
              return (
                <div key={name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{name}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-300 ml-2">{count} ({pct}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            {operatorBreakdown.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-300 text-center py-4">{t('audit.noOperatorData', lang)}</p>
            )}
          </div>

          {/* Type distribution mini */}
          <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-[10px] text-gray-500 dark:text-gray-300 uppercase tracking-wider font-semibold">{t('audit.actionTypes', lang)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {typeBreakdown.slice(0, 8).map(([type, count]) => {
                const cfg = getConfig(type)
                return (
                  <span key={type} className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-bold ${cfg.bg} text-white`}>
                    {cfg.label} ({count})
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/*  FILTERS  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage() }}
              placeholder={t('audit.searchPlaceholder', lang)}
              className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
            />
            {search && (
              <button onClick={() => { setSearch(''); resetPage() }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-300 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); resetPage() }}
            className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            <option value="all">{t('audit.allTypes', lang)}</option>
            {actionTypes.map(t => {
              const cfg = getConfig(t)
              return <option key={t} value={t}>{cfg.label} ({t})</option>
            })}
          </select>
          <select
            value={operatorFilter}
            onChange={e => { setOperatorFilter(e.target.value); resetPage() }}
            className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            <option value="all">{t('audit.allOperators', lang)}</option>
            {operators.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={sortOrder}
            onChange={e => { setSortOrder(e.target.value as any); resetPage() }}
            className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            <option value="newest">{t('audit.newestFirst', lang)}</option>
            <option value="oldest">{t('audit.oldestFirst', lang)}</option>
          </select>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <X className="w-3 h-3" /> {t('common.clearAll', lang)}
            </button>
          )}
          {/* Date range filter */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); resetPage() }}
              className="text-xs px-2 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
              title={t('audit.dateFrom', lang)}
            />
            <span className="text-[10px] text-gray-400">–</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => { setDateTo(e.target.value); resetPage() }}
              className="text-xs px-2 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
              title={t('audit.dateTo', lang)}
            />
          </div>
          <span className="text-[10px] text-gray-500 dark:text-gray-300 ml-auto">{filteredAudit.length}/{auditLog.length} {t('common.entries', lang)}</span>
        </div>
      </div>

      {/*  AUDIT TABLE  */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
        {/* Table header */}
        <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-300">
          <div className="col-span-1">{t('common.type', lang)}</div>
          <div className="col-span-4">{t('audit.action', lang)}</div>
          <div className="col-span-2">{t('audit.operator', lang)}</div>
          <div className="col-span-2">{t('audit.target', lang)}</div>
          <div className="col-span-2">{t('audit.timestamp', lang)}</div>
          <div className="col-span-1 text-center">{t('common.details', lang)}</div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {paginatedItems.length === 0 ? (
            <div className="text-center py-14">
              <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-300 font-semibold">{t('audit.noEntriesFound', lang)}</p>
              <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
                {hasFilters ? t('audit.tryAdjustingFilters', lang) : t('audit.actionsWillBeRecorded', lang)}
              </p>
            </div>
          ) : paginatedItems.map((entry) => {
            const cfg = getConfig(entry.action_type)
            const Icon = cfg.icon
            const isExpanded = expandedRow === entry.id
            const hasMeta = entry.before_state || entry.after_state || entry.ip_address || entry.user_agent

            return (
              <div key={entry.id}>
                <div
                  className={`grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors items-center ${hasMeta ? 'cursor-pointer' : ''}`}
                  onClick={() => hasMeta && setExpandedRow(isExpanded ? null : entry.id)}
                >
                  {/* Type icon */}
                  <div className="col-span-1 flex items-center">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${cfg.bg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Action */}
                  <div className="col-span-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{entry.action}</p>
                    <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded font-bold mt-0.5 ${cfg.bg} text-white`}>
                      {cfg.label}
                    </span>
                  </div>

                  {/* Operator */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <User className="w-3 h-3 text-gray-500 dark:text-gray-300" />
                      </div>
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{entry.operator_name || t('common.system', lang)}</p>
                    </div>
                  </div>

                  {/* Target */}
                  <div className="col-span-2">
                    {entry.target_id ? (
                      <div className="group/tgt">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                            title={entry.target_id}
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.target_id!) }}
                          >
                            {(() => {
                              const prefix = entry.target_type === 'report' ? 'RPT' : entry.target_type === 'user' ? 'USR' : entry.target_type === 'alert' ? 'ALT' : 'TGT'
                              return `${prefix}-${entry.target_id.slice(0, 6).toUpperCase()}`
                            })()}
                          </span>
                          <button
                            className="opacity-0 group-hover/tgt:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.target_id!) }}
                            title={t('audit.copyTargetId', lang)}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                          </button>
                        </div>
                        {entry.target_type && <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 capitalize">{entry.target_type}</p>}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-300">—</span>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="col-span-2">
                    <p className="text-xs text-gray-700 dark:text-gray-300">{formatTimestamp(entry.created_at)}</p>
                    <p className="text-[9px] text-gray-400 dark:text-gray-300">{relativeTime(entry.created_at, lang)}</p>
                  </div>

                  {/* Expand toggle */}
                  <div className="col-span-1 flex justify-center">
                    {hasMeta ? (
                      <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    ) : (
                      <span className="text-[9px] text-gray-300 dark:text-gray-300">—</span>
                    )}
                  </div>
                </div>

                {/*  Expanded Detail Panel  */}
                {isExpanded && hasMeta && (
                  <div className="px-5 pb-4 pt-0 animate-fade-in">
                    <div className="ml-11 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700 space-y-3">
                      {/* Before / After State Diff */}
                      {(entry.before_state || entry.after_state) && (
                        <div>
                          <p className="text-[10px] text-gray-500 dark:text-gray-300 uppercase font-semibold mb-2 flex items-center gap-1">
                            <Eye className="w-3 h-3" /> {t('audit.stateChange', lang)}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {entry.before_state && (
                              <div className="rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 p-3">
                                <p className="text-[9px] uppercase font-bold text-red-500 mb-2">{t('audit.before', lang)}</p>
                                {renderStateBlock(entry.before_state)}
                              </div>
                            )}
                            {entry.after_state && (
                              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 p-3">
                                <p className="text-[9px] uppercase font-bold text-emerald-500 mb-2">{t('audit.after', lang)}</p>
                                {renderStateBlock(entry.after_state)}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Forensic metadata */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {entry.ip_address && (
                          <div className="flex items-start gap-2">
                            <Globe className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 mt-0.5" />
                            <div>
                              <p className="text-[9px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('audit.ipAddress', lang)}</p>
                              <p className="text-xs font-mono text-gray-700 dark:text-gray-300">{entry.ip_address}</p>
                            </div>
                          </div>
                        )}
                        {entry.user_agent && (
                          <div className="flex items-start gap-2">
                            <Monitor className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 mt-0.5" />
                            <div>
                              <p className="text-[9px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('audit.browser', lang)}</p>
                              <p className="text-xs text-gray-700 dark:text-gray-300">{parseUA(entry.user_agent)}</p>
                            </div>
                          </div>
                        )}
                        {entry.operator_id && (
                          <div className="flex items-start gap-2">
                            <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 mt-0.5" />
                            <div>
                              <p className="text-[9px] text-gray-500 dark:text-gray-300 uppercase font-semibold">{t('audit.operatorId', lang)}</p>
                              <div className="flex items-center gap-1.5 group">
                                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                                  OPR-{entry.operator_id.slice(0, 6).toUpperCase()}
                                </span>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(entry.operator_id || ''); }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                  title={entry.operator_id}
                                  aria-label={t('audit.copyOperatorId', lang)}
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.previous', lang)}
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 7) {
                  pageNum = i
                } else if (page < 3) {
                  pageNum = i
                } else if (page > totalPages - 4) {
                  pageNum = totalPages - 7 + i
                } else {
                  pageNum = page - 3 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-colors ${
                      page === pageNum
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.next', lang)}
            </button>
          </div>
        )}
      </div>

      {fetchError && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-xl px-4 py-3 flex items-center gap-2 animate-fade-in">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-300 font-medium">{fetchError}</span>
          <button onClick={() => setFetchError(null)} className="ml-auto text-red-400 hover:text-red-600 transition">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">Shortcuts</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> Refresh</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">E</kbd> Export CSV</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">N</kbd> Newest</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">O</kbd> Oldest</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">X</kbd> Clear Filters</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> Toggle Shortcuts</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">Esc</kbd> Close</span>
        </div>
      )}
    </div>
  )
}

