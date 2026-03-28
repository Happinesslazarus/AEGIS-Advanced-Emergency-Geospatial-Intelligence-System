/**
 * adapters/regions/ScotlandAdapter.ts — Scotland region adapter
 *
 * Integrates SEPA for flood warnings and river gauges, Met Office for weather,
 * and Open-Meteo as a resilient fallback. Preserves existing Scotland
 * functionality while exposing it through the RegionAdapter interface.
 */

import { BaseRegionAdapter } from './BaseRegionAdapter.js'
import type { FloodWarning, RiverLevel, WeatherForecast, RainfallData } from './RegionAdapter.interface.js'
import { fetchWithFallback } from '../riverData/index.js'
import { getActiveCityRegion } from '../../config/regions/index.js'

const TIMEOUT_MS = 15_000

export class ScotlandAdapter extends BaseRegionAdapter {
  constructor() {
    super('scotland.json')
  }

  async getFloodWarnings(): Promise<FloodWarning[]> {
    const endpoints = this.getIngestionEndpoints()
    const urls = [
      endpoints.flood_warnings,
      endpoints.flood_warnings_fallback,
    ].filter(Boolean)

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'AEGIS-AlertIngestion/1.0', Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) continue

        const json = await res.json() as any
        const isSEPA = url.includes('sepa')
        const items: any[] = isSEPA
          ? (Array.isArray(json) ? json : json.warnings || json.items || [])
          : (json.items || [])
        const source = isSEPA ? 'SEPA' : 'EA'

        if (!items.length) continue

        return items.slice(0, 50).map((item: any) => {
          const sevRaw = (item.severity || item.severityLevel || '').toString().toLowerCase()
          let severity: FloodWarning['severity'] = 'info'
          if (sevRaw.includes('severe') || sevRaw === '1') severity = 'severe'
          else if (sevRaw.includes('warning') || sevRaw === '2') severity = 'warning'
          else if (sevRaw.includes('alert') || sevRaw === '3') severity = 'alert'

          return {
            id: item.id || item.floodAreaID || `${source}-${Date.now()}`,
            title: item.description || item.message || item.headline || `${source} Flood Warning`,
            description: item.description || item.message || item.summary || '',
            severity,
            area: item.area || item.eaAreaName || item.floodArea?.label || null,
            source,
            issuedAt: item.timeRaised || item.timeMessageChanged || new Date().toISOString(),
            url: item.uri || undefined,
          }
        })
      } catch {
        continue
      }
    }

    return []
  }

  async getRiverLevels(): Promise<RiverLevel[]> {
    const cityRegion = getActiveCityRegion()
    const results: RiverLevel[] = []

    for (const river of cityRegion.rivers) {
      try {
        const reading = await fetchWithFallback(
          river.dataProvider,
          river.stationId,
          river.name,
          river.name,
          river.coordinates,
        )
        if (reading) {
          results.push({
            stationId: reading.stationId,
            stationName: reading.stationName,
            riverName: reading.riverName,
            levelMetres: reading.levelMetres,
            flowCumecs: reading.flowCumecs,
            timestamp: reading.timestamp,
            dataSource: reading.dataSource,
          })
        }
      } catch {
        // Individual river failure shouldn't abort the entire fetch
      }
    }

    return results
  }

  async getWeatherForecast(lat?: number, lng?: number): Promise<WeatherForecast | null> {
    const centre = this.config.centre
    const useLat = lat ?? centre.lat
    const useLng = lng ?? centre.lng

    // Try OpenWeatherMap first (more detailed for UK)
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (apiKey) {
      try {
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${useLat}&lon=${useLng}&appid=${apiKey}&units=metric`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        )
        if (res.ok) {
          const data = await res.json() as any
          return {
            location: data.name || this.config.name,
            temperature: data.main?.temp,
            feelsLike: data.main?.feels_like,
            humidity: data.main?.humidity,
            windSpeedMs: data.wind?.speed,
            windDirection: data.wind?.deg,
            description: data.weather?.[0]?.description || 'Unknown',
            icon: data.weather?.[0]?.icon,
            precipitationMm: data.rain?.['1h'] || data.rain?.['3h'] || 0,
            pressureHpa: data.main?.pressure,
            timestamp: new Date().toISOString(),
            source: 'OpenWeatherMap',
          }
        }
      } catch { /* fall through to Open-Meteo */ }
    }

    // Fallback: Open-Meteo (no API key needed)
    return this.fetchOpenMeteoWeather(useLat, useLng)
  }

  async getRainfallData(lat?: number, lng?: number): Promise<RainfallData | null> {
    const centre = this.config.centre
    const useLat = lat ?? centre.lat
    const useLng = lng ?? centre.lng

    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLng}&hourly=precipitation&past_hours=24&forecast_hours=6&timezone=auto`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (!res.ok) return null

      const data = await res.json() as any
      const precip: number[] = data.hourly?.precipitation || []
      const pastPrecip = precip.slice(0, 24)
      const forecastPrecip = precip.slice(24)

      return {
        locationName: this.config.name,
        lat: useLat,
        lng: useLng,
        rainfallMm: pastPrecip.reduce((s, v) => s + (v || 0), 0),
        periodHours: 24,
        forecastMm: forecastPrecip.reduce((s, v) => s + (v || 0), 0),
        forecastHours: 6,
        timestamp: new Date().toISOString(),
        source: 'Open-Meteo',
      }
    } catch {
      return null
    }
  }

  protected async fetchOpenMeteoWeather(lat: number, lng: number): Promise<WeatherForecast | null> {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure,precipitation&timezone=auto`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (!res.ok) return null

      const data = await res.json() as any
      const c = data.current || {}

      return {
        location: this.config.name,
        temperature: c.temperature_2m,
        humidity: c.relative_humidity_2m,
        windSpeedMs: (c.wind_speed_10m || 0) / 3.6, // km/h ? m/s
        windDirection: c.wind_direction_10m,
        description: weatherCodeToDescription(c.weather_code),
        precipitationMm: c.precipitation,
        pressureHpa: c.surface_pressure,
        timestamp: new Date().toISOString(),
        source: 'Open-Meteo',
      }
    } catch {
      return null
    }
  }
}

function weatherCodeToDescription(code: number | undefined): string {
  if (code === undefined || code === null) return 'Unknown'
  const map: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  }
  return map[code] || `Weather code ${code}`
}
