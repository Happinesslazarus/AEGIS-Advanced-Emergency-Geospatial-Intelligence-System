/**
 * Public safety incidents incident module (handles public safety specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { IncidentRegistryEntry } from '../types.js'

export const publicSafetyConfig: IncidentRegistryEntry = {
  id: 'public_safety',
  name: 'Public Safety Incident',
  category: 'security',
  icon: 'shield-alert',
  color: '#DC143C',
  severityLevels: ['Low', 'Medium', 'High', 'Critical'],
  dataSources: [
    'Citizen Reports',
    'Report Aggregation',
    'Emergency Services Integration'
  ],
  aiEndpoint: null,
  aiTier: 'rule_based',
  enabledRegions: 'all',
  operationalStatus: 'fully_operational',
  fieldSchema: [
    { key: 'incidentType', label: 'Incident Type', type: 'select', required: false, options: ['Suspicious Activity', 'Hazmat', 'Civil Disturbance', 'Missing Person', 'Other'] },
    { key: 'policeNotified', label: 'Police Notified', type: 'boolean', required: false },
    { key: 'areaSecured', label: 'Area Secured', type: 'boolean', required: false },
    { key: 'publicAtRisk', label: 'Public at Risk', type: 'boolean', required: false },
    { key: 'evacuationNeeded', label: 'Evacuation Needed', type: 'boolean', required: false }
  ],
  widgets: ['map', 'timeline', 'incident_log', 'resource_dispatch'],
  alertThresholds: { advisory: 2, warning: 5, critical: 10 }
}

export const PUBLIC_SAFETY_PRIORITY_KEYWORDS = [
  'weapon',
  'explosion',
  'fire',
  'hazmat',
  'evacuation',
  'active threat'
]

