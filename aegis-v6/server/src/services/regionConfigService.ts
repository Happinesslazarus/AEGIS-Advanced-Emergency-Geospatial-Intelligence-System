/**
 * services/regionConfigService.ts — Enhanced Region Configuration Service
 *
 * Provides a unified API for querying region-specific incident configuration,
 * emergency contacts, alert authorities, and per-incident operational settings.
 *
 * Wraps the existing region registry with multi-incident awareness.
 */

import {
  getRegionConfig,
  getActiveCityRegion,
  listCityRegionIds,
  CITY_REGIONS,
} from '../config/regions/index.js'
import type { CityRegionConfig, IncidentTypeId, RegionIncidentConfig } from '../config/regions/types.js'

// ─── Default incident enablement per region ─────────────────────────────
// If a region doesn't specify enabledIncidents, all 10 types are enabled.
const ALL_INCIDENT_TYPES: IncidentTypeId[] = [
  'flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide',
  'power_outage', 'water_supply', 'infrastructure_damage',
  'public_safety', 'environmental_hazard',
]

const DEFAULT_INCIDENT_CONFIG: RegionIncidentConfig = {
  enabled: true,
  alertThresholds: { advisory: 0.3, warning: 0.6, critical: 0.85 },
}

// ─── Service API ────────────────────────────────────────────────────────

/**
 * Get the full region config for a given region ID.
 * Returns active region if no ID specified.
 */
export function getRegion(regionId?: string): CityRegionConfig {
  if (regionId) {
    return getRegionConfig(regionId) || getActiveCityRegion()
  }
  return getActiveCityRegion()
}

/**
 * Check if a specific incident type is enabled in a region.
 */
export function isIncidentEnabledForRegion(
  incidentType: IncidentTypeId,
  regionId?: string,
): boolean {
  const region = getRegion(regionId)
  if (!region.enabledIncidents) return true // All enabled by default
  const cfg = region.enabledIncidents[incidentType]
  return cfg ? cfg.enabled : true
}

/**
 * Get all incident types enabled for a specific region.
 */
export function getEnabledIncidentsForRegion(regionId?: string): IncidentTypeId[] {
  const region = getRegion(regionId)
  if (!region.enabledIncidents) return [...ALL_INCIDENT_TYPES]
  return ALL_INCIDENT_TYPES.filter(type => {
    const cfg = region.enabledIncidents![type]
    return cfg ? cfg.enabled : true
  })
}

/**
 * Get the incident-specific config for a region (thresholds, data sources, etc.)
 */
export function getIncidentConfigForRegion(
  incidentType: IncidentTypeId,
  regionId?: string,
): RegionIncidentConfig {
  const region = getRegion(regionId)
  if (!region.enabledIncidents || !region.enabledIncidents[incidentType]) {
    return DEFAULT_INCIDENT_CONFIG
  }
  return { ...DEFAULT_INCIDENT_CONFIG, ...region.enabledIncidents[incidentType] }
}

/**
 * Get alert thresholds for a specific incident type in a region.
 */
export function getAlertThresholds(
  incidentType: IncidentTypeId,
  regionId?: string,
): { advisory: number; warning: number; critical: number } {
  const cfg = getIncidentConfigForRegion(incidentType, regionId)
  return cfg.alertThresholds || DEFAULT_INCIDENT_CONFIG.alertThresholds!
}

/**
 * Get the alerting authority for a specific incident type.
 * Falls back to the region's default alertingAuthority.
 */
export function getAlertAuthority(
  incidentType: IncidentTypeId,
  regionId?: string,
): string {
  const region = getRegion(regionId)
  if (region.alertAuthorities && region.alertAuthorities[incidentType]) {
    return region.alertAuthorities[incidentType]!
  }
  return region.alertingAuthority
}

/**
 * Get emergency contacts for a region, optionally filtered by type.
 */
export function getEmergencyContacts(
  regionId?: string,
  contactType?: string,
): Array<{ name: string; number: string; type: string }> {
  const region = getRegion(regionId)
  const primary = { name: 'Emergency Services', number: region.emergencyNumber, type: 'emergency' }
  const extras = region.emergencyContacts || []
  const all = [primary, ...extras]
  if (contactType) return all.filter(c => c.type === contactType)
  return all
}

/**
 * Get the language configured for a region.
 */
export function getRegionLanguage(regionId?: string): string {
  return getRegion(regionId).language || 'en'
}

/**
 * Get the unit system for a region.
 */
export function getRegionUnits(regionId?: string): 'metric' | 'imperial' {
  return getRegion(regionId).units || 'metric'
}

/**
 * Get a summary of all regions and their incident support.
 */
export function getRegionSummary(): Array<{
  id: string
  name: string
  country: string
  enabledIncidentCount: number
  enabledIncidents: IncidentTypeId[]
  language: string
  units: string
}> {
  return listCityRegionIds().map(rid => {
    const region = getRegionConfig(rid)!
    const enabled = getEnabledIncidentsForRegion(rid)
    return {
      id: rid,
      name: region.name,
      country: region.country,
      enabledIncidentCount: enabled.length,
      enabledIncidents: enabled,
      language: region.language || 'en',
      units: region.units || 'metric',
    }
  })
}

/**
 * Validate that a region has all required configuration for an incident type.
 */
export function validateRegionIncidentSupport(
  incidentType: IncidentTypeId,
  regionId?: string,
): { supported: boolean; warnings: string[] } {
  const region = getRegion(regionId)
  const warnings: string[] = []

  if (!isIncidentEnabledForRegion(incidentType, regionId)) {
    return { supported: false, warnings: ['Incident type is disabled for this region'] }
  }

  // Flood requires rivers
  if (incidentType === 'flood' && (!region.rivers || region.rivers.length === 0)) {
    warnings.push('No river stations configured — flood monitoring will be limited to citizen reports')
  }

  // Weather-dependent types need weather provider
  if (['severe_storm', 'heatwave', 'wildfire', 'landslide'].includes(incidentType)) {
    if (!region.weatherProvider) {
      warnings.push('No weather provider configured — predictions will use Open-Meteo fallback')
    }
  }

  return { supported: true, warnings }
}

export { ALL_INCIDENT_TYPES }
