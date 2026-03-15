import { useState, useEffect } from 'react'
import { Waves, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Droplets, Clock, MapPin, Info } from 'lucide-react'
import { fetchRiverLevels, getGaugeColor, getGaugeBg } from '../../utils/sepaApi'
import { useLocation } from '../../contexts/LocationContext'
import type { RiverGauge } from '../../utils/sepaApi'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export default function RiverGaugePanel(): JSX.Element {
  const lang = useLanguage()
  const { activeLocation } = useLocation()
  const [gauges, setGauges] = useState<RiverGauge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchRiverLevels(activeLocation, userLat ?? undefined, userLng ?? undefined)
      setGauges(data)
    } catch (err: any) {
      setGauges([])
      setError(err?.message || 'Failed to fetch live river gauge data.')
    }
    setLoading(false)
  }

  const detectLocation = () => {
    if (!('geolocation' in navigator)) {
      setError(t('river.gpsNotSupported', lang))
      return
    }
    setError('')
    navigator.geolocation.getCurrentPosition(
      pos => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude) },
      (err) => {
        if (err.code === 1) setError(t('river.locationDenied', lang))
        else setError(t('river.locationUnavailable', lang))
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    )
  }

  useEffect(() => { refresh() }, [activeLocation, userLat, userLng])

  const getStatusLabel = (status: string) => {
    if (status === 'alert')   return { text: t('river.floodAlert', lang), bg: 'bg-red-500',    fg: 'text-white' }
    if (status === 'warning') return { text: t('river.warning', lang),     bg: 'bg-amber-500',  fg: 'text-white' }
    if (status === 'rising')  return { text: t('river.rising', lang),      bg: 'bg-orange-400', fg: 'text-white' }
    return                           { text: t('river.normal', lang),      bg: 'bg-green-500',  fg: 'text-white' }
  }

  const getPct     = (g: RiverGauge) => Math.min((g.level / g.alertLevel) * 100, 100)
  const getWarnPct = (g: RiverGauge) => Math.min((g.warningLevel / g.alertLevel) * 100, 100)

  const TrendIcon = ({ trend }: { trend: RiverGauge['levelTrend'] }) => {
    if (trend === 'rising')  return <TrendingUp   className="w-3.5 h-3.5 text-red-500" />
    if (trend === 'falling') return <TrendingDown  className="w-3.5 h-3.5 text-green-500" />
    return <Minus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
  }

  const hoveredGauge = gauges.find(g => g.id === hoveredId) ?? null

  return (
    <div className="card p-3 sm:p-4 relative">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
          <Waves className="w-4 h-4 text-blue-500" />
          {t('river.riverLevels', lang)}
          <span className="text-[9px] bg-blue-100 dark:bg-blue-600 text-blue-600 dark:text-white px-1.5 py-0.5 rounded-full font-bold">{t('river.live', lang)}</span>
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={detectLocation} className="btn-ghost p-1.5" title={t('river.useMyGps', lang)}>
            <MapPin className="w-3.5 h-3.5 text-blue-400" />
          </button>
          <button onClick={refresh} disabled={loading} className="btn-ghost p-1.5" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {loading && gauges.length === 0 && (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      )}

      {gauges.length === 0 && !loading && !error && (
        <div className="text-center py-4">
          <Droplets className="w-8 h-8 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('river.noGaugeData', lang)}</p>
          <button onClick={detectLocation} className="mt-2 text-xs text-blue-500 underline">{t('river.useMyGps', lang)}</button>
        </div>
      )}

      <div className="space-y-2">
        {gauges.map(g => {
          const pct     = getPct(g)
          const warnPct = getWarnPct(g)
          const sl      = getStatusLabel(g.status)
          const isHov   = hoveredId === g.id

          return (
            <div
              key={g.id}
              className={`border-2 rounded-xl p-2.5 transition-all cursor-pointer ${getGaugeBg(g.status)} ${isHov ? 'shadow-lg scale-[1.01] ring-2 ring-blue-300 dark:ring-blue-700' : 'hover:shadow-md'}`}
              onMouseEnter={() => setHoveredId(g.id)}
              onMouseLeave={() => setHoveredId(null)}
              onTouchStart={() => setHoveredId(g.id === hoveredId ? null : g.id)}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <Waves className={`w-3.5 h-3.5 flex-shrink-0 ${getGaugeColor(g.status)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs truncate leading-tight">{g.name}</div>
                    {g.river && (
                      <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center gap-0.5 truncate">
                        <Waves className="w-2 h-2 flex-shrink-0" /> {g.river}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <TrendIcon trend={g.levelTrend} />
                  <div className="text-right">
                    <div className={`font-bold text-sm leading-tight ${getGaugeColor(g.status)}`}>{g.level.toFixed(2)}m</div>
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${sl.bg} ${sl.fg}`}>{sl.text}</span>
                  </div>
                </div>
              </div>

              {/* Level bar */}
              <div className="relative w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="absolute left-0 top-0 h-full bg-green-300 opacity-50 rounded-full" style={{ width: `${warnPct}%` }} />
                <div
                  className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${g.status === 'alert' ? 'bg-red-500' : g.status === 'warning' ? 'bg-amber-500' : g.status === 'rising' ? 'bg-orange-400' : 'bg-blue-400'}`}
                  style={{ width: `${pct}%` }}
                />
                <div className="absolute top-0 h-full w-0.5 bg-amber-600" style={{ left: `${warnPct}%` }} />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[8px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">0m</span>
                <span className="text-[8px] text-amber-500">{g.warningLevel.toFixed(1)}m</span>
                <span className="text-[8px] text-red-500">{g.alertLevel.toFixed(1)}m</span>
              </div>
              <p className="text-[8px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1 flex items-center gap-1">
                <Clock className="w-2 h-2" />
                EA Live · {new Date(g.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {!isHov && <span className="ml-1 opacity-60 flex items-center gap-0.5"><Info className="w-2 h-2"/> {t('river.hoverForDetails', lang)}</span>}
              </p>
            </div>
          )
        })}
      </div>

      {/* Compact detail overlay — positioned over the gauge list, not pushing layout */}
      {hoveredGauge && (
        <div className="absolute inset-x-3 bottom-3 z-10 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/95 dark:to-cyan-950/95 border-2 border-blue-200 dark:border-blue-700 rounded-2xl p-3.5 shadow-2xl backdrop-blur-sm animate-fade-in">
          <div className="flex items-start justify-between mb-2">
            <div className="min-w-0 flex-1">
              <h4 className="font-bold text-sm text-blue-900 dark:text-blue-100 truncate">{hoveredGauge.name}</h4>
              {hoveredGauge.river && (
                <p className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-0.5 font-medium truncate">
                  <Waves className="w-2.5 h-2.5 flex-shrink-0" /> {hoveredGauge.river}
                </p>
              )}
            </div>
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ml-2 ${getStatusLabel(hoveredGauge.status).bg} ${getStatusLabel(hoveredGauge.status).fg}`}>
              {getStatusLabel(hoveredGauge.status).text}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {[
              { label: t('river.current', lang), value: `${hoveredGauge.level.toFixed(3)}m`, color: getGaugeColor(hoveredGauge.status) },
              { label: t('river.warningLabel', lang), value: `${hoveredGauge.warningLevel.toFixed(2)}m`, color: 'text-amber-500' },
              { label: t('river.alertLabel', lang),   value: `${hoveredGauge.alertLevel.toFixed(2)}m`,   color: 'text-red-500' },
            ].map(item => (
              <div key={item.label} className="bg-white/80 dark:bg-gray-900/60 rounded-lg p-1.5 text-center">
                <div className={`font-bold text-xs ${item.color}`}>{item.value}</div>
                <div className="text-[8px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{item.label}</div>
              </div>
            ))}
          </div>

          {/* Compact bar */}
          <div className="relative h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-1.5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${hoveredGauge.status === 'alert' ? 'bg-red-500' : hoveredGauge.status === 'warning' ? 'bg-amber-400' : hoveredGauge.status === 'rising' ? 'bg-orange-400' : 'bg-blue-400'}`}
              style={{ width: `${Math.min(getPct(hoveredGauge), 100)}%` }}
            />
            <div className="absolute top-0 h-full w-0.5 bg-amber-600" style={{ left: `${getWarnPct(hoveredGauge)}%` }} />
          </div>

          <div className="flex items-center justify-between text-[9px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
            <span className="flex items-center gap-1">
              Trend: <strong className={hoveredGauge.levelTrend === 'rising' ? 'text-red-500' : hoveredGauge.levelTrend === 'falling' ? 'text-green-500' : 'text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}>{t(`river.${hoveredGauge.levelTrend}`, lang)}</strong>
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="w-2 h-2" /> {new Date(hoveredGauge.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {(hoveredGauge.status === 'alert' || hoveredGauge.status === 'warning') && (
            <div className={`mt-1.5 p-2 rounded-lg flex items-center gap-1.5 ${hoveredGauge.status === 'alert' ? 'bg-red-100 dark:bg-red-950/30 border border-red-300 dark:border-red-700' : 'bg-amber-100 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700'}`}>
              <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${hoveredGauge.status === 'alert' ? 'text-red-600' : 'text-amber-600'}`} />
              <p className={`text-[10px] font-bold ${hoveredGauge.status === 'alert' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {hoveredGauge.status === 'alert' ? t('river.floodAlertMsg', lang) : t('river.floodWarningMsg', lang)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}





