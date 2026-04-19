/**
 * Module: OfflineIndicator.tsx
 *
 * Offline indicator shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import React, { useEffect, useState } from 'react'
import { WifiOff, RefreshCw, Check } from 'lucide-react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export default function OfflineIndicator(): JSX.Element | null {
  const lang = useLanguage()
  const { isOnline, queuedRequests, syncNow } = useOnlineStatus()
  const [visible, setVisible] = useState(false)
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setVisible(true)
      setJustReconnected(false)
    } else if (visible) {
      // Show "Back online" briefly
      setJustReconnected(true)
      const timer = setTimeout(() => {
        setVisible(false)
        setJustReconnected(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl backdrop-blur-lg text-sm font-medium transition-all duration-300 ${
        justReconnected
          ? 'bg-emerald-600/90 text-white'
          : 'bg-amber-600/90 text-white'
      }`}
    >
      {justReconnected ? (
        <>
          <Check className="w-4 h-4 shrink-0" />
          <span>{t('offline.backOnline', lang)}</span>
          {queuedRequests > 0 && (
            <span className="text-xs opacity-80">— {t('offline.syncing', lang)} {queuedRequests}</span>
          )}
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
          <span>{t('offline.youAreOffline', lang)}</span>
          {queuedRequests > 0 && (
            <span className="text-xs opacity-80">({queuedRequests} {t('offline.queued', lang)})</span>
          )}
          <button
            onClick={syncNow}
            className="ml-1 p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title={t('offline.trySync', lang)}
            aria-label={t('offline.trySyncAria', lang)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

