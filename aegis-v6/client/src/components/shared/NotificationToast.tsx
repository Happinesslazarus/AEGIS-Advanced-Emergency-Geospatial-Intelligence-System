/**
 * Lightweight toast component that maps a notification type (success,
 * error, warning, info) to a Lucide icon and background colour.
 * Rendered by the ToastProvider stack.
 */

import { X, CheckCircle, AlertTriangle, Info, LucideIcon } from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import type { Notification } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const ICONS: Record<Notification['type'], LucideIcon> = { success: CheckCircle, warning: AlertTriangle, error: AlertTriangle, info: Info }
const STYLES: Record<Notification['type'], string> = { success: 'bg-green-600 text-white', warning: 'bg-amber-600 text-white', error: 'bg-red-600 text-white', info: 'bg-aegis-600 text-white' }

export default function NotificationToast(): JSX.Element | null {
  const lang = useLanguage()
  const { notifications, dismissNotification } = useAlerts()
  if (notifications.length === 0) return null
  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-2 max-w-sm w-full" role="alert" aria-live="polite">
      {notifications.map(n => {
        const Icon = ICONS[n.type]
        return (
          <div key={n.id} className={`${STYLES[n.type]} rounded-lg shadow-lg px-4 py-3 flex items-start gap-3 animate-slide-down`}>
            <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="flex-1 text-sm font-medium">{n.message}</p>
            <button onClick={() => dismissNotification(n.id)} className="flex-shrink-0 hover:opacity-80" aria-label={t('common.dismiss', lang)}><X className="w-4 h-4" /></button>
          </div>
        )
      })}
    </div>
  )
}
