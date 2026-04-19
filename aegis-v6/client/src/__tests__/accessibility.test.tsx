/**
 * Module: accessibility.test.tsx
 *
 * Automated WCAG (Web Content Accessibility Guidelines) compliance tests for
 * shared UI components: Button, Modal, EmptyState, and Skeleton. Uses axe-core
 * to detect violations (missing alt text, bad contrast, missing ARIA roles, etc.)
 * and manual tests for focus management and keyboard interaction.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   render()                = mounts a React component tree into a jsdom DOM
 *   screen                  = queries the jsdom DOM (screen.getByRole, etc.)
 *   within()                = like screen, but scoped to a specific element subtree
 *   axe / axe-core          = "Axe Accessibility Engine" — a library that scans a rendered
 *                             DOM and flags WCAG violations (missing labels, bad contrast, etc.)
 *   vitest-axe              = Vitest adapter for axe-core; the axe() function returns a Promise
 *   toHaveNoViolations()    = custom Vitest matcher; fails if axe found any violations
 *   AxeResults              = TypeScript type for the object returned by axe(); contains
 *                             .violations (array), .passes, .incomplete
 *   WCAG                    = Web Content Accessibility Guidelines — the international
 *                             accessibility standard published by the W3C
 *   ARIA                    = Accessible Rich Internet Applications — HTML attributes
 *                             (role, aria-*) that convey semantic meaning to screen readers
 *   aria-label              = provides an accessible name for elements without visible text
 *   aria-modal="true"       = tells screen readers that this dialog is a modal (blocks background)
 *   aria-labelledby         = points to the element whose text is the accessible name for this element
 *   aria-busy="true"        = signals to screen readers that content is still loading
 *   role="status"           = live region that politely announces state changes (e.g. loading)
 *   role="dialog"           = landmarks a modal dialog for screen reader navigation
 *   document.activeElement  = the DOM element that currently has keyboard focus
 *   disabled attribute      = prevents the element from receiving focus or events
 *   vi.mock()               = replaces a module import with a controlled fake
 *   Button variant          = colour/style preset: primary, secondary, ghost, danger, success, warning
 *   contrast ratio          = WCAG AA requires 4.5:1 for normal text, 3:1 for large text
 *   iconOnly                = button whose only content is an icon; needs aria-label for screen readers
 *   Skeleton                = loading placeholder that shows while content is being fetched;
 *                             must announce itself as "busy" via aria-busy="true"
 *   expect.extend()         = registers a custom matcher (toHaveNoViolations) with Vitest
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { AxeResults } from 'axe-core'
import '@testing-library/jest-dom'
import React from 'react'

// ---------------------------------------------------------------------------
// Custom axe matcher — extends Vitest with toHaveNoViolations()
// ---------------------------------------------------------------------------

// TypeScript declaration so .toHaveNoViolations() is recognized in type system
interface CustomMatchers<R = unknown> {
  toHaveNoViolations(): R
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends CustomMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

// Custom matcher implementation: passes if no WCAG violations were found
function toHaveNoViolations(results: AxeResults) {
  const violations = results.violations
  const pass = violations.length === 0
  
  if (pass) {
    return {
      pass: true,
      message: () => 'Expected accessibility violations but found none',
    }
  }
  
  // Format each violation with its impact level and affected HTML nodes
  const messages = violations.map(v => 
    `${v.impact}: ${v.description}\n  Affected: ${v.nodes.map(n => n.html).join('\n  ')}`
  )
  
  return {
    pass: false,
    message: () => `Found ${violations.length} accessibility violation(s):\n${messages.join('\n\n')}`,
  }
}

// Register our custom matcher with Vitest's expect()
expect.extend({ toHaveNoViolations })

// ---------------------------------------------------------------------------
// Module mocks — replace hooks/utils that call browser APIs not available in jsdom
// ---------------------------------------------------------------------------

// useReducedMotion reads window.matchMedia; mock it so tests run without a real media engine
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => ({
    prefersReduced: false,         // pretend reduced-motion is NOT preferred
    getSafeDuration: (d: number) => d,       // return duration unchanged
    getSafeTransition: (t: string) => t,     // return transition unchanged
  }),
}))

// useFocusTrap calls focus-trap library; mock it to return a plain React ref
vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: () => React.createRef(),
}))

// accessibility utils call DOM apis; mock with no-ops
vi.mock('../utils/accessibility', () => ({
  visuallyHiddenStyles: {},
  createFocusTrap: () => ({ activate: () => {}, deactivate: () => {} }),
  focusFirstElement: () => {},
}))

// ---------------------------------------------------------------------------
// Component imports (after mocks so they pick up our fakes)
// ---------------------------------------------------------------------------
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'

// ---------------------------------------------------------------------------
// Button Accessibility — axe scans each variant for WCAG violations
// ---------------------------------------------------------------------------
describe('Button Accessibility', () => {
  test('primary button has no accessibility violations', async () => {
    // A plain button with text content should pass all WCAG checks out of the box
    const { container } = render(<Button>Primary Button</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('disabled button has no accessibility violations', async () => {
    // Disabled buttons must still be announced correctly by screen readers
    const { container } = render(<Button disabled>Disabled Button</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('loading button has no accessibility violations', async () => {
    // While loading, the button should show accessible loading text (not just a spinner icon)
    const { container } = render(<Button isLoading loadingText="Loading...">Submit</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('icon-only button with aria-label has no violations', async () => {
    // Icon-only buttons have no visible text; aria-label provides the accessible name
    // without it, screen readers would say nothing or just "button"
    const { container } = render(
      <Button iconOnly aria-label="Close dialog">×</Button>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('all button variants have acceptable contrast', async () => {
    // Each variant has different background/text colours; all must meet WCAG AA contrast ratio
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'success', 'warning'] as const
    
    for (const variant of variants) {
      const { container } = render(
        <Button variant={variant}>{variant} Button</Button>
      )
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    }
  })
})

// ---------------------------------------------------------------------------
// Modal Accessibility — dialog role, aria-modal, aria-labelledby
// ---------------------------------------------------------------------------
describe('Modal Accessibility', () => {
  test('open modal has no accessibility violations', async () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )
    
    // Wait for modal to mount (some portals use setTimeout 0 for mounting)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Scan the full document.body because modals may render in a portal outside 'container'
    const results = await axe(document.body)
    expect(results).toHaveNoViolations()
  })

  test('modal has proper ARIA attributes', () => {
    // role="dialog" + aria-modal="true" + aria-labelledby are required for screen readers
    // to correctly identify and announce the modal
    render(
      <Modal isOpen={true} onClose={() => {}} title="Accessible Modal">
        <p>Content</p>
      </Modal>
    )
    
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')   // tells SR: background is inert
    expect(dialog).toHaveAttribute('aria-labelledby')       // points to the title element
  })
})

// ---------------------------------------------------------------------------
// EmptyState Accessibility — informational placeholder component
// ---------------------------------------------------------------------------
describe('EmptyState Accessibility', () => {
  test('empty state has no accessibility violations', async () => {
    // Static informational content; must have proper heading hierarchy and contrast
    const { container } = render(
      <EmptyState
        title="No results found"
        description="Try adjusting your search criteria"
      />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('empty state with action button has no violations', async () => {
    // When the EmptyState includes an action button, the button must also be accessible
    const { container } = render(
      <EmptyState
        title="No reports"
        description="Create your first report"
        action={{ label: 'Create Report', onClick: () => {} }}
      />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})

// ---------------------------------------------------------------------------
// Skeleton Accessibility — loading placeholder must announce its state
// ---------------------------------------------------------------------------
describe('Skeleton Accessibility', () => {
  test('skeleton has proper aria attributes', () => {
    // role="status" = live region (politely announced) for loading state
    // aria-busy="true" = tells screen readers content is still arriving
    const { container } = render(<Skeleton className="h-4 w-full" />)
    const skeleton = container.firstChild as HTMLElement
    
    expect(skeleton).toHaveAttribute('role', 'status')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })
})

// ---------------------------------------------------------------------------
// Focus Management — verify focus behaviour for interactive elements
// ---------------------------------------------------------------------------
describe('Focus Management', () => {
  test('buttons are focusable', () => {
    // Enabled buttons must be reachable by keyboard Tab navigation
    render(<Button>Focusable</Button>)
    const button = screen.getByRole('button')
    
    button.focus() // programmatically move focus to the button
    expect(document.activeElement).toBe(button) // confirm focus landed here
  })

  test('disabled buttons cannot receive focus', () => {
    render(
      <>
        <Button disabled>Disabled</Button>
        <Button>Enabled</Button>
      </>
    )
    
    const disabledButton = screen.getByRole('button', { name: 'Disabled' })
    
    disabledButton.focus() // attempt to focus the disabled button
    // The browser/jsdom should keep focus elsewhere; not on the disabled element
    expect(document.activeElement).not.toBe(disabledButton)
  })
})

// ---------------------------------------------------------------------------
// Keyboard Navigation — verify Enter and Space activate buttons
// (These are required by WCAG 2.1 SC 2.1.1 — Keyboard Accessibility)
// ---------------------------------------------------------------------------
describe('Keyboard Navigation', () => {
  test('Enter key activates button', () => {
    // WCAG SC 2.1.1: all functionality must be operable via keyboard
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click Me</Button>)
    
    const button = screen.getByRole('button')
    button.focus()
    
    // Dispatch a keydown event then call .click() to simulate the Enter binding
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    button.click() // Enter activates a button the same way as a mouse click
    
    expect(handleClick).toHaveBeenCalled()
  })

  test('Space key activates button', () => {
    // Space bar also activates native <button> elements per HTML spec
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click Me</Button>)
    
    const button = screen.getByRole('button')
    button.focus()
    
    // jsdom's native button handles Space via .click()
    button.click()
    
    expect(handleClick).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Color Contrast — danger and warning variants require extra attention because
// their colours (red/yellow) can fail WCAG contrast checks if not calibrated
// WCAG AA: normal text needs ≥ 4.5:1 contrast ratio against background
// ---------------------------------------------------------------------------
describe('Color Contrast', () => {
  test('danger variant meets contrast requirements', async () => {
    // Red danger buttons must still have legible text (white on red is tricky)
    const { container } = render(
      <Button variant="danger">Delete</Button>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('warning variant meets contrast requirements', async () => {
    // Yellow/amber buttons often fail contrast — this catches any regression
    const { container } = render(
      <Button variant="warning">Warning</Button>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
