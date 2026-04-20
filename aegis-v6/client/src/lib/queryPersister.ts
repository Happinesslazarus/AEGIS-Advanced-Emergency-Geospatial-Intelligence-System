/**
 * Persists the React Query cache to IndexedDB so previously fetched data
 * is available immediately on app restart — even when offline.
 *
 * Why IndexedDB instead of localStorage?
 * - localStorage is capped at ~5-10 MB across all keys
 * - IndexedDB gives ~50-500+ MB depending on device/browser
 * - Emergency data (alerts, reports, predictions, flood zones, map tiles)
 *   easily exceeds localStorage limits on a busy deployment
 *
 * Uses idb-keyval (1 KB wrapper) for a clean get/set/del interface.
 * Throttled to 1 write/second to avoid thrashing the IDB transaction log.
 *
 * Falls back to localStorage if IndexedDB is unavailable (rare — only in
 * very old browsers or when storage is fully locked by the user).
 */

import { get, set, del, createStore } from 'idb-keyval'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

const IDB_KEY = 'aegis-rq-cache'

// Dedicated IndexedDB store so AEGIS cache never collides with other libraries
const aegisStore = typeof window !== 'undefined'
  ? createStore('aegis-offline', 'query-cache')
  : undefined

/**
 * Custom IndexedDB-backed persister.
 * Implements the Persister interface that PersistQueryClientProvider expects:
 *   persistClient()  — serialise and write the cache to IndexedDB
 *   restoreClient()  — read the cache back on app startup
 *   removeClient()   — clear the cache (e.g. on logout)
 */
function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set(IDB_KEY, client, aegisStore)
      } catch {
        // Quota exceeded or IDB locked — silently degrade
      }
    },
    restoreClient: async () => {
      try {
        return await get<PersistedClient>(IDB_KEY, aegisStore) ?? undefined
      } catch {
        return undefined
      }
    },
    removeClient: async () => {
      try {
        await del(IDB_KEY, aegisStore)
      } catch {
        // no-op
      }
    },
  }
}

/**
 * localStorage fallback for the rare case IndexedDB is unavailable.
 */
function createLocalStorageFallback(): Persister {
  return createSyncStoragePersister({
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    key: IDB_KEY,
    throttleTime: 1_000,
    serialize: (client: PersistedClient) => JSON.stringify(client),
    deserialize: (cached: string) => JSON.parse(cached) as PersistedClient,
  })
}

/**
 * Exported persister — IndexedDB primary, localStorage fallback.
 * Consumed by PersistQueryClientProvider in AppProviders.tsx.
 */
export const queryPersister: Persister = (() => {
  if (typeof window === 'undefined') return createLocalStorageFallback()
  // Feature-detect IndexedDB
  try {
    if (window.indexedDB) return createIdbPersister()
  } catch {
    // IndexedDB blocked (e.g. Firefox private browsing pre-v115)
  }
  return createLocalStorageFallback()
})()
