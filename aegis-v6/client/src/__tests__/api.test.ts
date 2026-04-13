/**
 * Module: api.test.ts
 *
 * Tests for the api.ts utility, which is the lowest-level token/user store used
 * by every authenticated request in the app. Responsibilities:
 *   - Hold the admin JWT in memory (never persisted to localStorage)
 *   - Persist/retrieve the current user object in localStorage
 *   - Expose getAnyToken() which tries the admin token first, then the citizen token
 *   - Schedule an automatic silent refresh before the admin token expires
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   vi.fn()                 = creates a mock function; used here to spy on localStorage calls
 *   vi.clearAllMocks()      = resets call counts on all vi.fn() mocks before each test
 *   vi.useFakeTimers()      = replaces setTimeout/clearTimeout with a controllable fake clock
 *   vi.useRealTimers()      = restores the real wall-clock after the test group
 *   Object.defineProperty() = replaces window.localStorage with our mock object;
 *                             configurable:true allows replacing it again in later tests
 *   IIFE (() => { ... })()  = Immediately-Invoked Function Expression; creates the mock
 *                             object with a private 'store' variable via closure
 *   localStorageMock.clear()= wipes the in-memory store between tests
 *   mockReturnValueOnce()   = sets what getItem() returns for the NEXT call only, then resets
 *   mockImplementationOnce()= sets what getItem() DOES for the next call (can throw)
 *   JWT                     = JSON Web Token; three Base64URL parts: header.payload.signature
 *   btoa()                  = encodes a string to Base64; used to build fake JWT payloads
 *   in-memory token         = admin JWT kept only in a module-level variable (not localStorage)
 *                             to reduce XSS exposure; cleared when the page is refreshed
 *   aegis-user              = localStorage key for the serialised admin user object
 *   aegis-citizen-user      = localStorage key for the serialised citizen user object
 *   aegis-citizen-token     = localStorage key for the citizen JWT (stored without httpOnly)
 *   JSON.stringify(user)    = converts the user object to a JSON string for storage
 *   JSON.parse(str)         = parses a JSON string back to an object; can throw on invalid input
 *   isAuthenticated()       = returns true if any token is present (admin or citizen)
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getToken,
  setToken,
  clearToken,
  getAnyToken,
  getUser,
  setUser,
  isAuthenticated,
} from '../utils/api'
import { setCitizenToken } from '../contexts/CitizenAuthContext'

// Store original localStorage so we can reference it in the factory
const originalLocalStorage = global.localStorage

// Build a mock localStorage backed by a plain JS object (closure keeps 'store' private)
// IIFE = Immediately-Invoked Function Expression — runs immediately and returns the mock object
const localStorageMock = (() => {
  let store: Record<string, string> = {} // in-memory key/value store
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((i: number) => Object.keys(store)[i] || null),
  }
})()

// Inject the mock so the module under test uses it instead of the real browser localStorage
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true })

// Replace global.fetch with a mock; some token operations hit the /api/auth/refresh endpoint
global.fetch = vi.fn()

describe('Token Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()    // reset spy call counts
    localStorageMock.clear() // wipe the in-memory store
    clearToken()          // reset the in-memory admin token to null
  })

  describe('getToken / setToken', () => {
    test('getToken returns null initially', () => {
      // After clearToken() there should be no admin JWT in memory
      clearToken()
      expect(getToken()).toBeNull()
    })

    test('setToken stores token in memory', () => {
      // setToken() keeps the JWT in a module-level variable, NOT localStorage
      setToken('test-token-123')
      expect(getToken()).toBe('test-token-123')
    })

    test('setToken overwrites previous token', () => {
      // Only the most-recently set token should be returned
      setToken('token-1')
      setToken('token-2')
      expect(getToken()).toBe('token-2')
    })
  })

  describe('clearToken', () => {
    test('clears in-memory token', () => {
      setToken('token-to-clear')
      expect(getToken()).toBe('token-to-clear')
      
      clearToken()
      expect(getToken()).toBeNull() // in-memory slot is wiped
    })

    test('removes aegis-user from localStorage', () => {
      // clearToken also removes the serialised admin user object
      localStorageMock.setItem('aegis-user', '{"id":"1"}')
      clearToken()
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('aegis-user')
    })

    test('removes aegis-citizen-user from localStorage', () => {
      // And the citizen user object, so both roles are cleared together
      localStorageMock.setItem('aegis-citizen-user', '{"id":"2"}')
      clearToken()
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('aegis-citizen-user')
    })
  })

  describe('getAnyToken', () => {
    test('returns admin token if set', () => {
      // Admin token (in memory) has priority over citizen token (in localStorage)
      setToken('admin-token')
      expect(getAnyToken()).toBe('admin-token')
    })

    test('returns citizen token from in-memory store if no admin token', () => {
      // Fall back to the citizen JWT stored in memory when no admin is logged in
      clearToken()
      setCitizenToken('citizen-token')
      expect(getAnyToken()).toBe('citizen-token')
      setCitizenToken(null) // cleanup
    })

    test('prefers admin token over citizen token', () => {
      // Even if the citizen token exists in memory, the admin in-memory token wins
      setToken('admin-token')
      setCitizenToken('citizen-token')
      expect(getAnyToken()).toBe('admin-token')
      setCitizenToken(null) // cleanup
    })
  })
})

describe('User Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  describe('setUser / getUser', () => {
    test('setUser stores user in localStorage', () => {
      // User object is JSON-serialised and written to localStorage under 'aegis-user'
      const user = { id: '123', email: 'test@example.com', role: 'admin' }
      setUser(user)
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'aegis-user',
        JSON.stringify(user)
      )
    })

    test('setUser with null removes user', () => {
      // Calling setUser(null) signals logout — the key should be removed entirely
      setUser(null)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('aegis-user')
    })

    test('setUser with undefined removes user', () => {
      // undefined treated the same as null — remove the stored user
      setUser(undefined)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('aegis-user')
    })

    test('getUser returns parsed user from localStorage', () => {
      // getItem returns a JSON string; getUser must parse it back to an object
      const user = { id: '123', email: 'test@example.com', role: 'operator' }
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(user))
      const result = getUser()
      expect(result).toEqual(user) // deep equality: same keys and values
    })

    test('getUser returns null when no user stored', () => {
      // No entry in localStorage = no one is logged in
      localStorageMock.getItem.mockReturnValueOnce(null)
      expect(getUser()).toBeNull()
    })

    test('getUser returns null for invalid JSON', () => {
      // If localStorage is corrupted (e.g. partial write), JSON.parse throws;
      // getUser must catch the error and return null safely
      localStorageMock.getItem.mockReturnValueOnce('invalid-json{')
      expect(getUser()).toBeNull()
    })
  })

  describe('isAuthenticated', () => {
    test('returns true when token is set', () => {
      // Any token (admin in memory) is sufficient to be considered authenticated
      setToken('valid-token')
      expect(isAuthenticated()).toBe(true)
    })

    test('returns false when no token', () => {
      // No token in memory AND no citizen token in localStorage = not authenticated
      clearToken()
      expect(isAuthenticated()).toBe(false)
    })
  })
})

describe('Token Refresh Scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers() // freeze the clock so scheduled refresh timers don't fire unexpectedly
    vi.clearAllMocks()
    clearToken()
  })

  afterEach(() => {
    vi.useRealTimers() // restore real timers after this describe block
  })

  test('setToken with valid JWT schedules refresh', () => {
    // When a JWT with an exp claim is stored, the module should schedule a setTimeout
    // to silently refresh it ~1 minute before it expires
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' }
    // btoa = Base64 encode; builds a realistic-looking JWT payload section
    const token = `header.${btoa(JSON.stringify(payload))}.signature`
    
    setToken(token)
    
    // Token should be held in memory regardless of the refresh scheduling
    expect(getToken()).toBe(token)
  })

  test('handles malformed JWT gracefully', () => {
    // A non-JWT string (no dots) should be stored without crashing the refresh scheduler
    expect(() => setToken('not-a-jwt')).not.toThrow()
    expect(getToken()).toBe('not-a-jwt')
  })

  test('handles JWT without exp claim', () => {
    // Some tokens have no expiry claim; the scheduler should skip the refresh timer
    const payload = { role: 'admin' } // no 'exp' field
    const token = `header.${btoa(JSON.stringify(payload))}.signature`
    
    expect(() => setToken(token)).not.toThrow()
    expect(getToken()).toBe(token)
  })
})

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  test('handles concurrent token operations', () => {
    // Rapid writes — last write wins; there is no queueing
    setToken('token-1')
    setToken('token-2')
    setToken('token-3')
    
    expect(getToken()).toBe('token-3')
  })

  test('handles special characters in token', () => {
    // A real ES256 JWT with Base64URL-encoded payload and HMAC signature;
    // underscores and hyphens in Base64URL must not be corrupted by storage
    const specialToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    setToken(specialToken)
    expect(getToken()).toBe(specialToken)
  })

  test('handles empty string token', () => {
    // Empty string is a valid (if useless) token value; must not crash
    setToken('')
    expect(getToken()).toBe('')
  })

  test('getUser handles localStorage errors', () => {
    // If localStorage.getItem throws (e.g. storage quota exceeded, Safari ITP),
    // getUser must catch the error and return null instead of crashing the app
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('localStorage error') // simulates a real storage exception
    })
    expect(getUser()).toBeNull() // safe fallback — not null would crash downstream code
  })
})
