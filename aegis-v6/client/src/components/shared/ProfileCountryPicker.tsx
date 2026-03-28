/**
 * ProfileCountryPicker.tsx — Advanced country & region selector for user profiles.
 * Same stunning design as LocationDropdown (flags via flagcdn.com, continent groups,
 * searchable, counts) but tailored for choosing a user's home country + region.
 * No Global/Continents entries — only real countries.
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, ChevronDown, ChevronRight, Check, X,
  Globe, Globe2, Landmark, Sun, Mountain, MapPin, TreePine, Waves, Crown,
} from 'lucide-react'
import { WORLD_REGIONS, getFlagUrl, type RegionGroup, type RegionEntry } from '../../data/worldRegions'

const ICON_MAP: Record<string, React.ElementType> = {
  Globe, Globe2, Landmark, Sun, Mountain, MapPin, TreePine, Waves, Crown,
}

/** Only continent groups that contain actual countries (skip global & continents meta-groups) */
const COUNTRY_GROUPS = WORLD_REGIONS.filter(g => !['global', 'continents'].includes(g.id))

interface ProfileCountryPickerProps {
  value: string
  onChange: (country: string, code: string) => void
  /** 'name' = value is country name (default), 'code' = value is ISO code */
  valueType?: 'name' | 'code'
  className?: string
  disabled?: boolean
}

