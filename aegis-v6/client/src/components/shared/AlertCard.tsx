import { AlertTriangle, Clock, X, Radio } from 'lucide-react'
import { getSeverityBorderClass } from '../../utils/helpers'
import type { Alert } from '../../types'

interface Props { alert: Alert; onDismiss?: (id: string) => void; compact?: boolean }

export default function AlertCard({ alert, onDismiss, compact = false }: Props): JSX.Element {
  return (
    <div className={`rounded-lg p-4 ${getSeverityBorderClass(alert.severity)} animate-fade-in`} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${alert.severity === 'high' ? 'text-red-600' : alert.severity === 'medium' ? 'text-amber-600' : 'text-blue-600'}`} />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{alert.title}</h3>
          </div>
          {!compact && <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{alert.message}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{alert.displayTime}</span>
            {alert.channels && <span className="flex items-center gap-1"><Radio className="w-3 h-3" />{alert.channels.join(', ')}</span>}
          </div>
        </div>
        {onDismiss && <button onClick={() => onDismiss(alert.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Dismiss"><X className="w-4 h-4" /></button>}
      </div>
    </div>
  )
}
