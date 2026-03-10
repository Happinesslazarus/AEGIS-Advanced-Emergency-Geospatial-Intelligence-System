/**
 * i18n/config.ts — react-i18next configuration
 *
 * Initializes i18next with:
 * - Browser language detection
 * - Namespace-based translation files
 * - Fallback to English
 * - Support for 9 languages (en, es, fr, ar, de, pt, hi, zh, sw)
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// ─── English ────────────────────────────────────────────────────────────
import enCommon from './locales/en/common.json'
import enIncidents from './locales/en/incidents.json'
import enDashboard from './locales/en/dashboard.json'
import enAlerts from './locales/en/alerts.json'
import enMap from './locales/en/map.json'
import enAdmin from './locales/en/admin.json'
import enCitizen from './locales/en/citizen.json'
import enLanding from './locales/en/landing.json'

// ─── Spanish ────────────────────────────────────────────────────────────
import esCommon from './locales/es/common.json'
import esIncidents from './locales/es/incidents.json'
import esDashboard from './locales/es/dashboard.json'
import esAlerts from './locales/es/alerts.json'
import esMap from './locales/es/map.json'

// ─── French ─────────────────────────────────────────────────────────────
import frCommon from './locales/fr/common.json'
import frIncidents from './locales/fr/incidents.json'
import frDashboard from './locales/fr/dashboard.json'
import frAlerts from './locales/fr/alerts.json'
import frMap from './locales/fr/map.json'

// ─── Arabic (RTL) ────────────────────────────────────────────────────────
import arCommon from './locales/ar/common.json'
import arIncidents from './locales/ar/incidents.json'
import arDashboard from './locales/ar/dashboard.json'
import arAlerts from './locales/ar/alerts.json'
import arMap from './locales/ar/map.json'

// ─── German ──────────────────────────────────────────────────────────────
import deCommon from './locales/de/common.json'
import deIncidents from './locales/de/incidents.json'
import deDashboard from './locales/de/dashboard.json'
import deAlerts from './locales/de/alerts.json'
import deMap from './locales/de/map.json'

// ─── Portuguese ──────────────────────────────────────────────────────────
import ptCommon from './locales/pt/common.json'
import ptIncidents from './locales/pt/incidents.json'
import ptDashboard from './locales/pt/dashboard.json'
import ptAlerts from './locales/pt/alerts.json'
import ptMap from './locales/pt/map.json'

// ─── Hindi ────────────────────────────────────────────────────────────────
import hiCommon from './locales/hi/common.json'
import hiIncidents from './locales/hi/incidents.json'
import hiDashboard from './locales/hi/dashboard.json'
import hiAlerts from './locales/hi/alerts.json'
import hiMap from './locales/hi/map.json'

// ─── Chinese (Simplified) ─────────────────────────────────────────────────
import zhCommon from './locales/zh/common.json'
import zhIncidents from './locales/zh/incidents.json'
import zhDashboard from './locales/zh/dashboard.json'
import zhAlerts from './locales/zh/alerts.json'
import zhMap from './locales/zh/map.json'

// ─── Swahili ──────────────────────────────────────────────────────────────
import swCommon from './locales/sw/common.json'
import swIncidents from './locales/sw/incidents.json'
import swDashboard from './locales/sw/dashboard.json'
import swAlerts from './locales/sw/alerts.json'
import swMap from './locales/sw/map.json'

const resources = {
  en: { common: enCommon, incidents: enIncidents, dashboard: enDashboard, alerts: enAlerts, map: enMap, admin: enAdmin, citizen: enCitizen, landing: enLanding },
  es: { common: esCommon, incidents: esIncidents, dashboard: esDashboard, alerts: esAlerts, map: esMap },
  fr: { common: frCommon, incidents: frIncidents, dashboard: frDashboard, alerts: frAlerts, map: frMap },
  ar: { common: arCommon, incidents: arIncidents, dashboard: arDashboard, alerts: arAlerts, map: arMap },
  de: { common: deCommon, incidents: deIncidents, dashboard: deDashboard, alerts: deAlerts, map: deMap },
  pt: { common: ptCommon, incidents: ptIncidents, dashboard: ptDashboard, alerts: ptAlerts, map: ptMap },
  hi: { common: hiCommon, incidents: hiIncidents, dashboard: hiDashboard, alerts: hiAlerts, map: hiMap },
  zh: { common: zhCommon, incidents: zhIncidents, dashboard: zhDashboard, alerts: zhAlerts, map: zhMap },
  sw: { common: swCommon, incidents: swIncidents, dashboard: swDashboard, alerts: swAlerts, map: swMap },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'incidents', 'dashboard', 'alerts', 'map', 'admin', 'citizen', 'landing'],
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
  { code: 'en', name: 'English',    nativeName: 'English',    dir: 'ltr' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español',    dir: 'ltr' },
  { code: 'fr', name: 'French',     nativeName: 'Français',   dir: 'ltr' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية',    dir: 'rtl' },
  { code: 'de', name: 'German',     nativeName: 'Deutsch',    dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português',  dir: 'ltr' },
  { code: 'hi', name: 'Hindi',      nativeName: 'हिन्दी',      dir: 'ltr' },
  { code: 'zh', name: 'Chinese',    nativeName: '中文',        dir: 'ltr' },
  { code: 'sw', name: 'Swahili',    nativeName: 'Kiswahili',  dir: 'ltr' },
] as const

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]['code']
