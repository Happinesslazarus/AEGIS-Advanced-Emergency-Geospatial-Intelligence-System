/**
 * Sidebar filter panel for the incident list view. Lets users narrow
 * results by incident type (flood, fire, ...), severity, date range,
 * and geographic radius using Lucide icons for each category.
 */

import { type ElementType } from 'react'
import {
  Droplets, CloudLightning, Thermometer, Flame, MountainSnow,
  Zap, Pipette, Building2, Shield, Radiation, Sun, Globe, HelpCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIncidents, type IncidentTypeId } from '../../contexts/IncidentContext'
import { INCIDENT_HEX as INCIDENT_COLORS } from '../../utils/colorTokens'
import { useLanguage } from '../../hooks/useLanguage'

/** Lucide icon for each incident type -- no unicode emoji */
const INCIDENT_LUCIDE_ICONS: Record<string, ElementType> = {
  flood:                    Droplets,
  severe_storm:             CloudLightning,
  heatwave:                 Thermometer,
  wildfire:                 Flame,
  landslide:                MountainSnow,
  power_outage:             Zap,
  water_supply:             Pipette,
  water_supply_disruption:  Pipette,
  infrastructure_damage:    Building2,
  public_safety:            Shield,
  public_safety_incident:   Shield,
  environmental_hazard:     Radiation,
  drought:                  Sun,
}

const SEVERITY_OPTIONS = [
  { value: null, label: 'all' },
  { value: 'low' as const, label: 'low' },
  { value: 'medium' as const, label: 'medium' },
  { value: 'high' as const, label: 'high' },
  { value: 'critical' as const, label: 'critical' },
]

export default function IncidentFilterPanel(): JSX.Element {
  const lang = useLanguage()
  const { t } = useTranslation(['dashboard', 'incidents', 'common'])
  const {
    registry,
    filter,
    setFilter,
    resetFilter,
    selectedIncidentType,
    setSelectedIncidentType,
    activeIncidentCount,
    operationalTypes,
  } = useIncidents()

  const selectSingleType = (type: IncidentTypeId | null) => {
    setSelectedIncidentType(type)
    if (type) {
      setFilter({ types: [type] })
    } else {
      setFilter({ types: [] })
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('dashboard:incidentFilter.label')}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-300">
            {activeIncidentCount} {t('dashboard:stats.totalActive').toLowerCase()}
          </span>
          {filter.types.length > 0 && (
            <button
              onClick={resetFilter}
              className="text-xs text-aegis-600 hover:text-aegis-700 dark:text-aegis-400"
            >
              {t('common:actions.viewAll')}
            </button>
          )}
        </div>
      </div>

      {/* Incident Type Pills */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => selectSingleType(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
            !selectedIncidentType
              ? 'bg-aegis-600 text-white shadow-sm'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <Globe className="w-3 h-3" />
          {t('dashboard:incidentFilter.all')}
        </button>
        {operationalTypes.map(type => {
          const mod = registry.find(m => m.id === type)
          const isSelected = selectedIncidentType === type || filter.types.includes(type)
          const color = INCIDENT_COLORS[type] || '#6B7280'
          const IconComp: ElementType = INCIDENT_LUCIDE_ICONS[type] ?? HelpCircle

          return (
            <button
              key={type}
              onClick={() => selectSingleType(isSelected && selectedIncidentType === type ? null : type)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                isSelected
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              style={isSelected ? { backgroundColor: color } : {}}
              title={mod?.description || type}
            >
              <IconComp className="w-3 h-3 flex-shrink-0" />
              <span className="capitalize">{t(`incidents:types.${type}.name`, type.replace(/_/g, ' '))}</span>
            </button>
          )
        })}
      </div>

      {/* Severity Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-300">
          {t('dashboard:incidentFilter.bySeverity')}:
        </span>
        <div className="flex gap-1">
          {SEVERITY_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => setFilter({ severityMin: opt.value })}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                filter.severityMin === opt.value
                  ? opt.value === 'critical' ? 'bg-red-600 text-white'
                    : opt.value === 'high' ? 'bg-orange-500 text-white'
                    : opt.value === 'medium' ? 'bg-yellow-500 text-white'
                    : opt.value === 'low' ? 'bg-blue-500 text-white'
                    : 'bg-aegis-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              {(() => { const label = t(`common:severity.${opt.label}`, opt.label); return label.charAt(0).toUpperCase() + label.slice(1) })()}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
