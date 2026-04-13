/**
 * Module: BaseRegionAdapter.ts
 *
 * Base region adapter server module.
 *
 * How it connects:
 * - Used by services for external data fetching
 *
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type {
  RegionAdapter,
  RegionMetadata,
  FloodWarning,
  RiverLevel,
  WeatherForecast,
  RainfallData,
  EmergencyContact,
  PhoneFormat,
  FloodZone,
  HazardType,
  MonitoredCity,
} from './RegionAdapter.interface.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface RegionConfigJSON {
  regionId: string
  name: string
  country: string
  countryCode: string
  timezone: string
  languages: string[]
  units: 'metric' | 'imperial'
  currency?: string
  centre: { lat: number; lng: number }
  zoom: number
  bounds?: { north: number; south: number; east: number; west: number }
  emergencyNumber: string
  floodAuthority: string
  weatherAuthority: string
  emergencyContacts: EmergencyContact[]
  phoneFormat: {
    countryCode: string
    dialCode: string
    nationalFormat: string
    nationalRegex: string
    example: string
  }
  ingestionEndpoints: Record<string, string>
  floodZones: Array<{
    id: string
    name: string
    riskLevel: 'high' | 'medium' | 'low'
    source: string
    wmsUrl?: string
    wmsLayers?: string
    attribution?: string
  }>
  supportedHazardTypes: string[]
  monitoredCities: Array<{ name: string; lat: number; lng: number; cityRegionId?: string }>
  llmContext: {
    floodAuthority: string
    weatherAuthority: string
    floodAuthorityUrl: string
    weatherWarningsUrl: string
    exampleLocations: string[]
    crisisResources: Array<{ name: string; number: string }>
    officialSourceAdvice: string
  }
  rivers: string[]
  propagationMap?: Record<string, string[]>
  historicalFloodEvents?: Array<{ name: string; year: number; river: string; lat: number; lng: number; peakLevelM: number }>
}

export function loadRegionJSON(filename: string): RegionConfigJSON {
  const configDir = resolve(__dirname, '../../config/regions')
  const filePath = resolve(configDir, filename)
  const raw = readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as RegionConfigJSON
}

export abstract class BaseRegionAdapter implements RegionAdapter {
  protected config: RegionConfigJSON

  constructor(configFile: string) {
    this.config = loadRegionJSON(configFile)
  }

  get regionId(): string { return this.config.regionId }
  get country(): string { return this.config.countryCode }
  get timezone(): string { return this.config.timezone }

  getMetadata(): RegionMetadata {
    return {
      regionId: this.config.regionId,
      name: this.config.name,
      country: this.config.country,
      countryCode: this.config.countryCode,
      timezone: this.config.timezone,
      centre: this.config.centre,
      zoom: this.config.zoom,
      bounds: this.config.bounds,
      emergencyNumber: this.config.emergencyNumber,
      floodAuthority: this.config.floodAuthority,
      weatherAuthority: this.config.weatherAuthority,
      languages: this.config.languages,
      units: this.config.units,
    }
  }

  getEmergencyContacts(): EmergencyContact[] {
    return this.config.emergencyContacts
  }

  getPhoneFormat(): PhoneFormat {
    const pf = this.config.phoneFormat
    return {
      countryCode: pf.countryCode,
      dialCode: pf.dialCode,
      nationalFormat: pf.nationalFormat,
      nationalRegex: new RegExp(pf.nationalRegex),
      example: pf.example,
    }
  }

  getFloodZones(): FloodZone[] {
    return this.config.floodZones
  }

  getSupportedHazardTypes(): HazardType[] {
    return this.config.supportedHazardTypes as HazardType[]
  }

  getMonitoredCities(): MonitoredCity[] {
    return this.config.monitoredCities
  }

  getIngestionEndpoints(): Record<string, string> {
    return { ...this.config.ingestionEndpoints }
  }

  getLLMContext() {
    return { ...this.config.llmContext }
  }

  getPropagationMap(): Record<string, string[]> {
    return { ...(this.config.propagationMap || {}) }
  }

  // Subclasses must implement provider-specific fetch methods
  abstract getFloodWarnings(): Promise<FloodWarning[]>
  abstract getRiverLevels(): Promise<RiverLevel[]>
  abstract getWeatherForecast(lat?: number, lng?: number): Promise<WeatherForecast | null>
  abstract getRainfallData(lat?: number, lng?: number): Promise<RainfallData | null>
}

