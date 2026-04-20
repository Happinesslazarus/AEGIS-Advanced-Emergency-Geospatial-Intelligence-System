/**
 * Barrel re-export for the incident module registry. Every hazard type
 * (flood, heatwave, landslide, etc.) registers itself in registry.ts; this
 * index exposes the full lookup and query API so the rest of the server can
 * import from 'incidents/' without knowing the internal file structure.
 *
 * - Consumed by server/src/index.ts when mounting incident-specific routes
 * - `getEnabledHazards()` in hazards.ts controls which modules are operational
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

