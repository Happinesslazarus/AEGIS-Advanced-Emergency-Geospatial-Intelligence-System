/**
 * adapters/regions/index.ts — Public API for the region adapter system
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
