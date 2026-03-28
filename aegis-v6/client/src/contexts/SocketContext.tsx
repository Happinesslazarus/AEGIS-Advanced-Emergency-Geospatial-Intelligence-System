import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react'
import { useSocket, type SocketState } from '../hooks/useSocket'
import { getToken } from '../utils/api'

const SocketContext = createContext<SocketState | null>(null)

function getPersistedToken(): string | null {
  const path = window.location.pathname
  // On citizen pages, prefer the citizen token; on admin pages, prefer the admin token
  if (path.startsWith('/citizen')) {
    return localStorage.getItem('aegis-citizen-token') || getToken()
  }
  if (path.startsWith('/admin')) {
    return getToken()
  }
  return localStorage.getItem('aegis-citizen-token')
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

  // Listen for citizen auth changes (login/logout) and reconnect the socket
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

/** Trigger socket reconnection after citizen login/logout (same-tab) */
export function notifySocketAuthChange(): void {
  // Dispatch a storage event manually for same-tab listeners
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'aegis-citizen-token',
    newValue: localStorage.getItem('aegis-citizen-token'),
  }))
}

export function useSharedSocket(): SocketState {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSharedSocket must be used within SocketProvider')
  return ctx
}
