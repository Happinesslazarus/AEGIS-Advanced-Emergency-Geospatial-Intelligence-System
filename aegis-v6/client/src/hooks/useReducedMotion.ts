/**
 * useReducedMotion custom React hook (reduced motion logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useEffect } from 'react'

interface ReducedMotionState {
  /** True if user prefers reduced motion */
  prefersReduced: boolean
  /** Get safe animation duration (0 if reduced motion) */
  getSafeDuration: (defaultMs: number) => number
  /** Get safe transition */
  getSafeTransition: (defaultTransition: string) => string
}

export function useReducedMotion(): ReducedMotionState {
  const [prefersReduced, setPrefersReduced] = useState(() => {
    // SSR guard: `window` does not exist in Node.js (e.g. server-side rendering).
    // We default to `false` (animations allowed) so the first paint on the server
    // never crashes, and the real value is read on the client after hydration.
    if (typeof window === 'undefined') return false
    // `prefers-reduced-motion: reduce` is a CSS media query that the OS sets
    // when the user enables "Reduce Motion" in their accessibility settings
    // (System Preferences on macOS/iOS, Settings on Windows/Android).
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    
    // MediaQueryListEvent fires when the user changes their OS motion setting
    // at runtime (e.g. toggles the switch while the app is open), so we update
    // React state immediately without needing a page refresh.
    const handler = (event: MediaQueryListEvent) => {
      setPrefersReduced(event.matches)
    }
    
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])
  
  return {
    prefersReduced,
    // getSafeDuration: return 0 when reduced motion is on so CSS transitions
    // happen instantly (no visible animation), otherwise use the provided ms value.
    getSafeDuration: (defaultMs: number) => prefersReduced ? 0 : defaultMs,
    // getSafeTransition: 'none' disables all CSS transitions for reduced-motion users.
    getSafeTransition: (defaultTransition: string) => 
      prefersReduced ? 'none' : defaultTransition,
  }
}

export default useReducedMotion
