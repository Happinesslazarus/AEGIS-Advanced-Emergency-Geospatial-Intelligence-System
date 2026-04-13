/**
 * Module: config.ts
 *
 * Water supply disruptions incident module (handles water supply specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for water supply events.
 */

import type { IncidentRegistryEntry } from '../types.js'

export const waterSupplyConfig: IncidentRegistryEntry = {
  id: 'water_supply',
  name: 'Water Supply Disruption',
  category: 'infrastructure',
  icon: 'droplet',
  color: '#00CED1',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Citizen Reports',
    'Report Aggregation',
    'Water Quality Monitoring'
  ],
  aiEndpoint: null,
  aiTier: 'rule_based',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'disruptionType', label: 'Disruption Type', type: 'select', required: false, options: ['No Water', 'Low Pressure', 'Contamination', 'Boil Advisory'] },
    { key: 'affectedHouseholds', label: 'Affected Households', type: 'number', required: false },
    { key: 'waterQualityIssue', label: 'Water Quality Issue', type: 'boolean', required: false },
    { key: 'estimatedDuration', label: 'Estimated Duration (hours)', type: 'number', required: false },
    { key: 'alternativeSupply', label: 'Alternative Supply Available', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'affected_count', 'water_quality'],
  alertThresholds: { advisory: 5, warning: 15, critical: 30 }
}

export const WATER_SUPPLY_PRIORITY_LEVELS = {
  contamination: 'Critical',
  noWater: 'High',
  lowPressure: 'Medium',
  boilAdvisory: 'Medium'
}

