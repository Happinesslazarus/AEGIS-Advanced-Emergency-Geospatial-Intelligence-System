/**
 * config/regions/types.ts — Region configuration type definitions
 *
 * Defines the structure of a city-level region configuration.
 * Each region specifies everything AEGIS needs to operate in that city:
 * map centre, rivers, flood thresholds, data providers, and emergency contacts.
 *
 * This architecture allows AEGIS to be deployed for any city on Earth
 * by creating a single configuration file per region.
 */

export interface RiverStation {
  name: string
  dataProvider: 'SEPA' | 'EA' | 'OpenMeteo' | 'USGS' | 'custom'
  stationId: string
  /** Historical flood level used for dynamic threshold calibration */
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

export interface CityRegionConfig {
  id: string
  name: string
  country: string
  timezone: string
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
  alertingAuthority: string
  emergencyNumber: string
  coordinateSystem: string
  populationDensity: 'urban' | 'suburban' | 'rural' | 'mixed'
  wmsLayers?: WMSLayerDef[]
  shelterSearchRadiusKm?: number
  /** Flood extent GeoJSON file paths keyed by river name */
  floodExtentFiles?: Record<string, string>
  /** Pre-calculated evacuation route file paths */
  evacuationRouteFiles?: Record<string, string>
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
