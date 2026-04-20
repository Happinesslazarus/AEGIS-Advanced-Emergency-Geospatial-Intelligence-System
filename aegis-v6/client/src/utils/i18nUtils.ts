/**
 * File: i18nUtils.ts
 *
 * Locale-aware formatting utilities that complement the react-i18next translation layer.
 * Every function uses the browser's built-in Intl APIs (ECMAScript Internationalisation
 * API Specification) and falls back to simple string manipulation when an Intl constructor
 * throws (e.g. in older environments or for unsupported locales).
 *
 * Glossary:
 *   Intl                   = the global ECMAScript Internationalisation API namespace
 *   locale                 = a BCP-47 language tag string such as 'en', 'fr', 'ar-SA';
 *                            determines number, date, and text formatting rules
 *   BCP-47                 = IETF standard for language tags: language + optional script
 *                            and region subtag (e.g. 'zh-Hant-TW')
 *   RTL                    = Right-To-Left; languages like Arabic, Hebrew, Urdu that
 *                            are written from right to left; requires mirroring the UI
 *   dir attribute          = HTML global attribute on <html> or <body>;
 *                            'rtl' or 'ltr' -- tells the browser the base text direction
 *   Intl.NumberFormat      = formats a number into a locale-specific string;
 *                            supports currency, percent, and compact notation styles
 *   Intl.DateTimeFormat    = formats a Date into a locale-specific date/time string
 *   Intl.RelativeTimeFormat = formats a duration as a relative string like '2 hours ago'
 *   Intl.PluralRules       = selects the plural category for a number in a given locale
 *                            (languages have different plural forms: 0, 1, 2, few, many, other)
 *   Intl.ListFormat        = formats an array of strings into a natural-language list
 *                            ('a, b, and c' for conjunction; 'a, b, or c' for disjunction)
 *   Intl.Collator          = locale-aware string comparator; 'base' sensitivity means
 *                            accented characters are treated as equal to their base letters
 *   Intl.DisplayNames      = resolves human-readable names for language/region/currency codes
 *   LDML plural rule       = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
 *                            as defined by Unicode CLDR (Common Locale Data Repository)
 * compact notation = number abbreviation: 1,200 -> '1.2K', 2,500,000 -> '2.5M'
 *   unitDisplay            = 'long' | 'short' | 'narrow' -- how verbose the unit label is
 *   sensitivity: 'base'    = Collator option: compare only base letters, ignoring
 *                            accents and case ('a' == 'à' == 'A')
 *
 * How it connects:
 * - Used alongside react-i18next throughout the app
 * - Follows ICU MessageFormat conventions for pluralisation
 * - The applyRTL() function is called by ThemeContext when the user changes language
 */

//RTL (Right-To-Left) language constants and DOM helpers

//Languages that are written right-to-left and need mirrored layouts
export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug'] as const
export type RTLLanguage = typeof RTL_LANGUAGES[number]

//Supported locale registry

//Full metadata for each locale; includes the date/number format convention
//so components can show locale-appropriate date format hints to the user
export const SUPPORTED_LOCALES = {
  en: { name: 'English', nativeName: 'English', dir: 'ltr', dateFormat: 'MM/DD/YYYY', numberFormat: 'en-US' },
  es: { name: 'Spanish', nativeName: 'Español', dir: 'ltr', dateFormat: 'DD/MM/YYYY', numberFormat: 'es-ES' },
  fr: { name: 'French', nativeName: 'Français', dir: 'ltr', dateFormat: 'DD/MM/YYYY', numberFormat: 'fr-FR' },
  de: { name: 'German', nativeName: 'Deutsch', dir: 'ltr', dateFormat: 'DD.MM.YYYY', numberFormat: 'de-DE' },
  pt: { name: 'Portuguese', nativeName: 'Português', dir: 'ltr', dateFormat: 'DD/MM/YYYY', numberFormat: 'pt-BR' },
  ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl', dateFormat: 'DD/MM/YYYY', numberFormat: 'ar-SA' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr', dateFormat: 'DD/MM/YYYY', numberFormat: 'hi-IN' },
  zh: { name: 'Chinese', nativeName: '中文', dir: 'ltr', dateFormat: 'YYYY/MM/DD', numberFormat: 'zh-CN' },
  sw: { name: 'Swahili', nativeName: 'Kiswahili', dir: 'ltr', dateFormat: 'DD/MM/YYYY', numberFormat: 'sw-TZ' },
  ja: { name: 'Japanese', nativeName: '日本語', dir: 'ltr', dateFormat: 'YYYY/MM/DD', numberFormat: 'ja-JP' },
  ko: { name: 'Korean', nativeName: '한국어', dir: 'ltr', dateFormat: 'YYYY/MM/DD', numberFormat: 'ko-KR' },
  ru: { name: 'Russian', nativeName: 'Русский', dir: 'ltr', dateFormat: 'DD.MM.YYYY', numberFormat: 'ru-RU' },
} as const

