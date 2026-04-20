/**
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { IncidentRegistryEntry } from '../types.js'

export const heatwaveConfig: IncidentRegistryEntry = {
  id: 'heatwave',
  name: 'Heatwave',
  category: 'weather',
  icon: 'sun',
  color: '#FF4500',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Open-Meteo Weather API',
    'Temperature Sensors',
    'Citizen Reports',
    'Health Services Data'
  ],
  aiEndpoint: '/api/predict',
  aiTier: 'statistical',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'temperature', label: 'Temperature (--C)', type: 'number', required: false },
    { key: 'humidity', label: 'Humidity (%)', type: 'number', required: false },
    { key: 'heatIndex', label: 'Heat Index', type: 'number', required: false },
    { key: 'vulnerablePopulation', label: 'Vulnerable Population Affected', type: 'boolean', required: false },
    { key: 'coolingCentersOpen', label: 'Cooling Centers Open', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'temperature_chart', 'heatmap'],
  alertThresholds: { advisory: 2, warning: 5, critical: 10 }
}

export const HEATWAVE_TEMPERATURE_THRESHOLDS = {
  critical: 38, // --C
  high: 35,
  medium: 32,
  low: 28
}

export const HEATWAVE_DURATION_THRESHOLD = 3 // consecutive days

