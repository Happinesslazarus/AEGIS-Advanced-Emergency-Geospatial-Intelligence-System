/**
 * Bottom-of-page cookie banner with granular category toggles
 * (essential, analytics, marketing). Stores consent choices in a
 * signed cookie and hides itself once the user decides.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Shield, Settings, X, ChevronDown, ChevronUp, Cookie } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import {
  getConsent,
  saveConsent,
  resetConsent,
  CONSENT_CHANGE_EVENT,
  type ConsentCategory,
} from '../../utils/cookiePreferences'

//Component

export default function CookieConsent(): JSX.Element | null {
  const lang = useLanguage()
  const [visible, setVisible] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const bannerRef = useRef<HTMLDivElement>(null)
  const firstBtnRef = useRef<HTMLButtonElement>(null)

  //Show banner when there is no valid consent
  useEffect(() => {
    setVisible(getConsent() === null)
  }, [])

  //Listen for external resetConsent() calls (e.g. footer link)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail === null) {
        setPreferences(false)
        setAnalytics(false)
        setShowPrefs(false)
        setVisible(true)
      }
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, handler)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, handler)
  }, [])

  //Focus first interactive element when banner appears
  useEffect(() => {
    if (visible) firstBtnRef.current?.focus()
  }, [visible])

  const handleAcceptAll = useCallback(() => {
    saveConsent({ preferences: true, analytics: true })
    setVisible(false)
  }, [])

  const handleEssentialOnly = useCallback(() => {
    saveConsent({ preferences: false, analytics: false })
    setVisible(false)
  }, [])

  const handleSavePreferences = useCallback(() => {
    saveConsent({ preferences, analytics })
    setVisible(false)
  }, [preferences, analytics])

  if (!visible) return null

  return (
    <div
      ref={bannerRef}
      role="dialog"
      aria-modal="false"
      aria-label={t('cookieConsent.title', lang)}
      /* z-40 is below emergency UI (z-50+), SOS (z-[90]), and alerts */
      className="fixed bottom-0 inset-x-0 z-40 animate-slide-up"
    >
      <div className="mx-auto max-w-5xl px-4 pb-4 sm:px-6">
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-2xl">
          {/* Main banner */}
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-6">
            {/* Icon + text */}
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg">
                <Cookie className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                  {t('cookieConsent.title', lang)}
                </h2>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {t('cookieConsent.description', lang)}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 flex-shrink-0">
              <button
                ref={firstBtnRef}
                onClick={handleAcceptAll}
                className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                aria-label={t('cookieConsent.acceptAll', lang)}
              >
                {t('cookieConsent.acceptAll', lang)}
              </button>
              <button
                onClick={handleEssentialOnly}
                className="px-4 py-2 text-xs font-semibold rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 transition-all focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                aria-label={t('cookieConsent.essentialOnly', lang)}
              >
                {t('cookieConsent.essentialOnly', lang)}
              </button>
              <button
                onClick={() => setShowPrefs((p: boolean) => !p)}
                className="px-4 py-2 text-xs font-semibold rounded-lg text-aegis-700 dark:text-aegis-300 border border-aegis-300 dark:border-aegis-600 hover:bg-aegis-50 dark:hover:bg-aegis-900/30 transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                aria-expanded={showPrefs}
                aria-controls="cookie-prefs-panel"
                aria-label={t('cookieConsent.managePreferences', lang)}
              >
                <Settings className="w-3.5 h-3.5" />
                {t('cookieConsent.managePreferences', lang)}
                {showPrefs ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Preferences panel */}
          {showPrefs && (
            <div
              id="cookie-prefs-panel"
              role="region"
              aria-label={t('cookieConsent.managePreferences', lang)}
              className="border-t border-gray-200 dark:border-white/10 px-5 py-4 space-y-4"
            >
              {/* Essential -- always on */}
              <CategoryRow
                id="essential"
                label={t('cookieConsent.cat.essential', lang)}
                description={t('cookieConsent.cat.essentialDesc', lang)}
                checked={true}
                disabled
                icon={<Shield className="w-4 h-4 text-aegis-600 dark:text-aegis-400" />}
              />

              {/* Preferences */}
              <CategoryRow
                id="preferences"
                label={t('cookieConsent.cat.preferences', lang)}
                description={t('cookieConsent.cat.preferencesDesc', lang)}
                checked={preferences}
                onChange={setPreferences}
                icon={<Settings className="w-4 h-4 text-amber-500" />}
              />

              {/* Analytics */}
              <CategoryRow
                id="analytics"
                label={t('cookieConsent.cat.analytics', lang)}
                description={t('cookieConsent.cat.analyticsDesc', lang)}
                checked={analytics}
                onChange={setAnalytics}
                icon={<svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
              />

              {/* Save / close */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={handleSavePreferences}
                  className="px-5 py-2 text-xs font-semibold rounded-lg text-white bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                  aria-label={t('cookieConsent.savePreferences', lang)}
                >
                  {t('cookieConsent.savePreferences', lang)}
                </button>
                <button
                  onClick={() => setShowPrefs(false)}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-all focus:outline-none focus:ring-2 focus:ring-aegis-500"
                  aria-label={t('actions.close', lang)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

//Sub-component: category toggle row

type CategoryRowProps = {
  id: ConsentCategory
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange?: (v: boolean) => void
  icon: React.ReactNode
}

function CategoryRow({ id, label, description, checked, disabled, onChange, icon }: CategoryRowProps): JSX.Element {
  const toggleId = `cookie-cat-${id}`
  return (
    <div className="flex items-start gap-3">
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">{icon}</div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <label htmlFor={toggleId} className="text-sm font-semibold text-gray-900 dark:text-white cursor-pointer">
          {label}
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{description}</p>
      </div>

      {/* Toggle */}
      <button
        id={toggleId}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
          disabled
            ? 'bg-aegis-500 cursor-not-allowed opacity-80'
            : checked
              ? 'bg-aegis-600 hover:bg-aegis-700 cursor-pointer'
              : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 cursor-pointer'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
        {disabled && (
          <span className="sr-only">Always enabled</span>
        )}
      </button>
    </div>
  )
}

