/**
 * incidents/wildfire/config.ts — Wildfire incident configuration
 * AI Tier: tier3 (ML) — Uses trained ML models
 * Data Sources: NASA FIRMS API
 */

import type { IncidentRegistryEntry } from '../types.js'

export const wildfireConfig: IncidentRegistryEntry = {
  id: 'wildfire',
  name: 'Wildfire',
  category: 'natural_disaster',
  icon: 'flame',
  color: '#FF6347',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'NASA FIRMS (Fire Information)',
    'Satellite Imagery',
    'Citizen Reports',
    'Weather Data'
  ],
  aiEndpoint: '/api/ai/predict/wildfire',
  aiTier: 'ml',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'fireSize', label: 'Fire Size (hectares)', type: 'number', required: false },
    { key: 'windDirection', label: 'Wind Direction', type: 'text', required: false },
    { key: 'evacuationOrdered', label: 'Evacuation Ordered', type: 'boolean', required: false },
    { key: 'containment', label: 'Containment (%)', type: 'number', required: false },
    { key: 'smokeVisible', label: 'Smoke Visible', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'fire_perimeter', 'smoke_forecast'],
  alertThresholds: { advisory: 1, warning: 3, critical: 7 }
}

export const WILDFIRE_RISK_FACTORS = {
  temperatureThreshold: 30, // —C
  humidityThreshold: 30, // %
  windSpeedThreshold: 25, // km/h
  vegetationDryness: 0.7 // normalized 0-1
}

export const NASA_FIRMS_CONFIG = {
  baseUrl: 'https://firms.modaps.eosdis.nasa.gov/api/area',
  confidence: 80, // minimum confidence
  lookbackHours: 24
}
