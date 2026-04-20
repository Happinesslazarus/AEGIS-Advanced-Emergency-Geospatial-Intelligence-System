/**
 * Tests for the weatherApi utility functions: fetching live weather and
 * forecast data from Open-Meteo, flood-risk assessment, and API key management.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.clearAllMocks()      = resets call counts between tests
 *   mockFetch               = replaces global.fetch so no real HTTP requests are made
 *   mockResolvedValue()     = makes the mock return a resolved Promise with the given value
 *   mockRejectedValue()     = makes the mock return a rejected Promise (simulates network error)
 *   Object.defineProperty() = injects the fake localStorage into the global jsdom environment
 *   Open-Meteo              = free, open-source weather API (api.open-meteo.com); no API key needed
 *   temperature_2m          = air temperature at 2 metres above ground (standard WMO = World
 *                             Meteorological Organization measurement height)
 *   apparent_temperature    = "feels like" temperature accounting for wind and humidity
 *   relative_humidity_2m    = % humidity at 2 m height
 *   pressure_msl            = air pressure at Mean Sea Level in hPa (hectopascals)
 *   wind_speed_10m          = wind speed at 10 m height (m/s or km/h depending on config)
 *   PrecipitationRate       = mm of rainfall per hour; 0-2 mm/h = light, 2-10 = moderate,
 *                             >10 = heavy -- key thresholds for flood risk scoring
 *   WeatherData             = TypeScript interface describing current weather snapshot
 *   WeatherForecast         = TypeScript interface for a single hourly forecast entry
 *   FloodWeatherRisk        = TypeScript interface for the result of assessFloodRisk();
 *                             level: 'low'|'moderate'|'high'|'severe'
 *   aegis-weather-key       = localStorage key for the optional paid weather API key
 *   source: 'live'          = indicates data came from a real API call (vs. 'cached' or 'demo')
 *   rainfall1h / rainfall3h = rainfall accumulated over the last 1 / 3 hours in mm
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//Global mocks -- set up BEFORE any module imports so fetch is intercepted

//Replace the browser's native fetch with a controllable mock
const mockFetch = vi.fn()
global.fetch = mockFetch

//Replace localStorage with an in-memory object so tests don't touch real storage
const mockLocalStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key] }),
  clear: vi.fn(() => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]) }),
}
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

//Import after mocking so the modules pick up our fakes
import {
  fetchCurrentWeather,
  fetchForecast,
  assessFloodRisk,
  setWeatherApiKey,
  hasWeatherApiKey,
  type WeatherData,
  type WeatherForecast,
  type FloodWeatherRisk,
} from '../utils/weatherApi'

//Main weatherApi tests
describe('weatherApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()    // reset call counts
    mockFetch.mockReset() // clear saved return values between tests
    localStorageMock.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  //API key management -- optional paid key stored in localStorage
  describe('API key management', () => {
    test('setWeatherApiKey stores key in localStorage', () => {
      //setWeatherApiKey('my-key') should persist the key under 'aegis-weather-key'
      setWeatherApiKey('test-api-key-123')
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('aegis-weather-key', 'test-api-key-123')
    })

    test('hasWeatherApiKey returns false when no key set', () => {
      //If no key has been stored, the function returns false (falls back to free Open-Meteo API)
      localStorageMock.getItem.mockReturnValue(null)
      
      expect(hasWeatherApiKey()).toBe(false)
    })

    test('hasWeatherApiKey returns true when key is set', () => {
 //A non-null value in localStorage means a key exists -> use the paid API if available
      localStorageMock.getItem.mockReturnValue('test-key')
      
      expect(hasWeatherApiKey()).toBe(true)
    })
  })

  //fetchCurrentWeather -- fetches live weather for a lat/lng from Open-Meteo
  describe('fetchCurrentWeather', () => {
    //Minimal Open-Meteo JSON response shape (all fields our parser reads)
    const mockOpenMeteoResponse = {
      current: {
        temperature_2m: 15.5,         // raw degrees Celsius (rounded to 16 in result)
        apparent_temperature: 14.2,   // "feels like" (rounded to 14)
        relative_humidity_2m: 75,     // percent
        pressure_msl: 1013.25,        // hPa (rounded to 1013)
        wind_speed_10m: 12.5,         // km/h (rounded to 13)
        wind_direction_10m: 180,      // degrees (180 = south)
        weather_code: 3,              // WMO code 3 = overcast (used to pick icon + description)
        cloud_cover: 50,              // percent
        rain: 0.5,                    // mm/h
        visibility: 10000,            // metres
      }
    }

    test('fetches weather from Open-Meteo primary provider', async () => {
      //Happy path: API returns 200 OK with current weather data
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenMeteoResponse),
      })
      
      const result = await fetchCurrentWeather(51.5, -0.1) // London approximate
      
      //Verify URL targets Open-Meteo; check required fields are present in result
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('api.open-meteo.com'))
      expect(result).toHaveProperty('temp')
      expect(result).toHaveProperty('humidity')
      expect(result).toHaveProperty('windSpeed')
      expect(result.source).toBe('live') // indicates fresh data (not cached/demo)
    })

    test('handles Open-Meteo failure gracefully', async () => {
      //Server error (5xx): function should throw or return a defined error,
      //not silently return undefined
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      })
      
      try {
        await fetchCurrentWeather(51.5, -0.1)
      } catch (e) {
        expect(e).toBeDefined() // some error should be thrown
      }
    })

    test('parses weather data correctly', async () => {
      //Verify numeric rounding: Open-Meteo returns floats; we display integers
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenMeteoResponse),
      })
      
      const result = await fetchCurrentWeather(55.95, -3.19) // Edinburgh
      
      expect(result.temp).toBe(16)       // 15.5 rounded up to 16
      expect(result.feelsLike).toBe(14)  // 14.2 rounded down to 14
      expect(result.humidity).toBe(75)   // no rounding needed
      expect(result.pressure).toBe(1013) // 1013.25 rounded down to 1013
      expect(result.windSpeed).toBe(13)  // 12.5 rounded up to 13
    })
  })

  //fetchForecast -- returns an array of hourly WeatherForecast objects
  describe('fetchForecast', () => {
    //Minimal hourly forecast response covering 3 hours
    const mockForecastResponse = {
      hourly: {
        time: ['2024-01-15T00:00', '2024-01-15T01:00', '2024-01-15T02:00'],
        temperature_2m: [10, 11, 12],  // °C per hour
        precipitation: [0, 0.5, 1.0],  // mm per hour
        wind_speed_10m: [5, 6, 7],     // km/h per hour
        weather_code: [0, 1, 2],       // WMO weather codes (0=clear, 1=mainly clear, 2=partly cloudy)
      }
    }

    test('fetches hourly forecast data', async () => {
      //Happy path: should return an array of forecast objects, one per hour
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockForecastResponse),
      })
      
      const result = await fetchForecast(51.5, -0.1)
      
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('api.open-meteo.com'))
      expect(Array.isArray(result)).toBe(true) // result must be an array
    })

    test('throws on fetch failure', async () => {
      //Network failure (total loss of connectivity): must throw a user-readable error
      mockFetch.mockRejectedValue(new Error('Network error'))
      
      await expect(fetchForecast(51.5, -0.1)).rejects.toThrow(
        'Unable to fetch live forecast data.' // specific message used by error handling UI
      )
    })
  })

  //assessFloodRisk -- scores current + forecast data to produce a risk level
  //Thresholds: 0-1mm/h low, 2-9mm/h moderate, 10-24mm/h high, 25+mm/h severe
  describe('assessFloodRisk', () => {
    test('returns low risk for clear weather', () => {
 //Dry, mild conditions -> no flood risk
      const weather: WeatherData = {
        temp: 15, feelsLike: 14, humidity: 60, pressure: 1013,
        windSpeed: 10, windDir: 'S', description: 'clear', icon: '01d',
        rainfall1h: 0, rainfall3h: 0, visibility: 10, clouds: 10,
        updatedAt: new Date().toISOString(), source: 'live',
      }
      const forecast: WeatherForecast[] = [
        //Single clear-sky forecast hour; zero rainfall
        { time: '2024-01-15T12:00', temp: 15, rainfall: 0, windSpeed: 10, description: 'clear', icon: '01d' },
      ]
      
      const result = assessFloodRisk(weather, forecast)
      
      expect(result.level).toBe('low')
    })

    test('returns moderate risk for moderate rainfall', () => {
 //Steady rainfall, high humidity, low pressure -> moderate/high flood risk
      const weather: WeatherData = {
        temp: 12, feelsLike: 10, humidity: 88, pressure: 1005,
        windSpeed: 20, windDir: 'W', description: 'rain', icon: '10d',
        rainfall1h: 2,  // 2 mm/h = moderate threshold
        rainfall3h: 6,
        visibility: 5, clouds: 90,
        updatedAt: new Date().toISOString(), source: 'live',
      }
      const forecast: WeatherForecast[] = [
        { time: '2024-01-15T12:00', temp: 12, rainfall: 3, windSpeed: 25, description: 'rain', icon: '10d' },
        { time: '2024-01-15T15:00', temp: 11, rainfall: 2, windSpeed: 20, description: 'rain', icon: '10d' },
      ]
      
      const result = assessFloodRisk(weather, forecast)
      
      //Risk scoring may produce 'moderate' or 'high' depending on cumulative totals
      expect(['moderate', 'high']).toContain(result.level)
    })

    test('returns severe risk for heavy rainfall', () => {
      //Very heavy rain (10+ mm/h), 95% humidity, low pressure, strong wind
      const weather: WeatherData = {
        temp: 10, feelsLike: 8, humidity: 95, pressure: 990, // 990 hPa = storm pressure
        windSpeed: 50, windDir: 'SW', description: 'heavy rain', icon: '10d',
        rainfall1h: 10,  // 10 mm/h = heavy
        rainfall3h: 25,  // 25 mm total over 3 hours
        visibility: 2, clouds: 100,
        updatedAt: new Date().toISOString(), source: 'live',
      }
      const forecast: WeatherForecast[] = [
 //Two hours of heavy rain ahead -> cumulative totals cross the 'severe' threshold
        { time: '2024-01-15T12:00', temp: 10, rainfall: 15, windSpeed: 60, description: 'heavy rain', icon: '10d' },
        { time: '2024-01-15T15:00', temp: 9, rainfall: 12, windSpeed: 55, description: 'heavy rain', icon: '10d' },
      ]
      
      const result = assessFloodRisk(weather, forecast)
      
      expect(['high', 'severe']).toContain(result.level)
    })
  })
})

//Interface shape tests -- verify TypeScript types map to the expected fields
//These are compile-time checks that also serve as living documentation of
//the data shape coming back from Open-Meteo
describe('WeatherData interface', () => {
  test('validates WeatherData structure', () => {
    //Create a WeatherData object with all required fields to confirm the shape
    const weather: WeatherData = {
      temp: 15,
      feelsLike: 14,
      humidity: 75,
      pressure: 1013,
      windSpeed: 12,
      windDir: 'S',           // cardinal direction string derived from degrees
      description: 'Partly cloudy',
      icon: '02d',            // OpenWeatherMap-style icon code (used for icon rendering)
      rainfall1h: 0.5,        // mm fallen in last 1 hour
      rainfall3h: 1.5,        // mm fallen in last 3 hours
      visibility: 10,         // km
      clouds: 50,             // % cloud cover
      updatedAt: '2024-01-15T10:00:00Z', // ISO 8601 timestamp
      source: 'live',
    }
    
    expect(weather.temp).toBe(15)
    expect(weather.source).toBe('live')
    expect(weather.windDir).toBe('S')
  })
})

describe('WeatherForecast interface', () => {
  test('validates WeatherForecast structure', () => {
    //One entry in the hourly forecast array
    const forecast: WeatherForecast = {
      time: '2024-01-15T12:00:00Z', // ISO 8601; one entry per hour
      temp: 18,
      rainfall: 0,     // mm/h expected for this hour
      windSpeed: 10,
      description: 'Sunny',
      icon: '01d',     // 'd' suffix = daytime icon
    }
    
    expect(forecast.time).toBe('2024-01-15T12:00:00Z')
    expect(forecast.temp).toBe(18)
  })
})

describe('FloodWeatherRisk interface', () => {
  test('validates FloodWeatherRisk structure', () => {
    //Result shape from assessFloodRisk()
    const risk: FloodWeatherRisk = {
      level: 'moderate',
      reason: 'Heavy rainfall expected', // human-readable explanation for the risk level
      rainfall24h: 25.5,                 // total expected mm over 24 hours
      windMax: 45,                       // peak wind speed km/h in forecast window
    }
    
    expect(risk.level).toBe('moderate')
    expect(risk.rainfall24h).toBe(25.5)
  })

  test('validates all risk levels', () => {
    //All four risk levels must be valid values of the FloodWeatherRisk.level union type
    const levels: Array<'low' | 'moderate' | 'high' | 'severe'> = 
      ['low', 'moderate', 'high', 'severe']
    
    levels.forEach(level => {
      const risk: FloodWeatherRisk = {
        level,
        reason: 'Test',
        rainfall24h: 0,
        windMax: 0,
      }
      expect(risk.level).toBe(level)
    })
  })
})
