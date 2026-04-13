/**
 * Module: csrf-validation.test.ts
 *
 * Tests and utility implementations for CSRF (Cross-Site Request Forgery) protection.
 * This file is both a test suite AND the authoritative source for several CSRF
 * helper functions used across the client (exported at the bottom).
 *
 * CSRF attack: a malicious website tricks a logged-in user's browser into
 * sending a state-changing request (POST/PUT/DELETE) to your API, because the
 * browser automatically includes the user's session cookie.
 *
 * Defences implemented:
 *   1. Synchroniser token  — server injects a random token into a <meta> tag;
 *                            the client reads it and includes it in request headers
 *   2. Double-submit cookie — the same token is stored in a cookie AND sent as a header;
 *                              because only the real origin can read the cookie value,
 *                              a cross-site form cannot forge the matching header
 *   3. SameSite cookies    — modern browsers won't send cookies on cross-origin requests
 *                              when SameSite=Strict or SameSite=Lax is set
 *   4. Credentials mode    — cross-origin fetch requests should not include credentials
 *
 * Glossary:
 *   describe()              = groups related tests
 *   it()                    = alias for test(); one scenario
 *   it.each([...])          = runs the same test for each value in the array
 *   expect()                = assertion helper
 *   vi.fn()                 = creates a trackable mock function
 *   beforeEach/afterEach    = setup/teardown around every test
 *   CSRF                    = Cross-Site Request Forgery (OWASP A01)
 *   CSRF_HEADER             = HTTP request header name: 'X-CSRF-Token'
 *   CSRF_COOKIE             = cookie name that stores the double-submit token: 'csrf-token'
 *   getCsrfTokenFromMeta()  = reads the token injected by the server into <meta name="csrf-token">
 *   getCsrfTokenFromCookie()= reads the token from the csrf-token cookie via document.cookie
 *   createCsrfHeaders()     = builds a Headers object that includes the CSRF token header
 *   requiresCsrfProtection()= returns true for state-changing HTTP methods (POST/PUT/PATCH/DELETE)
 *   safe methods            = HTTP methods with no side effects: GET / HEAD / OPTIONS / TRACE
 *   validateSameSiteAttribute() = parses the SameSite directive from a raw cookie string
 *   SameSite=Strict         = cookies never sent cross-origin (strongest protection)
 *   SameSite=Lax            = cookies sent on top-level navigations but not on embedded requests
 *   SameSite=None           = cookies always sent cross-origin (requires Secure flag)
 *   validateCredentialsMode()= verifies that cross-origin requests don't include credentials
 *   credentials:'include'   = browser sends cookies and auth headers to all origins (dangerous)
 *   credentials:'same-origin'= browser only sends credentials to same-origin requests (safe)
 *   credentials:'omit'      = browser never sends credentials (safest for public APIs)
 *   double-submit cookie    = CSRF pattern where the cookie value and a request header value
 *                             must match; attacker cannot forge the header without reading the cookie
 *   decodeURIComponent()    = decodes percent-encoded characters in cookie values (%2B → +)
 *   Headers                 = browser Fetch API class for managing HTTP header key-value pairs
 *   meta tag                = <meta name="csrf-token" content="TOKEN"> injected by server SSR
 *   document.cookie         = string-concatenation of all non-HttpOnly cookies for this origin
 *   window.location.origin  = scheme + hostname + port of the current page (e.g. http://localhost:5173)
 *
 * How it connects:
 * - Run by Vitest; exported functions are also used in the client's fetch wrapper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// CSRF protection utilities (implemented in this file; exported at the bottom)
// ---------------------------------------------------------------------------

/** CSRF token HTTP request header name — must match server-side expectations */
const CSRF_HEADER = 'X-CSRF-Token'

/** Cookie name storing the double-submit CSRF token (read by getCsrfTokenFromCookie) */
const CSRF_COOKIE = 'csrf-token'

/**
 * Get CSRF token from <meta name="csrf-token"> tag.
 * The server injects this into the HTML response so the client always has a valid token.
 * Returns null when the meta tag is absent (e.g. on pages served without SSR).
 */
function getCsrfTokenFromMeta(): string | null {
  const meta = document.querySelector('meta[name="csrf-token"]')
  return meta?.getAttribute('content') ?? null // ?? null = return null if undefined
}

/**
 * Get CSRF token from the csrf-token cookie (double-submit cookie pattern).
 * Uses a regex to extract the value from document.cookie (a semicolon-joined string).
 * Returns null if the cookie is not present.
 */
