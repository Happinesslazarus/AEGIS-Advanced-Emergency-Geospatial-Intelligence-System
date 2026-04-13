/**
 * Module: error-boundary.test.tsx
 *
 * Tests for the ErrorBoundary component — a React class component that wraps any
 * section of the UI and catches JavaScript errors thrown during rendering or
 * in lifecycle methods, preventing a single crash from taking down the whole page.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   render()                = mounts a React component into a jsdom DOM
 *   screen                  = queries the jsdom DOM for elements
 *   fireEvent.click()       = dispatches a synthetic mouse-click event
 *   waitFor()               = repeatedly checks an assertion until it passes (async)
 *   beforeEach/afterEach    = setup/teardown that runs before/after every test
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.mock()               = replaces a module import with a controlled fake
 *   vi.clearAllMocks()      = resets call counts between tests
 *   Error Boundary          = React mechanism (class componentDidCatch) that catches
 *                             errors in child component trees without crashing the app
 *   componentDidCatch()     = React lifecycle method called when a child throws;
 *                             receives the error and{ componentStack } info
 *   componentStack          = string traceback showing which React components caused
 *                             the error (like a stack trace but for component trees)
 *   Sentry                  = third-party error-monitoring service; errors are sent
 *                             there in production so developers can investigate
 *   withScope()             = Sentry API that creates a temporary context to attach
 *                             metadata tags before capturing an error
 *   captureException()      = Sentry API that sends the error to the Sentry dashboard
 *   correlation ID          = unique UUID generated per error occurrence so support
 *                             teams can match a user report to a Sentry log entry
 *   setTag/setContext/setFingerprint = Sentry scope helpers to label the error
 *                             (fingerprint deduplicates repeated errors)
 *   fallback prop           = optional alternative UI to show instead of the default
 *                             error card; can be a JSX node or a function (error, reset)=>JSX
 *   fullPage prop           = when true, shows the dedicated ErrorPage instead of an inline card
 *   onError callback        = optional prop; called with (error, info, correlationId) so
 *                             the parent component can react to the failure
 *   role=alert              = ARIA landmark announcing the error message to screen readers
 *   t: (key) => key         = i18n mock that returns the raw translation key; assertions
 *                             check key strings like 'shared.error.title' directly
 *   data-testid             = HTML attribute used to select elements in tests without
 *                             depending on visible text or CSS classes
 *   ThrowingComponent       = helper component that always throws; simulates a broken subtree
 *   ThrowOnClick            = helper component that throws only after a button click;
 *                             simulates a runtime interaction error
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import ErrorBoundary from '../components/shared/ErrorBoundary'

// ---------------------------------------------------------------------------
// Mock @sentry/react — prevent real network calls during tests
// ---------------------------------------------------------------------------
vi.mock('@sentry/react', () => ({
  // withScope creates a temporary Sentry context; mock accepts a callback like the real API
  withScope: vi.fn((callback) => callback({
    setTag: vi.fn(),       // labels the error (e.g. boundaryName: 'Header')
    setContext: vi.fn(),   // attaches structured data (e.g. component props)
    setFingerprint: vi.fn(), // groups similar errors together in the Sentry dashboard
  })),
  captureException: vi.fn(), // records the exception — normally sends to Sentry servers
}))

// Mock i18n — return the translation key as plain text so assertions can check keys directly
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
}))

// Mock ErrorPage — replaces the full-page error route with a simple test stub
vi.mock('../pages/ErrorPage', () => ({
  default: () => <div data-testid="error-page">Error Page</div>,
}))

// ---------------------------------------------------------------------------
// Test-helper components
// ---------------------------------------------------------------------------

// Always throws on render — simulates a broken child subtree
function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error') // caught by the wrapping ErrorBoundary
  }
  return <div>Normal content</div>
}

// Throws only after a button click — simulates a runtime interaction error
function ThrowOnClick() {
  const [shouldThrow, setShouldThrow] = React.useState(false)
  
  if (shouldThrow) {
    throw new Error('Clicked error') // re-renders with throw after state update
  }
  
  return (
    <button onClick={() => setShouldThrow(true)}>
      Click to throw
    </button>
  )
}

// ---------------------------------------------------------------------------
// ErrorBoundary core tests
// ---------------------------------------------------------------------------
describe('ErrorBoundary', () => {
  // Save and restore the real console.error; suppress expected "caught error" logs during tests
  const originalError = console.error
  
  beforeEach(() => {
    console.error = vi.fn() // silence React's own error output in test runner
  })
  
  afterEach(() => {
    console.error = originalError // restore so non-ErrorBoundary tests still see errors
    vi.clearAllMocks()
  })

  test('renders children when no error', () => {
    // Happy path: no error thrown, children should appear unchanged
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    )
    
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  test('catches error and shows error UI', () => {
    // When a child throws, the error boundary replaces it with the error card
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    // Original child content must be hidden
    expect(screen.queryByText('Normal content')).not.toBeInTheDocument()
    // i18n key rendered as-is because we mocked t() to return the key
    expect(screen.getByText('shared.error.title')).toBeInTheDocument()
  })

  test('shows retry button with attempt counter', () => {
    // The error card includes a "Try again" button so the user can attempt recovery
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    // Button text is the i18n key (t() returns key) — checking the key proves the label is wired up
    expect(screen.getByRole('button')).toHaveTextContent('error.tryAgain')
  })

  test('displays error message', () => {
    // The error's own message string must be shown so the user (or support) can see what went wrong
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByText('Test error')).toBeInTheDocument()
  })

  test('shows correlation ID', () => {
    // Each error occurrence gets a unique UUID (correlation ID) so logs can be matched to Sentry
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    // Rendered text is "error.correlationId: <uuid>"; regex checks the key prefix
    expect(screen.getByText(/error\.correlationId/)).toBeInTheDocument()
  })

  test('uses custom fallback function', () => {
    // The fallback prop can be a function (error, resetFn) => JSX for fully custom error UI
    const customFallback = (error: Error, reset: () => void) => (
      <div>
        <span data-testid="custom-error">Custom: {error.message}</span>
        <button onClick={reset}>Custom Reset</button>
      </div>
    )
    
    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    // Custom UI is shown, not the default error card
    expect(screen.getByTestId('custom-error')).toHaveTextContent('Custom: Test error')
    expect(screen.getByText('Custom Reset')).toBeInTheDocument()
  })

  test('uses custom fallback node', () => {
    // The fallback prop can also be a plain JSX node (no access to error details)
    render(
      <ErrorBoundary fallback={<div data-testid="simple-fallback">Simple Error</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByTestId('simple-fallback')).toBeInTheDocument()
  })

  test('shows full page error when fullPage prop is true', () => {
    // fullPage=true replaces the entire viewport with the dedicated ErrorPage route
    render(
      <ErrorBoundary fullPage>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByTestId('error-page')).toBeInTheDocument()
  })

  test('calls onError callback', () => {
    // The onError prop lets parent components react to failures (e.g. log to analytics)
    const onError = vi.fn()
    
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    // Called with the Error object, componentStack info, and the correlation UUID
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
      expect.any(String) // correlation ID UUID
    )
  })

  test('logs error to console', () => {
    // ErrorBoundary should call console.error so developers see the stack in the browser console
    render(
      <ErrorBoundary name="TestBoundary">
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(console.error).toHaveBeenCalled()
  })

  test('reports error to Sentry', async () => {
    // In production, errors must be forwarded to Sentry for monitoring and alerting
    const Sentry = await import('@sentry/react')
    
    render(
      <ErrorBoundary name="SentryTest">
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(Sentry.withScope).toHaveBeenCalled()      // context/tags were set
    expect(Sentry.captureException).toHaveBeenCalled() // error was transmitted
  })

  test('handles runtime errors from interactions', async () => {
    // Errors don't only happen on initial render — user interactions can cause them too
    render(
      <ErrorBoundary>
        <ThrowOnClick />
      </ErrorBoundary>
    )
    
    fireEvent.click(screen.getByText('Click to throw')) // triggers state update → re-render → throw
    
    // waitFor repeatedly polls until the error UI appears (React processes the error asynchronously)
    await waitFor(() => {
      expect(screen.getByText('shared.error.title')).toBeInTheDocument()
    })
  })

  test('shows section crashed message', () => {
    // A secondary message tells the user that this particular section crashed (not the whole app)
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByText('error.sectionCrashed')).toBeInTheDocument()
  })

  test('has role=alert for accessibility', () => {
    // ARIA role=alert tells screen readers to announce the error immediately to the user
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Nested ErrorBoundary tests — boundaries are composable; inner catches its own errors
// ---------------------------------------------------------------------------
describe('Nested ErrorBoundary', () => {
  const originalError = console.error
  
  beforeEach(() => {
    console.error = vi.fn() // silence expected error output
  })
  
  afterEach(() => {
    console.error = originalError
  })

  test('inner boundary catches its own errors', () => {
    // An outer boundary wrapping an inner boundary: the inner error must not
    // propagate upward and destroy the outer boundary's healthy children
    render(
      <ErrorBoundary name="Outer">
        <div>Outer content</div>
        <ErrorBoundary name="Inner">
          <ThrowingComponent />   {/* only the inner subtree crashes */}
        </ErrorBoundary>
      </ErrorBoundary>
    )
    
    // Outer content is unaffected — it still renders normally
    expect(screen.getByText('Outer content')).toBeInTheDocument()
    // Inner boundary's error card is visible
    expect(screen.getByText('shared.error.title')).toBeInTheDocument()
  })
})
