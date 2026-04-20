/**
 * Central re-export point for all utilities in client/src/utils/.
 * Consumers import from this barrel instead of individual files:
 *
 *   import { formatDate, apiFetch, t } from '../utils'
 *
 * This keeps import paths short and makes it easy to swap an implementation
 * without updating every call site.
 *
 * Glossary:
 *   barrel file   = a module that only re-exports from other modules;
 *                   acts as a single, stable public API for a folder
 *   export *      = re-export every named export from a module
 *   export { ... }  = re-export only specific named exports (used for i18n below
 *                   to avoid name clashes with other i18next internal symbols)
 *   i18n          = internationalisation -- translation and locale utilities;
 *                   only t, getLanguage, and setLanguage are exposed here
 *
 * - All utility modules are listed below; add new utils to this file when created
 * - The i18n module exports only t, getLanguage, setLanguage to prevent leaking
 *   i18next internal symbols that could conflict with other exports
 */

//Accessibility helpers (ARIA, focus management, screen-reader utilities)
export * from './accessibility'

//HTTP client (apiFetch, token management, auth helpers)
export * from './api'

//Authentication utilities (JWT decoding, role checking, route guards)
export * from './auth'

//AI chatbot response engine (intent parsing, scenario matching)
export * from './chatbotEngine'

//Design-system colour tokens (Hex, RGBA, Tailwind class maps)
export * from './colorTokens'

//Cookie preference helpers (GDPR consent storage)
export * from './cookiePreferences'

//Data export utilities (CSV, PDF generation)
export * from './exportData'

//GeoJSON loader (fetch and parse map feature collections)
export * from './geoJsonLoader'

//General helpers (date formatting, string utilities, etc.)
export * from './helpers'

//Internationalisation -- only the public surface; avoids leaking i18next internals
export { t, getLanguage, setLanguage } from './i18n'

//i18n utility wrappers (locale-aware date/number formatting, pluralisation)
export * from './i18nUtils'

//Incident API functions (report submission, prediction and alert lookups)
export * from './incidentApi'

//Location utilities (geolocation, postcode lookup, coordinate helpers)
export * from './locationUtils'

//SEPA river gauge API functions (flood levels, gauge status)
export * from './sepaApi'

//Translation service (language detection, dynamic bundle loading)
export * from './translateService'

//Form validation helpers (email, phone, required fields)
export * from './validation'

//Weather API functions (Met Office data fetching and parsing)
export * from './weatherApi'
