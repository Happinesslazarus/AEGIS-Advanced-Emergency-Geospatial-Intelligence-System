/**
 * Tests for the i18n (internationalisation) utility functions: language-code
 * normalisation, the t() translation lookup, RTL detection, language state
 * management, human-readable language names for the chat interface, and
 * translation-completeness checks.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = starts an assertion chain
 *   beforeEach / afterEach  = run before/after every test inside the describe block
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   i18n                    = "internationalisation" -- the practice of making software
 *                             support multiple languages; the 18 stands for the 18
 *                             letters between 'i' and 'n'
 *   normalizeLanguageCode() = converts any locale string to the 2-letter ISO 639-1 code
 * the app understands (e.g. 'EN-US' -> 'en', 'english' -> 'en')
 *   ISO 639-1               = the international 2-letter language code standard
 *                             (en=English, es=Spanish, ar=Arabic, zh=Chinese, etc.)
 *   IETF language tag       = format 'language-REGION' used by browsers (e.g. 'en-US',
 *                             'fr-CA'); the region part is stripped during normalisation
 *   t(key, lang)            = translation function: looks up 'key' in the 'lang' dictionary
 *                             and returns the translated string; falls back to English
 *   RTL                     = Right-To-Left text direction (Arabic, Urdu, Hebrew, Persian);
 *                             opposite of LTR (Left-To-Right, used by most languages)
 *   isRtl(lang)             = returns true if the language is RTL; used to set dir="rtl"
 *                             on the <html> element so CSS layout mirrors correctly
 *   getLanguage()           = returns the current active language code
 *   setLanguage(code)       = changes the active language and persists it to localStorage
 *   onLanguageChange(fn)    = subscribe to language-change events; returns an unsubscribe fn
 *   unsubscribe()           = call the returned function to stop receiving notifications
 *   aegis_lang / aegis-language = localStorage keys where the language choice is saved
 *                                 (both written for backwards compatibility)
 *   getChatLanguageName()   = returns the full English name of the current language
 * (e.g. 'es' -> 'Spanish') for display in the chatbot UI
 *   getMissingTranslationKeys() = compares a language's dictionary against English and
 *                             returns keys that have not been translated yet
 *   Object.defineProperty() = injects a fake localStorage into the test environment
 *   configurable: true      = required so the property can be redefined between tests
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  normalizeLanguageCode,
  t,
  isRtl,
  getLanguage,
  setLanguage,
  onLanguageChange,
  getChatLanguageName,
  getMissingTranslationKeys,
} from '../utils/i18n'

//normalizeLanguageCode -- converts any locale string to a 2-letter code
describe('normalizeLanguageCode', () => {
  test('returns en for undefined', () => {
    //Undefined input defaults to English (the app's base language)
    expect(normalizeLanguageCode(undefined)).toBe('en')
  })
  
  test('returns en for empty string', () => {
 //Empty string is treated as "no preference" -> English
    expect(normalizeLanguageCode('')).toBe('en')
  })
  
  test('handles supported codes directly', () => {
    //All 2-letter codes the app supports should pass through as-is
    expect(normalizeLanguageCode('en')).toBe('en')
    expect(normalizeLanguageCode('es')).toBe('es')
    expect(normalizeLanguageCode('fr')).toBe('fr')
    expect(normalizeLanguageCode('ar')).toBe('ar')
    expect(normalizeLanguageCode('zh')).toBe('zh')
  })
  
  test('normalizes case', () => {
    //Browsers sometimes supply uppercase codes; must be lowercased
    expect(normalizeLanguageCode('EN')).toBe('en')
    expect(normalizeLanguageCode('Es')).toBe('es')
  })
  
  test('handles language with region', () => {
    //IETF tags like 'en-US' or 'fr-CA': strip the region suffix, keep the base language
    expect(normalizeLanguageCode('en-US')).toBe('en')
    expect(normalizeLanguageCode('en-GB')).toBe('en')
    expect(normalizeLanguageCode('es-MX')).toBe('es')
    expect(normalizeLanguageCode('fr-CA')).toBe('fr')
  })
  
  test('converts underscore to hyphen', () => {
    //Some systems use underscore separators ('en_US') instead of hyphens
    expect(normalizeLanguageCode('en_US')).toBe('en')
    expect(normalizeLanguageCode('zh_CN')).toBe('zh')
  })
  
  test('trims whitespace', () => {
    //User-facing inputs may have stray spaces; ensure they are stripped
    expect(normalizeLanguageCode('  en  ')).toBe('en')
    expect(normalizeLanguageCode(' es ')).toBe('es')
  })
  
  test('handles language aliases', () => {
    //Full English language names (from chatbot input or user settings) should map correctly
    expect(normalizeLanguageCode('english')).toBe('en')
    expect(normalizeLanguageCode('spanish')).toBe('es')
    expect(normalizeLanguageCode('french')).toBe('fr')
    expect(normalizeLanguageCode('arabic')).toBe('ar')
    expect(normalizeLanguageCode('chinese')).toBe('zh')
    expect(normalizeLanguageCode('hindi')).toBe('hi')
    expect(normalizeLanguageCode('portuguese')).toBe('pt')
    expect(normalizeLanguageCode('polish')).toBe('pl')
    expect(normalizeLanguageCode('urdu')).toBe('ur')
  })
  
  test('returns en for unknown language', () => {
    //Unknown codes fall back to English -- safe default for unrecognised input
    expect(normalizeLanguageCode('xyz')).toBe('en')
    expect(normalizeLanguageCode('unknown')).toBe('en')
  })
})

//t() -- translation lookup function
describe('t() translation function', () => {
  test('returns a non-empty string for any key', () => {
    //t() must always return something useful, never blank
    expect(t('app.title', 'en').length).toBeGreaterThan(0)
    expect(t('nav.reportEmergency', 'en').length).toBeGreaterThan(0)
  })

  test('uses English as default language', () => {
    //When no language is passed, t() should default to 'en'
    expect(t('nav.reportEmergency').length).toBeGreaterThan(0)
  })

  test('returns a readable fallback for unknown keys', () => {
    //Unknown keys derive a readable label from the last key segment
    const result = t('nonexistent.someKey', 'en')
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe('')
  })

  test('handles normalizing language codes', () => {
    //t() should normalise codes internally so callers do not have to pre-normalise
    const a = t('nav.reportEmergency', 'EN')
    const b = t('nav.reportEmergency', 'en-US')
    expect(a).toBe(b)
  })

  test('falls back consistently for unknown language codes', () => {
    //Unknown language code normalises to en; result should match en output
    const fromEn = t('nav.reportEmergency', 'en')
    const fromXyz = t('nav.reportEmergency', 'xyz')
    expect(fromEn).toBe(fromXyz)
  })
})

//isRtl -- right-to-left text direction detection
describe('isRtl', () => {
  test('returns true for Arabic', () => {
    //Arabic (ar) is RTL -- text flows right to left; layout must mirror accordingly
    expect(isRtl('ar')).toBe(true)
  })
  
  test('returns true for Urdu', () => {
    //Urdu (ur) is also RTL; spoken mainly in Pakistan
    expect(isRtl('ur')).toBe(true)
  })
  
  test('returns false for English', () => {
    expect(isRtl('en')).toBe(false)
  })
  
  test('returns false for other LTR languages', () => {
    //All other supported languages are left-to-right
    expect(isRtl('es')).toBe(false)
    expect(isRtl('fr')).toBe(false)
    expect(isRtl('zh')).toBe(false)
    expect(isRtl('hi')).toBe(false)
    expect(isRtl('pt')).toBe(false)
    expect(isRtl('pl')).toBe(false)
  })
})

//Language state management -- getLanguage, setLanguage, onLanguageChange
describe('language state', () => {
  let originalLocalStorage: Storage      // save real localStorage so we can restore it
  let localStorageMock: Record<string, string>
  
  beforeEach(() => {
    localStorageMock = {}
    originalLocalStorage = window.localStorage
    //Swap the real localStorage for an in-memory mock
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => localStorageMock[key] ?? null,
        setItem: (key: string, value: string) => { localStorageMock[key] = value },
        removeItem: (key: string) => { delete localStorageMock[key] },
        clear: () => { localStorageMock = {} },
      },
      configurable: true, // must be configurable so afterEach can restore it
    })
  })
  
  afterEach(() => {
    //Restore the real localStorage to avoid polluting other test suites
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    })
  })
  
  test('getLanguage returns current language', () => {
    //Must return a non-empty string (the active language code)
    const lang = getLanguage()
    expect(typeof lang).toBe('string')
    expect(lang.length).toBeGreaterThan(0)
  })
  
  test('setLanguage changes current language', () => {
    //setLanguage should immediately update the value returned by getLanguage()
    setLanguage('es')
    expect(getLanguage()).toBe('es')
    
    setLanguage('fr')
    expect(getLanguage()).toBe('fr')
    
    setLanguage('en') // reset for subsequent tests
  })
  
  test('setLanguage normalizes language code', () => {
    //setLanguage should normalise before storing, so 'ES' is stored as 'es'
    setLanguage('ES')
    expect(getLanguage()).toBe('es')
    
    setLanguage('EN-US')
    expect(getLanguage()).toBe('en')
    
    setLanguage('en') // reset
  })
  
  test('setLanguage persists to localStorage', () => {
    //After setLanguage('fr') the choice must survive a page refresh;
    //both keys are written for backwards compatibility with older app versions
    setLanguage('fr')
    expect(localStorageMock['aegis_lang']).toBe('fr')       // new key
    expect(localStorageMock['aegis-language']).toBe('fr')   // legacy key (hyphen)
    
    setLanguage('en') // reset
  })
  
  test('onLanguageChange notifies listeners', () => {
    //Subscriber (fn) is called every time setLanguage() is called
    const listener = vi.fn()
    const unsubscribe = onLanguageChange(listener) // register the listener
    
    setLanguage('es')
    expect(listener).toHaveBeenCalledWith('es') // listener received the new code
    
    setLanguage('fr')
    expect(listener).toHaveBeenCalledWith('fr')
    
    unsubscribe()       // remove the listener
    setLanguage('en')
    //After unsubscribe, listener must NOT be called -- still at 2 calls total
    expect(listener).toHaveBeenCalledTimes(2)
  })
  
  test('unsubscribe removes listener', () => {
    //Register then immediately unsubscribe -- no calls should occur
    const listener = vi.fn()
    const unsubscribe = onLanguageChange(listener)
    
    unsubscribe() // remove before any setLanguage calls
    
    setLanguage('es')
    expect(listener).not.toHaveBeenCalled()
    
    setLanguage('en') // reset
  })
})

//getChatLanguageName -- human-readable name for the chatbot language selector
describe('getChatLanguageName', () => {
  afterEach(() => {
    setLanguage('en') // always reset to English after each test
  })
  
  test('returns English for en', () => {
    setLanguage('en')
    expect(getChatLanguageName()).toBe('English')
  })
  
  test('returns Spanish for es', () => {
    setLanguage('es')
    expect(getChatLanguageName()).toBe('Spanish')
  })
  
  test('returns French for fr', () => {
    setLanguage('fr')
    expect(getChatLanguageName()).toBe('French')
  })
  
  test('returns Arabic for ar', () => {
    setLanguage('ar')
    expect(getChatLanguageName()).toBe('Arabic')
  })
  
  test('returns Chinese for zh', () => {
    setLanguage('zh')
    expect(getChatLanguageName()).toBe('Chinese')
  })
  
  test('returns Hindi for hi', () => {
    setLanguage('hi')
    expect(getChatLanguageName()).toBe('Hindi')
  })
  
  test('returns Portuguese for pt', () => {
    setLanguage('pt')
    expect(getChatLanguageName()).toBe('Portuguese')
  })
  
  test('returns Polish for pl', () => {
    setLanguage('pl')
    expect(getChatLanguageName()).toBe('Polish')
  })
  
  test('returns Urdu for ur', () => {
    setLanguage('ur')
    expect(getChatLanguageName()).toBe('Urdu')
  })
})

//getMissingTranslationKeys -- translation-completeness checker
//Compares a language's dictionary against the English master to find gaps
describe('getMissingTranslationKeys', () => {
  test('returns empty array for English', () => {
    //English is the master dictionary; nothing can be missing from it
    expect(getMissingTranslationKeys('en')).toEqual([])
  })
  
  test('returns array of missing keys for other languages', () => {
    //Spain translations should be an array (ideally empty if complete)
    const missing = getMissingTranslationKeys('es')
    expect(Array.isArray(missing)).toBe(true)
    //Missing count should be zero or very low if translations are up to date
  })
  
  test('normalizes language code', () => {
    // 'ES' and 'es' should produce identical results (code is normalised before lookup)
    const missing1 = getMissingTranslationKeys('ES')
    const missing2 = getMissingTranslationKeys('es')
    expect(missing1).toEqual(missing2)
  })
  
  test('handles unknown language gracefully', () => {
    //Unknown code normalises to 'en', which has no missing keys
    const missing = getMissingTranslationKeys('xyz')
    expect(missing).toEqual([])
  })
})
