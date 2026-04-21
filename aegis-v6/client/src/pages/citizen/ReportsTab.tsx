import React, { useState, useMemo } from 'react'
import {
  FileText, AlertTriangle, Zap, Shield, CheckCircle,
  Search, ArrowUpDown, Filter, Share2, Printer,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import ReportCard from '../../components/shared/ReportCard'
import { EmptyReports } from '../../components/ui/EmptyState'
import { SkeletonList } from '../../components/ui/Skeleton'

type ReportFilterLevel = 'all' | 'High' | 'Medium' | 'Low'
type ReportStatusFilter = 'all' | 'Unverified' | 'Verified' | 'Urgent' | 'Resolved'

export default function ReportsTab({ reports, loading, searchTerm, setSearchTerm, sortField, setSortField, sortOrder, setSortOrder, onViewReport, onPrintReport, onShareReport, lang }: any) {
  const [severityFilter, setSeverityFilter] = useState<ReportFilterLevel>('all')
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all')
  const [lastRefresh] = useState(Date.now())

  const filtered = useMemo(() => {
    let list = [...reports]
    if (severityFilter !== 'all') list = list.filter((r: any) => r.severity === severityFilter)
    if (statusFilter !== 'all') list = list.filter((r: any) => r.status === statusFilter)
    return list
  }, [reports, severityFilter, statusFilter])

  const stats = useMemo(() => {
    const high = reports.filter((r: any) => r.severity === 'High').length
    const medium = reports.filter((r: any) => r.severity === 'Medium').length
    const low = reports.filter((r: any) => r.severity === 'Low').length
    const urgent = reports.filter((r: any) => r.status === 'Urgent').length
    const verified = reports.filter((r: any) => r.status === 'Verified').length
    const unverified = reports.filter((r: any) => r.status === 'Unverified').length
    const resolved = reports.filter((r: any) => r.status === 'Resolved' || r.status === 'Archived').length
    const withMedia = reports.filter((r: any) => r.hasMedia).length
    const aiPowered = reports.filter((r: any) => r.confidence != null).length
    return { total: reports.length, high, medium, low, urgent, verified, unverified, resolved, withMedia, aiPowered }
  }, [reports])

  //Severity bar percentages
  const total = stats.total || 1
  const pH = (stats.high / total) * 100
  const pM = (stats.medium / total) * 100
  const pL = (stats.low / total) * 100

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-4">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-600/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            {stats.urgent > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-white dark:border-gray-900 flex items-center justify-center">
                <span className="text-[7px] font-black text-white">{stats.urgent}</span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">{t('cdash.reports.recentReports', lang)}</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-aegis-100 dark:bg-aegis-900/40 text-aegis-700 dark:text-aegis-300 text-xs font-bold">{stats.total}</span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">
              {stats.high} {t('cdash.reports.critical', lang)} - {stats.verified} {t('cdash.reports.verified', lang)} - {stats.aiPowered} {t('cdash.reports.aiAnalysed', lang)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold text-green-700 dark:text-green-300 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={() => { setSeverityFilter('High'); setStatusFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${severityFilter === 'High' ? 'ring-2 ring-red-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <AlertTriangle className={`w-4 h-4 ${stats.high > 0 ? 'text-red-500 animate-pulse' : 'text-gray-400 dark:text-gray-400'}`} />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.critical', lang)}</span>
          </div>
          <div className={`text-2xl font-black leading-none ${stats.high > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{stats.high}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-red-500 rounded-full transition-all duration-700" style={{ width: `${pH}%` }} />
          </div>
        </button>
        <button
          onClick={() => { setSeverityFilter('Medium'); setStatusFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${severityFilter === 'Medium' ? 'ring-2 ring-amber-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.moderate', lang)}</span>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.medium}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-700" style={{ width: `${pM}%` }} />
          </div>
        </button>
        <button
          onClick={() => { setSeverityFilter('Low'); setStatusFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${severityFilter === 'Low' ? 'ring-2 ring-blue-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <Shield className="w-4 h-4 text-blue-500" />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.low', lang)}</span>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.low}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${pL}%` }} />
          </div>
        </button>
        <button
          onClick={() => { setStatusFilter('Verified'); setSeverityFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${statusFilter === 'Verified' ? 'ring-2 ring-emerald-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.verified', lang)}</span>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.verified}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${(stats.verified / total) * 100}%` }} />
          </div>
        </button>
      </div>

      {/* STATUS FILTER PILLS */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {([
          { key: 'all' as const, label: t('cdash.reports.all', lang), count: stats.total, color: 'text-gray-600 dark:text-gray-400', activeBg: 'bg-gray-100 dark:bg-gray-700' },
          { key: 'Unverified' as const, label: t('cdash.reports.unverified', lang), count: stats.unverified, color: 'text-yellow-600', activeBg: 'bg-yellow-50 dark:bg-yellow-950/30' },
          { key: 'Verified' as const, label: t('cdash.reports.verifiedStatus', lang), count: stats.verified, color: 'text-emerald-600', activeBg: 'bg-emerald-50 dark:bg-emerald-950/30' },
          { key: 'Urgent' as const, label: t('cdash.reports.urgent', lang), count: stats.urgent, color: 'text-red-600', activeBg: 'bg-red-50 dark:bg-red-950/30' },
          { key: 'Resolved' as const, label: t('cdash.reports.resolved', lang), count: stats.resolved, color: 'text-blue-600', activeBg: 'bg-blue-50 dark:bg-blue-950/30' },
        ]).map(st => (
          <button
            key={st.key}
            onClick={() => { setStatusFilter(st.key); if (st.key !== 'all') setSeverityFilter('all') }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all ${
              statusFilter === st.key
                ? `${st.activeBg} ${st.color} ring-1 ring-current/20 shadow-sm`
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
            }`}
          >
            {st.label}
            {st.count > 0 && <span className={`ml-0.5 px-1.5 rounded-full text-[8px] ${statusFilter === st.key ? 'bg-current/10' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>{st.count}</span>}
          </button>
        ))}
      </div>

      {/* SEARCH + SORT */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-3 border-b border-gray-200/80 dark:border-gray-700/50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400" />
            <input className="w-full pl-10 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition text-gray-900 dark:text-white placeholder-gray-400" placeholder={t('reports.search', lang) || 'Search reports...'} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={sortField} onChange={e => setSortField(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 appearance-none text-gray-700 dark:text-gray-200">
            <option value="timestamp">{t('citizen.reports.newest', lang)}</option>
            <option value="severity">{t('severity', lang)}</option>
            <option value="confidence">{t('citizen.reports.aiConfidence', lang)}</option>
          </select>
          <button onClick={() => setSortOrder((o: string) => o === 'desc' ? 'asc' : 'desc')} className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors" title={sortOrder === 'desc' ? t('cdash.reports.newestFirst', lang) : t('cdash.reports.oldestFirst', lang)}>
            <ArrowUpDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <div className="text-[9px] font-medium text-gray-400 dark:text-gray-400 ml-auto">
            {filtered.length} of {stats.total} shown
          </div>
        </div>

        {/* REPORT LIST */}
        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[600px] overflow-y-auto custom-scrollbar">
          {loading ? (
            <SkeletonList count={3} />
          ) : filtered.length === 0 ? (
            reports.length > 0 ? (
              <div className="py-12 text-center">
                <Filter className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('cdash.reports.noMatching', lang)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">{t('cdash.reports.tryAdjusting', lang)} <button onClick={() => { setSeverityFilter('all'); setStatusFilter('all') }} className="text-aegis-600 dark:text-aegis-400 font-bold hover:underline">{t('cdash.reports.clearingFilters', lang)}</button></p>
              </div>
            ) : (
              <EmptyReports />
            )
          ) : (
            filtered.map((r: any) => {
              const sevColor = r.severity === 'High' ? 'border-l-red-500 bg-red-50/40 dark:bg-red-950/10' : r.severity === 'Medium' ? 'border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/10' : 'border-l-blue-500 bg-blue-50/40 dark:bg-blue-950/10'
              const timeAgoMs = Date.now() - new Date(r.timestamp).getTime()
              const isRecent = timeAgoMs < 3600_000 // less than 1 hour
              return (
                <div key={r.id} className={`relative group border-l-4 ${sevColor} transition-all hover:bg-gray-50/60 dark:hover:bg-gray-800/30`}>
                  {/* NEW badge for recent reports */}
                  {isRecent && (
                    <div className="absolute top-2.5 right-14 z-10">
                      <span className="px-1.5 py-0.5 rounded text-[7px] font-black bg-green-500 text-white uppercase tracking-wider animate-pulse">{t('cdash.reports.new', lang)}</span>
                    </div>
                  )}
                  <ReportCard report={r} onClick={onViewReport} />
                  <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button onClick={(e) => { e.stopPropagation(); onShareReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all shadow-sm" title={t('cdash.reports.shareReport', lang)}>
                      <Share2 className="w-4 h-4 text-blue-600" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onPrintReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm" title={t('cdash.reports.printReport', lang)}>
                      <Printer className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* FOOTER */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-3 text-[9px] font-medium">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t('cdash.reports.realTime', lang)}
              </span>
              <span className="text-gray-400 dark:text-gray-400">
                {stats.withMedia} {t('cdash.reports.withMedia', lang)} - {stats.aiPowered} {t('cdash.reports.aiAnalysed', lang)}
              </span>
            </div>
            <span className="text-[9px] font-bold text-gray-400 dark:text-gray-400 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">{filtered.length} {t('cdash.reports.reports', lang)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
