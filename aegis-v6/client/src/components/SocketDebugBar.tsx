/*
 * SocketDebugBar.tsx - Temporary debug UI for socket transport validation
 * 
 * Shows:
 * Socket connection status (live vs failed)
 * User role (citizen/operator/admin)
 * Thread count (messages available)
 * Socket URL being used
 * 
 * Remove this component after confirming transport is working reliably.
 */

import { useCallback } from 'react'
import { useSharedSocket } from '../contexts/SocketContext'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { getSession } from '../utils/auth'

function getSocketUrl(): string {
  // Use window.location.origin so Socket.IO connects to the same origin as the page
  const API_BASE = ''
  if (typeof window === 'undefined') return API_BASE || 'http://localhost:3001'
  if (API_BASE.startsWith('/')) return window.location.origin

  try {
    const parsed = new URL(API_BASE)
    parsed.pathname = parsed.pathname.replace(/\/api\/?$/, '/')
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return API_BASE
  }
}

export default function SocketDebugBar(): JSX.Element {
  const socket = useSharedSocket()
  const { user: citizenUser } = useCitizenAuth()
  const adminUser = getSession()
  
  const user = citizenUser || adminUser
  const role = citizenUser?.role || adminUser?.role || 'unknown'
  const threadCount = socket.threads?.length || 0
  const socketUrl = getSocketUrl()

  return (
    <div className="fixed bottom-0 left-0 right-0 h-10 bg-gray-900 border-t border-gray-700 text-xs text-gray-300 dark:text-gray-300 flex items-center justify-between px-4 z-40 font-mono">
      <div className="flex items-center gap-6">
        {/* Connection Status */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${socket.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-gray-400 dark:text-gray-300">Socket:</span>
          <span className={socket.connected ? 'text-green-400' : 'text-red-400'}>
            {socket.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* User Role */}
        <div className="flex items-center gap-2">
          <span className="text-gray-400 dark:text-gray-300">Role:</span>
          <span className="text-blue-300">{role}</span>
        </div>

        {/* Thread Count */}
        <div className="flex items-center gap-2">
          <span className="text-gray-400 dark:text-gray-300">Threads:</span>
          <span className="text-yellow-300">{threadCount}</span>
        </div>

        {/* User Name */}
        {user?.displayName && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 dark:text-gray-300">User:</span>
            <span className="text-purple-300">{user.displayName}</span>
          </div>
        )}
      </div>

      {/* Socket URL (right side) */}
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-300">
        <span>URL:</span>
        <span className="text-gray-400 dark:text-gray-300 max-w-xs truncate">{socketUrl}</span>
      </div>
    </div>
  )
}
