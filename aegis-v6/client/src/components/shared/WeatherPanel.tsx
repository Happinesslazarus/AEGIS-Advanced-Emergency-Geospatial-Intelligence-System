import { useState, useEffect } from 'react'
import { Cloud, Droplets, Wind, Eye, AlertTriangle, RefreshCw, Loader2, MapPin } from 'lucide-react'

interface Props { compact?: boolean }

interface WeatherState {
  temperature: number; rainfall: number; windSpeed: number
  visibility: number; condition: string; humidity: number
  warnings: { type: string; message: string }[]
}

// Aberdeen coordinates — default
const DEFAULT_LAT = 57.1497
const DEFAULT_LON = -2.0943

export default function WeatherPanel({ compact = false }: Props): JSX.Element {
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [gpsRequesting, setGpsRequesting] = useState(false)

  const fetchWeather = async (lat = DEFAULT_LAT, lon = DEFAULT_LON) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,visibility&timezone=Europe%2FLondon`
      )
      if (!res.ok) throw new Error('Weather API unavailable')
      const data = await res.json()
      const c = data.current

      // Derive warnings from weather code
      const warnings: { type: string; message: string }[] = []
      if (c.weather_code >= 95) warnings.push({ type: 'Severe', message: 'Thunderstorm activity detected in area' })
      else if (c.weather_code >= 80) warnings.push({ type: 'Amber', message: 'Heavy rain showers expected — potential surface water flooding' })
      else if (c.weather_code >= 61) warnings.push({ type: 'Yellow', message: 'Persistent rain forecast — monitor water levels' })
      if (c.wind_speed_10m > 60) warnings.push({ type: 'Wind', message: `High winds: ${c.wind_speed_10m.toFixed(0)} km/h — take care near water` })

      setWeather({
        temperature: c.temperature_2m,
        rainfall: c.rain || c.precipitation || 0,
        windSpeed: Math.round(c.wind_speed_10m * 0.621371), // km/h → mph
        visibility: (c.visibility || 10000) / 1000, // m → km
        condition: getCondition(c.weather_code),
        humidity: c.relative_humidity_2m,
        warnings
      })
      setLastUpdated(new Date())
    } catch (err: any) {
      setError(err.message || 'Failed to fetch weather')
      setWeather(null)
    } finally {
      setLoading(false)
    }
  }

  const getCondition = (code: number): string => {
    if (code === 0) return 'Clear'
    if (code <= 3) return 'Partly Cloudy'
    if (code <= 49) return 'Foggy'
    if (code <= 59) return 'Drizzle'
    if (code <= 69) return 'Rain'
    if (code <= 79) return 'Snow'
    if (code <= 84) return 'Heavy Showers'
    if (code <= 94) return 'Snow Showers'
    return 'Thunderstorm'
  }

  const requestUserLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('GPS not available on this device')
      return
    }
    setGpsRequesting(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        setUserCoords(coords)
        fetchWeather(coords.lat, coords.lon)
        setGpsRequesting(false)
      },
      (err) => {
        if (err.code === 1) setError('Location permission denied')
        else setError('Could not determine location')
        setGpsRequesting(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    )
  }

  useEffect(() => {
    // Load with default location (Aberdeen) - NO auto GPS request
    fetchWeather()
    // Auto-refresh every 10 minutes using current coordinates
    const interval = setInterval(() => {
      if (userCoords) fetchWeather(userCoords.lat, userCoords.lon)
      else fetchWeather()
    }, 600000)
    return () => clearInterval(interval)
  }, [])

  const w = weather

  return (
    <div className="card p-4" role="region" aria-label="Weather conditions">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-500" />
            Local Conditions
            {w && <span className="text-xs font-normal text-gray-400 ml-1">{w.temperature}°C · {w.condition}</span>}
          </h3>
          <button onClick={requestUserLocation} disabled={gpsRequesting} className="text-left group mt-0.5" title={userCoords ? 'Update my location' : 'Use my location for weather'}>
            <span className="text-xs flex items-center gap-1 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
              {gpsRequesting ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Detecting location…</>
              ) : userCoords ? (
                <><MapPin className="w-3 h-3 text-green-500" /> Your Location <span className="text-[9px] text-green-500">(GPS)</span></>
              ) : (
                <><MapPin className="w-3 h-3 text-blue-400 group-hover:text-blue-600 transition-colors" /> Aberdeen <span className="text-[9px] text-blue-400 group-hover:text-blue-600 transition-colors">(tap for GPS)</span></>
              )}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          {userCoords && (
            <button onClick={() => { setUserCoords(null); fetchWeather() }} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors text-[9px] font-medium" title="Reset to default location">Reset</button>
          )}
          <button onClick={() => userCoords ? fetchWeather(userCoords.lat, userCoords.lon) : fetchWeather()} disabled={loading} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Refresh weather">
            {loading ? <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-gray-400" />}
          </button>
        </div>
      </div>

      {error && !w && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {w ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between p-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
            <span className="flex items-center gap-2 text-sm"><Droplets className="w-4 h-4 text-blue-500" /> Rainfall</span>
            <span className="font-bold text-sm text-blue-700 dark:text-blue-300">{w.rainfall.toFixed(1)} mm/hr</span>
          </div>
          <div className="flex items-center justify-between p-2.5 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
            <span className="flex items-center gap-2 text-sm"><Wind className="w-4 h-4 text-amber-500" /> Wind</span>
            <span className="font-bold text-sm text-amber-700 dark:text-amber-300">{w.windSpeed} mph</span>
          </div>
          <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <span className="flex items-center gap-2 text-sm"><Eye className="w-4 h-4 text-gray-500" /> Visibility</span>
            <span className="font-bold text-sm text-gray-700 dark:text-gray-300">{w.visibility.toFixed(0)} km</span>
          </div>
          {!compact && w.warnings.map((warn, i) => (
            <div key={i} className="p-2.5 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-xs font-semibold text-red-800 dark:text-red-300 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {warn.type} Warning</p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{warn.message}</p>
            </div>
          ))}
          {lastUpdated && <p className="text-[9px] text-gray-400 text-right mt-1">Updated: {lastUpdated.toLocaleTimeString()}</p>}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /><span className="text-xs text-gray-400 ml-2">Loading weather...</span></div>
      ) : null}
    </div>
  )
}
