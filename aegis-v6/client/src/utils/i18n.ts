/**
 * Thin wrapper around i18next providing t(), setLanguage(), getLanguage(),
 * and isRtl() for programmatic language access outside React hooks.
 *
 * - Used across the whole client for translated text
 * - Language resources defined in client/src/i18n/config.ts
 * - Language preference stored in localStorage
 *
 * - client/src/i18n/config.ts       -- language bundles and i18next setup
 * - client/src/hooks/useLanguage.ts -- React hook for language switching
 */

import i18next from '../i18n/config'
import { getRegion } from '../config/regionConfig'

const I18NEXT_ONLY_CODES = ['es', 'fr', 'ar', 'zh', 'hi', 'pt', 'pl', 'ur', 'de', 'sw']

const LANGUAGE_ALIASES: Record<string, string> = {
  english: 'en', spanish: 'es', español: 'es', french: 'fr',
  arabic: 'ar', chinese: 'zh', hindi: 'hi', portuguese: 'pt',
  polish: 'pl', urdu: 'ur',
}

export function normalizeLanguageCode(value?: string): string {
  if (!value) return 'en'
  const normalized = String(value).trim().toLowerCase().replace('_', '-')
  const base = normalized.split('-')[0]
  if (normalized === 'en' || base === 'en') return 'en'
  if (I18NEXT_ONLY_CODES.includes(normalized)) return normalized
  if (I18NEXT_ONLY_CODES.includes(base)) return base
  const alias = LANGUAGE_ALIASES[normalized]
  if (alias) return alias
  return 'en'
}

export type I18nKey = string

export function t(key: string, lang: string = 'en'): string {
  const normalizedLang = normalizeLanguageCode(lang)
  const i18nextValue = i18next.t(key, { lng: normalizedLang, defaultValue: '' })
  let value = (i18nextValue && i18nextValue !== key) ? i18nextValue as string : ''
  if (!value) {
    value = key.split('.').pop()?.replace(/([A-Z])/g, ' $1').trim() || key
  }
  if (value.includes('{{EMERGENCY_NUMBER}}')) {
    try { value = value.split('{{EMERGENCY_NUMBER}}').join(getRegion().emergencyNumber) }
    catch { value = value.split('{{EMERGENCY_NUMBER}}').join('999') }
  }
  return value
}

export function isRtl(lang?: string): boolean {
  return ['ar', 'ur'].includes(lang || currentLang)
}

// Language state (persisted to localStorage)

function getInitialLanguage(): string {
  if (typeof window === 'undefined') return 'en'

  try {
    return normalizeLanguageCode(
      localStorage.getItem('aegis_lang')
      || localStorage.getItem('aegis-language')
      || 'en',
    )
  } catch {
    return 'en'
  }
}

let currentLang = getInitialLanguage()
const listeners: ((lang: string) => void)[] = []

export function getLanguage(): string { return currentLang }

export function setLanguage(lang: string): void {
  currentLang = normalizeLanguageCode(lang)
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('aegis_lang', currentLang)
      localStorage.setItem('aegis-language', currentLang)
    } catch (err) {
      console.warn('[i18n] Could not persist language preference:', err)
    }
  }
  void i18next.changeLanguage(currentLang).catch(() => {
    //Keep the custom i18n store authoritative even if the react-i18next
    //instance is not ready yet.
  })
  listeners.forEach(fn => fn(currentLang))
}

export function onLanguageChange(fn: (lang: string) => void): () => void {
  listeners.push(fn)
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) }
}

export function getMissingTranslationKeys(_lang: string): string[] {
  return []
}

export function getChatLanguageName(): string {
  const names: Record<string, string> = {
    en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic',
    zh: 'Chinese', hi: 'Hindi', pt: 'Portuguese', pl: 'Polish', ur: 'Urdu',
  }
  return names[currentLang] || 'English'
}

//PLURALIZATION RULES (CLDR-compliant)

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

//CLDR plural rules per language
//https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html
const PLURAL_RULES: Record<string, (n: number) => PluralCategory> = {
  en: (n) => n === 1 ? 'one' : 'other',
  es: (n) => n === 1 ? 'one' : 'other',
  fr: (n) => (n === 0 || n === 1) ? 'one' : 'other',
  ar: (n) => {
    if (n === 0) return 'zero'
    if (n === 1) return 'one'
    if (n === 2) return 'two'
    const mod100 = n % 100
    if (mod100 >= 3 && mod100 <= 10) return 'few'
    if (mod100 >= 11) return 'many'
    return 'other'
  },
  zh: () => 'other',
  hi: (n) => (n === 0 || n === 1) ? 'one' : 'other',
  pt: (n) => n === 1 ? 'one' : 'other',
  pl: (n) => {
    if (n === 1) return 'one'
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
    return 'many'
  },
  ur: (n) => n === 1 ? 'one' : 'other',
}

