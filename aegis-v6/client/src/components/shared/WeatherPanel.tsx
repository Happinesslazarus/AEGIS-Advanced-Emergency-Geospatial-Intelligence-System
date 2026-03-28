import { useState, useEffect, useCallback, useRef } from 'react'
import { Cloud, Droplets, Wind, Eye, AlertTriangle, RefreshCw, Loader2, MapPin, Thermometer, Gauge, CloudRain, Sun, Moon, CloudSun, Snowflake, CloudLightning, CloudFog } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { compact?: boolean }

interface WeatherState {
  temperature: number; rainfall: number; windSpeed: number
  visibility: number; condition: string; humidity: number
  weatherCode: number
  warnings: { type: string; message: string }[]
}

const getWeatherIcon = (code: number): React.ElementType => {
  if (code === 0) return Sun
  if (code <= 3) return CloudSun
  if (code <= 49) return CloudFog
  if (code <= 69) return CloudRain
  if (code <= 79) return Snowflake
  if (code >= 95) return CloudLightning
  return Cloud
}

const getWeatherGradient = (code: number): string => {
  if (code === 0) return 'from-amber-400 via-orange-300 to-yellow-200'
  if (code <= 3) return 'from-sky-400 via-blue-300 to-cyan-200'
  if (code <= 49) return 'from-gray-400 via-gray-300 to-slate-200'
  if (code <= 69) return 'from-blue-500 via-blue-400 to-indigo-300'
  if (code <= 79) return 'from-slate-400 via-blue-300 to-blue-200'
  if (code >= 95) return 'from-purple-600 via-indigo-500 to-blue-400'
  return 'from-gray-500 via-gray-400 to-gray-300'
}

const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`)
    if (!res.ok) return `${lat.toFixed(3)}, ${lon.toFixed(3)}`
    const data = await res.json()
    const addr = data?.address || {}
    return addr.city || addr.town || addr.village || addr.state || data?.display_name?.split(',')?.slice(0, 2)?.join(', ') || `${lat.toFixed(3)}, ${lon.toFixed(3)}`
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`
  }
}

