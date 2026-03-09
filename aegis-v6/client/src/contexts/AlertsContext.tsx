import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { SAMPLE_ALERTS } from '../data/sampleAlerts'
import type { Alert, Notification } from '../types'

interface AlertsContextType {
  alerts: Alert[]; activeAlerts: Alert[]; notifications: Notification[]
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'displayTime' | 'active'>) => Alert
  dismissAlert: (id: string) => void
  pushNotification: (message: string, type?: Notification['type'], duration?: number) => number
  dismissNotification: (id: number) => void
  refreshAlerts: () => Promise<void>
}

const AlertsContext = createContext<AlertsContextType | null>(null)

export function AlertsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [alerts, setAlerts] = useState<Alert[]>(SAMPLE_ALERTS)
  const [notifications, setNotifications] = useState<Notification[]>([])

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
  const refreshAlerts = useCallback(async () => {}, [])

  return (
    <AlertsContext.Provider value={{ alerts, activeAlerts: alerts.filter(a => a.active), notifications, addAlert, dismissAlert, pushNotification, dismissNotification, refreshAlerts }}>
      {children}
    </AlertsContext.Provider>
  )
}

export function useAlerts(): AlertsContextType {
  const ctx = useContext(AlertsContext)
  if (!ctx) throw new Error('useAlerts must be within AlertsProvider')
  return ctx
}
