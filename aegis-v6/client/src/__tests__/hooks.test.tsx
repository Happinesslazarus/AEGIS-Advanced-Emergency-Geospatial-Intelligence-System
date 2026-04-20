/**
 * Tests for five shared React hooks used throughout the client:
 *   - useDebounce / useDebouncedCallback  (delay propagation of quickly-changing values)
 *   - useOnlineStatus                     (detect internet connectivity events)
 *   - useReducedMotion                    (read OS "reduce motion" accessibility setting)
 *   - useResponsive                       (breakpoint-based device-width detection)
 *   - useAnnounce                         (ARIA live-region announcements for screen readers)
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = makes an assertion about a value
 *   beforeEach/afterEach    = setup/teardown that runs before/after every test
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.spyOn()              = wraps an existing function to track calls without replacing it
 *   vi.useFakeTimers()      = replaces setTimeout/setInterval with synchronous fakes;
 *                             allows tests to control time without waiting in real time
 *   vi.advanceTimersByTime()= fast-forwards the fake clock by N milliseconds
 *   vi.useRealTimers()      = restores the real timer functions after the test
 *   renderHook()            = mounts a React hook into a minimal test component and returns
 *                             {result, rerender, unmount} for inspecting hook state
 *   act()                   = flushes all React state updates synchronously; required after
 *                             any timer advance or event dispatch that triggers state changes
 *   result.current          = the most recent value returned from the hook under test
 *   rerender()              = re-renders the hook with new props; triggers a re-run
 *   unmount()               = unmounts the hook component; triggers cleanup (useEffect return)
 *   useDebounce             = hook that delays propagating a value until N ms after the last change;
 *                             prevents expensive operations (API calls, search) on every keystroke
 *   useDebouncedCallback    = same idea but for functions instead of values; returns a debounced fn
 *   debounce                = delay technique: reset the timer on each new input so the callback
 *                             only fires once, N ms after the last change stops arriving
 *   clearTimeout            = cancels a pending setTimeout; called on unmount to prevent
 *                             stale state updates after the component is removed from the DOM
 *   useOnlineStatus         = hook that subscribes to the browser 'online'/'offline' events;
 *                             returns {isOnline, queuedRequests, syncNow}
 *   navigator.onLine        = browser property; true when browser believes it has connectivity
 *   'online'/'offline' events = window events fired when connectivity changes
 *   queuedRequests          = count of requests stored locally while offline, waiting to sync
 *   syncNow                 = function that triggers an immediate sync of queued requests
 *   useReducedMotion        = hook that reads window.matchMedia('prefers-reduced-motion: reduce')
 *                             and returns {prefersReduced, getSafeDuration, getSafeTransition}
 *   prefersReduced          = boolean; true if the OS accessibility setting is enabled
 *   getSafeDuration()       = returns 0 if reduced motion is preferred, otherwise the given ms value
 *   getSafeTransition()     = returns 'none' if reduced, otherwise the given CSS transition string
 *   matchMedia              = browser API for CSS media query evaluation; mocked in tests
 *   addEventListener (MediaQueryList) = subscribes to media query change events
 *   useResponsive           = hook that returns {isMobile, isTablet, isDesktop, width} based
 *                             on window.innerWidth; updates when the window is resized
 *   breakpoints             = mobile < ~640px, tablet ~640–1024px, desktop > 1024px
 *   useAnnounce             = hook that returns an announce(message, opts?) function; calling it
 *                             inserts an ARIA live region into the DOM so screen readers read
 *                             the message aloud
 *   ARIA live region        = a DOM element with role="status" and aria-live="polite" (or
 *                             "assertive"); the browser automatically announces its text to
 *                             screen readers whenever the text changes
 *   assertive mode          = aria-live="assertive" interrupts the screen reader immediately;
 *                             polite mode waits for the reader to finish its current sentence
 *   100ms delay             = the hook waits 100ms before updating the live region text so the
 *                             screen reader re-detects the change (changing text immediately
 *                             after clearing it is sometimes missed by readers)
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// The hooks under test
import { useDebounce, useDebouncedCallback } from '../hooks/useDebounce'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useResponsive } from '../hooks/useResponsive'
import { useAnnounce } from '../hooks/useAnnounce'

// ---------------------------------------------------------------------------
// useDebounce — delays a value until N ms after the last change
// ---------------------------------------------------------------------------
describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers() // take control of setTimeout so tests run synchronously
  })

  afterEach(() => {
    vi.useRealTimers() // restore real timers so other test files are not affected
  })

  test('returns initial value immediately', () => {
    // Hook should return the current value immediately on first render
    const { result } = renderHook(() => useDebounce('initial', 300))
    expect(result.current).toBe('initial')
  })

  test('returns debounced value after delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'initial' } }
    )

    rerender({ value: 'updated' }) // change the value
    expect(result.current).toBe('initial') // still old value (timer hasn't fired yet)

    act(() => {
      vi.advanceTimersByTime(300) // fast-forward 300ms → timer fires
    })
    expect(result.current).toBe('updated') // now the new value propagates
  })

  test('resets timer on rapid value changes', () => {
    // Simulates a user typing quickly — timer should reset on every keystroke
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'a' } }
    )

    rerender({ value: 'b' })
    act(() => vi.advanceTimersByTime(100)) // 100ms into 300ms timer
    
    rerender({ value: 'c' })
    act(() => vi.advanceTimersByTime(100)) // resets; 100ms into new 300ms
    
    rerender({ value: 'd' })
    act(() => vi.advanceTimersByTime(100)) // resets again; still not fired
    
    // Because the timer keeps resetting, 'a' (initial value) is still current
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(300)) // full 300ms after last change → fires
    expect(result.current).toBe('d') // only the latest value propagates
  })

  test('uses default delay of 300ms', () => {
    // When no delay is provided, the hook should default to 300ms
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value),
      { initialProps: { value: 'initial' } }
    )

    rerender({ value: 'updated' })
    
    act(() => vi.advanceTimersByTime(299)) // 1ms before the default delay
    expect(result.current).toBe('initial')
    
    act(() => vi.advanceTimersByTime(1)) // exactly 300ms → fires
    expect(result.current).toBe('updated')
  })

  test('works with objects', () => {
    // The hook is generic; it works with any value type, not just strings
    const initial = { name: 'test' }
    const updated = { name: 'updated' }
    
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: initial } }
    )

    rerender({ value: updated })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toEqual(updated)
  })

  test('works with null and undefined', () => {
    // Null/undefined are valid values and must be handled without errors
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: null as string | null } }
    )

    expect(result.current).toBeNull()
    
    rerender({ value: 'not null' })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe('not null')
  })

  test('cleans up timeout on unmount', () => {
    // When the component unmounts, the pending timer must be cancelled to prevent
    // a "setState after unmount" warning or stale update
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    
    const { unmount, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'initial' } }
    )

    rerender({ value: 'updated' }) // creates a pending timer
    unmount() // should cancel it

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// useDebouncedCallback — debounced function wrapper
// ---------------------------------------------------------------------------
describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('does not call callback immediately', () => {
    // Calling the debounced function should not invoke the callback right away
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 300))

    result.current('arg1') // call the debounced function
    expect(callback).not.toHaveBeenCalled() // inner callback not called yet
  })

  test('calls callback after delay', () => {
    // After 300ms, the callback must be invoked with the correct arguments
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 300))

    result.current('arg1')
    act(() => vi.advanceTimersByTime(300)) // timer fires
    
    expect(callback).toHaveBeenCalledWith('arg1')
    expect(callback).toHaveBeenCalledTimes(1) // called exactly once
  })

  test('only calls with last arguments on rapid calls', () => {
    // Multiple rapid calls should coalesce; only the last set of args is used
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 300))

    act(() => { result.current('a') })
    act(() => { vi.advanceTimersByTime(100); result.current('b') }) // reset
    act(() => { vi.advanceTimersByTime(100); result.current('c') }) // reset again
    act(() => { vi.advanceTimersByTime(300) })                      // fires with 'c'

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('c') // last value wins
  })
})

// ---------------------------------------------------------------------------
// useOnlineStatus — tracks browser connectivity state
// ---------------------------------------------------------------------------
describe('useOnlineStatus', () => {
  let originalOnLine: boolean

  beforeEach(() => {
    originalOnLine = navigator.onLine
    // Default to online for tests
    Object.defineProperty(navigator, 'onLine', { 
      value: true, 
      configurable: true,
      writable: true 
    })
  })

  afterEach(() => {
    // Restore original navigator.onLine value
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
      writable: true
    })
  })

  test('returns initial online status', () => {
    // When navigator.onLine is true, the hook should report online
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(true)
  })

  test('returns offline status when navigator.onLine is false', () => {
    // When navigator.onLine is false at mount, hook should start offline
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(false)
  })

  test('updates when going offline', () => {
    // Dispatching an 'offline' window event should trigger state update
    const { result } = renderHook(() => useOnlineStatus())
    
    act(() => {
      window.dispatchEvent(new Event('offline')) // simulate losing internet
    })
    
    expect(result.current.isOnline).toBe(false)
  })

  test('updates when going online', () => {
    // Dispatching an 'online' event after being offline should restore online state
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    
    act(() => {
      window.dispatchEvent(new Event('online')) // simulate regaining internet
    })
    
    expect(result.current.isOnline).toBe(true)
  })

  test('starts with queuedRequests at 0', () => {
    // No requests have been queued yet — count starts at zero
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.queuedRequests).toBe(0)
  })

  test('syncNow function exists', () => {
    // syncNow must be a callable function so components can trigger manual syncs
    const { result } = renderHook(() => useOnlineStatus())
    expect(typeof result.current.syncNow).toBe('function')
  })

  test('removes event listeners on unmount', () => {
    // Listeners must be cleaned up on unmount to prevent memory leaks
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useOnlineStatus())
    
    unmount()
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function))
    removeEventListenerSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// useReducedMotion — reads the OS "reduce motion" accessibility setting
// ---------------------------------------------------------------------------
describe('useReducedMotion', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock matchMedia to return {matches:false} (motion allowed) by default
    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true,
    })
  })

  test('returns prefersReduced false when not preferred', () => {
    // matches:false → user has not enabled the reduced motion OS setting
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.prefersReduced).toBe(false)
  })

  test('returns prefersReduced true when preferred', () => {
    // matches:true → OS setting is active; hook should report prefersReduced=true
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.prefersReduced).toBe(true)
  })

  test('getSafeDuration returns 0 when reduced motion preferred', () => {
    // Passing 0 to CSS transition-duration disables animation completely
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.getSafeDuration(300)).toBe(0) // animation suppressed
  })

  test('getSafeDuration returns default when reduced motion not preferred', () => {
    // Normal user: animation is allowed — return the requested 300ms duration
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.getSafeDuration(300)).toBe(300)
  })

  test('getSafeTransition returns "none" when reduced motion preferred', () => {
    // CSS transition:'none' disables the visual animation entirely
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.getSafeTransition('all 0.3s ease')).toBe('none')
  })

  test('getSafeTransition returns default when reduced motion not preferred', () => {
    // Normal user: return the full CSS transition string unchanged
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.getSafeTransition('all 0.3s ease')).toBe('all 0.3s ease')
  })

  test('updates when media query changes', () => {
    // When the OS setting changes at runtime (e.g. user toggles it), the hook must react
    let handler: ((e: MediaQueryListEvent) => void) | null = null
    
    matchMediaMock.mockImplementation(() => ({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
        handler = cb // capture the listener for manual triggering below
      },
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current.prefersReduced).toBe(false) // starts false

    act(() => {
      if (handler) {
        handler({ matches: true } as MediaQueryListEvent) // simulate OS setting change
      }
    })

    expect(result.current.prefersReduced).toBe(true) // now true after re-render
  })
})

// ---------------------------------------------------------------------------
// useResponsive — breakpoint-based viewport-width classification
// ---------------------------------------------------------------------------
describe('useResponsive', () => {
  const originalInnerWidth = window.innerWidth

  afterEach(() => {
    // Restore the original viewport width after each test
    Object.defineProperty(window, 'innerWidth', {
      value: originalInnerWidth,
      writable: true,
    })
  })

  test('returns responsive state object', () => {
    // Hook must always return all four expected fields regardless of width
    const { result } = renderHook(() => useResponsive())
    
    expect(result.current).toHaveProperty('isMobile')
    expect(result.current).toHaveProperty('isTablet')
    expect(result.current).toHaveProperty('isDesktop')
    expect(result.current).toHaveProperty('width') // current pixel width
  })

  test('isMobile true for small screens', () => {
    // 400px is a typical mobile phone width
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true })
    const { result } = renderHook(() => useResponsive())
    expect(result.current.isMobile).toBe(true)
  })

  test('isTablet true for medium screens', () => {
    // 800px is a typical tablet width
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true })
    const { result } = renderHook(() => useResponsive())
    expect(result.current.isTablet).toBe(true)
  })

  test('isDesktop true for large screens', () => {
    // 1200px is a typical desktop monitor width
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true })
    const { result } = renderHook(() => useResponsive())
    expect(result.current.isDesktop).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useAnnounce — ARIA live-region announcements for screen readers
// ---------------------------------------------------------------------------
describe('useAnnounce', () => {
  beforeEach(() => {
    vi.useFakeTimers() // the hook uses a 100ms delay before updating the live region
  })

  afterEach(() => {
    vi.useRealTimers()
    // Clean up any ARIA live regions appended to the body by the hook
    const liveRegion = document.querySelector('[role="status"]')
    if (liveRegion) {
      document.body.removeChild(liveRegion)
    }
  })

  test('returns announce function', () => {
    // The hook should return a single callable function
    const { result } = renderHook(() => useAnnounce())
    expect(typeof result.current).toBe('function')
  })

  test('creates a live region element', () => {
    // Calling announce() must inject a role=status element into document.body
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Test announcement')
    })

    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion).toBeInTheDocument()
    expect(liveRegion).toHaveAttribute('aria-live', 'polite') // polite = waits for reader
  })

  test('announce updates live region content after delay', () => {
    // The live region text is updated after 100ms so the screen reader re-detects the change
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Test announcement')
    })

    const liveRegion = document.querySelector('[role="status"]')
    
    expect(liveRegion?.textContent).toBe('') // text is empty immediately after call
    
    act(() => {
      vi.advanceTimersByTime(100) // 100ms passes → hook updates the text
    })
    
    expect(liveRegion?.textContent).toBe('Test announcement') // now populated
  })

  test('uses assertive mode when specified', () => {
    // assertive mode interrupts the screen reader immediately (for urgent announcements)
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Urgent message', { assertive: true }) // e.g. error messages
    })

    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion).toHaveAttribute('aria-live', 'assertive')
  })
})

// useDebounce Tests
