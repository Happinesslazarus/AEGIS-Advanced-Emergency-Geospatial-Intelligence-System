/**
 * Eagerly prefetches critical safety data into the React Query cache on
 * first app load — so it's available offline even if the user never
 * navigated to the corresponding pages.
 *
 * What gets prefetched (in order of priority):
 *   1. Active alerts   — citizens need to see active warnings offline
 *   2. Reports         — recent incidents near the user
 *   3. AI predictions  — hazard forecasts for the next 24-72 hours
 *   4. Heatmap data    — spatial density of incidents
 *
 * Runs once per session (tracked by a ref), with staggered delays so the
 * initial page load is never blocked. Each prefetch fires only if the
 * query isn't already in the cache (i.e. the user hasn't visited that page
 * yet this session).
 *
 * Consumed by App.tsx (or any top-level component) to warm the cache:
 *   useOfflinePrefetch()   // no args, no return value — fire and forget
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiGetAlerts, apiGetReports, apiGetPredictions, apiGetHeatmapData } from '../utils/api'

const queryKeys = {
  alerts: ['alerts'] as const,
  reports: ['reports'] as const,
  predictions: ['predictions'] as const,
  heatmap: ['heatmap'] as const,
}

/**
 * Prefetch critical emergency data so the offline cache is warm.
 * Safe to call from any component — runs at most once per mount.
 */
export function useOfflinePrefetch(): void {
  const qc = useQueryClient()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    // Stagger prefetches so we don't fire 4 parallel API calls on page load
    // and starve the main thread / first-paint resources.
    // Each is typed individually to satisfy TanStack Query's strict generics.

    const timers: ReturnType<typeof setTimeout>[] = []

    const prefetchIfMissing = <T,>(
      key: readonly string[],
      fn: () => Promise<T>,
      delayMs: number,
    ) => {
      timers.push(
        setTimeout(() => {
          if (!qc.getQueryData(key)) {
            qc.prefetchQuery({
              queryKey: key,
              queryFn: fn,
              staleTime: 5 * 60 * 1000,
            }).catch(() => {})
          }
        }, delayMs)
      )
    }

    prefetchIfMissing(queryKeys.alerts,      apiGetAlerts,      2_000)
    prefetchIfMissing(queryKeys.reports,     apiGetReports,     4_000)
    prefetchIfMissing(queryKeys.predictions, apiGetPredictions, 6_000)
    prefetchIfMissing(queryKeys.heatmap,     apiGetHeatmapData, 8_000)

    return () => timers.forEach(clearTimeout)
  }, [qc])
}
