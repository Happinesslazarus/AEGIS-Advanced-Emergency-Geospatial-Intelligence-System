/**
 * Module: glasgow.ts
 *
 * Glasgow server module.
 *
 * - Imported by services and components that need this configuration
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
  riverAuthority: 'SEPA',
  satelliteSource: 'NASA FIRMS',
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
      attribution: '— SEPA',
      opacity: 0.5,
      riskLevel: 'high',
    },
    {
      name: 'SEPA Flood Map — River (Medium Likelihood)',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_FluvialMediumLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '— SEPA',
      opacity: 0.4,
      riskLevel: 'medium',
    },
    {
      name: 'SEPA Flood Map — Surface Water',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_PluvialHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '— SEPA',
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

  // Multi-Incident Configuration
  language: 'en',
  units: 'metric',
  enabledIncidents: {
    flood:                  { enabled: true,  dataSources: ['sepa_gauges', 'ea_flood_api', 'citizen_reports'], alertThresholds: { advisory: 0.3, warning: 0.6, critical: 0.85 } },
    severe_storm:           { enabled: true,  dataSources: ['met_office', 'openweathermap'], alertThresholds: { advisory: 0.25, warning: 0.5, critical: 0.8 } },
    heatwave:               { enabled: true,  dataSources: ['met_office', 'open_meteo'] },
    wildfire:               { enabled: false, notes: 'Low wildfire risk in central Scotland' },
    landslide:              { enabled: true,  dataSources: ['sepa_rainfall', 'bgs_geology'] },
    power_outage:           { enabled: true,  dataSources: ['sp_energy_networks', 'citizen_reports'] },
    water_supply:           { enabled: true,  dataSources: ['scottish_water', 'citizen_reports'] },
    infrastructure_damage:  { enabled: true,  dataSources: ['glasgow_city_council', 'citizen_reports'] },
    public_safety:          { enabled: true,  dataSources: ['police_scotland', 'citizen_reports'] },
    environmental_hazard:   { enabled: true,  dataSources: ['sepa_air_quality', 'defra_aqi'] },
  },
  emergencyContacts: [
    { name: 'Police Scotland (non-emergency)', number: '101', type: 'police' },
    { name: 'Scottish Fire & Rescue', number: '999', type: 'fire' },
    { name: 'NHS 24', number: '111', type: 'ambulance' },
    { name: 'SP Energy Networks', number: '105', type: 'utility' },
    { name: 'Scottish Water', number: '0800 077 8778', type: 'utility' },
  ],
  alertAuthorities: {
    flood: 'SEPA',
    severe_storm: 'Met Office',
    heatwave: 'Met Office',
    environmental_hazard: 'SEPA',
    public_safety: 'Police Scotland',
  },
}

export default glasgow

