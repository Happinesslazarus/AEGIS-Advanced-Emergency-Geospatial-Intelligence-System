/**
 * hooks/useSetupStatus.ts — Fetches platform first-run status from backend
 *
 * Returns { loading, status, refetch } where status mirrors the backend
 * GET /api/admin/setup/status response.
 */

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

      // Check cache first
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

      // Cache result
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
      } catch { /* quota exceeded — ignore */ }
    } catch (err: any) {
      console.warn('[useSetupStatus]', err.message)
      setError(err.message)
      // If backend is unreachable, assume setup completed (don't block existing deployments)
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
