import { useState } from 'react'
import { Globe, ChevronDown } from 'lucide-react'

const LANGS = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'ur', label: 'اردو', flag: '🇵🇰' },
]

export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState('en')
  const current = LANGS.find(l => l.code === lang) || LANGS[0]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
      >
        <Globe className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        {compact ? (
          <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{current.code.toUpperCase()}</span>
        ) : (
          <>
            <span className="text-[10px]">{current.flag}</span>
            <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">{current.label}</span>
          </>
        )}
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 w-48 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden animate-scale-in">
            <div className="p-1.5">
              {LANGS.map(l => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${lang === l.code ? 'bg-aegis-500/5 text-aegis-600 dark:text-aegis-400 font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]'}`}
                >
                  <span className="text-sm">{l.flag}</span>
                  <span className="text-xs">{l.label}</span>
                  {lang === l.code && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-aegis-500" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
