import type { IncidentRegistryEntry } from '../types.js'

export const environmentalHazardConfig: IncidentRegistryEntry = {
  id: 'environmental_hazard',
  name: 'Environmental Hazard',
  category: 'environmental',
  icon: 'cloud',
  color: '#32CD32',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'OpenAQ Air Quality API',
    'Environmental Sensors',
    'Citizen Reports',
    'EPA Data'
  ],
  aiEndpoint: '/api/predict',
  aiTier: 'ml',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'hazardType', label: 'Hazard Type', type: 'select', required: false, options: ['Air Quality', 'Water Contamination', 'Soil Contamination', 'Radiation', 'Chemical Spill'] },
    { key: 'pollutant', label: 'Pollutant', type: 'text', required: false },
    { key: 'airQualityIndex', label: 'Air Quality Index', type: 'number', required: false },
    { key: 'healthAdvisory', label: 'Health Advisory Issued', type: 'boolean', required: false },
    { key: 'sourceIdentified', label: 'Source Identified', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'aqi_chart', 'pollutant_levels'],
  alertThresholds: { advisory: 2, warning: 5, critical: 10 }
}

export const AIR_QUALITY_THRESHOLDS = {
  pm25: { critical: 250, high: 150, medium: 55, low: 12 },
  pm10: { critical: 350, high: 250, medium: 150, low: 50 },
  o3: { critical: 200, high: 150, medium: 100, low: 50 },
  no2: { critical: 400, high: 200, medium: 100, low: 40 }
}

export const OPENAQ_CONFIG = {
  baseUrl: 'https://api.openaq.org/v2',
  radiusKm: 50,
  parameters: ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co']
}

