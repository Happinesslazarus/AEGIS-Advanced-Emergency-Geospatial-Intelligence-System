/**
 * Module: SocketContext.tsx
 *
 * Socket context React context provider (shares state across components).
 *
 * How it connects:
 * - Wraps components in App.tsx via AppProviders */

import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react'
import { useSocket, type SocketState } from '../hooks/useSocket'
import { getToken } from '../utils/api'
import { getCitizenToken } from './CitizenAuthContext'

const SocketContext = createContext<SocketState | null>(null)

function getPersistedToken(): string | null {
  const path = window.location.pathname
  // Route-based token selection: citizen and admin sessions use different
  // JWT tokens (different scopes).  We pick the right one based on the active
  // URL so a citizen and an admin can share the same browser without one
  // token overwriting the other.
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

  // Connect on mount and whenever the socket disconnects
  useEffect(() => {
    const token = getPersistedToken()
    if (token && !socketState.connected) {
      socketState.connect(token)
    }
  }, [socketState.connected, socketState.connect])

  // Cross-tab login sync: `storage` event fires in OTHER tabs when
  // localStorage changes.  This lets a citizen who logs in on Tab A get a
  // real-time Socket.IO connection on Tab B without a page refresh.
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

  useEffect(() => {
    return () => {
      socketState.disconnect()
    }
  }, [socketState.disconnect])

  return <SocketContext.Provider value={socketState}>{children}</SocketContext.Provider>
}

/** Trigger socket reconnection after citizen login/logout (same-tab).
 *  The `storage` event only fires in OTHER tabs by default.  This function
 *  manually dispatches a StorageEvent on THIS tab so same-tab login/logout
 *  triggers the listener above and reconnects the socket immediately.
 */
export function notifySocketAuthChange(): void {
  // Dispatch a storage event manually for same-tab listeners
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
