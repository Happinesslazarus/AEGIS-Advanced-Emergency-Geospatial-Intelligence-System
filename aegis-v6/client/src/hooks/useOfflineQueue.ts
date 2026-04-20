/**
 * useOfflineQueue custom React hook (offline queue logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useEffect, useCallback } from 'react'

interface QueuedRequest {
  id?: number
  url: string
  method: string
  body: string
  headers: Record<string, string>
  timestamp: number
}

interface OfflineQueueState {
  isOnline: boolean
  queueCount: number
  queue: QueuedRequest[]
  enqueue: (url: string, method: string, body: string, headers?: Record<string, string>) => Promise<void>
  replayAll: () => Promise<{ success: number; failed: number }>
  clearQueue: () => void
}

export function useOfflineQueue(): OfflineQueueState {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queue, setQueue] = useState<QueuedRequest[]>([])

  // Track online/offline status
  useEffect(() => {
  // When connectivity returns, immediately tell the service worker to trim
  // any stale caches (removes old precached assets that may have expired).
  const goOnline = () => {
      setIsOnline(true)
      // Trigger sync on reconnect
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'TRIM_CACHES' })
      }
    }
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Listen for messages coming FROM the service worker back to this page.
  // SYNC_SUCCESS = the SW successfully replayed a queued request, remove it from our local list.
  // QUEUE_STATUS = the SW reports its full queue (e.g. on page load so our state stays in sync).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_SUCCESS') {
        setQueue(prev => prev.filter(item => item.id !== event.data.id))
      }
      if (event.data?.type === 'QUEUE_STATUS') {
        setQueue(event.data.items || [])
      }
    }

    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [])

  // Request queue status on mount
  useEffect(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'GET_QUEUE_STATUS' })
    }
  }, [])

  const enqueue = useCallback(async (url: string, method: string, body: string, headers?: Record<string, string>) => {
    const entry: QueuedRequest = {
      url,
      method,
      body,
      headers: headers || { 'Content-Type': 'application/json' },
      timestamp: Date.now(),
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'QUEUE_REQUEST',
        ...entry,
      })
    }

    setQueue(prev => [...prev, entry])
  }, [])

  // replayAll: manually retry every queued request in order.
  // This is the fallback path when Background Sync is not available —
  // we just fire the requests directly from the browser tab.
  const replayAll = useCallback(async (): Promise<{ success: number; failed: number }> => {
    let success = 0
    let failed = 0

    for (const item of queue) {
      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        })
        if (response.ok) {
          success++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }

    if (success > 0) {
      // Clear successfully replayed items
      setQueue(prev => prev.slice(success))
    }

    return { success, failed }
  }, [queue])

  const clearQueue = useCallback(() => {
    setQueue([])
  }, [])

  return {
    isOnline,
    queueCount: queue.length,
    queue,
    enqueue,
    replayAll,
    clearQueue,
  }
}

