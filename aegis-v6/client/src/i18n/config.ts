/**
 * File: config.ts
 *
 * What this file does:
 * Initialises i18next with react-i18next and the browser language detector.
 *
 * Language loading strategy:
 * - English:  statically bundled at build time -- it is the fallback language
 *             and must always be available with zero latency.
 * - Arabic:   statically bundled -- RTL layout requires dedicated CSS direction
 *             handling (document dir, flex mirroring, text alignment) that was
 *             manually tested and verified against the static bundle.
 * - All other languages: resolved dynamically via the AEGIS translation
 *             microservice (POST /api/translate/batch).  The service cascades
 * through Azure Cognitive Translator -> DeepL -> LibreTranslate,
 *             caches results in PostgreSQL for 30 days, and the client adds a
 *             second cache layer in localStorage (7-day TTL) so subsequent
 *             language switches are served instantly without a network round-trip.
 *
 * How it connects:
 * - Imported once in client/src/main.tsx before React renders
 * - Dynamic translation handled by client/src/i18n/dynamicLocaleLoader.ts
 * - Backend endpoint: server/src/routes/translationRoutes.ts POST /api/translate/batch
 * - Language preference persisted in localStorage by LanguageDetector
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { translateNamespace } from './dynamicLocaleLoader'

//English -- statically bundled, always available, zero load delay
import enCommon from './locales/en/common.json'
import enIncidents from './locales/en/incidents.json'
import enDashboard from './locales/en/dashboard.json'
import enAlerts from './locales/en/alerts.json'
import enMap from './locales/en/map.json'
import enAdmin from './locales/en/admin.json'
import enCitizen from './locales/en/citizen.json'
import enLanding from './locales/en/landing.json'

//Arabic -- statically bundled for RTL layout correctness
import arCommon from './locales/ar/common.json'
import arIncidents from './locales/ar/incidents.json'
import arDashboard from './locales/ar/dashboard.json'
import arAlerts from './locales/ar/alerts.json'
import arMap from './locales/ar/map.json'
import arAdmin from './locales/ar/admin.json'
import arCitizen from './locales/ar/citizen.json'
import arLanding from './locales/ar/landing.json'

const NAMESPACES = ['common', 'incidents', 'dashboard', 'alerts', 'map', 'admin', 'citizen', 'landing'] as const

/** English namespace bundles keyed by namespace name -- used as the translation source. */
const EN_BUNDLES: Record<string, Record<string, unknown>> = {
  common: enCommon, incidents: enIncidents, dashboard: enDashboard,
  alerts: enAlerts, map: enMap, admin: enAdmin, citizen: enCitizen, landing: enLanding,
}

/** Arabic namespace bundles -- statically available. */
const AR_BUNDLES: Record<string, Record<string, unknown>> = {
  common: arCommon, incidents: arIncidents, dashboard: arDashboard,
  alerts: arAlerts, map: arMap, admin: arAdmin, citizen: arCitizen, landing: arLanding,
}

const resources = {
  en: { common: enCommon, incidents: enIncidents, dashboard: enDashboard, alerts: enAlerts, map: enMap, admin: enAdmin, citizen: enCitizen, landing: enLanding },
  ar: { common: arCommon, incidents: arIncidents, dashboard: arDashboard, alerts: arAlerts, map: arMap, admin: arAdmin, citizen: arCitizen, landing: arLanding },
}

const loadedLanguages = new Set<string>(['en', 'ar'])

/**
 * Load a language into i18next.
 *
 * - English and Arabic are already registered at init time.
 * - Any other language is translated on demand via the backend microservice,
 *   with results cached in localStorage so repeat calls are instant.
 */
export async function loadLanguage(lng: string): Promise<void> {
  if (loadedLanguages.has(lng)) return

  //Dynamically translate all namespaces via the AEGIS translation microservice.
  //translateNamespace handles batching, the provider cascade, and localStorage caching.
  const translated = await Promise.all(
    NAMESPACES.map(ns => translateNamespace(EN_BUNDLES[ns], lng, ns))
  )
  NAMESPACES.forEach((ns, i) => {
    i18n.addResourceBundle(lng, ns, translated[i], true, true)
  })
  loadedLanguages.add(lng)
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [...NAMESPACES],
    partialBundledLanguages: true,
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

//Pre-load detected language on startup (non-blocking).
//Arabic is already in resources; other languages trigger the translation pipeline.
const detected = i18n.language?.split('-')[0]
if (detected && detected !== 'en' && detected !== 'ar') {
  loadLanguage(detected).then(() => i18n.changeLanguage(detected))
}

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

