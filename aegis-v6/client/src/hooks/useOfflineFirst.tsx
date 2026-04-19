/**
 * Module: useOfflineFirst.tsx
 *
 * useOfflineFirst custom React hook (offline first logic).
 *
 * - Used by React components that need this functionality */

import { useCallback, useEffect, useState, useRef } from 'react'
import { useQueryClient, QueryKey } from '@tanstack/react-query'

// Types

interface PendingOperation {
  id: string
  type: 'create' | 'update' | 'delete'
  endpoint: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  queryKey: QueryKey
  optimisticData?: unknown
  timestamp: number
  retries: number
}

interface OfflineStorage<T> {
  data: T
  timestamp: number
  queryKey: QueryKey
}

interface UseOfflineFirstOptions<T> {
  /** Query key for React Query integration */
  queryKey: QueryKey
  /** Function to fetch fresh data from API */
  queryFn: () => Promise<T>
  /** IndexedDB store name */
  storeName?: string
  /** How long cached data is considered fresh (ms) */
  staleTime?: number
  /** Whether to return stale data while revalidating */
  staleWhileRevalidate?: boolean
}

interface UseOfflineFirstResult<T> {
  /** Current data (from cache or network) */
  data: T | undefined
  /** Whether data is being fetched */
  isLoading: boolean
  /** Whether cached data is being revalidated */
  isRevalidating: boolean
  /** Whether device is online */
  isOnline: boolean
  /** Error if fetch failed */
  error: Error | null
  /** Number of pending offline operations */
  pendingCount: number
  /** Force refresh from network */
  refresh: () => Promise<void>
  /** Queue an operation for when online */
  queueOperation: (op: Omit<PendingOperation, 'id' | 'timestamp' | 'retries'>) => void
  /** Manually sync pending operations */
  syncPendingOperations: () => Promise<void>
}

// IndexedDB helpers
//
// IndexedDB = browser-side database that persists across page reloads and can
// store megabytes of structured data (arrays, objects, binary files).  Unlike
// localStorage (synchronous, string-only, ~5MB), IndexedDB is asynchronous
// and well-suited to caching large API responses for offline use.

const DB_NAME = 'aegis-offline-cache'
const DB_VERSION = 1
const CACHE_STORE = 'cache'  // stores previously fetched API responses
const QUEUE_STORE = 'queue'  // stores mutations (create/update/delete) that failed while offline

// Module-level singleton: reuse the same IDBDatabase connection across all
// useOfflineFirst hook instances so we don't open duplicate connections.
let dbInstance: IDBDatabase | null = null

async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance
  
  return new Promise((resolve, reject) => {
    // indexedDB.open() is asynchronous; it fires onsuccess when ready and
    // onupgradeneeded when the DB is brand-new or when DB_VERSION increases.
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }
    
    // onupgradeneeded: runs once on first install (or version increment).
    // This is the ONLY place we can create or alter object stores (tables).
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        // keyPath: 'key' — each cached entry is identified by a string key
        // (typically the serialised React Query query key).
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' })
      }
      
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        // keyPath: 'id' — each pending operation has a UUID for dedup.
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' })
        // Index by timestamp so we can replay operations in chronological order
        // (avoid replaying a DELETE before its own CREATE).
        store.createIndex('timestamp', 'timestamp')
      }
    }
  })
}

async function getCachedData<T>(key: string): Promise<OfflineStorage<T> | null> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CACHE_STORE, 'readonly')
    const store = transaction.objectStore(CACHE_STORE)
    const request = store.get(key)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result?.value || null)
  })
}

async function setCachedData<T>(key: string, data: OfflineStorage<T>): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CACHE_STORE, 'readwrite')
    const store = transaction.objectStore(CACHE_STORE)
    const request = store.put({ key, value: data })
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

async function getPendingOperations(): Promise<PendingOperation[]> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readonly')
    const store = transaction.objectStore(QUEUE_STORE)
    const index = store.index('timestamp')
    const request = index.getAll()
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || [])
  })
}

async function addPendingOperation(op: PendingOperation): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readwrite')
    const store = transaction.objectStore(QUEUE_STORE)
    const request = store.add(op)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

