/**
 * Module: config.ts
 *
 * Ground movement and landslides incident module (handles landslide specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { IncidentRegistryEntry } from '../types.js'

export const landslideConfig: IncidentRegistryEntry = {
  id: 'landslide',
  name: 'Landslide',
  category: 'natural_disaster',
  icon: 'mountain',
  color: '#8B4513',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Open-Meteo Weather API',
    'Geological Surveys',
    'Citizen Reports',
    'Seismic Data'
  ],
  aiEndpoint: null,
  aiTier: 'statistical',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'slopeAngle', label: 'Slope Angle (degrees)', type: 'number', required: false },
    { key: 'soilMoisture', label: 'Soil Moisture (%)', type: 'number', required: false },
    { key: 'recentRainfall', label: 'Recent Rainfall (mm)', type: 'number', required: false },
    { key: 'roadBlocked', label: 'Road Blocked', type: 'boolean', required: false },
    { key: 'structuresDamaged', label: 'Structures Damaged', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'risk_zones', 'rainfall_chart'],
  alertThresholds: { advisory: 1, warning: 3, critical: 7 }
}

export const LANDSLIDE_RISK_THRESHOLDS = {
  rainfall24h: 100, // mm in 24 hours
  rainfall72h: 200, // mm in 72 hours
  slopeAngleCritical: 35, // degrees
  soilMoistureCritical: 80 // %
}

