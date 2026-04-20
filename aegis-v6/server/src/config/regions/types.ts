/**
 * TypeScript type definitions for city-level region configurations.
 * Defines RiverStation (gauge ID, flood thresholds, data provider),
 * WMSLayerDef (tile URL and layer names), and CityRegionConfig (the full
 * composite shape used by Aberdeen, Glasgow, and future city configs).
 *
 * - Imported by all files under server/src/config/regions/
 * - Distinct from the top-level RegionConfig in server/src/types/index.ts
 */

export interface RiverStation {
  name: string
  dataProvider: 'SEPA' | 'EA' | 'OpenMeteo' | 'USGS' | 'custom'
  stationId: string
  /* Historical flood level used for dynamic threshold calibration */
  historicalFloodLevel?: number
  floodThresholds: {
    normal: number
    elevated: number
    high: number
    severe: number
  }
  coordinates?: { lat: number; lng: number }
}

export interface WMSLayerDef {
  name: string
  url: string
  layers: string
  format: string
  transparent: boolean
  attribution: string
  opacity?: number
  riskLevel?: 'low' | 'medium' | 'high'
}

/* Per-incident regional configuration */
export interface RegionIncidentConfig {
  enabled: boolean
  /* Thresholds for alert generation in this region */
  alertThresholds?: {
    advisory: number
    warning: number
    critical: number
  }
  /* Custom data sources for this incident type in this region */
  dataSources?: string[]
  /* Custom notes for operators about this incident type in this region */
  notes?: string
}

export type IncidentTypeId =
  | 'flood' | 'severe_storm' | 'heatwave' | 'wildfire' | 'landslide'
  | 'power_outage' | 'water_supply' | 'infrastructure_damage'
  | 'public_safety' | 'environmental_hazard'

export interface CityRegionConfig {
  id: string
  name: string
  country: string
  timezone: string
  /* Primary language code for this region */
  language?: string
  /* Unit system: 'metric' | 'imperial' */
  units?: 'metric' | 'imperial'
  centre: { lat: number; lng: number }
  zoom: number
  boundingBox: {
    north: number
    south: number
    east: number
    west: number
  }
  rivers: RiverStation[]
  floodDataProvider: string
  weatherProvider: string
  riverAuthority?: string
  satelliteSource?: string
  alertingAuthority: string
  emergencyNumber: string
  coordinateSystem: string
  populationDensity: 'urban' | 'suburban' | 'rural' | 'mixed'
  wmsLayers?: WMSLayerDef[]
  shelterSearchRadiusKm?: number
  /* Flood extent GeoJSON file paths keyed by river name */
  floodExtentFiles?: Record<string, string>
  /* Pre-calculated evacuation route file paths */
  evacuationRouteFiles?: Record<string, string>

  // Multi-Incident Configuration
  /* Per-incident type configuration for this region */
  enabledIncidents?: Partial<Record<IncidentTypeId, RegionIncidentConfig>>
  /* Emergency contacts beyond the primary number */
  emergencyContacts?: Array<{
    name: string
    number: string
    type: 'police' | 'fire' | 'ambulance' | 'coast_guard' | 'utility' | 'other'
  }>
  /* Alert authority hierarchy for different incident types */
  alertAuthorities?: Partial<Record<IncidentTypeId, string>>
}

/**
 * River flood status derived from dynamic threshold calibration.
 * Uses percentage of historical flood level for self-calibrating behaviour.
 */
export type FloodStatus = 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL'

/**
 * Threat level for the intelligence dashboard.
 */
export type ThreatLevel = 'GREEN' | 'AMBER' | 'RED' | 'CRITICAL'
