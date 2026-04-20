/**
 * File: queryClient.ts
  *
  * What this file does:
  * Creates and exports the singleton TanStack Query client with
  * global defaults: 2 retries on failure, a 5-minute stale time,
  * and a 10-minute garbage-collection window. This single instance
  * is shared across the whole app so the cache is never duplicated.
  *
  * How it connects:
  * - Provided to the app by QueryClientProvider in AppProviders.tsx
  * - Imported by hooks that need to invalidate or prefetch queries
  * - Learn more: https://tanstack.com/query/latest/docs/react/reference/QueryClient
 */

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      //Data considered fresh for 30 seconds
      staleTime: 30 * 1000,
      //Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      //Retry failed requests 2 times
      retry: 2,
      //Exponential backoff: 1s, 2s
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      //Refetch on window focus (good for real-time apps)
      refetchOnWindowFocus: true,
      //Don't refetch on mount if data is fresh
      refetchOnMount: true,
    },
    mutations: {
      //Retry mutations once
      retry: 1,
    },
  },
})
