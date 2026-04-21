/**
 * Styled notification popup with an icon, title, body, and auto-dismiss
 * timer. Slides in from the top-right corner and fades out after the
 * configured duration.
 */

import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useLanguage } from '../../hooks/useLanguage'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface ModernNotificationProps {
  message: string
  type: NotificationType
  duration?: number
  onClose?: () => void
}

import { FEEDBACK_CLASSES } from '../../utils/colorTokens'

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const COLORS = FEEDBACK_CLASSES

export function ModernNotification({
  message,
  type = 'info',
  duration = 5000,
  onClose = () => {},
}: ModernNotificationProps) {
  const lang = useLanguage()
  const [progress, setProgress] = useState(100)
  const Icon = ICONS[type]
  const colors = COLORS[type]

  useEffect(() => {
    if (duration === 0) return
    const start = Date.now()
    let animationId: number

    const animate = () => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)

      if (remaining > 0) {
        animationId = requestAnimationFrame(animate)
      } else {
        onClose()
      }
    }

    animationId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationId)
  }, [duration, onClose])

  return (
    <div className={`
      flex items-start gap-3 p-4 rounded-xl border backdrop-blur-sm
      shadow-lg shadow-black/10 dark:shadow-black/30
      ${colors.bg} ${colors.border} ${colors.text}
      animate-in fade-in slide-in-from-top-2 duration-300
    `}>
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${colors.icon}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug">{message}</p>
      </div>
      <button
        onClick={onClose}
        className={`flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity`}
      >
        <X className="w-4 h-4" />
      </button>
      <div className={`
        absolute bottom-0 left-0 w-full h-1 rounded-b-xl
        ${colors.progress} opacity-30
      `} style={{ width: `${progress}%` }} />
    </div>
  )
}

export default ModernNotification
