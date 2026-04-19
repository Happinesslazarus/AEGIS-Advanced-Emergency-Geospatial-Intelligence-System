/**
 * Module: LocationDropdown.tsx
 *
 * Location dropdown shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, useRef, useEffect, useMemo } from 'react'
import {
  MapPin, Search, ChevronDown, ChevronRight, Check, X,
  Globe, Globe2, Landmark, Sun, Mountain, TreePine, Waves, Crown,
} from 'lucide-react'
import { useLocation } from '../../contexts/LocationContext'
import { WORLD_REGIONS, getFlagUrl, type RegionGroup, type RegionEntry } from '../../data/worldRegions'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/* Map Lucide icon name ? component */
const ICON_MAP: Record<string, React.ElementType> = {
  Globe, Globe2, Landmark, Sun, Mountain, MapPin, TreePine, Waves, Crown,
}

interface Props {
  /* Compact mode — used in navigation bars (no label text, smaller) */
  compact?: boolean
  /* Additional CSS classes on the outer wrapper */
  className?: string
}

export default function LocationDropdown({ compact = false, className = '' }: Props): JSX.Element {
  const { activeLocation, setActiveLocation, availableLocations } = useLocation()
  const lang = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  /* Build a set of available location keys for quick lookup */
  const availableKeys = useMemo(
    () => new Set(availableLocations.map(l => l.key)),
    [availableLocations],
  )

  /* Get display name for a location key from LocationContext */
  const locationNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    availableLocations.forEach(l => { m[l.key] = l.name })
    return m
  }, [availableLocations])

  /* Current active label */
  const activeEntry = useMemo(() => {
    for (const g of WORLD_REGIONS) {
      for (const e of g.entries) {
        if ((e.locationKey || e.code) === activeLocation) return e
        if (e.children) {
          const child = e.children.find(c => (c.locationKey || c.code) === activeLocation)
          if (child) return child
        }
      }
    }
    return null
  }, [activeLocation])

  const activeName = activeEntry?.label || locationNameMap[activeLocation] || activeLocation

  /* Close on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* Focus search when opened */
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 60)
      // Auto-expand the group containing the active location
      for (const g of WORLD_REGIONS) {
        if (g.entries.some(e =>
          (e.locationKey || e.code) === activeLocation ||
          (e.children || []).some(c => (c.locationKey || c.code) === activeLocation)
        )) {
          setExpandedGroup(g.id)
          // Also expand parent entry if active is a child
          const parentEntry = g.entries.find(e => (e.children || []).some(c => (c.locationKey || c.code) === activeLocation))
          if (parentEntry) setExpandedEntry(`${g.id}-${parentEntry.code}`)
          break
        }
      }
    }
  }, [open, activeLocation])

  /* Filtered groups */
  const filteredGroups: (RegionGroup & { filteredEntries: RegionEntry[] })[] = useMemo(() => {
    const q = search.toLowerCase().trim()
    return WORLD_REGIONS.map(g => ({
      ...g,
      filteredEntries: q
        ? g.entries.filter(e =>
            e.label.toLowerCase().includes(q) ||
            e.code.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q) ||
            (e.locationKey || '').toLowerCase().includes(q) ||
            (e.children || []).some(c =>
              c.label.toLowerCase().includes(q) ||
              c.code.toLowerCase().includes(q) ||
              (c.locationKey || '').toLowerCase().includes(q)))
        : g.entries,
    })).filter(g => g.filteredEntries.length > 0)
  }, [search])

  /* When searching, expand all matching groups */
  const isSearching = search.trim().length > 0

  const handleSelect = (entry: RegionEntry) => {
    const key = entry.locationKey || entry.code
    setActiveLocation(key)
    setOpen(false)
    setSearch('')
  }

  const toggleGroup = (id: string) => {
    setExpandedGroup(prev => (prev === id ? null : id))
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-xl border transition-all duration-200 ${
          open
            ? 'border-aegis-400 dark:border-aegis-600 bg-aegis-50 dark:bg-aegis-950/30 shadow-md shadow-aegis-500/10'
            : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:bg-gray-50 dark:hover:bg-white/[0.06] hover:border-gray-300 dark:hover:border-white/20'
        } ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
      >
        {/* Flag or pin */}
        {activeEntry?.code ? (
          <img
            src={getFlagUrl(activeEntry.code, 20)}
            alt=""
            className="w-5 h-[14px] object-cover rounded-[2px] shadow-sm flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <MapPin className="w-3.5 h-3.5 text-aegis-500 flex-shrink-0" />
        )}
        <span className={`font-semibold truncate ${compact ? 'text-[10px] max-w-[80px] text-gray-700 dark:text-gray-300 hidden sm:inline' : 'text-xs max-w-[140px] text-gray-800 dark:text-gray-200'}`}>
          {activeName}
        </span>
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute left-0 top-full mt-2 w-80 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700/80 rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/40 overflow-hidden z-[9000]"
          style={{ animation: 'fadeIn 0.15s ease-out' }}
        >
          {/* Search header */}
          <div className="p-3 border-b border-gray-100 dark:border-gray-800/80">
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700/50 focus-within:border-aegis-400 dark:focus-within:border-aegis-600 focus-within:ring-2 focus-within:ring-aegis-500/20 transition-all">
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('location.searchPlaceholder', lang)}
                className="flex-1 bg-transparent text-xs font-medium outline-none text-gray-900 dark:text-white placeholder-gray-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {/* Active location indicator */}
            <div className="flex items-center gap-2 mt-2 px-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 tracking-wide">
                {t('location.active', lang)} <span className="text-gray-900 dark:text-white">{activeName}</span>
              </span>
            </div>
          </div>

          {/* Scrollable list */}
          <div className="max-h-[420px] overflow-y-auto overscroll-contain">
            {filteredGroups.map(group => {
              const IconComp = ICON_MAP[group.icon] || Globe
              const isExpanded = isSearching || expandedGroup === group.id
              const hasActiveInGroup = group.filteredEntries.some(e =>
                (e.locationKey || e.code) === activeLocation ||
                (e.children || []).some(c => (c.locationKey || c.code) === activeLocation)
              )

              return (
                <div key={group.id} className="border-b border-gray-50 dark:border-gray-800/40 last:border-0">
                  {/* Group header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      hasActiveInGroup
                        ? 'bg-aegis-50/50 dark:bg-aegis-950/20'
                        : 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      hasActiveInGroup
                        ? 'bg-aegis-100 dark:bg-aegis-900/40 text-aegis-600 dark:text-aegis-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      <IconComp className="w-3.5 h-3.5" />
                    </div>
                    <span className={`flex-1 text-xs font-bold tracking-wide ${
                      hasActiveInGroup ? 'text-aegis-700 dark:text-aegis-300' : 'text-gray-700 dark:text-gray-300'
                    }`}>
                      {group.label}
                    </span>
                    <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                      {group.filteredEntries.length}
                    </span>
                    <ChevronRight className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>

                  {/* Group entries */}
                  {isExpanded && (
                    <div className="pb-1">
                      {group.filteredEntries.map((entry, idx) => {
                        const effectiveKey = entry.locationKey || entry.code
                        const isActive = effectiveKey === activeLocation
                        const hasDetailedData = !!entry.locationKey && availableKeys.has(entry.locationKey)
                        const hasChildren = entry.children && entry.children.length > 0
                        const entryId = `${group.id}-${entry.code}`
                        const isEntryExpanded = isSearching || expandedEntry === entryId
                        const hasActiveChild = hasChildren && entry.children!.some(c => (c.locationKey || c.code) === activeLocation)

                        return (
                          <div key={`${entry.code}-${idx}`}>
                            <button
                              type="button"
                              onClick={() => {
                                if (hasChildren) {
                                  setExpandedEntry(prev => prev === entryId ? null : entryId)
                                  return
                                }
                                handleSelect(entry)
                              }}
                              className={`w-full flex items-center gap-2.5 pl-12 pr-4 py-2 text-left transition-all duration-150 ${
                                isActive || hasActiveChild
                                  ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:pl-[52px]'
                              }`}
                            >
                              {entry.code ? (
                                <img src={getFlagUrl(entry.code, 20)} alt={entry.label} className="w-5 h-[14px] object-cover rounded-[2px] shadow-sm flex-shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                              ) : (
                                <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              )}
                              <span className={`flex-1 text-xs truncate ${isActive ? 'font-bold' : 'font-medium'}`}>{entry.label}</span>
                              {hasChildren && (
                                <ChevronRight className={`w-3 h-3 text-gray-400 transition-transform duration-200 flex-shrink-0 ${isEntryExpanded ? 'rotate-90' : ''}`} />
                              )}
                              {isActive ? (
                                <Check className="w-3.5 h-3.5 text-aegis-500 flex-shrink-0" />
                              ) : hasDetailedData ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 opacity-60 flex-shrink-0" />
                              ) : !hasChildren ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 opacity-40 flex-shrink-0" />
                              ) : null}
                            </button>
                            {/* Children sub-items */}
                            {hasChildren && isEntryExpanded && (
                              <div className="border-l-2 border-aegis-200 dark:border-aegis-800 ml-14">
                                {entry.children!.map((child, ci) => {
                                  const childKey = child.locationKey || child.code
                                  const isChildActive = childKey === activeLocation
                                  const childHasData = !!child.locationKey && availableKeys.has(child.locationKey)
                                  return (
                                    <button
                                      key={`${child.code}-${ci}`}
                                      type="button"
                                      onClick={() => handleSelect(child)}
                                      className={`w-full flex items-center gap-2 pl-4 pr-4 py-1.5 text-left transition-all duration-150 ${
                                        isChildActive
                                          ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300'
                                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                                      }`}
                                    >
                                      {child.code ? (
                                        <img src={getFlagUrl(child.code, 16)} alt={child.label} className="w-4 h-[11px] object-cover rounded-[1px] shadow-sm flex-shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                      ) : (
                                        <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                      )}
                                      <span className={`flex-1 text-[11px] truncate ${isChildActive ? 'font-bold' : 'font-medium'}`}>{child.label}</span>
                                      {isChildActive ? (
                                        <Check className="w-3 h-3 text-aegis-500 flex-shrink-0" />
                                      ) : childHasData ? (
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 opacity-60 flex-shrink-0" />
                                      ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 opacity-40 flex-shrink-0" />
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {filteredGroups.length === 0 && (
              <div className="py-8 text-center">
                <Search className="w-5 h-5 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-400 dark:text-gray-500">{t('location.noResults', lang)}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-900/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500">{t('location.detailedMonitoring', lang)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 opacity-60" />
                <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500">{t('location.countryOverview', lang)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

