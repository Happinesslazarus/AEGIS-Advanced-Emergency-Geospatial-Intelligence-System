/**
 * Creates a single Socket.IO client connection on mount and tears it
 * down on unmount. Exposes the socket instance so any component can
 * emit events or subscribe to channels.
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useSocket, type SocketState } from '../hooks/useSocket'
import { useEventCallbacks } from '../hooks/useEventStream'
import { getToken } from '../utils/api'
import { getCitizenToken } from './CitizenAuthContext'

const SocketContext = createContext<SocketState | null>(null)

function getPersistedToken(): string | null {
  const path = window.location.pathname
  //Route-based token selection: citizen and admin sessions use different
  //JWT tokens (different scopes).  We pick the right one based on the active
  //URL so a citizen and an admin can share the same browser without one
  //token overwriting the other.
  if (path.startsWith('/citizen')) {
    return getCitizenToken() || getToken()
  }
  if (path.startsWith('/admin')) {
    return getToken()   // operator/admin token from api.ts
  }
  return getCitizenToken()
    || getToken()
}

export function SocketProvider({ children }: { children: ReactNode }): JSX.Element {
  const socketState = useSocket()

  //Connect on mount and whenever the socket disconnects
  useEffect(() => {
    const token = getPersistedToken()
    if (token && !socketState.connected) {
      socketState.connect(token)
    }
  }, [socketState.connected, socketState.connect])

  //Cross-tab login sync: `storage` event fires in OTHER tabs when
  //localStorage changes.  This lets a citizen who logs in on Tab A get a
  //real-time Socket.IO connection on Tab B without a page refresh.
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'aegis-citizen-token') {
        const newToken = e.newValue
        if (newToken) {
          socketState.connect(newToken)
        }
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [socketState.connect])

  //Same-tab admin login sync: `ae:token-set` fires in api.ts when setToken() is
  //called (after operator login or silent JWT refresh). This reconnects the
  //sharedSocket with the operator token so ReportsContext socket listeners fire.
  useEffect(() => {
    const handleTokenSet = () => {
      const token = getPersistedToken()
      if (token) socketState.connect(token)
    }
    window.addEventListener('ae:token-set', handleTokenSet)
    return () => window.removeEventListener('ae:token-set', handleTokenSet)
  }, [socketState.connect])

  useEffect(() => {
    return () => {
      socketState.disconnect()
    }
  }, [socketState.disconnect])

  return (
    <SocketContext.Provider value={socketState}>
      <ProactiveAgentBridge />
      {children}
    </SocketContext.Provider>
  )
}

/**
 * Forwards critical alert payloads from the typed event channels into
 * localStorage so the chatbot can pick them up. Lives inside the
 * provider so the typed event hook can subscribe via context.
 */
function ProactiveAgentBridge(): null {
  useEventCallbacks({
    'incident:alert': forwardAlert,
    'alert:new':      forwardAlert,
    'alert:update':   forwardAlert,
  })
  return null
}

function forwardAlert(payload: { riskLevel?: string; severity?: string; title?: string; incidentType?: string; description?: string; details?: string; location_text?: string; affectedRegionId?: string; regionId?: string }): void {
  const sev = String(payload?.severity || payload?.riskLevel || '')
  if (!['critical', 'high', 'Critical', 'Warning'].includes(sev)) return
  localStorage.setItem('aegis-latest-alert', JSON.stringify({
    severity: payload.severity || payload.riskLevel || 'Warning',
    title: payload.title || payload.incidentType || 'New alert',
    description: payload.description || payload.details || '',
    location_text: payload.location_text || payload.affectedRegionId || payload.regionId || '',
    timestamp: Date.now(),
  }))
}

/** Trigger socket reconnection after citizen login/logout (same-tab).
 *  The `storage` event only fires in OTHER tabs by default.  This function
 *  manually dispatches a StorageEvent on THIS tab so same-tab login/logout
 *  triggers the listener above and reconnects the socket immediately.
 */
export function notifySocketAuthChange(): void {
  //Dispatch a storage event manually for same-tab listeners
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'aegis-citizen-token',
    newValue: getCitizenToken(),
  }))
}

export function useSharedSocket(): SocketState {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSharedSocket must be used within SocketProvider')
  return ctx
}
