/**
 * config/regions/aberdeen.ts — Aberdeen city region configuration
 *
 * Defines Aberdeen-specific geographic data, river stations (Don & Dee),
 * flood thresholds calibrated from SEPA historical records, WMS layers
 * for the SEPA Flood Map, and emergency contact details.
 *
 * The River Don runs NE through Aberdeen to the North Sea at Bridge of Don.
 * The River Dee runs E through the south of the city past Cults and Duthie Park.
 *
 * Thresholds are based on SEPA published action levels for these stations.
 */

import type { CityRegionConfig } from './types.js'

const aberdeen: CityRegionConfig = {
  id: 'aberdeen_scotland_uk',
  name: 'Aberdeen',
  country: 'GB',
  timezone: 'Europe/London',
  centre: { lat: 57.1497, lng: -2.0943 },
  zoom: 13,
  boundingBox: {
    north: 57.22,
    south: 57.08,
    east: -1.95,
    west: -2.20,
  },
  rivers: [
    {
      name: 'River Don',
      dataProvider: 'SEPA',
      stationId: '234234',          // Park Bridge gauge
      historicalFloodLevel: 3.8,    // Metres — based on SEPA peak records
      floodThresholds: { normal: 1.5, elevated: 2.0, high: 2.5, severe: 3.5 },
      coordinates: { lat: 57.1745, lng: -2.1050 },
    },
    {
      name: 'River Dee',
      dataProvider: 'SEPA',
      stationId: '234078',          // Cults gauge
      historicalFloodLevel: 3.5,
      floodThresholds: { normal: 1.0, elevated: 1.8, high: 2.5, severe: 3.2 },
      coordinates: { lat: 57.1320, lng: -2.1540 },
    },
  ],
  floodDataProvider: 'SEPA',
  weatherProvider: 'OpenWeatherMap',
  alertingAuthority: 'Aberdeen City Council',
  emergencyNumber: '999',
  coordinateSystem: 'WGS84',
  populationDensity: 'urban',
  shelterSearchRadiusKm: 25,
  wmsLayers: [
    {
      name: 'SEPA Flood Map — River (High Likelihood)',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_FluvialHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '© SEPA',
      opacity: 0.5,
      riskLevel: 'high',
    },
    {
      name: 'SEPA Flood Map — River (Medium Likelihood)',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_FluvialMediumLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '© SEPA',
      opacity: 0.4,
      riskLevel: 'medium',
    },
    {
      name: 'SEPA Flood Map — Surface Water',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_PluvialHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '© SEPA',
      opacity: 0.35,
      riskLevel: 'low',
    },
    {
      name: 'SEPA Flood Map — Coastal',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_CoastalHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '© SEPA',
      opacity: 0.35,
      riskLevel: 'medium',
    },
  ],
  floodExtentFiles: {
    'River Don': 'aberdeen_don.geojson',
    'River Dee': 'aberdeen_dee.geojson',
  },
  evacuationRouteFiles: {
    aberdeen: 'aberdeen_routes.json',
  },
}

export default aberdeen
