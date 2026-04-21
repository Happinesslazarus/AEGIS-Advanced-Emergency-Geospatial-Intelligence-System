/**
 * Resource delivery tracking dashboard (monitors supply distribution).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  Mail, Smartphone, MessageCircle, Send, Bell, RefreshCw, Download, Search,
  CheckCircle, XCircle, Clock, AlertTriangle, RotateCcw, ChevronRight,
  TrendingUp, Activity, Zap, Filter, Calendar, Eye, BarChart2, List,
  X, Info, Layers, Loader2, Users,
} from 'lucide-react'
import { getLanguage, t } from '../../utils/i18n'
import { getToken as _getToken, clearToken } from '../../utils/api'
import { useLanguage } from '../../hooks/useLanguage'
import { DataTable } from '../ui/DataTable'
import type { DataTableColumn } from '../ui/DataTable'

//Types

interface DeliveryRow {
  id: string
  alert_id: string
  alert_title?: string
  alert_severity?: string
  alert_type?: string
  channel: string
  recipient: string
  provider_id?: string
  status: string
  error_message?: string
  sent_at?: string
  delivered_at?: string
  created_at: string
  retry_count: number
  last_retry_at?: string
}

interface GroupedAlert {
  alert_id: string
  alert_title?: string
  alert_severity?: string
  alert_type?: string
  last_attempt: string
  total: number
  sent: number
  failed: number
  pending: number
  channels: string[]
  deliveries: DeliveryRow[]
}

interface ChannelStat {
  channel: string
  total: number
  sent: number
  failed: number
  pending: number
  success_rate: number
}

interface HourlyPoint { hour: string; total: number; sent: number; failed: number }

interface SubscriberStats {
  total_subscribers: number
  verified_subscribers: number
  unverified_subscribers: number
  email_subscribers: number
  sms_subscribers: number
  whatsapp_subscribers: number
  telegram_subscribers: number
  webpush_subscribers: number
}

interface Stats {
  overall: { total: number; sent: number; delivered: number; failed: number; pending: number; success_rate: number }
  by_channel: ChannelStat[]
  hourly_trend: HourlyPoint[]
  top_failing: { alert_id: string; alert_title?: string; severity?: string; fail_count: number }[]
  recent_errors: { channel: string; error_message: string; count: number }[]
  subscribers?: SubscriberStats
}

//Channel Config

const CH: Record<string, { labelKey: string; icon: React.ElementType; color: string; bg: string; ring: string; hex: string }> = {
  email:    { labelKey: 'delivery.channelEmail',    icon: Mail,          color: 'text-rose-400',    bg: 'bg-rose-500/15',    ring: 'ring-rose-500/30',    hex: '#f87171' },
  sms:      { labelKey: 'delivery.channelSms',      icon: Smartphone,    color: 'text-green-400',   bg: 'bg-green-500/15',   ring: 'ring-green-500/30',   hex: '#4ade80' },
  whatsapp: { labelKey: 'delivery.channelWhatsApp', icon: MessageCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30', hex: '#34d399' },
  telegram: { labelKey: 'delivery.channelTelegram', icon: Send,          color: 'text-blue-400',    bg: 'bg-blue-500/15',    ring: 'ring-blue-500/30',    hex: '#60a5fa' },
  web:      { labelKey: 'delivery.channelWebPush',  icon: Bell,          color: 'text-violet-400',  bg: 'bg-violet-500/15',  ring: 'ring-violet-500/30',  hex: '#a78bfa' },
  webpush:  { labelKey: 'delivery.channelWebPush',  icon: Bell,          color: 'text-violet-400',  bg: 'bg-violet-500/15',  ring: 'ring-violet-500/30',  hex: '#a78bfa' },
}
const chCfg = (ch: string) => CH[ch] ?? { labelKey: '', icon: Zap, color: 'text-gray-400 dark:text-gray-300', bg: 'bg-gray-500/15', ring: 'ring-gray-500/30', hex: '#9ca3af' }
const getChannelLabel = (ch: string, lang: string) => {
  const cfg = chCfg(ch)
  return cfg.labelKey ? t(cfg.labelKey, lang) : ch
}

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-500/40',
  warning:  'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-500/40',
  info:     'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-500/40',
}

//Tiny helpers

function StatusBadge({ status }: { status: string }) {
  const lang = getLanguage()
  const ok = status === 'sent' || status === 'delivered'
  const fail = status === 'failed'
  if (ok)   return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300 dark:ring-emerald-500/30"><CheckCircle className="w-2.5 h-2.5"/>{t(status === 'delivered' ? 'delivery.delivered' : 'common.sent', lang)}</span>
  if (fail) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-500/30"><XCircle className="w-2.5 h-2.5"/>{t('delivery.failed', lang)}</span>
  return       <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-500/30"><Clock className="w-2.5 h-2.5 animate-pulse"/>{t('delivery.pending', lang)}</span>
}

function ChanIcon({ ch, size = 'sm' }: { ch: string; size?: 'xs' | 'sm' | 'md' }) {
  const cfg = chCfg(ch)
  const Icon = cfg.icon
  const wrap = size === 'xs' ? 'w-5 h-5' : size === 'md' ? 'w-8 h-8' : 'w-6 h-6'
  const ico  = size === 'xs' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'
  return <span className={`inline-flex items-center justify-center rounded-md ${wrap} ${cfg.bg} ${cfg.color} ring-1 ${cfg.ring}`}><Icon className={ico}/></span>
}

//SVG charts

function DonutChart({ slices, size = 120 }: { slices: { value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const cx = size / 2; const cy = size / 2; const r = 40; const sw = 13
  if (!total) return <div className="flex items-center justify-center text-xs text-gray-600" style={{ width: size, height: size }}>{t('delivery.noData', getLanguage())}</div>
  let angle = -Math.PI / 2
  const arcs = slices.map(s => {
    const sweep = (s.value / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle); const y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle); const y2 = cy + r * Math.sin(angle)
    return { ...s, d: `M ${x1} ${y1} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}` }
  })
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={sw + 2}/>
        {arcs.map((a, i) => <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth={sw} strokeLinecap="round"/>)}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-black text-gray-900 dark:text-white tabular-nums leading-none" style={{ fontSize: 14 }}>{total}</span>
        <span className="text-gray-500" style={{ fontSize: 8 }}>{t('delivery.total', getLanguage())}</span>
      </div>
    </div>
  )
}

function HourlyBars({ data }: { data: HourlyPoint[] }) {
  if (!data.length) return <div className="flex items-center justify-center h-full text-xs text-gray-600">{t('delivery.noActivity24h', getLanguage())}</div>
  const max = Math.max(...data.map(d => d.total), 1)
  const W = 480; const H = 76
  const bw = Math.max(2, Math.floor(W / data.length) - 2)
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const x  = Math.round((i / data.length) * W)
        const th = Math.round((d.total  / max) * (H - 8))
        const sh = Math.round((d.sent   / max) * (H - 8))
        const fh = Math.round((d.failed / max) * (H - 8))
        return (
          <g key={i}>
            <rect x={x} y={H - th} width={bw} height={th} rx="1" fill="#374151" opacity="0.7"/>
            <rect x={x} y={H - sh} width={bw} height={sh} rx="1" fill="#10b981" opacity="0.9"/>
            {fh > 0 && <rect x={x} y={H - fh} width={bw} height={fh} rx="1" fill="#ef4444" opacity="0.85"/>}
          </g>
        )
      })}
    </svg>
  )
}

function MiniSparkline({ data, color = '#10b981' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1); const W = 56; const H = 18
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - (v / max) * H}`).join(' ')
  return <svg width={W} height={H} className="flex-shrink-0"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

//Sub-components

function StatCard({ label, value, sub, icon: Icon, color, accent, trend }: {
  label: string; value: string | number; sub?: string
  icon: React.ElementType; color: string; accent?: string; trend?: number[]
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-900/60 ring-1 ring-gray-100 dark:ring-white/5 p-4 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${accent || 'bg-white/5'}`}>
          <Icon className={`w-4 h-4 ${color}`}/>
        </span>
        {trend && <MiniSparkline data={trend}/>}
      </div>
      <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums leading-none">{value}</p>
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-600 dark:text-gray-300 mt-0.5">{sub}</p>}
    </div>
  )
}

function ChannelHealthCard({ stat, onFilter }: { stat: ChannelStat; onFilter: (ch: string) => void }) {
  const lang = getLanguage()
  const cfg = chCfg(stat.channel)
  const Icon = cfg.icon
  const rate = Number(stat.success_rate) || 0
  const rateColor = rate >= 95 ? '#10b981' : rate >= 80 ? '#f59e0b' : '#ef4444'
  const circ = 2 * Math.PI * 15
  const dash = (rate / 100) * circ
  return (
    <button onClick={() => onFilter(stat.channel)}
      className={`flex flex-col items-center gap-2 p-3 rounded-2xl ring-1 ${cfg.ring} ${cfg.bg} hover:ring-2 hover:scale-105 transition-all group min-w-[88px] text-center`}>
      <div className="relative w-10 h-10">
        <svg width="40" height="40" className="absolute inset-0 -rotate-90">
          <circle cx="20" cy="20" r="15" fill="none" stroke="#1f2937" strokeWidth="3"/>
          <circle cx="20" cy="20" r="15" fill="none" stroke={rateColor} strokeWidth="3" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center ${cfg.color}`}><Icon className="w-4 h-4"/></span>
      </div>
      <div>
        <p className={`text-[10px] font-bold ${cfg.color} leading-tight`}>{getChannelLabel(stat.channel, lang)}</p>
        <p className="text-sm font-black text-gray-900 dark:text-white tabular-nums">{rate}%</p>
        <p className="text-[9px] text-gray-500 dark:text-gray-300 tabular-nums">{Number(stat.total).toLocaleString()} {t('delivery.sentLower', lang)}</p>
        {Number(stat.failed) > 0 && <p className="text-[9px] text-red-400 font-bold">{stat.failed} {t('delivery.failed', lang).toLowerCase()}</p>}
      </div>
    </button>
  )
}

function AlertGroupRow({ group, onRetry, onRetryAll, retrying }: {
  group: GroupedAlert; onRetry: (id: string) => void; onRetryAll: (alertId: string) => void; retrying: Set<string>
}) {
  const lang = getLanguage()
  const [open, setOpen] = useState(false)
  const allOk = group.failed === 0 && group.pending === 0
  const hasFail = group.failed > 0
  const sev = SEV_BADGE[group.alert_severity || ''] || 'bg-gray-500/20 text-gray-400 dark:text-gray-300 ring-1 ring-gray-500/30'
  return (
    <div className={`rounded-2xl ring-1 overflow-hidden transition-all ${hasFail ? 'ring-red-500/20 bg-red-950/8' : allOk ? 'ring-emerald-500/15 bg-emerald-950/5' : 'ring-amber-500/15 bg-amber-950/5'}`}>
      <div role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/3 transition-colors cursor-pointer">
        <ChevronRight className={`w-4 h-4 text-gray-500 dark:text-gray-300 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[280px]">{group.alert_title || <span className="font-mono text-gray-400 dark:text-gray-300">ALT-{group.alert_id?.slice(0, 6).toUpperCase()}</span>}</span>
            {group.alert_severity && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${sev}`}>{group.alert_severity}</span>}
            {group.alert_type && <span className="text-[9px] text-gray-600 font-mono">{group.alert_type}</span>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-600">{new Date(group.last_attempt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
            <span className="text-[10px] text-emerald-400 font-bold">{group.sent} {t('delivery.sentLower', lang)}</span>
            {group.failed > 0  && <span className="text-[10px] text-red-400 font-bold">{group.failed} {t('delivery.failed', lang).toLowerCase()}</span>}
            {group.pending > 0 && <span className="text-[10px] text-amber-400 font-bold">{group.pending} {t('delivery.pending', lang).toLowerCase()}</span>}
            <span className="text-[10px] text-gray-600">{group.total} {t('delivery.total', lang)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {group.deliveries.map(d => {
            const cfg = chCfg(d.channel)
            const ok = d.status === 'sent' || d.status === 'delivered'
            const pending = d.status === 'pending'
            return (
              <span key={d.id} title={`${getChannelLabel(d.channel, lang)}: ${d.status}${d.error_message ? ' -- ' + d.error_message : ''}`}
                className={`w-6 h-6 rounded-lg flex items-center justify-center ring-1 transition-all ${ok ? 'bg-emerald-500/20 ring-emerald-500/40' : pending ? 'bg-amber-500/20 ring-amber-500/40' : 'bg-red-500/20 ring-red-500/40'}`}>
                <cfg.icon className={`w-3 h-3 ${ok ? 'text-emerald-400' : pending ? 'text-amber-400 animate-pulse' : 'text-red-400'}`}/>
              </span>
            )
          })}
          {hasFail && (
            <button onClick={e => { e.stopPropagation(); onRetryAll(group.alert_id) }}
              className="ml-1 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-500/20 ring-1 ring-amber-300 dark:ring-amber-500/40 text-amber-700 dark:text-amber-300 text-[10px] font-bold hover:bg-amber-200 dark:hover:bg-amber-500/30 transition-colors whitespace-nowrap">
              <RotateCcw className={`w-3 h-3 ${retrying.has('bulk-' + group.alert_id) ? 'animate-spin' : ''}`}/>
              {t('delivery.retryAll', lang)}
            </button>
          )}
        </div>
      </div>

      {open && (
          <div className="border-t border-gray-100 dark:border-white/5 px-4 py-3 space-y-2 bg-gray-50 dark:bg-black/10">
          {group.deliveries.map(d => {
            const cfg = chCfg(d.channel)
            const ok = d.status === 'sent' || d.status === 'delivered'
            const isRetrying = retrying.has(d.id)
            return (
              <div key={d.id} className="flex items-center gap-3 py-2 px-3 rounded-xl bg-gray-50 dark:bg-white/3 ring-1 ring-gray-100 dark:ring-white/5 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                <ChanIcon ch={d.channel} size="sm"/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold ${cfg.color}`}>{getChannelLabel(d.channel, lang)}</span>
                    <StatusBadge status={d.status}/>
                    {d.retry_count > 0 && <span className="text-[9px] text-gray-500 dark:text-gray-300 ring-1 ring-gray-300 dark:ring-gray-700 px-1.5 py-0.5 rounded-full">{d.retry_count}-- {t('delivery.retried', lang)}</span>}
                    {d.provider_id && <span className="text-[9px] text-gray-600 font-mono truncate max-w-[100px]">{d.provider_id}</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-300 truncate mt-0.5 font-mono">{d.recipient || '--'}</p>
                  {d.error_message && <p className="text-[10px] text-red-400 mt-0.5 truncate flex items-center gap-1"><AlertTriangle className="w-3 h-3 flex-shrink-0" />{d.error_message}</p>}
                  {d.sent_at && <p className="text-[9px] text-gray-600 mt-0.5">{new Date(d.sent_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })}</p>}
                </div>
                {!ok && d.channel !== 'web' && d.retry_count < 3 ? (
                  <button onClick={() => onRetry(d.id)} disabled={isRetrying}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 ring-1 ring-gray-200 dark:ring-white/10 text-gray-600 dark:text-gray-300 text-[10px] font-bold hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-40 transition-all">
                    <RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`}/>
                    {isRetrying ? '--' : t('delivery.retry', lang)}
                  </button>
                ) : d.retry_count >= 3 ? (
                  <span className="text-[9px] text-gray-600 ring-1 ring-gray-300 dark:ring-gray-700 px-1.5 py-0.5 rounded-full flex-shrink-0">{t('delivery.maxRetries', lang)}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


//API

const getToken = () => _getToken() || ''
async function apiFetch(path: string, opts: RequestInit = {}) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  const method = (opts.method || 'GET').toUpperCase()
  const csrfToken = !safeMethods.includes(method)
    ? document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
    : undefined
  const res = await fetch(path, {
    ...opts,
    headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(opts.headers as Record<string, string> || {}) },
  })
  if (res.status === 401) {
    //Token expired -- clear and redirect to login
    clearToken()
    window.location.href = '/admin'
    throw new Error('Session expired. Please log in again.')
  }
  if (!res.ok) { const d = await res.json().catch(() => ({})); const errMsg = typeof d.error === 'string' ? d.error : d.error?.message || d.message || `HTTP ${res.status}`; throw new Error(errMsg) }
  return res.json()
}

//Main

const CHANNEL_OPTS = ['email', 'sms', 'whatsapp', 'telegram', 'web']
const STATUS_OPTS  = ['sent', 'delivered', 'failed', 'pending']
const SEV_OPTS     = ['critical', 'warning', 'info']
type ViewMode = 'grouped' | 'flat'
const PAGE = 50

export default function DeliveryDashboard() {
  const lang = useLanguage()
  const [stats,        setStats]        = useState<Stats | null>(null)
  const [groups,       setGroups]       = useState<GroupedAlert[]>([])
  const [flatRows,     setFlatRows]     = useState<DeliveryRow[]>([])
  const [totalFlat,    setTotalFlat]    = useState(0)
  const [totalGroups,  setTotalGroups]  = useState(0)
  const [loading,      setLoading]      = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [viewMode,     setViewMode]     = useState<ViewMode>('grouped')
  const [retrying,     setRetrying]     = useState<Set<string>>(new Set())
  const [toast,        setToastMsg]     = useState<{ text: string; ok: boolean } | null>(null)
  const [errorModal,   setErrorModal]   = useState<string | null>(null)
  const [exportingCSV, setExportingCSV] = useState(false)
  const [lastRefresh,  setLastRefresh]  = useState(new Date())
  const autoRef = useRef<ReturnType<typeof setInterval>>()

  const [search,   setSearch]   = useState('')
  const [channel,  setChannel]  = useState('')
  const [status,   setStatus]   = useState('')
  const [severity, setSeverity] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [flatPage, setFlatPage] = useState(0)
  const [grpPage,  setGrpPage]  = useState(0)
  const [sortCol,  setSortCol]  = useState('created_at')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('desc')

  const showToast = (text: string, ok = true) => {
    setToastMsg({ text, ok }); setTimeout(() => setToastMsg(null), 3500)
  }

  const buildQS = useCallback((extra: Record<string, any> = {}) => {
    const p: Record<string, string> = {}
    if (channel)  p.channel  = channel
    if (status)   p.status   = status
    if (severity) p.severity = severity
    if (dateFrom) p.start    = dateFrom
    if (dateTo)   p.end      = dateTo
    if (search)   p.search   = search
    return new URLSearchParams({ ...p, ...extra }).toString()
  }, [channel, status, severity, dateFrom, dateTo, search])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try { setStats(await apiFetch('/api/alerts/delivery/stats')) } catch { /* silent */ }
    finally { setStatsLoading(false) }
  }, [])

  const loadGroups = useCallback(async (page = 0) => {
    setLoading(true)
    try {
      const d = await apiFetch(`/api/alerts/delivery/grouped?${buildQS({ limit: PAGE, offset: page * PAGE })}`)
      setGroups(d.groups || []); setTotalGroups(d.total || 0); setGrpPage(page)
    } catch (e: any) { showToast(e.message, false) }
    finally { setLoading(false) }
  }, [buildQS])

  const loadFlat = useCallback(async (page = 0) => {
    setLoading(true)
    try {
      const d = await apiFetch(`/api/alerts/delivery?${buildQS({ limit: PAGE, offset: page * PAGE })}`)
      setFlatRows(d.rows || []); setTotalFlat(d.total || 0); setFlatPage(page)
    } catch (e: any) { showToast(e.message, false) }
    finally { setLoading(false) }
  }, [buildQS])

  const refresh = useCallback(() => {
    setLastRefresh(new Date()); loadStats()
    if (viewMode === 'grouped') loadGroups(grpPage)
    else loadFlat(flatPage)
  }, [loadStats, loadGroups, loadFlat, viewMode, grpPage, flatPage])

  useEffect(() => { loadStats(); loadGroups(0) }, [])

  useEffect(() => {
    clearInterval(autoRef.current)
    autoRef.current = setInterval(refresh, 30_000)
    return () => clearInterval(autoRef.current)
  }, [refresh])

  useEffect(() => {
    if (viewMode === 'grouped') loadGroups(0); else loadFlat(0)
  }, [viewMode])

  const applyFilters = () => { loadStats(); if (viewMode === 'grouped') loadGroups(0); else loadFlat(0) }
  const clearFilters = () => { setSearch(''); setChannel(''); setStatus(''); setSeverity(''); setDateFrom(''); setDateTo('') }

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sortedFlat = useMemo(() => {
    const arr = [...flatRows]
    arr.sort((a: any, b: any) => {
      const av = a[sortCol]; const bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return sortDir === 'asc' ? -1 : 1
      if (bv == null) return sortDir === 'asc' ? 1 : -1
      const sa = String(av).toLowerCase(); const sb = String(bv).toLowerCase()
      return sortDir === 'asc' ? (sa < sb ? -1 : sa > sb ? 1 : 0) : (sa > sb ? -1 : sa < sb ? 1 : 0)
    })
    return arr
  }, [flatRows, sortCol, sortDir])

  const handleRetry = async (id: string) => {
    setRetrying(s => new Set(s).add(id))
    try {
      const r = await apiFetch(`/api/alerts/delivery/${id}/retry`, { method: 'POST' })
      showToast(r.success ? t('delivery.retrySucceeded', lang) : `${t('delivery.retryFailedPrefix', lang)}: ${r.error}`, r.success)
      refresh()
    } catch (e: any) { showToast(e.message, false) }
    finally { setRetrying(s => { const n = new Set(s); n.delete(id); return n }) }
  }

  const handleRetryAll = async (alertId: string) => {
    const key = 'bulk-' + alertId
    setRetrying(s => new Set(s).add(key))
    try {
      const r = await apiFetch('/api/alerts/delivery/retry-failed', { method: 'POST', body: JSON.stringify({ alert_id: alertId }) })
      showToast(`${t('delivery.bulkRetrySummary', lang)}: ${r.succeeded} ${t('delivery.retrySucceeded', lang).toLowerCase()}, ${r.failed} ${t('delivery.failed', lang).toLowerCase()}`, r.failed === 0)
      refresh()
    } catch (e: any) { showToast(e.message, false) }
    finally { setRetrying(s => { const n = new Set(s); n.delete(key); return n }) }
  }

  const handleExportCSV = async () => {
    setExportingCSV(true)
    try {
      const res = await fetch(`/api/alerts/delivery/export.csv?${buildQS()}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error(t('delivery.exportFailed', lang))
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `delivery_log_${Date.now()}.csv`; a.click()
      showToast(t('delivery.exportSuccess', lang))
    } catch (e: any) { showToast(e.message, false) }
    finally { setExportingCSV(false) }
  }

  const filterActive = !!(channel || status || severity || dateFrom || dateTo || search)

  //Keyboard shortcuts
  const [showKeyboard, setShowKeyboard] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); refresh() }
      else if (key === 'e') { e.preventDefault(); handleExportCSV() }
      else if (key === 'v') { e.preventDefault(); setViewMode(p => p === 'grouped' ? 'flat' : 'grouped') }
      else if (key === 'x') { e.preventDefault(); clearFilters() }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowKeyboard(p => !p) }
      else if (key === 'escape') setShowKeyboard(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [refresh])

  const s = stats?.overall
  const successRate = s ? Number(s.success_rate) || 0 : 0
  const hourlyTrend = stats?.hourly_trend?.map(h => h.total) ?? []
  const totalPages = viewMode === 'grouped' ? Math.ceil(totalGroups / PAGE) : Math.ceil(totalFlat / PAGE)
  const currentPage = viewMode === 'grouped' ? grpPage : flatPage
  const setPage = (p: number) => viewMode === 'grouped' ? loadGroups(p) : loadFlat(p)

  const donutSlices = (stats?.by_channel ?? []).map(c => ({ value: c.total, color: chCfg(c.channel).hex }))

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-6 space-y-5">

      {/* Toast*/}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl ring-1 text-sm font-semibold animate-fade-in pointer-events-none ${toast.ok ? 'bg-emerald-900/95 ring-emerald-500/40 text-emerald-100' : 'bg-red-900/95 ring-red-500/40 text-red-100'}`}>
          {toast.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
          {toast.text}
        </div>
      )}

      {/* Error modal*/}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setErrorModal(null)}>
          <div className="bg-white dark:bg-gray-900 ring-1 ring-red-500/30 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-red-600 dark:text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{t('common.error', lang)}</h3>
              <button onClick={() => setErrorModal(null)} className="text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"><X className="w-4 h-4"/></button>
            </div>
            <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-black/50 rounded-xl p-4 overflow-auto max-h-64 whitespace-pre-wrap">{errorModal}</pre>
          </div>
        </div>
      )}

      {/* Header*/}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-black tracking-tight text-gray-900 dark:text-white flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 shadow-lg shadow-violet-900/40 flex-shrink-0">
              <Activity className="w-4.5 h-4.5 text-white"/>
            </span>
            {t('delivery.title', lang)}
          </h1>
          <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 ml-12">
            {t('delivery.subtitle', lang)}
            <span className="ml-2">-- {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 ring-1 ring-gray-200 dark:ring-white/10 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-200 dark:hover:bg-white/10 transition-all disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>{t('common.refresh', lang)}
          </button>
          <button onClick={handleExportCSV} disabled={exportingCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-100 dark:bg-emerald-600/20 ring-1 ring-emerald-300 dark:ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-200 dark:hover:bg-emerald-600/30 transition-all disabled:opacity-50">
            {exportingCSV ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Download className="w-3.5 h-3.5"/>}
            {t('common.exportCSV', lang)}
          </button>
        </div>
      </div>

      {/* Stats*/}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={t('delivery.attempted', lang)} value={Number(s?.total ?? 0).toLocaleString()} icon={Layers}     color="text-violet-400" accent="bg-violet-500/15" trend={hourlyTrend}/>
        <StatCard label={t('delivery.successRate', lang)} value={s ? successRate + '%' : '--'} sub={s ? `${s.sent} ${t('delivery.delivered', lang).toLowerCase()}` : undefined} icon={TrendingUp} color={successRate >= 95 ? 'text-emerald-400' : successRate >= 80 ? 'text-amber-400' : 'text-red-400'} accent={successRate >= 95 ? 'bg-emerald-500/15' : successRate >= 80 ? 'bg-amber-500/15' : 'bg-red-500/15'}/>
        <StatCard label={t('common.sent', lang)} value={Number(s?.sent    ?? 0).toLocaleString()} icon={CheckCircle} color="text-emerald-400" accent="bg-emerald-500/15"/>
        <StatCard label={t('delivery.failed', lang)} value={Number(s?.failed  ?? 0).toLocaleString()} icon={XCircle}     color={s?.failed ? 'text-red-400' : 'text-gray-600'} accent={s?.failed ? 'bg-red-500/15' : 'bg-gray-500/10'}/>
        <StatCard label={t('delivery.pending', lang)} value={Number(s?.pending ?? 0).toLocaleString()} icon={Clock}       color="text-amber-400" accent="bg-amber-500/15"/>
        <StatCard label="Subscribers" value={Number(stats?.subscribers?.verified_subscribers ?? 0).toLocaleString()} sub={stats?.subscribers ? `${stats.subscribers.total_subscribers} total` : undefined} icon={Users} color="text-cyan-400" accent="bg-cyan-500/15"/>
      </div>

      {/* Charts*/}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Donut */}
        <div className="bg-white dark:bg-gray-900/60 ring-1 ring-gray-100 dark:ring-white/5 rounded-2xl p-4 shadow-lg">
          <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5"/>{t('delivery.channelResults', lang)}
          </h3>
          <div className="flex items-center gap-4">
            <DonutChart slices={donutSlices} size={108}/>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              {(stats?.by_channel ?? []).map(c => {
                const cfg = chCfg(c.channel)
                const rate = Number(c.success_rate) || 0
                return (
                  <div key={c.channel} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.hex }}/>
                    <span className="text-[11px] text-gray-500 dark:text-gray-300 flex-1 truncate">{getChannelLabel(c.channel, lang)}</span>
                    <span className="text-[11px] font-bold text-gray-900 dark:text-white tabular-nums">{Number(c.total).toLocaleString()}</span>
                    <span className={`text-[10px] font-bold tabular-nums ${rate >= 95 ? 'text-emerald-400' : rate >= 80 ? 'text-amber-400' : 'text-red-400'}`}>{rate}%</span>
                  </div>
                )
              })}
              {!stats?.by_channel?.length && <p className="text-xs text-gray-700">{t('delivery.noData', lang)}</p>}
            </div>
          </div>
        </div>

        {/* Hourly bars */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900/60 ring-1 ring-gray-100 dark:ring-white/5 rounded-2xl p-4 shadow-lg flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5"/>{t('allReports.activityTimeline', lang)}
              {statsLoading && <Loader2 className="w-3 h-3 animate-spin text-violet-400"/>}
            </h3>
            <div className="flex items-center gap-3 text-[10px] text-gray-600 dark:text-gray-300">
              <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-sm bg-emerald-500 inline-block"/>{t('common.sent', lang)}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-sm bg-red-500 inline-block"/>{t('delivery.failed', lang)}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-sm bg-gray-700 inline-block"/>{t('common.total', lang)}</span>
            </div>
          </div>
          <div className="flex-1 min-h-[76px]">
            <HourlyBars data={stats?.hourly_trend ?? []}/>
          </div>
          <div className="flex justify-between text-[9px] text-gray-700 px-0.5">
            {['00','03','06','09','12','15','18','21','23'].map(h => <span key={h}>{h}:00</span>)}
          </div>
        </div>
      </div>

      {/* Channel Health*/}
      {(stats?.by_channel?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5"/>{t('delivery.channelPerformance', lang)}
          </h3>
          <div className="flex gap-2.5 flex-wrap">
            {stats!.by_channel.map(c => (
              <ChannelHealthCard key={c.channel} stat={c} onFilter={ch => { setChannel(ch); setTimeout(applyFilters, 0) }}/>
            ))}
          </div>
        </div>
      )}

      {/* Top Failures*/}
      {(stats?.top_failing?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-900/60 ring-1 ring-red-500/15 rounded-2xl p-4 shadow-lg">
          <h3 className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5"/>{t('delivery.failed', lang)}
          </h3>
          <div className="flex flex-col gap-1.5">
            {stats!.top_failing.map(f => (
              <div key={f.alert_id} className="flex items-center gap-3 py-2 px-3 rounded-xl bg-red-950/20 ring-1 ring-red-500/10">
                <XCircle className="w-4 h-4 text-red-400 flex-shrink-0"/>
                <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{f.alert_title || <span className="font-mono">ALT-{f.alert_id?.slice(0, 6).toUpperCase()}</span>}</span>
                {f.severity && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${SEV_BADGE[f.severity] || ''}`}>{f.severity}</span>}
                <span className="text-xs font-black text-red-400 tabular-nums flex-shrink-0">{f.fail_count}--</span>
                <button onClick={() => handleRetryAll(f.alert_id)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-100 dark:bg-red-500/15 ring-1 ring-red-300 dark:ring-red-500/25 text-red-700 dark:text-red-300 text-[10px] font-bold hover:bg-red-200 dark:hover:bg-red-500/25 transition-colors">
                  <RotateCcw className={`w-3 h-3 ${retrying.has('bulk-' + f.alert_id) ? 'animate-spin' : ''}`}/>{t('delivery.retry', lang)}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters*/}
      <div className="bg-white dark:bg-gray-900/60 ring-1 ring-gray-100 dark:ring-white/5 rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5"><Filter className="w-3.5 h-3.5"/>{t('common.filter', lang)}</h3>
          {filterActive && (
            <button onClick={clearFilters} className="text-[10px] text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors">
              <X className="w-3 h-3"/>{t('common.clear', lang)}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none"/>
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && applyFilters()}
              placeholder={t('delivery.searchPlaceholder', lang)}
              className="pl-8 pr-3 py-2 text-xs bg-gray-100 dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-white/8 rounded-xl text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-700 focus:ring-violet-500/50 focus:outline-none w-52 transition-all"/>
          </div>
          {[
            { label: t('delivery.allChannels', lang), value: channel, set: setChannel, opts: CHANNEL_OPTS.map(c => ({ v: c, l: getChannelLabel(c, lang) })) },
            { label: t('delivery.allStatuses', lang), value: status,  set: setStatus,  opts: STATUS_OPTS.map(s => ({ v: s, l: t(s === 'sent' ? 'common.sent' : `delivery.${s}`, lang) })) },
            { label: t('delivery.allSeverities', lang), value: severity, set: setSeverity, opts: SEV_OPTS.map(s => ({ v: s, l: s })) },
          ].map(({ label, value, set, opts }) => (
            <select key={label} value={value} onChange={e => set(e.target.value)}
              className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-white/8 rounded-xl text-gray-800 dark:text-gray-200 focus:ring-violet-500/50 focus:outline-none">
              <option value="">{label}</option>
              {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          ))}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-gray-600 flex-shrink-0"/>
            <input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2.5 py-2 text-xs bg-gray-100 dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-white/8 rounded-xl text-gray-800 dark:text-gray-200 focus:ring-violet-500/50 focus:outline-none"/>
            <span className="text-gray-400 dark:text-gray-300 text-xs">\u2192</span>
            <input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2.5 py-2 text-xs bg-gray-100 dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-white/8 rounded-xl text-gray-800 dark:text-gray-200 focus:ring-violet-500/50 focus:outline-none"/>
          </div>
          <button onClick={applyFilters}
            className="px-4 py-2 rounded-xl bg-violet-100 dark:bg-violet-600/30 ring-1 ring-violet-300 dark:ring-violet-500/40 text-violet-700 dark:text-violet-200 text-xs font-bold hover:bg-violet-200 dark:hover:bg-violet-600/50 transition-all">
            {t('common.apply', lang)}
          </button>
        </div>
      </div>

      {/* View Toggle + Data*/}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900/60 ring-1 ring-gray-200 dark:ring-white/5 rounded-xl p-1">
            {([['grouped', t('delivery.grouped', lang), Layers], ['flat', t('delivery.flat', lang), List]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setViewMode(v as ViewMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${viewMode === v ? 'bg-violet-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}`}>
                <Icon className="w-3.5 h-3.5"/>{label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400"/>}
            <span className="tabular-nums">
              {viewMode === 'grouped'
                ? `${totalGroups.toLocaleString()} ${t(totalGroups === 1 ? 'delivery.alertSingular' : 'delivery.alertPlural', lang)}`
                : `${totalFlat.toLocaleString()} ${t(totalFlat === 1 ? 'delivery.recordSingular' : 'delivery.recordPlural', lang)}`}
            </span>
          </div>
        </div>

        {loading && !flatRows.length && !groups.length ? (
          <div className="flex items-center justify-center py-24 text-gray-600 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400"/>
            <span className="text-sm">{t('common.loading', lang)} {t('delivery.recentDeliveries', lang).toLowerCase()}</span>
          </div>
        ) : viewMode === 'grouped' ? (
          <div className="space-y-2">
            {groups.map(g => (
              <AlertGroupRow key={g.alert_id} group={g} onRetry={handleRetry} onRetryAll={handleRetryAll} retrying={retrying}/>
            ))}
            {!groups.length && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-600 gap-2">
                <Layers className="w-8 h-8 opacity-20"/>
                <p className="text-sm">{t('delivery.noDeliveries', lang)}</p>
              </div>
            )}
          </div>
        ) : (
          <DataTable<DeliveryRow>
            columns={[
              { key: 'created_at', header: t('delivery.time', lang), sortable: true, render: r => <span className="text-[11px] text-gray-500 dark:text-gray-300 whitespace-nowrap font-mono">{r.created_at ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }) : '--'}</span> },
              { key: 'alert_title', header: t('delivery.alert', lang), sortable: true, render: r => <div className="flex items-center gap-1.5 max-w-[180px]">{r.alert_severity && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.alert_severity === 'critical' ? 'bg-red-400' : r.alert_severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`}/>}<span className="text-xs text-gray-600 dark:text-gray-200 truncate">{r.alert_title || <span className="font-mono text-gray-400 dark:text-gray-300">ALT-{r.alert_id?.slice(0, 6).toUpperCase()}</span>}</span></div> },
              { key: 'channel', header: t('delivery.channel', lang), sortable: true, render: r => { const cfg = chCfg(r.channel); return <div className="flex items-center gap-1.5"><ChanIcon ch={r.channel} size="xs"/><span className={`text-[11px] font-semibold ${cfg.color}`}>{getChannelLabel(r.channel, lang)}</span></div> } },
              { key: 'recipient', header: t('delivery.recipient', lang), sortable: true, render: r => <span className="text-[11px] text-gray-500 dark:text-gray-300 font-mono truncate block max-w-[180px]">{r.recipient || '--'}</span> },
              { key: 'status', header: t('common.status', lang), sortable: true, render: r => <StatusBadge status={r.status}/> },
              { key: 'retry_count', header: t('delivery.retries', lang), sortable: true, align: 'center', render: r => r.retry_count > 0 ? <span className="text-[10px] text-amber-400 font-bold">{r.retry_count}</span> : <span className="text-[10px] text-gray-700">--</span> },
              { key: 'error', header: t('delivery.error', lang), render: r => r.error_message ? <span className="text-[10px] text-red-400 truncate block cursor-help max-w-[160px]" title={r.error_message}>{r.error_message}</span> : null },
              { key: 'actions', header: '', render: r => { const ok = r.status === 'sent' || r.status === 'delivered'; const isRetrying = retrying.has(r.id); return !ok && r.channel !== 'web' && r.retry_count < 3 ? <button onClick={() => handleRetry(r.id)} disabled={isRetrying} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/5 ring-1 ring-gray-200 dark:ring-white/8 text-gray-500 dark:text-gray-300 text-[10px] hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-40 transition-all whitespace-nowrap"><RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`}/>{isRetrying ? '--' : t('delivery.retry', lang)}</button> : null } },
            ] as DataTableColumn<DeliveryRow>[]}
            rows={sortedFlat}
            rowKey={r => r.id}
            sortField={sortCol}
            sortDir={sortDir}
            onSort={col => handleSort(col)}
            rowClassName={r => { const ok = r.status === 'sent' || r.status === 'delivered'; return !ok && r.status !== 'pending' ? 'bg-red-50 dark:bg-red-950/5' : '' }}
            emptyMessage={t('delivery.noRecordsMatchFilters', lang)}
            className="rounded-2xl ring-1 ring-gray-200 dark:ring-white/5 max-h-[60vh] overflow-auto"
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 ring-1 ring-gray-200 dark:ring-white/8 text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-white/10 transition-all">
              {t('common.previous', lang)}
            </button>
            <span className="text-xs text-gray-600 tabular-nums">{currentPage + 1} / {totalPages}</span>
            <button disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 ring-1 ring-gray-200 dark:ring-white/8 text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-white/10 transition-all">
              {t('common.next', lang)}
            </button>
          </div>
        )}
      </div>

      {/* Error Patterns*/}
      {(stats?.recent_errors?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-900/60 ring-1 ring-gray-100 dark:ring-white/5 rounded-2xl p-4 shadow-lg">
          <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5"/>{t('delivery.errorPatternsLast7Days', lang)}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stats!.recent_errors.map((e, i) => {
              const cfg = chCfg(e.channel)
              return (
                <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/15 ring-1 ring-red-200 dark:ring-red-500/10">
                  <ChanIcon ch={e.channel} size="xs"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-400 dark:text-gray-300 truncate">{e.error_message}</p>
                    <p className={`text-[9px] font-bold mt-0.5 ${cfg.color}`}>{getChannelLabel(e.channel, lang)} -- {e.count}--</p>
                  </div>
                  <button onClick={() => setErrorModal(`Channel: ${getChannelLabel(e.channel, lang)}\n\nError:\n${e.error_message}\n\nOccurrences: ${e.count}`)}
                    className="text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 transition-colors flex-shrink-0">
                    <Eye className="w-3.5 h-3.5"/>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showKeyboard && (
        <div className="mt-3 bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="font-bold text-gray-400 uppercase tracking-wider mr-1">{t('delivery.shortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">R</kbd> {t('common.refresh', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">E</kbd> {t('delivery.exportCSV', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">V</kbd> {t('delivery.toggleView', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">X</kbd> {t('delivery.clearFilters', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">?</kbd> {t('delivery.toggleShortcuts', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-white">{t('common.esc', lang)}</kbd> {t('common.close', lang)}</span>
        </div>
      )}
    </div>
  )
}
