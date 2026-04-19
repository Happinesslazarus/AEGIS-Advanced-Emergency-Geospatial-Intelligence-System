/**
 * Module: contexts.test.tsx
 *
 * Tests for React context providers. Currently covers ThemeContext, which
 * supplies the active colour theme to all components via React's Context API.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   render()                = mounts a full React component tree into a jsdom DOM
 *   screen                  = queries the jsdom DOM for elements (screen.getByTestId, etc.)
 *   userEvent               = simulates real user interactions (clicks, types) at a higher
 *                             level than fireEvent; waits for all async state updates
 *   act()                   = flushes React state updates; wraps interactions that trigger re-renders
 *   @testing-library/jest-dom = adds extra matchers like .toHaveTextContent(), .toBeInTheDocument()
 *   vi.fn()                 = creates a mock function
 *   vi.spyOn()              = wraps an existing function so calls to it can be tracked
 *   vi.restoreAllMocks()    = removes all spies after each test
 *   Object.defineProperty() = injects a fake localStorage / matchMedia into the test environment
 *   ThemeProvider           = React context provider that wraps the app and supplies the theme value
 *   useTheme()              = React hook that reads the theme from ThemeContext
 *   THEMES                  = exported array of all available theme objects
 *   ThemeName               = TypeScript union type of all valid theme name strings
 *   window.matchMedia()     = browser API for CSS media query evaluation; mocked here because
 *                             jsdom (the test DOM) doesn't implement a real media engine
 *   prefers-color-scheme    = CSS media feature that reports the OS dark/light preference;
 *                             mocked to return 'dark' or 'light' depending on the test
 *   data-testid             = custom HTML attribute used by @testing-library as a stable selector
 *   localStorage            = key/value browser storage; mocked with a plain JS object
 *   aegis-theme             = localStorage key that persists the user's chosen theme
 *   classList.contains('dark') = Tailwind dark-mode activation; the 'dark' class on <html>
 *                             enables all tw: dark: variants
 *   data-theme attribute    = <html data-theme="ocean"> drives CSS custom-property overrides
 *   wrapper option          = renderHook({ wrapper }) wraps the hook in a provider so context
 *                             calls inside the hook can read the provided value
 *   toggleDarkMode          = alias for toggle(); exists for backward-compatibility
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import React from 'react'

import { ThemeProvider, useTheme, THEMES, type ThemeName } from '../contexts/ThemeContext'

// ---------------------------------------------------------------------------
// ThemeContext Tests
// ---------------------------------------------------------------------------

describe('ThemeContext', () => {
  let localStorageMock: Record<string, string>   // in-memory dict acting as localStorage
  let matchMediaMock: ReturnType<typeof vi.fn>   // controls what OS colour scheme is reported
  
  beforeEach(() => {
    // Inject a fake localStorage backed by a plain object
    localStorageMock = {}
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => localStorageMock[key] ?? null,
        setItem: (key: string, value: string) => { localStorageMock[key] = value },
        removeItem: (key: string) => { delete localStorageMock[key] },
        clear: () => { localStorageMock = {} },
      },
      writable: true,
    })
    
    // Inject a fake matchMedia that reports 'dark' when the query string includes 'dark'.
    // This mimics a user who has set their OS to dark mode.
    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark'), // true for '(prefers-color-scheme: dark)'
      media: query,
      onchange: null,
      addListener: vi.fn(),    // deprecated API; still called by some polyfills
      removeListener: vi.fn(), // deprecated companion
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', { value: matchMediaMock, writable: true })
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
    // Clean up DOM changes applied by ThemeProvider so tests don't bleed into each other
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
  })
  
  // Minimal test component that reads the full theme shape from context
  function ThemeConsumer() {
    const theme = useTheme()
    return (
      <div>
        <span data-testid="theme-name">{theme.theme}</span>
        <span data-testid="is-dark">{theme.dark ? 'dark' : 'light'}</span>
        <button onClick={theme.toggle}>Toggle</button>
        <button onClick={() => theme.setTheme('ocean')}>Set Ocean</button>
        <button onClick={() => theme.setTheme('sunset')}>Set Sunset</button>
      </div>
    )
  }
  
  test('THEMES array contains expected themes', () => {
    // Verify the app ships with all 7 expected colour themes
    expect(THEMES).toHaveLength(7)
    expect(THEMES.map(t => t.name)).toContain('default')
    expect(THEMES.map(t => t.name)).toContain('light')
    expect(THEMES.map(t => t.name)).toContain('midnight')
    expect(THEMES.map(t => t.name)).toContain('ocean')
    expect(THEMES.map(t => t.name)).toContain('forest')
    expect(THEMES.map(t => t.name)).toContain('sunset')
    expect(THEMES.map(t => t.name)).toContain('rose')
  })
  
  test('THEMES have correct structure', () => {
    // Each theme object must carry all required fields;
    // isDark must be a boolean (not undefined or a string)
    for (const theme of THEMES) {
      expect(theme).toHaveProperty('name')        // machine-readable key (e.g. 'ocean')
      expect(theme).toHaveProperty('label')       // human-readable name ('Ocean')
      expect(theme).toHaveProperty('isDark')      // true = dark-mode palette
      expect(theme).toHaveProperty('swatch')      // CSS hex colour for the colour-picker preview
      expect(theme).toHaveProperty('description') // short user-facing description
      expect(typeof theme.isDark).toBe('boolean')
    }
  })
  
  test('provides default theme when system prefers dark', () => {
    // OS dark-mode preference → ThemeProvider should default to 'default' (dark) theme
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('dark'), // '(prefers-color-scheme: dark)' resolves to true
      media: query,
    }))
    
    render(
      <ThemeProvider>  {/* wrap in provider so useTheme() has a value to read */}
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    expect(screen.getByTestId('theme-name')).toHaveTextContent('default')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('dark')
  })
  
  test('provides light theme when system prefers light', () => {
    // OS light-mode preference → ThemeProvider should default to 'light' theme
    matchMediaMock.mockImplementation((query: string) => ({
      matches: !query.includes('dark'), // prefers-color-scheme: dark = false
      media: query,
    }))
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    expect(screen.getByTestId('theme-name')).toHaveTextContent('light')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('light')
  })
  
  test('restores theme from localStorage', () => {
    // Pre-set a saved theme in the fake localStorage
    localStorageMock['aegis-theme'] = 'ocean'
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    // ThemeProvider reads aegis-theme on mount and restores the saved choice
    expect(screen.getByTestId('theme-name')).toHaveTextContent('ocean')
  })
  
  test('toggle switches between dark and light', async () => {
    // userEvent.setup() creates a user-event instance that handles pointer events properly
    const user = userEvent.setup()
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    // Default dark mode (OS prefers dark)
    expect(screen.getByTestId('is-dark')).toHaveTextContent('dark')
    
    // Click Toggle → switches to light
    await user.click(screen.getByRole('button', { name: /toggle/i }))
    expect(screen.getByTestId('theme-name')).toHaveTextContent('light')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('light')
    
    // Click Toggle again → returns to dark (default)
    await user.click(screen.getByRole('button', { name: /toggle/i }))
    expect(screen.getByTestId('theme-name')).toHaveTextContent('default')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('dark')
  })
  
  test('setTheme changes to specific theme', async () => {
    const user = userEvent.setup()
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    // Click 'Set Ocean' button
    await user.click(screen.getByRole('button', { name: /ocean/i }))
    expect(screen.getByTestId('theme-name')).toHaveTextContent('ocean')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('dark') // ocean is a dark theme
    
    // Click 'Set Sunset' button
    await user.click(screen.getByRole('button', { name: /sunset/i }))
    expect(screen.getByTestId('theme-name')).toHaveTextContent('sunset')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('light') // sunset is a light theme
  })
  
  test('persists theme to localStorage', async () => {
    const user = userEvent.setup()
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    await user.click(screen.getByRole('button', { name: /ocean/i }))
    // Choosing 'ocean' must be saved so it survives a page refresh
    expect(localStorageMock['aegis-theme']).toBe('ocean')
  })
  
  test('applies dark class to document element', async () => {
    const user = userEvent.setup()
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    // Default dark theme → <html class="dark"> enables Tailwind dark: variants
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    // Switch to light theme (sunset) — 'dark' class must be removed
    await user.click(screen.getByRole('button', { name: /sunset/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    
    // Switch back to a dark theme (ocean) — 'dark' class must be re-added
    await user.click(screen.getByRole('button', { name: /ocean/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
  
  test('sets data-theme attribute', async () => {
    // data-theme drives CSS custom-property overrides for accent colours
    const user = userEvent.setup()
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    expect(document.documentElement.getAttribute('data-theme')).toBe('default')
    
    await user.click(screen.getByRole('button', { name: /ocean/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean')
  })
  
  test('migrates legacy "dark" localStorage value', () => {
    // Older versions of the app stored 'dark' (a boolean mode) instead of a theme name.
    // When we encounter this legacy value we upgrade it to 'default' (the new dark theme).
    localStorageMock['aegis-theme'] = 'dark'
    
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )
    
    expect(screen.getByTestId('theme-name')).toHaveTextContent('default')
  })
  
  test('useTheme returns defaults without provider', () => {
    // When a component calls useTheme() without being wrapped in ThemeProvider,
    // the hook must return safe defaults rather than crashing; it also logs a console.warn.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    render(<ThemeConsumer />)
    
    // Fallback defaults: theme='default', dark=false (light mode)
    expect(screen.getByTestId('theme-name')).toHaveTextContent('default')
    expect(screen.getByTestId('is-dark')).toHaveTextContent('light')
    
    warnSpy.mockRestore() // restore real console.warn
  })
  
  test('themeConfig returns correct config for current theme', () => {
    // themeConfig = the full theme object (label, swatch, isDark, description)
    // for the currently active theme; used by settings panels to display theme info
    localStorageMock['aegis-theme'] = 'forest'
    
    function ConfigConsumer() {
      const { themeConfig } = useTheme()
      return (
        <div>
          <span data-testid="label">{themeConfig.label}</span>
          <span data-testid="swatch">{themeConfig.swatch}</span>
        </div>
      )
    }
    
    render(
      <ThemeProvider>
        <ConfigConsumer />
      </ThemeProvider>
    )
    
    expect(screen.getByTestId('label')).toHaveTextContent('Forest') // human-readable name
    expect(screen.getByTestId('swatch')).toHaveTextContent('#059669') // emerald-600
  })
  
  test('toggleDarkMode is alias for toggle', async () => {
    // Some older components reference toggleDarkMode(); this test ensures it still works
    // after the rename to toggle()
    const user = userEvent.setup()
    
    function ToggleConsumer() {
      const { toggleDarkMode, dark } = useTheme()
      return (
        <div>
          <span data-testid="dark">{dark ? 'yes' : 'no'}</span>
          <button onClick={toggleDarkMode}>Toggle Dark Mode</button>
        </div>
      )
    }
    
    render(
      <ThemeProvider>
        <ToggleConsumer />
      </ThemeProvider>
    )
    
    expect(screen.getByTestId('dark')).toHaveTextContent('yes') // starts in dark
    await user.click(screen.getByRole('button', { name: /toggle dark mode/i }))
    expect(screen.getByTestId('dark')).toHaveTextContent('no')  // switched to light
  })
  
  test('all dark themes have isDark true', () => {
    // Sanity-check that the THEMES data is consistent: dark themes must all be flagged isDark=true
    const darkThemes = THEMES.filter(t => t.isDark)
    expect(darkThemes.map(t => t.name)).toEqual(['default', 'midnight', 'ocean', 'forest', 'rose'])
  })
  
  test('all light themes have isDark false', () => {
    // Light themes must be flagged isDark=false
    const lightThemes = THEMES.filter(t => !t.isDark)
    expect(lightThemes.map(t => t.name)).toEqual(['light', 'sunset'])
  })
})
