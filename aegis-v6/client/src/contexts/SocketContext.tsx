import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useSocket, type SocketState } from '../hooks/useSocket'

const SocketContext = createContext<SocketState | null>(null)

function getPersistedToken(): string | null {
  const path = window.location.pathname
  // On citizen pages, prefer the citizen token; on admin pages, prefer the admin token
  if (path.startsWith('/citizen')) {
    return localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')
  }
  if (path.startsWith('/admin')) {
    return localStorage.getItem('aegis-token') || localStorage.getItem('token')
  }
  return localStorage.getItem('aegis-citizen-token')
    || localStorage.getItem('aegis-token')
    || localStorage.getItem('token')
}

export function SocketProvider({ children }: { children: ReactNode }): JSX.Element {
  const socketState = useSocket()

  useEffect(() => {
    const token = getPersistedToken()
    if (token && !socketState.connected) {
      socketState.connect(token)
    }
  }, [socketState.connected, socketState.connect])

  useEffect(() => {
    return () => {
      socketState.disconnect()
    }
  }, [socketState.disconnect])

  return <SocketContext.Provider value={socketState}>{children}</SocketContext.Provider>
}

export function useSharedSocket(): SocketState {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSharedSocket must be used within SocketProvider')
  return ctx
}
