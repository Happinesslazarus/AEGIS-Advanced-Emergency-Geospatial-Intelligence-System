/**
 * useLanguage custom React hook (language logic).
 *
 * - Used by React components that need this functionality */

import { useState, useEffect } from 'react'
import { getLanguage, onLanguageChange, isRtl } from '../utils/i18n'

export function useLanguage(): string {
  const [lang, setLang] = useState(getLanguage())
  //onLanguageChange returns an unsubscribe function so the effect cleanup
  //automatically deregisters the listener when the component unmounts.
  useEffect(() => onLanguageChange(setLang), [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    //Set `lang` attribute so assistive technologies (e.g. screen readers)
    //use the correct pronunciation and speech engine for the active language.
    document.documentElement.lang = lang || 'en'
    // `dir` = text direction: 'rtl' (right-to-left) for Arabic, Hebrew, etc.
    //Setting it on <html> cascades to the entire document automatically.
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr'
    // `translate="yes"` hints to browser translate plugins that this page
    //content is eligible for machine translation if needed.
    document.documentElement.setAttribute('translate', 'yes')
  }, [lang])

  return lang
}
