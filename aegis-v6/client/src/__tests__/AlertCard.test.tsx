/**
 * AlertCard.test.tsx — Unit tests for the AlertCard presentation component
 *
 * Tests severity-based styling, dismiss handler, compact mode,
 * accessibility, channel display and time formatting.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { Alert } from '../types'

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
  onLanguageChange: () => () => {},
  isRtl: () => false,
}))

vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en',
}))

// Real helper since it's a pure function
import { getSeverityBorderClass } from '../utils/helpers'
import AlertCard from '../components/shared/AlertCard'

// Fixtures
const makeAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'alert-1',
  severity: 'high',
  title: 'Flood Warning',
  message: 'River Clyde expected to exceed safe levels',
  area: 'Glasgow City Centre',
  source: 'SEPA',
  timestamp: '2026-01-15T10:00:00Z',
  displayTime: '10:00 AM',
  active: true,
  channels: ['web', 'telegram'],
  disasterType: 'flood',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AlertCard', () => {
  describe('Rendering', () => {
    test('displays alert title', () => {
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.getByText('Flood Warning')).toBeInTheDocument()
    })

    test('displays alert message in normal mode', () => {
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.getByText(/River Clyde/)).toBeInTheDocument()
    })

    test('hides message in compact mode', () => {
      render(<AlertCard alert={makeAlert()} compact />)
      expect(screen.queryByText(/River Clyde/)).not.toBeInTheDocument()
    })

    test('displays formatted time', () => {
      render(<AlertCard alert={makeAlert({ displayTime: '2:30 PM' })} />)
      expect(screen.getByText('2:30 PM')).toBeInTheDocument()
    })

    test('displays channels', () => {
      render(<AlertCard alert={makeAlert({ channels: ['web', 'sms', 'email'] })} />)
      expect(screen.getByText('web, sms, email')).toBeInTheDocument()
    })
  })

  describe('Severity styling', () => {
    test('high severity renders red border', () => {
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'high' })} />)
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-l-red-500')
    })

    test('medium severity renders amber border', () => {
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'medium' })} />)
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-l-amber-500')
    })

    test('low severity renders blue border', () => {
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'low' })} />)
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-l-blue-500')
    })

    test('getSeverityBorderClass returns correct classes', () => {
      expect(getSeverityBorderClass('high')).toContain('red')
      expect(getSeverityBorderClass('medium')).toContain('amber')
      expect(getSeverityBorderClass('low')).toContain('blue')
      expect(getSeverityBorderClass('unknown')).toBe('')
    })
  })

  describe('Dismiss handler', () => {
    test('renders dismiss button when onDismiss provided', () => {
      const onDismiss = vi.fn()
      render(<AlertCard alert={makeAlert()} onDismiss={onDismiss} />)
      const dismissBtn = screen.getByLabelText('alertCard.dismiss')
      expect(dismissBtn).toBeInTheDocument()
    })

    test('calls onDismiss with alert id on click', () => {
      const onDismiss = vi.fn()
      render(<AlertCard alert={makeAlert({ id: 'alert-42' })} onDismiss={onDismiss} />)
      fireEvent.click(screen.getByLabelText('alertCard.dismiss'))
      expect(onDismiss).toHaveBeenCalledWith('alert-42')
    })

    test('does not render dismiss button when onDismiss omitted', () => {
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.queryByLabelText('alertCard.dismiss')).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    test('card has role=alert', () => {
      render(<AlertCard alert={makeAlert()} />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    test('dismiss button has accessible label', () => {
      const onDismiss = vi.fn()
      render(<AlertCard alert={makeAlert()} onDismiss={onDismiss} />)
      const btn = screen.getByLabelText('alertCard.dismiss')
      expect(btn.tagName).toBe('BUTTON')
    })
  })

  describe('Edge cases', () => {
    test('renders with no channels', () => {
      render(<AlertCard alert={makeAlert({ channels: [] })} />)
      expect(screen.getByText('Flood Warning')).toBeInTheDocument()
    })

    test('renders with critical severity (no specific styling)', () => {
      const { container } = render(<AlertCard alert={makeAlert({ severity: 'critical' as any })} />)
      const card = container.firstChild as HTMLElement
      // Unknown severity falls through to empty string from helper
      expect(card).toBeInTheDocument()
    })

    test('renders with long title and message', () => {
      const longTitle = 'A'.repeat(200)
      const longMsg = 'B'.repeat(1000)
      render(<AlertCard alert={makeAlert({ title: longTitle, message: longMsg })} />)
      expect(screen.getByText(longTitle)).toBeInTheDocument()
      expect(screen.getByText(longMsg)).toBeInTheDocument()
    })
  })
})
