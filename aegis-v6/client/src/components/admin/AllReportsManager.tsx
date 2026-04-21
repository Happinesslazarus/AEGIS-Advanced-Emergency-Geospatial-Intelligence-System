/**
 * Report management console (view, filter, triage all reports).
 *
 * - Rendered inside AdminPage.tsx based on active view */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  FileText, Search, Download, Printer, RefreshCw, X, Filter,
  Brain, Eye, Camera, Send, Flag, Siren, Clock, CheckCircle,
  CheckCircle2, AlertTriangle, MapPin, ChevronRight, ChevronDown,
  ChevronUp, Archive, XCircle, BarChart3, Grid3X3, List,
  ArrowUpDown, Keyboard, Hash, Calendar,
  Droplets, Building2, ShieldAlert, Users, Flame, HeartPulse
} from 'lucide-react'
import IncidentFilterPanel from '../shared/IncidentFilterPanel'
import { t } from '../../utils/i18n'
import type { Report } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'
import { DataTable } from '../ui/DataTable'
import type { DataTableColumn } from '../ui/DataTable'

const CATEGORY_ICONS: Record<string, any> = {
  natural_disaster: Droplets, infrastructure: Building2,
  public_safety: ShieldAlert, community_safety: Users,
  environmental: Flame, medical: HeartPulse
}

interface AllReportsManagerProps {
  reports: Report[]
  filtered: Report[]
  stats: {
    total: number; urgent: number; unverified: number; verified: number
    flagged: number; resolved: number; archived?: number; falseReport?: number
    high: number; medium: number; low: number; avgConf: number; withMedia: number
  }
  lang: string
  searchTerm: string
  setSearchTerm: (v: string) => void
  filterSeverity: string
  setFilterSeverity: (v: string) => void
  filterStatus: string
  setFilterStatus: (v: string) => void
  filterType: string
  setFilterType: (v: string) => void
  smartFilter: string
  setSmartFilter: (v: string) => void
  selectedReportIds: Set<string>
  setSelectedReportIds: (v: Set<string>) => void
  bulkProgress: { current: number; total: number } | null
  onSelectReport: (r: Report) => void
  onOpenGallery: (r: Report) => void
  onShareReport: (r: Report) => void
  onPrintReport: (r: Report) => void
  onPrintAll: () => void
  onExportCSV: () => void
  onExportJSON: () => void
  onRefresh: () => void
  onBulkVerify: () => void
  onBulkFlag: () => void
  onBulkUrgent: () => void
  onBulkResolve: () => void
  onBulkArchive: () => void
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
}

const severityLabel = (v: string, lang: string) =>
  v === 'High' ? t('admin.filters.severity.high', lang) : v === 'Medium' ? t('admin.filters.severity.medium', lang) : t('admin.filters.severity.low', lang)

const statusLabel = (v: string, lang: string) => {
  const map: Record<string, string> = {
    Urgent: t('admin.filters.status.urgent', lang),
    Unverified: t('admin.filters.status.unverified', lang),
    Verified: t('admin.filters.status.verified', lang),
    Flagged: t('admin.filters.status.flagged', lang),
    Resolved: t('admin.filters.status.resolved', lang),
    Archived: t('admin.filters.status.archived', lang),
    False_Report: t('admin.filters.status.falseReport', lang),
  }
  return map[v] || v
}

const timeAgo = (ts: string, lang: string) => {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 1) return t('time.justNow', lang)
  if (mins < 60) return `${mins}${t('time.mAgo', lang)}`
  if (mins < 1440) return `${Math.floor(mins / 60)}${t('time.hAgo', lang)}`
  return `${Math.floor(mins / 1440)}${t('time.dAgo', lang)}`
}

type SortKey = 'time' | 'severity' | 'status' | 'type' | 'location' | 'confidence'
type SortDir = 'asc' | 'desc'

