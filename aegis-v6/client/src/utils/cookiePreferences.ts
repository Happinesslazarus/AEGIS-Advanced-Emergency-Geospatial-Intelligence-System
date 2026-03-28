/**
 * cookiePreferences.ts — Cookie consent state management for AEGIS
 *
 * Stores consent in localStorage under `aegis_cookie_consent`.
 * When consentVersion is bumped the banner automatically reappears.
 */

const STORAGE_KEY = 'aegis_cookie_consent'

/* Increment this whenever the consent categories or legal text change. */
export const CURRENT_CONSENT_VERSION = 1

export type ConsentState = {
  essential: true
  preferences: boolean
  analytics: boolean
  consentedAt: string
  consentVersion: number
}

export type ConsentCategory = 'essential' | 'preferences' | 'analytics'

/* Event name dispatched on window when consent changes. */
export const CONSENT_CHANGE_EVENT = 'aegis-consent-change'

// Read

/* Returns the stored consent or `null` if no (valid) consent exists. */
export function getConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: ConsentState = JSON.parse(raw)
    if (parsed.consentVersion !== CURRENT_CONSENT_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/* Check whether a specific category is currently consented to. */
export function hasConsentFor(category: ConsentCategory): boolean {
  if (category === 'essential') return true
  const consent = getConsent()
  if (!consent) return false
  return consent[category] === true
}

// Write

/* Persist a new consent state and notify listeners. */
export function saveConsent(state: Omit<ConsentState, 'essential' | 'consentedAt' | 'consentVersion'>): void {
  const full: ConsentState = {
    essential: true,
    preferences: state.preferences,
    analytics: state.analytics,
    consentedAt: new Date().toISOString(),
    consentVersion: CURRENT_CONSENT_VERSION,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full))
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: full }))
}

/* Clear stored consent — the banner will reappear on next render. */
export function resetConsent(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: null }))
}
