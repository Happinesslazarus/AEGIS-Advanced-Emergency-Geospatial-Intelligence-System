/**
 * config/regions/glasgow.ts — Glasgow city region configuration
 *
 * Glasgow is the second region, proving AEGIS scales to any city.
 * The River Clyde is Glasgow's primary flood risk, flowing W→E through
 * the city centre. The Kelvin joins from the north near Partick.
 *
 * Thresholds calibrated from SEPA published levels for Clyde stations.
 */

import type { CityRegionConfig } from './types.js'

const glasgow: CityRegionConfig = {
  id: 'glasgow_scotland_uk',
  name: 'Glasgow',
  country: 'GB',
  timezone: 'Europe/London',
  centre: { lat: 55.8642, lng: -4.2518 },
  zoom: 13,
  boundingBox: {
    north: 55.92,
    south: 55.80,
    east: -4.10,
    west: -4.40,
  },
  rivers: [
    {
      name: 'River Clyde',
      dataProvider: 'SEPA',
      stationId: '234601',            // Daldowie gauge
      historicalFloodLevel: 4.2,
      floodThresholds: { normal: 1.2, elevated: 2.0, high: 3.0, severe: 3.8 },
      coordinates: { lat: 55.8350, lng: -4.1320 },
    },
    {
      name: 'River Kelvin',
      dataProvider: 'SEPA',
      stationId: '234602',            // Milngavie gauge
      historicalFloodLevel: 2.8,
      floodThresholds: { normal: 0.8, elevated: 1.4, high: 2.0, severe: 2.6 },
      coordinates: { lat: 55.8780, lng: -4.2930 },
    },
    {
      name: 'White Cart Water',
      dataProvider: 'SEPA',
      stationId: '234610',
      historicalFloodLevel: 3.0,
      floodThresholds: { normal: 0.6, elevated: 1.2, high: 1.8, severe: 2.5 },
      coordinates: { lat: 55.8430, lng: -4.3100 },
    },
  ],
  floodDataProvider: 'SEPA',
  weatherProvider: 'OpenWeatherMap',
  alertingAuthority: 'Glasgow City Council',
  emergencyNumber: '999',
  coordinateSystem: 'WGS84',
  populationDensity: 'urban',
  shelterSearchRadiusKm: 30,
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
  ],
  floodExtentFiles: {
    'River Clyde': 'glasgow_clyde.geojson',
  },
  evacuationRouteFiles: {
    glasgow: 'glasgow_routes.json',
  },
}

export default glasgow
