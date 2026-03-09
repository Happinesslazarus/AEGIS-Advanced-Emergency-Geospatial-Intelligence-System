/**
 * i18n/config.ts — react-i18next configuration
 *
 * Initializes i18next with:
 * - Browser language detection
 * - Namespace-based translation files
 * - Fallback to English
 * - Support for 9 languages
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// Import translation resources directly for reliable bundling
import enCommon from './locales/en/common.json'
import enIncidents from './locales/en/incidents.json'
import enDashboard from './locales/en/dashboard.json'
import enAlerts from './locales/en/alerts.json'
import enMap from './locales/en/map.json'

import esCommon from './locales/es/common.json'
import esIncidents from './locales/es/incidents.json'
import esDashboard from './locales/es/dashboard.json'
import esAlerts from './locales/es/alerts.json'
import esMap from './locales/es/map.json'

import frCommon from './locales/fr/common.json'
import frIncidents from './locales/fr/incidents.json'
import frDashboard from './locales/fr/dashboard.json'
import frAlerts from './locales/fr/alerts.json'
import frMap from './locales/fr/map.json'

import arCommon from './locales/ar/common.json'
import arIncidents from './locales/ar/incidents.json'
import arDashboard from './locales/ar/dashboard.json'
import arAlerts from './locales/ar/alerts.json'
import arMap from './locales/ar/map.json'

const resources = {
  en: { common: enCommon, incidents: enIncidents, dashboard: enDashboard, alerts: enAlerts, map: enMap },
  es: { common: esCommon, incidents: esIncidents, dashboard: esDashboard, alerts: esAlerts, map: esMap },
  fr: { common: frCommon, incidents: frIncidents, dashboard: frDashboard, alerts: frAlerts, map: frMap },
  ar: { common: arCommon, incidents: arIncidents, dashboard: arDashboard, alerts: arAlerts, map: arMap },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'incidents', 'dashboard', 'alerts', 'map'],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'aegis-language',
    },
    react: {
      useSuspense: false,
    },
  })

export default i18n

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
] as const

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]['code']
