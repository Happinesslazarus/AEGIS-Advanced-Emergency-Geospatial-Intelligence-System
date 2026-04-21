/**
 * Simplified emergency UI mode with extra-large buttons, minimal
 * text, and high-contrast colours. Designed for use on public kiosks
 * or during active evacuations when speed matters.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, Shield, MapPin, Phone, Droplets,
  Wind, Thermometer, Clock, RefreshCw, X, Radio,
  Home, ExternalLink } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/* Safe date formatting -- returns readable string or fallback */
function safeDate(dateStr: string | undefined | null, fallback = 'Unknown'): string {
  if (!dateStr) return fallback
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return fallback
    return d.toLocaleString('en-GB')
  } catch {
    return fallback
  }
}

//Types

interface Alert {
  id: string
  title: string
  description: string
  severity: string
  area: string
  created_at: string
  type?: string
}

interface Shelter {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  capacity: number
  current_occupancy: number
  phone: string | null
}

interface WeatherData {
  temp: number
  description: string
  wind_speed: number
  humidity: number
  icon: string
}

interface Prediction {
  area: string
  probability: number | string
  severity: string
  time_to_flood?: string
}

interface Props {
  onClose?: () => void
}

//Component

export default function PublicSafetyMode({ onClose }: Props): JSX.Element {
  const lang = useLanguage()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [shelters, setShelters] = useState<Shelter[]>([])
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [currentTime, setCurrentTime] = useState<Date>(new Date())

  //Clock tick
  useEffect(() => {
    const tick = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  //Fetch all data from real APIs
  const fetchAll = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      fetch('/api/alerts').then(r => r.ok ? r.json() : []),
      fetch('/api/config/shelters?lat=57.15&lng=-2.11&radius=50').then(r => r.ok ? r.json() : null),
      fetch('/api/weather/current').then(r => r.ok ? r.json() : null),
      fetch('/api/predictions').then(r => r.ok ? r.json() : []),
    ])

    //Alerts -- filter out test/demo alerts
    if (results[0].status === 'fulfilled') {
      const data = results[0].value
      const raw = Array.isArray(data) ? data : data?.alerts || []
      setAlerts(raw.filter((a: any) => {
        const title = (a.title || '').toLowerCase()
        const desc = (a.description || '').toLowerCase()
        return !a.is_test && !title.includes('test') && !title.includes('[test]') && !desc.includes('this is a test')
      }))
    }

    //Shelters
    if (results[1].status === 'fulfilled' && results[1].value?.shelters) {
      setShelters(results[1].value.shelters.slice(0, 6))
    }

    //Weather
    if (results[2].status === 'fulfilled' && results[2].value) {
      setWeather(results[2].value)
    }

    //Predictions
    if (results[3].status === 'fulfilled') {
      const data = results[3].value
      setPredictions(Array.isArray(data) ? data : [])
    }

    setLastUpdated(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    //Auto-refresh every 60 seconds
    const interval = setInterval(fetchAll, 60000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const criticalAlerts = alerts.filter(a =>
    a.severity === 'critical' || a.severity === 'high' || a.severity === 'extreme'
  )
  const otherAlerts = alerts.filter(a =>
    a.severity !== 'critical' && a.severity !== 'high' && a.severity !== 'extreme'
  )
  const highRiskPredictions = predictions.filter(p => {
    const prob = typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability
    return prob >= 0.5
  })

  const severityColor = (s: string): string => {
    switch (s.toLowerCase()) {
      case 'critical': case 'extreme': return 'bg-red-600 text-white'
      case 'high': return 'bg-orange-600 text-white'
      case 'medium': case 'moderate': return 'bg-amber-500 text-black'
      default: return 'bg-blue-600 text-white'
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-gray-950 text-white overflow-auto">
      {/* Header bar */}
      <div className="bg-red-700 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-white" />
          <div>
            <h1 className="text-xl font-black tracking-wide">{'AEGIS PUBLIC SAFETY'}</h1>
            <p className="text-red-200 text-xs font-medium">
              {'Emergency Information Display'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-mono font-bold tabular-nums">
              {currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-xs text-red-200">
              {currentTime.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <button
            onClick={fetchAll}
            className="p-2 hover:bg-red-600 rounded-lg transition"
            title={'Refresh data'}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-red-600 rounded-lg transition"
              title={'Exit Safety Mode'}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/*  Emergency Number Banner  */}
        <div className="bg-red-900/50 border-2 border-red-500 rounded-2xl p-6 text-center">
          <p className="text-lg font-semibold text-red-300 mb-1">{'In a life-threatening emergency, call 999'}</p>
          <p className="text-6xl font-black tracking-widest text-white">999</p>
          <p className="text-sm text-red-300 mt-2">
            <Phone className="w-4 h-4 inline mr-1" />
            {'Emergency Numbers'}
          </p>
        </div>

        {/*  Critical Alerts  */}
        {criticalAlerts.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
              {'Active Alerts'} ({criticalAlerts.length})
            </h2>
            {criticalAlerts.map(alert => (
              <div key={alert.id} className="bg-red-900/40 border border-red-700 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${severityColor(alert.severity)}`}>
                        {alert.severity}
                      </span>
                      {alert.area && <span className="text-sm text-gray-400 dark:text-gray-300"><MapPin className="w-3 h-3 inline" /> {alert.area}</span>}
                    </div>
                    <h3 className="text-xl font-bold text-white">{alert.title}</h3>
                    <p className="text-sm text-gray-300 dark:text-gray-300 mt-1 leading-relaxed">{alert.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-300 mt-2">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {safeDate(alert.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/*  Other Alerts  */}
        {otherAlerts.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-amber-400 flex items-center gap-2">
              <Radio className="w-4 h-4" />
              {'Other warnings'} ({otherAlerts.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {otherAlerts.slice(0, 4).map(alert => (
                <div key={alert.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3 flex items-start gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 ${severityColor(alert.severity)}`}>{alert.severity}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{alert.title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-300 mt-0.5 line-clamp-2">{alert.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/*  No Alerts State  */}
        {alerts.length === 0 && !loading && (
          <div className="bg-green-900/30 border border-green-700 rounded-xl p-6 text-center">
            <Shield className="w-10 h-10 text-green-400 mx-auto mb-2" />
            <p className="text-lg font-bold text-green-300">{'No active alerts -- all clear'}</p>
            <p className="text-sm text-green-400/70">{'All Clear'}</p>
          </div>
        )}

        {/*  Grid: Weather + Predictions + Shelters  */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Weather */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-bold text-blue-400 mb-3 flex items-center gap-1.5">
              <Thermometer className="w-4 h-4" /> {'Current Weather'}
            </h3>
            {weather ? (
              <div className="space-y-2">
                <p className="text-4xl font-bold text-white">{Math.round(weather.temp)}°C</p>
                <p className="text-sm text-gray-300 dark:text-gray-300 capitalize">{weather.description}</p>
                <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-300">
                  <span><Wind className="w-3 h-3 inline mr-1" /> {weather.wind_speed} m/s</span>
                  <span><Droplets className="w-3 h-3 inline mr-1" /> {weather.humidity}%</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-300">{'Weather data loading...'}</p>
            )}
          </div>

          {/* Flood Predictions */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-1.5">
              <Droplets className="w-4 h-4" /> {'Flood Risk Forecast'}
            </h3>
            {highRiskPredictions.length > 0 ? (
              <div className="space-y-2">
                {highRiskPredictions.slice(0, 4).map((p, i) => {
                  const prob = typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability
                  const pct = Math.round(prob * 100)
                  const color = pct >= 75 ? 'text-red-400' : pct >= 50 ? 'text-orange-400' : 'text-yellow-400'
                  return (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-sm text-gray-300 dark:text-gray-300">{p.area}</span>
                      <span className={`text-sm font-bold ${color}`}>{pct}%</span>
                    </div>
                  )
                })}
                {predictions.length > highRiskPredictions.length && (
                  <p className="text-xs text-gray-500 dark:text-gray-300">
                    + {predictions.length - highRiskPredictions.length} {'Lower-risk areas'}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-300">{'No high-risk flood warnings in your area'}</p>
            )}
          </div>

          {/* Emergency Shelters */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-bold text-green-400 mb-3 flex items-center gap-1.5">
              <Home className="w-4 h-4" /> {'Emergency Shelters'}
            </h3>
            {shelters.length > 0 ? (
              <div className="space-y-2">
                {shelters.slice(0, 4).map(s => (
                  <div key={s.id} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{s.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-300">{s.address}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-300 dark:text-gray-300">{s.current_occupancy}/{s.capacity}</p>
                      {s.phone && (
                        <a href={`tel:${s.phone}`} className="text-xs text-blue-400 hover:underline">{s.phone}</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-300">{'No shelters nearby -- dial 999 for help'}</p>
            )}
          </div>
        </div>

        {/*  Safety Guidance Quick Links  */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-bold text-purple-400 mb-3">{'Emergency Resources'}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'GDACS Global Alerts', url: 'https://www.gdacs.org', icon: Droplets },
              { label: 'WMO Severe Weather', url: 'https://severeweather.wmo.int', icon: Wind },
              { label: 'IFRC Disaster Response', url: 'https://www.ifrc.org', icon: Shield },
              { label: 'Local Emergency Services', url: 'tel:112', icon: Phone },
            ].map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-sm text-gray-300 dark:text-gray-300 hover:text-white transition"
              >
                <link.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{link.label}</span>
                <ExternalLink className="w-3 h-3 flex-shrink-0 text-gray-500 dark:text-gray-300" />
              </a>
            ))}
          </div>
        </div>

        {/*  Footer  */}
        <div className="text-center text-xs text-gray-600 py-4 border-t border-gray-800">
          <p>
            {'Last updated'}: {lastUpdated.toLocaleTimeString('en-GB')} |
            {'Auto-refreshes every 30 seconds'} |
            {'Data from official UK sources'}
          </p>
          <p className="mt-1">
            {'AEGIS Emergency Response System'}
          </p>
        </div>
      </div>
    </div>
  )
}