export type SupportedLocale = keyof typeof SUPPORTED_LOCALES

//RTL support helpers

/**
 * Returns true if the given BCP-47 locale code is a right-to-left language.
 * Uses only the primary language subtag (e.g. 'ar' from 'ar-SA').
 */
export function isRTL(locale: string): boolean {
  const lang = locale.split('-')[0].toLowerCase() // extract base language tag
  return RTL_LANGUAGES.includes(lang as RTLLanguage)
}

/**
 * Get text direction for locale
 */
export function getTextDirection(locale: string): 'ltr' | 'rtl' {
  return isRTL(locale) ? 'rtl' : 'ltr'
}

/**
 * Applies RTL direction and language to the root <html> element.
 * Called when the user switches language so CSS logical properties
 * and the browser's own bidirectionality algorithm take effect immediately.
 */
export function applyRTL(locale: string): void {
  const dir = getTextDirection(locale)
  document.documentElement.setAttribute('dir', dir)    // tells the browser text direction
  document.documentElement.setAttribute('lang', locale) // used by screen readers and spellcheck

  //The 'rtl' CSS class is used by Tailwind and custom CSS rules
  //to flip flex-direction, margins, and icon placement
  if (dir === 'rtl') {
    document.documentElement.classList.add('rtl')
  } else {
    document.documentElement.classList.remove('rtl')
  }
}

/**
 * Maps a physical CSS property to its logical CSS equivalent,
 * swapping inline-start <-> inline-end for RTL languages.
 * Logical CSS properties (e.g. 'margin-inline-start') are direction-aware,
 * so they automatically adapt without needing separate RTL overrides.
 */
export function getLogicalProperty(
  property: 'left' | 'right' | 'margin-left' | 'margin-right' | 'padding-left' | 'padding-right',
  isRTL: boolean
): string {
  const mappings: Record<string, { ltr: string; rtl: string }> = {
    'left': { ltr: 'inline-start', rtl: 'inline-end' },
    'right': { ltr: 'inline-end', rtl: 'inline-start' },
    'margin-left': { ltr: 'margin-inline-start', rtl: 'margin-inline-end' },
    'margin-right': { ltr: 'margin-inline-end', rtl: 'margin-inline-start' },
    'padding-left': { ltr: 'padding-inline-start', rtl: 'padding-inline-end' },
    'padding-right': { ltr: 'padding-inline-end', rtl: 'padding-inline-start' },
  }
  
  return mappings[property]?.[isRTL ? 'rtl' : 'ltr'] || property
}

//Number formatting (uses Intl.NumberFormat internally)

/**
 * Formats a number into a locale-specific string.
 * Falls back to String(value) if the Intl constructor is unavailable.
 * Pass Intl.NumberFormatOptions to customise decimal places, grouping, etc.
 */
export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value)
  } catch {
    return String(value)
  }
}

/**
 * Formats a monetary value with locale-specific currency symbol and spacing.
 * minimumFractionDigits:0 allows whole-number currencies (e.g. JPY).
 * Falls back to '{CURRENCY} {value}' if Intl is unavailable.
 */
export function formatCurrency(
  value: number,
  locale: string,
  currency: string = 'USD'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

/**
 * Formats a ratio (0.0-1.0) as a locale-specific percentage string.
 * decimals controls the number of decimal places shown.
 * Falls back to '(value*100)%' if Intl is unavailable.
 */
export function formatPercent(
  value: number,
  locale: string,
  decimals: number = 0
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  } catch {
    return `${(value * 100).toFixed(decimals)}%`
  }
}

/**
 * Formats a large number into a compact abbreviated string (1.2K, 3.4M, 5.6B).
 * The manual fallback covers environments where Intl compact notation is unsupported.
 */
export function formatCompactNumber(
  value: number,
  locale: string
): string {
  try {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      compactDisplay: 'short',
    }).format(value)
  } catch {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
    return String(value)
  }
}

//Date and time formatting (uses Intl.DateTimeFormat internally)

