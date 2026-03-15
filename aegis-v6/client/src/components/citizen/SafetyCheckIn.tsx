import { useState } from 'react'
import { CheckCircle, AlertTriangle, HelpCircle } from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

type SafetyStatus = 'safe' | 'help' | 'unsure' | null

export default function SafetyCheckIn(): JSX.Element {
  const lang = useLanguage()
  const [status, setStatus] = useState<SafetyStatus>(null)
  const { pushNotification } = useAlerts()

  const handle = (s: SafetyStatus): void => {
    setStatus(s)
    pushNotification(
      s === 'help' ? '🚨 Help request received. Nearby responders notified.' : 'Safety status recorded.',
      s === 'help' ? 'warning' : 'success'
    )
  }

  const items: { key: SafetyStatus; label: string; icon: typeof CheckCircle; base: string; active: string }[] = [
    { key: 'safe', label: "I'm Safe", icon: CheckCircle, base: 'bg-green-600 hover:bg-green-700', active: 'bg-green-700 ring-2 ring-white' },
    { key: 'help', label: 'Need Help', icon: AlertTriangle, base: 'bg-red-600 hover:bg-red-700', active: 'bg-red-700 ring-2 ring-white' },
    { key: 'unsure', label: 'Unsure', icon: HelpCircle, base: 'bg-amber-600 hover:bg-amber-700', active: 'bg-amber-700 ring-2 ring-white' },
  ]

  return (
    <div className="bg-aegis-700 dark:bg-aegis-900 text-white" role="region" aria-label="Safety check-in">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <h3 className="text-sm font-semibold mb-2.5 text-aegis-100">{t('safetyCheck.areYouSafe', lang)}</h3>
        <div className="flex flex-wrap gap-2.5">
          {items.map(({ key, label, icon: Icon, base, active }) => (
            <button key={key} onClick={() => handle(key)}
              className={`px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all ${status === key ? active : base}`}
              aria-pressed={status === key}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
