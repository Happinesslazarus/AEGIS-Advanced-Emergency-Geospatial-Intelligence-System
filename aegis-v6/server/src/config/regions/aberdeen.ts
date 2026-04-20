/**
 * City-level configuration for Aberdeen, Scotland. Defines the bounding box,
 * map centre (57.15°N, 2.09°W), monitored river stations (Don, Dee) with SEPA
 * gauge IDs and flood thresholds, and the WMS layers used to render SEPA flood
 * extent maps on the dashboard.
 *
 * - Consumed by server/src/config/regions.ts (registered under 'aberdeen')
 * - River threshold values calibrated against SEPA gauge 15003 historical data
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
      historicalFloodLevel: 3.8,    // Metres -- based on SEPA peak records
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
  riverAuthority: 'SEPA',
  satelliteSource: 'NASA FIRMS',
  alertingAuthority: 'Aberdeen City Council',
  emergencyNumber: '999',
  coordinateSystem: 'WGS84',
  populationDensity: 'urban',
  shelterSearchRadiusKm: 25,
  wmsLayers: [
    {
      name: 'SEPA Flood Map -- River (High Likelihood)',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_FluvialHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '-- SEPA',
      opacity: 0.5,
      riskLevel: 'high',
    },
    {
      name: 'SEPA Flood Map -- River (Medium Likelihood)',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_FluvialMediumLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '-- SEPA',
      opacity: 0.4,
      riskLevel: 'medium',
    },
    {
      name: 'SEPA Flood Map -- Surface Water',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_PluvialHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '-- SEPA',
      opacity: 0.35,
      riskLevel: 'low',
    },
    {
      name: 'SEPA Flood Map -- Coastal',
      url: 'https://map.sepa.org.uk/floodmap/wms',
      layers: 'sepa:fld_CoastalHighLikelihood',
      format: 'image/png',
      transparent: true,
      attribution: '-- SEPA',
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

  //Multi-Incident Configuration
  language: 'en',
  units: 'metric',
  enabledIncidents: {
    flood:                  { enabled: true,  dataSources: ['sepa_gauges', 'ea_flood_api', 'citizen_reports'], alertThresholds: { advisory: 0.3, warning: 0.6, critical: 0.85 } },
    severe_storm:           { enabled: true,  dataSources: ['met_office', 'openweathermap'], alertThresholds: { advisory: 0.25, warning: 0.5, critical: 0.8 } },
    heatwave:               { enabled: true,  dataSources: ['met_office', 'open_meteo'], alertThresholds: { advisory: 25, warning: 30, critical: 35 } },
    wildfire:               { enabled: false, notes: 'Low wildfire risk in NE Scotland' },
    landslide:              { enabled: true,  dataSources: ['sepa_rainfall', 'bgs_geology'], alertThresholds: { advisory: 0.2, warning: 0.5, critical: 0.8 } },
    power_outage:           { enabled: true,  dataSources: ['ssen_distribution', 'citizen_reports'] },
    water_supply:           { enabled: true,  dataSources: ['scottish_water', 'citizen_reports'] },
    infrastructure_damage:  { enabled: true,  dataSources: ['aberdeenshire_council', 'citizen_reports'] },
    public_safety:          { enabled: true,  dataSources: ['police_scotland', 'citizen_reports'] },
    environmental_hazard:   { enabled: true,  dataSources: ['sepa_air_quality', 'defra_aqi'] },
  },
  emergencyContacts: [
    { name: 'Police Scotland (non-emergency)', number: '101', type: 'police' },
    { name: 'Scottish Fire & Rescue', number: '999', type: 'fire' },
    { name: 'NHS 24', number: '111', type: 'ambulance' },
    { name: 'SSEN Power Outages', number: '105', type: 'utility' },
    { name: 'Scottish Water', number: '0800 077 8778', type: 'utility' },
    { name: 'Aberdeen Coastguard', number: '999', type: 'coast_guard' },
  ],
  alertAuthorities: {
    flood: 'SEPA',
    severe_storm: 'Met Office',
    heatwave: 'Met Office',
    environmental_hazard: 'SEPA',
    public_safety: 'Police Scotland',
  },
}

export default aberdeen

