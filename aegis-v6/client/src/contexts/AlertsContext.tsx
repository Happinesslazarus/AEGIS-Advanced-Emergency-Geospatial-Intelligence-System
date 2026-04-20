/**
 * Global alert state manager. Fetches the initial alert list from
 * /api/alerts on mount, subscribes to the Socket.IO "new-alert" and
 * "alert-updated" events, and exposes the alert array plus an unread
 * count to all child components.
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react'
import { apiGetAlerts } from '../utils/api'
import type { Alert, Notification } from '../types'
import { io as ioConnect } from 'socket.io-client'
import { SOCKET_URL } from '../hooks/useSocket'

interface AlertsContextType {
  alerts: Alert[]; activeAlerts: Alert[]; notifications: Notification[]
  loading: boolean; error: string | null
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'displayTime' | 'active'>) => Alert
  dismissAlert: (id: string) => void
  pushNotification: (message: string, type?: Notification['type'], duration?: number) => number
  dismissNotification: (id: number) => void
  dismissAllNotifications: () => void
  refreshAlerts: () => Promise<void>
}

const AlertsContext = createContext<AlertsContextType | null>(null)

//Helper to format relative time
function formatDisplayTime(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

export function AlertsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const notifTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  //Fetch alerts from API.
  const refreshAlerts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiGetAlerts()
      
      //Server may return paginated { data: [...], total, page, limit } or a flat array
      // (the API was updated to paginate, but older clients may receive a plain array).
      const alertList = Array.isArray(response) ? response : ((response as any)?.data ?? [])
      //Map API response to Alert type
      const fetchedAlerts: Alert[] = alertList.map((a: any) => ({
          id: a.id || `ALT-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title: a.title || 'Alert',
          message: a.message || a.description || '',
          severity: (a.severity?.toLowerCase() || 'info') as Alert['severity'],
          timestamp: a.created_at || a.createdAt || new Date().toISOString(),
          displayTime: formatDisplayTime(a.created_at || a.createdAt || new Date().toISOString()),
          area: a.location_text || a.location || '',
          source: a.created_by ? 'operator' : 'system',
          channels: a.channels || [],
          disasterType: a.alert_type || a.type || 'general',
          expiresAt: a.expires_at || null,
          active: a.is_active !== false,
        }))
      setAlerts(fetchedAlerts)
    } catch (err: any) {
      console.error('[AlertsContext] Failed to fetch alerts:', err)
      setError(err.message || 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  //Load alerts on mount and refresh periodically
  useEffect(() => {
    refreshAlerts()
    
    //Auto-refresh every 60 seconds
    const interval = setInterval(refreshAlerts, 60000)
    return () => clearInterval(interval)
  }, [refreshAlerts])

  //Real-time Socket.IO listener -- receives operator-issued alerts instantly
  //without waiting for the 60-second polling cycle.
  useEffect(() => {
    const socket = ioConnect(SOCKET_URL, { transports: ['websocket'], autoConnect: true, reconnectionAttempts: 5 })

    socket.on('alert:new', (payload: {
      id: string; type: string; severity: 'critical' | 'warning' | 'info';
      title: string; message: string; area: string;
      actionRequired?: string; issuedAt: string
    }) => {
      //Map server severity ('warning'/'info') to client AlertSeverity type
      const severityMap: Record<string, Alert['severity']> = {
        critical: 'critical', warning: 'medium', info: 'low',
      }
      const newAlert: Alert = {
        id: payload.id,
        title: payload.title,
        message: payload.message,
        severity: severityMap[payload.severity] ?? 'low',
        timestamp: payload.issuedAt,
        displayTime: 'Just now',
        area: payload.area,
        source: 'operator',
        channels: [],
        disasterType: payload.type,
        expiresAt: null,
        active: true,
      }
      setAlerts(prev => {
        //Avoid duplicates if polling also picked it up
        if (prev.some(a => a.id === payload.id)) return prev
        return [newAlert, ...prev]
      })
      //Haptic feedback on mobile for critical alerts
      if (navigator.vibrate && payload.severity === 'critical') {
        navigator.vibrate([100, 50, 100])
      }
    })

    return () => { socket.disconnect() }
  }, [])

  const addAlert = useCallback((input: Omit<Alert, 'id' | 'timestamp' | 'displayTime' | 'active'>): Alert => {
    const a: Alert = { ...input, id: `ALT-${Date.now()}`, timestamp: new Date().toISOString(), displayTime: 'Just now', active: true }
    setAlerts(prev => [a, ...prev])
    //Haptic feedback for critical/high alerts on supported devices
    if (navigator.vibrate && (input.severity === 'critical' || input.severity === 'high')) {
      navigator.vibrate(input.severity === 'critical' ? [100, 50, 100] : [80])
    }
    return a
  }, [])

  const dismissAlert = useCallback((id: string) => setAlerts(p => p.map(a => a.id === id ? { ...a, active: false } : a)), [])

  const pushNotification = useCallback((message: string, type: Notification['type'] = 'success', duration = 5000): number => {
    const id = Date.now()
    setNotifications(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      const timerId = setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), duration)
      notifTimersRef.current.push(timerId)
    }
    return id
  }, [])

  //Clear all pending notification timers on unmount
  useEffect(() => () => { notifTimersRef.current.forEach(clearTimeout) }, [])

  const dismissNotification = useCallback((id: number) => setNotifications(p => p.filter(n => n.id !== id)), [])
  const dismissAllNotifications = useCallback(() => setNotifications([]), [])

  const activeAlerts = useMemo(() => alerts.filter(a => a.active), [alerts])

  const value = useMemo(() => ({
    alerts, activeAlerts, notifications, loading, error,
    addAlert, dismissAlert, pushNotification, dismissNotification, dismissAllNotifications, refreshAlerts,
  }), [alerts, activeAlerts, notifications, loading, error, addAlert, dismissAlert, pushNotification, dismissNotification, dismissAllNotifications, refreshAlerts])

  return (
    <AlertsContext.Provider value={value}>
      {children}
    </AlertsContext.Provider>
  )
}

//ALERTS_DEFAULTS: safe no-op values returned when the hook is called outside
//a provider (e.g. in Storybook or isolated unit tests that don't wrap with
//AlertsProvider).  Without this, the missing context would throw an error.
const ALERTS_DEFAULTS: AlertsContextType = {
  alerts: [], activeAlerts: [], notifications: [], loading: false, error: null,
  addAlert: (a) => ({ ...a, id: '', timestamp: '', displayTime: '', active: false } as any),
  dismissAlert: () => {}, pushNotification: () => 0, dismissNotification: () => {}, dismissAllNotifications: () => {},
  refreshAlerts: async () => {},
}

export function useAlerts(): AlertsContextType {
  const ctx = useContext(AlertsContext)
  if (!ctx) {
    if (import.meta.env.DEV) console.warn('[Alerts] Context unavailable -- returning safe defaults.')
    return ALERTS_DEFAULTS
  }
  return ctx
}
