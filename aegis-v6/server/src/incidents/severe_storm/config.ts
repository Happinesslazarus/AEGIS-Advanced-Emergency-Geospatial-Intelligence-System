/**
 * Module: config.ts
 *
 * Severe weather and storm systems incident module (handles severe storm specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for severe storm events.
 */

import type { IncidentRegistryEntry } from '../types.js'

export const severeStormConfig: IncidentRegistryEntry = {
  id: 'severe_storm',
  name: 'Severe Storm',
  category: 'weather',
  icon: 'cloud-lightning',
  color: '#8B00FF',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Open-Meteo Weather API',
    'Citizen Reports',
    'Weather Stations',
    'Lightning Detection'
  ],
  aiEndpoint: null,
  aiTier: 'statistical',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'windSpeed', label: 'Wind Speed (km/h)', type: 'number', required: false },
    { key: 'rainfall', label: 'Rainfall (mm)', type: 'number', required: false },
    { key: 'lightningDetected', label: 'Lightning Detected', type: 'boolean', required: false },
    { key: 'damageType', label: 'Damage Type', type: 'multiselect', required: false, options: ['Trees Down', 'Power Lines', 'Flooding', 'Structural'] },
    { key: 'roadsClosed', label: 'Roads Closed', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'severity_chart', 'weather_radar'],
  alertThresholds: { advisory: 3, warning: 7, critical: 15 }
}

export const STORM_WEATHER_THRESHOLDS = {
  windSpeedCritical: 100, // km/h
  windSpeedHigh: 75,
  windSpeedMedium: 50,
  rainfallCritical: 50, // mm/hour
  rainfallHigh: 30,
  rainfallMedium: 15
}

export const OPEN_METEO_PARAMS = [
  'temperature_2m',
  'precipitation',
  'windspeed_10m',
  'windgusts_10m',
  'weathercode',
  'cloudcover',
  'pressure_msl'
]

