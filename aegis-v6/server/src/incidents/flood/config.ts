import type { IncidentRegistryEntry } from '../types.js'

export const floodConfig: IncidentRegistryEntry = {
  id: 'flood',
  name: 'Flood',
  category: 'natural_disaster',
  icon: 'water',
  color: '#1E90FF',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'UK Environment Agency Flood Monitoring',
    'Citizen Reports',
    'Weather Data',
    'River Gauge Readings'
  ],
  aiEndpoint: '/api/predict',
  aiTier: 'ml',
  enabledRegions: ['aberdeen_scotland_uk', 'glasgow_scotland_uk'],
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'waterLevel', label: 'Water Level (cm)', type: 'number', required: false },
    { key: 'affectedArea', label: 'Affected Area', type: 'text', required: false },
    { key: 'evacuationNeeded', label: 'Evacuation Needed', type: 'boolean', required: false },
    { key: 'propertyDamage', label: 'Property Damage', type: 'select', required: false, options: ['None', 'Minor', 'Moderate', 'Severe'] },
    { key: 'riverName', label: 'River Name', type: 'text', required: false }
  ],
  widgets: ['map', 'timeline', 'severity_chart', 'river_gauges'],
  alertThresholds: { advisory: 2, warning: 5, critical: 10 }
}

export const FLOOD_DATA_SOURCES = {
  EA_API: 'https://environment.data.gov.uk/flood-monitoring',
  GAUGES_ENDPOINT: '/id/stations',
  FLOODS_ENDPOINT: '/id/floods',
  READINGS_ENDPOINT: '/data/readings'
}

export const FLOOD_SEVERITY_MAPPING = {
  'Severe Flood Warning': 'Critical',
  'Flood Warning': 'High',
  'Flood Alert': 'Medium',
  'No Longer In Force': 'Low'
}

