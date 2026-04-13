/**
 * Module: auth.test.ts
 *
 * Tests for the auth.ts utility functions: getSession (read from in-memory store),
 * isTokenValid (decode a JWT and check its expiry), and logout (clear all tokens,
 * notify listeners, and redirect).
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   vi.mock()               = replaces a real module import with controlled fakes (hoisted)
 *   vi.fn()                 = creates a mock function that records calls and return values
 *   vi.mocked()             = TypeScript helper that casts a mock function so .mockReturnValue()
 *                             type-checks correctly
 *   vi.clearAllMocks()      = resets call counts and return values on all mocks
 *   mockReturnValue()       = sets the value a mock function returns when called
 *   mockResolvedValue()     = makes a mock async function resolve to a given value
 *   mockRejectedValue()     = makes a mock async function reject with a given error
 *   BTW — getUser/clearToken/setUser/getAnyToken are all mocked here so that auth.ts
 *   doesn't need a real browser storage layer during these unit tests
 *
 *   JWT (JSON Web Token)    = a three-part Base64URL-encoded string `header.payload.signature`
 *                             used to prove identity; the payload section contains claims
 *                             like `exp` (expiry time in Unix seconds since 1970-01-01)
 *   btoa()                  = encodes a string to Base64 (browser built-in); used here
 *                             to build fake JWT payloads without a real auth server
 *   exp claim               = `exp` = expiry timestamp in Unix seconds; if exp < now,
 *                             the token has expired and must be rejected
 *   ae:logout               = custom DOM event dispatched on window so every listener
 *                             (socket, context, service worker) knows the user logged out
 *   localStorage            = key/value browser storage that persists across browser sessions;
 *                             mocked here with a plain JS object for test isolation
 *   sessionStorage          = key/value browser storage that clears when the tab closes;
 *                             also mocked with a plain object
 *   document.cookie         = the string representation of the browser cookie jar;
 *                             httpOnly cookies can't be read or written via JS — only the server
 *                             can clear them via Set-Cookie
 *   window.location.href    = setting this navigates the browser to a new URL; we mock
 *                             window.location to prevent real navigation during tests
 *   Object.defineProperty() = injects or overrides a property descriptor at runtime;
 *                             used to replace window.localStorage, sessionStorage, and location
 *   configurable: true      = required when overriding window.location so it can be
 *                             restored afterwards
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// Replace the api module with lightweight stubs — these record calls but don't touch
// real storage; this keeps the tests deterministic and free of side effects
vi.mock('../utils/api', () => ({
  getUser: vi.fn(),
  clearToken: vi.fn(),
  setUser: vi.fn(),
  getAnyToken: vi.fn(),
}))

import { getSession, isTokenValid, logout } from '../utils/auth'
import { getUser, clearToken, setUser, getAnyToken } from '../utils/api'

// ---------------------------------------------------------------------------
// getSession Tests
// ---------------------------------------------------------------------------

describe('getSession', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset mock call counts before each scenario
  })

  test('returns user from getUser()', () => {
    // Arrange: make getUser() return a fake user object
    const mockUser = { id: '1', username: 'operator', role: 'admin' }
    vi.mocked(getUser).mockReturnValue(mockUser as any)
    
    const session = getSession()
    expect(session).toEqual(mockUser) // session should be the exact same user shape
    expect(getUser).toHaveBeenCalled() // confirms getSession() actually calls getUser()
  })

  test('returns null when no user', () => {
    // getUser returns null when no one is logged in
    vi.mocked(getUser).mockReturnValue(null)
    
    const session = getSession()
    expect(session).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isTokenValid Tests
// ---------------------------------------------------------------------------

describe('isTokenValid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns false when no token', () => {
    // No token stored anywhere = not authenticated
    vi.mocked(getAnyToken).mockReturnValue(null)
    
    expect(isTokenValid()).toBe(false)
  })

  test('returns false for invalid token format', () => {
    // A JWT must have exactly three parts separated by dots: header.payload.signature
    vi.mocked(getAnyToken).mockReturnValue('invalid-token')
    
    expect(isTokenValid()).toBe(false)
  })

  test('returns false for token with only 2 parts', () => {
    // Two parts = missing signature section — reject as malformed
    vi.mocked(getAnyToken).mockReturnValue('header.payload')
    
    expect(isTokenValid()).toBe(false)
  })

  test('returns true for valid unexpired JWT', () => {
    // Build a real-looking JWT: Base64URL-encode a payload with a future expiry.
    // btoa() = standard Base64 (not URL-safe, but close enough for unit tests)
    // exp = Unix seconds; Math.floor(Date.now() / 1000) converts ms to seconds
    const futureExp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    const payload = btoa(JSON.stringify({ exp: futureExp, sub: 'user123' }))
    const token = `header.${payload}.signature`
    
    vi.mocked(getAnyToken).mockReturnValue(token)
    
    expect(isTokenValid()).toBe(true)
  })

  test('returns false for expired JWT', () => {
    // exp in the past = token has expired; must be rejected
    const pastExp = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    const payload = btoa(JSON.stringify({ exp: pastExp, sub: 'user123' }))
    const token = `header.${payload}.signature`
    
    vi.mocked(getAnyToken).mockReturnValue(token)
    
    expect(isTokenValid()).toBe(false)
  })

  test('returns true for JWT without expiration', () => {
    // Some JWTs omit the exp claim (e.g. service-to-service tokens);
    // without an expiry we treat them as valid
    const payload = btoa(JSON.stringify({ sub: 'user123', iat: Date.now() }))
    // iat = "issued at" timestamp; not used for expiry checking
    const token = `header.${payload}.signature`
    
    vi.mocked(getAnyToken).mockReturnValue(token)
    
    expect(isTokenValid()).toBe(true)
  })

  test('returns false for malformed payload', () => {
    // !!! characters are not valid Base64 — atob() will throw; the function should
    // catch that and return false rather than crashing
    const token = 'header.!!!invalid-base64!!!.signature'
    
    vi.mocked(getAnyToken).mockReturnValue(token)
    
    expect(isTokenValid()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// logout Tests
// ---------------------------------------------------------------------------

describe('logout', () => {
  let originalFetch: typeof fetch
  let originalLocation: Location
  let localStorageMock: Record<string, string>   // in-memory dict that acts like localStorage
  let sessionStorageMock: Record<string, string> // in-memory dict that acts like sessionStorage
  
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Replace global.fetch with a mock that resolves successfully by default.
    // Real fetch would try to contact the backend, which doesn't exist in tests.
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
    
    // Build a fake localStorage backed by a plain JS object.
    // Object.defineProperty overrides the window.localStorage descriptor.
    localStorageMock = {}
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => localStorageMock[key] ?? null,
        setItem: (key: string, value: string) => { localStorageMock[key] = value },
        removeItem: (key: string) => { delete localStorageMock[key] },
        clear: () => { localStorageMock = {} },
      },
      configurable: true, // must be true so we can override it again next test
    })
    
    // Same pattern for sessionStorage
    sessionStorageMock = {}
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: (key: string) => sessionStorageMock[key] ?? null,
        setItem: (key: string, value: string) => { sessionStorageMock[key] = value },
        removeItem: (key: string) => { delete sessionStorageMock[key] },
        clear: () => { sessionStorageMock = {} },
      },
      configurable: true,
    })
    
    // Override window.location so setting href doesn't actually navigate.
    // We delete first because window.location is normally read-only.
    originalLocation = window.location
    delete (window as any).location
    window.location = {
      ...originalLocation,
      href: '',                           // we'll assert this is set to the correct redirect
      pathname: '/citizen/dashboard',     // default test path (citizen area)
      hostname: 'localhost',
    } as any
    
    // Make document.cookie writable (normally read-only in jsdom)
    Object.defineProperty(document, 'cookie', {
      value: '',
      writable: true,
      configurable: true,
    })
  })
  
  afterEach(() => {
    global.fetch = originalFetch // restore real fetch
    // Restore the real window.location so other test suites navigate normally
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })
  
  test('calls logout endpoints', async () => {
    // logout() must POST to both /api/auth/logout (admin) and /api/citizen-auth/logout
    // so the server can invalidate both httpOnly session cookies
    await logout()
    
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST',
    }))
    expect(fetch).toHaveBeenCalledWith('/api/citizen-auth/logout', expect.objectContaining({
      method: 'POST',
    }))
  })
  
  test('clears token and user', async () => {
    // After logout the in-memory token and user references must be wiped
    await logout()
    
    expect(clearToken).toHaveBeenCalled()        // removes JWT from memory
    expect(setUser).toHaveBeenCalledWith(null)   // nukes the stored user object
  })
  
  test('clears localStorage auth items', async () => {
    // Pre-populate localStorage with stale tokens and user data
    localStorageMock['aegis-user'] = 'test'
    localStorageMock['aegis-citizen-user'] = 'test'
    localStorageMock['token'] = 'test'
    
    await logout()
    
    expect(localStorageMock['aegis-user']).toBeUndefined()
    expect(localStorageMock['aegis-citizen-user']).toBeUndefined()
    expect(localStorageMock['token']).toBeUndefined()
  })
  
  test('clears sessionStorage', async () => {
    // All session-scoped auth keys should be removed after logout
    sessionStorageMock['aegis-user'] = 'test'
    sessionStorageMock['aegis-token'] = 'test'
    
    await logout()
    
    expect(Object.keys(sessionStorageMock).length).toBe(0) // nothing left in sessionStorage
  })
  
  test('dispatches ae:logout event', async () => {
    // ae:logout = custom DOM event; other parts of the app (socket, contexts, service worker)
    // listen for this to tear down their own authenticated state
    const eventListener = vi.fn()
    window.addEventListener('ae:logout', eventListener)
    
    await logout()
    
    expect(eventListener).toHaveBeenCalled() // event was fired
    
    window.removeEventListener('ae:logout', eventListener) // clean up listener
  })
  
  test('redirects to /citizen/login for citizen paths', async () => {
    // When pathname contains '/citizen/', redirect to the citizen login page
    window.location.pathname = '/citizen/dashboard'
    
    await logout()
    
    expect(window.location.href).toBe('/citizen/login')
  })
  
  test('redirects to /admin for admin paths', async () => {
    // When pathname contains '/admin/', redirect to the admin login page
    window.location.pathname = '/admin/dashboard'
    
    await logout()
    
    expect(window.location.href).toBe('/admin')
  })
  
  test('handles fetch errors gracefully', async () => {
    // If the backend is down, logout should still clear local state and not throw;
    // failing silently is acceptable — the user session is cleared locally regardless
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    
    await expect(logout()).resolves.not.toThrow() // no uncaught exception
  })
})
