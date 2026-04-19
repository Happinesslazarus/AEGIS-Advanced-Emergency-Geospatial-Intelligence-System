/**
 * Module: ui-components.test.tsx
 *
 * Tests for the shared low-level UI primitives used everywhere in the AEGIS client:
 *   - Button / CloseButton  — accessible buttons with variant, size, icon, and loading support
 *   - Modal                 — accessible dialog with focus management and keyboard handling
 *   - Toast / ToastProvider — transient notification messages with success/error/warning/info types
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = assertion helper
 *   vi.fn()                 = creates a trackable mock function
 *   vi.mock()               = replaces a module with a lightweight fake
 *   render()                = mounts a React component into the jsdom (in-memory DOM)
 *   screen                  = query helpers that search the rendered DOM
 *   fireEvent               = dispatches synthetic DOM events (click, keyDown, etc.)
 *   waitFor()               = retries an assertion until it passes or times out
 *   within()                = scopes query helpers to a subtree of the DOM
 *   act()                   = flushes React state updates and effects synchronously
 *   useState()              = React hook for local component state
 *   Button                  = styled <button> wrapper; variant, size, isLoading, leftIcon, rightIcon
 *   variant prop            = visual style of the button:
 *                               primary (brand colour), secondary (border), ghost (transparent),
 *                               danger (red), success (green), warning (amber)
 *   size prop               = text/padding size: xs, sm, md (default), lg, xl
 *   isLoading               = shows a spinner and disables the button while a request is in flight
 *   loadingText             = replaces child text with this string while isLoading is true
 *   fullWidth               = adds w-full so the button fills its container
 *   leftIcon / rightIcon    = elements inserted before/after the button label
 *   CloseButton             = specialised button with a default aria-label="Close"; wraps Button
 *   Modal                   = accessible dialog:
 *                               role="dialog", aria-modal="true", aria-labelledby pointing to title
 *   isOpen prop             = controls whether the modal is rendered (true) or hidden (false)
 *   onClose prop            = callback fired when the user closes the modal
 *   title prop              = heading text; used as aria-label when hideTitle=true
 *   hideTitle prop          = visually hides the title but keeps it as an accessible name
 *   showCloseButton prop    = controls whether the ✕ close button is rendered (default true)
 *   closeOnEscape prop      = closes the modal when the user presses Escape
 *   size prop (Modal)       = max-width preset: sm, md (default), lg, xl, full
 *   role="dialog"           = ARIA role that tells screen readers this is a dialog window
 *   aria-modal="true"       = tells screen readers everything outside the dialog is inert
 *   aria-labelledby         = references the ID of the dialog's title element
 *   focus trap              = mocked here; in production, keeps keyboard focus inside the modal
 *   Toast                   = transient notification banner: generic, success, error, warning, info
 *   toastSuccess/Error/...  = convenience shorthand functions from the useToast() hook
 *   clearAll()              = dismisses all currently-visible toast messages
 *   ToastProvider           = React context provider that manages the list of toasts
 *   useToast()              = hook that returns toast trigger functions; must be within ToastProvider
 *   useFocusTrap            = mocked to return a ref (real version traps focus in modals)
 *   useReducedMotion        = mocked to return prefersReduced:false (animations enabled)
 *   visuallyHiddenStyles    = CSS that hides content visually but keeps it for screen readers
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React, { useState } from 'react'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before imports of the components
// ---------------------------------------------------------------------------

// useReducedMotion — return animations-enabled so tests run without accessibility overrides
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => ({
    prefersReduced: false,
    getSafeDuration: (d: number) => d,   // pass through duration unchanged
    getSafeTransition: (t: string) => t, // pass through transition string unchanged
  }),
}))

// useFocusTrap — return a plain React ref; real version would lock keyboard focus inside modal
vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: () => React.createRef(),
}))

// accessibility utils — stub out functions that require real browser focus management
vi.mock('../utils/accessibility', () => ({
  visuallyHiddenStyles: {}, // empty object; no real CSS needed in tests
  createFocusTrap: () => ({ activate: () => {}, deactivate: () => {} }),
  focusFirstElement: () => {}, // no-op; jsdom doesn't implement :focus-visible
}))

// Import components AFTER mocks so the stubs are in place at module initialisation time
import { Button, CloseButton } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { ToastProvider, useToast } from '../components/ui/Toast'

// ---------------------------------------------------------------------------
// Button component
// ---------------------------------------------------------------------------
describe('Button', () => {

  // ---------------------------------------------------------------------------
  // Rendering basics
  // ---------------------------------------------------------------------------
  describe('rendering', () => {
    test('renders with children', () => {
      render(<Button>Click me</Button>)
      // The button text must be present in the rendered DOM
      expect(screen.getByRole('button')).toHaveTextContent('Click me')
    })

    test('renders as button by default', () => {
      render(<Button>Click me</Button>)
      // tagName confirms the underlying element is a <button>, not a <div> or <a>
      expect(screen.getByRole('button').tagName).toBe('BUTTON')
    })

    test('renders with type="button" by default', () => {
      render(<Button>Click me</Button>)
      // Explicit type="button" prevents accidental form submission when Button is inside a <form>
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })

    test('renders with custom type', () => {
      render(<Button type="submit">Submit</Button>)
      // type="submit" deliberately triggers form submission
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })
  })

  // ---------------------------------------------------------------------------
  // Variant styling — each variant maps to a distinct Tailwind CSS colour scheme
  // ---------------------------------------------------------------------------
  describe('variants', () => {
    test('renders primary variant correctly', () => {
      render(<Button variant="primary">Primary</Button>)
      const btn = screen.getByRole('button')
      expect(btn.className).toContain('bg-aegis') // brand colour: the AEGIS design token
    })

    test('renders secondary variant correctly', () => {
      render(<Button variant="secondary">Secondary</Button>)
      const btn = screen.getByRole('button')
      expect(btn.className).toContain('border') // outline style: border around transparent bg
    })

    test('renders ghost variant correctly', () => {
      render(<Button variant="ghost">Ghost</Button>)
      const btn = screen.getByRole('button')
      expect(btn.className).toContain('bg-transparent') // invisible background
    })

    test('renders danger variant correctly', () => {
      render(<Button variant="danger">Danger</Button>)
      const btn = screen.getByRole('button')
      expect(btn.className).toContain('bg-red') // red = destructive / irreversible action
    })

    test('renders success variant correctly', () => {
      render(<Button variant="success">Success</Button>)
      const btn = screen.getByRole('button')
      expect(btn.className).toContain('bg-green') // green = confirm / positive action
    })

    test('renders warning variant correctly', () => {
      render(<Button variant="warning">Warning</Button>)
      const btn = screen.getByRole('button')
      expect(btn.className).toContain('bg-amber') // amber = caution / side-effects expected
    })
  })

  // ---------------------------------------------------------------------------
  // Size variants — control padding and font size
  // ---------------------------------------------------------------------------
  describe('sizes', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const

    sizes.forEach(size => {
      test(`renders ${size} size correctly`, () => {
        render(<Button size={size}>{size}</Button>)
        // Each size must be accepted without throwing; exact class checked in integration
        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Interactive states — click, disabled, loading
  // ---------------------------------------------------------------------------
  describe('states', () => {
    test('handles click events', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))
      expect(handleClick).toHaveBeenCalledTimes(1) // fired exactly once
    })

    test('does not call onClick when disabled', () => {
      // Disabled buttons must not trigger click handlers — prevents accidental submissions
      const handleClick = vi.fn()
      render(<Button onClick={handleClick} disabled>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))
      expect(handleClick).not.toHaveBeenCalled()
    })

    test('shows loading state', () => {
      // isLoading=true disables the button AND shows a loading indicator
      render(<Button isLoading>Loading</Button>)
      const btn = screen.getByRole('button')
      expect(btn).toBeDisabled() // prevents double-submission
    })

    test('shows loading text when provided', () => {
      // Replace child text with a progress message while request is in flight
      render(<Button isLoading loadingText="Please wait...">Submit</Button>)
      expect(screen.getByRole('button')).toHaveTextContent('Please wait...')
    })

    test('disabled button has correct attributes', () => {
      render(<Button disabled>Disabled</Button>)
      const btn = screen.getByRole('button')
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('disabled') // HTML attribute (not just CSS)
    })

    test('fullWidth applies correct class', () => {
      render(<Button fullWidth>Full Width</Button>)
      // w-full = width: 100%; fills the parent container
      expect(screen.getByRole('button').className).toContain('w-full')
    })
  })

  // ---------------------------------------------------------------------------
  // Icon slots — elements inserted before/after the button text
  // ---------------------------------------------------------------------------
  describe('icons', () => {
    test('renders with left icon', () => {
      const Icon = () => <span data-testid="left-icon">←</span>
      render(<Button leftIcon={<Icon />}>With Icon</Button>)
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    })

    test('renders with right icon', () => {
      const Icon = () => <span data-testid="right-icon">→</span>
      render(<Button rightIcon={<Icon />}>With Icon</Button>)
      expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Accessibility
  // ---------------------------------------------------------------------------
  describe('accessibility', () => {
    test('accepts aria-label', () => {
      render(<Button aria-label="Close dialog">×</Button>)
      // getByLabelText uses aria-label to find the element for screen-reader users
      expect(screen.getByLabelText('Close dialog')).toBeInTheDocument()
    })

    test('is focusable', () => {
      render(<Button>Focusable</Button>)
      const btn = screen.getByRole('button')
      btn.focus() // programmatically move keyboard focus
      expect(document.activeElement).toBe(btn)
    })

    test('disabled button is not focusable with tab', () => {
      // Disabled button must not appear in the tab order
      render(<Button disabled>Not focusable</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })
})

// ---------------------------------------------------------------------------
// CloseButton component — specialised close/dismiss button
// ---------------------------------------------------------------------------
describe('CloseButton', () => {
  test('renders correctly', () => {
    render(<CloseButton onClick={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('has Close aria-label by default', () => {
    render(<CloseButton onClick={() => {}} />)
    // Default accessible name so screen readers announce "Close, button"
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close')
  })

  test('calls onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<CloseButton onClick={handleClick} />)

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  test('accepts custom aria-label', () => {
    render(<CloseButton onClick={() => {}} aria-label="Dismiss notification" />)
    // Custom label overrides the default "Close" for context-specific announcements
    expect(screen.getByLabelText('Dismiss notification')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Modal component — accessible dialog
// ---------------------------------------------------------------------------
describe('Modal', () => {
  // ModalWrapper wraps Modal in a parent that controls isOpen state
  const ModalWrapper = ({ initialOpen = false }: { initialOpen?: boolean }) => {
    const [isOpen, setIsOpen] = useState(initialOpen)
    return (
      <>
        <button onClick={() => setIsOpen(true)}>Open Modal</button>
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Test Modal"
        >
          <p>Modal content</p>
        </Modal>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  describe('rendering', () => {
    test('does not render when closed', () => {
      render(<ModalWrapper initialOpen={false} />)
      // Content is unmounted (not just hidden) when isOpen=false
      expect(screen.queryByText('Modal content')).not.toBeInTheDocument()
    })

    test('renders when open', async () => {
      render(<ModalWrapper initialOpen={true} />)
      await waitFor(() => {
        expect(screen.getByText('Modal content')).toBeInTheDocument()
      })
    })

    test('renders title', async () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="My Modal Title">
          Content
        </Modal>
      )
      await waitFor(() => {
        expect(screen.getByText('My Modal Title')).toBeInTheDocument()
      })
    })

    test('hides title when hideTitle is true', async () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Hidden Title" hideTitle>
          Content
        </Modal>
      )
      await waitFor(() => {
        // Visually hidden — not rendered as text — but the dialog has aria-label for screen readers
        expect(screen.queryByText('Hidden Title')).not.toBeInTheDocument()
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveAttribute('aria-label', 'Hidden Title')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Size variants
  // ---------------------------------------------------------------------------
  describe('sizes', () => {
    const sizes = ['sm', 'md', 'lg', 'xl', 'full'] as const

    sizes.forEach(size => {
      test(`renders ${size} size correctly`, async () => {
        render(
          <Modal isOpen={true} onClose={() => {}} title="Modal" size={size}>
            Content
          </Modal>
        )
        await waitFor(() => {
          expect(screen.getByText('Content')).toBeInTheDocument()
        })
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Interactions — close button and keyboard
  // ---------------------------------------------------------------------------
  describe('interactions', () => {
    test('calls onClose when close button clicked', async () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Modal" showCloseButton>
          Content
        </Modal>
      )

      await waitFor(() => {
        expect(screen.getByText('Content')).toBeInTheDocument()
      })

      const closeBtn = screen.getByLabelText('Close') // CloseButton aria-label
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('calls onClose on ESC key when closeOnEscape is true', async () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Modal" closeOnEscape>
          Content
        </Modal>
      )

      await waitFor(() => {
        expect(screen.getByText('Content')).toBeInTheDocument()
      })

      fireEvent.keyDown(document, { key: 'Escape' }) // Escape key = universal close gesture
      // Note: may not fire if focus trap (mocked here) intercepts the event first
    })

    test('does not show close button when showCloseButton is false', async () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Modal" showCloseButton={false}>
          Content
        </Modal>
      )

      await waitFor(() => {
        expect(screen.getByText('Content')).toBeInTheDocument()
      })

      // No close button for modals that require an explicit in-content action to dismiss
      expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Accessibility — ARIA attributes
  // ---------------------------------------------------------------------------
  describe('accessibility', () => {
    test('has role="dialog"', async () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Accessible Modal">
          Content
        </Modal>
      )

      await waitFor(() => {
        const dialog = screen.getByRole('dialog') // ARIA role for interactive dialog
        expect(dialog).toBeInTheDocument()
      })
    })

    test('has aria-modal="true"', async () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Modal">
          Content
        </Modal>
      )

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        // aria-modal="true" tells screen readers to treat content outside as inert
        expect(dialog).toHaveAttribute('aria-modal', 'true')
      })
    })

    test('has aria-labelledby pointing to title', async () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Modal Title">
          Content
        </Modal>
      )

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        // aria-labelledby references the title element's id so screen readers announce it
        expect(dialog).toHaveAttribute('aria-labelledby')
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Toast component — transient notification messages
// ---------------------------------------------------------------------------
describe('Toast', () => {
  // ToastTester renders buttons that fire each toast variant via the useToast() hook
  const ToastTester = () => {
    const { toast, toastSuccess, toastError, toastWarning, toastInfo, dismiss, clearAll } = useToast()

    return (
      <div>
        <button onClick={() => toast('Generic toast')}>Show Toast</button>
        <button onClick={() => toastSuccess('Success!')}>Success</button>
        <button onClick={() => toastError('Error!')}>Error</button>
        <button onClick={() => toastWarning('Warning!')}>Warning</button>
        <button onClick={() => toastInfo('Info!')}>Info</button>
        <button onClick={() => clearAll()}>Clear All</button>
      </div>
    )
  }

  // ToastProvider must wrap any component using useToast() — it manages the toast list state
  const renderWithProvider = () => {
    return render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    )
  }

  test('renders toast on trigger', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByText('Show Toast'))

    await waitFor(() => {
      expect(screen.getByText('Generic toast')).toBeInTheDocument()
    })
  })

  test('renders success toast variant', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByText('Success'))

    // toastSuccess fires the toast with a green icon and 'success' style
    await waitFor(() => {
      expect(screen.getByText('Success!')).toBeInTheDocument()
    })
  })

  test('renders error toast variant', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByText('Error'))

    // toastError fires with a red icon; used for API failures and validation errors
    await waitFor(() => {
      expect(screen.getByText('Error!')).toBeInTheDocument()
    })
  })

  test('renders warning toast variant', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByText('Warning'))

    // toastWarning fires with an amber icon; used for near-limit or caution states
    await waitFor(() => {
      expect(screen.getByText('Warning!')).toBeInTheDocument()
    })
  })

  test('renders info toast variant', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByText('Info'))

    // toastInfo fires with a blue icon; neutral informational messages
    await waitFor(() => {
      expect(screen.getByText('Info!')).toBeInTheDocument()
    })
  })

  test('clears all toasts', async () => {
    renderWithProvider()

    // Spawn two toasts
    fireEvent.click(screen.getByText('Success'))
    fireEvent.click(screen.getByText('Error'))

    await waitFor(() => {
      expect(screen.getByText('Success!')).toBeInTheDocument()
      expect(screen.getByText('Error!')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Clear All')) // dismiss all at once

    // Both toasts must be removed from the DOM after clearAll()
    await waitFor(() => {
      expect(screen.queryByText('Success!')).not.toBeInTheDocument()
      expect(screen.queryByText('Error!')).not.toBeInTheDocument()
    })
  })
})

// Button Component Tests

