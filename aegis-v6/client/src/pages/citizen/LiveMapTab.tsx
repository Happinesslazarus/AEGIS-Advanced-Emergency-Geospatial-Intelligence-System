import React, { useState, lazy, Suspense } from 'react'
import { AlertTriangle, ChevronRight, Globe, Crosshair } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import ErrorBoundary from '../../components/shared/ErrorBoundary'
import { Skeleton } from '../../components/ui/Skeleton'

const LiveIncidentMapPanel = lazy(() => import('../../components/citizen/LiveIncidentMapPanel'))
const IntelligenceDashboard = lazy(() => import('../../components/shared/IntelligenceDashboard'))
const WeatherPanel = lazy(() => import('../../components/shared/WeatherPanel'))
const RiverGaugePanel = lazy(() => import('../../components/shared/RiverGaugePanel'))

export default function LiveMapTab({ reports, loc, userPosition, detectLocation, alerts, setSelectedAlert }: {
  reports: any[]; loc: any; userPosition: [number,number]|null; detectLocation: () => void; alerts: any[]; setSelectedAlert: (a: any) => void
}) {
  const [showWeather, setShowWeather] = useState(true)
  const [showRivers, setShowRivers] = useState(false)
  const lang = useLanguage()

  return (
    <div className="space-y-4 -mx-2 md:-mx-4">
      {/* Alerts Banner -- shown first so critical warnings are immediately visible */}
      {alerts.length > 0 && (
        <div className="px-2 md:px-4 space-y-2">
          {alerts.slice(0, 3).map((a: any, i: number) => (
            <button key={a.id || i} onClick={() => setSelectedAlert(a)} className={`w-full text-left p-3 rounded-xl border flex items-center gap-3 transition hover:shadow-md ${
              a.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' :
              a.severity === 'warning' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' :
              'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
            }`}>
              <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-600' : a.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{a.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{a.message}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-2 md:px-4 flex-wrap">
        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
          <Globe className="w-5 h-5 icon-primary" />
          {t('citizen.map.operations', lang)}
        </h2>
        <div className="ml-auto flex gap-2">
          <button onClick={detectLocation} className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
            <Crosshair className="w-3.5 h-3.5" /> {t('citizen.map.myLocationBtn', lang)}
          </button>
          <button
            onClick={() => setShowWeather(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              showWeather ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {t('citizen.map.weather', lang)}
          </button>
          <button
            onClick={() => setShowRivers(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              showRivers ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {t('citizen.map.riverLevels', lang)}
          </button>
        </div>
      </div>

      {/* Map -- Professional Live Incident Map Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-2 md:px-4">
        <div className="lg:col-span-2">
          <ErrorBoundary name="LiveIncidentMapPanel" fallback={<div className="h-[450px] rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">Failed to load map</div>}>
            <Suspense fallback={<div className="h-[450px] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-[380px] w-full rounded-xl" /></div>}>
              <LiveIncidentMapPanel reports={reports} userPosition={userPosition} center={loc.center} zoom={loc.zoom} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className="space-y-4">
          <IntelligenceDashboard collapsed={true} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700" />
          {showWeather && <WeatherPanel />}
        </div>
        {/* River Levels -- full width below the map row for better readability */}
        {showRivers && (
          <div className="lg:col-span-3">
            <RiverGaugePanel />
          </div>
        )}
      </div>
    </div>
  )
}
