/**
 * Module: WeatherPanel.tsx
 *
 * Advanced weather intelligence panel — fetches live data from the Open-Meteo API
 * (no API key required) for the user's GPS location. Includes hourly forecast,
 * feels-like temperature, UV index, pressure, dew point, wind direction compass,
 * sunrise/sunset, and multi-level warning system.
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Cloud, Droplets, Wind, Eye, RefreshCw, Loader2, MapPin,
  Thermometer, Gauge, CloudRain, Sun, CloudSun, Snowflake, CloudLightning,
  CloudFog, Compass, ArrowDown, ArrowUp, Sunrise, Sunset, ShieldAlert,
  TrendingUp, TrendingDown, ChevronDown, ChevronUp, Activity, Navigation,
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { compact?: boolean }

interface HourlyPoint { time: string; temp: number; code: number; precip: number; windSpeed: number }

interface WeatherState {
  temperature: number; feelsLike: number; rainfall: number; windSpeed: number; windDir: number
  visibility: number; condition: string; humidity: number; weatherCode: number
  pressure: number; dewPoint: number; uvIndex: number
  sunrise: string; sunset: string
  tempMin: number; tempMax: number
  hourly: HourlyPoint[]
  warnings: { type: string; message: string; severity: number }[]
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

function getCondition(code: number): string {
  if (code === 0) return 'Clear Sky'
  if (code <= 2) return 'Partly Cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 49) return 'Foggy'
  if (code <= 55) return 'Light Drizzle'
  if (code <= 59) return 'Drizzle'
  if (code <= 63) return 'Moderate Rain'
  if (code <= 69) return 'Heavy Rain'
  if (code <= 75) return 'Snow'
  if (code <= 79) return 'Snow Grains'
  if (code <= 82) return 'Rain Showers'
  if (code <= 86) return 'Snow Showers'
  if (code <= 94) return 'Freezing Rain'
  return 'Thunderstorm'
}

function windDirection(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

function uvLabel(uv: number): { text: string; color: string } {
  if (uv <= 2) return { text: 'Low', color: 'text-green-500' }
  if (uv <= 5) return { text: 'Moderate', color: 'text-yellow-500' }
  if (uv <= 7) return { text: 'High', color: 'text-orange-500' }
  if (uv <= 10) return { text: 'Very High', color: 'text-red-500' }
  return { text: 'Extreme', color: 'text-purple-500' }
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '--:--' }
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
  const [showHourly, setShowHourly] = useState(false)
  const fetchAbortRef = useRef<AbortController | null>(null)

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,visibility,pressure_msl,dew_point_2m,uv_index` +
        `&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
        `&timezone=auto&forecast_days=1`,
        { signal: controller.signal }
      )
      if (!res.ok) throw new Error('Weather API unavailable')
      const data = await res.json()
      const c = data.current
      const d = data.daily

      const warnings: { type: string; message: string; severity: number }[] = []
      if (c.weather_code >= 95) warnings.push({ type: 'Severe', message: 'Thunderstorm activity detected — seek shelter immediately', severity: 4 })
      else if (c.weather_code >= 80) warnings.push({ type: 'Amber', message: 'Heavy rain showers expected — potential surface water flooding', severity: 3 })
      else if (c.weather_code >= 61) warnings.push({ type: 'Yellow', message: 'Persistent rain forecast — monitor water levels', severity: 2 })
      if (c.wind_speed_10m > 80) warnings.push({ type: 'Severe', message: `Dangerous winds: ${c.wind_speed_10m.toFixed(0)} km/h — stay indoors`, severity: 4 })
      else if (c.wind_speed_10m > 60) warnings.push({ type: 'Wind', message: `High winds: ${c.wind_speed_10m.toFixed(0)} km/h — take care outdoors`, severity: 2 })
      if (c.uv_index >= 8) warnings.push({ type: 'UV', message: `UV Index ${c.uv_index.toFixed(0)} — extreme sun exposure risk`, severity: 3 })
      if (c.visibility < 1000) warnings.push({ type: 'Fog', message: 'Very low visibility — travel with extreme caution', severity: 2 })
      if (c.temperature_2m > 40) warnings.push({ type: 'Heat', message: `Extreme heat: ${c.temperature_2m}°C — heat stroke risk`, severity: 4 })
      else if (c.temperature_2m < -10) warnings.push({ type: 'Cold', message: `Extreme cold: ${c.temperature_2m}°C — frostbite risk`, severity: 3 })
      warnings.sort((a, b) => b.severity - a.severity)

      const nowHour = new Date().getHours()
      const hourly: HourlyPoint[] = []
      const ht = data.hourly
      for (let i = nowHour; i < Math.min(nowHour + 12, (ht?.time?.length || 0)); i++) {
        hourly.push({ time: ht.time[i], temp: ht.temperature_2m[i], code: ht.weather_code[i], precip: ht.precipitation_probability[i], windSpeed: ht.wind_speed_10m[i] })
      }

      setWeather({
        temperature: c.temperature_2m,
        feelsLike: c.apparent_temperature,
        rainfall: c.rain || c.precipitation || 0,
        windSpeed: c.wind_speed_10m,
        windDir: c.wind_direction_10m || 0,
        visibility: (c.visibility || 10000) / 1000,
        condition: getCondition(c.weather_code),
        humidity: c.relative_humidity_2m,
        weatherCode: c.weather_code,
        pressure: c.pressure_msl || 1013,
        dewPoint: c.dew_point_2m || 0,
        uvIndex: c.uv_index || 0,
        sunrise: d?.sunrise?.[0] || '',
        sunset: d?.sunset?.[0] || '',
        tempMin: d?.temperature_2m_min?.[0] ?? c.temperature_2m,
        tempMax: d?.temperature_2m_max?.[0] ?? c.temperature_2m,
        hourly,
        warnings,
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

  useEffect(() => () => { fetchAbortRef.current?.abort() }, [])

  const requestUserLocation = () => {
    if (!('geolocation' in navigator)) { setError(t('weather.gpsNotAvailable', lang)); return }
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

  useEffect(() => { requestUserLocation() }, [])

  useEffect(() => {
    if (!userCoords) return
    const interval = setInterval(() => { fetchWeather(userCoords.lat, userCoords.lon) }, 600000)
    return () => clearInterval(interval)
  }, [fetchWeather, userCoords?.lat, userCoords?.lon])

  const w = weather
  const WeatherIcon = w ? getWeatherIcon(w.weatherCode) : Cloud
  const gradient = w ? getWeatherGradient(w.weatherCode) : 'from-gray-400 to-gray-300'
  const uv = w ? uvLabel(w.uvIndex) : { text: '--', color: 'text-gray-400' }

  const pressureTrend = useMemo(() => {
    if (!w) return ''
    if (w.pressure > 1020) return 'High (stable)'
    if (w.pressure < 1000) return 'Low (storms)'
    return 'Normal'
  }, [w])

  return (
    <div className="glass-card rounded-2xl overflow-hidden shadow-lg" role="region" aria-label="Weather conditions">
      {/* Hero gradient header */}
      <div className={`relative bg-gradient-to-br ${gradient} p-4 pb-12`}>
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-3.5 h-3.5 text-white/80" />
              <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">{t('weather.localConditions', lang)}</span>
              <span className="text-[8px] bg-white/20 text-white px-1.5 py-0.5 rounded-full font-bold">LIVE</span>
            </div>
            <button onClick={requestUserLocation} disabled={gpsRequesting} className="text-left group" title={userCoords ? 'Update location' : 'Use GPS location'}>
              <span className="text-xs flex items-center gap-1 text-white/70 hover:text-white transition-colors">
                {gpsRequesting ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> {t('weather.detecting', lang)}</>
                ) : userCoords ? (
                  <><MapPin className="w-3 h-3 text-green-200" /> {locationLabel}</>
                ) : (
                  <><MapPin className="w-3 h-3" /> {t('weather.enableLocationToSee', lang)}</>
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

        {/* Temperature hero card overlapping bottom */}
        {w && (
          <div className="absolute -bottom-7 left-4 right-4 flex items-end justify-between">
            <div className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-2xl px-4 py-3 shadow-xl border border-gray-200/50 dark:border-gray-700/50">
              <WeatherIcon className="w-9 h-9 text-aegis-500" />
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-gray-900 dark:text-white leading-none">{Math.round(w.temperature)}°</span>
                  <span className="text-xs text-gray-400 dark:text-gray-300">C</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{w.condition}</span>
                  <span className="text-[9px] text-gray-400">Feels {Math.round(w.feelsLike)}°</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-white/90 dark:bg-gray-900/90 rounded-xl shadow-lg text-[10px] font-bold mb-0.5">
              <span className="flex items-center gap-0.5 text-blue-500"><ArrowDown className="w-3 h-3" />{Math.round(w.tempMin)}°</span>
              <span className="flex items-center gap-0.5 text-red-500"><ArrowUp className="w-3 h-3" />{Math.round(w.tempMax)}°</span>
            </div>
          </div>
        )}
      </div>

      {error && !w && <p className="text-xs text-red-500 p-4">{error}</p>}

      {w ? (
        <div className="p-4 pt-10 space-y-3">
          {/* Primary metrics grid */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Droplets, label: t('weather.rainfall', lang), value: `${w.rainfall.toFixed(1)} mm`, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30' },
              { icon: Wind, label: t('weather.wind', lang), value: `${Math.round(w.windSpeed)} km/h`, color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30' },
              { icon: Eye, label: t('weather.visibility', lang), value: `${w.visibility.toFixed(0)} km`, color: 'text-gray-500 dark:text-gray-300', bg: 'bg-gray-50 dark:bg-gray-800/50' },
              { icon: Gauge, label: t('weather.humidity', lang), value: `${w.humidity}%`, color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950/30' },
              { icon: Thermometer, label: 'Dew Point', value: `${Math.round(w.dewPoint)}°C`, color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/30' },
              { icon: Compass, label: 'Pressure', value: `${Math.round(w.pressure)} hPa`, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-950/30' },
            ].map(({ icon: Ico, label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-2 border border-gray-200/50 dark:border-gray-700/30 hover:scale-[1.02] transition-transform`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <Ico className={`w-3 h-3 ${color}`} />
                  <span className="text-[8px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider">{label}</span>
                </div>
                <p className="text-xs font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          {/* Wind compass + UV + Sunrise/Sunset strip */}
          <div className="flex items-center gap-2">
            {/* Wind direction */}
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-2 border border-gray-200/50 dark:border-gray-700/30 flex items-center gap-2">
              <div className="relative w-8 h-8 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-gray-300 dark:border-gray-600" />
                <Navigation className="w-4 h-4 text-teal-500" style={{ transform: `rotate(${w.windDir}deg)` }} />
              </div>
              <div>
                <p className="text-[8px] font-bold text-gray-400 dark:text-gray-300 uppercase">Wind Dir</p>
                <p className="text-xs font-bold text-gray-900 dark:text-white">{windDirection(w.windDir)} {Math.round(w.windDir)}°</p>
              </div>
            </div>

            {/* UV Index */}
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-2 border border-gray-200/50 dark:border-gray-700/30">
              <p className="text-[8px] font-bold text-gray-400 dark:text-gray-300 uppercase">UV Index</p>
              <div className="flex items-center gap-1.5">
                <Sun className={`w-3.5 h-3.5 ${uv.color}`} />
                <span className="text-xs font-bold text-gray-900 dark:text-white">{w.uvIndex.toFixed(0)}</span>
                <span className={`text-[9px] font-semibold ${uv.color}`}>{uv.text}</span>
              </div>
            </div>

            {/* Sunrise / Sunset */}
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-2 border border-gray-200/50 dark:border-gray-700/30">
              <div className="flex items-center gap-1 text-[9px]">
                <Sunrise className="w-3 h-3 text-amber-400" />
                <span className="font-bold text-gray-900 dark:text-white">{formatTime(w.sunrise)}</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] mt-0.5">
                <Sunset className="w-3 h-3 text-orange-400" />
                <span className="font-bold text-gray-900 dark:text-white">{formatTime(w.sunset)}</span>
              </div>
            </div>
          </div>

          {/* Pressure trend */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-200/50 dark:border-gray-700/30">
            <Gauge className="w-3 h-3 text-violet-500" />
            <span className="text-[9px] text-gray-500 dark:text-gray-400">Barometric trend:</span>
            <span className="text-[9px] font-bold text-gray-900 dark:text-white">{pressureTrend}</span>
            {w.pressure < 1000 && <TrendingDown className="w-3 h-3 text-red-400" />}
            {w.pressure > 1020 && <TrendingUp className="w-3 h-3 text-green-400" />}
          </div>

          {/* Hourly forecast (expandable) */}
          {!compact && w.hourly.length > 0 && (
            <div>
              <button onClick={() => setShowHourly(h => !h)} className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">12-Hour Forecast</span>
                {showHourly ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {showHourly && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 mt-1 no-scrollbar">
                  {w.hourly.map((h, i) => {
                    const HIcon = getWeatherIcon(h.code)
                    return (
                      <div key={i} className="flex-shrink-0 w-14 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-1.5 text-center border border-gray-200/50 dark:border-gray-700/30">
                        <p className="text-[9px] font-bold text-gray-400 dark:text-gray-300">{formatTime(h.time)}</p>
                        <HIcon className="w-4 h-4 mx-auto my-0.5 text-aegis-500" />
                        <p className="text-[10px] font-bold text-gray-900 dark:text-white">{Math.round(h.temp)}°</p>
                        {h.precip > 0 && (
                          <div className="flex items-center justify-center gap-0.5 mt-0.5">
                            <Droplets className="w-2 h-2 text-blue-400" />
                            <span className="text-[8px] text-blue-500 font-bold">{h.precip}%</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Warnings */}
          {!compact && w.warnings.map((warn, i) => (
            <div key={i} className={`p-3 rounded-xl border flex items-start gap-2.5 ${warn.severity >= 4 ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50' : warn.severity >= 3 ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800/50'}`}>
              <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${warn.severity >= 4 ? 'text-red-500' : warn.severity >= 3 ? 'text-amber-500' : 'text-yellow-500'}`} />
              <div>
                <p className={`text-[10px] font-extrabold uppercase tracking-wider mb-0.5 ${warn.severity >= 4 ? 'text-red-700 dark:text-red-300' : warn.severity >= 3 ? 'text-amber-700 dark:text-amber-300' : 'text-yellow-700 dark:text-yellow-300'}`}>{warn.type} {t('weather.warning', lang)}</p>
                <p className={`text-[11px] leading-relaxed ${warn.severity >= 4 ? 'text-red-600 dark:text-red-400' : warn.severity >= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-yellow-600 dark:text-yellow-400'}`}>{warn.message}</p>
              </div>
            </div>
          ))}

          {lastUpdated && (
            <p className="text-[9px] text-gray-400 dark:text-gray-300 text-right font-medium">
              {t('weather.updated', lang)}: {lastUpdated.toLocaleTimeString()} {userCoords && <span className="text-gray-300 dark:text-gray-500">({userCoords.lat.toFixed(2)}, {userCoords.lon.toFixed(2)})</span>}
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
