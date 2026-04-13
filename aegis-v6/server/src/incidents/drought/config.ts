/**
 * Module: config.ts
 *
 * Extended drought conditions incident module (handles drought specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for drought events.
 */

import type { IncidentRegistryEntry } from '../types.js'

export const droughtConfig: IncidentRegistryEntry = {
  id: 'drought',
  name: 'Drought',
  category: 'natural_disaster',
  icon: 'sun',
  color: '#D97706',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Open-Meteo Climate API',
    'SEPA River Levels',
    'Soil Moisture Network',
    'Citizen Reports',
  ],
  aiEndpoint: '/api/predict',
  aiTier: 'statistical',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'cropDamageReported', label: 'Crop Damage Reported', type: 'boolean', required: false },
    { key: 'waterRestrictions', label: 'Water Restrictions in Place', type: 'boolean', required: false },
    { key: 'riverLevelLow', label: 'River Level Critically Low', type: 'boolean', required: false },
  ],
  widgets: ['weather_panel', 'preparedness', 'resource_advisory'],
  alertThresholds: { advisory: 30, warning: 55, critical: 75 },
}

export const DROUGHT_THRESHOLDS = {
  RAINFALL_30D_NORMAL_MM: 100,   // UK average
  DROUGHT_HIGH_MM: 40,            // <40mm = high risk
  DROUGHT_CRITICAL_MM: 20,        // <20mm = critical
  TEMP_UPLIFT_C: 20,              // temperatures above this worsen risk
}

