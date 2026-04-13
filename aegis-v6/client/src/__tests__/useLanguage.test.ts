/**
 * Module: useLanguage.test.ts
 *
 * Tests for the useLanguage hook, which reads the active UI language from i18n
 * utilities, subscribes to language-change events, and keeps the document's
 * HTML attributes (lang, dir, translate) in sync.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   vi.fn()                 = creates a mock (fake) function that records calls + return values
 *   vi.mock()               = replaces a real module import with controlled fakes (hoisted by Vitest)
 *   mockReturnValue()       = sets what the mock returns when called — lets each test pick a language
 *   vi.clearAllMocks()      = resets call history and return values on all mocks before each test
 *   renderHook()            = mounts a React hook in a minimal test component; returns { result }
 *   i18n                    = internationalisation — the system for translating the UI into
 *                             different natural languages (English, Welsh, Arabic, etc.)
 *   i18next                 = the JavaScript library that manages translations; the real module
 *                             is mocked here so tests don't need real translation files
 *   document.documentElement = the <html> element at the root of the page
 *   lang attribute          = <html lang="cy"> tells the browser and assistive tech what
 *                             language the page is in; required by WCAG 2.1 SC 3.1.1
 *   dir attribute           = <html dir="rtl"> sets text direction; "ltr" = left-to-right
 *                             (English, Welsh), "rtl" = right-to-left (Arabic, Hebrew, Farsi)
 *   translate attribute     = <html translate="yes"> lets browser translation extensions work
 *   onLanguageChange()      = i18n utility that registers a callback for language switches;
 *                             returns a cleanup/unsubscribe function
 *   cleanup function        = the return value of onLanguageChange(); should be called on
 *                             unmount to remove the listener and avoid memory leaks
 *   RTL                     = right-to-left writing system (Arabic ar, Hebrew he, Farsi fa, Urdu ur)
 *   cy                      = ISO 639-1 language code for Welsh (Cymraeg)
 *   gd                      = ISO 639-1 code for Scottish Gaelic
 *   ga                      = ISO 639-1 code for Irish Gaelic
 *   test.each()             = runs the same test with multiple data values — avoids copy-paste
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Create mock functions BEFORE vi.mock so the factory can close over them
const mockGetLanguage = vi.fn(() => 'en')           // returns current language code
const mockOnLanguageChange = vi.fn((callback: (lang: string) => void) => {
  // Default stub: immediately returns a no-op cleanup function
  return () => {}
})
const mockIsRtl = vi.fn((lang: string) => ['ar', 'he', 'fa', 'ur'].includes(lang))
// isRtl = true for Arabic (ar), Hebrew (he), Farsi (fa), Urdu (ur) — all RTL languages

// Replace the real i18n module with stubs so tests don't touch real translation files
vi.mock('../utils/i18n', () => ({
  getLanguage: () => mockGetLanguage(),
  onLanguageChange: (cb: (lang: string) => void) => mockOnLanguageChange(cb),
  isRtl: (lang: string) => mockIsRtl(lang),
}))

import { useLanguage } from '../hooks/useLanguage'

describe('useLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset call counts so each test starts with a clean slate
    mockGetLanguage.mockReturnValue('en') // default to English for every test
    // Reset <html> attributes so tests don't interfere with each other
    document.documentElement.lang = ''
    document.documentElement.dir = ''
  })

  describe('initialization', () => {
    test('returns current language', () => {
      // Hook should read the current language from getLanguage() on mount
      mockGetLanguage.mockReturnValue('en')
      
      const { result } = renderHook(() => useLanguage())
      
      expect(result.current).toBe('en')
    })

    test('returns different initial language', () => {
      // Same hook, but configured to start in Welsh
      mockGetLanguage.mockReturnValue('cy')
      
      const { result } = renderHook(() => useLanguage())
      
      expect(result.current).toBe('cy')
    })
  })

  describe('language subscription', () => {
    test('subscribes to language changes', () => {
      // On mount the hook must call onLanguageChange() to register a listener
      // so it reacts when the user switches language in the UI
      renderHook(() => useLanguage())
      
      expect(mockOnLanguageChange).toHaveBeenCalledWith(expect.any(Function))
    })

    test('cleans up subscription on unmount', () => {
      // The cleanup function returned by onLanguageChange must be called when the
      // component unmounts — failing to do so leaks the listener
      const cleanup = vi.fn()
      mockOnLanguageChange.mockReturnValue(cleanup) // stub returns our spy as cleanup
      
      const { unmount } = renderHook(() => useLanguage())
      unmount() // trigger the useEffect cleanup
      
      expect(cleanup).toHaveBeenCalled() // confirms listener was removed
    })
  })

  describe('document attributes', () => {
    test('sets document lang attribute', () => {
      // <html lang="cy"> tells the browser the page language is Welsh
      mockGetLanguage.mockReturnValue('cy')
      
      renderHook(() => useLanguage())
      
      expect(document.documentElement.lang).toBe('cy')
    })

    test('sets ltr direction for English', () => {
      // English reads left-to-right — dir="ltr"
      mockGetLanguage.mockReturnValue('en')
      mockIsRtl.mockReturnValue(false)
      
      renderHook(() => useLanguage())
      
      expect(document.documentElement.dir).toBe('ltr')
    })

    test('sets rtl direction for Arabic', () => {
      // Arabic reads right-to-left — dir="rtl"; CSS layout must mirror for RTL languages
      mockGetLanguage.mockReturnValue('ar')
      mockIsRtl.mockReturnValue(true)
      
      renderHook(() => useLanguage())
      
      expect(document.documentElement.dir).toBe('rtl')
    })

    test('sets translate attribute', () => {
      // translate="yes" allows browser extensions (e.g. Google Translate) to work
      renderHook(() => useLanguage())
      
      expect(document.documentElement.getAttribute('translate')).toBe('yes')
    })
  })

  describe('supported languages', () => {
    // test.each() runs the same assertions for every language in the array —
    // English (en), Welsh (cy), Scottish Gaelic (gd), Irish Gaelic (ga)
    const supportedLanguages = ['en', 'cy', 'gd', 'ga']
    
    test.each(supportedLanguages)('handles %s language', (lang) => {
      // %s is replaced by each language code when the test name is displayed
      mockGetLanguage.mockReturnValue(lang)
      
      const { result } = renderHook(() => useLanguage())
      
      expect(result.current).toBe(lang)              // hook returns the language code
      expect(document.documentElement.lang).toBe(lang) // <html lang> is updated
    })
  })
})
