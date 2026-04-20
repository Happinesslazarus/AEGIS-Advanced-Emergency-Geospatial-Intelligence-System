/**
 * Validation test suite (automated tests for this feature).
 *
 * Glossary:
 *   describe()  = groups related tests under a label (like a folder)
 *   test()      = a single scenario with one expected outcome
 *   expect()    = asserts that a value matches what we want
 *   toBe()      = strict equality (===)
 *   toHaveLength() = checks the .length property of an array or string
 *   toContain() = checks whether an array includes a specific item
 *
 * How it connects:
 * - Run by the test runner (Vitest or Jest) */

import { describe, test, expect } from 'vitest'
import { validateReport, validateEmail, sanitizeInput, type ReportValidationInput } from '../utils/validation'

// validateReport Tests

describe('validateReport', () => {
  // validReport is a known-good baseline; individual tests modify one field
  // at a time using the object spread-override pattern:  { ...validReport, field: badValue }.
  // This way each test is focused on exactly one validation rule.
  const validReport = {
    description: 'This is a valid description with enough characters.',
    location: 'City Center',
    severity: 'High',
    trappedPersons: 'no',
    incidentCategory: 'flood',
  }

  describe('valid reports', () => {
    test('accepts valid report with all required fields', () => {
      const result = validateReport(validReport)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test('accepts report with minimum valid description (10 chars)', () => {
      const report = { ...validReport, description: 'Exactly 10' }
      const result = validateReport(report)
      expect(result.valid).toBe(true)
    })

    test('accepts report with maximum valid description (2000 chars)', () => {
      const report = { ...validReport, description: 'a'.repeat(2000) }
      const result = validateReport(report)
      expect(result.valid).toBe(true)
    })

    test('accepts all valid severity levels', () => {
      for (const severity of ['Low', 'Medium', 'High']) {
        const report = { ...validReport, severity }
        const result = validateReport(report)
        expect(result.valid).toBe(true)
      }
    })

    test('accepts all valid trappedPersons values', () => {
      for (const trappedPersons of ['yes', 'property', 'no']) {
        const report = { ...validReport, trappedPersons }
        const result = validateReport(report)
        expect(result.valid).toBe(true)
      }
    })
  })

  describe('invalid descriptions', () => {
    test('rejects empty description', () => {
      const report = { ...validReport, description: '' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Description must be at least 10 characters')
    })

    test('rejects null description', () => {
      const report: ReportValidationInput = { ...validReport, description: null }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Description must be at least 10 characters')
    })

    test('rejects undefined description', () => {
      const report = { ...validReport, description: undefined }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Description must be at least 10 characters')
    })

    test('rejects description under 10 characters', () => {
      const report = { ...validReport, description: '123456789' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Description must be at least 10 characters')
    })

    test('rejects description over 2000 characters', () => {
      const report = { ...validReport, description: 'a'.repeat(2001) }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Description must be under 2000 characters')
    })
  })

  describe('invalid locations', () => {
    test('rejects empty location', () => {
      const report = { ...validReport, location: '' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Location is required')
    })

    test('rejects location under 3 characters', () => {
      const report = { ...validReport, location: 'AB' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Location is required')
    })

    test('rejects null location', () => {
      const report: ReportValidationInput = { ...validReport, location: null }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Location is required')
    })
  })

  describe('invalid severity', () => {
    test('rejects empty severity', () => {
      const report = { ...validReport, severity: '' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Severity is required')
    })

    test('rejects invalid severity value', () => {
      const report = { ...validReport, severity: 'Critical' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Severity is required')
    })

    test('rejects lowercase severity', () => {
      const report = { ...validReport, severity: 'high' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Severity is required')
    })
  })

  describe('invalid trappedPersons', () => {
    test('rejects empty trappedPersons', () => {
      const report = { ...validReport, trappedPersons: '' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Trapped persons status is required')
    })

    test('rejects invalid trappedPersons value', () => {
      const report = { ...validReport, trappedPersons: 'maybe' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Trapped persons status is required')
    })
  })

  describe('invalid incidentCategory', () => {
    test('rejects empty incidentCategory', () => {
      const report = { ...validReport, incidentCategory: '' }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Incident category is required')
    })

    test('rejects null incidentCategory', () => {
      const report: ReportValidationInput = { ...validReport, incidentCategory: null }
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Incident category is required')
    })
  })

  describe('multiple errors', () => {
    test('returns all errors for completely invalid report', () => {
      const report = {}
      const result = validateReport(report)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(4)
    })
  })
})

// validateEmail Tests

describe('validateEmail', () => {
  describe('valid emails', () => {
    test('accepts standard email', () => {
      expect(validateEmail('user@example.com')).toBe(true)
    })

    test('accepts email with subdomain', () => {
      expect(validateEmail('user@mail.example.com')).toBe(true)
    })

    test('accepts email with plus sign', () => {
      expect(validateEmail('user+tag@example.com')).toBe(true)
    })

    test('accepts email with dots in local part', () => {
      expect(validateEmail('first.last@example.com')).toBe(true)
    })

    test('accepts email with numbers', () => {
      expect(validateEmail('user123@example123.com')).toBe(true)
    })

    test('accepts email with hyphen in domain', () => {
      expect(validateEmail('user@my-domain.com')).toBe(true)
    })

    test('accepts email with various TLDs', () => {
      expect(validateEmail('user@example.co.uk')).toBe(true)
      expect(validateEmail('user@example.io')).toBe(true)
      expect(validateEmail('user@example.travel')).toBe(true)
    })
  })

  describe('invalid emails', () => {
    test('rejects empty string', () => {
      expect(validateEmail('')).toBe(false)
    })

    test('rejects email without @', () => {
      expect(validateEmail('userexample.com')).toBe(false)
    })

    test('rejects email without domain', () => {
      expect(validateEmail('user@')).toBe(false)
    })

    test('rejects email without local part', () => {
      expect(validateEmail('@example.com')).toBe(false)
    })

    test('rejects email without TLD', () => {
      expect(validateEmail('user@example')).toBe(false)
    })

    test('rejects email with spaces', () => {
      expect(validateEmail('user @example.com')).toBe(false)
      expect(validateEmail('user@ example.com')).toBe(false)
      expect(validateEmail('user@example .com')).toBe(false)
    })

    test('rejects email with multiple @', () => {
      expect(validateEmail('user@@example.com')).toBe(false)
    })

    test('rejects plain text', () => {
      expect(validateEmail('not an email')).toBe(false)
    })
  })
})

// sanitizeInput Tests

describe('sanitizeInput', () => {
  describe('removes dangerous characters', () => {
    test('removes < character', () => {
      expect(sanitizeInput('hello<world')).toBe('helloworld')
    })

    test('removes > character', () => {
      expect(sanitizeInput('hello>world')).toBe('helloworld')
    })

    test('removes single quotes', () => {
      expect(sanitizeInput("hello'world")).toBe('helloworld')
    })

    test('removes double quotes', () => {
      expect(sanitizeInput('hello"world')).toBe('helloworld')
    })

    test('removes all dangerous characters together', () => {
      expect(sanitizeInput('<script>"alert(\'xss\')"</script>')).toBe('scriptalert(xss)/script')
    })
  })

  describe('preserves safe content', () => {
    test('preserves letters', () => {
      expect(sanitizeInput('HelloWorld')).toBe('HelloWorld')
    })

    test('preserves numbers', () => {
      expect(sanitizeInput('123456')).toBe('123456')
    })

    test('preserves spaces', () => {
      expect(sanitizeInput('hello world')).toBe('hello world')
    })

    test('preserves special characters not in filter', () => {
      expect(sanitizeInput('hello@world.com')).toBe('hello@world.com')
      expect(sanitizeInput('hello#world')).toBe('hello#world')
      expect(sanitizeInput('hello$world')).toBe('hello$world')
    })

    test('preserves empty string', () => {
      expect(sanitizeInput('')).toBe('')
    })

    test('preserves unicode characters', () => {
      expect(sanitizeInput('héllo wörld')).toBe('héllo wörld')
      expect(sanitizeInput('你好世界')).toBe('你好世界')
    })
  })
})
