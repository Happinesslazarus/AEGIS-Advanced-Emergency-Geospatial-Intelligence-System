/**
 * useOnlineStatus custom React hook (online status logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useEffect, useCallback } from 'react'

export interface OnlineStatus {
  isOnline: boolean
  queuedRequests: number
  /* Force-sync the offline queue via the service worker. */
  syncNow: () => void
}

export function useOnlineStatus(): OnlineStatus {
  // `navigator.onLine` returns true when the browser believes it has internet
  // access. It can be wrong (connected to a router with no real internet)
  // but is good enough for the initial rendered state.
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  // Number of API requests sitting in the service worker's IndexedDB queue
  // waiting to be replayed once the connection comes back.
  const [queuedRequests, setQueuedRequests] = useState(0)

  // Subscribe to the browser's network events.  'online' fires when the browser
  // regains connectivity; 'offline' fires when it loses it.
  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      // Remove listeners on unmount so we don't call setState on a dead component.
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Poll the service worker every 10 seconds to find out how many requests
  // are sitting in the offline queue.  We re-run this effect whenever the
  // online status changes so we get an immediate count after reconnecting.
  useEffect(() => {
    // `cancelled` flag prevents stale postMessage replies from updating state
    // after this effect has been cleaned up.
    let cancelled = false

    const queryQueue = async () => {
      // Service workers are only available in secure contexts (HTTPS / localhost).
      // `controller` is null if no SW is currently controlling this page.
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
      try {
        // MessageChannel gives the SW a private port to reply on without
        // broadcasting the response to all listeners (port1 = our end,
        // port2 = SW end — we transfer port2 in the postMessage call).
        const mc = new MessageChannel()
        mc.port1.onmessage = (e) => {
          if (!cancelled && typeof e.data?.count === 'number') {
            setQueuedRequests(e.data.count)
          }
        }
        navigator.serviceWorker.controller.postMessage(
          { type: 'GET_QUEUE_STATUS' },
          [mc.port2], // transfer ownership of port2 to the service worker
        )
      } catch {
        // SW not available
      }
    }

    queryQueue()
    // 10,000 ms = 10 seconds — a reasonable poll rate for offline queue UI,
    // not so fast that it hammers the service worker messaging channel.
    const interval = setInterval(queryQueue, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isOnline])

  // syncNow uses the Background Sync API — a browser feature (SyncManager)
  // that lets a service worker retry requests when internet comes back, even
  // if the tab is closed.  We register a tag ('aegis-offline-sync') that the
  // service worker listens for to know it should flush its queue.
  const syncNow = useCallback(() => {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        // `reg.sync` is typed as `any` because TypeScript's lib.dom.d.ts doesn't
        // fully type the Background Sync extension API yet.
        ;(reg as any).sync?.register('aegis-offline-sync').catch(() => {})
      })
    }
  }, [])

  return { isOnline, queuedRequests, syncNow }
}

