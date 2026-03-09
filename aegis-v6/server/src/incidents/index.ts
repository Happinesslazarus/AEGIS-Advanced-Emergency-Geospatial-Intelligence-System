/**
 * incidents/index.ts — Barrel export for the incident plugin system
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
