/*
 * IncomingAlertsWidget.tsx - Display active emergency alerts on login page
 * Shows recent hazards/emergencies before citizen authentication
 */

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Droplet, Flame, Wind, TrendingUp, Clock, MapPin, Eye, ChevronRight } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { SEVERITY_CLASSES } from '../../utils/colorTokens'

export interface Alert {
  id: string
  title: string
  message: string
  severity: string
  location?: string
  locationText?: string
  createdAt: string
  hazardType?: string
  type?: string
}

const HAZARD_ICONS: Record<string, any> = {
  flood: Droplet,
  drought: Flame,
  heatwave: Wind,
  severity: TrendingUp,
  default: AlertTriangle,
}

const SEVERITY_COLORS: Record<string, string> = SEVERITY_CLASSES

const SEVERITY_BADGES: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-600 text-white',
  medium: 'bg-yellow-600 text-white',
  warning: 'bg-amber-600 text-white',
  low: 'bg-blue-600 text-white',
  info: 'bg-sky-600 text-white',
}

export function IncomingAlertsWidget() {
  const lang = useLanguage()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const fetchAlerts = async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        setLoading(true)
        setError(null)
        const response = await fetch('/api/alerts', { signal: controller.signal })
        if (!response.ok) throw new Error('Failed to fetch alerts')
        const data = await response.json()
        const list = Array.isArray(data) ? data : (data.alerts || data.data || [])
        const normalized = list.slice(0, 5).map((a: any) => ({
          ...a,
          locationText: a.locationText || a.location || '',
          hazardType: a.hazardType || a.type || 'default',
        }))
        setAlerts(normalized)
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Error fetching alerts:', err)
          setError(t('alerts.loadError', lang))
        }
      } finally {
        setLoading(false)
      }
    }

    fetchAlerts()
    const interval = setInterval(fetchAlerts, 30000)
    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [])

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-500 dark:text-gray-300">
        <div className="animate-spin inline-block w-5 h-5 border-2 border-aegis-600 border-t-transparent rounded-full" />
        <p className="mt-2 text-sm">{t('alerts.loading', lang)}</p>
      </div>
    )
  }

  if (error || !alerts.length) {
    return (
      <div className="p-6 text-center text-gray-500 dark:text-gray-300">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-400 dark:text-gray-300" />
        <p className="text-sm">{t('alerts.noActive', lang)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 max-h-[500px] overflow-y-auto">
      {alerts.map((alert) => {
        const Icon = HAZARD_ICONS[alert.hazardType || 'default'] || HAZARD_ICONS.default
        const colorClass = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.medium
        const badgeClass = SEVERITY_BADGES[alert.severity] || SEVERITY_BADGES.medium

        return (
          <div
            key={alert.id}
            className={`
              border-l-4 p-4 rounded-lg transition-all hover:shadow-md
              ${colorClass}
            `}
          >
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-sm leading-tight">{alert.title}</h4>
                  <span className={`${badgeClass} px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap`}>
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <p className="text-sm opacity-90 mb-2 leading-snug">{alert.message}</p>
                <div className="flex items-center gap-4 text-xs opacity-75 flex-wrap">
                  {alert.locationText && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      <span>{alert.locationText}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(alert.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
                <Link
                  to={`/citizen?alert=${alert.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold mt-2 px-3 py-1.5 rounded-lg bg-white/50 dark:bg-black/20 hover:bg-white/80 dark:hover:bg-black/40 border border-current/20 transition-all group"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {t('alerts.viewDetails', lang)}
                  <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default IncomingAlertsWidget
