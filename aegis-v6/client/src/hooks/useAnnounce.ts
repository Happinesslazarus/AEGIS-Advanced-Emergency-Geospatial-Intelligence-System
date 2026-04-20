/**
 * useAnnounce custom React hook (announce logic).
 *
 * - Used by React components that need this functionality */

import { useCallback, useEffect, useRef } from 'react'

//Module-level singleton: only one live region is ever added to the DOM
//regardless of how many components call useAnnounce().  We keep a reference
//and re-use it -- or rebuild it if it was accidentally removed from the DOM.
let liveRegion: HTMLDivElement | null = null

//ensureLiveRegion: creates (or returns an existing) ARIA live region.
//A "live region" (role="status" + aria-live="polite") is a special DOM node
//that screen readers (VoiceOver, NVDA, JAWS) watch automatically.  Whenever
//its text content changes, the screen reader reads it aloud to the user.
function ensureLiveRegion(): HTMLDivElement {
  if (liveRegion && document.body.contains(liveRegion)) return liveRegion
  liveRegion = document.createElement('div')
  liveRegion.setAttribute('role', 'status')         // tells AT this is a status message
  liveRegion.setAttribute('aria-live', 'polite')    // 'polite' = wait for user to finish reading
  liveRegion.setAttribute('aria-atomic', 'true')    // read the whole region, not just the changed part
  //Visually hidden technique: makes the element invisible on screen but still
  //present in the accessibility tree.  'display:none' would hide it from AT too.
  Object.assign(liveRegion.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',  // legacy clip for older browsers
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
    // 'assertive' interrupts the user immediately (e.g. for critical errors).
    // 'polite' waits for the user to finish reading before announcing.
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite')
    //Clear then set pattern: some screen readers only announce text that
    // *changes*.  If we set the same message twice, clearing first guarantees
    //the change is detected.  The 100 ms gap gives the AT time to register
    //the empty state before the new message arrives.
    el.textContent = ''
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => { el.textContent = message }, 100)
  }, [])
}

