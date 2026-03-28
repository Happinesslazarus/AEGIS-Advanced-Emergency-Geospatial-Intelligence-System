/**
 * hooks/useOnlineStatus.ts — Reactive online/offline status with SW queue count.
 *
 * Listens to the browser online/offline events and periodically queries
 * the service worker for the number of queued (offline) requests.
 */

import { useState, useEffect, useCallback } from 'react'

export interface OnlineStatus {
  isOnline: boolean
  queuedRequests: number
  /* Force-sync the offline queue via the service worker. */
  syncNow: () => void
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queuedRequests, setQueuedRequests] = useState(0)

  // Track online/offline
  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Query SW for queued requests
  useEffect(() => {
    let cancelled = false

    const queryQueue = async () => {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
      try {
        const mc = new MessageChannel()
        mc.port1.onmessage = (e) => {
          if (!cancelled && typeof e.data?.count === 'number') {
            setQueuedRequests(e.data.count)
          }
        }
        navigator.serviceWorker.controller.postMessage(
          { type: 'GET_QUEUE_STATUS' },
          [mc.port2],
        )
      } catch {
        // SW not available
      }
    }

    queryQueue()
    const interval = setInterval(queryQueue, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isOnline])

  const syncNow = useCallback(() => {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        ;(reg as any).sync?.register('aegis-offline-sync').catch(() => {})
      })
    }
  }, [])

  return { isOnline, queuedRequests, syncNow }
}
