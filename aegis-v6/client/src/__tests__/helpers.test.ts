/**
 * Module: helpers.test.ts
 *
 * Helpers test suite (automated tests for this feature).
 *
 * Glossary:
 *   vi.useFakeTimers()   = replaces Date.now() and setTimeout with controllable
 *                          fake versions so time-dependent functions return
 *                          predictable results instead of real wall-clock time.
 *   vi.setSystemTime()   = pins the fake clock to a specific instant in time.
 *   vi.useRealTimers()   = restores the real clock after each test.
 *   vi.mock()            = replaces an entire module with a fake for the test
 *                          file, preventing real network calls or side-effects.
 *   beforeEach/afterEach = run setup/teardown code before or after every test
 *                          in the enclosing describe() block.
 *
 * How it connects:
 * - Run by the test runner (Vitest or Jest) */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  timeAgo,
  timeAgoCompact,
  getPasswordStrength,
  getSeverityClass,
  getStatusClass,
  getSeverityBorderClass,
  getPriorityColor,
  getConfidenceColor,
  truncate,
  escapeHtml,
  createMarkerSvg,
} from '../utils/helpers'

// vi.mock() intercepts the real i18n module and replacing t() with a stub
// that returns hardcoded strings.  This prevents test failures caused by the
// i18next initialisation happening asynchronously (it hasn't loaded language
// files yet at the time this module is imported).
vi.mock('../utils/i18n', () => ({
  t: (key: string) => {
    const translations: Record<string, string> = {
      'citizen.auth.password.weak': 'Weak',
      'citizen.auth.password.fair': 'Fair',
      'citizen.auth.password.good': 'Good',
      'citizen.auth.password.strong': 'Strong',
      'citizen.auth.password.veryStrong': 'Very Strong',
    }
    return translations[key] || key
  },
}))

// timeAgo Tests

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-05T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns "just now" for less than 1 minute ago', () => {
    const date = new Date('2026-04-05T11:59:30Z').toISOString()
    expect(timeAgo(date)).toBe('just now')
  })

  test('returns minutes ago for less than 1 hour', () => {
    const date = new Date('2026-04-05T11:55:00Z').toISOString()
    expect(timeAgo(date)).toBe('5m ago')
  })

  test('returns hours ago for less than 24 hours', () => {
    const date = new Date('2026-04-05T09:00:00Z').toISOString()
    expect(timeAgo(date)).toBe('3h ago')
  })

  test('returns days ago for 24+ hours', () => {
    const date = new Date('2026-04-03T12:00:00Z').toISOString()
    expect(timeAgo(date)).toBe('2d ago')
  })

  test('returns "Unknown" for null', () => {
    expect(timeAgo(null)).toBe('Unknown')
  })

  test('returns "Unknown" for undefined', () => {
    expect(timeAgo(undefined)).toBe('Unknown')
  })

  test('returns "Unknown" for empty string', () => {
    expect(timeAgo('')).toBe('Unknown')
  })
})

// timeAgoCompact Tests

describe('timeAgoCompact', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-05T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns "now" for less than 1 minute ago', () => {
    const date = new Date('2026-04-05T11:59:30Z').toISOString()
    expect(timeAgoCompact(date)).toBe('now')
  })

  test('returns minutes without "ago" for less than 1 hour', () => {
    const date = new Date('2026-04-05T11:55:00Z').toISOString()
    expect(timeAgoCompact(date)).toBe('5m')
  })

  test('returns hours without "ago" for less than 24 hours', () => {
    const date = new Date('2026-04-05T09:00:00Z').toISOString()
    expect(timeAgoCompact(date)).toBe('3h')
  })

  test('returns days without "ago" for 24+ hours', () => {
    const date = new Date('2026-04-03T12:00:00Z').toISOString()
    expect(timeAgoCompact(date)).toBe('2d')
  })

  test('returns empty string for null', () => {
    expect(timeAgoCompact(null)).toBe('')
  })

  test('returns empty string for undefined', () => {
    expect(timeAgoCompact(undefined)).toBe('')
  })
})

// getPasswordStrength Tests

describe('getPasswordStrength', () => {
  test('returns weak for very short password', () => {
    const result = getPasswordStrength('abc')
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.label).toBe('Weak')
    expect(result.color).toBe('bg-red-500')
  })

  test('returns fair for 8+ char lowercase password', () => {
    const result = getPasswordStrength('abcdefgh')
    expect(result.score).toBe(1)
    expect(result.label).toBe('Weak')
  })

  test('returns good for password with uppercase and numbers', () => {
    const result = getPasswordStrength('Abcdefgh1')
    expect(result.score).toBe(3)
    expect(result.label).toBe('Good')
    expect(result.color).toBe('bg-yellow-500')
  })

  test('returns strong for password with special chars', () => {
    const result = getPasswordStrength('Abcdefgh1!')
    expect(result.score).toBe(4)
    expect(result.label).toBe('Strong')
    expect(result.color).toBe('bg-green-500')
  })

  test('returns very strong for 12+ char complex password', () => {
    const result = getPasswordStrength('Abcdefghijkl1!')
    expect(result.score).toBe(5)
    expect(result.label).toBe('Very Strong')
    expect(result.color).toBe('bg-emerald-500')
  })

  test('adds point for length >= 8', () => {
    const short = getPasswordStrength('Abc1!')
    const long = getPasswordStrength('Abcdefg1!')
    expect(long.score).toBeGreaterThan(short.score)
  })

  test('adds point for length >= 12', () => {
    const eight = getPasswordStrength('Abcdefg1!')
    const twelve = getPasswordStrength('Abcdefghijkl1!')
    expect(twelve.score).toBeGreaterThan(eight.score)
  })
})

// getSeverityClass Tests

