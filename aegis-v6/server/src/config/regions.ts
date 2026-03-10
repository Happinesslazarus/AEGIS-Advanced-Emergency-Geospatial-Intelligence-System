/**
 * config/regions.ts — Region configuration registry
 *
 * Defines geographic regions AEGIS can operate in. Scotland is the default
 * deployment target, but additional regions (England, Wales, etc.) can be
 * added by extending the REGIONS map below.
 *
 * Each region specifies its map centre, flood authority APIs, WMS layers,
 * emergency numbers, and river systems. The active region is selected via
 * the AEGIS_REGION environment variable (defaults to 'scotland').
 *
 * Why a static config rather than DB? Region definitions rarely change and
 * are needed at startup before the DB pool is ready. They also define API
 * endpoints that services depend on during initialisation.
 */

import type { RegionConfig } from '../types/index.js'

export const REGIONS: Record<string, RegionConfig> = {
  scotland: {
    id: 'scotland',
    name: 'Scotland',
    country: 'GB',
    center: [56.49, -4.20],
    zoom: 7,
    bounds: [[54.63, -8.65], [60.86, -0.73]],
    timezone: 'Europe/London',
    emergencyNumber: '999',
    floodAuthority: 'SEPA',
    weatherApi: 'https://api.openweathermap.org/data/2.5',
    gaugeApi: 'https://timeseries.sepa.org.uk/KiWIS/KiWIS',
    wmsLayers: [
      {
        name: 'SEPA Flood Map — River (High)',
        url: 'https://map.sepa.org.uk/floodmap/wms',
        layers: 'sepa:fld_FluvialHighLikelihood',
        format: 'image/png',
        transparent: true,
        attribution: '© SEPA',
      },
      {
        name: 'SEPA Flood Map — River (Medium)',
        url: 'https://map.sepa.org.uk/floodmap/wms',
        layers: 'sepa:fld_FluvialMediumLikelihood',
        format: 'image/png',
        transparent: true,
        attribution: '© SEPA',
      },
      {
        name: 'SEPA Flood Map — Surface Water',
        url: 'https://map.sepa.org.uk/floodmap/wms',
        layers: 'sepa:fld_PluvialHighLikelihood',
        format: 'image/png',
        transparent: true,
        attribution: '© SEPA',
      },
      {
        name: 'SEPA Flood Map — Coastal',
        url: 'https://map.sepa.org.uk/floodmap/wms',
        layers: 'sepa:fld_CoastalHighLikelihood',
        format: 'image/png',
        transparent: true,
        attribution: '© SEPA',
      },
    ],
    rivers: [
      'River Tay', 'River Dee', 'River Don', 'River Spey',
      'River Clyde', 'River Forth', 'River Tweed', 'River Ness',
      'River Findhorn', 'River Deveron',
    ],
  },

  england: {
    id: 'england',
    name: 'England',
    country: 'GB',
    center: [52.56, -1.46],
    zoom: 6,
    bounds: [[49.86, -6.42], [55.81, 1.77]],
    timezone: 'Europe/London',
    emergencyNumber: '999',
    floodAuthority: 'Environment Agency',
    weatherApi: 'https://api.openweathermap.org/data/2.5',
    gaugeApi: 'https://environment.data.gov.uk/flood-monitoring',
    wmsLayers: [
      {
        name: 'EA Flood Zone 3',
        url: 'https://environment.data.gov.uk/spatialdata/flood-map-for-planning-rivers-and-sea-flood-zone-3/wms',
        layers: 'Flood_Map_for_Planning_Rivers_and_Sea_Flood_Zone_3',
        format: 'image/png',
        transparent: true,
        attribution: '© Environment Agency',
      },
      {
        name: 'EA Flood Zone 2',
        url: 'https://environment.data.gov.uk/spatialdata/flood-map-for-planning-rivers-and-sea-flood-zone-2/wms',
        layers: 'Flood_Map_for_Planning_Rivers_and_Sea_Flood_Zone_2',
        format: 'image/png',
        transparent: true,
        attribution: '© Environment Agency',
      },
    ],
    rivers: [
      'River Thames', 'River Severn', 'River Trent', 'River Great Ouse',
      'River Wye', 'River Aire', 'River Avon', 'River Exe',
    ],
  },

  wales: {
    id: 'wales',
    name: 'Wales',
    country: 'GB',
    center: [52.13, -3.78],
    zoom: 7,
    bounds: [[51.34, -5.35], [53.43, -2.65]],
    timezone: 'Europe/London',
    emergencyNumber: '999',
    floodAuthority: 'Natural Resources Wales',
    weatherApi: 'https://api.openweathermap.org/data/2.5',
    // NRW uses EA flood-monitoring API for gauge data
    gaugeApi: 'https://environment.data.gov.uk/flood-monitoring',
    wmsLayers: [
      {
        name: 'NRW Flood Map — Rivers (High)',
        url: 'https://lle.gov.wales/services/wms/nrw',
        layers: 'NRW:Fluvial_Flood_Map_for_Planning_High_Risk',
        format: 'image/png',
        transparent: true,
        attribution: '© Natural Resources Wales',
      },
      {
        name: 'NRW Flood Map — Surface Water',
        url: 'https://lle.gov.wales/services/wms/nrw',
        layers: 'NRW:Surface_Water_Flood_Map_High_Risk',
        format: 'image/png',
        transparent: true,
        attribution: '© Natural Resources Wales',
      },
    ],
    rivers: [
      'River Wye', 'River Severn', 'River Usk', 'River Taff',
      'River Conwy', 'River Dee', 'River Teifi', 'River Tywi',
    ],
  },

  northern_ireland: {
    id: 'northern_ireland',
    name: 'Northern Ireland',
    country: 'GB',
    center: [54.60, -6.73],
    zoom: 8,
    bounds: [[53.96, -8.18], [55.37, -5.43]],
    timezone: 'Europe/London',
    emergencyNumber: '999',
    floodAuthority: 'Rivers Agency (DfI)',
    weatherApi: 'https://api.openweathermap.org/data/2.5',
    gaugeApi: 'https://www.nidirect.gov.uk/floodnireland',
    wmsLayers: [
      {
        name: 'DfI Flood Map — Fluvial',
        url: 'https://mapping.infrastructure-ni.gov.uk/arcgis/services/FloodMaps/Flood_Maps_wms/MapServer/WmsServer',
        layers: 'Fluvial_Flood_Extent_High',
        format: 'image/png',
        transparent: true,
        attribution: '© Department for Infrastructure Northern Ireland',
      },
      {
        name: 'DfI Flood Map — Coastal',
        url: 'https://mapping.infrastructure-ni.gov.uk/arcgis/services/FloodMaps/Flood_Maps_wms/MapServer/WmsServer',
        layers: 'Coastal_Flood_Extent_High',
        format: 'image/png',
        transparent: true,
        attribution: '© Department for Infrastructure Northern Ireland',
      },
    ],
    rivers: [
      'River Bann', 'River Foyle', 'River Erne', 'River Lagan',
      'River Bush', 'River Blackwater', 'River Maine', 'River Six Mile Water',
    ],
  },
}

/**
 * Get the active region config. Falls back to Scotland if the
 * AEGIS_REGION env var is unset or points to an unknown region.
 */
export function getActiveRegion(): RegionConfig {
  const regionId = (process.env.AEGIS_REGION || 'scotland').toLowerCase()
  return REGIONS[regionId] || REGIONS.scotland
}

/**
 * List all available region IDs for admin selection dropdowns.
 */
export function listRegionIds(): string[] {
  return Object.keys(REGIONS)
}
