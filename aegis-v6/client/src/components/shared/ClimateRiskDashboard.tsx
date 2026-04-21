/**
 * Full-page climate risk overview with line charts for temperature and
 * rainfall trends, a regional risk heat-map, and summary cards for each
 * hazard category. Fetches data from /api/climate.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TrendingUp, AlertTriangle, Droplets,
  Thermometer, BarChart3, Activity, RefreshCw,
  Shield, ArrowUpRight, ArrowDownRight, Minus,
  MapPin, Cpu } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { apiFetch } from '../../utils/api'

//Types

interface Prediction {
  area: string
  probability: number | string
  severity: string
  confidence: number | string
  time_to_flood?: string
  model_version?: string
  contributing_factors?: Array<{ factor: string; value: number; importance: number; unit?: string }>
}

interface Alert {
  id: string
  severity: string
  type?: string
  created_at: string
}

interface WeatherData {
  temperature: number
  description: string
  windSpeed: number
  humidity: number
  pressure?: number
  rain?: number
}

interface ReportSummary {
  total: number
  high: number
  medium: number
  low: number
  last24h: number
}

interface Props {
  className?: string
}

//Risk Score Computation

 /*
 * Compute an overall risk score (0-100) from live data inputs.
 * This is a transparent, deterministic algorithm -- not a black box.
 * Weights:
 * Flood predictions: 40% (highest probability × 100)
 * Active alerts: 25% (scaled by severity)
 * Weather conditions: 20% (rain, wind, humidity)
 * Report density: 15% (recent reports indicate active situations)
  */
function computeRiskScore(
  predictions: Prediction[],
  alerts: Alert[],
  weather: WeatherData | null,
  reports: ReportSummary,
): { score: number; trend: 'rising' | 'falling' | 'stable'; breakdown: Record<string, number> } {
  //Prediction component (0-100, weight 40%)
  const maxProb = predictions.reduce((max, p) => {
    const prob = typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability
    return Math.max(max, prob || 0)
  }, 0)
  const predictionScore = maxProb * 100

  //Alert component (0-100, weight 25%)
  const alertWeights: Record<string, number> = { critical: 100, extreme: 100, high: 75, medium: 50, low: 25 }
  const alertScore = alerts.length > 0
    ? Math.min(100, alerts.reduce((sum, a) => sum + (alertWeights[a.severity] || 25), 0) / alerts.length)
    : 0

  //Weather component (0-100, weight 20%)
  let weatherScore = 0
  if (weather) {
    const rainFactor = Math.min(50, (weather.rain || 0) * 10)
    const windFactor = Math.min(25, (weather.windSpeed ?? 0) * 2.5)
    const humidityFactor = weather.humidity > 80 ? 25 : weather.humidity > 60 ? 15 : 0
    weatherScore = rainFactor + windFactor + humidityFactor
  }

  //Report component (0-100, weight 15%)
  const reportScore = Math.min(100, reports.last24h * 10 + reports.high * 15)

  const score = Math.round(
    predictionScore * 0.4 +
    alertScore * 0.25 +
    weatherScore * 0.2 +
    reportScore * 0.15
  )

  //Trend determination (based on whether we have high predictions + alerts)
  const trend =
    predictionScore > 60 && alertScore > 50 ? 'rising' :
    predictionScore < 30 && alertScore < 30 ? 'falling' : 'stable'

  return {
    score: Math.min(100, Math.max(0, score)),
    trend,
    breakdown: {
      'dashboard.floodPredictions': Math.round(predictionScore * 0.4),
      'dashboard.activeAlerts': Math.round(alertScore * 0.25),
      'dashboard.weatherConditions': Math.round(weatherScore * 0.2),
      'dashboard.reportDensity': Math.round(reportScore * 0.15),
    },
  }
}

