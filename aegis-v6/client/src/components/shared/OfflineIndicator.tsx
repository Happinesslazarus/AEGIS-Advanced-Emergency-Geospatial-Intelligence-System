/**
 * Small banner that appears at the top of the page when the browser
 * loses its network connection. Hides automatically once connectivity
 * is restored.
 */

import { useEffect, useState } from 'react'
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
      //Show "Back online" briefly
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
          <span>{'Back online'}</span>
          {queuedRequests > 0 && (
            <span className="text-xs opacity-80">-- {'syncing'} {queuedRequests}</span>
          )}
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
          <span>{'You are offline'}</span>
          {queuedRequests > 0 && (
            <span className="text-xs opacity-80">({queuedRequests} {'queued'})</span>
          )}
          <button
            onClick={syncNow}
            className="ml-1 p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title={'Try to sync now'}
            aria-label={'Try to sync queued requests'}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

