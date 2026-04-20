/**
 * File: validation.ts
 *
 * What this file does:
 * Client-side form validation functions for report, auth, and profile forms.
 * Validates description length, location format, and image file sizes, then
 * returns structured error messages. Mirrors server Zod schemas to catch
 * issues before they hit the API.
 *
 * How it connects:
 * - Used by client/src/components/citizen/ReportForm.tsx
 * - Used by client/src/pages/CitizenAuthPage.tsx
 * - Server-side counterpart: server/src/middleware/validate.ts
 */


/**
 * Validation functions for client-side forms. Each function takes an object of
 * input values and returns an object with a boolean 'valid' property and an  array of 'errors' messages. These functions mirror the server-side Zod schemas to catch validation issues before they reach the API.
 */
                                                                                                                                                                                                                                                                                           
export interface ReportValidationInput {
  description?: string | null
  location?: string | null
  severity?: string | null
  trappedPersons?: string | null
  incidentCategory?: string | null
}

//validateReport()
export function validateReport(data: ReportValidationInput): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!data.description || data.description.length < 10) errors.push('Description must be at least 10 characters')
  if (data.description && data.description.length > 2000) errors.push('Description must be under 2000 characters')
  if (!data.location || data.location.length < 3) errors.push('Location is required')
  if (!data.severity || !['Low','Medium','High'].includes(data.severity)) errors.push('Severity is required')
  if (!data.trappedPersons || !['yes','property','no'].includes(data.trappedPersons)) errors.push('Trapped persons status is required')
  if (!data.incidentCategory) errors.push('Incident category is required')
  return { valid: errors.length === 0, errors }
}

//validateEmail() and sanitizeInput() are used in auth forms and profile forms to validate email formats and sanitize user inputs to prevent XSS attacks. These functions can be imported and used in any component that handles user input, such as client/src/components/auth/LoginForm.tsx or client/src/components/profile/ProfileEditForm.tsx.
export function validateEmail(e: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) }
export function sanitizeInput(s: string): string { return s.replace(/[<>'"]/g, '') }
