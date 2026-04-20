/**
 * Electrical grid failures incident module (handles power outage specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { IncidentRegistryEntry } from '../types.js'

export const powerOutageConfig: IncidentRegistryEntry = {
  id: 'power_outage',
  name: 'Power Outage',
  category: 'infrastructure',
  icon: 'zap-off',
  color: '#FFD700',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Citizen Reports',
    'Report Aggregation',
    'Critical Infrastructure Monitoring'
  ],
  aiEndpoint: null,
  aiTier: 'rule_based',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'affectedHouseholds', label: 'Affected Households', type: 'number', required: false },
    { key: 'cause', label: 'Suspected Cause', type: 'select', required: false, options: ['Storm', 'Equipment Failure', 'Maintenance', 'Unknown'] },
    { key: 'criticalFacility', label: 'Critical Facility Affected', type: 'boolean', required: false },
    { key: 'estimatedRepairTime', label: 'Estimated Repair Time (hours)', type: 'number', required: false },
    { key: 'backupPowerAvailable', label: 'Backup Power Available', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'outage_zones', 'affected_count'],
  alertThresholds: { advisory: 5, warning: 15, critical: 30 }
}

export const POWER_OUTAGE_CRITICAL_FACILITIES = [
  'hospital',
  'water_treatment',
  'emergency_services',
  'communication_hub'
]

