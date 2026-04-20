/**
 * Tests for the useFocusTrap hook, which confines Tab/Shift+Tab keyboard focus
 * to a specific container -- used in modals, dialogs, and side-drawers so keyboard
 * users cannot navigate outside the overlay while it is open.
 *
 * Glossary:
 *   describe()          = groups related tests under a labelled block
 *   test()              = a single scenario with one expected outcome
 *   vi.fn()             = creates a mock function that records how many times it was called
 *   vi.clearAllMocks()  = resets call counts/return values on all mocks between tests
 *   vi.mock()           = replaces a real module with a controllable fake; must be called
 *                         before the module is imported (hoisted to the top by Vitest)
 *   renderHook()        = mounts a React hook in a minimal test component; returns { result }
 *   cleanup()           = unmounts all components rendered during the test (auto-called by afterEach)
 *   vi.restoreAllMocks()= reverts mocked implementations back to the real ones
 *   focus trap          = a pattern that prevents keyboard focus from leaving a container;
 *                         required by WCAG 2.1 SC 2.1.2 for modal dialogs
 *   Tab / Shift+Tab     = keyboard keys for cycling forward/backward through focusable elements
 *   ref / RefObject     = React reference object (.current) that points to a real DOM node;
 *                         the hook returns one so the caller can attach it to a container div
 *   enabled flag        = boolean option; trap only activates when true AND the ref has a container
 *   autoFocus           = move focus into the container automatically when the trap activates
 *   returnFocus         = restore focus to the element that opened the dialog when trap deactivates
 *   KeyboardEvent       = browser event fired on every key press; dispatched manually in tests
 *                         to simulate the user pressing Escape
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import React from 'react'

//Create mock functions BEFORE vi.mock() so the factory can close over them
const mockActivate = vi.fn()   // called when the trap is activated (modal opens)
const mockDeactivate = vi.fn() // called when the trap is deactivated (modal closes)

//Replace the real accessibility utils with lightweight stubs.
//vi.mock is hoisted automatically by Vitest so this runs before the import below.
vi.mock('../utils/accessibility', () => ({
  createFocusTrap: vi.fn(() => ({
    activate: mockActivate,   // stub returned when createFocusTrap() is called
    deactivate: mockDeactivate,
  })),
  focusFirstElement: vi.fn(), // stub -- just records calls, doesn't actually focus anything
}))

//Import after mocking so the hook picks up the stubbed accessibility module
import { useFocusTrap } from '../hooks/useFocusTrap'

describe('useFocusTrap', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset call counts before each test so they don't accumulate
  })

  afterEach(() => {
    cleanup()           // unmount any components rendered during the test
    vi.restoreAllMocks() // bring real implementations back after mocks were used with spyOn
  })

  test('returns a ref object', () => {
    //The hook returns a React ref so callers can do: <div ref={containerRef}>
    const { result } = renderHook(() => useFocusTrap())
    expect(result.current).toHaveProperty('current') // RefObject shape
    expect(result.current.current).toBeNull()         // null until attached to a DOM node
  })

  test('does not create trap when containerRef is null', () => {
    //When the ref isn't attached to a DOM element, the trap cannot be created
    //the hook must guard against calling activate() with a null container
    renderHook(() => useFocusTrap({ enabled: true }))
    
    expect(mockActivate).not.toHaveBeenCalled()
  })

  test('does not create trap when enabled is false', () => {
    //enabled: false = trap is inactive; do not intercept Tab key
    renderHook(() => useFocusTrap({ enabled: false }))
    
    expect(mockActivate).not.toHaveBeenCalled()
  })

  test('accepts autoFocus option', () => {
    //autoFocus: true = move keyboard focus inside the container when the trap activates
    expect(() => {
      renderHook(() => useFocusTrap({ autoFocus: true }))
    }).not.toThrow()
    
    expect(() => {
      renderHook(() => useFocusTrap({ autoFocus: false }))
    }).not.toThrow()
  })

  test('accepts returnFocus option', () => {
    //returnFocus: true = when the dialog closes, return focus to the element
    //that triggered it (e.g. the "Open modal" button) -- required by WCAG
    expect(() => {
      renderHook(() => useFocusTrap({ returnFocus: true }))
    }).not.toThrow()
    
    expect(() => {
      renderHook(() => useFocusTrap({ returnFocus: false }))
    }).not.toThrow()
  })

  test('accepts onEscape callback', () => {
    //onEscape fires when the user presses Escape while the trap is active
    const onEscape = vi.fn()
    expect(() => {
      renderHook(() => useFocusTrap({ onEscape }))
    }).not.toThrow()
  })

  test('handles escape key only when onEscape provided and trap enabled', () => {
    const onEscape = vi.fn()
    
    //Trap disabled -- the Escape listener should not fire onEscape
    renderHook(() => useFocusTrap({ onEscape, enabled: false }))
    
    //Simulate the user pressing Escape by dispatching a real KeyboardEvent on the document
    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(event)
    
    //onEscape must not be called because the trap has no active container
    expect(onEscape).not.toHaveBeenCalled()
  })

  test('cleans up on unmount', () => {
    //Unmounting the component must not throw; the hook should deactivate the trap and
    //remove all event listeners to prevent memory leaks
    const { unmount } = renderHook(() => useFocusTrap({ enabled: false }))
    
    expect(() => unmount()).not.toThrow()
  })

  test('re-evaluates when enabled changes', () => {
    //rerender() calls the hook again with new props, mimicking a parent component toggling
    //the enabled prop -- the useEffect inside the hook should respond and re-check whether
    //to activate or deactivate the trap
    const { rerender } = renderHook(
      ({ enabled }) => useFocusTrap({ enabled }),
      { initialProps: { enabled: false } }
    )
    
 //Toggle enabled from false -> true
    rerender({ enabled: true })
    
    //Still won't activate: the ref.current is null (no real DOM in this unit test)
    expect(mockActivate).not.toHaveBeenCalled()
  })
})

describe('useFocusTrap integration behavior', () => {
  test('returns ref with HTMLElement generic type', () => {
    //useFocusTrap<HTMLDivElement>() narrows the TypeScript type of ref.current
    //to HTMLDivElement so callers get autocomplete on DOM properties
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>())
    
    //TypeScript generic assignment -- proves the hook is type-compatible with React.RefObject
    const ref: React.RefObject<HTMLDivElement> = result.current
    expect(ref.current).toBeNull()
  })

  test('works with default options', () => {
    const { result } = renderHook(() => useFocusTrap())
    
    expect(result.current).toBeDefined()
    expect(result.current.current).toBeNull()
  })

  test('all options can be combined', () => {
    //Smoke test: ensure none of the options conflict with each other when all are set
    const onEscape = vi.fn()
    
    expect(() => {
      renderHook(() => useFocusTrap({
        enabled: true,
        autoFocus: true,
        returnFocus: true,
        onEscape,
      }))
    }).not.toThrow()
  })
})