export function getPluralCategory(n: number, lang?: string): PluralCategory {
  const normalizedLang = normalizeLanguageCode(lang || currentLang)
  const rule = PLURAL_RULES[normalizedLang] || PLURAL_RULES.en
  return rule(Math.abs(n))
}

export function plural(count: number, forms: PluralForms, lang?: string): string {
  const category = getPluralCategory(count, lang)
  const template = forms[category] ?? forms.other
  return template.replace(/\{\{count\}\}/g, String(count))
}

export const PLURALS = {
  alerts: (count: number, lang?: string) => plural(count, {
    zero: 'None',
    one: 'Active Alerts: 1',
    other: `Active Alerts: {{count}}`,
  }, lang),

  reports: (count: number, lang?: string) => plural(count, {
    one: '1 report',
    other: '{{count}} reports',
  }, lang),

  minutes: (count: number, lang?: string) => {
    const forms: Record<string, PluralForms> = {
      en: { one: '1 minute ago', other: '{{count}} minutes ago' },
      es: { one: 'hace 1 minuto', other: 'hace {{count}} minutos' },
      fr: { one: 'il y a 1 minute', other: 'il y a {{count}} minutes' },
      ar: { zero: 'الآن', one: 'منذ دقيقة', two: 'منذ دقيقتين', few: 'منذ {{count}} دقائق', many: 'منذ {{count}} دقيقة', other: 'منذ {{count}} دقيقة' },
      zh: { other: '{{count}}分钟前' },
      hi: { one: '1 मिनट पहले', other: '{{count}} मिनट पहले' },
      pt: { one: 'há 1 minuto', other: 'há {{count}} minutos' },
      pl: { one: '1 minutę temu', few: '{{count}} minuty temu', many: '{{count}} minut temu', other: '{{count}} minut temu' },
      ur: { one: '1 منٹ پہلے', other: '{{count}} منٹ پہلے' },
    }
    const normalizedLang = normalizeLanguageCode(lang || currentLang)
    return plural(count, forms[normalizedLang] || forms.en, lang)
  },

  hours: (count: number, lang?: string) => {
    const forms: Record<string, PluralForms> = {
      en: { one: '1 hour ago', other: '{{count}} hours ago' },
      es: { one: 'hace 1 hora', other: 'hace {{count}} horas' },
      fr: { one: 'il y a 1 heure', other: 'il y a {{count}} heures' },
      ar: { one: 'منذ ساعة', two: 'منذ ساعتين', few: 'منذ {{count}} ساعات', many: 'منذ {{count}} ساعة', other: 'منذ {{count}} ساعة' },
      zh: { other: '{{count}}小时前' },
      hi: { one: '1 घंटा पहले', other: '{{count}} घंटे पहले' },
      pt: { one: 'há 1 hora', other: 'há {{count}} horas' },
      pl: { one: '1 godzinę temu', few: '{{count}} godziny temu', many: '{{count}} godzin temu', other: '{{count}} godzin temu' },
      ur: { one: '1 گھنٹہ پہلے', other: '{{count}} گھنٹے پہلے' },
    }
    const normalizedLang = normalizeLanguageCode(lang || currentLang)
    return plural(count, forms[normalizedLang] || forms.en, lang)
  },
}

//LOCALE-SPECIFIC FORMATTING

const LOCALE_CODES: Record<string, string> = {
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-SA',
  zh: 'zh-CN',
  hi: 'hi-IN',
  pt: 'pt-PT',
  pl: 'pl-PL',
  ur: 'ur-PK',
}

export function getLocaleCode(lang?: string): string {
  const normalizedLang = normalizeLanguageCode(lang || currentLang)
  return LOCALE_CODES[normalizedLang] || 'en-GB'
}

export function formatNumber(value: number, lang?: string, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(getLocaleCode(lang), options).format(value)
  } catch {
    return String(value)
  }
}

export function formatDate(
  date: Date | number | string,
  lang?: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(getLocaleCode(lang), options).format(d)
  } catch {
    return String(date)
  }
}

export function formatTime(
  date: Date | number | string,
  lang?: string,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(getLocaleCode(lang), options).format(d)
  } catch {
    return String(date)
  }
}

export function formatDateTime(
  date: Date | number | string,
  lang?: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(getLocaleCode(lang), options).format(d)
  } catch {
    return String(date)
  }
}

