/**
 * Module: GenericAdapter.ts
 *
 * Generic adapter server module.
 *
 * - Used by services for external data fetching
 */

import { BaseRegionAdapter } from './BaseRegionAdapter.js'
import type { FloodWarning, RiverLevel, WeatherForecast, RainfallData } from './RegionAdapter.interface.js'

const TIMEOUT_MS = 15_000

export class GenericAdapter extends BaseRegionAdapter {
  constructor(configFile = 'default.json') {
    super(configFile)
  }

  async getFloodWarnings(): Promise<FloodWarning[]> {
    // Generic adapter has no dedicated flood authority API.
    // We check the Open-Meteo Flood API for global river discharge anomalies.
    const cities = this.config.monitoredCities
    if (!cities.length) return []

    const warnings: FloodWarning[] = []

    for (const city of cities.slice(0, 5)) {
      try {
        const res = await fetch(
          `https://flood-api.open-meteo.com/v1/flood?latitude=${city.lat}&longitude=${city.lng}&daily=river_discharge&forecast_days=7`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        )
        if (!res.ok) continue

        const data = await res.json() as any
        const discharges: number[] = data.daily?.river_discharge || []
        const maxDischarge = Math.max(...discharges.filter((d: number) => !isNaN(d)))

        // Simple threshold — flag if discharge > 2x typical baseline
        if (maxDischarge > 100) {
          warnings.push({
            id: `flood-api-${city.name}-${Date.now()}`,
            title: `Elevated river discharge near ${city.name}`,
            description: `Peak forecast discharge: ${maxDischarge.toFixed(0)} m—/s over the next 7 days.`,
            severity: maxDischarge > 500 ? 'warning' : 'alert',
            area: city.name,
            source: 'Open-Meteo Flood API',
            issuedAt: new Date().toISOString(),
          })
        }
      } catch {
        continue
      }
    }

    return warnings
  }

  async getRiverLevels(): Promise<RiverLevel[]> {
    // Use Open-Meteo Flood API for global river discharge estimates
    const cities = this.config.monitoredCities
    if (!cities.length) return []

    const results: RiverLevel[] = []

    for (const city of cities.slice(0, 10)) {
      try {
        const res = await fetch(
          `https://flood-api.open-meteo.com/v1/flood?latitude=${city.lat}&longitude=${city.lng}&daily=river_discharge&past_days=1&forecast_days=1`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        )
        if (!res.ok) continue

        const data = await res.json() as any
        const discharges: number[] = data.daily?.river_discharge || []
        const latest = discharges[discharges.length - 1]

        if (latest !== undefined && !isNaN(latest)) {
          results.push({
            stationId: `open-meteo-${city.lat}-${city.lng}`,
            stationName: `${city.name} (estimated)`,
            riverName: `River near ${city.name}`,
            levelMetres: null,
            flowCumecs: latest,
            timestamp: new Date().toISOString(),
            dataSource: 'Open-Meteo Flood API',
          })
        }
      } catch {
        continue
      }
    }

    return results
  }

  async getWeatherForecast(lat?: number, lng?: number): Promise<WeatherForecast | null> {
    const centre = this.config.centre
    const useLat = lat ?? centre.lat
    const useLng = lng ?? centre.lng

    // Open-Meteo first (globally available, no key)
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure,precipitation&timezone=auto`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (res.ok) {
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
      }
    } catch { /* fall through */ }

    // Fallback: OpenWeatherMap (needs API key)
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (apiKey) {
      try {
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${useLat}&lon=${useLng}&appid=${apiKey}&units=${this.config.units}`,
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
      } catch { /* give up */ }
    }

    return null
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
}

