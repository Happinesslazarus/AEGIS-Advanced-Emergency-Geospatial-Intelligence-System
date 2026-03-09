/**
 * useAnnounce.ts — Screen reader announcements for dynamic content (#38)
 *
 * Creates an ARIA live region that screen readers pick up.
 * Usage:
 *   const announce = useAnnounce()
 *   announce('5 new messages received')
 */
import { useCallback, useEffect, useRef } from 'react'

let liveRegion: HTMLDivElement | null = null

function ensureLiveRegion(): HTMLDivElement {
  if (liveRegion && document.body.contains(liveRegion)) return liveRegion
  liveRegion = document.createElement('div')
  liveRegion.setAttribute('role', 'status')
  liveRegion.setAttribute('aria-live', 'polite')
  liveRegion.setAttribute('aria-atomic', 'true')
  Object.assign(liveRegion.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: '0',
  })
  document.body.appendChild(liveRegion)
  return liveRegion
}

export function useAnnounce() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  return useCallback((message: string, { assertive = false } = {}) => {
    const el = ensureLiveRegion()
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite')
    // Clear then set to ensure re-announcement
    el.textContent = ''
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => { el.textContent = message }, 100)
  }, [])
}
