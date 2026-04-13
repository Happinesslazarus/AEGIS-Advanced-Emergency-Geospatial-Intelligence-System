/**
 * Module: ActivityLog.tsx
 *
 * Operator activity log viewer (shows who did what and when).
 *
 * How it connects:
 * - Rendered inside AdminPage.tsx based on active view */

/// AEGIS Admin - Activity Log Component
import { useState, useEffect } from 'react'
import { Clock, CheckCircle, AlertTriangle, Flag, Bell, Shield, Download, Printer } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export interface ActivityEntry {
  id: number; action: string; reportId?: string; operator: string
  timestamp: string; type: 'verify' | 'flag' | 'urgent' | 'alert' | 'deploy' | 'login' | 'print' | 'export'
}
/// Mock activity log for demonstration purposes
const INITIAL_LOG: ActivityEntry[] = [
  { id: 1, action: 'Logged in to AEGIS Admin', operator: 'System Administrator', timestamp: new Date(Date.now() - 3600000).toISOString(), type: 'login' },
  { id: 2, action: 'Verified report', reportId: 'RPT-001', operator: 'System Administrator', timestamp: new Date(Date.now() - 3000000).toISOString(), type: 'verify' },
  { id: 3, action: 'Sent alert: Flood Warning — River Don', operator: 'System Administrator', timestamp: new Date(Date.now() - 2400000).toISOString(), type: 'alert' },
  { id: 4, action: 'Flagged report for review', reportId: 'RPT-003', operator: 'Emergency Operator', timestamp: new Date(Date.now() - 1800000).toISOString(), type: 'flag' },
  { id: 5, action: 'Deployed resources to Bridge of Don', operator: 'System Administrator', timestamp: new Date(Date.now() - 1200000).toISOString(), type: 'deploy' },
  { id: 6, action: 'Escalated to URGENT', reportId: 'RPT-005', operator: 'Emergency Operator', timestamp: new Date(Date.now() - 600000).toISOString(), type: 'urgent' },
]

let _log = [...INITIAL_LOG]
let _listeners: ((entries: ActivityEntry[]) => void)[] = []

export function addActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
  const newEntry = { ...entry, id: Date.now(), timestamp: new Date().toISOString() }
  _log = [newEntry, ..._log].slice(0, 100) // keep last 100
  _listeners.forEach(fn => fn([..._log]))
}

export function useActivityLog(): [ActivityEntry[], (entries: ActivityEntry[]) => void] {
  const [log, setLog] = useState<ActivityEntry[]>(_log)
  useEffect(() => {
    // Ensure no duplicate listeners (e.g. from StrictMode double-mount)
    _listeners = _listeners.filter(fn => fn !== setLog)
    _listeners.push(setLog)
    return () => { _listeners = _listeners.filter(fn => fn !== setLog) }
  }, [])
  return [log, setLog]
}

const ICONS: Record<ActivityEntry['type'], typeof Clock> = {
  verify: CheckCircle, flag: Flag, urgent: AlertTriangle,
  alert: Bell, deploy: Shield, login: Clock, print: Printer, export: Download,
}
import { ACTIVITY_COLORS } from '../../utils/colorTokens'
const COLORS: Record<ActivityEntry['type'], string> = ACTIVITY_COLORS as Record<ActivityEntry['type'], string>

export default function ActivityLog(): JSX.Element {
  const [log] = useActivityLog()
  const lang = useLanguage()
  return (
    <div className="card p-4 animate-fade-in">
      <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-aegis-600" /> {t('admin.activityLog.title', lang)}</h3>
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {log.map(entry => {
          const Icon = ICONS[entry.type] || Clock
          const color = COLORS[entry.type] || 'text-gray-500 dark:text-gray-300 bg-gray-50'
          const [textColor, bgColor] = color.split(' ')
          const time = new Date(entry.timestamp)
          const ago = Math.round((Date.now() - time.getTime()) / 60000)
          const timeStr = ago < 60 ? `${ago}${t('time.mAgo', lang)}` : ago < 1440 ? `${Math.round(ago / 60)}${t('time.hAgo', lang)}` : time.toLocaleDateString()
          return (
            <div key={entry.id} className={`flex items-start gap-2.5 p-2 rounded-lg ${bgColor} dark:bg-opacity-10`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${bgColor} dark:bg-opacity-20`}>
                <Icon className={`w-3.5 h-3.5 ${textColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{entry.action}{entry.reportId && <span className="text-[10px] font-mono text-gray-500 dark:text-gray-300 ml-1">({entry.reportId})</span>}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-300">{entry.operator} · {timeStr}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
