/*
 * ModernNotification.tsx - Beautiful, modern notification toast component
 * Replaces plain text notifications with attractive visual alerts
 */

import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, Info, AlertTriangle, Bell, X } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface ModernNotificationProps {
  message: string
  type: NotificationType
  duration?: number
  onClose?: () => void
}

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const COLORS = {
  success: {
    bg: 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-900 dark:text-green-200',
    icon: 'text-green-600 dark:text-green-400',
    progress: 'bg-green-500',
  },
  error: {
    bg: 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-900 dark:text-red-200',
    icon: 'text-red-600 dark:text-red-400',
    progress: 'bg-red-500',
  },
  warning: {
    bg: 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-900 dark:text-amber-200',
    icon: 'text-amber-600 dark:text-amber-400',
    progress: 'bg-amber-500',
  },
  info: {
    bg: 'bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-900 dark:text-blue-200',
    icon: 'text-blue-600 dark:text-blue-400',
    progress: 'bg-blue-500',
  },
}

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
