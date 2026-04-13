/**
 * File: cookiePreferences.ts
 *
 * What this file does:
 * Manages GDPR cookie-consent state stored in localStorage. Provides
 * getConsent(), setConsent(), hasConsentFor(), and revokeConsent().
 * Dispatches an aegis-consent-change window event so listening components
 * update without a full reload.
 *
 * How it connects:
 * - Read by CookieConsent.tsx banner to gate analytics initialisation
 * - Read by client/src/utils/api.ts to decide whether to attach analytics IDs
 * - Learn more: client/src/components/CookieConsent.tsx
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

/* Returns the stored consent or `null` if no (valid) consent exists.
 * Returns null if the stored version doesn’t match CURRENT_CONSENT_VERSION —
 * this forces a re-prompt whenever the privacy policy or cookie categories change,
 * as required by GDPR Article 7 (conditions for consent). */
export function getConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: ConsentState = JSON.parse(raw)
    // Old consent records (different version) are no longer valid.  The user
    // must re-consent to the updated terms before analytics can run.
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

/* Persist a new consent state and notify listeners.
 * The CONSENT_CHANGE_EVENT (a CustomEvent, not a plain Event) carries the
 * new ConsentState in event.detail so listeners don’t have to re-read
 * localStorage to find out what changed. */
export function saveConsent(state: Omit<ConsentState, 'essential' | 'consentedAt' | 'consentVersion'>): void {
  const full: ConsentState = {
    essential: true,  // essential cookies are always on (can’t be opted out under GDPR)
    preferences: state.preferences,
    analytics: state.analytics,
    consentedAt: new Date().toISOString(),  // record when the user clicked Accept
    consentVersion: CURRENT_CONSENT_VERSION,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full))
  // Dispatch a native DOM event so React components using addEventListener
  // or the useConsent hook get an instant update without polling.
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: full }))
}

/* Clear stored consent — the banner will reappear on next render. */
export function resetConsent(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: null }))
}

