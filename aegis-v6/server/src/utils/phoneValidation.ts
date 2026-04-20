/**
 * Validates and normalises phone numbers based on the active region's
 * phone format rules. Strips formatting characters, applies country
 * code prefix, and validates length.
 *
 * - Used by citizenAuthRoutes.ts and authRoutes.ts during registration
 * - Gets the expected phone format from the active region adapter
 * */

import { regionRegistry } from '../adapters/regions/RegionRegistry.js'

/* Get default country code from the active region adapter */
function getDefaultCountryCode(): string {
  try { return regionRegistry.getActiveRegion().getPhoneFormat().countryCode } catch { return '44' }
}

/**
 * Validates if a phone number is in E.164 format
 * E.164 format: +[country code][subscriber number]
 * Examples: +447700900123 (UK), +14155552671 (US)
 * 
 * Rules:
 * Must start with +
 * Contains only digits after +
 * Length between 8-15 characters (including +)
 * No spaces, dashes, or parentheses
 */
export function isValidE164(phone: string): boolean {
  const e164Pattern = /^\+[1-9]\d{7,14}$/
  return e164Pattern.test(phone)
}

/**
 * Attempts to normalize a phone number to E.164 format
 * Handles common UK formats:
 * 07700 900123 ? +447700900123
 * +44 (0) 7700 900123 ? +447700900123
 * 00447700900123 ? +447700900123
 * 
 * For other countries, assumes +1 (US/Canada) if no country code
 */
export function normalizeToE164(phone: string, defaultCountryCode: string = getDefaultCountryCode()): string {
  //Remove all whitespace, parentheses, dashes
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')

  //Already in E.164 format
  if (isValidE164(cleaned)) {
    return cleaned
  }

  //Starts with 00 (international prefix) - replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2)
  }

  //Starts with + but has (0) - remove the (0)
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.replace(/\(0\)/g, '').replace(/^(\+\d+)0/, '$1')
  }

  //UK mobile starting with 0
  if (cleaned.startsWith('0') && defaultCountryCode === '44') {
    cleaned = '+44' + cleaned.slice(1)
  }

  //No country code - add default
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + defaultCountryCode + cleaned
  }

  //Validate final result
  if (isValidE164(cleaned)) {
    return cleaned
  }

  throw new Error(`Invalid phone number: ${phone}. Must be in E.164 format like +447700900123`)
}

/**
 * Formats a phone number for display
 * +447700900123 ? +44 7700 900123
 */
export function formatPhoneDisplay(phone: string): string {
  if (!isValidE164(phone)) return phone

  //Extract country code and number
  const match = phone.match(/^\+(\d{1,3})(\d+)$/)
  if (!match) return phone

  const [, countryCode, number] = match

  //UK formatting
  if (countryCode === '44' && number.length === 10) {
    return `+44 ${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`
  }

  //US/Canada formatting
  if (countryCode === '1' && number.length === 10) {
    return `+1 (${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`
  }

  //Generic formatting - add space after country code
  return `+${countryCode} ${number}`
}

/**
 * Example usage and test cases
 */
export const PHONE_EXAMPLES = {
  uk: [
    { input: '07700 900123', expected: '+447700900123' },
    { input: '+44 (0) 7700 900123', expected: '+447700900123' },
    { input: '00447700900123', expected: '+447700900123' },
    { input: '+447700900123', expected: '+447700900123' },
  ],
  us: [
    { input: '(415) 555-2671', expected: '+14155552671' },
    { input: '415-555-2671', expected: '+14155552671' },
    { input: '+1 415 555 2671', expected: '+14155552671' },
  ],
}