/**
 * Formats a date value (Date object, ISO string, or Unix timestamp) into a
 * locale-specific date string.  Default format: '12 Jan 2024' style.
 * Pass options to override year/month/day display style.
 */
export function formatDate(
  date: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const d = new Date(date)
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options,
    }).format(d)
  } catch {
    return String(date)
  }
}

/**
 * Format time with locale
 */
export function formatTime(
  date: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const d = new Date(date)
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: 'numeric',
      ...options,
    }).format(d)
  } catch {
    return String(date)
  }
}

/**
 * Format date and time
 */
export function formatDateTime(
  date: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const d = new Date(date)
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      ...options,
    }).format(d)
  } catch {
    return String(date)
  }
}

/**
 * Formats a relative time string like '2 hours ago' or 'in 3 days'.
 * Picks the appropriate unit (second/minute/hour/day/week/month/year)
 * based on the magnitude of the difference from now.
 * numeric:'auto' produces natural strings like 'yesterday' instead of '1 day ago'.
 */
export function formatRelativeTime(
  date: Date | string | number,
  locale: string,
  options?: Intl.RelativeTimeFormatOptions
): string {
  try {
    const d = new Date(date)
    const now = new Date()
    const diffMs = d.getTime() - now.getTime()
    const diffSec = Math.round(diffMs / 1000)
    const diffMin = Math.round(diffSec / 60)
    const diffHour = Math.round(diffMin / 60)
    const diffDay = Math.round(diffHour / 24)
    const diffWeek = Math.round(diffDay / 7)
    const diffMonth = Math.round(diffDay / 30)
    const diffYear = Math.round(diffDay / 365)
    
    const rtf = new Intl.RelativeTimeFormat(locale, {
      numeric: 'auto', // 'auto' uses natural language ('yesterday') when possible
      ...options,
    })

    //Pick the most readable unit for the magnitude of the difference
    if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second')
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
    if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour')
    if (Math.abs(diffDay) < 7) return rtf.format(diffDay, 'day')
    if (Math.abs(diffWeek) < 4) return rtf.format(diffWeek, 'week')
    if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month')
    return rtf.format(diffYear, 'year')  // fallback to years for very old dates
  } catch {
    return formatDate(date, locale)
  }
}

/**
 * Formats a duration in seconds as a human-readable string ('2h 30m').
 * Uses Intl.NumberFormat with unit display for locale-aware unit labels;
 * falls back to compact '2h 30m' format if Intl units are not supported.
 */
export function formatDuration(
  seconds: number,
  locale: string,
  style: 'long' | 'short' | 'narrow' = 'short'
): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  const parts: string[] = []
  
  try {
    const rtf = new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: style })
    const rmf = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: style })
    const rsf = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: style })
    
    if (hours > 0) parts.push(rtf.format(hours))
    if (minutes > 0) parts.push(rmf.format(minutes))
    if (secs > 0 && hours === 0) parts.push(rsf.format(secs))
    
    return parts.join(' ') || rsf.format(0)
  } catch {
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (secs > 0 && hours === 0) parts.push(`${secs}s`)
    return parts.join(' ') || '0s'
  }
}

//Pluralisation (uses Intl.PluralRules internally)

/**
 * Returns the CLDR plural category for a number in the given locale.
 * Value 'one' in English but 'many' in Polish for numbers like 5, 6...
 * Falls back to a simplified English-like rule if Intl.PluralRules throws.
 */
export function getPluralCategory(
  count: number,
  locale: string
): Intl.LDMLPluralRule {
  try {
    const pr = new Intl.PluralRules(locale)
    return pr.select(count)
  } catch {
    //Fallback to simple English-like rules
    if (count === 0) return 'zero'
    if (count === 1) return 'one'
    if (count === 2) return 'two'
    return 'other'
  }
}

/**
 * Selects the correct plural form string for a count in the given locale.
 * forms must always include 'one' and 'other'; other keys are optional.
 * Example: pluralize(3, 'en', { one: 'alert', other: 'alerts' }) -> 'alerts'
 */
export function pluralize(
  count: number,
  locale: string,
  forms: {
    zero?: string
    one: string
    two?: string
    few?: string
    many?: string
    other: string
  }
): string {
  const category = getPluralCategory(count, locale)
  return forms[category] || forms.other
}

//List formatting (uses Intl.ListFormat internally)

