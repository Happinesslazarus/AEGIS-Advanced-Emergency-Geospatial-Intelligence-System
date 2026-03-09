/**
 * LanguagePreferenceDialog.tsx — First-visit language preference prompt.
 *
 * Shows a fullscreen dialog on first visit asking the user to choose
 * their preferred language. Persists choice to localStorage and calls
 * setLanguage() to update the i18n system globally.
 *
 * Shows again only if localStorage key 'aegis_lang_chosen' is not set.
 */

import { useState, useEffect } from 'react'
import { Globe, Check, X } from 'lucide-react'
import { setLanguage, getLanguage } from '../../utils/i18n'
import { LANGUAGES } from '../../data/disasterTypes'

const LANG_FLAGS: Record<string, string> = {
  en: '🇬🇧',
  es: '🇪🇸',
  fr: '🇫🇷',
  ar: '🇸🇦',
  zh: '🇨🇳',
  hi: '🇮🇳',
  pt: '🇵🇹',
  pl: '🇵🇱',
  ur: '🇵🇰',
}

const LS_KEY = 'aegis_lang_chosen'

export default function LanguagePreferenceDialog(): JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [selected, setSelected] = useState(getLanguage())

  useEffect(() => {
    // Show dialog if user hasn't chosen a language yet
    const alreadyChosen = localStorage.getItem(LS_KEY)
    if (!alreadyChosen) {
      // Small delay so the page loads first
      const timer = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleConfirm = () => {
    setLanguage(selected)
    localStorage.setItem(LS_KEY, selected)
    setVisible(false)
  }

  const handleDismiss = () => {
    // Default to English
    localStorage.setItem(LS_KEY, 'en')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-aegis-600 to-blue-600 px-6 py-5 text-white">
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 p-1 hover:bg-white/20 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <Globe className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Choose Your Language</h2>
              <p className="text-sm text-white/80 mt-0.5">Select your preferred language for AEGIS</p>
            </div>
          </div>
        </div>

        {/* Language Grid */}
        <div className="p-5 overflow-y-auto max-h-[55vh]">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => setSelected(lang.code)}
                className={`relative flex items-center gap-2.5 px-3 py-3 rounded-xl border-2 text-left transition-all hover:scale-[1.02] ${
                  selected === lang.code
                    ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-900/30 ring-2 ring-aegis-500/30 shadow-md'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <span className="text-2xl leading-none">{LANG_FLAGS[lang.code] || '🌐'}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${selected === lang.code ? 'text-aegis-700 dark:text-aegis-300' : 'text-gray-800 dark:text-gray-200'}`}>
                    {lang.label}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{lang.code.toUpperCase()}</p>
                </div>
                {selected === lang.code && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-aegis-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            You can change this later in settings
          </p>
          <button
            onClick={handleConfirm}
            className="px-6 py-2.5 bg-aegis-600 hover:bg-aegis-700 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-aegis-600/30"
          >
            <Check className="w-4 h-4" />
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
