/* IncidentQueue.tsx — Incident Assignment / Response Queue for admin dashboard */

import { useState, useMemo } from 'react'
import {
  AlertTriangle, User, Clock, ChevronRight, Filter,
  UserPlus, ArrowUpRight, CheckCircle2, RotateCcw, Siren, Shield
} from 'lucide-react'
import type { Report, Operator } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

type QueueStatus = 'unassigned' | 'assigned' | 'in_progress' | 'escalated' | 'resolved'

interface QueueItem {
  report: Report
  assignee: string | null
  queueStatus: QueueStatus
  lastUpdated: string
}

const STATUS_CONFIG: Record<QueueStatus, { label: string; color: string; bg: string; border: string }> = {
  unassigned:  { label: 'Unassigned',  color: 'text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300',   bg: 'bg-gray-500/10',    border: 'border-gray-500/20' },
  assigned:    { label: 'Assigned',    color: 'text-blue-500',   bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  in_progress: { label: 'In Progress', color: 'text-amber-500',  bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  escalated:   { label: 'Escalated',   color: 'text-red-500',    bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  resolved:    { label: 'Resolved',    color: 'text-green-500',  bg: 'bg-green-500/10',   border: 'border-green-500/20' },
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

export default function IncidentQueue({ reports, currentUser, onNotify }: IncidentQueueProps): JSX.Element {
  const lang = useLanguage()
  const [statusFilter, setStatusFilter] = useState<QueueStatus | 'all'>('all')
  const [assignments, setAssignments] = useState<Record<string, { assignee: string; status: QueueStatus }>>({})

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
    onNotify(`${t('admin.queue.incidentAssigned', lang)} ${currentUser.displayName}`, 'success')
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

  const handleReassign = (reportId: string) => {
    // Cycle to next mock operator for demo
    const operators = ['Cpt. Morrison', 'Lt. Campbell', 'Sgt. Wallace', 'Off. Reid', currentUser.displayName]
    const current = assignments[reportId]?.assignee || ''
    const idx = operators.indexOf(current)
    const next = operators[(idx + 1) % operators.length]
    setAssignments(prev => ({
      ...prev,
      [reportId]: { ...prev[reportId], assignee: next, status: 'assigned' },
    }))
    onNotify(`${t('admin.queue.reassignedTo', lang)} ${next}`, 'info')
  }

  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-2xl border border-gray-200 dark:border-gray-700/60 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white">{t('admin.queue.title', lang)}</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{queueItems.length} {t('admin.queue.activeIncidents', lang)} &middot; {counts.unassigned} {t('admin.queue.unassigned', lang)}</p>
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
                    : 'bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {isAll ? 'All' : cfg!.label} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* Queue list */}
      <div className="divide-y divide-gray-50 dark:divide-gray-800/50 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-800">
        {filteredItems.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-300 dark:text-green-700 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('admin.queue.noIncidents', lang)}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">{t('admin.queue.noIncidentsDesc', lang)}</p>
          </div>
        ) : (
          filteredItems.map(item => {
            const cfg = STATUS_CONFIG[item.queueStatus]
            const timeSince = getTimeSince(item.lastUpdated)
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
                        {cfg.label}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ SEV_COLORS[item.report.severity] || 'bg-gray-400'} text-white`}>
                        {item.report.severity}
                      </span>
                      {item.report.reportNumber && (
                        <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-mono">#{item.report.reportNumber}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                      <span className="truncate max-w-[200px]">{item.report.location}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />{timeSince}
                      </span>
                      {item.assignee && (
                        <span className="flex items-center gap-1 text-blue-500">
                          <User className="w-3 h-3" />{item.assignee}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                    {item.queueStatus === 'unassigned' && (
                      <button
                        onClick={() => handleAssignSelf(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 border border-blue-200 dark:border-blue-500/20 px-2 py-1 rounded-lg transition-all"
                        title="Assign to self"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span className="hidden sm:inline">Assign</span>
                      </button>
                    )}
                    {(item.queueStatus === 'assigned' || item.queueStatus === 'unassigned') && (
                      <button
                        onClick={() => handleMarkInProgress(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/20 px-2 py-1 rounded-lg transition-all"
                        title="Mark in progress"
                      >
                        <Siren className="w-3 h-3" />
                        <span className="hidden sm:inline">Start</span>
                      </button>
                    )}
                    {item.queueStatus !== 'resolved' && item.queueStatus !== 'escalated' && (
                      <button
                        onClick={() => handleEscalate(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/20 px-2 py-1 rounded-lg transition-all"
                        title="Escalate"
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span className="hidden sm:inline">Escalate</span>
                      </button>
                    )}
                    {item.assignee && item.queueStatus !== 'resolved' && (
                      <button
                        onClick={() => handleReassign(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded-lg transition-all"
                        title="Reassign"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span className="hidden sm:inline">Reassign</span>
                      </button>
                    )}
                    {item.queueStatus === 'in_progress' && (
                      <button
                        onClick={() => handleMarkResolved(item.report.id)}
                        className="flex items-center gap-1 text-[9px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 border border-green-200 dark:border-green-500/20 px-2 py-1 rounded-lg transition-all"
                        title="Mark resolved"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span className="hidden sm:inline">Resolve</span>
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
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
          <span><strong className="text-red-500">{counts.escalated}</strong> escalated</span>
          <span><strong className="text-amber-500">{counts.in_progress}</strong> in progress</span>
          <span><strong className="text-blue-500">{counts.assigned}</strong> assigned</span>
          <span><strong className="text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{counts.unassigned}</strong> awaiting</span>
        </div>
        <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">Updated {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  )
}

/* Helper: human-readable elapsed time */
function getTimeSince(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}





