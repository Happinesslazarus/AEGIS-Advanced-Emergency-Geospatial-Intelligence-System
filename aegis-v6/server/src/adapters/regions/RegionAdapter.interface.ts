/**
 * adapters/regions/RegionAdapter.interface.ts — Region adapter contract
 *
 * Every deployment region must implement this interface. The service layer
 * calls these methods exclusively — never provider APIs directly. Adding a
 * new country/region means creating one adapter file, one config JSON, and
 * registering them. No core service rewrites.
 */

// Return types

export interface FloodWarning {
  id: string
  title: string
  description: string
  severity: 'severe' | 'warning' | 'alert' | 'info'
  area: string | null
  source: string
  issuedAt: string
  expiresAt?: string
  url?: string
}

export interface RiverLevel {
  stationId: string
  stationName: string
  riverName: string
  levelMetres: number | null
  flowCumecs: number | null
  timestamp: string
  dataSource: string
  trend?: 'rising' | 'falling' | 'steady'
}

export interface WeatherForecast {
  location: string
  temperature: number
  feelsLike?: number
  humidity: number
  windSpeedMs: number
  windDirection?: number
  description: string
  icon?: string
  precipitationMm?: number
  pressureHpa?: number
  timestamp: string
  source: string
}

export interface RainfallData {
  locationName: string
  lat: number
  lng: number
  /* Total rainfall in mm over the measurement period */
  rainfallMm: number
  /* Measurement period in hours */
  periodHours: number
  /* Forecasted rainfall for the next N hours (if available) */
  forecastMm?: number
  forecastHours?: number
  timestamp: string
  source: string
}

export interface EmergencyContact {
  name: string
  number: string
  type: 'police' | 'fire' | 'ambulance' | 'coast_guard' | 'utility' | 'mental_health' | 'flood_authority' | 'other'
  available?: string
}

export interface PhoneFormat {
  countryCode: string
  /* E.g. '+44' for UK, '+1' for US */
  dialCode: string
  /* Description of national format (e.g. '07xxx xxxxxx') */
  nationalFormat: string
  /* Regex to validate a national number */
  nationalRegex: RegExp
  /* Example phone number for UI placeholders */
  example: string
}

export interface FloodZone {
  id: string
  name: string
  riskLevel: 'high' | 'medium' | 'low'
  source: string
  /* WMS layer URL if available */
  wmsUrl?: string
  wmsLayers?: string
  attribution?: string
}

export type HazardType =
  | 'flood'
  | 'severe_storm'
  | 'heatwave'
  | 'wildfire'
  | 'landslide'
  | 'power_outage'
  | 'water_supply'
  | 'infrastructure_damage'
  | 'public_safety'
  | 'environmental_hazard'
  | 'earthquake'
  | 'tsunami'
  | 'drought'
  | 'volcanic_eruption'

export interface RegionMetadata {
  regionId: string
  name: string
  country: string
  countryCode: string
  timezone: string
  centre: { lat: number; lng: number }
  zoom: number
  bounds?: { north: number; south: number; east: number; west: number }
  emergencyNumber: string
  floodAuthority: string
  weatherAuthority: string
  languages: string[]
  units: 'metric' | 'imperial'
  currency?: string
}

 /**
 * Cities/areas with pre-configured monitoring within this region.
 */
export interface MonitoredCity {
  name: string
  lat: number
  lng: number
  /* Used as REGION_ID for city-level config */
  cityRegionId?: string
}

// Adapter interface

export interface RegionAdapter {
  /* Unique identifier for this region (e.g. 'scotland', 'england', 'global') */
  readonly regionId: string

  /* ISO country code (e.g. 'GB', 'US', 'global') */
  readonly country: string

  /* IANA timezone (e.g. 'Europe/London', 'America/New_York') */
  readonly timezone: string

  /* Static metadata about this region */
  getMetadata(): RegionMetadata

   /**
   * Fetch current flood warnings from the regional authority.
   * Returns an empty array (not an error) if no warnings are active.
   */
  getFloodWarnings(): Promise<FloodWarning[]>

   /**
   * Fetch river level readings for monitored stations.
   * Uses the region's configured data provider.
   */
  getRiverLevels(): Promise<RiverLevel[]>

   /**
   * Fetch weather forecast for the region's primary location(s).
   * @param lat Optional latitude override
   * @param lng Optional longitude override
   */
  getWeatherForecast(lat?: number, lng?: number): Promise<WeatherForecast | null>

   /**
   * Fetch rainfall data for the region.
   * @param lat Optional latitude override
   * @param lng Optional longitude override
   */
  getRainfallData(lat?: number, lng?: number): Promise<RainfallData | null>

  /* All emergency contacts for this region, including specialist services */
  getEmergencyContacts(): EmergencyContact[]

  /* Phone number formatting rules for this region */
  getPhoneFormat(): PhoneFormat

  /* WMS flood zone layers available for map display */
  getFloodZones(): FloodZone[]

  /* Hazard types that are relevant/enabled for this region */
  getSupportedHazardTypes(): HazardType[]

  /* Cities with pre-configured monitoring stations */
  getMonitoredCities(): MonitoredCity[]

   /**
   * Ingestion URLs/endpoints used by cron jobs for this region.
   * Keys are logical names (e.g. 'flood_warnings', 'gauge_data').
   */
  getIngestionEndpoints(): Record<string, string>

   /**
   * LLM context: authority names, example locations, crisis resources.
   * Used to parameterize system prompts and tool descriptions.
   */
  getLLMContext(): {
    floodAuthority: string
    weatherAuthority: string
    floodAuthorityUrl: string
    weatherWarningsUrl: string
    exampleLocations: string[]
    crisisResources: Array<{ name: string; number: string }>
    officialSourceAdvice: string
  }

   /**
   * Propagation map: region-specific flood zone ? downstream areas.
   * Used by the fingerprinting algorithm as a fallback when DB history is empty.
   */
  getPropagationMap(): Record<string, string[]>
}
