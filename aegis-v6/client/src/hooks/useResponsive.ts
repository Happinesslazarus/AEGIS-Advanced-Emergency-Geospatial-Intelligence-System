/**
 * Module: useResponsive.ts
 *
 * useResponsive custom React hook (responsive logic).
 *
 * How it connects:
 * - Breakpoints match Tailwind CSS defaults
 * - Used by Navigation, layout components, and anywhere that adapts to screen size
 * Simple explanation:
 * Hook that tells components what screen size and device type they are on. */
import { useState, useEffect, useCallback, useMemo } from 'react'

// Tailwind CSS breakpoints (pixels) — these match the defaults in tailwind.config.js
// so responsive logic in hooks stays in sync with responsive CSS classes like `md:px-4`.
export const BREAKPOINTS = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

interface ResponsiveState {
  /** Current breakpoint name */
  breakpoint: Breakpoint
  /** Current viewport width */
  width: number
  /** Current viewport height */
  height: number
  /** True if viewport matches or exceeds breakpoint */
  isAbove: (bp: Breakpoint) => boolean
  /** True if viewport is below breakpoint */
  isBelow: (bp: Breakpoint) => boolean
  /** True if viewport matches exactly this breakpoint range */
  isExactly: (bp: Breakpoint) => boolean
  /** True if mobile (below md) */
  isMobile: boolean
  /** True if tablet (md to lg) */
  isTablet: boolean
  /** True if desktop (lg and above) */
  isDesktop: boolean
  /** True if touch device */
  isTouch: boolean
  /** Current orientation */
  orientation: 'portrait' | 'landscape'
  /** Safe area insets for notched devices */
  safeArea: {
    top: number
    right: number
    bottom: number
    left: number
  }
}

function getBreakpoint(width: number): Breakpoint {
  if (width >= BREAKPOINTS['2xl']) return '2xl'
  if (width >= BREAKPOINTS.xl) return 'xl'
  if (width >= BREAKPOINTS.lg) return 'lg'
  if (width >= BREAKPOINTS.md) return 'md'
  if (width >= BREAKPOINTS.sm) return 'sm'
  return 'xs'
}

// getSafeAreaInsets: reads CSS custom properties set by the viewport-fit=cover
// meta tag for devices with notches (iPhone X+, Android with punch-hole cameras).
// --sat / --sar / --sab / --sal = safe-area-inset-top/right/bottom/left.
// These properties are injected by a <style> in index.html using the
// env(safe-area-inset-*) CSS environment variables.
function getSafeAreaInsets(): ResponsiveState['safeArea'] {
  if (typeof window === 'undefined' || !window.CSS?.supports) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  
  const style = getComputedStyle(document.documentElement)
  return {
    top: parseInt(style.getPropertyValue('--sat') || '0', 10) || 0,
    right: parseInt(style.getPropertyValue('--sar') || '0', 10) || 0,
    bottom: parseInt(style.getPropertyValue('--sab') || '0', 10) || 0,
    left: parseInt(style.getPropertyValue('--sal') || '0', 10) || 0,
  }
}

// detectTouch: checks for touch capability using two signals:
// - `ontouchstart` property present on window (older API)
// - `maxTouchPoints > 0` (modern W3C standard)
// Neither is 100% reliable alone, but combined they catch all major devices.
function detectTouch(): boolean {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<{
    width: number
    height: number
    isTouch: boolean
    safeArea: ResponsiveState['safeArea']
  }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
    isTouch: detectTouch(),
    safeArea: getSafeAreaInsets(),
  }))
  
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    let rafId: number
    
    const handleResize = () => {
      // cancelAnimationFrame + requestAnimationFrame: throttle resize events so
      // React only re-renders once per animation frame (~16ms/60fps) even when
      // the browser fires dozens of resize events per second while the user
      // drags the window edge.
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        setState(prev => ({
          ...prev,
          width: window.innerWidth,
          height: window.innerHeight,
          safeArea: getSafeAreaInsets(),
        }))
      })
    }
    
    // `passive: true` tells the browser this listener will never call
    // `preventDefault()`, allowing it to run scroll and resize handlers
    // in a separate thread for better scroll performance.
    window.addEventListener('resize', handleResize, { passive: true })
    window.addEventListener('orientationchange', handleResize)
    
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])
  
  const breakpoint = useMemo(() => getBreakpoint(state.width), [state.width])
  
  const isAbove = useCallback((bp: Breakpoint) => {
    return state.width >= BREAKPOINTS[bp]
  }, [state.width])
  
  const isBelow = useCallback((bp: Breakpoint) => {
    return state.width < BREAKPOINTS[bp]
  }, [state.width])
  
  const isExactly = useCallback((bp: Breakpoint) => {
    const bps = Object.entries(BREAKPOINTS) as [Breakpoint, number][]
    const currentIndex = bps.findIndex(([name]) => name === bp)
    const nextBp = bps[currentIndex + 1]
    
    return state.width >= BREAKPOINTS[bp] && 
           (!nextBp || state.width < nextBp[1])
  }, [state.width])
  
  return useMemo(() => ({
    breakpoint,
    width: state.width,
    height: state.height,
    isAbove,
    isBelow,
    isExactly,
    isMobile: state.width < BREAKPOINTS.md,
    isTablet: state.width >= BREAKPOINTS.md && state.width < BREAKPOINTS.lg,
    isDesktop: state.width >= BREAKPOINTS.lg,
    isTouch: state.isTouch,
    orientation: state.width > state.height ? 'landscape' : 'portrait',
    safeArea: state.safeArea,
  }), [breakpoint, state, isAbove, isBelow, isExactly])
}

/**
 * useMediaQuery — Low-level media query hook
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })
  
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const mediaQuery = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    
    setMatches(mediaQuery.matches)
    mediaQuery.addEventListener('change', handler)
    
    return () => mediaQuery.removeEventListener('change', handler)
  }, [query])
  
  return matches
}

/**
 * useBreakpointValue — Get value based on current breakpoint
 */
export function useBreakpointValue<T>(values: Partial<Record<Breakpoint, T>>): T | undefined {
  const { breakpoint } = useResponsive()
  
  const sortedBreakpoints: Breakpoint[] = ['2xl', 'xl', 'lg', 'md', 'sm', 'xs']
  const currentIndex = sortedBreakpoints.indexOf(breakpoint)
  
  // Find the first value that's at or below current breakpoint
  for (let i = currentIndex; i < sortedBreakpoints.length; i++) {
    const bp = sortedBreakpoints[i]
    if (values[bp] !== undefined) {
      return values[bp]
    }
  }
  
  return undefined
}

export default useResponsive
