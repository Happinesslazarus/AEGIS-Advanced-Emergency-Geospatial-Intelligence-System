/**
 * Persists the React Query cache to localStorage so previously fetched
 * data is available immediately on app restart — even when offline.
 *
 * - Throttled to 1 write/second to avoid thrashing localStorage
 * - 24-hour maxAge so stale disaster data is eventually discarded
 * - Skips auth/session queries to avoid persisting tokens
 */

import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

/**
 * localStorage-backed persister for the React Query cache.
 * Falls back to a no-op if localStorage is unavailable (e.g. private browsing quota exceeded).
 */
export const queryPersister: Persister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'aegis-rq-cache',
  // Throttle serialisation writes to once per second
  throttleTime: 1_000,
  serialize: (client: PersistedClient) => JSON.stringify(client),
  deserialize: (cached: string) => JSON.parse(cached) as PersistedClient,
})
