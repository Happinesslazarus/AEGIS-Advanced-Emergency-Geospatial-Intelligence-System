/**
 * Module: AlertCard.tsx
 *
 * Alert card shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, memo } from 'react'
import {
  Clock, X, Radio, MapPin, Timer,
  AlertTriangle, ShieldAlert, Info, Bell,
  Flame, Zap, Droplets, Wind, Thermometer, Shield,
  Mountain, Power, Droplet, Building2, Biohazard,
  Waves, HeartPulse, FlaskConical, Radiation, CloudRain,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import type { Alert } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const SEVERITY_CONFIG: Record<string, {
  gradient: string; border: string; bg: string; text: string; icon: React.ElementType; accentBar: string
}> = {
  critical: { gradient: 'from-red-600 to-rose-500', border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-300', icon: ShieldAlert, accentBar: 'bg-gradient-to-r from-red-500 via-rose-500 to-red-600' },
  high:     { gradient: 'from-orange-600 to-amber-500', border: 'border-orange-200 dark:border-orange-800', bg: 'bg-orange-50 dark:bg-orange-950/20', text: 'text-orange-700 dark:text-orange-300', icon: AlertTriangle, accentBar: 'bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600' },
  warning:  { gradient: 'from-amber-500 to-yellow-400', border: 'border-amber-200 dark:border-amber-800', bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-300', icon: AlertTriangle, accentBar: 'bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-400' },
  medium:   { gradient: 'from-amber-500 to-yellow-400', border: 'border-amber-200 dark:border-amber-800', bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-300', icon: AlertTriangle, accentBar: 'bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-400' },
  info:     { gradient: 'from-blue-500 to-sky-400', border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-300', icon: Info, accentBar: 'bg-gradient-to-r from-blue-500 via-sky-500 to-blue-400' },
  low:      { gradient: 'from-blue-500 to-sky-400', border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-300', icon: Info, accentBar: 'bg-gradient-to-r from-blue-500 via-sky-500 to-blue-400' },
}

const DISASTER_ICONS: Record<string, React.ElementType> = {
  fire: Flame, wildfire: Flame, flood: Droplets, storm: Wind, severe_storm: Wind,
  earthquake: Zap, heatwave: Thermometer, general: Shield, default: Bell,
  landslide: Mountain, drought: CloudRain, power_outage: Power,
  water_supply: Droplet, infrastructure_damage: Building2,
  public_safety: ShieldAlert, environmental_hazard: Biohazard,
  tsunami: Waves, volcanic: Mountain, pandemic: HeartPulse,
  chemical_spill: FlaskConical, nuclear: Radiation,
}

function getConfig(severity: string) {
  return SEVERITY_CONFIG[severity?.toLowerCase()] || SEVERITY_CONFIG.info
}

function getIcon(type: string): React.ElementType {
  return DISASTER_ICONS[type?.toLowerCase()] || DISASTER_ICONS.default
}

interface Props { alert: Alert; onDismiss?: (id: string) => void; compact?: boolean }

export default memo(function AlertCard({ alert, onDismiss, compact = false }: Props): JSX.Element {
  const lang = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const cfg = getConfig(alert.severity)
  const SeverityIcon = cfg.icon
  const DisasterIcon = getIcon(alert.disasterType)

  const isExpired = alert.expiresAt ? new Date(alert.expiresAt) < new Date() : false
  const isInactive = !alert.active
  const needsExpand = !compact && (alert.message?.length ?? 0) > 200

  return (
    <div className={`relative rounded-xl overflow-hidden border ${cfg.border} bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-all group animate-fade-in ${isExpired || isInactive ? 'opacity-60' : ''}`} role="alert">
      {/* Severity accent bar at top */}
      <div className={`h-1 w-full ${cfg.accentBar} ${alert.severity === 'critical' ? 'animate-pulse' : ''}`} />

      {/* Expired / Inactive status banner */}
      {(isExpired || isInactive) && (
        <div className="flex items-center gap-1.5 px-4 py-1 bg-gray-100 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {isInactive ? (t('alertCard.inactive', lang) || 'Inactive') : (t('alertCard.expired', lang) || 'Expired')}
          </span>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Severity icon with gradient background */}
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <SeverityIcon className="w-4.5 h-4.5 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Top row: severity badge + disaster type badge */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text}`}>
                {alert.severity}
              </span>
              {alert.disasterType && alert.disasterType !== 'general' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 capitalize">
                  <DisasterIcon className="w-3 h-3" />
                  {alert.disasterType.replace(/_/g, ' ')}
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="font-bold text-gray-900 dark:text-white text-sm leading-snug">{alert.title}</h3>

            {/* Message with expand / read-more */}
            {!compact && alert.message && (
              <div className="mt-1.5">
                <p className={`text-sm text-gray-600 dark:text-gray-300 leading-relaxed ${needsExpand && !expanded ? 'line-clamp-3' : ''}`}>
                  {alert.message}
                </p>
                {needsExpand && (
                  <button
                    onClick={() => setExpanded(e => !e)}
                    className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-aegis-600 dark:text-aegis-400 hover:text-aegis-700 dark:hover:text-aegis-300 transition-colors"
                  >
                    {expanded
                      ? <><ChevronUp className="w-3 h-3" />{t('alertCard.showLess', lang) || 'Show less'}</>
                      : <><ChevronDown className="w-3 h-3" />{t('alertCard.readMore', lang) || 'Read more'}</>}
                  </button>
                )}
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              {alert.area && (
                <span className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                  <MapPin className="w-3 h-3" /> {alert.area}
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                <Clock className="w-3 h-3" /> {alert.displayTime}
              </span>
              {alert.source && (
                <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 capitalize">
                  <Shield className="w-3 h-3" /> {alert.source}
                </span>
              )}
              {alert.expiresAt && (
                <span className={`flex items-center gap-1 text-[11px] font-semibold ${isExpired ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                  <Timer className="w-3 h-3" />
                  {isExpired ? t('alertCard.expired', lang) : new Date(alert.expiresAt).toLocaleString()}
                </span>
              )}
              {alert.channels && alert.channels.length > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                  <Radio className="w-3 h-3" /> {alert.channels.join(', ')}
                </span>
              )}
            </div>
          </div>

          {/* Dismiss button */}
          {onDismiss && (
            <button
              onClick={() => onDismiss(alert.id)}
              className="flex-shrink-0 p-1 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 opacity-0 group-hover:opacity-100 transition-all"
              aria-label={t('alertCard.dismiss', lang)}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})