/**
 * Advanced river level intelligence panel displaying live gauge readings from
 * SEPA (Scotland) and Environment Agency (England & Wales) via sepaApi utility.
 * Features: severity-sorted gauge list, animated level bars, threshold
 * visualisation, trend indicators, expandable detail cards with stats grid,
 * worst-gauge hero banner, station count analytics, and live status badges.
 *
 * - Used across both admin and citizen interfaces */

import { useState, useMemo } from 'react'
import {
  Waves, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
  Droplets, Clock, MapPin, Activity, ChevronDown, ChevronUp,
  ShieldAlert, Gauge, BarChart2, Navigation } from 'lucide-react'
import { fetchRiverLevels, getGaugeColor, getGaugeBg } from '../../utils/sepaApi'
import { useLocation } from '../../contexts/LocationContext'
import { useAsync } from '../../hooks/useAsync'
import type { RiverGauge } from '../../utils/sepaApi'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const STATUS_ORDER: Record<string, number> = { alert: 0, warning: 1, rising: 2, normal: 3 }
const STATUS_CFG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  alert:   { label: 'FLOOD ALERT', bg: 'bg-red-500', text: 'text-white', border: 'border-red-400' },
  warning: { label: 'WARNING',     bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-400' },
  rising:  { label: 'RISING',      bg: 'bg-orange-400', text: 'text-white', border: 'border-orange-300' },
  normal:  { label: 'Normal',      bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-400' },
}

export default function RiverGaugePanel(): JSX.Element {
  const lang = useLanguage()
  const { activeLocation } = useLocation()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [manualError, setManualError] = useState('')

  const { data, loading, error: asyncError, refresh } = useAsync<{ gauges: RiverGauge[]; at: Date }>(
    async () => {
      const g = await fetchRiverLevels(activeLocation, userLat ?? undefined, userLng ?? undefined)
      return { gauges: g, at: new Date() }
    },
    [activeLocation, userLat, userLng],
    { pollMs: 300000 },
  )
  const gauges = data?.gauges ?? []
  const lastUpdated = data?.at ?? null
  const error = manualError || (asyncError ? (asyncError.message || 'Failed to fetch live river gauge data.') : '')

  const detectLocation = () => {
    if (!('geolocation' in navigator)) { setManualError(t('river.gpsNotSupported', lang)); return }
    setManualError('')
    navigator.geolocation.getCurrentPosition(
      pos => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude) },
      (err) => { if (err.code === 1) setManualError(t('river.locationDenied', lang)); else setManualError(t('river.locationUnavailable', lang)) },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    )
  }

  //Sort by severity
  const sorted = useMemo(() =>
    [...gauges].sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4)),
  [gauges])

  //Analytics
  const stats = useMemo(() => {
    const alertCount = gauges.filter(g => g.status === 'alert').length
    const warnCount = gauges.filter(g => g.status === 'warning').length
    const risingCount = gauges.filter(g => g.status === 'rising').length
    const avgLevel = gauges.length ? gauges.reduce((s, g) => s + g.level, 0) / gauges.length : 0
    const highestGauge = sorted[0] || null
    return { alertCount, warnCount, risingCount, avgLevel, highestGauge, total: gauges.length }
  }, [gauges, sorted])

  const overallStatus = stats.alertCount > 0 ? 'alert' : stats.warnCount > 0 ? 'warning' : stats.risingCount > 0 ? 'rising' : 'normal'
  const overallCfg = STATUS_CFG[overallStatus]

  const getPct = (g: RiverGauge) => Math.max(0, Math.min((g.level / g.alertLevel) * 100, 100))
  const getWarnPct = (g: RiverGauge) => Math.max(0, Math.min((g.warningLevel / g.alertLevel) * 100, 100))

  const TrendIcon = ({ trend }: { trend: RiverGauge['levelTrend'] }) => {
    if (trend === 'rising') return <TrendingUp className="w-3.5 h-3.5 text-red-400" />
    if (trend === 'falling') return <TrendingDown className="w-3.5 h-3.5 text-green-400" />
    return <Minus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
  }

  const getBarColor = (status: string) => {
    if (status === 'alert') return 'bg-red-500'
    if (status === 'warning') return 'bg-amber-500'
    if (status === 'rising') return 'bg-orange-400'
    return 'bg-blue-400'
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
      {/* Header */}
      <button onClick={() => setCollapsed(c => !c)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl ${overallCfg.bg} shadow-lg`}>
            <Waves className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('river.riverLevels', lang)}</h3>
              <span className="text-[8px] bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                <Activity className="w-2 h-2" /> LIVE
              </span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {stats.total} station{stats.total !== 1 ? 's' : ''} monitored
              {lastUpdated && <> - {Math.round((Date.now() - lastUpdated.getTime()) / 60000)}m ago</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold px-2 py-1 rounded-lg ${overallCfg.bg} ${overallCfg.text}`}>{overallCfg.label}</span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-200/50 dark:border-gray-700/40">
          {/* Action bar */}
          <div className="px-4 py-2 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200/50 dark:border-gray-700/30">
            <div className="flex items-center gap-3">
              <button onClick={detectLocation} className="text-[10px] text-blue-500 hover:text-blue-600 font-semibold flex items-center gap-1 transition-colors">
                <MapPin className="w-3 h-3" /> {t('river.useMyGPS', lang)}
              </button>
              {userLat && (
                <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                  <Navigation className="w-2.5 h-2.5" /> {userLat.toFixed(2)}, {userLng?.toFixed(2)}
                </span>
              )}
            </div>
            <button onClick={refresh} disabled={loading} className="text-[10px] text-blue-500 hover:text-blue-600 font-semibold flex items-center gap-1 disabled:opacity-50 transition-colors">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
            </button>
          </div>

          {/* Analytics strip */}
          {stats.total > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 px-3 py-2.5 bg-gray-50/30 dark:bg-gray-800/20 border-b border-gray-200/50 dark:border-gray-700/30">
              {[
                { label: 'Stations', value: stats.total, icon: BarChart2, color: 'text-blue-500' },
                { label: 'Alerts', value: stats.alertCount, icon: ShieldAlert, color: stats.alertCount > 0 ? 'text-red-500' : 'text-gray-400' },
                { label: 'Warnings', value: stats.warnCount, icon: AlertTriangle, color: stats.warnCount > 0 ? 'text-amber-500' : 'text-gray-400' },
                { label: 'Avg Flow', value: gauges[0]?.source === 'open-meteo' ? `${stats.avgLevel.toFixed(0)} m³/s` : `${stats.avgLevel.toFixed(2)}m`, icon: Gauge, color: 'text-cyan-500' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <s.icon className={`w-3 h-3 mx-auto mb-0.5 ${s.color}`} />
                  <p className="text-xs font-bold text-gray-900 dark:text-white">{s.value}</p>
                  <p className="text-[8px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Worst gauge hero banner */}
          {stats.highestGauge && (stats.highestGauge.status === 'alert' || stats.highestGauge.status === 'warning') && (
            <div className={`mx-3 mt-2.5 p-3 rounded-xl border-2 ${stats.highestGauge.status === 'alert' ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700'}`}>
              <div className="flex items-start gap-2.5">
                <ShieldAlert className={`w-5 h-5 mt-0.5 flex-shrink-0 ${stats.highestGauge.status === 'alert' ? 'text-red-500 animate-pulse' : 'text-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[10px] font-extrabold uppercase tracking-wider ${stats.highestGauge.status === 'alert' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    Highest Risk Station
                  </p>
                  <p className="text-xs font-bold text-gray-900 dark:text-white mt-0.5 truncate">{stats.highestGauge.name}</p>
                  {stats.highestGauge.river && <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{stats.highestGauge.river}</p>}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-sm font-mono font-bold ${getGaugeColor(stats.highestGauge.status)}`}>
                      {stats.highestGauge.source === 'open-meteo' ? `${stats.highestGauge.level.toFixed(0)} m³/s` : `${stats.highestGauge.level.toFixed(3)}m`}
                    </span>
                    <TrendIcon trend={stats.highestGauge.levelTrend} />
                    <span className="text-[9px] text-gray-400">Alert: {stats.highestGauge.alertLevel.toFixed(2)}m</span>
                  </div>
                  {/* Bar */}
                  <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-2">
                    <div className="absolute left-0 top-0 h-full bg-green-300/50 rounded-full" style={{ width: `${getWarnPct(stats.highestGauge)}%` }} />
                    <div className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${getBarColor(stats.highestGauge.status)}`} style={{ width: `${getPct(stats.highestGauge)}%` }} />
                    <div className="absolute top-0 h-full w-0.5 bg-amber-600" style={{ left: `${getWarnPct(stats.highestGauge)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex items-center gap-2 mx-3 mt-2 px-3 py-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && gauges.length === 0 && (
            <div className="px-3 py-4 space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          )}

          {/* Empty state */}
          {gauges.length === 0 && !loading && !error && (
            <div className="text-center py-8">
              <Droplets className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('river.noGaugeData', lang)}</p>
              <button onClick={detectLocation} className="mt-2 text-xs text-blue-500 hover:text-blue-600 font-semibold underline">{t('river.useMyGPS', lang)}</button>
            </div>
          )}

          {/* Gauge list */}
          <div className="px-3 py-2 space-y-2 max-h-[400px] overflow-y-auto">
            {sorted.map(g => {
              const pct = getPct(g)
              const warnPct = getWarnPct(g)
              const cfg = STATUS_CFG[g.status] || STATUS_CFG.normal
              const isExpanded = expandedId === g.id

              return (
                <div key={g.id} className={`rounded-xl border-2 transition-all ${isExpanded ? 'ring-2 ring-blue-300 dark:ring-blue-700 shadow-lg' : 'hover:shadow-md'} ${getGaugeBg(g.status)}`}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : g.id)}
                    className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
                  >
                    {/* Status pulse dot */}
                    <div className="relative flex-shrink-0">
                      <div className={`w-3 h-3 rounded-full ${g.status === 'alert' ? 'bg-red-500' : g.status === 'warning' ? 'bg-amber-500' : g.status === 'rising' ? 'bg-orange-400' : 'bg-emerald-500'}`} />
                      {(g.status === 'alert' || g.status === 'warning') && (
                        <div className={`absolute inset-0 rounded-full ${g.status === 'alert' ? 'bg-red-500' : 'bg-amber-500'} animate-ping opacity-40`} />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900 dark:text-white truncate">{g.name}</span>
                        <TrendIcon trend={g.levelTrend} />
                      </div>
                      {g.river && (
                        <p className="text-[9px] text-blue-500 dark:text-blue-400 font-medium flex items-center gap-0.5 truncate">
                          <Waves className="w-2 h-2 flex-shrink-0" /> {g.river}
                        </p>
                      )}
                    </div>

                    {/* Level + badge */}
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-mono font-bold ${getGaugeColor(g.status)}`}>
                        {g.source === 'open-meteo' ? `${g.level.toFixed(0)} m³/s` : `${g.level.toFixed(2)}m`}
                      </div>
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-lg ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                    </div>
                  </button>

                  {/* Level bar */}
                  <div className="px-3 pb-2">
                    <div className="relative w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="absolute left-0 top-0 h-full bg-green-300 opacity-40 rounded-full" style={{ width: `${warnPct}%` }} />
                      <div className={`absolute left-0 top-0 h-full rounded-full transition-all duration-1000 ${getBarColor(g.status)}`} style={{ width: `${pct}%` }} />
                      <div className="absolute top-0 h-full w-0.5 bg-amber-600" style={{ left: `${warnPct}%` }} title="Warning threshold" />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[7px] text-gray-400 dark:text-gray-500">0m</span>
                      <span className="text-[7px] text-amber-500 font-bold">{g.warningLevel.toFixed(1)}m</span>
                      <span className="text-[7px] text-red-500 font-bold">{g.alertLevel.toFixed(1)}m</span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-gray-200/50 dark:border-gray-700/30 pt-2">
                      {/* Stats grid */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { label: t('river.current', lang), value: g.source === 'open-meteo' ? `${g.level.toFixed(0)} m³/s` : `${g.level.toFixed(3)}m`, color: getGaugeColor(g.status) },
                          { label: t('river.warningLabel', lang), value: g.source === 'open-meteo' ? `${g.warningLevel.toFixed(0)} m³/s` : `${g.warningLevel.toFixed(2)}m`, color: 'text-amber-500' },
                          { label: t('river.alertLabel', lang), value: g.source === 'open-meteo' ? `${g.alertLevel.toFixed(0)} m³/s` : `${g.alertLevel.toFixed(2)}m`, color: 'text-red-500' },
                        ].map(item => (
                          <div key={item.label} className="bg-white/80 dark:bg-gray-900/60 rounded-lg p-2 text-center border border-gray-200/50 dark:border-gray-700/30">
                            <div className={`text-sm font-mono font-bold ${item.color}`}>{item.value}</div>
                            <div className="text-[8px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">{item.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center justify-between text-[9px] text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Activity className="w-2.5 h-2.5" />
                          Trend: <strong className={g.levelTrend === 'rising' ? 'text-red-500' : g.levelTrend === 'falling' ? 'text-green-500' : 'text-gray-400'}>{t(`river.${g.levelTrend === 'steady' ? 'stable' : g.levelTrend}`, lang)}</strong>
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" /> {new Date(g.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="flex items-center gap-0.5 uppercase font-bold text-[8px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                          {g.source === 'sepa' ? 'SEPA' : g.source === 'open-meteo' ? 'Global' : 'EA'}
                        </span>
                      </div>

                      {/* Flood warnings inline */}
                      {(g.status === 'alert' || g.status === 'warning') && (
                        <div className={`p-2 rounded-lg flex items-center gap-2 ${g.status === 'alert' ? 'bg-red-100 dark:bg-red-950/30 border border-red-200 dark:border-red-700' : 'bg-amber-100 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700'}`}>
                          <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${g.status === 'alert' ? 'text-red-600' : 'text-amber-600'}`} />
                          <p className={`text-[10px] font-bold ${g.status === 'alert' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                            {g.status === 'alert' ? t('river.floodAlertMsg', lang) : t('river.floodWarningMsg', lang)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer */}
          {lastUpdated && (
            <div className="px-4 py-2 border-t border-gray-200/50 dark:border-gray-700/30 flex items-center justify-between">
              <p className="text-[9px] text-gray-400 dark:text-gray-500">
                Sources: SEPA + Environment Agency - Auto-refreshes every 5 min
              </p>
              <p className="text-[9px] text-gray-400 dark:text-gray-500">
                {lastUpdated.toLocaleTimeString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
