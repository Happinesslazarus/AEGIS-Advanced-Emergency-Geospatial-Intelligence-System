/**
 * Unit tests for the HIBP (Have I Been Pwned) k-Anonymity password breach checker.
 *
 * Covers:
 * - k-Anonymity: only the 5-char SHA-1 prefix is sent to the API (never the full hash)
 * - Cache hit: second call for same password does NOT issue a second network request
 * - Graceful degradation: API failures return { isPwned: false } and do not throw
 * - Known-pwned password returns isPwned=true with breach count > 0
 * - Clean password returns isPwned=false
 * - validatePasswordNotBreached threshold logic (block / warn / pass)
 */

import crypto from 'crypto'
import { checkPasswordBreached, validatePasswordNotBreached } from '../services/hibpService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Capture fetch calls for assertion */
const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

/** Compute SHA-1 prefix (5 chars) and suffix for a given password */
function sha1Parts(password: string): { prefix: string; suffix: string; full: string } {
  const full = crypto.createHash('sha1').update(password).digest('hex').toUpperCase()
  return { prefix: full.slice(0, 5), suffix: full.slice(5), full }
}

/** Build a mock HIBP range response that includes the given suffix with count */
function makePwnedResponse(suffix: string, count: number): Response {
  // HIBP returns "SUFFIX:COUNT\r\nSUFFIX2:COUNT2\r\n…"
  const body = `${suffix}:${count}\r\nDDDDD:0\r\n`
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response
}

function makeNotFoundResponse(): Response {
  return { ok: false, status: 404, text: async () => '' } as unknown as Response
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// Each test uses a DIFFERENT password to avoid module-level cache interference.
// The pwnedCache Map persists for the lifetime of the test module; passwords
// used in one test would be served from cache in a later test if reused.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset()
})

describe('checkPasswordBreached', () => {
  it('sends only the 5-char SHA-1 prefix — never the full hash or plaintext', async () => {
    const pw = 'test-kanonymity-pw-1'
    const { prefix, suffix, full } = sha1Parts(pw)
    mockFetch.mockResolvedValueOnce(makePwnedResponse(suffix, 1))

    await checkPasswordBreached(pw)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const calledUrl: string = mockFetch.mock.calls[0][0] as string
    // URL must end with the 5-char prefix only
    expect(calledUrl).toMatch(new RegExp(`\/${prefix}$`))
    // Full hash must NOT appear in the URL
    expect(calledUrl).not.toContain(full)
    // Plaintext password must NOT appear anywhere
    expect(calledUrl.toLowerCase()).not.toContain(pw.toLowerCase())
  })

  it('returns isPwned=true for a known-breached password', async () => {
    const pw = 'test-pwned-pw-2'
    const { suffix } = sha1Parts(pw)
    mockFetch.mockResolvedValueOnce(makePwnedResponse(suffix, 3_500_000))

    const result = await checkPasswordBreached(pw)

    expect(result.isPwned).toBe(true)
    expect(result.count).toBe(3_500_000)
  })

  it('returns isPwned=false when the suffix is not in the HIBP response', async () => {
    // Mock response that will never contain any real suffix
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'AAAAA:1\r\nBBBBB:2\r\n',
    } as unknown as Response)

    const result = await checkPasswordBreached('test-clean-pw-3')

    expect(result.isPwned).toBe(false)
    expect(result.count).toBe(0)
  })

  it('serves the second call from cache — no second fetch', async () => {
    const pw = 'test-cache-pw-4'
    const { suffix } = sha1Parts(pw)
    mockFetch.mockResolvedValue(makePwnedResponse(suffix, 1))

    await checkPasswordBreached(pw)   // first call → hits network
    await checkPasswordBreached(pw)   // second call → hits cache

    // fetch must only have been called once
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('gracefully degrades — returns isPwned=false when HIBP API is unavailable (404)', async () => {
    mockFetch.mockResolvedValueOnce(makeNotFoundResponse())

    const result = await checkPasswordBreached('test-404-pw-5')

    expect(result.isPwned).toBe(false)
    expect(result.message).toContain('unavailable')
  })

  it('gracefully degrades — returns isPwned=false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    const result = await checkPasswordBreached('test-networkerr-pw-6')

    expect(result.isPwned).toBe(false)
    expect(result.message).toContain('unavailable')
  })
})

describe('validatePasswordNotBreached', () => {
  it('blocks password when breach count exceeds blockThreshold', async () => {
    const pw = 'test-block-pw-7'
    const { suffix } = sha1Parts(pw)
    mockFetch.mockResolvedValueOnce(makePwnedResponse(suffix, 500))

    const result = await validatePasswordNotBreached(pw, { blockThreshold: 0 })

    expect(result.valid).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.warned).toBe(false)
  })

  it('warns (but does not block) when count is between warnThreshold and blockThreshold', async () => {
    const pw = 'test-warn-pw-8'
    const { suffix } = sha1Parts(pw)
    // count=5 — above warnThreshold=0 but below blockThreshold=10
    mockFetch.mockResolvedValueOnce(makePwnedResponse(suffix, 5))

    const result = await validatePasswordNotBreached(pw, {
      blockThreshold: 10,
      warnThreshold: 0,
    })

    expect(result.valid).toBe(true)
    expect(result.blocked).toBe(false)
    expect(result.warned).toBe(true)
  })

  it('passes cleanly when password is not in HIBP', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'AAAAA:1\r\n',
    } as unknown as Response)

    const result = await validatePasswordNotBreached('test-notinhibp-pw-9')

    expect(result.valid).toBe(true)
    expect(result.blocked).toBe(false)
    expect(result.warned).toBe(false)
    expect(result.breachCount).toBe(0)
  })
})
