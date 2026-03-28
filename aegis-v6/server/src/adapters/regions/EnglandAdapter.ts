/**
 * adapters/regions/EnglandAdapter.ts — England region adapter
 *
 * Integrates Environment Agency for flood data and river gauges,
 * Met Office for weather, and Open-Meteo as fallback.
 */

import { BaseRegionAdapter } from './BaseRegionAdapter.js'
import type { FloodWarning, RiverLevel, WeatherForecast, RainfallData } from './RegionAdapter.interface.js'

const TIMEOUT_MS = 15_000
const EA_BASE = 'https://environment.data.gov.uk/flood-monitoring'

export class EnglandAdapter extends BaseRegionAdapter {
  constructor() {
    super('england.json')
  }

  async getFloodWarnings(): Promise<FloodWarning[]> {
    try {
      const res = await fetch(
        `${EA_BASE}/id/floods?_limit=100`,
        {
          headers: { 'User-Agent': 'AEGIS-AlertIngestion/1.0', Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      )
      if (!res.ok) return []

      const json = await res.json() as any
      const items: any[] = json.items || []

      return items.map((item: any) => {
        const sevRaw = (item.severity || item.severityLevel || '').toString().toLowerCase()
        let severity: FloodWarning['severity'] = 'info'
        if (sevRaw.includes('severe') || sevRaw === '1') severity = 'severe'
        else if (sevRaw.includes('warning') || sevRaw === '2') severity = 'warning'
        else if (sevRaw.includes('alert') || sevRaw === '3') severity = 'alert'

        return {
          id: item['@id'] || item.floodAreaID || `EA-${Date.now()}`,
          title: item.description || item.message || 'EA Flood Warning',
          description: item.message || item.description || '',
          severity,
          area: item.eaAreaName || item.floodArea?.label || null,
          source: 'Environment Agency',
          issuedAt: item.timeRaised || item.timeMessageChanged || new Date().toISOString(),
          url: item['@id'] || undefined,
        }
      })
    } catch {
      return []
    }
  }

  async getRiverLevels(): Promise<RiverLevel[]> {
    try {
      const res = await fetch(
        `${EA_BASE}/id/stations?parameter=level&_limit=50`,
        {
          headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0', Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      )
      if (!res.ok) return []

      const json = await res.json() as any
      const stations: any[] = (json.items || []).slice(0, 30)
      const results: RiverLevel[] = []

      // Fetch latest reading for each station in parallel
      const readingPromises = stations.map(async (station: any) => {
        try {
          const measureUrl = station.measures?.[0]?.['@id'] || station.measures?.[0]
          if (!measureUrl) return null

          const readRes = await fetch(
            `${typeof measureUrl === 'string' ? measureUrl : measureUrl['@id']}/readings?_sorted&_limit=1`,
            {
              headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0' },
              signal: AbortSignal.timeout(10_000),
            },
          )
          if (!readRes.ok) return null

          const readData = await readRes.json() as any
          const latest = readData.items?.[0]
          if (!latest) return null

          return {
            stationId: station.stationReference || station['@id'],
            stationName: station.label || 'Unknown Station',
            riverName: station.riverName || 'Unknown River',
            levelMetres: typeof latest.value === 'number' ? latest.value : null,
            flowCumecs: null,
            timestamp: latest.dateTime || new Date().toISOString(),
            dataSource: 'Environment Agency',
          } satisfies RiverLevel
        } catch {
          return null
        }
      })

      const readings = await Promise.allSettled(readingPromises)
      for (const r of readings) {
        if (r.status === 'fulfilled' && r.value) results.push(r.value)
      }

      return results
    } catch {
      return []
    }
  }

  async getWeatherForecast(lat?: number, lng?: number): Promise<WeatherForecast | null> {
    const centre = this.config.centre
    const useLat = lat ?? centre.lat
    const useLng = lng ?? centre.lng

    // Try OpenWeatherMap
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
            precipitationMm: data.rain?.['1h'] || 0,
            pressureHpa: data.main?.pressure,
            timestamp: new Date().toISOString(),
            source: 'OpenWeatherMap',
          }
        }
      } catch { /* fall through */ }
    }

    // Fallback: Open-Meteo
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
      const past = precip.slice(0, 24)
      const forecast = precip.slice(24)

      return {
        locationName: this.config.name,
        lat: useLat,
        lng: useLng,
        rainfallMm: past.reduce((s, v) => s + (v || 0), 0),
        periodHours: 24,
        forecastMm: forecast.reduce((s, v) => s + (v || 0), 0),
        forecastHours: 6,
        timestamp: new Date().toISOString(),
        source: 'Open-Meteo',
      }
    } catch {
      return null
    }
  }

  private async fetchOpenMeteoWeather(lat: number, lng: number): Promise<WeatherForecast | null> {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure,precipitation&timezone=auto`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (!res.ok) return null

      const data = await res.json() as any
      const c = data.current || {}
      const codeMap: Record<number, string> = {
        0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Fog', 48: 'Depositing rime fog',
        51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
        61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
        71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
        80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
      }

      return {
        location: this.config.name,
        temperature: c.temperature_2m,
        humidity: c.relative_humidity_2m,
        windSpeedMs: (c.wind_speed_10m || 0) / 3.6,
        windDirection: c.wind_direction_10m,
        description: codeMap[c.weather_code] || `Weather code ${c.weather_code}`,
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
