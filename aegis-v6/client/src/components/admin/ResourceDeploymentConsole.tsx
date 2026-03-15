/* ResourceDeploymentConsole.tsx — Clean, polished resource deployment console. */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Navigation, RefreshCw, Layers, Package, AlertTriangle, FileText, Map, Clock,
  Truck, Flame, Anchor, Brain, Eye, ChevronDown, ChevronRight, Search,
  Activity, Shield, ArrowUpDown, ArrowUp, ArrowDown, Users, CheckCircle,
  Radio, Target, Crosshair, LayoutGrid, List
} from 'lucide-react'
import DisasterMap from '../shared/DisasterMap'
import { apiGetDeployments, apiDeployResources, apiRecallResources, apiAuditLog } from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props {
  deployments: any[]
  setDeployments: React.Dispatch<React.SetStateAction<any[]>>
  reports: any[]
  auditLog: any[]
  setAuditLog: React.Dispatch<React.SetStateAction<any[]>>
  deployReason: string
  setDeployReason: (v: string) => void
  deployReasonRef: React.MutableRefObject<string>
  loc: any
  activeLocation: string
  user: any
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
  askConfirm: (title: string, message: string, type: string, action: () => void) => void
}

function getPipeline(lang: string) {
  return [
    { key: 'requested', label: t('resource.request', lang), icon: Radio },
    { key: 'staging', label: t('resource.staging', lang), icon: Package },
    { key: 'transit', label: t('resource.transit', lang), icon: Truck },
    { key: 'on_site', label: t('resource.onSite', lang), icon: Target },
    { key: 'demob', label: t('resource.deMob', lang), icon: ArrowDown },
  ] as const
}

const P_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }
const P_DOT: Record<string, string> = { Critical: 'bg-red-500', High: 'bg-amber-500', Medium: 'bg-blue-500', Low: 'bg-slate-400' }
const P_PILL: Record<string, string> = {
  Critical: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20',
  High: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
  Medium: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20',
  Low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/20',
}

/** Extract leading number from strings like "23 people needing help" */
function parseAffected(val: any): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const m = val.match(/(\d+)/)
    return m ? parseInt(m[1], 10) : 0
  }
  return 0
}

function formatRelativeTime(mins: number, lang: string): string {
  if (mins < 1) return t('common.justNow', lang)
  if (mins < 60) return `${mins}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  if (mins < 1440) return `${Math.floor(mins / 60)}${t('common.hoursShort', lang)} ${mins % 60}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  return `${Math.floor(mins / 1440)}${t('common.daysShort', lang)} ${t('common.ago', lang)}`
}