export default function ProfileCountryPicker({
  value,
  onChange,
  valueType = 'name',
  className = '',
  disabled = false,
}: ProfileCountryPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Find selected entry from value (country name or code depending on valueType)
  const selected = useMemo(() => {
    if (!value) return null
    const q = value.toLowerCase()
    for (const g of COUNTRY_GROUPS) {
      for (const e of g.entries) {
        if (valueType === 'code' ? e.code === q : e.label.toLowerCase() === q) return e
        if (e.children) {
          const child = e.children.find(c => valueType === 'code' ? c.code === q : c.label.toLowerCase() === q)
          if (child) return child
        }
      }
    }
    return null
  }, [value])

  // Close on outside click (check both trigger and portal dropdown)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Compute portal position from trigger button rect
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const goUp = spaceBelow < 360
      setDropUp(goUp)
      setPortalStyle({
        position: 'fixed',
        left: rect.left,
        width: Math.max(rect.width, 320),
        ...(goUp
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
        zIndex: 9999,
      })
    }
  }, [open])

  // Focus search when opened, auto-expand group with selected entry
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 60)
      if (value) {
        const q = value.toLowerCase()
        for (const g of COUNTRY_GROUPS) {
          if (g.entries.some(e =>
            (valueType === 'code' ? e.code === q : e.label.toLowerCase() === q) ||
            (e.children || []).some(c => valueType === 'code' ? c.code === q : c.label.toLowerCase() === q)
          )) {
            setExpandedGroup(g.id)
            break
          }
        }
      }
    }
  }, [open])

  // Filtered groups
  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase().trim()
    return COUNTRY_GROUPS.map(g => ({
      ...g,
      filteredEntries: q
        ? g.entries.filter(e =>
            e.label.toLowerCase().includes(q) ||
            e.code.toLowerCase().includes(q) ||
            (e.children || []).some(c =>
              c.label.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)))
        : g.entries,
    })).filter(g => g.filteredEntries.length > 0)
  }, [search])

  const isSearching = search.trim().length > 0

  /** Display label for trigger button — always uses entry.label */
  const displayValue = selected?.label || (valueType === 'code' && value ? value.toUpperCase() : value)

  const handleSelect = (entry: RegionEntry) => {
    onChange(entry.label, entry.code)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2.5 rounded-xl border transition-all duration-200 px-3.5 py-2.5 text-left ${
          open
            ? 'border-aegis-400 dark:border-aegis-600 bg-aegis-50/50 dark:bg-aegis-950/30 shadow-md shadow-aegis-500/10'
            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {selected?.code ? (
          <img
            src={getFlagUrl(selected.code, 20)}
            alt=""
            className="w-5 h-[14px] object-cover rounded-[2px] shadow-sm flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        <span className={`flex-1 text-sm truncate ${value ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
          {displayValue || 'Select your country...'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel — rendered via portal to escape stacking context */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700/80 rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/40 overflow-hidden"
          style={{ ...portalStyle, animation: 'fadeIn 0.15s ease-out' }}
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
                placeholder="Search countries..."
                className="flex-1 bg-transparent text-xs font-medium outline-none text-gray-900 dark:text-white placeholder-gray-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {/* Current selection indicator */}
            {displayValue && (
              <div className="flex items-center gap-2 mt-2 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 tracking-wide">
                  Selected: <span className="text-gray-900 dark:text-white">{displayValue}</span>
                </span>
              </div>
            )}
          </div>

          {/* Scrollable list */}
          <div className="max-h-[300px] overflow-y-auto overscroll-contain">
            {filteredGroups.map(group => {
              const IconComp = ICON_MAP[group.icon] || Globe
              const isExpanded = isSearching || expandedGroup === group.id
              const q = (selected?.label || value || '').toLowerCase()
              const hasActiveInGroup = group.filteredEntries.some(e =>
                e.label.toLowerCase() === q ||
                (e.children || []).some(c => c.label.toLowerCase() === q)
              )

              return (
                <div key={group.id} className="border-b border-gray-50 dark:border-gray-800/40 last:border-0">
                  {/* Group header */}
                  <button
                    type="button"
                    onClick={() => setExpandedGroup(prev => (prev === group.id ? null : group.id))}
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
                        const isActive = entry.label.toLowerCase() === q
                        const hasChildren = entry.children && entry.children.length > 0
                        const hasActiveChild = hasChildren && entry.children!.some(c => c.label.toLowerCase() === q)

                        return (
                          <div key={`${entry.code}-${idx}`}>
                            <button
                              type="button"
                              onClick={() => {
                                if (!hasChildren) handleSelect(entry)
                              }}
                              className={`w-full flex items-center gap-2.5 pl-12 pr-4 py-2 text-left transition-all duration-150 ${
                                isActive || hasActiveChild
                                  ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:pl-[52px]'
                              }`}
                            >
                              {entry.code ? (
                                <img
                                  src={getFlagUrl(entry.code, 20)}
                                  alt={entry.label}
                                  className="w-5 h-[14px] object-cover rounded-[2px] shadow-sm flex-shrink-0"
                                  loading="lazy"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                              ) : (
                                <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              )}
                              <span className={`flex-1 text-xs truncate ${isActive ? 'font-bold' : 'font-medium'}`}>{entry.label}</span>
                              {hasChildren && (
                                <span className="text-[9px] text-gray-400 mr-1">{entry.children!.length}</span>
                              )}
                              {isActive && <Check className="w-3.5 h-3.5 text-aegis-500 flex-shrink-0" />}
                            </button>
                            {/* Children (sub-regions like England, Scotland) */}
                            {hasChildren && (
                              <div className="border-l-2 border-aegis-200/50 dark:border-aegis-800/50 ml-14">
                                {entry.children!.map((child, ci) => {
                                  const isChildActive = child.label.toLowerCase() === q
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
                                        <img
                                          src={getFlagUrl(child.code, 16)}
                                          alt={child.label}
                                          className="w-4 h-[11px] object-cover rounded-[1px] shadow-sm flex-shrink-0"
                                          loading="lazy"
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                        />
                                      ) : (
                                        <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                      )}
                                      <span className={`flex-1 text-[11px] truncate ${isChildActive ? 'font-bold' : 'font-medium'}`}>{child.label}</span>
                                      {isChildActive && <Check className="w-3 h-3 text-aegis-500 flex-shrink-0" />}
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
                <p className="text-xs text-gray-400 dark:text-gray-500">No countries match your search</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-900/50">
            <p className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 text-center">
              {COUNTRY_GROUPS.reduce((sum, g) => sum + g.entries.length, 0)} countries across {COUNTRY_GROUPS.length} continents
            </p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * ProfileRegionPicker — Select a region/state within the chosen country.
 * Uses worldRegions children if available, otherwise falls back to REGION_MAP from allCountries.
 */
import { REGION_MAP } from '../../data/allCountries'

interface ProfileRegionPickerProps {
  country: string
  value: string
  onChange: (region: string) => void
  className?: string
  disabled?: boolean
}

export function ProfileRegionPicker({ country, value, onChange, className = '', disabled = false }: ProfileRegionPickerProps) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Check for worldRegions children first (e.g. UK → England, Scotland, Wales, NI)
  const worldChildren = useMemo(() => {
    if (!country) return []
    const q = country.toLowerCase()
    for (const g of COUNTRY_GROUPS) {
      for (const e of g.entries) {
        if (e.label.toLowerCase() === q && e.children && e.children.length > 0) {
          return e.children
        }
      }
    }
    return []
  }, [country])

  // Fall back to REGION_MAP from allCountries
  const regions = useMemo(() => {
    if (worldChildren.length > 0) return null // use worldChildren instead
    return REGION_MAP[country] || []
  }, [country, worldChildren])

  const hasOptions = worldChildren.length > 0 || (regions && regions.length > 0)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Viewport-aware positioning
  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setDropUp(window.innerHeight - rect.bottom < 300)
    }
  }, [open])

  // If no country or no predefined regions, show text input
  if (!country || !hasOptions) {
    return (
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={country ? 'Enter your region or city...' : 'Select a country first'}
        className={`w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      />
    )
  }

  // Dropdown for countries with predefined regions
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2.5 rounded-xl border transition-all duration-200 px-3.5 py-2.5 text-left ${
          open
            ? 'border-aegis-400 dark:border-aegis-600 bg-aegis-50/50 dark:bg-aegis-950/30 shadow-md'
            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {/* Show flag for worldChildren entries */}
        {worldChildren.length > 0 && value ? (() => {
          const child = worldChildren.find(c => c.label === value)
          return child?.code ? (
            <img src={getFlagUrl(child.code, 16)} alt="" className="w-4 h-[11px] object-cover rounded-[1px] shadow-sm flex-shrink-0" loading="lazy" />
          ) : <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
        })() : (
          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        <span className={`flex-1 text-sm truncate ${value ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}`}>
          {value || 'Select a region...'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`absolute left-0 ${dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700/80 rounded-xl shadow-2xl shadow-black/15 dark:shadow-black/40 overflow-hidden z-[60] max-h-[280px] overflow-y-auto`}>
          {/* Clear option */}
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] border-b border-gray-100 dark:border-gray-800/60"
          >
            <X className="w-3 h-3" /> Clear selection
          </button>

          {worldChildren.length > 0 ? (
            // World regions children (e.g. UK nations)
            worldChildren.map((child, i) => {
              const isActive = child.label === value
              return (
                <button
                  key={`${child.code}-${i}`}
                  type="button"
                  onClick={() => { onChange(child.label); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-all ${
                    isActive
                      ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  {child.code ? (
                    <img src={getFlagUrl(child.code, 20)} alt="" className="w-5 h-[14px] object-cover rounded-[2px] shadow-sm flex-shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                  <span className={`flex-1 text-xs ${isActive ? 'font-bold' : 'font-medium'}`}>{child.label}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-aegis-500" />}
                </button>
              )
            })
          ) : (
            // REGION_MAP entries
            regions!.map((r, i) => {
              const isActive = r.label === value
              return (
                <button
                  key={`${r.value}-${i}`}
                  type="button"
                  onClick={() => { onChange(r.label); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-all ${
                    isActive
                      ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className={`flex-1 text-xs ${isActive ? 'font-bold' : 'font-medium'}`}>{r.label}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-aegis-500" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