async function removePendingOperation(id: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readwrite')
    const store = transaction.objectStore(QUEUE_STORE)
    const request = store.delete(id)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Hook

export function useOfflineFirst<T>({
  queryKey,
  queryFn,
  storeName = 'default',
  staleTime = 5 * 60 * 1000, // 5 minutes
  staleWhileRevalidate = true,
}: UseOfflineFirstOptions<T>): UseOfflineFirstResult<T> {
  const queryClient = useQueryClient()
  const [data, setData] = useState<T | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [isRevalidating, setIsRevalidating] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const syncingRef = useRef(false)
  
  const cacheKey = `${storeName}:${JSON.stringify(queryKey)}`
  
  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  
  // Load cached data on mount
  useEffect(() => {
    const loadCached = async () => {
      try {
        const cached = await getCachedData<T>(cacheKey)
        
        if (cached) {
          setData(cached.data)
          setIsLoading(false)
          
          // Check if stale
          const isStale = Date.now() - cached.timestamp > staleTime
          
          if (isStale && isOnline && staleWhileRevalidate) {
            // Revalidate in background
            setIsRevalidating(true)
            try {
              const freshData = await queryFn()
              setData(freshData)
              await setCachedData(cacheKey, {
                data: freshData,
                timestamp: Date.now(),
                queryKey,
              })
              // Update React Query cache too
              queryClient.setQueryData(queryKey, freshData)
            } catch (err) {
              // Keep stale data, don't throw
              console.warn('Background revalidation failed:', err)
            } finally {
              setIsRevalidating(false)
            }
          }
        } else if (isOnline) {
          // No cache, fetch fresh
          try {
            const freshData = await queryFn()
            setData(freshData)
            await setCachedData(cacheKey, {
              data: freshData,
              timestamp: Date.now(),
              queryKey,
            })
            queryClient.setQueryData(queryKey, freshData)
          } catch (err) {
            setError(err instanceof Error ? err : new Error('Fetch failed'))
          }
          setIsLoading(false)
        } else {
          // Offline and no cache
          setIsLoading(false)
          setError(new Error('No cached data available offline'))
        }
      } catch (err) {
        console.error('Cache load error:', err)
        setIsLoading(false)
      }
    }
    
    loadCached()
  }, [cacheKey, queryKey, queryFn, staleTime, staleWhileRevalidate, isOnline, queryClient])
  
  // Update pending count
  useEffect(() => {
    const updateCount = async () => {
      const pending = await getPendingOperations()
      setPendingCount(pending.length)
    }
    updateCount()
  }, [])
  
  // Sync pending operations when coming online
  const syncPendingOperations = useCallback(async () => {
    if (syncingRef.current || !isOnline) return
    syncingRef.current = true
    
    try {
      const pending = await getPendingOperations()
      
      for (const op of pending) {
        try {
          const response = await fetch(op.endpoint, {
            method: op.method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: op.body ? JSON.stringify(op.body) : undefined,
          })
          
          if (response.ok) {
            await removePendingOperation(op.id)
            // Invalidate related queries
            queryClient.invalidateQueries({ queryKey: op.queryKey })
          } else if (op.retries < 3) {
            // Retry later
            // Could implement exponential backoff here
          } else {
            // Max retries reached, remove and notify
            await removePendingOperation(op.id)
            console.error('Operation failed after max retries:', op)
          }
        } catch (err) {
          console.error('Sync error for operation:', op.id, err)
        }
      }
      
      const remaining = await getPendingOperations()
      setPendingCount(remaining.length)
    } finally {
      syncingRef.current = false
    }
  }, [isOnline, queryClient])
  
  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline) {
      syncPendingOperations()
    }
  }, [isOnline, syncPendingOperations])
  
  // Queue an operation for offline processing
  const queueOperation = useCallback(async (
    op: Omit<PendingOperation, 'id' | 'timestamp' | 'retries'>
  ) => {
    const pendingOp: PendingOperation = {
      ...op,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      retries: 0,
    }
    
    // Apply optimistic update
    if (op.optimisticData !== undefined) {
      setData(op.optimisticData as T)
      queryClient.setQueryData(queryKey, op.optimisticData)
    }
    
    if (isOnline) {
      // Execute immediately
      try {
        const response = await fetch(op.endpoint, {
          method: op.method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: op.body ? JSON.stringify(op.body) : undefined,
        })
        
        if (!response.ok) throw new Error('Request failed')
        
        // Invalidate and refetch
        queryClient.invalidateQueries({ queryKey: op.queryKey })
      } catch {
        // Rollback optimistic update
        if (op.optimisticData !== undefined) {
          // Refetch to rollback
          queryClient.invalidateQueries({ queryKey })
        }
        throw error
      }
    } else {
      // Queue for later
      await addPendingOperation(pendingOp)
      setPendingCount(prev => prev + 1)
    }
  }, [isOnline, queryKey, queryClient, error])
  
  // Force refresh
  const refresh = useCallback(async () => {
    if (!isOnline) {
      setError(new Error('Cannot refresh while offline'))
      return
    }
    
    setIsRevalidating(true)
    setError(null)
    
    try {
      const freshData = await queryFn()
      setData(freshData)
      await setCachedData(cacheKey, {
        data: freshData,
        timestamp: Date.now(),
        queryKey,
      })
      queryClient.setQueryData(queryKey, freshData)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Refresh failed'))
    } finally {
      setIsRevalidating(false)
    }
  }, [isOnline, queryFn, cacheKey, queryKey, queryClient])
  
  return {
    data,
    isLoading,
    isRevalidating,
    isOnline,
    error,
    pendingCount,
    refresh,
    queueOperation,
    syncPendingOperations,
  }
}

/**
 * OfflineIndicatorBadge — Shows pending operation count
 */
export function OfflineIndicatorBadge({ count }: { count: number }) {
  if (count === 0) return null
  
  return (
    <span
      className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center"
      role="status"
      aria-label={`${count} pending operations`}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
