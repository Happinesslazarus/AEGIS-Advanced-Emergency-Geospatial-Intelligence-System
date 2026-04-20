/**
 * Tests for the useKeyboardShortcuts hook, which registers global keyboard
 * shortcuts (Ctrl+K, Ctrl+/, Escape, etc.) and the SHORTCUTS constant that
 * describes each shortcut for display in a help overlay.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   renderHook()            = mounts a React hook without a visible component;
 *                             lets us test hook behaviour in isolation
 *   fireEvent.keyDown()     = synthetic keyboard event dispatched directly onto a DOM node;
 *                             faster but less realistic than userEvent
 *   new KeyboardEvent()     = native browser KeyboardEvent constructor; used here when we need
 *                             to spy on .preventDefault() (fireEvent events are not cancelable)
 *   cancelable: true        = required when the test needs to verify event.preventDefault();
 *                             without it, calling preventDefault() does nothing measurable
 *   ctrlKey                 = boolean: true if the Control key (Windows/Linux) was held
 *   metaKey                 = boolean: true if the Command key (Mac ⌘) was held
 *   shiftKey                = boolean: true if Shift was held
 *   event.target            = the DOM element that originally received the event;
 *                             the hook uses this to skip shortcuts when the user is typing
 *   vi.fn()                 = creates a mock (fake) callback whose calls are recorded
 *   vi.spyOn()              = wraps a real function to track/intercept calls
 *   vi.clearAllMocks()      = resets call counts between tests
 *   vi.restoreAllMocks()    = removes spies, restoring original functions
 *   vi.mock()               = hoists a module replacement to the top of the file (before imports);
 *                             replaces react-router-dom so useNavigate() returns mockNavigate
 *   vi.importActual()       = loads the real module inside vi.mock so we can spread real exports
 *                             and only override the one function we care about (useNavigate)
 *   BrowserRouter           = React Router wrapper that supplies routing context; hooks like
 *                             useNavigate() crash without it, so it is passed as { wrapper }
 *   useNavigate()           = React Router hook that returns a navigate() function; mocked here
 *   mockNavigate            = vi.fn() replacement for navigate(); lets us assert the target path
 *   SHORTCUTS               = exported constant array; each entry has keys[] + description;
 *                             used to render the keyboard shortcut help panel
 *   bubbles: true           = makes the event travel up the DOM tree (required for window to catch it)
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { useKeyboardShortcuts, SHORTCUTS } from '../hooks/useKeyboardShortcuts'
import React from 'react'

//Module mock -- replaces useNavigate so navigation can be asserted
//vi.mock() is hoisted by Vitest to run before imports, so mockNavigate must
//be declared here at module scope
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  //vi.importActual loads the real react-router-dom exports
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,                          // keep all real exports (Route, Link, etc.)
    useNavigate: () => mockNavigate,    // swap only useNavigate
  }
})

//Wrapper -- each renderHook call needs BrowserRouter so the hook can call
//useNavigate() without throwing "useNavigate() may be used only in the
//context of a <Router> component"
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

//useKeyboardShortcuts hook tests
describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset call counts so tests don't interfere with each other
  })

  afterEach(() => {
    vi.restoreAllMocks() // remove any spies created inside tests
  })

  test('adds event listener on mount', () => {
    //When the hook mounts it must register a 'keydown' listener on window
    //so it receives every keypress regardless of which element has focus
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    
    renderHook(() => useKeyboardShortcuts(), { wrapper })
    
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  test('removes event listener on unmount', () => {
    //When the component that uses this hook unmounts (e.g. navigation or logout),
    //the listener must be removed to prevent memory leaks and stale callbacks
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    
    const { unmount } = renderHook(() => useKeyboardShortcuts(), { wrapper })
    unmount() // triggers the useEffect cleanup
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  //Shortcut handler tests

  test('Ctrl+K calls onFocusSearch', () => {
    //Ctrl+K is the standard "focus search bar" shortcut (like VSCode, GitHub)
    const onFocusSearch = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onFocusSearch }), { wrapper })
    
    //fireEvent.keyDown dispatches the event directly; sets ctrlKey=true on the event object
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    
    expect(onFocusSearch).toHaveBeenCalled()
  })

  test('Cmd+K (Mac) calls onFocusSearch', () => {
    //On macOS the Command key (⌘) replaces Ctrl for most shortcuts; metaKey=true
    const onFocusSearch = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onFocusSearch }), { wrapper })
    
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    
    expect(onFocusSearch).toHaveBeenCalled()
  })

  test('Ctrl+/ calls onToggleChat', () => {
    //Ctrl+/ is the shortcut for opening/closing the AI chat assistant panel
    const onToggleChat = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onToggleChat }), { wrapper })
    
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    
    expect(onToggleChat).toHaveBeenCalled()
  })

  test('Ctrl+N calls onNewReport', () => {
    //Ctrl+N opens the "New Incident Report" form; browser default (new tab/window)
    //must be overridden with preventDefault (tested separately below)
    const onNewReport = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onNewReport }), { wrapper })
    
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    
    expect(onNewReport).toHaveBeenCalled()
  })

  test('Ctrl+Shift+A navigates to admin', () => {
    //Ctrl+Shift+A is an admin-only shortcut that jumps directly to the admin dashboard
    renderHook(() => useKeyboardShortcuts(), { wrapper })
    
    fireEvent.keyDown(window, { key: 'A', ctrlKey: true, shiftKey: true })
    
    expect(mockNavigate).toHaveBeenCalledWith('/admin')
  })

  test('Escape calls onEscape', () => {
    //Escape is used to close modals, dialogs, and panels -- universal "cancel" key
    const onEscape = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onEscape }), { wrapper })
    
    fireEvent.keyDown(window, { key: 'Escape' })
    
    expect(onEscape).toHaveBeenCalled()
  })

  // '?' shortcut -- should fire only when the user is NOT typing in an input

  test('? calls onShowHelp when not in input', () => {
    // '?' shows the keyboard shortcut help overlay, but only when the user is
    //not currently typing something; event.target = document.body means no text field is focused
    const onShowHelp = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onShowHelp }), { wrapper })
    
    //Manually construct the event so we can override .target (read-only on fireEvent events)
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true })
    Object.defineProperty(event, 'target', { value: document.body })
    window.dispatchEvent(event)
    
    expect(onShowHelp).toHaveBeenCalled()
  })

  test('does not call onShowHelp when typing in input', () => {
    //If the user is typing in a text input, '?' should be treated as regular text,
    //not a shortcut trigger -- otherwise the help overlay pops up unexpectedly
    const onShowHelp = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onShowHelp }), { wrapper })
    
    //Create an <input> element that simulates a focused text field
    const input = document.createElement('input')
    document.body.appendChild(input)
    
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true })
    Object.defineProperty(event, 'target', { value: input }) // target = the input element
    window.dispatchEvent(event)
    
    expect(onShowHelp).not.toHaveBeenCalled() // shortcut must be suppressed
    
    document.body.removeChild(input) // clean up the DOM
  })

  test('does not call onShowHelp when typing in textarea', () => {
    //Same guard applies to <textarea> -- multi-line text areas should also block the shortcut
    const onShowHelp = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onShowHelp }), { wrapper })
    
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true })
    Object.defineProperty(event, 'target', { value: textarea })
    window.dispatchEvent(event)
    
    expect(onShowHelp).not.toHaveBeenCalled()
    
    document.body.removeChild(textarea)
  })

  //preventDefault tests -- browser built-in actions must be suppressed

  test('prevents default for Ctrl+K', () => {
    //Without preventDefault, Ctrl+K in some browsers focuses the address bar
    //We must create our own KeyboardEvent with cancelable: true so the spy works
    const onFocusSearch = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onFocusSearch }), { wrapper })
    
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true, // event must be cancelable for preventDefault to be observable
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    
    window.dispatchEvent(event)
    
    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  test('prevents default for Ctrl+/', () => {
    //Without preventDefault, Ctrl+/ may be intercepted by the browser or OS
    const onToggleChat = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onToggleChat }), { wrapper })
    
    const event = new KeyboardEvent('keydown', {
      key: '/',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    
    window.dispatchEvent(event)
    
    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  test('prevents default for Ctrl+N', () => {
    //Ctrl+N normally opens a new browser window; our handler must prevent that
    const onNewReport = vi.fn()
    
    renderHook(() => useKeyboardShortcuts({ onNewReport }), { wrapper })
    
    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    
    window.dispatchEvent(event)
    
    expect(preventDefaultSpy).toHaveBeenCalled()
  })
})

//SHORTCUTS constant tests
//The SHORTCUTS array drives the "Keyboard shortcuts" help panel UI
describe('SHORTCUTS', () => {
  test('contains expected shortcuts', () => {
    //There must be at least one shortcut defined
    expect(SHORTCUTS).toBeDefined()
    expect(SHORTCUTS.length).toBeGreaterThan(0)
  })

  test('each shortcut has keys and description', () => {
    //keys[] = the key names shown in the UI (e.g. ['Ctrl', 'K'])
    //description = plain-English explanation shown beside the keys
    for (const shortcut of SHORTCUTS) {
      expect(shortcut).toHaveProperty('keys')
      expect(shortcut).toHaveProperty('description')
      expect(Array.isArray(shortcut.keys)).toBe(true)      // keys must be an array
      expect(shortcut.keys.length).toBeGreaterThan(0)      // must have at least one key
      expect(typeof shortcut.description).toBe('string')   // description must be text
    }
  })

  test('includes Ctrl+K for search', () => {
    //The most important shortcut -- users need to quickly focus the search bar
    const searchShortcut = SHORTCUTS.find(s => 
      s.keys.some(k => k === 'Ctrl') && s.keys.some(k => k === 'K')
    )
    expect(searchShortcut).toBeDefined()
  })

  test('includes Escape for closing', () => {
    //Escape is universally expected to close/cancel; it must appear in the help overlay
    const escapeShortcut = SHORTCUTS.find(s => s.keys.some(k => k === 'Esc'))
    expect(escapeShortcut).toBeDefined()
  })
})