function riskLevel(score: number): { label: string; color: string; bg: string } {
  if (score >= 75) return { label: 'dashboard.riskCritical', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-600' }
  if (score >= 50) return { label: 'dashboard.riskHigh', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500' }
  if (score >= 25) return { label: 'dashboard.riskModerate', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500' }
  return { label: 'dashboard.riskLow', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-500' }
}

//Component

export default function ClimateRiskDashboard({ className = '' }: Props): JSX.Element {
  const lang = useLanguage()
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [reportSummary, setReportSummary] = useState<ReportSummary>({ total: 0, high: 0, medium: 0, low: 0, last24h: 0 })
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true)
    const results = await Promise.allSettled([
      apiFetch<Prediction[]>('/api/predictions').catch(() => []),
      apiFetch<Alert[] | { alerts: Alert[] }>('/api/alerts').catch(() => []),
      apiFetch<WeatherData | null>('/api/weather/current').catch(() => null),
      apiFetch<any[] | { reports: any[] }>('/api/reports').catch(() => []),
    ])

    if (results[0].status === 'fulfilled') {
      const data = results[0].value
      const raw: Prediction[] = Array.isArray(data) ? data : []
      //Deduplicate predictions by area - keep the one with highest probability
      const byArea = new Map<string, Prediction>()
      for (const p of raw) {
        const key = p.area
        const prob = typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability
        const existing = byArea.get(key)
        if (!existing) {
          byArea.set(key, p)
        } else {
          const existProb = typeof existing.probability === 'string' ? parseFloat(existing.probability) : existing.probability
          if (prob > existProb) byArea.set(key, p)
        }
      }
      setPredictions(Array.from(byArea.values()))
    }

    if (results[1].status === 'fulfilled') {
      const data = results[1].value
      setAlerts(Array.isArray(data) ? data : data?.alerts || [])
    }

    if (results[2].status === 'fulfilled') {
      setWeather(results[2].value)
    }

    if (results[3].status === 'fulfilled') {
      const data = results[3].value
      const reports: any[] = Array.isArray(data) ? data : data?.reports || []
      const now = Date.now()
      const day = 24 * 60 * 60 * 1000
      setReportSummary({
        total: reports.length,
        high: reports.filter(r => r.severity === 'High').length,
        medium: reports.filter(r => r.severity === 'Medium').length,
        low: reports.filter(r => r.severity === 'Low').length,
        last24h: reports.filter(r => now - new Date(r.created_at || r.timestamp).getTime() < day).length,
      })
    }

    setLastUpdated(new Date())
    if (!isBackground) setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(true), 120000) // Background refresh every 2 min
    return () => clearInterval(interval)
  }, [fetchData])

  const risk = useMemo(
    () => computeRiskScore(predictions, alerts, weather, reportSummary),
    [predictions, alerts, weather, reportSummary],
  )

  const level = riskLevel(risk.score)

  //Extract all contributing factors from predictions
  const allFactors = useMemo(() => {
    const map = new Map<string, { totalImportance: number; count: number; avgValue: number; unit?: string }>()
    for (const p of predictions) {
      if (!p.contributing_factors) continue
      for (const f of p.contributing_factors) {
        const existing = map.get(f.factor) || { totalImportance: 0, count: 0, avgValue: 0, unit: f.unit }
        existing.totalImportance += f.importance
        existing.avgValue += f.value
        existing.count += 1
        map.set(f.factor, existing)
      }
    }
    return Array.from(map.entries())
      .map(([factor, data]) => ({
        factor,
        importance: data.totalImportance / data.count,
        value: data.avgValue / data.count,
        unit: data.unit,
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 6)
  }, [predictions])

  const TrendIcon = risk.trend === 'rising' ? ArrowUpRight : risk.trend === 'falling' ? ArrowDownRight : Minus

  return (
    <div className={`space-y-4 animate-fade-in ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-aegis-600" />
          {t('dashboard.title', lang)}
        </h2>
        <button
          onClick={() => fetchData()}
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-200 flex items-center gap-1 transition"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {lastUpdated ? `${t('dashboard.updated', lang)} ${lastUpdated.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : lang === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}` : t('common.loading', lang)}
        </button>
      </div>

      {/* Risk Score Card */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
          {/* Risk gauge */}
          <div className="flex-shrink-0 text-center self-center sm:self-start">
            <div className="relative w-20 h-20">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" role="img" aria-label={`${t('dashboard.overallRisk', lang)}: ${risk.score}/100`}>
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200 dark:text-gray-700" />
                <circle
                  cx="50" cy="50" r="42" fill="none" strokeWidth="8"
                  strokeDasharray={`${risk.score * 2.64} ${264 - risk.score * 2.64}`}
                  strokeLinecap="round"
                  className={level.bg.replace('bg-', 'text-')}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-xl font-black ${level.color}`}>{risk.score}</span>
              </div>
            </div>
            <p className={`text-xs font-bold mt-1 ${level.color}`}>{t(level.label, lang)}</p>
          </div>

          {/* Breakdown */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('dashboard.overallRisk', lang)}</p>
              <span className={`flex items-center gap-0.5 text-xs font-medium ${
                risk.trend === 'rising' ? 'text-red-500' : risk.trend === 'falling' ? 'text-green-500' : 'text-gray-400 dark:text-gray-300'
              }`}>
                <TrendIcon className="w-3.5 h-3.5" />
                {risk.trend === 'rising' ? t('dashboard.trendRising', lang) : risk.trend === 'falling' ? t('dashboard.trendFalling', lang) : t('dashboard.trendStable', lang)}
              </span>
            </div>
            <div className="space-y-1.5">
              {Object.entries(risk.breakdown).map(([label, value]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-300 w-28 flex-shrink-0">{t(label, lang)}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        value > 20 ? 'bg-red-500' : value > 10 ? 'bg-amber-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(100, (value || 0) * 2.5)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-gray-500 dark:text-gray-300 w-6 text-right">{isNaN(value) ? '-' : value.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t('dashboard.activePredictions', lang)}
          value={predictions.length}
          icon={Activity}
          color="text-blue-600 bg-blue-50 dark:bg-blue-950/30"
          sub={predictions.length > 0 ? `${t('dashboard.highestSev', lang)}: ${Math.round(
            Math.max(...predictions.map(p => { const v = typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability; return (isNaN(v) ? 0 : v) * 100 }))
          ) || 0}%` : t('dashboard.nonePredictions', lang)}
        />
        <StatCard
          label={t('dashboard.activeAlerts', lang)}
          value={alerts.length}
          icon={AlertTriangle}
          color="text-amber-600 bg-amber-50 dark:bg-amber-950/30"
          sub={alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length > 0
            ? `${alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length} ${t('dashboard.criticalHigh', lang)}`
            : t('dashboard.noneAlerts', lang)}
        />
        <StatCard
          label={t('dashboard.reports24h', lang)}
          value={reportSummary.last24h}
          icon={TrendingUp}
          color="text-green-600 bg-green-50 dark:bg-green-950/30"
          sub={`${reportSummary.high} ${t('dashboard.highSeverity', lang)}`}
        />
        <StatCard
          label={t('dashboard.weatherRisk', lang)}
          value={weather ? `${Math.round(weather.temperature ?? 0)}°C` : t('dashboard.naWeather', lang)}
          icon={Thermometer}
          color="text-purple-600 bg-purple-50 dark:bg-purple-950/30"
          sub={weather ? `${weather.windSpeed} m/s, ${weather.humidity}%` : t('common.loading', lang)}
        />
      </div>

      {/* Prediction Details */}
      {predictions.length > 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-blue-500" />
              {t('dashboard.floodRiskPredictions', lang)}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500">{predictions.length} {t('dashboard.monitoredAreas', lang)}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                predictions.some(p => (typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability) >= 0.6) 
                  ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                  : predictions.some(p => (typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability) >= 0.3)
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
              }`}>
                {predictions.some(p => (typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability) >= 0.6)
                  ? t('dashboard.riskHigh', lang)
                  : predictions.some(p => (typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability) >= 0.3)
                    ? t('dashboard.riskModerate', lang)
                    : t('dashboard.riskLow', lang)}
              </span>
            </div>
          </div>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {predictions.map((p, i) => {
              const prob = typeof p.probability === 'string' ? parseFloat(p.probability) : p.probability
              const pct = Math.round(prob * 100) || 0
              const conf = typeof p.confidence === 'string' ? parseFloat(p.confidence) : p.confidence
              const confPct = isNaN(conf) ? 0 : Math.round(conf > 1 ? conf : conf * 100)
              const sevColor = p.severity === 'high' || p.severity === 'critical' ? { ring: 'stroke-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/15', border: 'border-red-200 dark:border-red-800/40', dot: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
                : p.severity === 'medium' ? { ring: 'stroke-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/15', border: 'border-amber-200 dark:border-amber-800/40', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }
                : { ring: 'stroke-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/15', border: 'border-emerald-200 dark:border-emerald-800/40', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' }
 //Format area name: "River Dee (aberdeen_scotland_uk)" -> "River Dee" with region as subtitle
              const areaRaw = p.area || t('dashboard.unknownArea', lang)
              const areaMatch = areaRaw.match(/^(.+?)\s*\((.+)\)$/)
              const areaName = areaMatch ? areaMatch[1].trim() : areaRaw
              const regionTag = areaMatch ? areaMatch[2].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null
              return (
                <div key={i} className={`rounded-xl border ${sevColor.border} ${sevColor.bg} p-4 transition-all hover:shadow-md`}>
                  <div className="flex items-start gap-3">
                    {/* Risk Gauge */}
                    <div className="flex-shrink-0">
                      <div className="relative w-14 h-14">
                        <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
                          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-gray-200 dark:text-gray-700" />
                          <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3.5" strokeLinecap="round"
                            className={sevColor.ring}
                            strokeDasharray={`${pct * 1.131} ${113.1 - pct * 1.131}`} />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={`text-xs font-black tabular-nums ${sevColor.text}`}>{pct}%</span>
                        </div>
                      </div>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{areaName}</h4>
                        <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${sevColor.badge}`}>{p.severity}</span>
                      </div>
                      {regionTag && (
                        <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                          <MapPin className="w-2.5 h-2.5" />{regionTag}
                        </p>
                      )}
                      <div className="mt-2 space-y-1.5">
                        {/* Confidence bar */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-semibold text-gray-500 dark:text-gray-400 w-16">{t('dashboard.confidence', lang)}</span>
                          <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${confPct}%` }} />
                          </div>
                          <span className="text-[9px] font-bold text-gray-600 dark:text-gray-300 tabular-nums w-8 text-right">{confPct}%</span>
                        </div>
                        {/* ETA */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-semibold text-gray-500 dark:text-gray-400 w-16">{t('dashboard.eta', lang)}</span>
                          <span className={`text-[9px] font-bold ${
                            p.time_to_flood && p.time_to_flood !== 'No flood expected' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>{p.time_to_flood || t('dashboard.noFloodExpected', lang)}</span>
                        </div>
                      </div>
                      {/* Model version tag */}
                      {p.model_version && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className="text-[8px] font-mono font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{p.model_version}</span>
                          <Cpu className="w-2.5 h-2.5 text-gray-300 dark:text-gray-600" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <h3 className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
            <Droplets className="w-4 h-4 text-blue-500" />
            {t('dashboard.floodRiskPredictions', lang)}
          </h3>
          <div className="px-4 py-8 text-center">
            <Droplets className="w-10 h-10 text-blue-200 dark:text-blue-800 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {loading ? t('common.loading', lang) : t('dashboard.noActivePredictions', lang)}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">
              {loading
                ? t('dashboard.fetchingPredictions', lang)
                : t('dashboard.noPredictionsDesc', lang)}
            </p>
            {!loading && (
              <button
                onClick={() => fetchData()}
                className="mt-3 text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                <RefreshCw className="w-3 h-3 inline mr-1" />
                {t('dashboard.refreshPredictions', lang)}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Contributing Factors */}
      {allFactors.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-aegis-600" />
            {t('dashboard.keyFactors', lang)}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {allFactors.map((f, i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{f.factor}</p>
                <div className="flex items-end justify-between mt-1">
                  <span className="text-lg font-bold text-gray-700 dark:text-gray-300">
                    {isNaN(f.value) ? '--' : f.value.toFixed(1)}{f.unit ? ` ${f.unit}` : ''}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-300">
                    {t('dashboard.importance', lang)}: {isNaN(f.importance) ? '--' : (f.importance * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="h-full bg-aegis-500 rounded-full"
                    style={{ width: `${Math.min(100, f.importance * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Methodology note */}
      <p className="text-[10px] text-gray-400 dark:text-gray-600 leading-relaxed">
        {t('dashboard.methodology', lang)}
      </p>
    </div>
  )
}

// StatCard

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string | number; icon: React.ElementType; color: string; sub: string
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[10px] text-gray-500 dark:text-gray-300">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{sub}</p>
    </div>
  )
}

