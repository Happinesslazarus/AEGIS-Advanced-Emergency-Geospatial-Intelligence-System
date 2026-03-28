/**
 * Weather API - OpenWeatherMap integration
 * User provides their own API key via settings
 * Uses live providers only (Open-Meteo primary, OpenWeatherMap secondary)
 */

export interface WeatherData {
  temp: number; feelsLike: number; humidity: number; pressure: number
  windSpeed: number; windDir: string; description: string; icon: string
  rainfall1h: number; rainfall3h: number; visibility: number
  clouds: number; updatedAt: string; source: 'live'
}

export interface WeatherForecast {
  time: string; temp: number; rainfall: number; windSpeed: number
  description: string; icon: string
}

export interface FloodWeatherRisk {
  level: 'low' | 'moderate' | 'high' | 'severe'
  reason: string; rainfall24h: number; windMax: number
}

const API_BASE = 'https://api.openweathermap.org/data/2.5'

function getApiKey(): string | null {
  return localStorage.getItem('aegis-weather-key')
}

export function setWeatherApiKey(key: string): void {
  localStorage.setItem('aegis-weather-key', key)
}

export function hasWeatherApiKey(): boolean {
  return !!getApiKey()
}

export async function fetchCurrentWeather(lat: number, lon: number): Promise<WeatherData> {
  // Try Open-Meteo first (free, no API key required)
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,visibility&timezone=auto`)
    if (res.ok) {
      const d = await res.json()
      const c = d.current
      return {
        temp: Math.round(c.temperature_2m), feelsLike: Math.round(c.apparent_temperature),
        humidity: c.relative_humidity_2m, pressure: Math.round(c.pressure_msl),
        windSpeed: Math.round(c.wind_speed_10m),
        windDir: degToDir(c.wind_direction_10m),
        description: wmoToDescription(c.weather_code), icon: wmoToIcon(c.weather_code),
        rainfall1h: c.rain || 0, rainfall3h: (c.rain || 0) * 3,
        visibility: c.visibility ? Math.round(c.visibility / 1000) : 10,
        clouds: c.cloud_cover || 0,
        updatedAt: new Date().toISOString(), source: 'live'
      }
    }
  } catch {}

  // Secondary provider: OpenWeatherMap (requires user API key)
  const key = getApiKey()
  if (!key) throw new Error('Live weather provider unavailable and no OpenWeather API key is configured.')

  try {
    const res = await fetch(`${API_BASE}/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    return {
      temp: Math.round(d.main.temp), feelsLike: Math.round(d.main.feels_like),
      humidity: d.main.humidity, pressure: d.main.pressure,
      windSpeed: Math.round(d.wind.speed * 3.6), // m/s to km/h
      windDir: degToDir(d.wind.deg),
      description: d.weather[0].description, icon: d.weather[0].icon,
      rainfall1h: d.rain?.['1h'] || 0, rainfall3h: d.rain?.['3h'] || 0,
      visibility: Math.round((d.visibility || 10000) / 1000),
      clouds: d.clouds.all,
      updatedAt: new Date().toISOString(), source: 'live'
    }
  } catch {
    throw new Error('Unable to fetch live weather data.')
  }
}

export async function fetchForecast(lat: number, lon: number): Promise<WeatherForecast[]> {
  // Primary: Open-Meteo hourly forecast (free, no API key)
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,rain,wind_speed_10m,weather_code&forecast_days=2&timezone=auto`)
    if (res.ok) {
      const d = await res.json()
      const times: string[] = d?.hourly?.time || []
      const temps: number[] = d?.hourly?.temperature_2m || []
      const rain: number[] = d?.hourly?.rain || []
      const wind: number[] = d?.hourly?.wind_speed_10m || []
      const codes: number[] = d?.hourly?.weather_code || []

      return times
        .slice(0, 24)
        .filter((_, i) => i % 3 === 0)
        .slice(0, 8)
        .map((time, i) => {
          const idx = i * 3
          const code = codes[idx] ?? 0
          return {
            time: new Date(time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            temp: Math.round(temps[idx] ?? 0),
            rainfall: rain[idx] ?? 0,
            windSpeed: Math.round(wind[idx] ?? 0),
            description: wmoToDescription(code),
            icon: wmoToIcon(code),
          }
        })
    }
  } catch {}

  // Secondary: OpenWeatherMap
  const key = getApiKey()
  if (!key) throw new Error('Unable to fetch live forecast data. Configure OpenWeather API key as fallback.')

  try {
    const res = await fetch(`${API_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${key}&units=metric&cnt=8`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    return d.list.map((item: any) => ({
      time: new Date(item.dt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      temp: Math.round(item.main.temp),
      rainfall: item.rain?.['3h'] || 0,
      windSpeed: Math.round(item.wind.speed * 3.6),
      description: item.weather[0].description,
      icon: item.weather[0].icon,
    }))
  } catch {
    throw new Error('Unable to fetch live forecast data.')
  }
}

export function assessFloodRisk(weather: WeatherData, forecast: WeatherForecast[]): FloodWeatherRisk {
  const rainfall24h = weather.rainfall3h * 2 + forecast.reduce((s, f) => s + f.rainfall, 0)
  const windMax = Math.max(weather.windSpeed, ...forecast.map(f => f.windSpeed))

  if (rainfall24h > 40 || (rainfall24h > 25 && weather.humidity > 90))
    return { level: 'severe', reason: `Heavy rain forecast (${rainfall24h.toFixed(0)}mm/24h). Flood risk very high.`, rainfall24h, windMax }
  if (rainfall24h > 20 || windMax > 80)
    return { level: 'high', reason: `Significant rainfall expected (${rainfall24h.toFixed(0)}mm). Monitor river levels.`, rainfall24h, windMax }
  if (rainfall24h > 8 || weather.humidity > 85)
    return { level: 'moderate', reason: `Moderate rain likely (${rainfall24h.toFixed(0)}mm). Stay aware.`, rainfall24h, windMax }
  return { level: 'low', reason: 'Conditions normal. No significant flood risk from weather.', rainfall24h, windMax }
}

function degToDir(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

function wmoToDescription(code: number): string {
  const map: Record<number,string> = {
    0:'clear sky',1:'mainly clear',2:'partly cloudy',3:'overcast',
    45:'fog',48:'depositing rime fog',51:'light drizzle',53:'moderate drizzle',55:'dense drizzle',
    61:'slight rain',63:'moderate rain',65:'heavy rain',66:'light freezing rain',67:'heavy freezing rain',
    71:'slight snow',73:'moderate snow',75:'heavy snow',80:'slight showers',81:'moderate showers',82:'violent showers',
    85:'slight snow showers',86:'heavy snow showers',95:'thunderstorm',96:'thunderstorm with hail',99:'thunderstorm with heavy hail',
  }
  return map[code] || 'unknown'
}

function wmoToIcon(code: number): string {
  if (code <= 1) return '01d'
  if (code <= 3) return '03d'
  if (code <= 48) return '50d'
  if (code <= 55) return '09d'
  if (code <= 67) return '10d'
  if (code <= 75) return '13d'
  if (code <= 82) return '09d'
  return '11d'
}
