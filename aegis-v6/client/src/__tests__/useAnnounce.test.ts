/**
 * Module: useAnnounce.test.ts
 *
 * Tests for the useAnnounce hook, which injects screen-reader announcements
 * into the page via ARIA live regions without interrupting visual layout.
 *
 * Glossary:
 *   describe()          = groups related tests under a labelled block
 *   test()              = a single scenario with one expected outcome
 *   expect()            = asserts that a value matches an expected result
 *   vi.useFakeTimers()  = replaces real clock so we can skip forward in time without waiting
 *   vi.advanceTimersByTime(ms) = jumps the fake clock forward by ms milliseconds
 *   vi.useRealTimers()  = restores the real wall-clock after the test suite
 *   renderHook()        = mounts a React hook in a minimal test component; returns { result }
 *   act()               = flushes React state updates so assertions run after renders complete
 *   ARIA live region    = a DOM element with role="status" or aria-live that screen readers
 *                         watch for content changes and read aloud automatically
 *   aria-live="polite"  = screen reader finishes current sentence before announcing
 *   aria-live="assertive" = screen reader interrupts current speech immediately
 *   aria-atomic="true"  = screen reader reads the entire region, not just the changed part
 *   visually hidden     = element positioned off-screen (1px) so sighted users don't see it
 *                         but screen readers still read it
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAnnounce } from '../hooks/useAnnounce'

describe('useAnnounce', () => {
  beforeEach(() => {
    vi.useFakeTimers() // replace real timers so we can skip the 150ms delay in tests
    // Clean up any live regions left by previous tests so each test starts fresh
    document.querySelectorAll('[role="status"]').forEach(el => el.remove())
  })

  afterEach(() => {
    vi.useRealTimers() // restore real timers after each test
    // Remove live regions added during the test to avoid bleed-through
    document.querySelectorAll('[role="status"]').forEach(el => el.remove())
  })

  test('returns a function', () => {
    // The hook itself returns a callable announce() function, not a value
    const { result } = renderHook(() => useAnnounce())
    expect(typeof result.current).toBe('function')
  })

  test('creates ARIA live region on first announcement', () => {
    const { result } = renderHook(() => useAnnounce())
    
    // No live region injected into the DOM before the first call
    expect(document.querySelector('[role="status"]')).toBeNull()
    
    act(() => {
      result.current('Test message') // triggers live-region creation
      vi.advanceTimersByTime(150)    // skip the 150ms delay before content is set
    })
    
    // Live region should now exist in the DOM
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion).not.toBeNull()
  })

  test('sets message content after delay', () => {
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Hello screen reader') // call announce without advancing time yet
    })
    
    // Content is intentionally blanked first — screen readers only fire on *changes*,
    // so wiping then re-setting forces a re-announcement even for repeated messages
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.textContent).toBe('')
    
    // After the 150ms delay the actual message is written in
    act(() => { vi.advanceTimersByTime(150) })
    expect(liveRegion?.textContent).toBe('Hello screen reader')
  })

  test('uses polite aria-live by default', () => {
    // Default priority = polite: waits for screen reader to finish current sentence
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Polite message')
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite')
  })

  test('uses assertive aria-live when specified', () => {
    // assertive = interrupts the screen reader immediately; used for critical alerts
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Urgent message', { assertive: true }) // pass assertive: true option
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.getAttribute('aria-live')).toBe('assertive')
  })

  test('has aria-atomic attribute', () => {
    // aria-atomic="true" tells the screen reader to read the whole element, not just the diff
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Test')
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.getAttribute('aria-atomic')).toBe('true')
  })

  test('live region is visually hidden', () => {
    // Visually hidden = positioned off-screen with 1px size so sighted users don't see it
    // while assistive tech (screen readers) can still discover and read it
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Hidden visually')
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]') as HTMLElement
    expect(liveRegion.style.position).toBe('absolute')
    expect(liveRegion.style.width).toBe('1px')
    expect(liveRegion.style.height).toBe('1px')
    expect(liveRegion.style.overflow).toBe('hidden')
  })

  test('reuses existing live region', () => {
    // The hook must NOT inject a second live region; screen readers can glitch
    // when multiple live regions with the same role exist simultaneously
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('First message')
      vi.advanceTimersByTime(150)
    })
    
    act(() => {
      result.current('Second message')
      vi.advanceTimersByTime(150)
    })
    
    // Should only have one live region
    const liveRegions = document.querySelectorAll('[role="status"]')
    expect(liveRegions.length).toBe(1)
    expect(liveRegions[0].textContent).toBe('Second message')
  })

  test('clears content before new message (for re-announcement)', () => {
    // Screen readers only fire when the content *changes* — sending the same string
    // twice without clearing would be silently ignored; wipe + re-set forces the event
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('First')
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.textContent).toBe('First')
    
    act(() => {
      result.current('Second')
    })
    
    // Content cleared immediately
    expect(liveRegion?.textContent).toBe('')
    
    act(() => { vi.advanceTimersByTime(150) })
    expect(liveRegion?.textContent).toBe('Second')
  })

  test('cleans up timeout on unmount', () => {
    // vi.spyOn(global, 'clearTimeout') = watches the real clearTimeout function
    // so we can assert the hook cancels the pending timer when the component unmounts,
    // preventing a setState-after-unmount warning ("Can't perform a React state update on an unmounted component")
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    
    const { result, unmount } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Test message')
    })
    
    unmount()
    
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  test('handles rapid successive announcements', () => {
    // When three calls happen before the 150ms delay fires, the last one wins —
    // each call resets the pending timer (debounce-like behaviour)
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('First')
      result.current('Second')
      result.current('Third') // last call; earlier timers are cancelled
    })
    
    act(() => { vi.advanceTimersByTime(150) }) // advance past the 150ms delay
    
    const liveRegion = document.querySelector('[role="status"]')
    // Only the final announcement should appear — earlier ones were superseded
    expect(liveRegion?.textContent).toBe('Third')
  })

  test('multiple hooks share same live region', () => {
    const { result: result1 } = renderHook(() => useAnnounce())
    const { result: result2 } = renderHook(() => useAnnounce())
    
    act(() => {
      result1.current('From hook 1')
      vi.advanceTimersByTime(150)
    })
    
    act(() => {
      result2.current('From hook 2')
      vi.advanceTimersByTime(150)
    })
    
    // Still only one live region
    const liveRegions = document.querySelectorAll('[role="status"]')
    expect(liveRegions.length).toBe(1)
  })

  test('announces empty string', () => {
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Non-empty')
      vi.advanceTimersByTime(150)
    })
    
    act(() => {
      result.current('')
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.textContent).toBe('')
  })

  test('handles special characters', () => {
    const { result } = renderHook(() => useAnnounce())
    
    act(() => {
      result.current('Alert: <script>dangerous</script> & "quotes"')
      vi.advanceTimersByTime(150)
    })
    
    const liveRegion = document.querySelector('[role="status"]')
    expect(liveRegion?.textContent).toBe('Alert: <script>dangerous</script> & "quotes"')
  })
})
