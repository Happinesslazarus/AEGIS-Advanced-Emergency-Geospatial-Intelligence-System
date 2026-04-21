import React, { useEffect } from 'react'
import {
  Globe, Newspaper, Waves, AlertCircle as AlertCircleIcon, CloudLightning, Flame,
  Droplets, RefreshCw, ExternalLink, Share2,
} from 'lucide-react'
import type { NewsItem } from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export default function NewsTab({ newsPool, newsOffset, setNewsOffset, NEWS_BATCH, filteredNewsItems, newsHazardFilter, setNewsHazardFilter, newsRefreshing, loadNews, nextNews, newsTotal, hasNextBatchInPool, hasMoreFromServer, lastFetched }: {
  newsPool: NewsItem[]
  newsOffset: number
  setNewsOffset: React.Dispatch<React.SetStateAction<number>>
  NEWS_BATCH: number
  filteredNewsItems: NewsItem[]
  newsHazardFilter: string
  setNewsHazardFilter: (f: string) => void
  newsRefreshing: boolean
  loadNews: (forceRefresh?: boolean) => Promise<void>
  nextNews: () => Promise<void>
  newsTotal: number
  hasNextBatchInPool: boolean
  hasMoreFromServer: boolean
  lastFetched: Date | null
}) {
  const lang = useLanguage()

  //Auto-refresh every 15 minutes silently
  useEffect(() => {
    const interval = setInterval(() => { loadNews(false).catch(() => {}) }, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadNews])

  const typeConfig: Record<string, { color: string; bg: string; label: string }> = {
    alert:     { color: 'bg-red-500',    bg: 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/50',        label: 'Alert' },
    warning:   { color: 'bg-amber-500',  bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/50',  label: 'Warning' },
    disaster:  { color: 'bg-rose-600',   bg: 'bg-rose-50 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-800/50',      label: 'Disaster' },
    community: { color: 'bg-green-500',  bg: 'bg-green-50 dark:bg-green-950/20 border-green-200/50 dark:border-green-800/50',  label: 'Community' },
    tech:      { color: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/50', label: 'Tech' },
    info:      { color: 'bg-blue-500',   bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50',      label: 'Info' },
  }

  const hazardFilters = [
    { id: 'all',        label: 'All',        icon: Globe },
    { id: 'flood',      label: 'Flood',      icon: Waves },
    { id: 'earthquake', label: 'Earthquake', icon: AlertCircleIcon },
    { id: 'storm',      label: 'Storm',      icon: CloudLightning },
    { id: 'wildfire',   label: 'Wildfire',   icon: Flame },
    { id: 'drought',    label: 'Drought',    icon: Droplets },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-lg flex items-center gap-2.5 text-gray-900 dark:text-white">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
            <Newspaper className="w-4 h-4 text-white" />
          </div>
          {'News'}
          {newsPool.length > 0 && (
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({newsTotal || newsPool.length} articles)</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {newsPool.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {Math.floor(newsOffset / NEWS_BATCH) + 1}/{Math.ceil(newsPool.length / NEWS_BATCH)}
              {lastFetched && ` - ${lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          )}
          {newsOffset > 0 && (
            <button
              onClick={() => setNewsOffset(o => Math.max(0, o - NEWS_BATCH))}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-aegis-600 bg-gray-100/80 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/60 px-3 py-2 rounded-xl transition-all hover:scale-[1.02] font-bold"
            >
 {'<-'} Prev
            </button>
          )}
          <button
            onClick={nextNews}
            disabled={newsRefreshing}
            className="flex items-center gap-1.5 text-xs text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/60 dark:border-aegis-800/60 px-4 py-2 rounded-xl transition-all disabled:opacity-60 hover:scale-[1.02] active:scale-95 font-bold backdrop-blur-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-500 ${newsRefreshing ? 'animate-spin' : ''}`} />
 {newsRefreshing ? 'Loading...' : hasNextBatchInPool || hasMoreFromServer ? 'Next ->' : 'Refresh ↺'}
          </button>
        </div>
      </div>

      {/* Hazard filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {hazardFilters.map(f => (
          <button key={f.id} onClick={() => setNewsHazardFilter(f.id)}
            className={`flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all hover:scale-[1.02] ${newsHazardFilter === f.id ? 'bg-aegis-600 text-white border-aegis-600 shadow-sm' : 'bg-white dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-aegis-300'}`}
          >
            <f.icon className="w-3 h-3" /> {f.label}
          </button>
        ))}
        {newsHazardFilter !== 'all' && <span className="text-[11px] text-gray-400">{filteredNewsItems.length} matching</span>}
      </div>

      {/* News list */}
      <div key={`${newsOffset}-${newsHazardFilter}`} className="space-y-2.5 animate-fade-in">
        {newsRefreshing && newsPool.length === 0 && (
          <div className="space-y-2.5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="glass-card rounded-2xl p-4 flex items-start gap-3.5 animate-pulse">
                <div className="w-3 h-3 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 mt-1.5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!newsRefreshing && filteredNewsItems.length === 0 && (
          <div className="glass-card rounded-2xl p-8 text-center">
            <Newspaper className="w-10 h-10 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {newsHazardFilter !== 'all' ? `No ${newsHazardFilter} articles in this batch -- try Next ↺` : 'No news articles available'}
            </p>
          </div>
        )}
        {filteredNewsItems.map((n, i) => {
          const cfg = typeConfig[n.type] || typeConfig.info
          const waUrl = `https://wa.me/?text=${encodeURIComponent(`🚨 ${n.title}\n${n.url}`)}`
          return (
            <div key={i} className="glass-card rounded-2xl p-4 hover:shadow-lg transition-all duration-300 flex items-start gap-3.5 group hover-lift">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${cfg.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[8px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.bg} border`}>{cfg.label}</span>
                </div>
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-aegis-600 transition-colors block">{n.title}</a>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{n.source} - {n.time}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                <a href={waUrl} target="_blank" rel="noopener noreferrer" title="Share on WhatsApp"
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200/60 dark:border-green-800/60 hover:bg-green-100 transition-colors">
                  <Share2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                </a>
                <a href={n.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/20 border border-aegis-200/60 dark:border-aegis-800/60 px-3 py-1.5 rounded-xl transition-all font-bold">
                  <ExternalLink className="w-3 h-3" /> {'Source'}
                </a>
              </div>
            </div>
          )
        })}
        {newsPool.length > NEWS_BATCH && (
          <div className="flex items-center justify-center gap-2 pt-1 text-xs text-gray-400">
            <span>{newsOffset + 1}-{Math.min(newsOffset + NEWS_BATCH, newsPool.length)} of {newsTotal || newsPool.length} articles</span>
          </div>
        )}
      </div>
    </div>
  )
}
