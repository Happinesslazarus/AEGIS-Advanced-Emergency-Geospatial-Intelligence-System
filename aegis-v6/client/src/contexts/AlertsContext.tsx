import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { apiGetAlerts } from '../utils/api'
import type { Alert, Notification } from '../types'

interface AlertsContextType {
  alerts: Alert[]; activeAlerts: Alert[]; notifications: Notification[]
  loading: boolean; error: string | null
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'displayTime' | 'active'>) => Alert
  dismissAlert: (id: string) => void
  pushNotification: (message: string, type?: Notification['type'], duration?: number) => number
  dismissNotification: (id: number) => void
  refreshAlerts: () => Promise<void>
}

const AlertsContext = createContext<AlertsContextType | null>(null)

// Helper to format relative time
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

  // Fetch alerts from API
  const refreshAlerts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiGetAlerts()
      
      // Server may return paginated { data: [...], total, page, limit } or a flat array
      const alertList = Array.isArray(response) ? response : ((response as any)?.data ?? [])
      // Map API response to Alert type
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

  // Load alerts on mount and refresh periodically
  useEffect(() => {
    refreshAlerts()
    
    // Auto-refresh every 60 seconds
    const interval = setInterval(refreshAlerts, 60000)
    return () => clearInterval(interval)
  }, [refreshAlerts])

  const addAlert = useCallback((input: Omit<Alert, 'id' | 'timestamp' | 'displayTime' | 'active'>): Alert => {
    const a: Alert = { ...input, id: `ALT-${Date.now()}`, timestamp: new Date().toISOString(), displayTime: 'Just now', active: true }
    setAlerts(prev => [a, ...prev])
    return a
  }, [])

  const dismissAlert = useCallback((id: string) => setAlerts(p => p.map(a => a.id === id ? { ...a, active: false } : a)), [])

  const pushNotification = useCallback((message: string, type: Notification['type'] = 'success', duration = 5000): number => {
    const id = Date.now()
    setNotifications(prev => [...prev, { id, message, type }])
    if (duration > 0) setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), duration)
    return id
  }, [])

  const dismissNotification = useCallback((id: number) => setNotifications(p => p.filter(n => n.id !== id)), [])

  return (
    <AlertsContext.Provider value={{ alerts, activeAlerts: alerts.filter(a => a.active), notifications, loading, error, addAlert, dismissAlert, pushNotification, dismissNotification, refreshAlerts }}>
      {children}
    </AlertsContext.Provider>
  )
}

const ALERTS_DEFAULTS: AlertsContextType = {
  alerts: [], activeAlerts: [], notifications: [], loading: false, error: null,
  addAlert: (a) => ({ ...a, id: '', timestamp: '', displayTime: '', active: false } as any),
  dismissAlert: () => {}, pushNotification: () => 0, dismissNotification: () => {},
  refreshAlerts: async () => {},
}

export function useAlerts(): AlertsContextType {
  const ctx = useContext(AlertsContext)
  if (!ctx) {
    if (import.meta.env.DEV) console.warn('[Alerts] Context unavailable — returning safe defaults.')
    return ALERTS_DEFAULTS
  }
  return ctx
}
