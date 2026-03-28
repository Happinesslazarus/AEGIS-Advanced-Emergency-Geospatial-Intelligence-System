 /*
 * config/regions/index.ts — Region configuration registry
 * Provides getRegionConfig(regionId) to retrieve city-level configs.
 * The active region is selected via the REGION_ID environment variable.
 * Defaults to 'aberdeen_scotland_uk' if unset.
 * To add a new city, create a new file in this directory and register
 * it in the CITY_REGIONS map below. That's it — the entire system
 * (map centre, rivers, thresholds, WMS layers, shelters) reconfigures.
  */

import type { CityRegionConfig } from './types.js'
import aberdeen from './aberdeen.js'
import glasgow from './glasgow.js'

// Registry — add new cities here

const CITY_REGIONS: Record<string, CityRegionConfig> = {
  aberdeen_scotland_uk: aberdeen,
  glasgow_scotland_uk: glasgow,
}

// Public API

 /*
 * Get a specific region config by ID.
 * Returns undefined if the region doesn't exist.
  */
export function getRegionConfig(regionId: string): CityRegionConfig | undefined {
  return CITY_REGIONS[regionId]
}

 /*
 * Get the active region based on the REGION_ID environment variable.
 * Falls back to Aberdeen if the env var is missing or invalid.
  */
export function getActiveCityRegion(): CityRegionConfig {
  const configured = (process.env.REGION_ID || process.env.AEGIS_REGION || 'aberdeen_scotland_uk').toLowerCase()
  const alias: Record<string, string> = {
    scotland: 'aberdeen_scotland_uk',
    aberdeen: 'aberdeen_scotland_uk',
    glasgow: 'glasgow_scotland_uk',
  }
  const resolved = alias[configured] || configured
  return CITY_REGIONS[resolved] || CITY_REGIONS.aberdeen_scotland_uk
}

 /*
 * List all registered city region IDs.
  */
export function listCityRegionIds(): string[] {
  return Object.keys(CITY_REGIONS)
}

 /*
 * List all registered city regions with summary info.
  */
export function listCityRegions(): Array<{ id: string; name: string; country: string }> {
  return Object.values(CITY_REGIONS).map(r => ({
    id: r.id,
    name: r.name,
    country: r.country,
  }))
}

export { CITY_REGIONS }
export type { CityRegionConfig, RiverStation, FloodStatus, ThreatLevel, WMSLayerDef } from './types.js'
