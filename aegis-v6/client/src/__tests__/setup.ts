/**
 * Global test setup file — runs ONCE before any test suite via the `setupFiles`
 * option in vitest.config.ts.  Its job is to:
 *   1. Extend Jest/Vitest matchers with helpful DOM assertions (jest-dom)
 *   2. Stub browser APIs that jsdom (the test DOM) does not implement
 *   3. Suppress known, harmless React/API console warnings so test output stays clean
 *   4. Reset DOM state between tests
 *
 * jsdom is a JavaScript implementation of the browser DOM used by Vitest and Jest
 * when tests run in Node.js.  It does not implement every browser API, so stubs
 * (fake implementations) are needed for anything the real browser provides.
 *
 * Glossary:
 *   @testing-library/jest-dom = adds custom matchers: toBeInTheDocument(),
 *                               toHaveAttribute(), toHaveTextContent(), etc.
 *   matchMedia()              = browser function that tests CSS media queries
 *                               (e.g. prefers-reduced-motion); jsdom has no real
 *                               display so it does nothing — mocked here
 *   ResizeObserver            = browser API for watching element size changes;
 *                               not available in jsdom — mocked with empty methods
 *   IntersectionObserver      = browser API for detecting when elements scroll into
 *                               view (lazy loading); not in jsdom — mocked here
 *   window.scrollTo()         = scrolls the page — no-op in jsdom; mocked here
 *   URL.createObjectURL()     = creates a blob: URL for file downloads; not in jsdom
 *   URL.revokeObjectURL()     = frees a blob: URL; not in jsdom
 *   navigator.serviceWorker   = used for push notifications and offline caching;
 *                               not available in Node.js — mocked with stub values
 *   Object.defineProperty()   = adds or reconfigures a property on an object, including
 *                               write-protected browser globals like window.matchMedia
 *   console.error             = replaced (monkey-patched) to hide known React warnings
 *   beforeAll()               = Vitest hook: runs once before all tests in the file
 *   afterAll()                = Vitest hook: runs once after all tests in the file
 *   afterEach()               = Vitest hook: runs after every individual test
 *   document.body.innerHTML   = clearing this between tests removes any DOM nodes
 *                               that a component mounted during the previous test
 *
 * How it connects:
 * - Referenced in vitest.config.ts as `setupFiles: ['src/__tests__/setup.ts']`
 * - Runs automatically before every test file; no explicit import needed
 */

// Extend Vitest's expect() with DOM-aware matchers from @testing-library/jest-dom
// Examples of added matchers: .toBeInTheDocument(), .toHaveClass(), .toBeDisabled()
import '@testing-library/jest-dom'

// ---------------------------------------------------------------------------
// window.matchMedia — CSS media query API; jsdom has no real display
// ---------------------------------------------------------------------------
// Hooks like useReducedMotion and useResponsive call window.matchMedia;
// this stub returns 'matches: false' for every query (desktop defaults)
Object.defineProperty(window, 'matchMedia', {
  writable: true, // allow tests to override matchMedia for specific scenarios
  value: (query: string) => ({
    matches: false,           // default: query does not match
    media: query,             // echo the query string back
    onchange: null,
    addListener: () => {},    // deprecated but still called by some libraries
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// ---------------------------------------------------------------------------
// ResizeObserver — watch element dimensions; used by chart and layout components
// ---------------------------------------------------------------------------
// jsdom has no layout engine, so ResizeObserver would crash without this stub
class MockResizeObserver {
  observe() {}    // start watching an element
  unobserve() {}  // stop watching a specific element
  disconnect() {} // stop watching all elements
}
global.ResizeObserver = MockResizeObserver

// ---------------------------------------------------------------------------
// IntersectionObserver — detect when elements enter/leave the viewport
// ---------------------------------------------------------------------------
// Used for lazy-loading images and infinite scroll; jsdom has no viewport
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

// ---------------------------------------------------------------------------
// window.scrollTo — scroll the page; jsdom has no real scroll mechanism
// ---------------------------------------------------------------------------
window.scrollTo = () => {} // no-op prevents "Not implemented" errors

// ---------------------------------------------------------------------------
// URL.createObjectURL / revokeObjectURL — file download helpers
// ---------------------------------------------------------------------------
// Components that generate downloadable files use these; jsdom does not support blob URLs
URL.createObjectURL = () => 'mock-url'   // returns a fake blob URL string
URL.revokeObjectURL = () => {}           // frees memory (no-op here)

// ---------------------------------------------------------------------------
// navigator.serviceWorker — push notifications and background sync
// ---------------------------------------------------------------------------
// Only define if not already present (some environments pre-configure it)
if (!Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { controller: null, ready: Promise.resolve() },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// console.error suppression — hide known, harmless React and API warnings
// ---------------------------------------------------------------------------
// React 18 emits deprecation notices; the token-refresh service logs silent errors.
// These do not indicate bugs in the code under test, so they are filtered out.
const originalError = console.error  // save original so we can restore it after tests

beforeAll(() => {
  // Monkey-patch (override at runtime) console.error to filter specific messages
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      (
        args[0].includes('Warning: ReactDOM.render is no longer supported') || // React 17→18 migration warning
        args[0].includes('Warning: An update to') ||                           // async state update warning
        args[0].includes('[API] Silent refresh error')                         // background token refresh failure
      )
    ) {
      return // swallow the warning; do not print it
    }
    originalError.apply(console, args) // pass all other errors through unchanged
  }
})

afterAll(() => {
  // Restore the original console.error after all tests complete
  console.error = originalError
})

// ---------------------------------------------------------------------------
// DOM cleanup — remove any mounted components between tests
// ---------------------------------------------------------------------------
afterEach(() => {
  // Clearing innerHTML ensures components from one test do not bleed into the next
  document.body.innerHTML = ''
})
