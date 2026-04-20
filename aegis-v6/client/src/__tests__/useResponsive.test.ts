/**
 * Tests for the useResponsive hook and related utilities, which expose the
 * current viewport size, breakpoint name, device type, and orientation so
 * components can adapt their layout without relying on CSS media queries alone.
 *
 * Glossary:
 *   describe()                = groups related tests under a labelled block
 *   test()                    = a single scenario with one expected outcome
 *   vi.resetAllMocks()        = resets call counts and implementations on all mocks
 *   vi.fn()                   = creates a mock (fake) function that records calls
 *   renderHook()              = mounts a React hook in a minimal test component; returns { result }
 *   act()                     = flushes React state updates so assertions run after renders settle
 *   Object.defineProperty()   = injects a custom value (like window.innerWidth) into the test env;
 *                               Node.js doesn't have a real browser window, so we fake dimensions
 *   writable: true            = allows the property to be reassigned (needed to restore originals)
 *   configurable: true        = allows the property descriptor itself to be changed again later
 *   window.innerWidth         = the browser viewport's current width in CSS pixels
 *   window.innerHeight        = the browser viewport's current height in CSS pixels
 *   breakpoint                = a named width threshold at which layout changes; mirrors Tailwind:
 *                               xs=0px, sm=640px, md=768px, lg=1024px, xl=1280px, 2xl=1536px
 *   isAbove(bp)               = true if the viewport is at or wider than the named breakpoint
 *   isBelow(bp)               = true if the viewport is narrower than the named breakpoint
 *   isExactly(bp)             = true if the viewport falls within the named breakpoint's range
 *   isMobile                  = viewport is narrower than the tablet threshold (typically < 768px)
 *   isTablet                  = viewport is within tablet range (768px–1023px)
 *   isDesktop                 = viewport is 1024px or wider
 *   orientation               = "landscape" when width > height; "portrait" otherwise
 *   safe area                 = insets used on notched phones (iPhone X+) to avoid content being
 *                               hidden behind hardware cutouts; env(safe-area-inset-*) in CSS
 *   isTouch                   = true when the device supports touch input
 *   window.matchMedia()       = browser API that accepts a CSS media query string and returns
 *                               a MediaQueryList; used inside useMediaQuery hook
 *   MediaQueryList            = object with .matches (bool) and change event listeners
 *   addEventListener('change')= fires when the media-query match state changes
 *   BREAKPOINTS               = exported JS object mirroring Tailwind's default breakpoint map
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResponsive, useMediaQuery, BREAKPOINTS } from '../hooks/useResponsive'

describe('useResponsive', () => {
  // Save original dimensions so we can restore them after each test
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  beforeEach(() => {
    vi.resetAllMocks() // clear mock state before each scenario
  })

  afterEach(() => {
    // Restore the real window dimensions so later tests aren't affected
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    })
  })

  // Helper: injects a fake viewport size into the test environment
  function setViewport(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,   // pixels wide
    })
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: height,  // pixels tall
    })
  }

  describe('breakpoint detection', () => {
    test('detects xs breakpoint (< 640px)', () => {
      setViewport(400, 800) // 400px wide — below the 640px sm threshold
      const { result } = renderHook(() => useResponsive())
      expect(result.current.breakpoint).toBe('xs')
    })

    test('detects sm breakpoint (640-767px)', () => {
      setViewport(640, 800) // exactly at the sm boundary (640px)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.breakpoint).toBe('sm')
    })

    test('detects md breakpoint (768-1023px)', () => {
      setViewport(768, 800)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.breakpoint).toBe('md')
    })

    test('detects lg breakpoint (1024-1279px)', () => {
      setViewport(1024, 800)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.breakpoint).toBe('lg')
    })

    test('detects xl breakpoint (1280-1535px)', () => {
      setViewport(1280, 800)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.breakpoint).toBe('xl')
    })

    test('detects 2xl breakpoint (>= 1536px)', () => {
      setViewport(1536, 800)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.breakpoint).toBe('2xl')
    })
  })

  describe('isAbove', () => {
    test('returns true when viewport is at or above breakpoint', () => {
      setViewport(1024, 800)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isAbove('xs')).toBe(true)
      expect(result.current.isAbove('sm')).toBe(true)
      expect(result.current.isAbove('md')).toBe(true)
      expect(result.current.isAbove('lg')).toBe(true)
      expect(result.current.isAbove('xl')).toBe(false)
    })

    test('returns false when viewport is below breakpoint', () => {
      setViewport(500, 800)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isAbove('sm')).toBe(false)
      expect(result.current.isAbove('md')).toBe(false)
    })
  })

  describe('isBelow', () => {
    test('returns true when viewport is below breakpoint', () => {
      setViewport(500, 800)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isBelow('sm')).toBe(true)
      expect(result.current.isBelow('md')).toBe(true)
      expect(result.current.isBelow('lg')).toBe(true)
    })

    test('returns false when viewport is at or above breakpoint', () => {
      setViewport(1024, 800)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isBelow('lg')).toBe(false)
      expect(result.current.isBelow('md')).toBe(false)
    })
  })

  describe('isExactly', () => {
    test('returns true for exact breakpoint range', () => {
      setViewport(800, 600) // md range: 768-1023
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isExactly('md')).toBe(true)
      expect(result.current.isExactly('sm')).toBe(false)
      expect(result.current.isExactly('lg')).toBe(false)
    })

    test('returns true at breakpoint boundary', () => {
      setViewport(768, 600)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isExactly('md')).toBe(true)
    })
  })

  describe('device flags', () => {
    test('isMobile is true for small viewports', () => {
      // Phones typically have viewports under 768px wide
      setViewport(500, 800)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isMobile).toBe(true)
      expect(result.current.isTablet).toBe(false)
      expect(result.current.isDesktop).toBe(false)
    })

    test('isTablet is true for medium viewports', () => {
      // Tablets typically have viewports in the 768px-1023px range
      setViewport(800, 600)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isMobile).toBe(false)
      expect(result.current.isTablet).toBe(true)
      expect(result.current.isDesktop).toBe(false)
    })

    test('isDesktop is true for large viewports', () => {
      // Desktops/laptops are typically 1024px wide or wider
      setViewport(1200, 800)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.isMobile).toBe(false)
      expect(result.current.isTablet).toBe(false)
      expect(result.current.isDesktop).toBe(true)
    })
  })

  describe('orientation', () => {
    test('detects landscape orientation', () => {
      // landscape = width > height
      setViewport(1200, 800)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.orientation).toBe('landscape')
    })

    test('detects portrait orientation', () => {
      // portrait = height >= width (phone held upright)
      setViewport(800, 1200)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.orientation).toBe('portrait')
    })

    test('square viewport is portrait', () => {
      // When width === height the hook ties-break to portrait
      setViewport(800, 800)
      const { result } = renderHook(() => useResponsive())
      expect(result.current.orientation).toBe('portrait')
    })
  })

  describe('dimensions', () => {
    test('tracks width and height', () => {
      setViewport(1280, 720)
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.width).toBe(1280)
      expect(result.current.height).toBe(720)
    })
  })

  describe('safe area', () => {
    test('returns safe area insets object', () => {
      // safe area = physical screen regions blocked by notch/home bar on modern phones;
      // the hook exposes top/right/bottom/left insets so components can add padding
      const { result } = renderHook(() => useResponsive())
      
      expect(result.current.safeArea).toHaveProperty('top')
      expect(result.current.safeArea).toHaveProperty('right')
      expect(result.current.safeArea).toHaveProperty('bottom')
      expect(result.current.safeArea).toHaveProperty('left')
    })

    test('safe area values are numbers', () => {
      const { result } = renderHook(() => useResponsive())
      
      expect(typeof result.current.safeArea.top).toBe('number')
      expect(typeof result.current.safeArea.right).toBe('number')
      expect(typeof result.current.safeArea.bottom).toBe('number')
      expect(typeof result.current.safeArea.left).toBe('number')
    })
  })

  describe('touch detection', () => {
    test('isTouch is a boolean', () => {
      const { result } = renderHook(() => useResponsive())
      expect(typeof result.current.isTouch).toBe('boolean')
    })
  })
})

describe('useMediaQuery', () => {
  // Minimal MediaQueryList stub — Node.js has no real matchMedia
  const mockMediaQueryList = {
    matches: false,                    // current match state
    addEventListener: vi.fn(),         // subscribe to query changes
    removeEventListener: vi.fn(),      // unsubscribe on cleanup
  }

  beforeEach(() => {
    vi.resetAllMocks()
    // Replace window.matchMedia with a factory that returns our stub plus the query string
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      ...mockMediaQueryList,
      media: query, // echo the query back so the hook can read it
    }))
  })

  test('returns initial match state', () => {
    // Override: make matchMedia report the query matches
    ;(window.matchMedia as any).mockReturnValue({
      ...mockMediaQueryList,
      matches: true, // (min-width: 768px) matches at simulated viewport width
    })

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(true)
  })

  test('returns false when query does not match', () => {
    ;(window.matchMedia as any).mockReturnValue({
      ...mockMediaQueryList,
      matches: false,
    })

    const { result } = renderHook(() => useMediaQuery('(max-width: 320px)'))
    expect(result.current).toBe(false)
  })

  test('adds event listener for changes', () => {
    // The hook must call addEventListener('change', ...) so it re-evaluates
    // when the user resizes the window across the media-query boundary
    renderHook(() => useMediaQuery('(min-width: 768px)'))
    
    expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function) // the internal handler; we don't need its exact reference
    )
  })

  test('removes event listener on unmount', () => {
    // On unmount the hook must call removeEventListener to prevent memory leaks
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    
    unmount() // trigger the useEffect cleanup
    
    expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )
  })
})

describe('BREAKPOINTS constant', () => {
  test('has expected breakpoint values', () => {
    // These pixel values mirror Tailwind CSS's default responsive breakpoints
    // xs=0 sm=640 md=768 lg=1024 xl=1280 2xl=1536  (all in CSS pixels)
    expect(BREAKPOINTS.xs).toBe(0)      // extra-small: any width (starting point)
    expect(BREAKPOINTS.sm).toBe(640)    // small: phablets and large phones landscape
    expect(BREAKPOINTS.md).toBe(768)    // medium: tablets
    expect(BREAKPOINTS.lg).toBe(1024)   // large: small laptops
    expect(BREAKPOINTS.xl).toBe(1280)   // extra-large: standard desktops
    expect(BREAKPOINTS['2xl']).toBe(1536) // 2x extra-large: wide monitors
  })

  test('breakpoints are in ascending order', () => {
    // Sanity check: every breakpoint must be wider than the previous one
    const values = Object.values(BREAKPOINTS)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })
})
