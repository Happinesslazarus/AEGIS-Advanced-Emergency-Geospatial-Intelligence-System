import { AlertTriangle, ShieldAlert, Info, Clock, MapPin, X } from 'lucide-react'

const SEV: Record<string, { gradient: string; bg: string; text: string; bar: string }> = {
  critical: { gradient: 'from-red-600 to-rose-500', bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-300', bar: 'bg-gradient-to-r from-red-500 via-rose-500 to-red-600' },
  high:     { gradient: 'from-orange-600 to-amber-500', bg: 'bg-orange-50 dark:bg-orange-950/20', text: 'text-orange-700 dark:text-orange-300', bar: 'bg-gradient-to-r from-orange-500 to-amber-500' },
  medium:   { gradient: 'from-amber-500 to-yellow-400', bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-300', bar: 'bg-gradient-to-r from-amber-500 to-yellow-400' },
  low:      { gradient: 'from-blue-500 to-sky-400', bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-300', bar: 'bg-gradient-to-r from-blue-500 to-sky-400' },
}

interface Alert { id: string; severity: string; title: string; message: string; area: string; time: string; type?: string }

/** AlertCard — displays an individual alert with severity-based styling */
export default function AlertCard({ alert, onDismiss }: { alert: Alert; onDismiss?: (id: string) => void }) {
  const cfg = SEV[alert.severity] || SEV.low
  const SevIcon = alert.severity === 'critical' ? ShieldAlert : alert.severity === 'high' ? AlertTriangle : Info
  return (
    <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-all animate-fade-up">
      <div className={`h-1 w-full ${cfg.bar} ${alert.severity === 'critical' ? 'animate-pulse' : ''}`} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center flex-shrink-0`}>
            <SevIcon className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cfg.bg} ${cfg.text}`}>{alert.severity}</span>
              {alert.type && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{alert.type}</span>}
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white text-sm">{alert.title}</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{alert.message}</p>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{alert.area}</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{alert.time}</span>
            </div>
          </div>
          {onDismiss && (
            <button onClick={() => onDismiss(alert.id)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5">
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