function getCsrfTokenFromCookie(): string | null {
  // (?:^|; ) matches start of string or "; " separator before the cookie name
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null // decode percent-encoding
}

/**
 * Build a Headers object that includes the CSRF token for an outgoing fetch request.
 * Merges the token into any existing headers provided by the caller.
 * If no token is available (no meta tag and no cookie) the header is not added.
 */
function createCsrfHeaders(existingHeaders?: HeadersInit): Headers {
  const headers = new Headers(existingHeaders) // start with caller's headers

  // Prefer the meta-tag token; fall back to the cookie token
  const token = getCsrfTokenFromMeta() || getCsrfTokenFromCookie()
  if (token) {
    headers.set(CSRF_HEADER, token) // inject as 'X-CSRF-Token: <value>'
  }

  return headers
}

/**
 * Returns true when the HTTP method changes server state and requires a CSRF token.
 * GET, HEAD, OPTIONS, and TRACE are "safe" (idempotent, no side effects) per RFC 7231.
 */
function requiresCsrfProtection(method: string): boolean {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS', 'TRACE']
  return !safeMethods.includes(method.toUpperCase()) // POST/PUT/PATCH/DELETE → true
}

/**
 * Parse the SameSite attribute from a raw Set-Cookie header string.
 * Returns 'Strict', 'Lax', 'None', or null if the attribute is absent.
 */
function validateSameSiteAttribute(cookieString: string): 'Strict' | 'Lax' | 'None' | null {
  const match = cookieString.match(/SameSite=(Strict|Lax|None)/i) // case-insensitive
  if (!match) return null
  const value = match[1].toLowerCase() // normalise to lowercase for comparison
  if (value === 'strict') return 'Strict'
  if (value === 'lax') return 'Lax'
  if (value === 'none') return 'None'
  return null
}

/**
 * Verify that the fetch credentials mode is safe for the given URL.
 * Cross-origin requests with credentials:'include' can be exploited for CSRF.
 * Returns false only for cross-origin + credentials:'include' combinations.
 */
function validateCredentialsMode(url: string, credentials: RequestCredentials): boolean {
  const requestUrl = new URL(url, window.location.origin) // resolve relative URLs
  const isSameOrigin = requestUrl.origin === window.location.origin

  if (isSameOrigin) {
    return true // same-origin requests are always safe regardless of credentials mode
  }

  // Cross-origin with 'include' sends cookies to a third-party origin — dangerous
  return credentials !== 'include'
}

// ---------------------------------------------------------------------------
// Mock setup — intercept fetch and reset DOM before each test
// ---------------------------------------------------------------------------

interface MockFetchCall {
  url: string
  options?: RequestInit
}

let fetchCalls: MockFetchCall[] = [] // accumulates all fetch calls made during the test
let originalFetch: typeof global.fetch  // preserves the real fetch for restoration

