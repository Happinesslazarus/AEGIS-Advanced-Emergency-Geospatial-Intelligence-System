/**
  * Creates and exports the singleton TanStack Query client with
  * offline-first defaults. The cache is persisted to localStorage
  * via queryPersister.ts so data survives page reloads and offline
  * sessions on any device (desktop, phone, tablet).
  *
  * Key offline-first settings:
  * - gcTime: 24 hours (must be >= persister maxAge)
  * - networkMode: 'offlineFirst' — fires the first request even
  *   when offline, then pauses retries until reconnected
  * - staleTime: 30s — fresh data replaces cached data quickly
  *   when the network is available
  *
  * - Provided to the app by PersistQueryClientProvider in AppProviders.tsx
  * - Imported by hooks that need to invalidate or prefetch queries
 */

import { QueryClient } from '@tanstack/react-query'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      //Data considered fresh for 30 seconds (background refetch happens after)
      staleTime: 30 * 1000,
      //Keep unused data in cache for 24 hours — must be >= persister maxAge
      //so persisted queries aren't garbage-collected before they can be restored
      gcTime: ONE_DAY_MS,
      //Fire the first request even when offline (shows persisted data if
      //available, then pauses retries until connectivity returns)
      networkMode: 'offlineFirst',
      //Retry failed requests 2 times with exponential backoff
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      //Refetch on window focus so live data is always fresh when online
      refetchOnWindowFocus: true,
      refetchOnMount: true,
    },
    mutations: {
      //Retry mutations once; offline queue in SW handles the rest
      retry: 1,
      networkMode: 'offlineFirst',
    },
  },
})
