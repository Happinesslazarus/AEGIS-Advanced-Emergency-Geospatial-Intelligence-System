/**
 * Use reduced motion test suite (automated tests for this feature).
 *
 * Glossary:
 *   prefers-reduced-motion    = CSS media feature reflecting the user's OS
 *                               accessibility setting to reduce visual motion.
 *   window.matchMedia()       = browser API that queries CSS media features.
 *                               We mock it because Node.js has no CSS engine.
 *   MediaQueryListEvent       = event fired when a media query's match state
 *                               changes (e.g. user toggles the OS setting).
 *   vi.fn()                   = spy function that records calls and lets us
 *                               configure what it returns.
 *   mockMediaQueryListeners   = stores the listeners the hook passed to
 *                               addEventListener so tests can fire them
 *                               manually to simulate OS preference changes.
 *
 * How it connects:
 * - Run by the test runner (Vitest or Jest) */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReducedMotion } from '../hooks/useReducedMotion'

// Mock matchMedia
let mockMatchesReducedMotion = false
let mockMediaQueryListeners: ((event: MediaQueryListEvent) => void)[] = []

const mockMatchMedia = vi.fn((query: string) => ({
  matches: query.includes('prefers-reduced-motion') ? mockMatchesReducedMotion : false,
  media: query,
  onchange: null,
  addEventListener: vi.fn((_, handler) => {
    mockMediaQueryListeners.push(handler)
  }),
  removeEventListener: vi.fn((_, handler) => {
    mockMediaQueryListeners = mockMediaQueryListeners.filter(h => h !== handler)
  }),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: mockMatchMedia,
})

describe('useReducedMotion', () => {
  beforeEach(() => {
    mockMatchesReducedMotion = false
    mockMediaQueryListeners = []
    vi.clearAllMocks()
  })

  describe('prefersReduced state', () => {
    test('returns false when user does not prefer reduced motion', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      expect(result.current.prefersReduced).toBe(false)
    })

    test('returns true when user prefers reduced motion', () => {
      mockMatchesReducedMotion = true
      const { result } = renderHook(() => useReducedMotion())
      expect(result.current.prefersReduced).toBe(true)
    })

    test('queries correct media feature', () => {
      renderHook(() => useReducedMotion())
      expect(mockMatchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    })

    test('updates when preference changes', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.prefersReduced).toBe(false)
      
      // Simulate preference change
      act(() => {
        mockMatchesReducedMotion = true
        mockMediaQueryListeners.forEach(listener => {
          listener({ matches: true } as MediaQueryListEvent)
        })
      })
      
      expect(result.current.prefersReduced).toBe(true)
    })
  })

  describe('getSafeDuration', () => {
    test('returns default duration when reduced motion not preferred', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.getSafeDuration(300)).toBe(300)
      expect(result.current.getSafeDuration(500)).toBe(500)
      expect(result.current.getSafeDuration(1000)).toBe(1000)
    })

    test('returns 0 when reduced motion is preferred', () => {
      mockMatchesReducedMotion = true
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.getSafeDuration(300)).toBe(0)
      expect(result.current.getSafeDuration(500)).toBe(0)
      expect(result.current.getSafeDuration(1000)).toBe(0)
    })

    test('handles zero duration input', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      expect(result.current.getSafeDuration(0)).toBe(0)
    })
  })

  describe('getSafeTransition', () => {
    test('returns default transition when reduced motion not preferred', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.getSafeTransition('all 0.3s ease')).toBe('all 0.3s ease')
      expect(result.current.getSafeTransition('opacity 200ms')).toBe('opacity 200ms')
    })

    test('returns "none" when reduced motion is preferred', () => {
      mockMatchesReducedMotion = true
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.getSafeTransition('all 0.3s ease')).toBe('none')
      expect(result.current.getSafeTransition('opacity 200ms')).toBe('none')
    })

    test('handles empty string input', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      expect(result.current.getSafeTransition('')).toBe('')
    })

    test('handles "none" input', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      expect(result.current.getSafeTransition('none')).toBe('none')
    })
  })

  describe('cleanup', () => {
    test('removes media query listener on unmount', () => {
      const removeEventListenerSpy = vi.fn()
      
      // Override matchMedia to track removeEventListener
      const originalMatchMedia = window.matchMedia
      window.matchMedia = vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((_, handler) => {
          mockMediaQueryListeners.push(handler)
        }),
        removeEventListener: removeEventListenerSpy,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia
      
      const { unmount } = renderHook(() => useReducedMotion())
      unmount()
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function))
      
      // Restore
      window.matchMedia = originalMatchMedia
    })
  })

  describe('reactive updates', () => {
    test('getSafeDuration reflects preference changes', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.getSafeDuration(500)).toBe(500)
      
      act(() => {
        mockMatchesReducedMotion = true
        mockMediaQueryListeners.forEach(listener => {
          listener({ matches: true } as MediaQueryListEvent)
        })
      })
      
      expect(result.current.getSafeDuration(500)).toBe(0)
    })

    test('getSafeTransition reflects preference changes', () => {
      mockMatchesReducedMotion = false
      const { result } = renderHook(() => useReducedMotion())
      
      expect(result.current.getSafeTransition('transform 0.3s')).toBe('transform 0.3s')
      
      act(() => {
        mockMatchesReducedMotion = true
        mockMediaQueryListeners.forEach(listener => {
          listener({ matches: true } as MediaQueryListEvent)
        })
      })
      
      expect(result.current.getSafeTransition('transform 0.3s')).toBe('none')
    })
  })
})
