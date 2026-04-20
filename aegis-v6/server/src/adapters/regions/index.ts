/**
 * Regions barrel export (re-exports module contents).
 *
 * - Used by services for external data fetching
 * */

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

