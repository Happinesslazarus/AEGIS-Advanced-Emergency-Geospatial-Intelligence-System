
/**
 * Module: index.ts
 *
 * Index incident component.
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Part of the incident management system.
 */

export {
  getIncidentModule,
  getAllIncidentModules,
  getAllIncidentRegistries,
  getModulesByStatus,
  getOperationalModules,
  getModulesForRegion,
  isRegistered,
  listIncidentIds,
  getDashboardSummary,
  MODULES,
} from './registry.js'

export type {
  IncidentModule,
  IncidentRegistryEntry,
  IncidentOperationalStatus,
  IncidentPrediction,
  IncidentAlert,
  IncidentMapData,
  IncidentMapMarker,
  AlertRuleContext,
  AlertRuleResult,
  AITier,
} from './types.js'