export default function WeatherPanel({ compact = false }: Props): JSX.Element {
  const lang = useLanguage()
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [gpsRequesting, setGpsRequesting] = useState(false)
  const [locationLabel, setLocationLabel] = useState(t('weather.enableLocation', lang))
  const fetchAbortRef = useRef<AbortController | null>(null)

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,visibility&timezone=auto`,
        { signal: controller.signal }
      )
      if (!res.ok) throw new Error('Weather API unavailable')
      const data = await res.json()
      const c = data.current

      const warnings: { type: string; message: string }[] = []
      if (c.weather_code >= 95) warnings.push({ type: 'Severe', message: 'Thunderstorm activity detected in area' })
      else if (c.weather_code >= 80) warnings.push({ type: 'Amber', message: 'Heavy rain showers expected — potential surface water flooding' })
      else if (c.weather_code >= 61) warnings.push({ type: 'Yellow', message: 'Persistent rain forecast — monitor water levels' })
      if (c.wind_speed_10m > 60) warnings.push({ type: 'Wind', message: `High winds: ${c.wind_speed_10m.toFixed(0)} km/h — take care near water` })

      setWeather({
        temperature: c.temperature_2m,
        rainfall: c.rain || c.precipitation || 0,
        windSpeed: Math.round(c.wind_speed_10m * 0.621371),
        visibility: (c.visibility || 10000) / 1000,
        condition: getCondition(c.weather_code),
        humidity: c.relative_humidity_2m,
        weatherCode: c.weather_code,
        warnings
      })
      setLastUpdated(new Date())
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(err.message || 'Failed to fetch weather')
        setWeather(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Cancel any in-flight weather request on unmount
  useEffect(() => () => { fetchAbortRef.current?.abort() }, [])

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
      setError(t('weather.gpsNotAvailable', lang))
      return
    }
    setGpsRequesting(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        setUserCoords(coords)
        const place = await reverseGeocode(coords.lat, coords.lon)
        setLocationLabel(place)
        fetchWeather(coords.lat, coords.lon)
        setGpsRequesting(false)
      },
      (err) => {
        if (err.code === 1) setError(t('weather.enableLocationToSee', lang))
        else setError(t('weather.couldNotDetermineLocation', lang))
        setLocationLabel(t('weather.enableLocation', lang))
        setGpsRequesting(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    )
  }

  useEffect(() => {
    requestUserLocation()
  }, [])

  useEffect(() => {
    if (!userCoords) return
    const interval = setInterval(() => {
      fetchWeather(userCoords.lat, userCoords.lon)
    }, 600000)
    return () => clearInterval(interval)
  }, [fetchWeather, userCoords?.lat, userCoords?.lon])

  const w = weather
  const WeatherIcon = w ? getWeatherIcon(w.weatherCode) : Cloud
  const gradient = w ? getWeatherGradient(w.weatherCode) : 'from-gray-400 to-gray-300'

  return (
    <div className="glass-card rounded-2xl overflow-hidden shadow-lg" role="region" aria-label="Weather conditions">
      {/* Header with dynamic weather gradient */}
      <div className={`relative bg-gradient-to-br ${gradient} p-4 pb-10`}>
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Cloud className="w-4 h-4 text-white/80" />
              <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">{t('weather.localConditions', lang)}</span>
            </div>
            <button onClick={requestUserLocation} disabled={gpsRequesting} className="text-left group" title={userCoords ? 'Update location' : 'Use GPS location'}>
              <span className="text-xs flex items-center gap-1 text-white/70 hover:text-white transition-colors">
                {gpsRequesting ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> {t('weather.detecting', lang)}</>
                ) : userCoords ? (
                  <><MapPin className="w-3 h-3 text-green-200" /> {locationLabel} <span className="text-[9px] text-green-200">(GPS)</span></>
                ) : (
                  <><MapPin className="w-3 h-3" /> {t('weather.enableLocationToSee', lang)} <span className="text-[9px] text-white/50">({t('weather.tap', lang)})</span></>
                )}
              </span>
            </button>
          </div>
          <div className="flex items-center gap-1">
            {userCoords && (
              <button onClick={() => { setUserCoords(null); setWeather(null); setLocationLabel(t('weather.enableLocation', lang)) }} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[9px] font-medium transition-all" title={t('weather.resetLocation', lang)}>{t('common.reset', lang)}</button>
            )}
            <button onClick={() => userCoords ? fetchWeather(userCoords.lat, userCoords.lon) : requestUserLocation()} disabled={loading || gpsRequesting} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-all" title={t('common.refresh', lang)}>
              {loading ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-white/80" />}
            </button>
          </div>
        </div>

        {/* Temperature display overlapping bottom */}
        {w && (
          <div className="absolute -bottom-5 left-4 flex items-end gap-3">
            <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl px-4 py-2.5 shadow-xl border border-gray-200/50 dark:border-gray-700/50">
              <WeatherIcon className="w-8 h-8 text-aegis-500" />
              <div>
                <span className="text-3xl font-black text-gray-900 dark:text-white leading-none">{w.temperature}°</span>
                <span className="text-xs text-gray-500 dark:text-gray-300 ml-0.5">C</span>
              </div>
            </div>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-300 mb-1">{w.condition}</span>
          </div>
        )}
      </div>

      {error && !w && <p className="text-xs text-red-500 p-4">{error}</p>}

      {w ? (
        <div className="p-4 pt-8 space-y-3">
          {/* Weather metrics grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Droplets, label: t('weather.rainfall', lang), value: `${w.rainfall.toFixed(1)} mm/hr`, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30' },
              { icon: Wind, label: t('weather.wind', lang), value: `${w.windSpeed} mph`, color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30' },
              { icon: Eye, label: t('weather.visibility', lang), value: `${w.visibility.toFixed(0)} km`, color: 'text-gray-500 dark:text-gray-300', bg: 'bg-gray-50 dark:bg-gray-800/50' },
              { icon: Gauge, label: t('weather.humidity', lang), value: `${w.humidity}%`, color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950/30' },
            ].map(({ icon: Ico, label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-2.5 border border-gray-200/50 dark:border-gray-700/30 hover:scale-[1.02] transition-transform`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Ico className={`w-3.5 h-3.5 ${color}`} />
                  <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider">{label}</span>
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          {/* Warnings */}
          {!compact && w.warnings.map((warn, i) => (
            <div key={i} className={`p-3 rounded-xl border flex items-start gap-2.5 ${warn.type === 'Severe' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50' : warn.type === 'Amber' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800/50'}`}>
              <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${warn.type === 'Severe' ? 'text-red-500' : warn.type === 'Amber' ? 'text-amber-500' : 'text-yellow-500'}`} />
              <div>
                <p className={`text-[10px] font-extrabold uppercase tracking-wider mb-0.5 ${warn.type === 'Severe' ? 'text-red-700 dark:text-red-300' : warn.type === 'Amber' ? 'text-amber-700 dark:text-amber-300' : 'text-yellow-700 dark:text-yellow-300'}`}>{warn.type} {t('weather.warning', lang)}</p>
                <p className={`text-[11px] leading-relaxed ${warn.type === 'Severe' ? 'text-red-600 dark:text-red-400' : warn.type === 'Amber' ? 'text-amber-600 dark:text-amber-400' : 'text-yellow-600 dark:text-yellow-400'}`}>{warn.message}</p>
              </div>
            </div>
          ))}

          {lastUpdated && (
            <p className="text-[9px] text-gray-400 dark:text-gray-300 text-right font-medium">
              {t('weather.updated', lang)}: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-aegis-500 animate-spin" />
          <span className="text-xs text-gray-400 dark:text-gray-300 ml-2">{t('weather.loadingWeather', lang)}</span>
        </div>
      ) : (
        <div className="p-4 text-center">
          <button onClick={requestUserLocation} className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-600 dark:text-aegis-400 hover:text-aegis-500 transition-colors">
            <MapPin className="w-3.5 h-3.5" />
            {t('weather.enableLocationToSee', lang)}
          </button>
        </div>
      )}
    </div>
  )
}
