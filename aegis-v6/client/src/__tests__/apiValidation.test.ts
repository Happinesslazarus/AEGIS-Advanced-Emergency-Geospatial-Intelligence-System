/**
 * Tests for the API validation library -- a collection of Zod schemas and wrapper
 * functions that validate and sanitise data received from the server before the
 * rest of the client code touches it. This prevents malformed or malicious server
 * responses from causing runtime errors deep inside the application.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   it()                    = alias for test(); a single scenario
 *   expect()                = makes an assertion about a value
 *   beforeEach()            = runs setup code before every test in the describe block
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.resetAllMocks()      = resets mock state before each test
 *   Zod                     = TypeScript-first schema validation library; schemas describe
 *                             the exact shape and types a value must have
 *   schema.safeParse()      = validates data WITHOUT throwing; returns {success, data} or
 *                             {success:false, error} -- ideal for untrusted input
 *   schemas                 = object of reusable Zod sub-schemas: uuid, coordinates,
 *                             severity, email -- used as building blocks in larger schemas
 *   reportSchema            = full Zod schema for an incident report object
 *   alertSchema             = Zod schema for an emergency alert broadcast object
 *   userProfileSchema       = Zod schema for a citizen/admin user profile
 *   weatherDataSchema       = Zod schema for weather observation data
 *   apiResponseSchema()     = factory that wraps any schema in a standard success/error envelope
 *   paginatedSchema()       = factory that wraps a schema in a paginated list envelope
 *                             (items, total, page, pageSize, hasMore)
 *   validatedFetch()        = fetch wrapper that validates the JSON response against a schema;
 *                             returns {success, data} or {success:false, error}
 *   validatedArrayFetch()   = like validatedFetch() but expects a JSON array
 *   validateData()          = validates a value against a schema; returns the parsed value
 *                             (possibly transformed) or null on failure
 *   matchesSchema()         = boolean quick-check -- true if data passes the schema
 *   inputSanitizers         = object of pre-built sanitiser schemas that also normalise input
 * (trim whitespace, lowercase email, coerce string->int, reject
 *                             dangerous URL schemes like javascript: or data:)
 *   UUID                    = Universally Unique Identifier -- 32 hex chars in the pattern
 *                             xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx; used as DB primary keys
 *   coordinates             = {lat, lng} -- latitude (−90 to 90) and longitude (−180 to 180)
 *   severity                = enum: 'low' | 'medium' | 'high' | 'critical'
 *   globalThis.fetch        = the global fetch API; replaced with a vi.fn() mock so tests
 *                             run offline without real HTTP requests
 *   Content-Type header     = HTTP header telling clients the format of the response body;
 *                             validatedFetch rejects anything that is not 'application/json'
 *   response.ok             = true if HTTP status is 200-299; false for 4xx/5xx errors
 *   javascript:/data: URLs  = dangerous URL schemes that can execute code; must be rejected
 *                             by the URL sanitiser (OWASP A03: Injection prevention)
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  schemas,
  reportSchema,
  alertSchema,
  validatedFetch,
  validatedArrayFetch,
  validateData,
  matchesSchema,
  inputSanitizers,
  apiResponseSchema,
  paginatedSchema } from '../lib/apiValidation'

//Common reusable sub-schemas
describe('Common Schemas', () => {
  describe('uuid', () => {
    it('accepts valid UUIDs', () => {
      //Both are valid UUID v4 strings (8-4-4-4-12 hex groups, hyphen-separated)
      expect(schemas.uuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true)
      expect(schemas.uuid.safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true)
    })

    it('rejects invalid UUIDs', () => {
      //Plain strings, short numbers, and empty strings must all fail
      expect(schemas.uuid.safeParse('not-a-uuid').success).toBe(false)
      expect(schemas.uuid.safeParse('12345').success).toBe(false)
      expect(schemas.uuid.safeParse('').success).toBe(false)
    })
  })

  describe('coordinates', () => {
    it('accepts valid coordinates', () => {
      //London, south pole (lat=-90), prime meridian (lng=0) are all valid
      expect(schemas.coordinates.safeParse({ lat: 51.5074, lng: -0.1278 }).success).toBe(true)
      expect(schemas.coordinates.safeParse({ lat: -90, lng: 180 }).success).toBe(true)
      expect(schemas.coordinates.safeParse({ lat: 0, lng: 0 }).success).toBe(true)
    })

    it('rejects out-of-range values', () => {
      //Latitude > 90 or < -90 is physically impossible; same for longitude > 180
      expect(schemas.coordinates.safeParse({ lat: 91, lng: 0 }).success).toBe(false)
      expect(schemas.coordinates.safeParse({ lat: 0, lng: 181 }).success).toBe(false)
      expect(schemas.coordinates.safeParse({ lat: -91, lng: 0 }).success).toBe(false)
    })
  })

  describe('severity', () => {
    it('accepts valid severity levels', () => {
      //All four recognised severity strings must pass
      expect(schemas.severity.safeParse('low').success).toBe(true)
      expect(schemas.severity.safeParse('medium').success).toBe(true)
      expect(schemas.severity.safeParse('high').success).toBe(true)
      expect(schemas.severity.safeParse('critical').success).toBe(true)
    })

    it('rejects invalid severity levels', () => {
      // 'extreme' is not in the allowed enum; numbers must also fail (schema expects string)
      expect(schemas.severity.safeParse('extreme').success).toBe(false)
      expect(schemas.severity.safeParse('').success).toBe(false)
      expect(schemas.severity.safeParse(1).success).toBe(false)
    })
  })

  describe('email', () => {
    it('accepts valid emails', () => {
      //Standard email and a complex address with plus-addressing (test.user+tag@...)
      expect(schemas.email.safeParse('user@example.com').success).toBe(true)
      expect(schemas.email.safeParse('test.user+tag@domain.co.uk').success).toBe(true)
    })

    it('rejects invalid emails', () => {
      //No @ symbol, missing local part, empty string -- all must fail
      expect(schemas.email.safeParse('not-an-email').success).toBe(false)
      expect(schemas.email.safeParse('@no-user.com').success).toBe(false)
      expect(schemas.email.safeParse('').success).toBe(false)
    })
  })
})

//Report schema -- shape of an incident report from the server
describe('Report Schema', () => {
  //Complete valid report object used as the baseline; individual tests spread overrides
  const validReport = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Flood reported on Main Street',
    description: 'Water levels rising near the bridge',
    category: 'flood',
    severity: 'high',
    status: 'verified',
    location: {
      latitude: 51.5074,
      longitude: -0.1278,
      address: '123 Main Street',
    },
    created_at: '2026-04-06T10:00:00Z',
    updated_at: '2026-04-06T10:30:00Z',
  }

  it('validates complete report', () => {
    //All required and optional fields present -- must pass validation
    expect(reportSchema.safeParse(validReport).success).toBe(true)
  })

  it('validates report without optional fields', () => {
    //location and other optional fields may be absent; minimal required fields only
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test Report',
      description: 'Description',
      category: 'general',
      severity: 'low',
      status: 'pending',
      created_at: '2026-04-06T10:00:00Z',
      updated_at: '2026-04-06T10:00:00Z',
    }
    expect(reportSchema.safeParse(minimal).success).toBe(true)
  })

  it('rejects report with invalid severity', () => {
    // 'extreme' is not a valid severity; server bug or injection must be caught here
    const invalid = { ...validReport, severity: 'extreme' }
    expect(reportSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects report with oversized title', () => {
    //Title longer than 200 characters must fail to prevent overly large DOM content
    const invalid = { ...validReport, title: 'x'.repeat(201) }
    expect(reportSchema.safeParse(invalid).success).toBe(false)
  })
})

//Alert schema -- shape of an emergency broadcast alert from the server
describe('Alert Schema', () => {
  const validAlert = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Flood Warning',
    message: 'Severe flooding expected in the next 24 hours',
    type: 'flood',
    severity: 'critical',
    active: true,
    affected_areas: ['Zone A', 'Zone B'],
    created_at: '2026-04-06T10:00:00Z',
  }

  it('validates complete alert', () => {
    expect(alertSchema.safeParse(validAlert).success).toBe(true)
  })

  it('rejects alert with invalid type', () => {
    // 'tsunami' may not be in the allowed disasterType enum; must be rejected
    const invalid = { ...validAlert, type: 'tsunami' }
    expect(alertSchema.safeParse(invalid).success).toBe(false)
  })
})

//Input sanitisers -- normalise and validate user-supplied values
describe('Input Sanitizers', () => {
  describe('string sanitizer', () => {
    it('trims whitespace', () => {
      //Leading/trailing spaces must be removed by the sanitiser transform
      const sanitizer = inputSanitizers.string(100) // max length 100
      const result = sanitizer.parse('  hello world  ')
      expect(result).toBe('hello world')
    })

    it('enforces max length', () => {
      //Strings longer than the specified maximum must fail validation
      const sanitizer = inputSanitizers.string(10)
      expect(sanitizer.safeParse('12345678901').success).toBe(false) // 11 chars
      expect(sanitizer.safeParse('1234567890').success).toBe(true)   // 10 chars
    })
  })

  describe('integer sanitizer', () => {
    it('coerces string to integer', () => {
 //Form inputs are always strings; the sanitiser should convert '42' -> 42
      const sanitizer = inputSanitizers.integer(0, 100)
      expect(sanitizer.parse('42')).toBe(42)
    })

    it('enforces min/max bounds', () => {
      //Values outside the specified range must fail
      const sanitizer = inputSanitizers.integer(0, 100)
      expect(sanitizer.safeParse(-1).success).toBe(false)  // below min
      expect(sanitizer.safeParse(101).success).toBe(false) // above max
      expect(sanitizer.safeParse(50).success).toBe(true)   // within range
    })

    it('rejects non-integers', () => {
      //Floating-point values must not be accepted when an integer is expected
      const sanitizer = inputSanitizers.integer()
      expect(sanitizer.safeParse(3.14).success).toBe(false)
    })
  })

  describe('url sanitizer', () => {
    it('accepts http/https URLs', () => {
      //Standard web URLs must pass
      const sanitizer = inputSanitizers.url()
      expect(sanitizer.safeParse('https://example.com').success).toBe(true)
      expect(sanitizer.safeParse('http://localhost:3000').success).toBe(true)
    })

    it('rejects javascript: URLs', () => {
      //javascript: URLs execute code when clicked (XSS vector -- OWASP A03)
      const sanitizer = inputSanitizers.url()
      expect(sanitizer.safeParse('javascript:alert(1)').success).toBe(false)
    })

    it('rejects data: URLs', () => {
      //data: URLs can embed HTML/script content inline (another XSS vector)
      const sanitizer = inputSanitizers.url()
      expect(sanitizer.safeParse('data:text/html,<script>alert(1)</script>').success).toBe(false)
    })

    it('rejects file: URLs', () => {
      //file: URLs expose the server filesystem to the browser (information disclosure)
      const sanitizer = inputSanitizers.url()
      expect(sanitizer.safeParse('file:///etc/passwd').success).toBe(false)
    })
  })

  describe('email sanitizer', () => {
    it('normalizes email to lowercase', () => {
      //Email addresses are case-insensitive; store and compare in lowercase
      const sanitizer = inputSanitizers.email()
      expect(sanitizer.parse('USER@EXAMPLE.COM')).toBe('user@example.com')
    })

    it('trims whitespace', () => {
      //Users often paste email addresses with accidental leading/trailing spaces
      const sanitizer = inputSanitizers.email()
      expect(sanitizer.parse('  user@example.com  ')).toBe('user@example.com')
    })
  })
})

//Schema factories -- create envelope schemas for common API response shapes
describe('Schema Factories', () => {
  describe('apiResponseSchema', () => {
    it('creates valid response schema', () => {
      //Standard success envelope: {success:true, data: <report>}
      const schema = apiResponseSchema(reportSchema)
      const valid = {
        success: true,
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Test',
          description: 'Test',
          category: 'general',
          severity: 'low',
          status: 'pending',
          created_at: '2026-04-06T10:00:00Z',
          updated_at: '2026-04-06T10:00:00Z',
        },
      }
      expect(schema.safeParse(valid).success).toBe(true)
    })

    it('validates error response', () => {
      //Error envelope: {success:false, error: message}; 'data' field is absent
      const schema = apiResponseSchema(reportSchema)
      const error = {
        success: false,
        error: 'Not found',
      }
      expect(schema.safeParse(error).success).toBe(true)
    })
  })

  describe('paginatedSchema', () => {
    it('validates paginated response', () => {
      //Standard paginated list response: items array + pagination metadata
      const schema = paginatedSchema(reportSchema)
      const valid = {
        items: [],       // empty first page
        total: 0,        // total items across all pages
        page: 1,         // current page (1-indexed)
        pageSize: 10,    // items per page
        hasMore: false,  // no more pages after this one
      }
      expect(schema.safeParse(valid).success).toBe(true)
    })

    it('rejects invalid pagination values', () => {
      //Negative total or page=0 are nonsensical; must be caught
      const schema = paginatedSchema(reportSchema)
      expect(schema.safeParse({ items: [], total: -1, page: 1, pageSize: 10, hasMore: false }).success).toBe(false)
      expect(schema.safeParse({ items: [], total: 0, page: 0, pageSize: 10, hasMore: false }).success).toBe(false)
    })
  })
})

//validateData -- synchronous validation helper; returns data or null
describe('validateData', () => {
  it('returns parsed data for valid input', () => {
    //Valid coordinates must be returned unchanged (no transformation applied)
    const result = validateData({ lat: 51.5, lng: -0.1 }, schemas.coordinates)
    expect(result).toEqual({ lat: 51.5, lng: -0.1 })
  })

  it('returns null for invalid input', () => {
 //lat=200 is out of range -> validation fails -> null returned (no throw)
    const result = validateData({ lat: 200, lng: 0 }, schemas.coordinates)
    expect(result).toBeNull()
  })
})

//matchesSchema -- boolean quick-check against a schema
describe('matchesSchema', () => {
  it('returns true for matching data', () => {
 // 'low' is in the severity enum -> true
    expect(matchesSchema('low', schemas.severity)).toBe(true)
  })

  it('returns false for non-matching data', () => {
 // 'extreme' is not in the severity enum -> false
    expect(matchesSchema('extreme', schemas.severity)).toBe(false)
  })
})

//validatedFetch -- fetch with automatic schema validation
describe('validatedFetch', () => {
  beforeEach(() => {
    vi.resetAllMocks() // clear any previous fetch mock before each test
  })

  it('returns validated data on success', async () => {
    //Mock a successful 200 response with valid JSON
    const mockData = { lat: 51.5, lng: -0.1 }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve(mockData),
    })

    const result = await validatedFetch('/api/coords', schemas.coordinates)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(mockData)
  })

  it('returns error on validation failure', async () => {
    //Server returns valid HTTP 200 but with data that fails the schema
    const invalidData = { lat: 200, lng: 0 } // lat=200 is out of range
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve(invalidData),
    })

    const result = await validatedFetch('/api/coords', schemas.coordinates)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Response validation failed')
  })

  it('handles HTTP errors', async () => {
 //Server returns 404 -> response.ok is false -> must return an error result
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: () => Promise.resolve('Not found'),
    })

    const result = await validatedFetch('/api/missing', schemas.coordinates)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Not found')
  })

  it('rejects invalid Content-Type', async () => {
    //Receiving HTML (e.g. a login redirect page) instead of JSON must be caught
    //to prevent confusing parse errors later in the application
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      json: () => Promise.resolve({}),
    })

    const result = await validatedFetch('/api/wrong-type', schemas.coordinates)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid content type')
  })

  it('handles network errors', async () => {
 //fetch() itself throws (e.g. DNS failure, no internet) -> must surface the error message
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))

    const result = await validatedFetch('/api/network-error', schemas.coordinates)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Network failure')
  })
})

//validatedArrayFetch -- like validatedFetch but for array responses
describe('validatedArrayFetch', () => {
  it('validates array responses', async () => {
    //Server returns a JSON array; each item must be validated against the schema
    const mockData = [
      { lat: 51.5, lng: -0.1 },
      { lat: 48.8, lng: 2.3 },  // Paris coordinates
    ]
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve(mockData),
    })

    const result = await validatedArrayFetch('/api/coords', schemas.coordinates)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2) // both items survived validation
  })
})