/**
 * Formats an array of strings as a natural-language list in the given locale.
 * type 'conjunction' = 'a, b, and c'; type 'disjunction' = 'a, b, or c'.
 * Falls back to a plain comma-join if Intl.ListFormat is unavailable.
 */
export function formatList(
  items: string[],
  locale: string,
  type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction',
  style: 'long' | 'short' | 'narrow' = 'long'
): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  
  try {
    return new Intl.ListFormat(locale, { type, style }).format(items)
  } catch {
    //Fallback
    if (type === 'disjunction') {
      return items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1]
    }
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
  }
}

//Locale detection and matching helpers

/**
 * Returns the browser's preferred BCP-47 language tag.
 * Falls back to 'en' in non-browser environments (SSR / Node tests).
 */
export function getBrowserLanguage(): string {
  if (typeof navigator === 'undefined') return 'en' // SSR guard
  return navigator.language || (navigator as any).userLanguage || 'en'
}

/**
 * Finds the best matching supported locale from a list of preferred locales.
 * Tries: 1) exact match, 2) base-language match ('en-US' -> 'en'),
 *         3) first supported locale with the same base language.
 * Falls back to 'en' if nothing matches.
 */
export function getBestMatchingLocale(
  preferredLocales: string[],
  supportedLocales: string[] = Object.keys(SUPPORTED_LOCALES)
): string {
  for (const preferred of preferredLocales) {
    //Exact match: 'en-GB' in supportedLocales
    if (supportedLocales.includes(preferred)) {
      return preferred
    }

 //Language-only match: strip region tag ('en-GB' -> 'en')
    const lang = preferred.split('-')[0]
    if (supportedLocales.includes(lang)) {
      return lang
    }

    //Prefix match: find any supported locale starting with the same base language
    const match = supportedLocales.find(l => l.startsWith(lang))
    if (match) return match
  }

  return 'en' // ultimate fallback
}

/**
 * Get locale metadata
 */
export function getLocaleMetadata(locale: string): typeof SUPPORTED_LOCALES[SupportedLocale] | undefined {
  const key = locale.split('-')[0] as SupportedLocale
  return SUPPORTED_LOCALES[key]
}

/**
 * Get locale display name in its native language
 */
export function getLocaleNativeName(locale: string): string {
  const metadata = getLocaleMetadata(locale)
  return metadata?.nativeName || locale
}

//Collation -- locale-aware string sorting

/**
 * Creates an Intl.Collator for locale-aware string comparison.
 * sensitivity:'base' means accented characters sort like their base letter,
 * and case differences are ignored (useful for search and sort UIs).
 */
export function getCollator(
  locale: string,
  options?: Intl.CollatorOptions
): Intl.Collator {
  return new Intl.Collator(locale, {
    sensitivity: 'base',
    ...options,
  })
}

/**
 * Sort strings with locale awareness
 */
export function sortStrings(
  strings: string[],
  locale: string,
  options?: Intl.CollatorOptions
): string[] {
  const collator = getCollator(locale, options)
  return [...strings].sort((a, b) => collator.compare(a, b))
}

//Display names -- resolve human-readable names for codes

/**
 * Returns the human-readable language name for a BCP-47 language code.
 * displayLocale controls which language the name is returned in;
 * defaults to English ('en').
 * Example: getLanguageDisplayName('fr', 'en') -> 'French'
 */
export function getLanguageDisplayName(
  languageCode: string,
  displayLocale: string = 'en'
): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(languageCode) || languageCode
  } catch {
    return languageCode
  }
}

/**
 * Get display name for region/country code
 */
export function getRegionDisplayName(
  regionCode: string,
  displayLocale: string = 'en'
): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'region' }).of(regionCode) || regionCode
  } catch {
    return regionCode
  }
}

/**
 * Get display name for currency code
 */
export function getCurrencyDisplayName(
  currencyCode: string,
  displayLocale: string = 'en'
): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'currency' }).of(currencyCode) || currencyCode
  } catch {
    return currencyCode
  }
}

//Default export
export default {
  RTL_LANGUAGES,
  SUPPORTED_LOCALES,
  isRTL,
  getTextDirection,
  applyRTL,
  getLogicalProperty,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatCompactNumber,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  formatDuration,
  getPluralCategory,
  pluralize,
  formatList,
  getBrowserLanguage,
  getBestMatchingLocale,
  getLocaleMetadata,
  getLocaleNativeName,
  getCollator,
  sortStrings,
  getLanguageDisplayName,
  getRegionDisplayName,
  getCurrencyDisplayName,
}
