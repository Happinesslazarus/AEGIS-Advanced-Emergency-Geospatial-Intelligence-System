/**
 * Module: EmergencyBanner.tsx
 *
 * Emergency banner shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, useCallback, useEffect } from 'react'
import { Phone, X } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const STORAGE_KEY = 'aegis:emergency-banner-dismissed'

interface EmergencyBannerProps {
  /* When true, banner cannot be dismissed (used on error/404 pages) */
  forceShow?: boolean
}

export default function EmergencyBanner({ forceShow = false }: EmergencyBannerProps) {
  const lang = useLanguage()
  const [dismissed, setDismissed] = useState(() => {
    if (forceShow) return false
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  // Re-show when forceShow changes to true
  useEffect(() => {
    if (forceShow) setDismissed(false)
  }, [forceShow])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Storage unavailable — dismiss for this render only
    }
  }, [])

  if (dismissed) return null

  const bannerText = t('emergency.banner', lang).replace('{number}', '999 / 112')

  return (
    <div
      className="w-full bg-red-600 dark:bg-red-700 text-white px-4 py-3"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold flex-1 justify-center">
          <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{bannerText}</span>
        </div>

        {!forceShow && (
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-red-500 dark:hover:bg-red-600 transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-red-600"
            aria-label="Dismiss emergency banner"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}

