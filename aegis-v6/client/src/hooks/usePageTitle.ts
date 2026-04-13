/**
 * File: usePageTitle.ts
 *
 * Sets document.title dynamically and restores it on unmount.
 * Format: "<page> — AEGIS Emergency Management"
 */
import { useEffect } from 'react'

const APP_NAME = 'AEGIS Emergency Management'

export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME
    return () => {
      document.title = prev
    }
  }, [title])
}
