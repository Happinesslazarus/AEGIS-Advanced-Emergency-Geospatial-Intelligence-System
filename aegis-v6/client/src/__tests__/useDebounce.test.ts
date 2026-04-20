/**
 * Tests for the useDebounce hook (delays a value update) and the
 * useDebouncedCallback hook (delays a function call).
 *
 * Debouncing = when a value or function is called repeatedly in quick succession,
 * the debounce waits until there's been a pause (the "delay") before actually
 * acting. Classic use cases: search-as-you-type (don't fetch after every keystroke),
 * window resize handlers (don't recalculate layout on every pixel change).
 *
 * Glossary:
 *   describe()                 = groups related tests under a labelled block
 *   test()                     = a single scenario with one expected outcome
 *   vi.useFakeTimers()         = replaces the real setTimeout/clearTimeout with a
 *                                controllable fake clock so we can skip delays instantly
 *   vi.useRealTimers()         = restores the real wall-clock after a test suite finishes
 *   vi.advanceTimersByTime(ms) = jumps the fake clock forward by ms milliseconds;
 *                                any timers that would have fired in that window fire now
 *   vi.spyOn(global,'clearTimeout') = wraps the real clearTimeout so we can assert it was called
 *   clearTimeoutSpy.mockRestore()   = removes the spy and brings back the original function
 *   renderHook()               = mounts a React hook in a minimal test component
 *   rerender({ value })        = re-calls the hook with new props (simulates parent component
 *                                updating its state and passing new props down)
 *   act()                      = flushes React state updates so assertions run after re-renders
 *   useDebounce(value, delay)  = returns a debounced copy of value; the copy only updates
 *                                after 'delay' ms have passed without another change
 *   useDebouncedCallback(fn, delay) = returns a wrapped version of fn that won't fire until
 *                                delay ms have passed since the last call
 *   debounce timer reset       = each new value/call restarts the countdown from scratch;
 *                                only the most recent call within a burst gets through
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce, useDebouncedCallback } from '../hooks/useDebounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers() // freeze the clock so setTimeout delays can be skipped
  })

  afterEach(() => {
    vi.useRealTimers() // restore real timers after each test
  })

  test('returns initial value immediately', () => {
    //On first render the debounced value equals the input -- no delay on initial mount
    const { result } = renderHook(() => useDebounce('initial', 300))
    expect(result.current).toBe('initial')
  })

  test('delays value update by specified time', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'first' } }
    )

    expect(result.current).toBe('first')

    //Simulate the parent passing a new value (e.g. user typed)
    rerender({ value: 'second' })
    
    //The debounced value has NOT updated yet -- we're still within the 300ms window
    expect(result.current).toBe('first')

    //Advance the fake clock 150ms -- still within the 300ms delay
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current).toBe('first')

    //Advance another 200ms (total 350ms) -- past the delay threshold
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('second') // now the update goes through
  })

  test('uses default delay of 300ms', () => {
    //When no delay is specified the hook defaults to 300ms
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value),
      { initialProps: { value: 'a' } }
    )

    rerender({ value: 'b' })
    
    act(() => { vi.advanceTimersByTime(299) }) // one ms before the default fires
    expect(result.current).toBe('a')           // still old value

    act(() => { vi.advanceTimersByTime(10) }) // crosses the 300ms threshold
    expect(result.current).toBe('b')           // now updated
  })

  test('resets timer on rapid value changes', () => {
    //If the user types rapidly, only the final keypress should trigger the update
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: 'start' } }
    )

    //Three quick changes within the 200ms window
    rerender({ value: 'change1' })
    act(() => { vi.advanceTimersByTime(100) }) // 100ms in -- timer reset

    rerender({ value: 'change2' })
    act(() => { vi.advanceTimersByTime(100) }) // 100ms in (from change2) -- timer reset again

    rerender({ value: 'final' }) // last change; starts a fresh 200ms countdown

    //Only after full delay from last change does the value propagate
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('final')
  })

  test('handles numeric values', () => {
    //Debounce works with any value type, including numbers
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: 0 } }
    )

    rerender({ value: 42 })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(42)
  })

  test('handles object values', () => {
    //Objects are compared by reference -- the hook doesn't do deep equality checks
    const obj1 = { id: 1, name: 'test' }
    const obj2 = { id: 2, name: 'updated' }
    
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: obj1 } }
    )

    expect(result.current).toBe(obj1) // initial value is the exact same reference

    rerender({ value: obj2 })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(obj2) // after delay, reference switches to obj2
  })

  test('handles null and undefined', () => {
    //Nullable generics: useDebounce<string | null | undefined> ensures TypeScript
    //accepts null and undefined as valid values without type errors
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce<string | null | undefined>(value, 100),
      { initialProps: { value: 'value' as string | null | undefined } }
    )

    rerender({ value: null })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBeNull()

    rerender({ value: undefined })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBeUndefined()
  })

  test('cleans up timer on unmount', () => {
    //vi.spyOn wraps clearTimeout so we can assert the hook cancels the pending
    //setTimeout when the component unmounts, preventing a dangling timer
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'test' } }
    )

    rerender({ value: 'updated' }) // starts a pending timer
    unmount()                       // should call clearTimeout before the timer fires

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore() // remove the spy to avoid affecting later tests
  })
})

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers() // freeze the clock
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('delays callback execution', () => {
    //useDebouncedCallback wraps a function and delays its execution
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 200))

    act(() => { result.current('arg1') }) // call the debounced wrapper
    expect(callback).not.toHaveBeenCalled() // original not called yet -- still waiting

    act(() => { vi.advanceTimersByTime(200) }) // skip past the 200ms delay
    expect(callback).toHaveBeenCalledWith('arg1') // now fired with the original argument
    expect(callback).toHaveBeenCalledTimes(1)      // only once
  })

  test('uses default delay of 300ms', () => {
    //Without a delay argument the default is 300ms
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback))

    act(() => { result.current() })
    
    act(() => { vi.advanceTimersByTime(299) }) // one ms before default fires
    expect(callback).not.toHaveBeenCalled()     // still waiting

    act(() => { vi.advanceTimersByTime(10) }) // crosses 300ms total
    expect(callback).toHaveBeenCalled()
  })

  test('cancels previous call on rapid invocations', () => {
    //Only the LAST call in a rapid burst should execute -- classic debounce behaviour
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 100))

    //Three calls in quick succession, each within the 100ms window of the previous
    act(() => { result.current('call1') })
    act(() => { vi.advanceTimersByTime(50) }) // 50ms -- call1 timer not yet fired
    
    act(() => { result.current('call2') }) // resets the timer
    act(() => { vi.advanceTimersByTime(50) }) // 50ms from call2 -- not yet fired
    
    act(() => { result.current('call3') }) // resets again
    
    act(() => { vi.advanceTimersByTime(100) }) // 100ms from call3 -- fires now

    //Only the last call executes; earlier ones were cancelled
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenLastCalledWith('call3')
  })

  test('passes all arguments to callback', () => {
    //Any arguments passed to the debounced wrapper are forwarded to the original callback
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 100))
    //Call the debounced function with multiple arguments
    act(() => { result.current('arg1', 'arg2', 42) })
    act(() => { vi.advanceTimersByTime(200) })
    expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 42)
  })

  test('handles numeric values', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: 0 } }
    )

    rerender({ value: 42 })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(42)
  })

  test('handles object values', () => {
    const obj1 = { id: 1, name: 'test' }
    const obj2 = { id: 2, name: 'updated' }
    
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: obj1 } }
    )

    expect(result.current).toBe(obj1)
    
    rerender({ value: obj2 })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(obj2)
  })

  test('handles null and undefined', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce<string | null | undefined>(value, 100),
      { initialProps: { value: 'value' as string | null | undefined } }
    )

    rerender({ value: null })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBeNull()

    rerender({ value: undefined })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBeUndefined()
  })

  test('cleans up timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'test' } }
    )

    rerender({ value: 'updated' })
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('delays callback execution', () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 200))

    act(() => { result.current('arg1') })
    expect(callback).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(200) })
    expect(callback).toHaveBeenCalledWith('arg1')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  test('uses default delay of 300ms', () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback))

    act(() => { result.current() })
    
    act(() => { vi.advanceTimersByTime(299) })
    expect(callback).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(10) })
    expect(callback).toHaveBeenCalled()
  })

  test('cancels previous call on rapid invocations', () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 100))

    //First call
    act(() => { result.current('call1') })
    act(() => { vi.advanceTimersByTime(50) })
    
    //Second call before first timer fires
    act(() => { result.current('call2') })
    act(() => { vi.advanceTimersByTime(50) })
    
    //Third call before second timer fires
    act(() => { result.current('call3') })
    
    //Advance past the delay
    act(() => { vi.advanceTimersByTime(100) })

    //Only last call should execute
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenLastCalledWith('call3')
  })

  test('passes all arguments to callback', () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 100))

    act(() => { result.current('a', 'b', 'c') })
    act(() => { vi.advanceTimersByTime(100) })

    expect(callback).toHaveBeenCalledWith('a', 'b', 'c')
  })

  test('cleans up timer on unmount', () => {
    //Same memory-safety check as useDebounce: cancel the pending setTimeout so
    //the callback doesn't fire after the component is removed from the DOM
    const callback = vi.fn()
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 300))

    act(() => { result.current() })
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  test('allows multiple independent debounced callbacks', () => {
    //Each useDebouncedCallback() instance has its own independent timer
    //callback1 firing at 100ms should NOT affect callback2's 200ms countdown
    const callback1 = vi.fn()
    const callback2 = vi.fn()
    
    const { result: result1 } = renderHook(() => useDebouncedCallback(callback1, 100))
    const { result: result2 } = renderHook(() => useDebouncedCallback(callback2, 200))

    act(() => {
      result1.current('a') // starts a 100ms timer for callback1
      result2.current('b') // starts a 200ms timer for callback2
    })

    act(() => { vi.advanceTimersByTime(100) }) // callback1 fires, callback2 still waiting
    expect(callback1).toHaveBeenCalledWith('a')
    expect(callback2).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(100) }) // total 200ms -- callback2 now fires
    expect(callback2).toHaveBeenCalledWith('b')
  })
})
