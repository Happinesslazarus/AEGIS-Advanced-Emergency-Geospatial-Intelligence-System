import { Globe } from 'lucide-react'
import { LANGUAGES } from '../../data/disasterTypes'
import { setLanguage } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { clearTranslationCache } from '../../utils/translateService'

interface LanguageSelectorProps {
  darkNav?: boolean
  className?: string
}

export default function LanguageSelector({ darkNav = false, className = '' }: LanguageSelectorProps): JSX.Element {
  const lang = useLanguage()

  return (
    <div className={`flex items-center rounded-lg border ${darkNav ? 'bg-white/10 border-white/20' : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700'} ${className}`}>
      <Globe className={`w-4 h-4 ml-2 ${darkNav ? 'text-aegis-200' : 'text-gray-500 dark:text-gray-300'}`} />
      <select
        value={lang}
        onChange={(e) => {
          const next = e.target.value
          setLanguage(next)
          localStorage.setItem('aegis_lang_chosen', next)
          clearTranslationCache()
        }}
        className={`bg-transparent text-xs px-1.5 py-1.5 border-none outline-none cursor-pointer ${darkNav ? 'text-white' : 'text-gray-800 dark:text-gray-100'}`}
        aria-label="Language selector"
        title="Language"
      >
        {LANGUAGES.map((item) => (
          <option key={item.code} value={item.code} className="text-black">
            {item.label}
          </option>
        ))}
      </select>
    </div>
  )
}