describe('getSeverityClass', () => {
  test('returns badge-critical for High', () => {
    expect(getSeverityClass('High')).toBe('badge-critical')
  })

  test('returns badge-critical for lowercase high', () => {
    expect(getSeverityClass('high')).toBe('badge-critical')
  })

  test('returns badge-medium for Medium', () => {
    expect(getSeverityClass('Medium')).toBe('badge-medium')
  })

  test('returns badge-low for Low', () => {
    expect(getSeverityClass('Low')).toBe('badge-low')
  })

  test('returns badge-info for unknown severity', () => {
    expect(getSeverityClass('Unknown')).toBe('badge-info')
  })
})

// getStatusClass Tests

describe('getStatusClass', () => {
  test('returns badge-verified for Verified', () => {
    expect(getStatusClass('Verified')).toBe('badge-verified')
  })

  test('returns badge-pending for Unverified', () => {
    expect(getStatusClass('Unverified')).toBe('badge-pending')
  })

  test('returns badge-urgent for Urgent', () => {
    expect(getStatusClass('Urgent')).toBe('badge-urgent')
  })

  test('returns badge-flagged for Flagged', () => {
    expect(getStatusClass('Flagged')).toBe('badge-flagged')
  })

  test('returns badge-pending for Pending', () => {
    expect(getStatusClass('Pending')).toBe('badge-pending')
  })

  test('returns badge-info for unknown status', () => {
    expect(getStatusClass('Unknown')).toBe('badge-info')
  })
})

// getSeverityBorderClass Tests

describe('getSeverityBorderClass', () => {
  test('returns red classes for high', () => {
    const result = getSeverityBorderClass('high')
    expect(result).toContain('border-l-red-500')
    expect(result).toContain('bg-red-50')
  })

  test('returns amber classes for medium', () => {
    const result = getSeverityBorderClass('medium')
    expect(result).toContain('border-l-amber-500')
    expect(result).toContain('bg-amber-50')
  })

  test('returns blue classes for low', () => {
    const result = getSeverityBorderClass('low')
    expect(result).toContain('border-l-blue-500')
    expect(result).toContain('bg-blue-50')
  })

  test('is case insensitive', () => {
    expect(getSeverityBorderClass('HIGH')).toContain('red')
    expect(getSeverityBorderClass('High')).toContain('red')
    expect(getSeverityBorderClass('MEDIUM')).toContain('amber')
  })

  test('returns empty string for unknown', () => {
    expect(getSeverityBorderClass('unknown')).toBe('')
  })
})

// getPriorityColor Tests

describe('getPriorityColor', () => {
  test('returns red for Critical', () => {
    expect(getPriorityColor('Critical')).toContain('red')
  })

  test('returns orange for High', () => {
    expect(getPriorityColor('High')).toContain('orange')
  })

  test('returns amber for Medium', () => {
    expect(getPriorityColor('Medium')).toContain('amber')
  })

  test('returns blue for Low', () => {
    expect(getPriorityColor('Low')).toContain('blue')
  })

  test('returns gray for unknown', () => {
    expect(getPriorityColor('Unknown')).toContain('gray')
  })
})

// getConfidenceColor Tests

describe('getConfidenceColor', () => {
  test('returns green for 80+', () => {
    expect(getConfidenceColor(80)).toContain('green')
    expect(getConfidenceColor(100)).toContain('green')
  })

  test('returns amber for 50-79', () => {
    expect(getConfidenceColor(50)).toContain('amber')
    expect(getConfidenceColor(79)).toContain('amber')
  })

  test('returns red for below 50', () => {
    expect(getConfidenceColor(49)).toContain('red')
    expect(getConfidenceColor(0)).toContain('red')
  })
})

// truncate Tests

describe('truncate', () => {
  test('returns original string if under limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  test('truncates and adds ellipsis for long strings', () => {
    const result = truncate('This is a very long string', 10)
    expect(result).toBe('This is a …')
    expect(result.length).toBe(11)
  })

  test('uses default limit of 80', () => {
    const str = 'a'.repeat(100)
    const result = truncate(str)
    expect(result.length).toBe(81) // 80 chars + ellipsis
  })

  test('returns empty string for null/undefined', () => {
    expect(truncate(null as any)).toBe('')
    expect(truncate(undefined as any)).toBe('')
  })

  test('returns empty string for empty input', () => {
    expect(truncate('')).toBe('')
  })

  test('handles exact length strings', () => {
    const str = 'a'.repeat(80)
    expect(truncate(str, 80)).toBe(str)
  })
})

// escapeHtml Tests

describe('escapeHtml', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  test('escapes less than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  test('escapes greater than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  test('escapes double quotes', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c')
  })

  test('escapes all dangerous characters together', () => {
    const input = '<script>alert("XSS & attack")</script>'
    const expected = '&lt;script&gt;alert(&quot;XSS &amp; attack&quot;)&lt;/script&gt;'
    expect(escapeHtml(input)).toBe(expected)
  })

  test('preserves safe content', () => {
    expect(escapeHtml('Hello World 123!')).toBe('Hello World 123!')
  })

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// createMarkerSvg Tests

describe('createMarkerSvg', () => {
  test('creates SVG with specified color', () => {
    const svg = createMarkerSvg('#ff0000')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  test('uses default size of 32', () => {
    const svg = createMarkerSvg('#ff0000')
    expect(svg).toContain('width="32"')
    expect(svg).toContain('height="32"')
  })

  test('uses custom size when specified', () => {
    const svg = createMarkerSvg('#ff0000', 48)
    expect(svg).toContain('width="48"')
    expect(svg).toContain('height="48"')
  })

  test('contains path element', () => {
    const svg = createMarkerSvg('#ff0000')
    expect(svg).toContain('<path')
  })
})
