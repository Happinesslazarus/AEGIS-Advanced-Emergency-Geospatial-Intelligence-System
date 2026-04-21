/**
 * useAsync -- the single source of truth for "fetch some data, show loading,
 * show error, refresh on demand" in AEGIS.
 *
 * Replaces the classic boilerplate:
 *   const [data, setData] = useState<T | null>(null)
 *   const [loading, setLoading] = useState(true)
 *   const [error,   setError]   = useState<Error | null>(null)
 *   useEffect(() => { fetch(...).then(setData).catch(setError).finally(...) }, [...])
 *
 * Usage:
 *   const { data, loading, error, refresh } = useAsync(
 *     ({ signal }) => fetch('/api/dashboard', { signal }).then(r => r.json()),
 *     [region],
 *   )
 *
 *   const reports = useApiResource<Report[]>('/api/reports')
 *
 * Every active request gets an AbortController so stale results never
 * overwrite fresh ones, and unmount cancels in-flight work cleanly.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { getAnyToken } from '../utils/api'

export interface UseAsyncResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refresh: () => void
}

export interface UseAsyncOptions {
  /** Skip the initial fetch (useful when a dependency isn't ready yet). */
  skip?: boolean
  /** Re-run on this interval (ms). Pass 0 / undefined to disable. */
  pollMs?: number
}

/**
 * Run an async producer; expose data/loading/error and a refresh trigger.
 * The producer receives an AbortSignal -- pass it to fetch() to cancel
 * stale requests on rerun/unmount.
 */
export function useAsync<T>(
  producer: (ctx: { signal: AbortSignal }) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: UseAsyncOptions = {},
): UseAsyncResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!options.skip)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  const producerRef = useRef(producer)
  producerRef.current = producer

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (options.skip) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    producerRef.current({ signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if ((err as { name?: string })?.name === 'AbortError') return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, options.skip])

  // Polling
  useEffect(() => {
    if (!options.pollMs || options.pollMs <= 0) return
    const id = setInterval(refresh, options.pollMs)
    return () => clearInterval(id)
  }, [options.pollMs, refresh])

  return { data, loading, error, refresh }
}

/**
 * Convenience wrapper around useAsync for plain JSON GET endpoints with
 * AEGIS auth + 401/403/404-as-null semantics. Replaces the `safeFetch`
 * helper duplicated in 15+ components.
 */
export function useApiResource<T>(
  url: string | null,
  options: UseAsyncOptions & { auth?: boolean } = {},
): UseAsyncResult<T> {
  const { auth = true, ...rest } = options
  return useAsync<T>(
    async ({ signal }) => {
      if (!url) return null as unknown as T
      const headers: Record<string, string> = {}
      if (auth) {
        const token = getAnyToken()
        if (token) headers.Authorization = `Bearer ${token}`
      }
      const res = await fetch(url, { signal, headers })
      // Treat soft auth/availability failures as "no data" rather than errors.
      if ([401, 403, 404].includes(res.status)) return null as unknown as T
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      return (await res.json()) as T
    },
    [url],
    { ...rest, skip: rest.skip ?? !url },
  )
}
