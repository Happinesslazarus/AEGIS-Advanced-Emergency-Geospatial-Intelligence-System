/**
 * Incident queue (prioritised list of pending incidents).
 *
 * - Rendered inside AdminPage.tsx based on active view */

/* IncidentQueue.tsx — Incident Assignment / Response Queue for admin dashboard */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  AlertTriangle, User, Clock, ChevronRight, ChevronDown,
  UserPlus, ArrowUpRight, CheckCircle2, RotateCcw, Siren, Shield, Users
} from 'lucide-react'
import type { Report, Operator } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { apiFetch } from '../../utils/api'

type QueueStatus = 'unassigned' | 'assigned' | 'in_progress' | 'escalated' | 'resolved'

interface QueueItem {
  report: Report
  assignee: string | null
  queueStatus: QueueStatus
  lastUpdated: string
}

const STATUS_CONFIG: Record<QueueStatus, { labelKey: string; color: string; bg: string; border: string }> = {
  unassigned:  { labelKey: 'admin.queue.statusUnassigned',  color: 'text-gray-500 dark:text-gray-300',   bg: 'bg-gray-500/10',    border: 'border-gray-500/20' },
  assigned:    { labelKey: 'admin.queue.statusAssigned',    color: 'text-blue-500',   bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  in_progress: { labelKey: 'admin.queue.statusInProgress', color: 'text-amber-500',  bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  escalated:   { labelKey: 'admin.queue.statusEscalated',   color: 'text-red-500',    bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  resolved:    { labelKey: 'admin.queue.statusResolved',    color: 'text-green-500',  bg: 'bg-green-500/10',   border: 'border-green-500/20' },
}

const SEV_COLORS: Record<string, string> = {
  High: 'bg-red-500',
  Medium: 'bg-amber-500',
  Low: 'bg-blue-400',
}

interface IncidentQueueProps {
  reports: Report[]
  currentUser: Operator
  onNotify: (message: string, type: 'success' | 'warning' | 'error' | 'info') => void
}

const STORAGE_KEY = 'aegis_queue_assignments'

function loadAssignments(): Record<string, { assignee: string; status: QueueStatus }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export default function IncidentQueue({ reports, currentUser, onNotify }: IncidentQueueProps): JSX.Element {
  const lang = useLanguage()
  const [statusFilter, setStatusFilter] = useState<QueueStatus | 'all'>('all')
  const [assignments, setAssignments] = useState<Record<string, { assignee: string; status: QueueStatus }>>(loadAssignments)
  const [operators, setOperators] = useState<Array<{ id: string; displayName: string; role: string }>>([])
  const [assignDropdown, setAssignDropdown] = useState<string | null>(null) // reportId with open dropdown

  // Fetch real operators for assignment
  useEffect(() => {
    apiFetch<any>('/api/users?limit=50')
      .then(data => {
        const users = data?.users || (Array.isArray(data) ? data : [])
        setOperators(users.map((u: any) => ({
          id: u.id,
          displayName: u.display_name || u.displayName || u.email,
          role: u.role || 'operator',
        })).filter((u: any) => u.displayName))
      })
      .catch(() => {
        // Fallback: at least include current user
        setOperators([{ id: currentUser.id || 'self', displayName: currentUser.displayName, role: 'operator' }])
      })
  }, [currentUser?.id])

  // Close dropdown on outside click
  const queueRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!assignDropdown) return
    const handler = (e: MouseEvent) => {
      if (queueRef.current && !queueRef.current.contains(e.target as Node)) {
        setAssignDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [assignDropdown])

  // Persist assignments to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments)) } catch {}
  }, [assignments])

  // Build queue items from reports
  const queueItems: QueueItem[] = useMemo(() => {
    const actionable = reports.filter(r => r.status !== 'Resolved' && r.status !== 'Archived' && r.status !== 'False_Report')
    return actionable.map(report => {
      const assignment = assignments[report.id]
      return {
        report,
        assignee: assignment?.assignee || null,
        queueStatus: assignment?.status || 'unassigned',
        lastUpdated: report.updatedAt || report.timestamp,
      }
    }).sort((a, b) => {
      // Priority: escalated > unassigned urgent > unassigned > in_progress > assigned > resolved
      const priority: Record<QueueStatus, number> = { escalated: 5, unassigned: 4, in_progress: 3, assigned: 2, resolved: 1 }
      const pDiff = (priority[b.queueStatus] || 0) - (priority[a.queueStatus] || 0)
      if (pDiff !== 0) return pDiff
      // Within same status, sort by severity then date
      const sevMap: Record<string, number> = { High: 3, Medium: 2, Low: 1 }
      const sDiff = (sevMap[b.report.severity] || 0) - (sevMap[a.report.severity] || 0)
      if (sDiff !== 0) return sDiff
      return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    })
  }, [reports, assignments])

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return queueItems
    return queueItems.filter(item => item.queueStatus === statusFilter)
  }, [queueItems, statusFilter])

  // Stats
  const counts = useMemo(() => {
    const c: Record<string, number> = { unassigned: 0, assigned: 0, in_progress: 0, escalated: 0, resolved: 0 }
    queueItems.forEach(item => { c[item.queueStatus] = (c[item.queueStatus] || 0) + 1 })
    return c
  }, [queueItems])

  const handleAssignSelf = (reportId: string) => {
    setAssignments(prev => ({
      ...prev,
      [reportId]: { assignee: currentUser.displayName, status: 'assigned' },
    }))
    setAssignDropdown(null)
    onNotify(`${t('admin.queue.incidentAssigned', lang)} ${currentUser.displayName}`, 'success')
  }

  const handleAssignTo = (reportId: string, operatorName: string) => {
    setAssignments(prev => ({
      ...prev,
      [reportId]: { assignee: operatorName, status: 'assigned' },
    }))
    setAssignDropdown(null)
    onNotify(`${t('admin.queue.incidentAssigned', lang)} ${operatorName}`, 'success')
  }

  const handleEscalate = (reportId: string) => {
    setAssignments(prev => ({
      ...prev,
      [reportId]: { ...prev[reportId], assignee: prev[reportId]?.assignee || currentUser.displayName, status: 'escalated' },
    }))
    onNotify(t('admin.queue.escalatedSenior', lang), 'warning')
  }

  const handleMarkInProgress = (reportId: string) => {
    setAssignments(prev => ({
      ...prev,
      [reportId]: { ...prev[reportId], assignee: prev[reportId]?.assignee || currentUser.displayName, status: 'in_progress' },
    }))
    onNotify(t('admin.queue.inProgress', lang), 'info')
  }

  const handleMarkResolved = (reportId: string) => {
    setAssignments(prev => ({
      ...prev,
      [reportId]: { ...prev[reportId], status: 'resolved' },
    }))
    onNotify(t('admin.queue.resolved', lang), 'success')
  }

  return (
    <div ref={queueRef} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700/60 shadow-lg animate-fade-in">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white">{t('admin.queue.title', lang)}</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-300">{queueItems.length} {t('admin.queue.activeIncidents', lang)} &middot; {counts.unassigned} {t('admin.queue.unassigned', lang)}</p>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap gap-1">
          {(['all', 'unassigned', 'assigned', 'in_progress', 'escalated', 'resolved'] as const).map(status => {
            const isAll = status === 'all'
            const cfg = isAll ? null : STATUS_CONFIG[status]
            const count = isAll ? queueItems.length : (counts[status] || 0)
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                  statusFilter === status
                    ? isAll
                      ? 'bg-aegis-500/15 text-aegis-600 dark:text-aegis-400 border-aegis-500/30'
                      : `${cfg!.bg} ${cfg!.color} ${cfg!.border}`
                    : 'bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {isAll ? t('admin.queue.filterAll', lang) : t(cfg!.labelKey, lang)} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* Queue list */}
      <div className="divide-y divide-gray-50 dark:divide-gray-800/50 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-800 stagger-children">
        {filteredItems.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-300 dark:text-green-700 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-300">{t('admin.queue.noIncidents', lang)}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-1">{t('admin.queue.noIncidentsDesc', lang)}</p>
          </div>
        ) : (
          filteredItems.map(item => {
            const cfg = STATUS_CONFIG[item.queueStatus]
            const timeSince = item.lastUpdated
            return (
              <div
                key={item.report.id}
                className="px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  {/* Severity dot */}
                  <div className="pt-1">
                    <span className={`block w-3 h-3 rounded-full ${SEV_COLORS[item.report.severity] || 'bg-gray-400'} ${
                      item.report.severity === 'High' ? 'animate-pulse shadow-sm shadow-red-500/40' : ''
                    }`} />
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-gray-900 dark:text-white truncate">
                        {item.report.type}
                      </span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                        {t(cfg.labelKey, lang)}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ SEV_COLORS[item.report.severity] || 'bg-gray-400'} text-white`}>
                        {item.report.severity}
                      </span>
                      {item.report.reportNumber && (
                        <span className="text-[9px] text-gray-400 dark:text-gray-300 font-mono">#{item.report.reportNumber}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 dark:text-gray-300">
                      <span className="truncate max-w-[200px]">{item.report.location}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />{getTimeSince(timeSince, lang)}
                      </span>
                      {item.assignee && (
                        <span className="flex items-center gap-1 text-blue-500">
                          <User className="w-3 h-3" />{item.assignee}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-90 group-hover:opacity-100 transition-opacity flex-wrap relative">
                    {item.queueStatus === 'unassigned' && (
                      <>
                        <button
                          onClick={() => handleAssignSelf(item.report.id)}
                          className="flex items-center gap-1 text-[9px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 border border-blue-200 dark:border-blue-500/20 px-2 py-1.5 rounded-lg transition-all min-h-[32px]"
                          title={t('admin.queue.claimTitle', lang)}
                        >
                          <UserPlus className="w-3 h-3" />
                          <span className="hidden sm:inline">{t('admin.queue.claim', lang)}</span>
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setAssignDropdown(assignDropdown === item.report.id ? null : item.report.id)}
                            className="flex items-center gap-1 text-[9px] font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 hover:bg-violet-100 dark:hover:bg-violet-500/20 border border-violet-200 dark:border-violet-500/20 px-2 py-1.5 rounded-lg transition-all min-h-[32px]"
                            title={t('admin.queue.assignTitle', lang)}
                            aria-label={t('admin.queue.assignTitle', lang)}
                            aria-expanded={assignDropdown === item.report.id}
                            aria-haspopup="listbox"
                          >
                            <Users className="w-3 h-3" />
                            <span className="hidden sm:inline">{t('admin.queue.assign', lang)}</span>
                            <ChevronDown className="w-2.5 h-2.5" />
                          </button>
                          {assignDropdown === item.report.id && (
                            <div className="absolute right-0 top-full mt-1 z-[100] bg-white dark:bg-gray-900 rounded-xl shadow-2xl ring-2 ring-gray-200 dark:ring-gray-600 py-1 min-w-[220px] max-h-[200px] overflow-y-auto border border-gray-300 dark:border-gray-600">
                              <p className="px-3 py-1.5 text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">{t('admin.queue.assignToHeader', lang)}</p>
                              {operators.map(op => (
                                <button
                                  key={op.id}
                                  onClick={() => handleAssignTo(item.report.id, op.displayName)}
                                  className="w-full text-left px-3 py-2 text-[11px] font-medium text-gray-800 dark:text-gray-100 hover:bg-blue-50 dark:hover:bg-blue-900/40 flex items-center gap-2 transition-colors"
                                >
                                  <User className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                                  <span className="flex-1 truncate font-semibold">{op.displayName}</span>
                                  <span className="text-[9px] text-gray-500 dark:text-gray-400 capitalize bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{op.role}</span>
                                </button>
                              ))}
                              {operators.length === 0 && (
                                <p className="px-3 py-2 text-[10px] text-gray-400">{t('admin.queue.noTeamMembers', lang)}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {(item.queueStatus === 'assigned' || item.queueStatus === 'unassigned') && (
                      <button
                        onClick={() => handleMarkInProgress(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/20 px-2 py-1.5 rounded-lg transition-all min-h-[32px]"
                        title={t('admin.queue.markInProgress', lang)}
                      >
                        <Siren className="w-3 h-3" />
                        <span className="hidden sm:inline">{t('admin.queue.start', lang)}</span>
                      </button>
                    )}
                    {item.queueStatus !== 'resolved' && item.queueStatus !== 'escalated' && (
                      <button
                        onClick={() => handleEscalate(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/20 px-2 py-1.5 rounded-lg transition-all min-h-[32px]"
                        title={t('admin.queue.escalate', lang)}
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span className="hidden sm:inline">{t('admin.queue.escalate', lang)}</span>
                      </button>
                    )}
                    {item.assignee && item.queueStatus !== 'resolved' && (
                      <div className="relative">
                        <button
                          onClick={() => setAssignDropdown(assignDropdown === `re-${item.report.id}` ? null : `re-${item.report.id}`)}
                          className="flex items-center gap-1 text-[9px] font-bold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-1.5 rounded-lg transition-all min-h-[32px]"
                          title={t('admin.queue.reassignTitle', lang)}
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span className="hidden sm:inline">{t('admin.queue.reassign', lang)}</span>
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {assignDropdown === `re-${item.report.id}` && (
                          <div className="absolute right-0 top-full mt-1 z-[100] bg-white dark:bg-gray-900 rounded-xl shadow-2xl ring-2 ring-gray-200 dark:ring-gray-600 py-1 min-w-[220px] max-h-[200px] overflow-y-auto border border-gray-300 dark:border-gray-600">
                            <p className="px-3 py-1.5 text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">{t('admin.queue.reassignToHeader', lang)}</p>
                            {operators.filter(op => op.displayName !== item.assignee).map(op => (
                              <button
                                key={op.id}
                                onClick={() => handleAssignTo(item.report.id, op.displayName)}
                                className="w-full text-left px-3 py-2 text-[11px] font-medium text-gray-800 dark:text-gray-100 hover:bg-blue-50 dark:hover:bg-blue-900/40 flex items-center gap-2 transition-colors"
                              >
                                <User className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                                <span className="flex-1 truncate font-semibold">{op.displayName}</span>
                                <span className="text-[9px] text-gray-500 dark:text-gray-400 capitalize bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{op.role}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {item.queueStatus === 'in_progress' && (
                      <button
                        onClick={() => handleMarkResolved(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 border border-green-200 dark:border-green-500/20 px-2 py-1.5 rounded-lg transition-all min-h-[32px]"
                        title={t('admin.queue.resolve', lang)}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span className="hidden sm:inline">{t('admin.queue.resolve', lang)}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer summary */}
      <div className="px-3 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 text-[10px] text-gray-500 dark:text-gray-300 flex-wrap">
          <span><strong className="text-red-500">{counts.escalated}</strong> {t('admin.queue.statusEscalated', lang)}</span>
          <span><strong className="text-amber-500">{counts.in_progress}</strong> {t('admin.queue.statusInProgress', lang)}</span>
          <span><strong className="text-blue-500">{counts.assigned}</strong> {t('admin.queue.statusAssigned', lang)}</span>
          <span><strong className="text-gray-600 dark:text-gray-300">{counts.unassigned}</strong> {t('admin.queue.awaiting', lang)}</span>
        </div>
        <span className="text-[9px] text-gray-400 dark:text-gray-300">{t('admin.queue.updated', lang)} {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  )
}

/* Helper: human-readable elapsed time */
function getTimeSince(timestamp: string, lang: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('admin.queue.justNow', lang)
  if (mins < 60) return t('admin.queue.minsAgo', lang).replace('{n}', String(mins))
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('admin.queue.hrsAgo', lang).replace('{n}', String(hrs))
  const days = Math.floor(hrs / 24)
  return t('admin.queue.daysAgo', lang).replace('{n}', String(days))
}

