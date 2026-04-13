/**
 * Module: GlobalLanguageBar.tsx
 *
 * Global language bar shared component (reusable UI element used across pages).
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { Globe } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../../data/disasterTypes'
import { setLanguage, t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { clearTranslationCache } from '../../utils/translateService'
import { loadLanguage } from '../../i18n/config'

export default function GlobalLanguageBar(): JSX.Element | null {
  const lang = useLanguage()
  const { i18n } = useTranslation()
  const location = useLocation()

  if (location.pathname.startsWith('/admin')) {
    return null
  }

  return (
    <div className="fixed top-14 right-3 z-[90]">
      <div className="flex items-center gap-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 shadow-lg">
        <Globe className="w-4 h-4 text-aegis-600" />
        <select
          value={lang}
          onChange={(e) => {
            const next = e.target.value
            setLanguage(next)
            loadLanguage(next).then(() => i18n.changeLanguage(next)).catch(() => {})
            localStorage.setItem('aegis_lang_chosen', next)
            localStorage.setItem('aegis-language', next)
            clearTranslationCache()
          }}
          className="bg-transparent text-gray-800 dark:text-gray-100 text-xs font-medium border-none outline-none cursor-pointer"
          aria-label={t('langBar.ariaLabel', lang)}
          title={t('langBar.title', lang)}
        >
          {LANGUAGES.map((item) => (
            <option key={item.code} value={item.code} className="text-black">
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}