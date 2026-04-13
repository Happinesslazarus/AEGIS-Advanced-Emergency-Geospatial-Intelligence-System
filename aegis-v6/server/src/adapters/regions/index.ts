/**
 * Module: index.ts
 *
 * Regions barrel export (re-exports module contents).
 *
 * How it connects:
 * - Used by services for external data fetching
 *
 * Simple explanation:
 * Gathers and re-exports everything from the regions directory.
 */

export { regionRegistry, initRegionRegistry } from './RegionRegistry.js'
export type { RegionAdapter } from './RegionAdapter.interface.js'
export type {
  FloodWarning,
  RiverLevel,
  WeatherForecast,
  RainfallData,
  EmergencyContact,
  PhoneFormat,
  FloodZone,
  HazardType,
  RegionMetadata,
  MonitoredCity,
} from './RegionAdapter.interface.js'

