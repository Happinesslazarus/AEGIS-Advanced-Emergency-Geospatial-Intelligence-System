/**
 * Module: config.ts
 *
 * Infrastructure damage assessment incident module (handles infrastructure damage specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for infrastructure damage events.
 */

import type { IncidentRegistryEntry } from '../types.js'

export const infrastructureDamageConfig: IncidentRegistryEntry = {
  id: 'infrastructure_damage',
  name: 'Infrastructure Damage',
  category: 'infrastructure',
  icon: 'alert-triangle',
  color: '#FF8C00',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Citizen Reports',
    'Report Aggregation',
    'Emergency Services'
  ],
  aiEndpoint: null,
  aiTier: 'rule_based',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'damageType', label: 'Damage Type', type: 'select', required: false, options: ['Building', 'Bridge', 'Road', 'Railway', 'Other'] },
    { key: 'structuralIntegrity', label: 'Structural Integrity', type: 'select', required: false, options: ['Intact', 'Compromised', 'Collapsed'] },
    { key: 'safetyHazard', label: 'Safety Hazard', type: 'boolean', required: false },
    { key: 'trafficAffected', label: 'Traffic Affected', type: 'boolean', required: false },
    { key: 'emergencyAccess', label: 'Emergency Access Blocked', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'damage_assessment', 'closure_list'],
  alertThresholds: { advisory: 3, warning: 8, critical: 15 }
}

export const INFRASTRUCTURE_CRITICAL_TYPES = [
  'bridge',
  'hospital',
  'emergency_services',
  'water_treatment',
  'power_station'
]