export default function ResourceDeploymentConsole({
  deployments, setDeployments, reports, auditLog, setAuditLog,
  deployReason, setDeployReason, deployReasonRef,
  loc, activeLocation, user, pushNotification, askConfirm
}: Props) {
  const lang = useLanguage()
  const pipeline = useMemo(() => getPipeline(lang), [lang])

  const [time, setTime] = useState({ zulu: '', local: '' })
  const [showMap, setShowMap] = useState(true)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [zoneSearch, setZoneSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField, setSortField] = useState('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedZone, setExpandedZone] = useState<string | null>(null)
  const [zoneView, setZoneView] = useState<'table' | 'grid'>('table')
  const [countdown, setCountdown] = useState(30)
  const cdRef = useRef(30)
  const searchRef = useRef<HTMLInputElement>(null)

  /* clock */
  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setTime({ zulu: n.toISOString().slice(11, 19) + 'Z', local: n.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  /* auto-refresh */
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current <= 0) { apiGetDeployments().then(setDeployments).catch(() => {}); cdRef.current = 30 }
      setCountdown(cdRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [setDeployments])

  const doRefresh = useCallback(() => {
    apiGetDeployments().then(setDeployments).catch(() => {})
    cdRef.current = 30; setCountdown(30)
    pushNotification(t('resource.dataRefreshed', lang), 'info')
  }, [lang, setDeployments, pushNotification])

  /* keyboard */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '?') { e.preventDefault(); setShowShortcuts(p => !p) }
      if (e.key === 'r' && !e.ctrlKey) { e.preventDefault(); doRefresh() }
      if (e.key === 'm') { e.preventDefault(); setShowMap(p => !p) }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [doRefresh])

  /* computed */
  const totalZones = deployments.length
  const activeCount = deployments.filter((d: any) => d.deployed).length
  const criticalCount = deployments.filter((d: any) => (d.priority || '').toLowerCase() === 'critical').length
  const totalReports = deployments.reduce((s: number, d: any) => s + (Number(d.active_reports) || 0), 0)
  const totalAffected = deployments.reduce((s: number, d: any) => s + parseAffected(d.estimated_affected), 0)
  const totalAssets = deployments.reduce((s: number, d: any) => s + (Number(d.ambulances) || 0) + (Number(d.fire_engines) || 0) + (Number(d.rescue_boats) || 0), 0)
  const deployedAssets = deployments.filter((d: any) => d.deployed).reduce((s: number, d: any) => s + (Number(d.ambulances) || 0) + (Number(d.fire_engines) || 0) + (Number(d.rescue_boats) || 0), 0)
  const utilizationPct = totalAssets > 0 ? Math.round((deployedAssets / totalAssets) * 100) : 0

  const readiness = criticalCount > 2 ? 'critical' : criticalCount > 0 ? 'elevated' : activeCount > 0 ? 'active' : 'standby'
  const readinessClass = readiness === 'critical' ? 'text-red-500 bg-red-500/10 ring-red-500/30 animate-pulse' : readiness === 'elevated' ? 'text-amber-500 bg-amber-500/10 ring-amber-500/30' : readiness === 'active' ? 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/30' : 'text-slate-400 bg-slate-500/10 ring-slate-500/30'
  const readinessLabel = readiness === 'critical'
    ? t('resource.readinessCritical', lang)
    : readiness === 'elevated'
      ? t('resource.readinessElevated', lang)
      : readiness === 'active'
        ? t('resource.readinessActive', lang)
        : t('resource.readinessStandby', lang)

  const assetRows = useMemo(() => {
    const deployed = deployments.filter((d: any) => d.deployed)
    return [
      { label: t('resource.ambulances', lang), icon: Truck, color: 'text-red-500', bg: 'bg-red-500', total: deployments.reduce((s: number, d: any) => s + (Number(d.ambulances) || 0), 0), active: deployed.reduce((s: number, d: any) => s + (Number(d.ambulances) || 0), 0) },
      { label: t('resource.fireEngines', lang), icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500', total: deployments.reduce((s: number, d: any) => s + (Number(d.fire_engines) || 0), 0), active: deployed.reduce((s: number, d: any) => s + (Number(d.fire_engines) || 0), 0) },
      { label: t('resource.rescueBoats', lang), icon: Anchor, color: 'text-blue-500', bg: 'bg-blue-500', total: deployments.reduce((s: number, d: any) => s + (Number(d.rescue_boats) || 0), 0), active: deployed.reduce((s: number, d: any) => s + (Number(d.rescue_boats) || 0), 0) },
    ]
  }, [deployments, lang])

  const pipelineCounts = useMemo(() => {
    const nd = deployments.filter((d: any) => !d.deployed)
    return {
      requested: nd.filter((d: any) => (d.priority || '').toLowerCase() === 'critical' || (d.priority || '').toLowerCase() === 'high').length,
      staging: nd.filter((d: any) => (d.priority || '').toLowerCase() === 'medium' || (d.priority || '').toLowerCase() === 'low').length,
      transit: 0,
      on_site: deployments.filter((d: any) => d.deployed).length,
      demob: 0,
    }
  }, [deployments])

  const deployEvents = useMemo(() =>
    auditLog.filter(a => a.action_type === 'deploy' || a.action_type === 'recall').slice(0, 10),
    [auditLog])

  /* filtered + sorted zones */
  const zones = useMemo(() => {
    let items = [...deployments]
    if (zoneSearch.trim()) { const q = zoneSearch.toLowerCase(); items = items.filter((d: any) => (d.zone || '').toLowerCase().includes(q) || (d.ai_recommendation || '').toLowerCase().includes(q)) }
    if (priorityFilter !== 'all') items = items.filter((d: any) => (d.priority || '').toLowerCase() === priorityFilter.toLowerCase())
    if (statusFilter === 'deployed') items = items.filter((d: any) => d.deployed)
    if (statusFilter === 'standby') items = items.filter((d: any) => !d.deployed)
    items.sort((a: any, b: any) => {
      let c = 0
      if (sortField === 'priority') c = (P_ORDER[(b.priority || '')] || 0) - (P_ORDER[(a.priority || '')] || 0)
      else if (sortField === 'zone') c = (a.zone || '').localeCompare(b.zone || '')
      else if (sortField === 'reports') c = (Number(b.active_reports) || 0) - (Number(a.active_reports) || 0)
      else if (sortField === 'affected') c = parseAffected(b.estimated_affected) - parseAffected(a.estimated_affected)
      else if (sortField === 'status') c = (b.deployed ? 1 : 0) - (a.deployed ? 1 : 0)
      return sortDir === 'asc' ? -c : c
    })
    return items
  }, [deployments, zoneSearch, priorityFilter, statusFilter, sortField, sortDir])

  const handleDeploy = useCallback((zone: any) => {
    setDeployReason('')
    askConfirm(t('resource.deployResources', lang), `${t('resource.deployConfirmPrefix', lang)} ${zone.zone}? ${t('resource.deployConfirmSuffix', lang)}`, 'success', async () => {
      const reason = deployReasonRef.current
      if (!reason.trim()) { pushNotification(t('resource.reasonRequired', lang), 'error'); return }
      apiDeployResources(zone.id, user?.id).then(() => { setDeployments(d => d.map(x => x.id === zone.id ? { ...x, deployed: true } : x)); pushNotification(t('resource.deploySuccess', lang), 'success') }).catch(() => pushNotification(t('resource.deployFailed', lang), 'error'))
      apiAuditLog({ operator_id: user?.id, operator_name: user?.displayName, action: `${t('resource.deployedToPrefix', lang)} ${zone.zone}`, action_type: 'deploy', target_type: 'deployment', target_id: zone.id, reason, before_state: { deployed: false }, after_state: { deployed: true } }).catch(() => {})
      setAuditLog(prev => [{ id: Date.now(), operator_name: user?.displayName, action: `${t('resource.deployedToPrefix', lang)} ${zone.zone}`, action_type: 'deploy', target_id: zone.id, created_at: new Date().toISOString() }, ...prev])
    })
  }, [askConfirm, deployReasonRef, lang, pushNotification, setAuditLog, setDeployReason, setDeployments, user])

  const handleRecall = useCallback((zone: any) => {
    setDeployReason('')
    askConfirm(t('resource.recallResources', lang), `${t('resource.recallConfirmPrefix', lang)} ${zone.zone}? ${t('resource.recallConfirmSuffix', lang)}`, 'warning', async () => {
      const reason = deployReasonRef.current
      if (!reason.trim()) { pushNotification(t('resource.recallReasonRequired', lang), 'error'); return }
      apiRecallResources(zone.id).then(() => { setDeployments(d => d.map(x => x.id === zone.id ? { ...x, deployed: false } : x)); pushNotification(t('resource.recallSuccess', lang), 'warning') }).catch(() => pushNotification(t('resource.recallFailed', lang), 'error'))
      apiAuditLog({ operator_id: user?.id, operator_name: user?.displayName, action: `${t('resource.recalledFromPrefix', lang)} ${zone.zone}`, action_type: 'recall', target_type: 'deployment', target_id: zone.id, reason, before_state: { deployed: true }, after_state: { deployed: false } }).catch(() => {})
      setAuditLog(prev => [{ id: Date.now(), operator_name: user?.displayName, action: `${t('resource.recalledFromPrefix', lang)} ${zone.zone}`, action_type: 'recall', target_id: zone.id, created_at: new Date().toISOString() }, ...prev])
    })
  }, [askConfirm, deployReasonRef, lang, pushNotification, setAuditLog, setDeployReason, setDeployments, user])

  const toggleSort = (f: string) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('desc') } }
  const SortBtn = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors">
      {children}
      {sortField === field ? (sortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  )

  return (
    <div className="space-y-5 animate-fade-in">

      {/* HEADER */}
      <div className="rounded-2xl overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-lg">
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 text-[11px]">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded-md font-extrabold ring-1 ${readinessClass}`}>{readinessLabel}</span>
            <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{loc.name || t('historical.allRegions', lang)}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
            <span className="font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 tabular-nums">{time.zulu}</span>
            <span className="text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600">|</span>
            <span className="tabular-nums">{t('common.local', lang)} {time.local}</span>
            <span className="text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600">|</span>
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{t('common.sync', lang)} {countdown}s</span>
          </div>
        </div>

        {/* Title + actions */}
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Navigation className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-white tracking-tight">{t('resource.deployment', lang)}</h2>
              <div className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-2 flex-wrap">
                <span>{t('resource.subtitle', lang)}</span>
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span>{t('resource.assetLogistics', lang)}</span>
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span>{t('resource.zoneManagement', lang)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowShortcuts(p => !p)} className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 text-xs font-mono transition-colors" title={t('resource.keyboardShortcuts', lang)}>?</button>
            <button onClick={doRefresh} className="h-8 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> {t('common.refresh', lang)}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-5 pb-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: t('resource.zones', lang), value: String(totalZones), accent: 'text-gray-900 dark:text-white' },
              { label: t('common.active', lang), value: String(activeCount), accent: 'text-emerald-600 dark:text-emerald-400' },
              { label: t('common.critical', lang), value: String(criticalCount), accent: criticalCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300' },
              { label: t('common.reports', lang), value: String(totalReports), accent: 'text-amber-600 dark:text-amber-400' },
              { label: t('resource.affected', lang), value: totalAffected.toLocaleString(), accent: 'text-rose-600 dark:text-rose-400' },
              { label: t('resource.utilization', lang), value: `${utilizationPct}%`, accent: utilizationPct > 70 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400' },
            ].map((s, i) => (
              <div key={i} className="text-center py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/50">
                <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-semibold uppercase tracking-wider mb-0.5">{s.label}</p>
                <p className={`text-xl font-extrabold tabular-nums ${s.accent}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Shortcuts */}
      {showShortcuts && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[['R', t('common.refresh', lang)], ['M', t('common.toggleMap', lang)], ['/', t('common.search', lang)], ['?', t('common.shortcuts', lang)]].map(([k, d]) => (
            <div key={k} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] font-mono text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{k}</kbd>
              {d}
            </div>
          ))}
        </div>
      )}

      {/* ASSET READINESS */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-500" /> {t('resource.assetReadiness', lang)}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${readinessClass}`}>{readiness}</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {assetRows.map((a, i) => {
              const Icon = a.icon
              const avail = a.total - a.active
              const pct = a.total > 0 ? Math.round((a.active / a.total) * 100) : 0
              return (
                <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
                      <Icon className={`w-4 h-4 ${a.color}`} />
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{a.label}</span>
                  </div>
                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium uppercase">{t('common.total', lang)}</p>
                      <p className="text-2xl font-extrabold text-gray-900 dark:text-white tabular-nums">{a.total}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-emerald-500 font-medium uppercase">{t('common.active', lang)}</p>
                      <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">{a.active}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-blue-500 font-medium uppercase">{t('resource.available', lang)}</p>
                      <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">{avail}</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${a.bg} rounded-full transition-all duration-700`} style={{ width: `${pct}%`, opacity: pct > 0 ? 1 : 0 }} />
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1.5 text-right tabular-nums">{pct}% {t('resource.deployed', lang).toLowerCase()}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* LOGISTICS PIPELINE */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-500" /> {t('resource.logisticsPipeline', lang)}</h3>
          <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20">{Object.values(pipelineCounts).reduce((a, b) => a + b, 0)} {t('common.total', lang).toLowerCase()}</span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-0">
            {pipeline.map((stage, i) => {
              const Icon = stage.icon
              const count = pipelineCounts[stage.key as keyof typeof pipelineCounts]
              const active = count > 0
              return (
                <React.Fragment key={stage.key}>
                  {i > 0 && (
                    <div className="flex-shrink-0 flex items-center w-8 justify-center">
                      <svg width="24" height="12" viewBox="0 0 24 12" className="text-gray-200 dark:text-gray-700"><path d="M0 6h18m0 0l-4-4m4 4l-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                    </div>
                  )}
                  <div className={`flex-1 rounded-xl p-4 text-center border transition-all ${active ? 'bg-emerald-50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-800' : 'bg-gray-50 dark:bg-gray-800/30 border-gray-100 dark:border-gray-800'}`}>
                    <div className={`w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center ${active ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-gray-100 dark:bg-gray-800'}`}>
                      <Icon className={`w-4 h-4 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`} />
                    </div>
                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${active ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>{stage.label}</p>
                    <p className={`text-2xl font-extrabold tabular-nums ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600'}`}>{count}</p>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      </div>

      {/* MAP */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <button onClick={() => setShowMap(p => !p)} className="w-full px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Map className="w-4 h-4 text-teal-500" /> {t('resource.deploymentZonesMap', lang)}</h3>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {[
                { key: 'Critical', label: t('common.critical', lang) },
                { key: 'High', label: t('common.high', lang) },
                { key: 'Medium', label: t('common.medium', lang) },
                { key: 'Low', label: t('common.low', lang) },
              ].map(p => (
                <span key={p.key} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${P_DOT[p.key]}`} />{p.label}</span>
              ))}
            </div>
            {showMap ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" /> : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />}
          </div>
        </button>
        {showMap && (
          <div className="h-[50vh] min-h-[320px] max-h-[560px]">
            <DisasterMap reports={reports.filter(r => r.status === 'Urgent' || r.status === 'Verified')} deployments={deployments} center={loc.center} zoom={loc.zoom} showDistress showPredictions showRiskLayer showFloodMonitoring />
          </div>
        )}
      </div>

      {/* DEPLOYMENT ZONES */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Layers className="w-4 h-4 text-violet-500" /> {t('resource.deploymentZones', lang)}</h3>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{zones.length} {t('resource.zone', lang).toLowerCase()}{zones.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button onClick={() => setZoneView('table')} className={`p-1.5 transition-colors ${zoneView === 'table' ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`} title={t('resource.tableView', lang)}><List className="w-3.5 h-3.5" /></button>
              <button onClick={() => setZoneView('grid')} className={`p-1.5 transition-colors ${zoneView === 'grid' ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`} title={t('resource.gridView', lang)}><LayoutGrid className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-gray-50/50 dark:bg-gray-800/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
            <input ref={searchRef} type="text" placeholder={t('resource.searchZones', lang)} value={zoneSearch} onChange={e => setZoneSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
          </div>
          <div className="flex items-center gap-2">
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="px-2.5 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('resource.allPriorities', lang)}</option>
              <option value="Critical">{t('common.critical', lang)}</option>
              <option value="High">{t('common.high', lang)}</option>
              <option value="Medium">{t('common.medium', lang)}</option>
              <option value="Low">{t('common.low', lang)}</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-2.5 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('resource.allStatus', lang)}</option>
              <option value="deployed">{t('resource.deployed', lang)}</option>
              <option value="standby">{t('resource.standby', lang)}</option>
            </select>
          </div>
        </div>

        {/* Zones table */}
        {zoneView === 'table' && <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800">
                <th className="px-5 py-3 text-left"><SortBtn field="zone">{t('resource.zone', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-left"><SortBtn field="priority">{t('common.priority', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-left"><SortBtn field="status">{t('common.status', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-right"><SortBtn field="reports">{t('common.reports', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-right"><SortBtn field="affected">{t('resource.affected', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-left">{t('resource.assets', lang)}</th>
                <th className="px-3 py-3 text-left">{t('resource.aiRecommendation', lang)}</th>
                <th className="px-5 py-3 text-right">{t('common.actions', lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
              {zones.map((zone: any, i: number) => {
                const isExpanded = expandedZone === (zone.id || String(i))
                const affected = parseAffected(zone.estimated_affected)
                const priority = (zone.priority || 'Low').charAt(0).toUpperCase() + (zone.priority || 'low').slice(1).toLowerCase()
                return (
                  <React.Fragment key={zone.id || i}>
                    <tr className={`group text-xs hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors ${zone.deployed ? 'bg-emerald-50/30 dark:bg-emerald-900/5' : ''}`}>
                      <td className="px-5 py-3.5">
                        <button onClick={() => setExpandedZone(isExpanded ? null : (zone.id || String(i)))} className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors whitespace-nowrap min-w-[140px]">
                          {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />}
                          <span className="truncate">{zone.zone}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${P_PILL[priority] || P_PILL.Low}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${P_DOT[priority] || P_DOT.Low}`} />
                          {priority}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        {zone.deployed ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t('common.active', lang)}
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('resource.standby', lang)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right font-bold tabular-nums text-gray-900 dark:text-white">{zone.active_reports}</td>
                      <td className="px-3 py-3.5 text-right font-bold tabular-nums text-rose-600 dark:text-rose-400">{affected > 0 ? affected.toLocaleString() : '—'}</td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          {Number(zone.ambulances) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Truck className="w-3 h-3 text-red-500" />{zone.ambulances}</span>}
                          {Number(zone.fire_engines) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Flame className="w-3 h-3 text-orange-500" />{zone.fire_engines}</span>}
                          {Number(zone.rescue_boats) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Anchor className="w-3 h-3 text-blue-500" />{zone.rescue_boats}</span>}
                          {!Number(zone.ambulances) && !Number(zone.fire_engines) && !Number(zone.rescue_boats) && <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 max-w-[260px]">
                        <p className="text-[11px] text-blue-600 dark:text-blue-400 truncate" title={zone.ai_recommendation}>
                          <Brain className="w-3 h-3 inline mr-1 opacity-50" />{zone.ai_recommendation || '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {zone.deployed ? (
                          <button onClick={() => handleRecall(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 ring-1 ring-amber-500/20 transition-colors">{t('resource.recall', lang)}</button>
                        ) : (
                          <button onClick={() => handleDeploy(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 ring-1 ring-emerald-500/20 transition-colors">{t('resource.deploy', lang)}</button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-5 py-4 bg-gray-50/50 dark:bg-gray-800/20">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-3">
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.zoneId', lang)}</span><p className="font-mono font-bold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{zone.id || '—'}</p></div>
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.priorityScore', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{P_ORDER[priority] || 0}/4</p></div>
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.estimatedAffected', lang)}</span><p className="font-bold text-rose-600 dark:text-rose-400 mt-0.5">{zone.estimated_affected || '—'}</p></div>
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.deploymentStatus', lang)}</span><p className={`font-bold mt-0.5 ${zone.deployed ? 'text-emerald-600' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>{zone.deployed ? t('resource.resourcesDeployed', lang) : t('resource.awaitingDeployment', lang)}</p></div>
                          </div>
                          {/* AI recommendation full */}
                          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-100 dark:border-blue-900/30 mb-3">
                            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
                              <Brain className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-60" />
                              <span>{zone.ai_recommendation}</span>
                            </p>
                          </div>
                          {/* Zone activity */}
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider mb-2">{t('resource.zoneActivityLog', lang)}</p>
                            {auditLog.filter(a => (a.action_type === 'deploy' || a.action_type === 'recall') && a.target_id === zone.id).slice(0, 4).map((log, li) => (
                              <div key={li} className="flex items-center gap-2 text-[11px] py-1">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.action_type === 'deploy' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                <span className="text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{log.action}</span>
                                <span className="ml-auto text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 text-[10px]">{new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            ))}
                            {auditLog.filter(a => (a.action_type === 'deploy' || a.action_type === 'recall') && a.target_id === zone.id).length === 0 && (
                              <p className="text-[11px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('resource.noActivityRecorded', lang)}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
          {zones.length === 0 && (
            <div className="text-center py-12">
              <Layers className="w-8 h-8 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('resource.noZonesMatch', lang)}</p>
            </div>
          )}
        </div>}

        {/* Grid view */}
        {zoneView === 'grid' && (
          <div className="p-5">
            {zones.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {zones.map((zone: any, i: number) => {
                  const isExpanded = expandedZone === (zone.id || String(i))
                  const affected = parseAffected(zone.estimated_affected)
                  const priority = (zone.priority || 'Low').charAt(0).toUpperCase() + (zone.priority || 'low').slice(1).toLowerCase()
                  return (
                    <div key={zone.id || i} className={`rounded-xl border transition-all ${zone.deployed ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/5' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'}`}>
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <button onClick={() => setExpandedZone(isExpanded ? null : (zone.id || String(i)))} className="flex items-center gap-1.5 font-bold text-sm text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-left">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0" />}
                            {zone.zone}
                          </button>
                          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${P_PILL[priority] || P_PILL.Low}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${P_DOT[priority] || P_DOT.Low}`} />{priority}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          {zone.deployed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t('common.active', lang)}
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('resource.standby', lang)}</span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center mb-3">
                          <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium uppercase">{t('common.reports', lang)}</p>
                            <p className="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">{zone.active_reports}</p>
                          </div>
                          <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium uppercase">{t('resource.affected', lang)}</p>
                            <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">{affected > 0 ? affected.toLocaleString() : '—'}</p>
                          </div>
                          <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium uppercase">{t('resource.assets', lang)}</p>
                            <p className="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">{(Number(zone.ambulances) || 0) + (Number(zone.fire_engines) || 0) + (Number(zone.rescue_boats) || 0)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          {Number(zone.ambulances) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Truck className="w-3 h-3 text-red-500" />{zone.ambulances}</span>}
                          {Number(zone.fire_engines) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Flame className="w-3 h-3 text-orange-500" />{zone.fire_engines}</span>}
                          {Number(zone.rescue_boats) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"><Anchor className="w-3 h-3 text-blue-500" />{zone.rescue_boats}</span>}
                        </div>
                        {zone.ai_recommendation && (
                          <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-3 line-clamp-2"><Brain className="w-3 h-3 inline mr-1 opacity-50" />{zone.ai_recommendation}</p>
                        )}
                        <div className="flex justify-end">
                          {zone.deployed ? (
                            <button onClick={() => handleRecall(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 ring-1 ring-amber-500/20 transition-colors">{t('resource.recall', lang)}</button>
                          ) : (
                            <button onClick={() => handleDeploy(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 ring-1 ring-emerald-500/20 transition-colors">{t('resource.deploy', lang)}</button>
                          )}
                        </div>
                      </div>
                      {/* Expanded detail in grid */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800">
                          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.zoneId', lang)}</span><p className="font-mono font-bold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{zone.id || '—'}</p></div>
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.priorityScore', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{P_ORDER[priority] || 0}/4</p></div>
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('resource.estimatedAffected', lang)}</span><p className="font-bold text-rose-600 dark:text-rose-400 mt-0.5">{zone.estimated_affected || '—'}</p></div>
                            <div><span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium">{t('common.status', lang)}</span><p className={`font-bold mt-0.5 ${zone.deployed ? 'text-emerald-600' : 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>{zone.deployed ? t('resource.resourcesDeployed', lang) : t('resource.awaitingDeployment', lang)}</p></div>
                          </div>
                          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-2.5 border border-blue-100 dark:border-blue-900/30">
                            <p className="text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
                              <Brain className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-60" />
                              <span>{zone.ai_recommendation || t('resource.noRecommendation', lang)}</span>
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Layers className="w-8 h-8 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('resource.noZonesMatch', lang)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RECENT ACTIVITY */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Clock className="w-4 h-4 text-purple-500" /> {t('resource.recentActivity', lang)}</h3>
          <span className="text-[11px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{deployEvents.length} {t(deployEvents.length === 1 ? 'common.event' : 'common.events', lang)}</span>
        </div>
        <div className="p-5">
          {deployEvents.length > 0 ? (
            <div className="space-y-0 border-l-2 border-gray-100 dark:border-gray-800 ml-2 pl-5">
              {deployEvents.map((log, i) => {
                const isDeploy = log.action_type === 'deploy'
                const ms = Date.now() - new Date(log.created_at).getTime()
                const mins = Math.floor(ms / 60000)
                const ago = formatRelativeTime(mins, lang)
                return (
                  <div key={log.id || i} className="relative pb-4 last:pb-0 group">
                    <div className={`absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 ${isDeploy ? 'bg-emerald-500' : 'bg-amber-500'} group-hover:scale-125 transition-transform`} />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${isDeploy ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>{t(isDeploy ? 'resource.deploy' : 'resource.recall', lang)}</span>
                          <span className="text-xs font-medium text-gray-900 dark:text-white">{log.action}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
                          <span>{log.operator_name || t('common.system', lang)}</span>
                          <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                          <span>{new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-mono tabular-nums whitespace-nowrap">{ago}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <Activity className="w-6 h-6 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
              <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('resource.noActivity', lang)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}





