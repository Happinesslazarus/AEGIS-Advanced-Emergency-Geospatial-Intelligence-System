import { Globe } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../../i18n/config'
import { setLanguage, t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { clearTranslationCache } from '../../utils/translateService'

interface LanguageSelectorProps {
  darkNav?: boolean
  className?: string
}

const SHARED_LANGUAGE_CODES = new Set(['en', 'es', 'fr', 'ar', 'zh', 'hi', 'pt'])
const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES
  .filter((lang) => SHARED_LANGUAGE_CODES.has(lang.code))
  .map((lang) => ({ code: lang.code, label: lang.nativeName }))

export default function LanguageSelector({ darkNav = false, className = '' }: LanguageSelectorProps): JSX.Element {
  const { i18n } = useTranslation()
  const lang = useLanguage()
  const { dark: themeDark } = useTheme()
  const selectedLang = LANGUAGE_OPTIONS.some((item) => item.code === lang) ? lang : 'en'
  const isDark = darkNav || themeDark

  return (
    <div className={`flex items-center rounded-lg border ${
      isDark
        ? 'bg-transparent border-white/12 hover:bg-white/5'
        : 'bg-white border-gray-200 hover:bg-gray-50'
    } transition-colors ${className}`}>
      <Globe className={`w-4 h-4 ml-2 flex-shrink-0 ${
        isDark ? 'text-aegis-400' : 'text-gray-500 dark:text-gray-300'
      }`} />
      <select
        value={selectedLang}
        onChange={async (e) => {
          const next = e.target.value
          setLanguage(next)
          try {
            await i18n.changeLanguage(next)
          } catch {
            // Keep UI responsive even if i18n backend fails.
          }
          localStorage.setItem('aegis_lang_chosen', next)
          localStorage.setItem('aegis-language', next)
          clearTranslationCache()
        }}
        className={`bg-transparent text-xs px-1.5 py-1.5 border-none outline-none cursor-pointer appearance-none ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}
        aria-label="Language selector"
        title="Language"
      >
        {LANGUAGE_OPTIONS.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  )
}
