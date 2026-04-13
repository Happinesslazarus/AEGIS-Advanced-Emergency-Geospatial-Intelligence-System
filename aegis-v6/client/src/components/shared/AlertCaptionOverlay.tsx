/**
 * Module: AlertCaptionOverlay.tsx
 *
 * Alert caption overlay shared component (reusable UI element used across pages).
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertTriangle, Info, ShieldAlert, X, Volume2 } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface CaptionItem {
  id: string
  text: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  timestamp: number
}

interface AlertCaptionOverlayProps {
  enabled: boolean
  position?: 'top' | 'bottom'
  fontSize?: 'small' | 'medium' | 'large'
  autoHideMs?: number
  onSpeak?: (text: string) => void
}

export default function AlertCaptionOverlay({
  enabled,
  position = 'bottom',
  fontSize = 'medium',
  autoHideMs = 12000,
  onSpeak,
}: AlertCaptionOverlayProps): JSX.Element | null {
  const lang = useLanguage()

  const [captions, setCaptions] = useState<CaptionItem[]>([])
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Expose a method to push captions (via custom event)
  useEffect(() => {
    if (!enabled) return

    const handler = (e: CustomEvent) => {
      const { id, title, message, severity } = e.detail
      const caption: CaptionItem = {
        id: id || `cap-${Date.now()}`,
        title: title || 'Alert',
        text: message || '',
        severity: severity === 'critical' || severity === 'high' ? 'critical'
                : severity === 'warning' || severity === 'medium' ? 'warning' : 'info',
        timestamp: Date.now(),
      }

      setCaptions(prev => {
        // Remove duplicates
        const filtered = prev.filter(c => c.id !== caption.id)
        return [caption, ...filtered].slice(0, 3)
      })
      setVisible(true)

      // Auto-hide
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setVisible(false)
        setTimeout(() => setCaptions([]), 500)
      }, autoHideMs)
    }

    window.addEventListener('aegis-caption' as any, handler)
    return () => {
      window.removeEventListener('aegis-caption' as any, handler)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [enabled, autoHideMs])

  const dismiss = useCallback(() => {
    setVisible(false)
    setTimeout(() => setCaptions([]), 300)
  }, [])

  if (!enabled || captions.length === 0) return null

  const fontSizeMap = { small: 'text-xs', medium: 'text-sm', large: 'text-base' }
  const positionClass = position === 'top' ? 'top-20' : 'bottom-24'

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 ${positionClass} z-[60] w-full max-w-2xl px-4 
        transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      role="alert"
      aria-live="assertive"
      aria-label="Alert captions"
    >
      {captions.map((cap) => {
        const colors = cap.severity === 'critical'
          ? 'bg-red-900/95 border-red-500 text-white'
          : cap.severity === 'warning'
          ? 'bg-amber-900/95 border-amber-500 text-white'
          : 'bg-blue-900/95 border-blue-500 text-white'

        const Icon = cap.severity === 'critical' ? ShieldAlert
          : cap.severity === 'warning' ? AlertTriangle : Info

        return (
          <div
            key={cap.id}
            className={`${colors} backdrop-blur-md rounded-xl border-2 p-4 mb-2 shadow-2xl 
              animate-fade-in flex items-start gap-3`}
          >
            <Icon className="w-6 h-6 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm uppercase tracking-wide">
                  {cap.severity === 'critical' ? t('caption.critical', lang) : cap.severity === 'warning' ? t('caption.warning', lang) : t('caption.info', lang)}
                </span>
                <span className={`font-semibold ${fontSizeMap[fontSize]}`}>{cap.title}</span>
              </div>
              <p className={`${fontSizeMap[fontSize]} leading-relaxed opacity-95`}>{cap.text}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onSpeak && (
                <button
                  onClick={() => onSpeak(`${cap.title}. ${cap.text}`)}
                  className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                  aria-label={t('caption.readAloud', lang)}
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={dismiss}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                aria-label={t('caption.dismiss', lang)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Helper to dispatch caption events from anywhere in the app
export function showAlertCaption(alert: {
  id?: string; title: string; message: string; severity: string
}) {
  window.dispatchEvent(new CustomEvent('aegis-caption', { detail: alert }))
}

