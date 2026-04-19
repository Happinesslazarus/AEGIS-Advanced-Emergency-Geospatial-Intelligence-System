
/**
 * Module: index.ts
 *
 * Index incident component.
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

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

