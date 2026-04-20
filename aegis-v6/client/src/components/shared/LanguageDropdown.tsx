/**
 * LanguageDropdown.tsx -- Advanced flag-grid language picker.
 *
 * Trigger button shows the current language flag + native name.
 * Clicking opens a polished popover grid (matching LanguagePreferenceDialog
 * style) with large flag emojis, native names, and a checkmark on the
 * active selection.
 */

import { useState, useRef, useEffect } from 'react'
import { Globe, Check, ChevronDown } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { loadLanguage } from '../../i18n/config'
import { clearTranslationCache } from '../../utils/translateService'
import { codeToFlag } from '../../data/countryCodes'

const ALL_LANGUAGES = [
  { code: 'en', nativeName: 'English',    englishName: 'English',    flag: codeToFlag('GB') },
  { code: 'es', nativeName: 'Español',    englishName: 'Spanish',    flag: codeToFlag('ES') },
  { code: 'fr', nativeName: 'Français',   englishName: 'French',     flag: codeToFlag('FR') },
  { code: 'ar', nativeName: 'العربية',    englishName: 'Arabic',     flag: codeToFlag('SA') },
  { code: 'de', nativeName: 'Deutsch',    englishName: 'German',     flag: codeToFlag('DE') },
  { code: 'pt', nativeName: 'Português',  englishName: 'Portuguese', flag: codeToFlag('PT') },
  { code: 'hi', nativeName: 'हिन्दी',      englishName: 'Hindi',      flag: codeToFlag('IN') },
  { code: 'zh', nativeName: '中文',        englishName: 'Chinese',    flag: codeToFlag('CN') },
  { code: 'sw', nativeName: 'Kiswahili',  englishName: 'Swahili',    flag: codeToFlag('TZ') },
  { code: 'pl', nativeName: 'Polski',     englishName: 'Polish',     flag: codeToFlag('PL') },
  { code: 'ur', nativeName: 'اردو',       englishName: 'Urdu',       flag: codeToFlag('PK') },
]

interface Props {
  darkNav?: boolean
  className?: string
}

export default function LanguageDropdown({ darkNav = false, className = '' }: Props): JSX.Element {
  const lang = useLanguage()
  const { i18n } = useTranslation()
  const { dark: themeDark } = useTheme()
  const isDark = darkNav || themeDark
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = ALL_LANGUAGES.find(l => l.code === lang) ?? ALL_LANGUAGES[0]

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = async (code: string) => {
    setLanguage(code)
    try {
      await loadLanguage(code)
      await i18n.changeLanguage(code)
    } catch { /* stay responsive */ }
    localStorage.setItem('aegis_lang_chosen', code)
    localStorage.setItem('aegis-language', code)
    clearTranslationCache()
    setOpen(false)
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      {/* Trigger -- shows current flag + native name */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] select-none min-h-[36px] ${
          isDark
            ? 'bg-white/8 border-white/15 hover:bg-white/14 text-white'
            : 'bg-white/90 border-gray-200 hover:bg-gray-50 text-gray-800 shadow-sm'
        }`}
        aria-label="Select language"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.nativeName}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''} ${isDark ? 'text-white/50' : 'text-gray-400'}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Language options"
          className={`absolute right-0 top-full mt-2 z-[400] rounded-2xl shadow-2xl border overflow-hidden ${
            isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}
          style={{ width: '280px' }}
        >
          {/* Panel header */}
          <div className="bg-gradient-to-r from-aegis-600 to-blue-600 px-4 py-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Interface Language</p>
              <p className="text-[10px] text-white/70">Choose your preferred language</p>
            </div>
          </div>

          {/* Flag grid */}
          <div className="p-3 grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
            {ALL_LANGUAGES.map(item => {
              const isSelected = lang === item.code
              return (
                <button
                  key={item.code}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(item.code)}
                  className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all duration-150 hover:scale-[1.02] ${
                    isSelected
                      ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-900/30 shadow-md'
                      : isDark
                        ? 'border-gray-700 bg-gray-800 hover:border-gray-600 hover:bg-gray-750'
                        : 'border-gray-100 bg-gray-50 hover:border-gray-300 hover:bg-white'
                  }`}
                >
                  <span className="text-2xl leading-none flex-shrink-0">{item.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold truncate leading-tight ${
                      isSelected ? 'text-aegis-700 dark:text-aegis-300' : isDark ? 'text-white' : 'text-gray-800'
                    }`}>
                      {item.nativeName}
                    </p>
                    <p className={`text-[9px] truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {item.englishName}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-aegis-500 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