export function formatRelativeTime(date: Date | number | string, lang?: string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : typeof date === 'number' ? new Date(date) : date
    const now = Date.now()
    const diff = d.getTime() - now
    const absDiff = Math.abs(diff)

    const rtf = new Intl.RelativeTimeFormat(getLocaleCode(lang), { numeric: 'auto' })

    if (absDiff < 60 * 1000) {
      return rtf.format(Math.round(diff / 1000), 'second')
    } else if (absDiff < 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (60 * 1000)), 'minute')
    } else if (absDiff < 24 * 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (60 * 60 * 1000)), 'hour')
    } else if (absDiff < 7 * 24 * 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (24 * 60 * 60 * 1000)), 'day')
    } else if (absDiff < 30 * 24 * 60 * 60 * 1000) {
      return rtf.format(Math.round(diff / (7 * 24 * 60 * 60 * 1000)), 'week')
    } else {
      return rtf.format(Math.round(diff / (30 * 24 * 60 * 60 * 1000)), 'month')
    }
  } catch {
    return String(date)
  }
}

export function formatDistance(meters: number, lang?: string): string {
  const normalizedLang = normalizeLanguageCode(lang || currentLang)

  const useImperial = normalizedLang === 'en' && typeof navigator !== 'undefined' &&
    (navigator.language?.includes('US') || navigator.language?.includes('us'))

  if (useImperial) {
    const miles = meters / 1609.344
    if (miles < 0.1) {
      const feet = meters * 3.28084
      return formatNumber(Math.round(feet), lang) + ' ft'
    }
    return formatNumber(Math.round(miles * 10) / 10, lang) + ' mi'
  } else {
    if (meters < 1000) {
      return formatNumber(Math.round(meters), lang) + ' m'
    }
    return formatNumber(Math.round(meters / 100) / 10, lang) + ' km'
  }
}

//RTL LAYOUT UTILITIES

export function isRtlLanguage(lang?: string): boolean {
  return ['ar', 'ur'].includes(normalizeLanguageCode(lang || currentLang))
}

export function getTextDirection(lang?: string): 'ltr' | 'rtl' {
  return isRtlLanguage(lang) ? 'rtl' : 'ltr'
}

export function getDirectionalStyles(lang?: string): {
  startAlign: 'left' | 'right'
  endAlign: 'left' | 'right'
  startMargin: 'marginLeft' | 'marginRight'
  endMargin: 'marginLeft' | 'marginRight'
  startPadding: 'paddingLeft' | 'paddingRight'
  endPadding: 'paddingLeft' | 'paddingRight'
} {
  const rtl = isRtlLanguage(lang)
  return {
    startAlign: rtl ? 'right' : 'left',
    endAlign: rtl ? 'left' : 'right',
    startMargin: rtl ? 'marginRight' : 'marginLeft',
    endMargin: rtl ? 'marginLeft' : 'marginRight',
    startPadding: rtl ? 'paddingRight' : 'paddingLeft',
    endPadding: rtl ? 'paddingLeft' : 'paddingRight',
  }
}

export function mirrorForRtl<T>(ltrValue: T, rtlValue: T, lang?: string): T {
  return isRtlLanguage(lang) ? rtlValue : ltrValue
}

export function getChevronDirection(direction: 'back' | 'forward', lang?: string): 'left' | 'right' {
  const isRtlDir = isRtlLanguage(lang)
  if (direction === 'back') {
    return isRtlDir ? 'right' : 'left'
  }
  return isRtlDir ? 'left' : 'right'
}

export function rtlClass(classes: string, lang?: string): string {
  if (!isRtlLanguage(lang)) return classes

  return classes
    .replace(/\bml-/g, '__mr-__')
    .replace(/\bmr-/g, 'ml-')
    .replace(/__mr-__/g, 'mr-')
    .replace(/\bpl-/g, '__pr-__')
    .replace(/\bpr-/g, 'pl-')
    .replace(/__pr-__/g, 'pr-')
    .replace(/\bleft-/g, '__right-__')
    .replace(/\bright-/g, 'left-')
    .replace(/__right-__/g, 'right-')
    .replace(/\btext-left\b/g, 'text-right')
    .replace(/\btext-right\b/g, 'text-left')
    .replace(/\brounded-l\b/g, '__rounded-r__')
    .replace(/\brounded-r\b/g, 'rounded-l')
    .replace(/__rounded-r__/g, 'rounded-r')
    .replace(/\bborder-l\b/g, '__border-r__')
    .replace(/\bborder-r\b/g, 'border-l')
    .replace(/__border-r__/g, 'border-r')
}

//TRANSLATION INTERPOLATION

export function interpolate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? String(variables[key]) : match
  })
}

export function tVar(key: string, variables: Record<string, string | number>, lang?: string): string {
  const template = t(key, lang)
  return interpolate(template, variables)
}
