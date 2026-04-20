/**
 * File: useFormAutosave.ts
 *
 * Persists form state to IndexedDB so drafts survive page refreshes.
 * Uses a debounced write (500ms) to avoid hammering IDB on every keystroke.
 *
 * Usage:
 *   const { restore, clear } = useFormAutosave('report-form', formState)
 *   // On mount: const saved = await restore(); if (saved) setForm(saved)
 *   // On submit success: clear()
 */
import { useEffect, useRef, useCallback } from 'react'

const DB_NAME = 'aegis-autosave'
const DB_VERSION = 1
const STORE_NAME = 'drafts'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve(req.result?.value ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

async function dbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).put({ key, value, savedAt: Date.now() })
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    //Fail silently -- autosave is best-effort
  }
}

async function dbDelete(key: string): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
    })
  } catch {
    //Fail silently
  }
}

export function useFormAutosave<T extends object>(formKey: string, formState: T) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)

  //Debounced save on state change (skip first render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      dbSet(formKey, formState)
    }, 500)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [formKey, formState])

  const restore = useCallback((): Promise<T | null> => {
    return dbGet<T>(formKey)
  }, [formKey])

  const clear = useCallback((): void => {
    dbDelete(formKey)
  }, [formKey])

  return { restore, clear }
}
