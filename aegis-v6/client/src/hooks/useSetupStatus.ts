/**
 * useSetupStatus custom React hook (setup status logic).
 *
 * - Used by React components that need this functionality */

import { useState, useEffect, useCallback } from 'react'

export interface SetupStatus {
  isFirstRun: boolean
  setupCompleted: boolean
  hasAdmin: boolean
  configuredRegion: string | null
  notificationChannelsConfigured: boolean
}

const CACHE_KEY = 'aegis-setup-status'
const CACHE_TTL_MS = 60_000 // 1 minute

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      //Short-circuit with a cached result to avoid repeated API calls on every
      //page navigation.  sessionStorage is used (not localStorage) so the cache
      //automatically clears when the browser tab is closed.
      //CACHE_TTL_MS = 60 000ms = 1 minute; after that we re-fetch from the server.
      try {
        const cached = sessionStorage.getItem(CACHE_KEY)
        if (cached) {
          const { data, ts } = JSON.parse(cached)
          if (Date.now() - ts < CACHE_TTL_MS) {
            setStatus(data)
            setLoading(false)
            return
          }
        }
      } catch { /* ignore bad cache */ }

      const base = String(import.meta.env.VITE_API_BASE_URL || '')
      const res = await globalThis.fetch(`${base}/api/admin/setup/status`, {
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`Setup status check failed: HTTP ${res.status}`)
      const data: SetupStatus = await res.json()
      setStatus(data)

      //Store result with the current timestamp for TTL comparison on next load.
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
      } catch { /* quota exceeded -- ignore */ }
    } catch (err: any) {
      console.warn('[useSetupStatus]', err.message)
      setError(err.message)
      //Safe fallback: if the backend is unreachable (e.g. network down on startup),
      //assume setup is complete so we don't block existing deployments with a
      //setup wizard the admin has already finished.
      setStatus({
        isFirstRun: false,
        setupCompleted: true,
        hasAdmin: true,
        configuredRegion: null,
        notificationChannelsConfigured: false,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch_() }, [fetch_])

  const invalidateCache = useCallback(() => {
    try { sessionStorage.removeItem(CACHE_KEY) } catch {}
  }, [])

  return { loading, status, error, refetch: () => { invalidateCache(); fetch_() }, invalidateCache }
}