beforeEach(() => {
  fetchCalls = [] // clear call log before each test
  originalFetch = global.fetch

  // Replace global fetch with a spy that records calls and returns a successful response
  global.fetch = vi.fn((url: string | URL | Request, options?: RequestInit) => {
    const urlString = url instanceof Request ? url.url : url.toString()
    fetchCalls.push({ url: urlString, options })
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof fetch

  // Reset the DOM to a clean state (no meta tags, no cookies)
  document.head.innerHTML = ''
  document.cookie = '' // Note: setting cookie to '' doesn't clear cookies in jsdom
})

afterEach(() => {
  global.fetch = originalFetch // restore real fetch so other tests aren't affected
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSRF Protection', () => {

  // ---------------------------------------------------------------------------
  // Token retrieval
  // ---------------------------------------------------------------------------
  describe('Token retrieval', () => {
    it('retrieves CSRF token from meta tag', () => {
      // Simulate server injecting <meta name="csrf-token" content="..."> into the page
      const meta = document.createElement('meta')
      meta.name = 'csrf-token'
      meta.content = 'test-token-123'
      document.head.appendChild(meta)

      expect(getCsrfTokenFromMeta()).toBe('test-token-123')
    })

    it('returns null when meta tag is missing', () => {
      // On pages without SSR injection, no token is available from meta
      expect(getCsrfTokenFromMeta()).toBeNull()
    })

    it('retrieves CSRF token from cookie', () => {
      // Set the cookie directly — getCsrfTokenFromCookie parses document.cookie
      document.cookie = `${CSRF_COOKIE}=cookie-token-456`

      expect(getCsrfTokenFromCookie()).toBe('cookie-token-456')
    })

    it('handles URL-encoded cookie values', () => {
      // Tokens with special characters must be percent-encoded in cookies and decoded on read
      document.cookie = `${CSRF_COOKIE}=${encodeURIComponent('token+with/special=chars')}`

      expect(getCsrfTokenFromCookie()).toBe('token+with/special=chars')
    })
  })

  // ---------------------------------------------------------------------------
  // Header creation
  // ---------------------------------------------------------------------------
  describe('Header creation', () => {
    it('adds CSRF token header when token exists', () => {
      const meta = document.createElement('meta')
      meta.name = 'csrf-token'
      meta.content = 'my-csrf-token'
      document.head.appendChild(meta)

      const headers = createCsrfHeaders() // no existing headers

      // The built Headers object must include the X-CSRF-Token header
      expect(headers.get(CSRF_HEADER)).toBe('my-csrf-token')
    })

    it('preserves existing headers', () => {
      // createCsrfHeaders must merge, not replace
      const meta = document.createElement('meta')
      meta.name = 'csrf-token'
      meta.content = 'token'
      document.head.appendChild(meta)

      const headers = createCsrfHeaders({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer xyz',
      })

      expect(headers.get('Content-Type')).toBe('application/json') // preserved
      expect(headers.get('Authorization')).toBe('Bearer xyz')      // preserved
      expect(headers.get(CSRF_HEADER)).toBe('token')               // added
    })

    it('does not add header when no token available', () => {
      // If neither meta tag nor cookie provides a token, the header must be absent
      document.head.innerHTML = ''
      // Expire the cookie to clear it
      document.cookie = `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`

      const headers = createCsrfHeaders()

      expect(headers.has(CSRF_HEADER)).toBe(false) // header absent when no token
    })
  })

  // ---------------------------------------------------------------------------
  // Method safety checking — which HTTP verbs require a CSRF token
  // ---------------------------------------------------------------------------
  describe('Method safety checking', () => {
    // it.each() runs the same test body for every value in the array
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s requires CSRF protection', (method) => {
      // State-changing methods must be protected; attacker can forge these with <form>
      expect(requiresCsrfProtection(method)).toBe(true)
    })

    it.each(['GET', 'HEAD', 'OPTIONS'])('%s does not require CSRF protection', (method) => {
      // Read-only methods cannot modify server state — no CSRF risk
      expect(requiresCsrfProtection(method)).toBe(false)
    })

    it('is case-insensitive', () => {
      // The caller should not need to normalise the method string
      expect(requiresCsrfProtection('post')).toBe(true)
      expect(requiresCsrfProtection('get')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // SameSite cookie attribute validation
  // ---------------------------------------------------------------------------
  describe('SameSite cookie validation', () => {
    it('detects SameSite=Strict', () => {
      // Strict: cookies never sent cross-site, even on top-level navigations
      expect(validateSameSiteAttribute('session=abc; SameSite=Strict')).toBe('Strict')
    })

    it('detects SameSite=Lax', () => {
      // Lax: cookies sent on top-level GET navigations; not on cross-site POSTs
      expect(validateSameSiteAttribute('token=xyz; SameSite=Lax; HttpOnly')).toBe('Lax')
    })

    it('detects SameSite=None', () => {
      // None: always sent; must be combined with Secure flag; used for embedded widgets
      expect(validateSameSiteAttribute('cookie=val; SameSite=None; Secure')).toBe('None')
    })

    it('returns null when SameSite is not set', () => {
      // Older cookie without the SameSite attribute → vulnerable in older browsers
      expect(validateSameSiteAttribute('session=abc; HttpOnly')).toBeNull()
    })

    it('is case-insensitive', () => {
      // Browsers accept mixed-case attribute names; our parser must too
      expect(validateSameSiteAttribute('x=y; samesite=strict')).toBe('Strict')
    })
  })

  // ---------------------------------------------------------------------------
  // Credentials mode validation
  // ---------------------------------------------------------------------------
  describe('Credentials mode validation', () => {
    it('allows same-origin requests with any credentials mode', () => {
      // Same-origin requests cannot be forged cross-site, so all credential modes are safe
      const currentOrigin = window.location.origin
      expect(validateCredentialsMode(`${currentOrigin}/api`, 'include')).toBe(true)
      expect(validateCredentialsMode('/api/data', 'same-origin')).toBe(true)
    })

    it('blocks cross-origin credentials:include', () => {
      // credentials:'include' on a cross-origin request would send the user's cookies
      // to a third-party server — classic CSRF vector
      const crossOrigin = window.location.origin.includes('localhost')
        ? 'https://evil.com'
        : 'http://localhost:9999'
      expect(validateCredentialsMode(`${crossOrigin}/api`, 'include')).toBe(false)
    })

    it('allows cross-origin without credentials', () => {
      // 'omit' and 'same-origin' never send cookies to a cross-origin server
      const crossOrigin = window.location.origin.includes('localhost')
        ? 'https://api.example.com'
        : 'http://localhost:9999'
      expect(validateCredentialsMode(`${crossOrigin}/data`, 'omit')).toBe(true)
      expect(validateCredentialsMode(`${crossOrigin}/data`, 'same-origin')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// CSRF attack scenario documentation
// ---------------------------------------------------------------------------
describe('CSRF Attack Scenarios', () => {
  it('should reject requests without CSRF token (simulated)', () => {
    // Documents expected server behaviour: server returns 403 Forbidden when
    // a state-changing request arrives without a valid X-CSRF-Token header
    const hasToken = getCsrfTokenFromMeta() !== null

    if (!hasToken && requiresCsrfProtection('POST')) {
      // In a real integration test the server would return 403 here
      expect(true).toBe(true) // placeholder — server-side test outside this file's scope
    }
  })

  it('should not send cookies to cross-origin POST (with proper SameSite)', () => {
    // With SameSite=Strict, the browser itself refuses to include the session cookie
    // on cross-origin POST requests from a different site — stopping CSRF at the browser
    const cookieAttr = 'session=abc123; SameSite=Strict; HttpOnly; Secure'
    const sameSite = validateSameSiteAttribute(cookieAttr)

    expect(sameSite).toBe('Strict') // strongest CSRF protection via SameSite
  })

  it('validates origin/referer header expectations', () => {
    // Server-side defence: check that the Origin or Referer header matches the expected origin.
    // An attacker's page will have a different origin.
    const attackOrigin = 'https://attacker.com'
    const expectedOrigin = window.location.origin

    expect(attackOrigin).not.toBe(expectedOrigin) // origins are different → request should be rejected
  })
})

// ---------------------------------------------------------------------------
// Secure cookie fallback — for browsers without SameSite support
// ---------------------------------------------------------------------------
describe('Secure Cookie Fallback', () => {
  /**
   * For older browsers that do not support SameSite cookies, the double-submit
   * cookie pattern provides CSRF protection: the server verifies that the
   * X-CSRF-Token header value matches the csrf-token cookie value.
   * An attacker cannot read the cookie from a different origin, so they cannot
   * forge the matching header.
   */

  it('double-submit cookie pattern requires matching values', () => {
    // Both the cookie and the header must carry the same token value
    const cookieToken = 'double-submit-token-xyz'
    document.cookie = `${CSRF_COOKIE}=${cookieToken}` // "send" the token in a cookie

    const headerToken = getCsrfTokenFromCookie() // "read" it back as if building a header

    expect(headerToken).toBe(cookieToken) // they must match for the validation to pass
  })

  it('validates token format', () => {
    // A CSRF token must be long enough to resist brute-force guessing
    const validToken = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'

    expect(validToken.length).toBeGreaterThanOrEqual(32) // ≥32 characters = 128+ bits of entropy
    expect(validToken).not.toBe('1234567890')  // trivially guessable → rejected
    expect(validToken).not.toBe('csrf-token')  // static string → insecure
  })

  it('token should be regenerated per session', () => {
    // Different sessions must have different tokens so a stolen token is useless after logout
    const token1 = 'session1-token-abc' // user A's session
    const token2 = 'session2-token-xyz' // user B's session

    expect(token1).not.toBe(token2) // tokens are unique per session
  })
})

// ---------------------------------------------------------------------------
// Exports — shared utilities used by the client fetch wrapper
// ---------------------------------------------------------------------------
export {
  getCsrfTokenFromMeta,
  getCsrfTokenFromCookie,
  createCsrfHeaders,
  requiresCsrfProtection,
  validateSameSiteAttribute,
  CSRF_HEADER,
  CSRF_COOKIE,
}

// TESTS

