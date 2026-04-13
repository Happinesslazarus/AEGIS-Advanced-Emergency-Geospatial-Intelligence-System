/**
 * File: config.ts
  *
  * What this file does:
  * Initialises i18next with react-i18next and the browser language
  * detector. Loads translation JSON bundles (lazy-loaded per locale),
  * sets fallback language to English, and configures namespace and key
  * separator conventions for the whole client.
  *
  * How it connects:
  * - Imported once in client/src/main.tsx before React renders
  * - Translation files in client/public/locales/<lang>/translation.json
  * - Used everywhere via useTranslation() or utils/i18n.ts t()
  * - Language preference persisted in localStorage by LanguageDetector
  * - Learn more: https://react.i18next.com
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// English (always bundled — fallback language, zero load delay)
import enCommon from './locales/en/common.json'
import enIncidents from './locales/en/incidents.json'
import enDashboard from './locales/en/dashboard.json'
import enAlerts from './locales/en/alerts.json'
import enMap from './locales/en/map.json'
import enAdmin from './locales/en/admin.json'
import enCitizen from './locales/en/citizen.json'
import enLanding from './locales/en/landing.json'

const NAMESPACES = ['common', 'incidents', 'dashboard', 'alerts', 'map', 'admin', 'citizen', 'landing'] as const

const resources = {
  en: { common: enCommon, incidents: enIncidents, dashboard: enDashboard, alerts: enAlerts, map: enMap, admin: enAdmin, citizen: enCitizen, landing: enLanding },
}

/**
 * Lazy-load translation bundles for non-English languages.
 * Uses Vite dynamic imports so each language is code-split into its own chunk.
 */
const loaders: Record<string, () => Promise<Record<string, unknown>>[]> = {
  es: () => NAMESPACES.map(ns => import(`./locales/es/${ns}.json`)),
  fr: () => NAMESPACES.map(ns => import(`./locales/fr/${ns}.json`)),
  ar: () => NAMESPACES.map(ns => import(`./locales/ar/${ns}.json`)),
  de: () => NAMESPACES.map(ns => import(`./locales/de/${ns}.json`)),
  pt: () => NAMESPACES.map(ns => import(`./locales/pt/${ns}.json`)),
  hi: () => NAMESPACES.map(ns => import(`./locales/hi/${ns}.json`)),
  zh: () => NAMESPACES.map(ns => import(`./locales/zh/${ns}.json`)),
  sw: () => NAMESPACES.map(ns => import(`./locales/sw/${ns}.json`)),
}

const loadedLanguages = new Set<string>(['en'])

export async function loadLanguage(lng: string): Promise<void> {
  if (loadedLanguages.has(lng) || !loaders[lng]) return
  const modules = await Promise.all(loaders[lng]())
  NAMESPACES.forEach((ns, i) => {
    i18n.addResourceBundle(lng, ns, (modules[i] as any).default ?? modules[i], true, true)
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

// Pre-load detected language on startup (non-blocking)
const detected = i18n.language?.split('-')[0]
if (detected && detected !== 'en' && loaders[detected]) {
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

