/**
 * Tests for the AlertCard component -- a visual card that displays a single
 * emergency alert (flood, wildfire, evacuation, etc.) with its severity level,
 * message, source, and optional dismiss button.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   render()                = mounts a React component into a jsdom DOM
 *   screen                  = queries the jsdom DOM for elements
 *   fireEvent.click()       = dispatches a synthetic mouse-click event
 *   beforeEach()            = runs setup code before every test
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.mock()               = replaces a module import with a controlled fake
 *   vi.clearAllMocks()      = resets call counts between tests
 *   Alert type              = TypeScript interface for an alert object with fields:
 *                             id, severity, title, message, area, source, timestamp,
 *                             displayTime, active, channels, disasterType
 *   makeAlert()             = factory function that returns a default Alert fixture;
 *                             individual tests spread overrides to vary specific fields
 *   compact prop            = when true, the card hides the verbose message body
 *                             (used in dense lists where space is limited)
 *   severity                = urgency level: 'low' | 'medium' | 'high' | 'critical'
 * getSeverityBorderClass = utility that maps severity string -> Tailwind border class
 *   channels                = delivery paths for the alert: 'web', 'sms', 'email', 'telegram'
 *   displayTime             = human-readable time string already formatted for the UI
 *                             (e.g. '10:00 AM') pre-computed from the ISO timestamp
 *   onDismiss prop          = optional callback invoked with the alert id when the user
 *                             closes the card; if absent the dismiss button is hidden
 *   role=alert              = ARIA landmark that announces the card immediately to screen readers
 *   aria-label              = accessible name for the dismiss button (screen reader text)
 *   getByLabelText()        = finds an element whose aria-label matches the given string
 *   container.firstChild    = the raw DOM node of the root element rendered by render()
 *   t: (key) => key         = i18n mock that returns the raw key; assertions check keys directly
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { Alert } from '../types'

//Mock i18n -- return key as-is so assertions can check raw translation keys
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
  onLanguageChange: () => () => {},
  isRtl: () => false,
}))

vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en',
}))

//Import the real helper (pure function, no side-effects -- no need to mock)
import { getSeverityBorderClass } from '../utils/helpers'
import AlertCard from '../components/shared/AlertCard'

//Alert fixture factory -- prevents copy-pasting the full object in every test
const makeAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'alert-1',
  severity: 'high',
  title: 'Flood Warning',
  message: 'River Clyde expected to exceed safe levels',
  area: 'Glasgow City Centre',
  source: 'SEPA',              // Scottish Environment Protection Agency
  timestamp: '2026-01-15T10:00:00Z',
  displayTime: '10:00 AM',     // pre-formatted for display; avoids timezone issues in tests
  active: true,
  channels: ['web', 'telegram'],
  disasterType: 'flood',
  ...overrides,                // test-specific fields override the defaults above
})

beforeEach(() => {
  vi.clearAllMocks() // reset mock call counts so each test starts clean
})

//AlertCard tests
describe('AlertCard', () => {
  //Rendering -- core content must appear in the DOM
  describe('Rendering', () => {
    test('displays alert title', () => {
      //The title is the most important piece of information; it must always be visible
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.getByText('Flood Warning')).toBeInTheDocument()
    })

    test('displays alert message in normal mode', () => {
      //In full (non-compact) mode, the message body is shown below the title
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.getByText(/River Clyde/)).toBeInTheDocument()
    })

    test('hides message in compact mode', () => {
      //Compact mode saves vertical space in dense alert lists by omitting the message body
      render(<AlertCard alert={makeAlert()} compact />)
      expect(screen.queryByText(/River Clyde/)).not.toBeInTheDocument()
    })

    test('displays formatted time', () => {
      //The pre-formatted displayTime (e.g. "2:30 PM") must appear on the card
      render(<AlertCard alert={makeAlert({ displayTime: '2:30 PM' })} />)
      expect(screen.getByText('2:30 PM')).toBeInTheDocument()
    })

    test('displays channels', () => {
      //Show which delivery channels were used (e.g. "web, sms, email")
      render(<AlertCard alert={makeAlert({ channels: ['web', 'sms', 'email'] })} />)
      expect(screen.getByText('web, sms, email')).toBeInTheDocument()
    })
  })

  //Severity styling -- border colour must reflect urgency level
  describe('Severity styling', () => {
    test('high severity renders orange border', () => {
      //Orange border signals a serious but not critical alert
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'high' })} />)
      const card = container.firstChild as HTMLElement // root div of the card
      expect(card.className).toContain('border-orange-200')
    })

    test('medium severity renders amber border', () => {
      //Amber (yellow-orange) is used for moderate-urgency alerts
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'medium' })} />)
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-amber-200')
    })

    test('low severity renders blue border', () => {
      //Blue border indicates informational / low-urgency alerts
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'low' })} />)
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-blue-200')
    })

    test('getSeverityBorderClass returns correct classes', () => {
      //Unit-test the helper function directly to confirm its mapping table is correct
 expect(getSeverityBorderClass('high')).toContain('red') // high -> red
 expect(getSeverityBorderClass('medium')).toContain('amber') // medium -> amber
 expect(getSeverityBorderClass('low')).toContain('blue') // low -> blue
 expect(getSeverityBorderClass('unknown')).toBe('') // unknown -> empty string (no border)
    })
  })

  //Dismiss handler -- optional close button passes the alert ID back to the parent
  describe('Dismiss handler', () => {
    test('renders dismiss button when onDismiss provided', () => {
      //If the parent supplies an onDismiss handler, a close (×) button should appear
      const onDismiss = vi.fn()
      render(<AlertCard alert={makeAlert()} onDismiss={onDismiss} />)
      const dismissBtn = screen.getByLabelText('alertCard.dismiss') // aria-label = i18n key
      expect(dismissBtn).toBeInTheDocument()
    })

    test('calls onDismiss with alert id on click', () => {
      //Clicking the dismiss button must call the callback with the correct alert ID
      const onDismiss = vi.fn()
      render(<AlertCard alert={makeAlert({ id: 'alert-42' })} onDismiss={onDismiss} />)
      fireEvent.click(screen.getByLabelText('alertCard.dismiss'))
      expect(onDismiss).toHaveBeenCalledWith('alert-42') // ID matches the alert fixture
    })

    test('does not render dismiss button when onDismiss omitted', () => {
      //Without a handler there is nothing to call -- the button must not appear at all
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.queryByLabelText('alertCard.dismiss')).not.toBeInTheDocument()
    })
  })

  //Accessibility -- alert cards must work for screen reader users
  describe('Accessibility', () => {
    test('card has role=alert', () => {
      //role=alert triggers live-region announcement so screen reader users hear the alert immediately
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    test('dismiss button has accessible label', () => {
      //The dismiss button must have an aria-label so screen reader users know what it does
      const onDismiss = vi.fn()
      render(<AlertCard alert={makeAlert()} onDismiss={onDismiss} />)
      const btn = screen.getByLabelText('alertCard.dismiss')
      expect(btn.tagName).toBe('BUTTON') // confirm it's an actual button element
    })
  })

  //Edge cases -- robustness checks against unusual but valid inputs
  describe('Edge cases', () => {
    test('renders with no channels', () => {
      //Empty channels array is valid; card must still render without crashing
      render(<AlertCard alert={makeAlert({ channels: [] })} />)
      expect(screen.getByText('Flood Warning')).toBeInTheDocument()
    })

    test('renders with critical severity (no specific styling)', () => {
      // 'critical' may not have a dedicated style rule; card must still mount
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'critical' as any })} />)
      const card = container.firstChild as HTMLElement
      expect(card).toBeInTheDocument()
    })

    test('renders with long title and message', () => {
      //Extremely long strings must not break layout or throw; overflow is handled by CSS
      const longTitle = 'A'.repeat(200)
      const longMsg = 'B'.repeat(1000)
      render(<AlertCard alert={makeAlert({ title: longTitle, message: longMsg })} />)
      expect(screen.getByText(longTitle)).toBeInTheDocument()
      expect(screen.getByText(longMsg)).toBeInTheDocument()
    })
  })
})

