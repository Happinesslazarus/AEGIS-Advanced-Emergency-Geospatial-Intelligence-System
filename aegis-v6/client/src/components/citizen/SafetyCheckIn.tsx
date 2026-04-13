/**
 * Module: SafetyCheckIn.tsx
 *
 * Safety check in citizen component (public-facing UI element).
 *
 * How it connects:
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CheckCircle, AlertTriangle, HelpCircle, Undo2, Users,
  Clock, Shield, ChevronDown, ChevronUp, Bell,
} from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

type SafetyStatus = 'safe' | 'help' | 'unsure' | null

interface CheckInRecord {
  status: SafetyStatus
  timestamp: Date
}

const UNDO_SECONDS = 8

export default function SafetyCheckIn(): JSX.Element {
  const lang = useLanguage()
  const [status, setStatus] = useState<SafetyStatus>(null)
  const [pendingStatus, setPendingStatus] = useState<SafetyStatus>(null)
  const [undoCountdown, setUndoCountdown] = useState(0)
  const [notifyFamily, setNotifyFamily] = useState(true)
  const [history, setHistory] = useState<CheckInRecord[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const undoTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const { pushNotification } = useAlerts()

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (undoTimer.current) clearInterval(undoTimer.current) }
  }, [])

  const commitStatus = useCallback((s: SafetyStatus) => {
    setStatus(s)
    setPendingStatus(null)
    setUndoCountdown(0)
    if (undoTimer.current) { clearInterval(undoTimer.current); undoTimer.current = null }

    setHistory(prev => [{ status: s, timestamp: new Date() }, ...prev].slice(0, 10))

    if (s === 'help') {
      pushNotification('Help request received. Nearby responders notified.', 'warning')
      if (notifyFamily) {
        pushNotification('Family contacts have been notified of your status.', 'info')
      }
    } else {
      pushNotification('Safety status recorded.', 'success')
      if (notifyFamily) {
        pushNotification('Family contacts have been notified you are ' + (s === 'safe' ? 'safe' : 'unsure') + '.', 'info')
      }
    }
  }, [notifyFamily, pushNotification])

  const handleSelect = (s: SafetyStatus): void => {
    // If clicking same pending status, cancel
    if (pendingStatus === s) {
      setPendingStatus(null)
      setUndoCountdown(0)
      if (undoTimer.current) { clearInterval(undoTimer.current); undoTimer.current = null }
      return
    }

    // Start confirmation countdown
    setPendingStatus(s)
    setUndoCountdown(UNDO_SECONDS)
    if (undoTimer.current) clearInterval(undoTimer.current)

    undoTimer.current = setInterval(() => {
      setUndoCountdown(prev => {
        if (prev <= 1) {
          commitStatus(s)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleUndo = (): void => {
    setPendingStatus(null)
    setUndoCountdown(0)
    if (undoTimer.current) { clearInterval(undoTimer.current); undoTimer.current = null }
  }

  const handleConfirmNow = (): void => {
    if (pendingStatus) commitStatus(pendingStatus)
  }

  const items: { key: SafetyStatus; label: string; icon: typeof CheckCircle; base: string; active: string; pending: string; glow: string }[] = [
    { key: 'safe', label: t('safetyCheck.imSafe', lang), icon: CheckCircle, base: 'bg-green-600/90 hover:bg-green-600 border-green-500/30', active: 'bg-green-600 ring-2 ring-green-300 shadow-lg shadow-green-500/30', pending: 'bg-green-600 ring-2 ring-green-300/60 animate-pulse', glow: 'shadow-green-500/40' },
    { key: 'help', label: t('safetyCheck.needHelp', lang), icon: AlertTriangle, base: 'bg-red-600/90 hover:bg-red-600 border-red-500/30', active: 'bg-red-600 ring-2 ring-red-300 shadow-lg shadow-red-500/30', pending: 'bg-red-600 ring-2 ring-red-300/60 animate-pulse', glow: 'shadow-red-500/40' },
    { key: 'unsure', label: t('safetyCheck.unsure', lang), icon: HelpCircle, base: 'bg-amber-600/90 hover:bg-amber-600 border-amber-500/30', active: 'bg-amber-600 ring-2 ring-amber-300 shadow-lg shadow-amber-500/30', pending: 'bg-amber-600 ring-2 ring-amber-300/60 animate-pulse', glow: 'shadow-amber-500/40' },
  ]

  const confirmedItem = items.find(i => i.key === status)

  return (
    <div className="bg-gradient-to-r from-aegis-700 via-aegis-800 to-aegis-700 dark:from-aegis-900 dark:via-aegis-950 dark:to-aegis-900 text-white" role="region" aria-label="Safety check-in">
      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-aegis-300" />
            <h3 className="text-sm font-bold text-aegis-100">{t('safetyCheck.areYouSafe', lang)}</h3>
          </div>
          <div className="flex items-center gap-3">
            {/* Notify family toggle */}
            <button
              onClick={() => setNotifyFamily(v => !v)}
              className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-all ${notifyFamily ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50'}`}
              aria-pressed={notifyFamily}
              title={notifyFamily ? 'Family will be notified' : 'Family notifications off'}
            >
              <Users className="w-3 h-3" />
              <Bell className={`w-3 h-3 ${notifyFamily ? 'text-amber-300' : 'text-white/30'}`} />
              <span className="hidden sm:inline">{notifyFamily ? 'Notify Family' : 'Silent'}</span>
            </button>

            {/* History toggle */}
            {history.length > 0 && (
              <button
                onClick={() => setHistoryOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all"
              >
                <Clock className="w-3 h-3" />
                <span className="hidden sm:inline">History</span>
                {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>

        {/* Status buttons */}
        <div className="flex flex-wrap gap-2.5">
          {items.map(({ key, label, icon: Icon, base, active, pending }) => {
            const isConfirmed = status === key && !pendingStatus
            const isPending = pendingStatus === key
            return (
              <button
                key={key}
                onClick={() => handleSelect(key)}
                disabled={!!pendingStatus && pendingStatus !== key}
                className={`relative px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 border transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${isPending ? pending : isConfirmed ? active : base}`}
                aria-pressed={isConfirmed}
              >
                <Icon className="w-4 h-4" />
                {label}
                {isConfirmed && (
                  <span className="ml-1 text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full">✓</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Pending confirmation bar with undo */}
        {pendingStatus && undoCountdown > 0 && (
          <div className="mt-3 flex items-center gap-3 bg-black/20 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/10 animate-enter">
            {/* Countdown ring */}
            <div className="relative w-9 h-9 flex-shrink-0">
              <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${(undoCountdown / UNDO_SECONDS) * 94.25} 94.25`}
                  className="transition-all duration-1000 ease-linear"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-black">{undoCountdown}</span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold">
                Confirming <span className="capitalize">{pendingStatus === 'help' ? 'Help Request' : pendingStatus === 'safe' ? 'Safe Status' : 'Unsure Status'}</span>
              </p>
              <p className="text-[10px] text-white/50">
                {notifyFamily ? 'Family contacts will be notified' : 'Recording status silently'}
              </p>
            </div>

            <button
              onClick={handleConfirmNow}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-all"
            >
              Confirm Now
            </button>
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all"
            >
              <Undo2 className="w-3 h-3" /> Undo
            </button>
          </div>
        )}

        {/* Confirmed status feedback */}
        {status && !pendingStatus && confirmedItem && (
          <div className={`mt-3 flex items-center gap-2.5 text-xs text-white/70 animate-enter`}>
            <confirmedItem.icon className="w-3.5 h-3.5" />
            <span>
              Status: <strong className="text-white">{confirmedItem.label}</strong>
              {' · '}
              {history[0] && (
                <span className="text-white/40">
                  {history[0].timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {notifyFamily && <span className="text-white/40"> · Family notified</span>}
            </span>
          </div>
        )}

        {/* History timeline */}
        {historyOpen && history.length > 0 && (
          <div className="mt-3 bg-black/15 rounded-xl p-3 border border-white/5 animate-enter">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Recent Check-ins</p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
              {history.map((rec, i) => {
                const item = items.find(it => it.key === rec.status)
                if (!item) return null
                const Icon = item.icon
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-white/60">
                    <Icon className="w-3 h-3 flex-shrink-0" />
                    <span className="font-medium text-white/80">{item.label}</span>
                    <span className="text-white/30 ml-auto tabular-nums">
                      {rec.timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