export default function AllReportsManager(props: AllReportsManagerProps) {
  const lang = useLanguage()
  const {
    reports, filtered, stats,
    searchTerm, setSearchTerm, filterSeverity, setFilterSeverity,
    filterStatus, setFilterStatus, filterType, setFilterType,
    smartFilter, setSmartFilter,
    selectedReportIds, setSelectedReportIds, bulkProgress,
    onSelectReport, onOpenGallery, onShareReport, onPrintReport,
    onPrintAll, onExportCSV, onExportJSON, onRefresh,
    onBulkVerify, onBulkFlag, onBulkUrgent, onBulkResolve, onBulkArchive,
    pushNotification,
  } = props

  const [viewMode, setViewMode] = useState<'card' | 'table'>('card')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showKeyboard, setShowKeyboard] = useState(false)
  const [pipelineExpanded, setPipelineExpanded] = useState(true)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const searchRef = useRef<HTMLInputElement>(null)
  const filteredRef = useRef(filtered)
  useEffect(() => { filteredRef.current = filtered }, [filtered])

  //Reset page when filters change
  useEffect(() => { setPage(0) }, [filtered])

  // Toggle sort
  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  // Sorted filtered reports
  const sortedFiltered = useMemo(() => {
    if (viewMode !== 'table') return filtered
    const SEVERITY_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 }
    const STATUS_RANK: Record<string, number> = { Urgent: 6, Unverified: 5, Flagged: 4, Verified: 3, Resolved: 2, Archived: 1, False_Report: 0 }
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'time': cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); break
        case 'severity': cmp = (SEVERITY_RANK[a.severity] || 0) - (SEVERITY_RANK[b.severity] || 0); break
        case 'status': cmp = (STATUS_RANK[a.status] || 0) - (STATUS_RANK[b.status] || 0); break
        case 'type': cmp = (a.type || a.incidentCategory || '').localeCompare(b.type || b.incidentCategory || ''); break
        case 'location': cmp = (a.location || '').localeCompare(b.location || ''); break
        case 'confidence': cmp = (a.confidence || 0) - (b.confidence || 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir, viewMode])

  // Paginated results
  const totalPages = Math.ceil((viewMode === 'table' ? sortedFiltered : filtered).length / PAGE_SIZE)
  const paginatedReports = useMemo(() => {
    const source = viewMode === 'table' ? sortedFiltered : filtered
    return source.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  }, [viewMode, sortedFiltered, filtered, page])

  // Select helpers
  const toggleSelection = (id: string) => {
    const next = new Set(selectedReportIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedReportIds(next)
  }
  const toggleSelectAll = useCallback(() => {
    const f = filteredRef.current
    if (selectedReportIds.size === f.length) setSelectedReportIds(new Set())
    else setSelectedReportIds(new Set(f.map(r => r.id)))
  }, [selectedReportIds, setSelectedReportIds])
  const clearFilters = useCallback(() => {
    setFilterSeverity('all'); setFilterStatus('all'); setFilterType('all')
    setSearchTerm(''); setSmartFilter('')
  }, [])

  //Keyboard shortcuts -- placed after toggleSelectAll/clearFilters to avoid TDZ errors
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        toggleSelectAll()
      } else if (e.key === 'Escape') {
        clearFilters()
        setSelectedReportIds(new Set())
      } else if (e.key === 't' || e.key === 'T') {
        setViewMode(v => v === 'card' ? 'table' : 'card')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggleSelectAll, clearFilters, setSelectedReportIds])

  const hasFilters = filterSeverity !== 'all' || filterStatus !== 'all' || filterType !== 'all' || searchTerm || smartFilter

  // Pipeline computed values
  const pipeline = useMemo(() => [
    { label: statusLabel('Urgent', lang), raw: 'Urgent', count: stats.urgent, color: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400', bgLight: 'bg-red-50 dark:bg-red-950/20' },
    { label: statusLabel('Unverified', lang), raw: 'Unverified', count: stats.unverified, color: 'bg-amber-400', textColor: 'text-amber-600 dark:text-amber-400', bgLight: 'bg-amber-50 dark:bg-amber-950/20' },
    { label: statusLabel('Verified', lang), raw: 'Verified', count: stats.verified, color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400', bgLight: 'bg-emerald-50 dark:bg-emerald-950/20' },
    { label: statusLabel('Flagged', lang), raw: 'Flagged', count: stats.flagged, color: 'bg-orange-500', textColor: 'text-orange-600 dark:text-orange-400', bgLight: 'bg-orange-50 dark:bg-orange-950/20' },
    { label: statusLabel('Resolved', lang), raw: 'Resolved', count: stats.resolved, color: 'bg-gray-400', textColor: 'text-gray-500 dark:text-gray-300', bgLight: 'bg-gray-50 dark:bg-gray-800/50' },
  ], [lang, stats])

  // Report timeline sparkline data (last 24h in 1h buckets)
  const sparklineData = useMemo(() => {
    const now = Date.now()
    const buckets = new Array(24).fill(0)
    reports.forEach(r => {
      const h = Math.floor((now - new Date(r.timestamp).getTime()) / 3600000)
      if (h >= 0 && h < 24) buckets[23 - h]++
    })
    const max = Math.max(...buckets, 1)
    return { buckets, normalized: buckets.map(v => v / max) }
  }, [reports])

  const sparkline = sparklineData.normalized

  // Sort indicator component
  return (
    <div className="space-y-4 animate-fade-in">

      {/*
          SECTION 1 -- HEADER BAR
           */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-aegis-600 flex items-center justify-center shadow-sm">
            <FileText className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
              {t('allReports.incidentReports', lang)}
              <span className="text-sm font-bold text-gray-500 dark:text-gray-300 tabular-nums">({reports.length})</span>
            </h1>
            <p className="text-[10px] text-gray-500 dark:text-gray-300 flex items-center gap-2">
              <span className="tabular-nums font-semibold text-aegis-600">{filtered.length}</span> {t('allReports.matchingFilters', lang)}
              {selectedReportIds.size > 0 && <span className="text-aegis-600 font-bold">- {selectedReportIds.size} {t('common.selected', lang)}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 ring-1 ring-gray-200 dark:ring-gray-700">
            <button onClick={() => setViewMode('card')} className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md transition-all ${viewMode === 'card' ? 'bg-white dark:bg-gray-700 shadow-sm text-aegis-600' : 'text-gray-400 dark:text-gray-300 hover:text-gray-600'}`} title={t('allReports.cardView', lang)}>
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('table')} className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md transition-all ${viewMode === 'table' ? 'bg-white dark:bg-gray-700 shadow-sm text-aegis-600' : 'text-gray-400 dark:text-gray-300 hover:text-gray-600'}`} title={t('allReports.tableView', lang)}>
              <List className="w-4 h-4" />
            </button>
          </div>
          <button onClick={onExportCSV} className="hidden sm:flex text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg items-center gap-1.5 hover:shadow-md transition-all"><Download className="w-3.5 h-3.5" /> {t('common.csv', lang)}</button>
          <button onClick={onExportJSON} className="hidden sm:flex text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg items-center gap-1.5 hover:shadow-md transition-all"><Download className="w-3.5 h-3.5" /> {t('common.json', lang)}</button>
          <button onClick={onPrintAll} className="hidden md:flex text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg items-center gap-1.5 hover:shadow-md transition-all"><Printer className="w-3.5 h-3.5" /> {t('admin.print', lang)}</button>
          <button onClick={onRefresh} className="text-xs bg-aegis-600 hover:bg-aegis-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm min-h-[36px]"><RefreshCw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('common.refresh', lang)}</span></button>
          <button onClick={() => setShowKeyboard(p => !p)} className="hidden sm:flex text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 min-w-[36px] min-h-[36px] items-center justify-center rounded-lg hover:shadow-md transition-all" title={t('common.shortcuts', lang)}><Keyboard className="w-3.5 h-3.5 text-gray-500 dark:text-gray-300" /></button>
        </div>
      </div>

      {/*  Keyboard Shortcuts Reference  */}
      {showKeyboard && (
        <div className="bg-gray-900 text-white rounded-xl p-3 flex items-center gap-4 flex-wrap text-[10px] font-mono ring-1 ring-gray-700">
          <span className="text-gray-400 dark:text-gray-300 font-bold uppercase tracking-wider text-[9px]">{t('common.shortcuts', lang)}:</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">Ctrl+K</kbd> {t('common.search', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">Ctrl+A</kbd> {t('common.selectAll', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">{t('common.esc', lang)}</kbd> {t('common.clear', lang)}</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300 dark:text-gray-300 ring-1 ring-gray-700">T</kbd> {t('allReports.tableView', lang)} / {t('allReports.cardView', lang)}</span>
          <button onClick={() => setShowKeyboard(false)} className="ml-auto text-gray-400 dark:text-gray-300 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/*
          SECTION 2 -- STATUS PIPELINE + TIMELINE SPARKLINE
           */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
        <button
          onClick={() => setPipelineExpanded(p => !p)}
          className="w-full px-4 py-2.5 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-900/50 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-gray-500 dark:text-gray-300" />
            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{t('allReports.reportPipeline', lang)}</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-300 tabular-nums">-- {stats.total} {t('common.total', lang).toLowerCase()}</span>
          </div>
          {pipelineExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />}
        </button>

        {pipelineExpanded && (
          <div className="p-4 space-y-4">
            {/* Pipeline status bars */}
            <div className="flex items-center gap-2">
              {pipeline.map((stage, i) => (
                <React.Fragment key={stage.label}>
                  <button
                    onClick={() => setFilterStatus(filterStatus === stage.raw ? 'all' : stage.raw)}
                    className={`flex-1 min-w-0 rounded-xl p-3 ring-1 transition-all cursor-pointer ${filterStatus === stage.raw ? `${stage.bgLight} ring-2 ring-current ${stage.textColor} shadow-sm` : 'ring-gray-200 dark:ring-gray-800 hover:ring-gray-300 dark:hover:ring-gray-700'}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">{stage.label}</span>
                      <span className={`text-sm font-black tabular-nums ${stage.textColor}`}>{stage.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${stage.color} transition-all duration-700`}
                        style={{ width: `${Math.max(stats.total > 0 ? (stage.count / stats.total) * 100 : 0, stage.count > 0 ? 8 : 0)}%` }} />
                    </div>
                    <p className="text-[9px] text-gray-400 dark:text-gray-300 mt-1 text-center tabular-nums">{stats.total > 0 ? Math.round((stage.count / stats.total) * 100) : 0}%</p>
                  </button>
                  {i < pipeline.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-700 flex-shrink-0 mt-1" />}
                </React.Fragment>
              ))}
            </div>

            {/* 24h Activity Sparkline */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-widest">{t('allReports.activityTimeline', lang)}</span>
 <span className="text-[9px] text-gray-400 dark:text-gray-300">{'->'}</span>
              </div>
              <div className="flex items-end gap-px h-8">
                {sparkline.map((v, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm transition-all duration-300 ${v > 0.7 ? 'bg-red-400 dark:bg-red-500' : v > 0.4 ? 'bg-amber-400 dark:bg-amber-500' : v > 0 ? 'bg-aegis-400 dark:bg-aegis-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                    style={{ height: `${Math.max(v * 100, v > 0 ? 10 : 3)}%` }}
                    title={`${24 - i}${t('time.hAgo', lang)}: ${sparklineData.buckets[i]} ${t('common.reports', lang)}`}
                  />
                ))}
              </div>
            </div>

            {/* Quick stats row */}
            <div className="flex items-center gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('analytics.avgAiConfidence', lang)} <span className="font-bold text-violet-600 dark:text-violet-400 tabular-nums">{stats.avgConf}%</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('admin.mediaAttached', lang)} <span className="font-bold text-blue-600 dark:text-blue-400 tabular-nums">{stats.withMedia}</span>/{stats.total}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('admin.filters.severity.high', lang)} <span className="font-bold tabular-nums">{stats.high}</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('admin.filters.severity.medium', lang)} <span className="font-bold tabular-nums">{stats.medium}</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-[10px] text-gray-500 dark:text-gray-300">{t('admin.filters.severity.low', lang)} <span className="font-bold tabular-nums">{stats.low}</span></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/*
          SECTION 3 -- AI SMART FILTER
           */}
      <div className="bg-gradient-to-r from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 dark:from-violet-500/10 dark:via-purple-500/10 dark:to-fuchsia-500/10 rounded-2xl ring-1 ring-violet-200 dark:ring-violet-800/50 p-4 backdrop-blur">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Brain className="w-3.5 h-3.5 text-white" /></div>
          <span className="text-xs font-bold text-violet-800 dark:text-violet-300">{t('allReports.aiSmartFilter', lang)}</span>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-violet-400" />
          <input
            className="w-full pl-10 pr-10 py-2.5 text-sm bg-white/80 dark:bg-gray-900/80 backdrop-blur rounded-xl ring-1 ring-violet-200 dark:ring-violet-800 focus:ring-2 focus:ring-violet-500 focus:outline-none placeholder-gray-400 transition-all"
            placeholder={t('common.search', lang)}
            value={smartFilter}
            onChange={e => setSmartFilter(e.target.value)}
          />
          {smartFilter && (
            <button onClick={() => setSmartFilter('')} className="absolute right-3 top-2.5 p-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/30 rounded-md transition-colors">
              <X className="w-4 h-4 text-violet-400" />
            </button>
          )}
        </div>
      </div>

      {/*
          SECTION 4 -- INCIDENT TYPE FILTER + SEARCH/FILTER TOOLBAR
           */}
      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
        <IncidentFilterPanel />
      </div>

      <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-300" />
            <input ref={searchRef} className="w-full pl-10 pr-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-aegis-500 focus:outline-none transition-all" placeholder={t('reports.search', lang)} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800 px-2.5 py-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-aegis-500 focus:outline-none cursor-pointer">
              <option value="all">{t('admin.filters.severity.all', lang)}</option>
              <option value="High">{t('admin.filters.severity.high', lang)}</option>
              <option value="Medium">{t('admin.filters.severity.medium', lang)}</option>
              <option value="Low">{t('admin.filters.severity.low', lang)}</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800 px-2.5 py-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-aegis-500 focus:outline-none cursor-pointer">
              <option value="all">{t('admin.filters.type.all', lang)}</option>
              <option value="natural_disaster">{t('admin.filters.type.natural_disaster', lang)}</option>
              <option value="infrastructure">{t('admin.filters.type.infrastructure', lang)}</option>
              <option value="public_safety">{t('admin.filters.type.public_safety', lang)}</option>
              <option value="community_safety">{t('admin.filters.type.community_safety', lang)}</option>
              <option value="environmental">{t('admin.filters.type.environmental', lang)}</option>
              <option value="medical">{t('admin.filters.type.medical', lang)}</option>
            </select>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-950/20 px-2.5 py-1.5 rounded-lg ring-1 ring-red-200 dark:ring-red-800 flex items-center gap-1 transition-all hover:shadow-sm">
              <X className="w-3 h-3" /> {t('common.clearAll', lang)}
            </button>
          )}
        </div>
      </div>

      {/*
          SECTION 5 -- STATUS FILTER PILLS
           */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { label: t('common.all', lang), value: 'all', count: reports.length, bg: 'bg-gray-100 dark:bg-gray-800', tc: 'text-gray-700 dark:text-gray-300', ring: 'ring-gray-200 dark:ring-gray-700' },
          { label: statusLabel('Urgent', lang), value: 'Urgent', count: stats.urgent, bg: 'bg-red-50 dark:bg-red-950/20', tc: 'text-red-700 dark:text-red-300', ring: 'ring-red-200 dark:ring-red-800', dot: 'bg-red-500' },
          { label: statusLabel('Unverified', lang), value: 'Unverified', count: stats.unverified, bg: 'bg-aegis-50 dark:bg-aegis-950/20', tc: 'text-aegis-700 dark:text-aegis-300', ring: 'ring-aegis-200 dark:ring-aegis-800', dot: 'bg-aegis-500' },
          { label: statusLabel('Verified', lang), value: 'Verified', count: stats.verified, bg: 'bg-emerald-50 dark:bg-emerald-950/20', tc: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-800', dot: 'bg-emerald-500' },
          { label: statusLabel('Flagged', lang), value: 'Flagged', count: stats.flagged, bg: 'bg-orange-50 dark:bg-orange-950/20', tc: 'text-orange-700 dark:text-orange-300', ring: 'ring-orange-200 dark:ring-orange-800', dot: 'bg-orange-500' },
          { label: statusLabel('Resolved', lang), value: 'Resolved', count: stats.resolved, bg: 'bg-gray-50 dark:bg-gray-900/50', tc: 'text-gray-600 dark:text-gray-300', ring: 'ring-gray-200 dark:ring-gray-700', dot: 'bg-gray-400' },
        ] as const).map(pill => (
          <button key={pill.value} onClick={() => setFilterStatus(pill.value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full ring-1 flex items-center gap-1.5 transition-all ${filterStatus === pill.value ? `${pill.bg} ${pill.tc} ${pill.ring} shadow-sm scale-105` : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-300 ring-gray-200 dark:ring-gray-800 hover:ring-gray-300'}`}>
            {'dot' in pill && pill.dot && <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />}
            {pill.label}
            <span className="text-[10px] font-black tabular-nums opacity-70">{pill.count}</span>
          </button>
        ))}
      </div>

      {/*
          SECTION 6 -- SELECT ALL + COUNT
           */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-300 tabular-nums">
            <span className="font-bold text-primary">{filtered.length}</span> {t('admin.reportsFound', lang)}
            {selectedReportIds.size > 0 && <span className="text-aegis-600 font-bold ml-2">({selectedReportIds.size} {t('common.selected', lang)})</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {viewMode === 'table' && (
            <span className="text-[10px] text-gray-400 dark:text-gray-300 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3" /> {t('common.sortBy', lang)}
            </span>
          )}
          {filtered.length > 0 && (
            <label className="flex items-center gap-2 text-xs cursor-pointer group">
              <input type="checkbox" checked={selectedReportIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 text-aegis-600 border-gray-300 rounded focus:ring-aegis-500" />
              <span className="font-semibold text-gray-600 dark:text-gray-300 group-hover:text-aegis-600 transition-colors">{t('common.selectAll', lang)}</span>
            </label>
          )}
        </div>
      </div>

      {/*
          SECTION 7 -- REPORT LIST (Card or Table view)
           */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-300 dark:text-gray-400" />
          </div>
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('common.noReportsFound', lang)}</h3>
          <button onClick={clearFilters} className="text-xs font-semibold text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/30 px-4 py-2 rounded-lg ring-1 ring-aegis-200 dark:ring-aegis-800 transition-all hover:shadow-md">
            {t('common.clearAll', lang)}
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /*  TABLE VIEW  */
        <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
          <DataTable<Report>
            columns={[
              { key: 'sel', header: <input type="checkbox" checked={selectedReportIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-3.5 h-3.5 text-aegis-600 border-gray-300 rounded focus:ring-aegis-500" />, headerClassName: 'w-10', render: r => <span onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedReportIds.has(r.id)} onChange={() => toggleSelection(r.id)} className="w-3.5 h-3.5 text-aegis-600 border-gray-300 rounded focus:ring-aegis-500" /></span> },
              { key: 'status', header: t('common.status', lang), sortable: true, render: r => <><span className={`inline-block text-[10px] px-2 py-0.5 rounded-md font-bold ${{ Urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', Verified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', Flagged: 'bg-aegis-100 text-aegis-700 dark:bg-aegis-900/30 dark:text-aegis-300', Resolved: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', Archived: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400', False_Report: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400', Unverified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }[r.status] || 'bg-gray-100 text-gray-600'}`}>{statusLabel(r.status, lang)}</span>{r.status === 'Urgent' && <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-ping ml-1" />}</> },
              { key: 'severity', header: t('common.severity', lang), sortable: true, render: r => <span className={`inline-block text-[10px] px-2 py-0.5 rounded-md font-bold ${{ High: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', Medium: 'bg-aegis-100 text-aegis-700 dark:bg-aegis-900/30 dark:text-aegis-300', Low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }[r.severity] || ''}`}>{severityLabel(r.severity, lang)}</span> },
              { key: 'type', header: t('common.type', lang), sortable: true, render: r => <div className="flex items-center gap-1.5"><span className="text-xs font-semibold truncate max-w-[160px]">{r.type || r.incidentCategory}</span>{r.trappedPersons === 'yes' && <AlertTriangle className="w-3 h-3 text-purple-600 flex-shrink-0" />}{r.hasMedia && <Camera className="w-3 h-3 text-blue-500 flex-shrink-0" />}</div> },
              { key: 'location', header: t('common.location', lang), sortable: true, render: r => <span className="text-[10px] text-gray-600 dark:text-gray-300 truncate max-w-[140px] block">{r.location}</span> },
              { key: 'confidence', header: 'AI', sortable: true, align: 'center', render: r => (r.confidence || 0) > 0 ? <div className="flex items-center justify-center gap-1"><div className="w-8 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${(r.confidence || 0) >= 80 ? 'bg-emerald-500' : (r.confidence || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${r.confidence}%` }} /></div><span className="text-[10px] font-bold tabular-nums text-gray-600 dark:text-gray-300">{r.confidence}%</span></div> : <span className="text-[10px] text-gray-300">--</span> },
              { key: 'time', header: t('common.time', lang), sortable: true, align: 'right', render: r => <span className="text-[10px] text-gray-600 dark:text-gray-300 tabular-nums">{timeAgo(r.timestamp, lang)}</span> },
              { key: 'actions', header: t('common.actions', lang), align: 'center', render: r => <div className="flex items-center gap-1 justify-center"><button onClick={e => { e.stopPropagation(); onSelectReport(r) }} className="w-6 h-6 rounded bg-aegis-50 dark:bg-aegis-950/30 hover:bg-aegis-100 text-aegis-600 flex items-center justify-center transition-all" title={t('common.view', lang)}><Eye className="w-3 h-3" /></button>{r.hasMedia && <button onClick={e => { e.stopPropagation(); onOpenGallery(r) }} className="w-6 h-6 rounded bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 text-purple-600 flex items-center justify-center transition-all" title={t('admin.actions.openMedia', lang)}><Camera className="w-3 h-3" /></button>}<button onClick={e => { e.stopPropagation(); onPrintReport(r) }} className="w-6 h-6 rounded bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 text-gray-500 dark:text-gray-300 flex items-center justify-center transition-all" title={t('common.print', lang)}><Printer className="w-3 h-3" /></button></div> },
            ] as DataTableColumn<Report>[]}
            rows={paginatedReports}
            rowKey={r => r.id}
            sortField={sortKey}
            sortDir={sortDir}
            onSort={field => toggleSort(field as SortKey)}
            onRowClick={r => onSelectReport(r)}
            rowClassName={r => selectedReportIds.has(r.id) ? 'bg-aegis-50/30 dark:bg-aegis-950/10' : ''}
            emptyMessage={t('common.noReportsFound', lang)}
            className="max-h-[70vh] overflow-y-auto"
          />
        </div>
      ) : (
        /*  CARD VIEW  */
        <div className="space-y-2.5">
          {paginatedReports.map(r => {
            const CatIcon = CATEGORY_ICONS[r.incidentCategory as string] || FileText
            return (
              <div key={r.id} className={`bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ${selectedReportIds.has(r.id) ? 'ring-aegis-400 dark:ring-aegis-600 bg-aegis-50/30 dark:bg-aegis-950/10' : 'ring-gray-200 dark:ring-gray-800'} shadow-sm hover:shadow-lg hover:ring-gray-300 dark:hover:ring-gray-700 transition-all duration-200 group overflow-hidden`}>
                {r.status === 'Urgent' && <div className="h-0.5 bg-gradient-to-r from-red-500 via-red-400 to-orange-400" />}
                <div className="p-4 flex items-start gap-4">
                  {/* Checkbox */}
                  <div className="flex flex-col items-center gap-2 pt-0.5">
                    <input type="checkbox" checked={selectedReportIds.has(r.id)} onChange={() => toggleSelection(r.id)} className="w-4 h-4 text-aegis-600 border-gray-300 rounded focus:ring-aegis-500 cursor-pointer" onClick={e => e.stopPropagation()} />
                  </div>
                  {/* Status Icon */}
                  <div className="relative flex-shrink-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm ${r.status === 'Urgent' ? 'bg-gradient-to-br from-red-500 to-red-600' : r.status === 'Verified' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : r.status === 'Flagged' ? 'bg-gradient-to-br from-aegis-500 to-aegis-600' : r.status === 'Resolved' ? 'bg-gradient-to-br from-gray-400 to-gray-500' : r.status === 'Archived' ? 'bg-gradient-to-br from-slate-500 to-slate-600' : r.status === 'False_Report' ? 'bg-gradient-to-br from-rose-600 to-rose-700' : 'bg-gradient-to-br from-blue-400 to-blue-500'}`}>
                      {r.status === 'Urgent' ? <Siren className="w-5 h-5" /> : r.status === 'Verified' ? <CheckCircle className="w-5 h-5" /> : r.status === 'Flagged' ? <Flag className="w-5 h-5" /> : r.status === 'Resolved' ? <CheckCircle2 className="w-5 h-5" /> : r.status === 'Archived' ? <Archive className="w-5 h-5" /> : r.status === 'False_Report' ? <XCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                    </div>
                    {r.status === 'Urgent' && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full animate-ping" />}
                  </div>
                  {/* Content */}
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectReport(r)}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${r.severity === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : r.severity === 'Medium' ? 'bg-aegis-100 text-aegis-700 dark:bg-aegis-900/30 dark:text-aegis-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                        {severityLabel(r.severity, lang)}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${r.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : r.status === 'Verified' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : r.status === 'Flagged' ? 'bg-aegis-100 text-aegis-700 dark:bg-aegis-900/30 dark:text-aegis-300' : r.status === 'Resolved' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : r.status === 'Archived' ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400' : r.status === 'False_Report' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                        {statusLabel(r.status, lang)}
                      </span>
                      {(r.confidence || 0) > 0 && (
                        <span className="text-[10px] text-violet-600 dark:text-violet-400 flex items-center gap-0.5 font-semibold">
                          <Brain className="w-3 h-3" />
                          <span className="tabular-nums">{r.confidence}%</span>
                          {/* Confidence bar */}
                          <div className="w-6 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ml-0.5">
                            <div className={`h-full rounded-full ${(r.confidence || 0) >= 80 ? 'bg-emerald-500' : (r.confidence || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${r.confidence}%` }} />
                          </div>
                        </span>
                      )}
                      {r.hasMedia && <span className="text-[10px] text-blue-500 flex items-center gap-0.5"><Camera className="w-3 h-3" /> {t('admin.mediaAttached', lang)}</span>}
                      {r.trappedPersons === 'yes' && <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-600 text-white font-bold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {t('admin.badge.vulnerablePerson', lang)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <CatIcon className="w-4 h-4 text-gray-400 dark:text-gray-300 flex-shrink-0" />
                      <p className="text-sm font-bold truncate group-hover:text-aegis-600 transition-colors">{r.type || r.incidentCategory}</p>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-600 dark:text-gray-300">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0" /><span className="truncate max-w-[200px]">{r.location}</span></span>
                      <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3 h-3" />{timeAgo(r.timestamp, lang)}</span>
                      <span className="font-mono text-gray-500 dark:text-gray-300">{r.reportNumber}</span>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex gap-1.5 flex-shrink-0 items-center transition-opacity">
                    <button onClick={() => onSelectReport(r)} className="w-8 h-8 rounded-lg bg-aegis-50 dark:bg-aegis-950/30 hover:bg-aegis-100 dark:hover:bg-aegis-950/50 text-aegis-600 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-aegis-200 dark:ring-aegis-800/40" title={t('admin.actions.viewReportDetail', lang)}><Eye className="w-4 h-4" /></button>
                    {r.hasMedia && <button onClick={() => onOpenGallery(r)} className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-950/50 text-purple-600 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-purple-200 dark:ring-purple-800/40 relative" title={t('admin.actions.openMedia', lang)}><Camera className="w-4 h-4" />{(r.media?.length || 0) > 1 && <span className="absolute -top-1 -right-1 bg-purple-600 text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">{r.media!.length}</span>}</button>}
                    <button onClick={() => onShareReport(r)} className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 text-blue-600 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-blue-200 dark:ring-blue-800/40" title={t('admin.actions.shareReport', lang)}><Send className="w-4 h-4" /></button>
                    <button onClick={() => onPrintReport(r)} className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-gray-200 dark:ring-gray-700" title={t('admin.actions.printReport', lang)}><Printer className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/*  PAGINATION  */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
 {'<-'} {t('common.previous', lang)}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums font-semibold">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
 {t('common.next', lang)} {'->'}
          </button>
        </div>
      )}

      {/*
          SECTION 8 -- FLOATING BULK ACTIONS BAR
           */}
      {selectedReportIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900/95 backdrop-blur-xl text-white rounded-2xl shadow-2xl px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3 ring-2 ring-aegis-500/50 z-50 animate-slide-up max-w-[calc(100vw-1.5rem)] overflow-x-auto">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-aegis-600 flex items-center justify-center"><FileText className="w-4 h-4" /></div>
            <div>
              <p className="text-sm font-bold tabular-nums whitespace-nowrap">{selectedReportIds.size} {t('common.selected', lang)}</p>
              <p className="text-[9px] text-gray-400 dark:text-gray-300 whitespace-nowrap">
                {bulkProgress ? `${t('common.processing', lang)} ${bulkProgress.current}/${bulkProgress.total}...` : t('common.actions', lang)}
              </p>
            </div>
          </div>
          <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <button onClick={onBulkVerify} className="min-h-[36px] px-2.5 sm:px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all" title={t('admin.action.verify', lang)}>
              <CheckCircle className="w-4 h-4" /> <span className="hidden sm:inline">{t('admin.action.verify', lang)}</span>
            </button>
            <button onClick={onBulkFlag} className="min-h-[36px] px-2.5 sm:px-3.5 py-2 bg-aegis-600 hover:bg-aegis-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all" title={t('admin.action.flag', lang)}>
              <Flag className="w-4 h-4" /> <span className="hidden sm:inline">{t('admin.action.flag', lang)}</span>
            </button>
            <button onClick={onBulkUrgent} className="min-h-[36px] px-2.5 sm:px-3.5 py-2 bg-red-600 hover:bg-red-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all" title={t('admin.action.urgent', lang)}>
              <Siren className="w-4 h-4" /> <span className="hidden sm:inline">{t('admin.action.urgent', lang)}</span>
            </button>
            <button onClick={onBulkResolve} className="min-h-[36px] px-2.5 sm:px-3.5 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all" title={t('admin.action.resolve', lang)}>
              <CheckCircle2 className="w-4 h-4" /> <span className="hidden sm:inline">{t('admin.action.resolve', lang)}</span>
            </button>
            <button onClick={onBulkArchive} className="min-h-[36px] px-2.5 sm:px-3.5 py-2 bg-slate-600 hover:bg-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all" title={t('admin.action.archive', lang)}>
              <Archive className="w-4 h-4" /> <span className="hidden sm:inline">{t('admin.action.archive', lang)}</span>
            </button>
          </div>
          <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
          <button onClick={() => setSelectedReportIds(new Set())} className="min-w-[36px] min-h-[36px] hover:bg-gray-800 rounded-lg transition-all flex items-center justify-center flex-shrink-0" title={t('common.clear', lang)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

