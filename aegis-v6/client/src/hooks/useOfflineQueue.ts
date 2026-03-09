/**
 * hooks/useOfflineQueue.ts — Offline-first report submission queue.
 *
 * When the user is offline, report submissions are saved to IndexedDB
 * and queued for background sync. When back online, the service worker
 * replays them automatically.
 *
 * This hook also provides manual replay for browsers without
 * Background Sync API support.
 */

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

  // Listen for service worker sync messages
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
