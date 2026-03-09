/*
 * useLanguage.ts - React hook for reactive language changes
 * Components using this hook re-render when the language changes.
 */
import { useState, useEffect } from 'react'
import { getLanguage, onLanguageChange, isRtl } from '../utils/i18n'

export function useLanguage(): string {
  const [lang, setLang] = useState(getLanguage())
  useEffect(() => onLanguageChange(setLang), [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = lang || 'en'
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr'
    document.documentElement.setAttribute('translate', 'yes')
  }, [lang])

  return lang
}
