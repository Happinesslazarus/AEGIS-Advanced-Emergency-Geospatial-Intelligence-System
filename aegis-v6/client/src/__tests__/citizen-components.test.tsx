/**
 * Module: citizen-components.test.tsx
 *
 * Tests for the <SafetyCheckIn> citizen component — a UI panel that asks citizens
 * whether they are safe after a disaster and records their status by firing a
 * push-notification through the AlertsContext.
 *
 * Three status buttons:
 *   "I'm Safe"   → success notification  (green button)
 *   "Need Help"  → warning notification  (red button)
 *   "Unsure"     → success notification  (amber button)
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = assertion helper
 *   vi.fn()                 = creates a trackable mock function
 *   vi.mock()               = replaces a module with a lightweight fake
 *   vi.importActual()       = loads the real module so we can spread it and only override
 *                             specific exports (partial mock technique)
 *   render()                = mounts a React component into the jsdom (in-memory DOM)
 *   screen                  = query helpers that search the rendered DOM
 *   fireEvent               = low-level synthetic event dispatcher
 *   userEvent               = high-level realistic user-interaction simulator;
 *                             types characters, clicks, presses keys exactly as a real user would
 *   user.setup()            = creates a fresh userEvent instance per test
 *   user.click()            = simulates a pointer click with hover/focus transitions
 *   user.tab()              = simulates pressing the Tab key to move keyboard focus
 *   user.keyboard()         = simulates pressing arbitrary keys ({Enter}, ' ' = Space)
 *   waitFor()               = retries an assertion until it passes or times out
 *   SafetyCheckIn           = citizen-facing safety status component
 *   pushNotification        = AlertsContext method that shows a toast message to the user
 *   mockPushNotification    = vi.fn() replacing pushNotification; lets tests assert it was called
 *   aria-pressed            = ARIA attribute on toggle buttons; 'true' = currently active
 *   role=region             = ARIA landmark that marks a self-contained section of the page
 *   aria-label              = accessible name for a region when no visible heading is present
 *   ring-2                  = Tailwind CSS outline ring applied to the selected button
 *   t: key => key           = i18n mock that returns the raw translation key string
 *   document.activeElement  = the DOM element currently holding keyboard focus
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event' // realistic user-interaction library
import SafetyCheckIn from '../components/citizen/SafetyCheckIn'
import { AlertsProvider } from '../contexts/AlertsContext'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// i18n — return raw keys so assertions are language-independent
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
}))

// useLanguage — provides locale string; not critical to SafetyCheckIn logic
vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en',
}))

// AlertsContext — partial mock: spread the real module so AlertsProvider still works,
// but replace useAlerts() so we can track pushNotification calls
const mockPushNotification = vi.fn()
vi.mock('../contexts/AlertsContext', async () => {
  const actual = await vi.importActual('../contexts/AlertsContext') // real exports
  return {
    ...actual, // keep AlertsProvider and other real exports
    useAlerts: () => ({
      pushNotification: mockPushNotification, // override only this method
      alerts: [],
      notifications: [],
      removeNotification: vi.fn(),
      clearAll: vi.fn(),
    }),
  }
})

// ---------------------------------------------------------------------------
// SafetyCheckIn component — core behaviour
// ---------------------------------------------------------------------------
describe('SafetyCheckIn', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset mock call counts before each test
  })

  // ---------------------------------------------------------------------------
  // Initial rendering
  // ---------------------------------------------------------------------------
  describe('rendering', () => {
    test('renders safety check question', () => {
      render(<SafetyCheckIn />)
      // The heading uses the i18n key 'safetyCheck.areYouSafe' (returned raw by our mock)
      expect(screen.getByText('safetyCheck.areYouSafe')).toBeInTheDocument()
    })

    test('renders three safety status buttons', () => {
      render(<SafetyCheckIn />)
      // All three status options must always be visible to the citizen
      expect(screen.getByRole('button', { name: /safe/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /unsure/i })).toBeInTheDocument()
    })

    test('has region role for accessibility', () => {
      render(<SafetyCheckIn />)
      // role="region" marks this as a named ARIA landmark so screen readers can navigate to it
      expect(screen.getByRole('region')).toBeInTheDocument()
    })

    test('has descriptive aria-label', () => {
      render(<SafetyCheckIn />)
      // The aria-label provides a visible name for the region landmark
      expect(screen.getByRole('region')).toHaveAttribute('aria-label', 'Safety check-in')
    })
  })

  // ---------------------------------------------------------------------------
  // Button interactions — notification dispatch and toggle state
  // ---------------------------------------------------------------------------
  describe('button interactions', () => {
    test('clicking "I\'m Safe" button triggers notification', async () => {
      const user = userEvent.setup() // create isolated userEvent instance for this test
      render(<SafetyCheckIn />)

      await user.click(screen.getByRole('button', { name: /safe/i }))

      // Confirmation toast: citizen's safety status has been saved
      expect(mockPushNotification).toHaveBeenCalledWith(
        'Safety status recorded.',
        'success' // green toast
      )
    })

    test('clicking "Need Help" button triggers warning notification', async () => {
      const user = userEvent.setup()
      render(<SafetyCheckIn />)

      await user.click(screen.getByRole('button', { name: /help/i }))

      // Warning toast: emergency services are notified of a help request
      expect(mockPushNotification).toHaveBeenCalledWith(
        'Help request received. Nearby responders notified.',
        'warning' // amber toast — responders have been alerted
      )
    })

    test('clicking "Unsure" button triggers success notification', async () => {
      const user = userEvent.setup()
      render(<SafetyCheckIn />)

      await user.click(screen.getByRole('button', { name: /unsure/i }))

      // Unsure is treated as a soft "safe" response — records status without panic
      expect(mockPushNotification).toHaveBeenCalledWith(
        'Safety status recorded.',
        'success'
      )
    })

    test('buttons have aria-pressed attribute', async () => {
      // aria-pressed conveys toggle state to screen readers
      const user = userEvent.setup()
      render(<SafetyCheckIn />)

      const safeButton = screen.getByRole('button', { name: /safe/i })
      expect(safeButton).toHaveAttribute('aria-pressed', 'false') // unpressed initially

      await user.click(safeButton)
      expect(safeButton).toHaveAttribute('aria-pressed', 'true') // pressed after click
    })

    test('only one button can be pressed at a time', async () => {
      // The three buttons behave like a radio group — selecting one deselects the others
      const user = userEvent.setup()
      render(<SafetyCheckIn />)

      const safeButton = screen.getByRole('button', { name: /safe/i })
      const helpButton = screen.getByRole('button', { name: /help/i })

      await user.click(safeButton)
      expect(safeButton).toHaveAttribute('aria-pressed', 'true')
      expect(helpButton).toHaveAttribute('aria-pressed', 'false') // still deselected

      await user.click(helpButton) // switch selection
      expect(safeButton).toHaveAttribute('aria-pressed', 'false') // now deselected
      expect(helpButton).toHaveAttribute('aria-pressed', 'true')  // now selected
    })
  })

  // ---------------------------------------------------------------------------
  // Styling — Tailwind CSS class verification
  // ---------------------------------------------------------------------------
  describe('styling', () => {
    test('safe button has green styling', () => {
      render(<SafetyCheckIn />)
      const safeButton = screen.getByRole('button', { name: /safe/i })
      // bg-green-600 = dark green background communicates a safe/positive status
      expect(safeButton.className).toContain('bg-green-600')
    })

    test('help button has red styling', () => {
      render(<SafetyCheckIn />)
      const helpButton = screen.getByRole('button', { name: /help/i })
      // bg-red-600 = red communicates urgency / need for help
      expect(helpButton.className).toContain('bg-red-600')
    })

    test('unsure button has amber styling', () => {
      render(<SafetyCheckIn />)
      const unsureButton = screen.getByRole('button', { name: /unsure/i })
      // bg-amber-600 = amber communicates caution / uncertainty
      expect(unsureButton.className).toContain('bg-amber-600')
    })

    test('selected button gets ring styling', async () => {
      const user = userEvent.setup()
      render(<SafetyCheckIn />)

      const safeButton = screen.getByRole('button', { name: /safe/i })
      await user.click(safeButton)

      // ring-2 + ring-white = white outline ring that makes the selected state visible
      expect(safeButton.className).toContain('ring-2')
      expect(safeButton.className).toContain('ring-white')
    })
  })

  // ---------------------------------------------------------------------------
  // Icons
  // ---------------------------------------------------------------------------
  describe('icons', () => {
    test('buttons contain icons', () => {
      render(<SafetyCheckIn />)
      // Every status button must have an SVG icon for quick visual identification
      const buttons = screen.getAllByRole('button')
      buttons.forEach(button => {
        const svg = button.querySelector('svg') // inline SVG element
        expect(svg).toBeInTheDocument()
      })
    })
  })
})

// ---------------------------------------------------------------------------
// SafetyCheckIn accessibility — keyboard navigation
// ---------------------------------------------------------------------------
describe('SafetyCheckIn accessibility', () => {
  test('buttons are keyboard accessible', async () => {
    const user = userEvent.setup()
    render(<SafetyCheckIn />)

    const safeButton = screen.getByRole('button', { name: /safe/i })
    safeButton.focus() // programmatically focus the first button
    expect(document.activeElement).toBe(safeButton) // confirm it received focus

    // Tab key moves focus to the next focusable element in DOM order
    await user.tab()
    const helpButton = screen.getByRole('button', { name: /help/i })
    expect(document.activeElement).toBe(helpButton)
  })

  test('can activate button with Enter key', async () => {
    // Buttons must be activatable via Enter key (standard keyboard UX)
    const user = userEvent.setup()
    render(<SafetyCheckIn />)

    const safeButton = screen.getByRole('button', { name: /safe/i })
    safeButton.focus()

    await user.keyboard('{Enter}') // press Enter while button is focused

    expect(mockPushNotification).toHaveBeenCalled()       // notification fired
    expect(safeButton).toHaveAttribute('aria-pressed', 'true') // button selected
  })

  test('can activate button with Space key', async () => {
    // Space key is the secondary activation key for buttons (both must work per WCAG)
    const user = userEvent.setup()
    render(<SafetyCheckIn />)

    const helpButton = screen.getByRole('button', { name: /help/i })
    helpButton.focus()

    await user.keyboard(' ') // press Space (single space character)

    expect(mockPushNotification).toHaveBeenCalled()
    expect(helpButton).toHaveAttribute('aria-pressed', 'true')
  })
})

