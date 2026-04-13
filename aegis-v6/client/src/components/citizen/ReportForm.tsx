import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronRight, ChevronLeft, MapPin, Camera, Send, AlertTriangle, CheckCircle, Wind, Flame, Droplets, Home, Construction, Zap, Users, Siren } from 'lucide-react'
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, useMapEvents, useMap, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { INCIDENT_CATEGORIES, DISASTER_SUBTYPES, SEVERITY_LEVELS, TRAPPED_OPTIONS } from '../../data/disasterTypes'
import { LucideIcon } from '../../utils/iconMap'
import { useReports } from '../../contexts/ReportsContext'
import { useAlerts } from '../../contexts/AlertsContext'
import type { ReportFormData, IncidentCategoryKey, SeverityLevel, TrappedOption, LocationMetadata, LocationSource } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'
import { useConfetti } from '../ui/ConfettiEffect'

interface Props { onClose: () => void }

interface AddressSuggestion {
  label: string
  lat: number
  lng: number
}

interface TileProvider {
  name: string
  attribution: string
  url: string
}

type LocationConfidenceBand = 'high' | 'medium' | 'poor'

interface FinalLocationSelection {
  lat: number
  lng: number
  accuracy: number | null
  source: LocationSource
  confidence: LocationConfidenceBand
  confirmed: boolean
}

// Quick observation tags for any incident type
const QUICK_OBSERVATIONS = [
  { key: 'smoke_visible',    icon: Wind,         label: 'Smoke visible' },
  { key: 'flames_fire',     icon: Flame,        label: 'Flames / fire' },
  { key: 'flooding_water',  icon: Droplets,     label: 'Flooding / water' },
  { key: 'building_damage', icon: Home,          label: 'Building damage' },
  { key: 'road_blocked',    icon: Construction,  label: 'Road blocked' },
  { key: 'power_lines',     icon: Zap,           label: 'Power lines down' },
  { key: 'evacuating',      icon: Users,         label: 'People evacuating' },
  { key: 'emer_services',   icon: Siren,         label: 'Emergency services' },
]

// Same tile providers as DisasterMap/LiveMap — direct CDN, no proxy dependency
const FREE_TILE_PROVIDERS: TileProvider[] = [
  {
    name: 'Map',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  {
    name: 'Topo',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  },
  {
    name: 'Satellite',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  {
    name: 'Dark',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  },
]

function MapClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }): null {
  const map = useMap()
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  })
  useEffect(() => {
    // Show crosshair so users know the map is clickable
    map.getContainer().style.cursor = 'crosshair'
    return () => { map.getContainer().style.cursor = '' }
  }, [map])
  return null
}

function MapModalResizeFix({ visible }: { visible: boolean }): null {
  const map = useMap()
  useEffect(() => {
    if (!visible) return
    // Use ResizeObserver instead of brittle hardcoded timeouts
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    // Also invalidate once immediately on mount
    map.invalidateSize()
    return () => observer.disconnect()
  }, [map, visible])
  return null
}

function MapFlyTo({ coords }: { coords: [number, number] | null }): null {
  const map = useMap()
  const prevRef = useRef<[number, number] | null>(null)
  useEffect(() => {
    if (!coords) return
    const prev = prevRef.current
    const moved = !prev || Math.abs(prev[0] - coords[0]) > 0.0001 || Math.abs(prev[1] - coords[1]) > 0.0001
    if (moved) {
      prevRef.current = coords
      map.flyTo(coords, Math.max(map.getZoom(), 15), { duration: 0.8, easeLinearity: 0.5 })
    }
  }, [coords, map])
  return null
}

// Searchable combobox for incident category / subtype selection
// Uses fixed positioning so the dropdown escapes overflow:hidden/auto modal containers
interface SearchableOption { key: string; label: string; icon?: string }
function SearchableSelect({
  options,
  value,
  placeholder,
  onChange,
}: {
  options: SearchableOption[]
  value: string
  placeholder: string
  onChange: (key: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.key === value)
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  // Compute fixed position from input rect so dropdown escapes overflow clipping
  const openDropdown = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const dropHeight = Math.min(240, options.length * 44 + 16)
      const showAbove = spaceBelow < dropHeight && spaceAbove > dropHeight
      // Clamp maxHeight to available viewport space (mobile overflow fix)
      const maxH = Math.min(240, (showAbove ? spaceAbove : spaceBelow) - 8)
      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        maxHeight: `${Math.max(120, maxH)}px`,
        ...(showAbove
          ? { bottom: window.innerHeight - rect.top + 4, top: 'auto' }
          : { top: rect.bottom + 4, bottom: 'auto' }),
        zIndex: 9999,
      })
    }
    setOpen(true)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const dropHeight = Math.min(240, options.length * 44 + 16)
        const showAbove = spaceBelow < dropHeight && rect.top > dropHeight
        setDropdownStyle(prev => ({
          ...prev,
          left: rect.left,
          width: rect.width,
          ...(showAbove
            ? { bottom: window.innerHeight - rect.top + 4, top: 'auto' }
            : { top: rect.bottom + 4, bottom: 'auto' }),
        }))
      }
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, options.length])

  const handleSelect = useCallback((key: string) => {
    onChange(key)
    setOpen(false)
    setQuery('')
  }, [onChange])

  return (
    <div ref={containerRef}>
      {/* Input box */}
      <div
        className={`input flex items-center gap-2 cursor-text ${open ? 'ring-2 ring-aegis-500' : ''}`}
        onClick={() => { openDropdown(); inputRef.current?.focus() }}
      >
        {selected && !open ? (
          <>
            {selected.icon && <LucideIcon name={selected.icon} className="w-4 h-4 text-aegis-600 shrink-0" />}
            <span className="flex-1 text-sm">{selected.label}</span>
            <button
              type="button"
              className="ml-1 text-gray-400 hover:text-gray-600 text-xs"
              onClick={e => { e.stopPropagation(); onChange(''); setQuery('') }}
              aria-label="Clear selection"
            >✕</button>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
              placeholder={open ? 'Type to filter…' : placeholder}
              value={query}
              onChange={e => { setQuery(e.target.value); if (!open) openDropdown() }}
              onFocus={() => openDropdown()}
              autoComplete="off"
            />
            <span className="text-gray-400 text-xs select-none">{open ? '▲' : '▼'}</span>
          </>
        )}
      </div>

      {/* Dropdown — rendered at fixed viewport position to escape overflow clipping */}
      {open && (
        <ul
          style={dropdownStyle}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No results for "{query}"</li>
          ) : (
            filtered.map(opt => (
              <li
                key={opt.key}
                role="option"
                aria-selected={opt.key === value}
                className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer text-sm hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-colors ${
                  opt.key === value ? 'bg-aegis-100 dark:bg-aegis-900/40 font-medium text-aegis-700 dark:text-aegis-300' : ''
                }`}
                onMouseDown={e => { e.preventDefault(); handleSelect(opt.key) }}
              >
                {opt.icon && <LucideIcon name={opt.icon} className="w-4 h-4 text-aegis-500 shrink-0" />}
                <span>{opt.label}</span>
                {opt.key === value && <span className="ml-auto text-aegis-600 text-xs">✓</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

// Draggable drop-pin for precision location correction
function DraggablePin({
  position,
  onMove,
  isPinned,
}: {
  position: [number, number]
  onMove: (lat: number, lng: number) => void
  isPinned: boolean
}): JSX.Element {
  const markerRef = useRef<L.Marker | null>(null)
  const colour = isPinned ? '#7c3aed' : '#dc2626'
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'leaflet-map-pin-icon',
        html: `<div style="position:relative;width:28px;height:36px">
          <div style="width:22px;height:22px;background:${colour};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 10px rgba(0,0,0,0.4);position:absolute;top:0;left:3px;"></div>
          <div style="width:5px;height:5px;background:rgba(0,0,0,0.2);border-radius:50%;position:absolute;bottom:1px;left:12px;"></div>
        </div>`,
        iconSize: [28, 36],
        iconAnchor: [14, 36],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colour],
  )
  return (
    <Marker
      position={position}
      icon={icon}
      draggable
      ref={markerRef}
      eventHandlers={{
        dragend: () => {
          const m = markerRef.current
          if (m) { const { lat, lng } = m.getLatLng(); onMove(lat, lng) }
        },
      }}
    />
  )
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const earthRadiusKm = 6371
  const dLat = toRadians(bLat - aLat)
  const dLng = toRadians(bLng - aLng)
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
  return earthRadiusKm * c
}

const scoreSuggestion = (
  query: string,
  label: string,
  lat: number,
  lng: number,
  biasCoords: [number, number] | null
): number => {
  const q = query.trim().toLowerCase()
  const text = label.toLowerCase()
  let score = 0

  if (text === q) score += 120
  else if (text.startsWith(q)) score += 90
  else if (text.includes(q)) score += 55

  // Reward house-number/postcode exact snippets for precise address picking.
  const qTokens = q.split(/[\s,]+/).filter(Boolean)
  for (const token of qTokens) {
    if (token.length < 2) continue
    if (text.includes(token)) score += 8
  }

  if (biasCoords) {
    const km = distanceKm(biasCoords[0], biasCoords[1], lat, lng)
    if (km <= 1) score += 45
    else if (km <= 5) score += 28
    else if (km <= 15) score += 14
    else if (km <= 40) score += 4
    else score -= Math.min(20, km / 20)
  }

  return score
}

const calculateLocationConfidence = (
  source: LocationSource,
  accuracy: number | null,
  userCorrected: boolean
): number => {
  const sourceBase: Record<LocationSource, number> = {
    gps: 0.78,
    map_pin: 0.95,
    address_search: 0.82,
    manual_coordinates: 0.72,
    manual_text: 0.55,
  }

  let confidence = sourceBase[source] ?? 0.5
  if (typeof accuracy === 'number') {
    if (accuracy <= 25) confidence += 0.15
    else if (accuracy <= 50) confidence += 0.1
    else if (accuracy <= 150) confidence += 0.03
    else confidence -= 0.12
  }
  if (userCorrected) confidence += 0.03

  return Math.max(0.05, Math.min(0.99, Number(confidence.toFixed(2))))
}

const confidenceBandFromAccuracy = (accuracy: number | null): LocationConfidenceBand => {
  if (accuracy == null) return 'medium'
  if (accuracy < 50) return 'high'
  if (accuracy <= 150) return 'medium'
  return 'poor'
}

// Per-incident description placeholders
const DESCRIPTION_PLACEHOLDERS: Record<string, string> = {
  flood:                    'Describe water levels, affected streets, properties under water, people at risk...',
  severe_storm:             'Describe wind damage, fallen trees, structural damage, visibility issues...',
  heatwave:                 'Describe heat conditions, access to cooling, vulnerable people affected...',
  wildfire:                 'Describe fire location, spread direction, smoke density, visible flames...',
  landslide:                'Describe slope failure, debris, road blockage, ongoing ground movement...',
  drought:                  'Describe water access issues, crop damage, river or reservoir conditions...',
  power_outage:             'Describe affected area, critical services impacted, estimated outage duration...',
  water_supply_disruption:  'Describe water outage location, contamination concerns, how long affected...',
  water_supply:             'Describe water access issues, outage scope, affected households...',
  infrastructure_damage:    'Describe damaged asset, service disruption, whether access is restricted...',
  public_safety_incident:   'Describe the situation, people involved, immediate risks...',
  environmental_hazard:     'Describe the hazard type, materials involved, area and people affected...',
}

// Per-incident custom field definitions
type FieldType = 'boolean' | 'number' | 'select' | 'text'
interface CustomFieldDef { key: string; type: FieldType; options?: string[] }

const CUSTOM_FIELD_DEFS: Record<string, CustomFieldDef[]> = {
  flood: [
    { key: 'waterDepthCm', type: 'number' },
    { key: 'blockedRoutes', type: 'boolean' },
    { key: 'powerLinesDown', type: 'boolean' },
  ],
  severe_storm: [
    { key: 'windDamage', type: 'boolean' },
    { key: 'hailPresent', type: 'boolean' },
    { key: 'powerLinesDown', type: 'boolean' },
    { key: 'roadBlocked', type: 'boolean' },
  ],
  heatwave: [
    { key: 'temperatureC', type: 'number' },
    { key: 'vulnerablePeopleAffected', type: 'boolean' },
    { key: 'waterAccessIssues', type: 'boolean' },
  ],
  wildfire: [
    { key: 'smokeIntensity', type: 'select', options: ['light', 'moderate', 'heavy', 'extreme'] },
    { key: 'flameVisible', type: 'boolean' },
    { key: 'evacuationNeeded', type: 'boolean' },
  ],
  landslide: [
    { key: 'roadBlocked', type: 'boolean' },
    { key: 'slopeFailureExtent', type: 'select', options: ['small', 'moderate', 'large', 'massive'] },
    { key: 'ongoingMovement', type: 'boolean' },
  ],
  drought: [
    { key: 'cropDamageReported', type: 'boolean' },
    { key: 'waterRestrictions', type: 'boolean' },
    { key: 'riverLevelLow', type: 'boolean' },
  ],
  power_outage: [
    { key: 'outageDurationHours', type: 'number' },
    { key: 'criticalServicesImpacted', type: 'boolean' },
    { key: 'areaWide', type: 'boolean' },
  ],
  water_supply_disruption: [
    { key: 'waterUnavailable', type: 'boolean' },
    { key: 'contaminationSuspected', type: 'boolean' },
    { key: 'durationHours', type: 'number' },
  ],
  infrastructure_damage: [
    { key: 'assetType', type: 'select', options: ['road', 'bridge', 'building', 'utility', 'other'] },
    { key: 'serviceDisruption', type: 'boolean' },
    { key: 'accessRestricted', type: 'boolean' },
  ],
  public_safety_incident: [
    { key: 'injuriesReported', type: 'boolean' },
    { key: 'crowdSize', type: 'select', options: ['small (<20)', 'medium (20–100)', 'large (100+)'] },
    { key: 'policeRequired', type: 'boolean' },
  ],
  environmental_hazard: [
    { key: 'hazardMaterial', type: 'text' },
    { key: 'airOrWaterImpact', type: 'boolean' },
    { key: 'containmentNeeded', type: 'boolean' },
  ],
}

export default function ReportForm({ onClose }: Props): JSX.Element {
  const lang = useLanguage()
  const { t } = useTranslation(['incidents', 'common'])
  const { addReport } = useReports(); const { pushNotification } = useAlerts()
  const [step, setStep] = useState(1); const [errors, setErrors] = useState<Record<string, string>>({})
  const [mediaFiles, setMediaFiles] = useState<{file: File, preview: string}[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const { triggerConfetti, ConfettiOverlay } = useConfetti()
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [locationConfirmed, setLocationConfirmed] = useState(false)
  const [isSelectingSuggestion, setIsSelectingSuggestion] = useState(false)
  const [isSearchingAddress, setIsSearchingAddress] = useState(false)
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(null)
  const [gpsCoords, setGpsCoords] = useState<[number, number] | null>(null)
  const [manualPinCoords, setManualPinCoords] = useState<[number, number] | null>(null)
  const [finalLocation, setFinalLocation] = useState<FinalLocationSelection | null>(null)
  const [showMapPicker, setShowMapPicker] = useState(true)
  const [reportNotAtMyLocation, setReportNotAtMyLocation] = useState(false)
  const [locationSource, setLocationSource] = useState<LocationSource>('manual_text')
  const [userCorrectedLocation, setUserCorrectedLocation] = useState(false)
  const [tileProviderIndex, setTileProviderIndex] = useState(0)
  const [tileLoaded, setTileLoaded] = useState(false)
  const [tileErrorCount, setTileErrorCount] = useState(0)
  const [allTileProvidersFailed, setAllTileProvidersFailed] = useState(false)
  const [customFields, setCustomFields] = useState<Record<string, boolean | number | string>>({})
  const [gpsConsentOpen, setGpsConsentOpen] = useState(false)
  const [gpsConsentSource, setGpsConsentSource] = useState<'auto' | 'manual'>('manual')
  const [autoGpsPromptSeen, setAutoGpsPromptSeen] = useState(false)
  // Extra intelligence fields
  const [incidentTime, setIncidentTime] = useState('')
  const [estimatedAffected, setEstimatedAffected] = useState('')
  const [observedConditions, setObservedConditions] = useState<string[]>([])
  const addressCacheRef = useRef<Map<string, AddressSuggestion[]>>(new Map())
  const searchAbortRef = useRef<AbortController | null>(null)
  const reverseAbortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ReportFormData>({ incidentCategory: '', incidentSubtype: '', description: '', severity: '', trappedPersons: '', location: '', otherSpecify: '', hasMedia: false, mediaType: '' })

  const up = (f: keyof ReportFormData, v: string | boolean): void => { setForm(p => ({ ...p, [f]: v })); setErrors(p => { const n = { ...p }; delete n[f]; return n }) }
  const upCustom = (key: string, val: boolean | number | string | undefined): void => {
    setCustomFields(p => {
      if (val === undefined) {
        const { [key]: _removed, ...rest } = p
        return rest
      }
      return { ...p, [key]: val }
    })
  }

  const MAX_IMAGES = 3
  const MIN_IMAGES = 0
  const MAX_SIZE_MB = 10
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
  const defaultLat = Number(import.meta.env.VITE_DEFAULT_REPORT_LAT ?? 57.15)
  const defaultLng = Number(import.meta.env.VITE_DEFAULT_REPORT_LNG ?? -2.09)
  const nominatimCountryCodes = String(import.meta.env.VITE_NOMINATIM_COUNTRY_CODES || 'gb')

  // Reset custom fields when subtype changes
  useEffect(() => { setCustomFields({}) }, [form.incidentSubtype])

  useEffect(() => {
    if (!showMapPicker) return
    setTileLoaded(false)
    setTileErrorCount(0)
    setAllTileProvidersFailed(false)
  }, [showMapPicker, tileProviderIndex])

  useEffect(() => {
    if (!showMapPicker || tileLoaded || allTileProvidersFailed) return

    const failoverTimer = window.setTimeout(() => {
      if (tileLoaded) return
      setTileProviderIndex((idx) => {
        if (idx < FREE_TILE_PROVIDERS.length - 1) {
          return idx + 1
        }
        setAllTileProvidersFailed(true)
        return idx
      })
      setTileErrorCount(0)
    }, 4500)

    return () => window.clearTimeout(failoverTimer)
  }, [allTileProvidersFailed, showMapPicker, tileLoaded, tileProviderIndex])

  const handleTileError = (): void => {
    setTileErrorCount((prev) => {
      const next = prev + 1
      // If provider repeatedly fails, rotate to next free provider.
      if (next >= 5 && tileProviderIndex < FREE_TILE_PROVIDERS.length - 1) {
        setTileProviderIndex((idx) => Math.min(idx + 1, FREE_TILE_PROVIDERS.length - 1))
        return 0
      }
      if (next >= 5 && tileProviderIndex === FREE_TILE_PROVIDERS.length - 1) {
        setAllTileProvidersFailed(true)
      }
      return next
    })
  }

  const handleTileLoad = (): void => {
    setTileLoaded(true)
    setAllTileProvidersFailed(false)
  }

  const activeSubtype = form.incidentSubtype || form.incidentCategory
  const customFieldDefs = CUSTOM_FIELD_DEFS[activeSubtype] || []
  const descriptionPlaceholder = DESCRIPTION_PLACEHOLDERS[activeSubtype]
    || 'Describe what you can see — damage, affected people, immediate risks...'

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    const remaining = MAX_IMAGES - mediaFiles.length
    if (remaining <= 0) { pushNotification(`Maximum ${MAX_IMAGES} images allowed.`, 'warning'); return }
    const validFiles = files.slice(0, remaining).filter(f => {
      if (!ACCEPTED_TYPES.includes(f.type)) { pushNotification(`${f.name}: Only JPG, PNG, WEBP accepted.`, 'warning'); return false }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) { pushNotification(`${f.name}: Max size ${MAX_SIZE_MB}MB.`, 'warning'); return false }
      return true
    })
    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setMediaFiles(prev => [...prev, { file, preview: ev.target?.result as string }])
        up('hasMedia', true); up('mediaType', 'photo')
      }
      reader.readAsDataURL(file)
    })
    if (validFiles.length > 0) pushNotification(`${validFiles.length} image(s) attached.`, 'success')
    if (e.target) e.target.value = ''
  }

  const removeMedia = (idx: number): void => {
    setMediaFiles(prev => {
      const next = prev.filter((_, i) => i !== idx)
      if (next.length === 0) { up('hasMedia', false); up('mediaType', '') }
      return next
    })
  }

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (step === 1 && !form.incidentCategory) e.incidentCategory = 'Select type'
    if (step === 2 && !form.incidentSubtype) e.incidentSubtype = 'Select subtype'
    if (step === 3 && form.description.length < 10) e.description = 'Min 10 chars'
    if (step === 4 && !form.severity) e.severity = 'Select severity'
    if (step === 5 && !form.trappedPersons) e.trappedPersons = 'Please answer'
    if (step === 6 && form.location.length < 3) e.location = 'Add location'
    if (step === 6 && reportNotAtMyLocation && locationSource !== 'map_pin') {
      e.location = 'Please pin the exact incident spot on the map'
    }
    if (step === 6 && !locationConfirmed) {
      e.location = 'Please confirm the final location before submitting'
    }
    setErrors(e); return Object.keys(e).length === 0
  }

  const next = (): void => { if (validate()) { let ns = step + 1; if (step === 1 && form.incidentCategory) { const hasSubs = (DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]?.length ?? 0) > 0; if (!hasSubs) ns = 3 } setStep(Math.min(ns, 6)) } }
  const prev = (): void => { let ps = step - 1; if (step === 3 && form.incidentCategory) { const hasSubs = (DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]?.length ?? 0) > 0; if (!hasSubs) ps = 1 } setStep(Math.max(ps, 1)) }

  const submit = (): void => {
    void (async () => {
      if (!validate() || isSubmitting) return
      if (mediaFiles.length < MIN_IMAGES) {
        pushNotification(`Please attach at least ${MIN_IMAGES} photos as evidence before submitting.`, 'warning')
        return
      }
      setIsSubmitting(true)
      try {
        const subs = DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey] || []
        const sub = subs.find(s => s.key === form.incidentSubtype)
        const cat = INCIDENT_CATEGORIES.find(c => c.key === form.incidentCategory)
        const parsed = parseCoordinateInput(form.location)
        const coords: [number, number] = finalLocation
          ? [finalLocation.lat, finalLocation.lng]
          : selectedCoords || parsed || [defaultLat, defaultLng]
        const source: LocationSource = finalLocation
          ? finalLocation.source
          : selectedCoords
            ? locationSource
            : parsed
              ? 'manual_coordinates'
              : 'manual_text'
        const locationMetadata = buildLocationMetadata(coords, source)

        await addReport({
          incidentCategory: form.incidentCategory as IncidentCategoryKey,
          incidentSubtype: form.incidentSubtype,
          type: `${cat?.label || ''} — ${sub?.label || form.incidentSubtype}`,
          description: form.description,
          severity: form.severity as SeverityLevel,
          trappedPersons: form.trappedPersons as TrappedOption,
          location: form.location,
          coordinates: coords,
          hasMedia: form.hasMedia,
          mediaType: form.hasMedia ? (form.mediaType as 'photo' | 'video') : undefined,
          customFields: (() => {
            const m: Record<string, boolean | number | string> = { ...customFields }
            if (incidentTime) m.incident_time = incidentTime
            if (estimatedAffected) m.estimated_affected = estimatedAffected
            if (observedConditions.length > 0) m.observed_conditions = observedConditions.join(', ')
            return Object.keys(m).length > 0 ? m : undefined
          })(),
          locationMetadata,
        }, mediaFiles.map(m => m.file))

        pushNotification(
          form.trappedPersons === 'yes'
            ? 'URGENT report submitted. Emergency services notified.'
            : 'Report submitted. AI review in progress.',
          form.trappedPersons === 'yes' ? 'warning' : 'success'
        )
        setSubmitted(true)
        triggerConfetti()
        setTimeout(() => onClose(), 2000)
      } catch (err: any) {
        pushNotification(err?.message || 'Failed to submit report. Please try again.', 'error')
      } finally {
        setIsSubmitting(false)
      }
    })()
  }

  const [gpsStatus, setGpsStatus] = useState<'idle'|'requesting'|'success'|'denied'>('idle')
  const [gpsAccuracy, setGpsAccuracy] = useState<number|null>(null)

  const reverseGeocodeAddress = async (lat: number, lng: number): Promise<string | null> => {
    reverseAbortRef.current?.abort()
    const controller = new AbortController()
    reverseAbortRef.current = controller

    const timeout = setTimeout(() => controller.abort(), 3500)
    try {
      const reverse = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`, {
        headers: { 'Accept-Language': 'en' },
        signal: controller.signal,
      })
      if (!reverse.ok) return null
      const data = await reverse.json()
      return data?.display_name ? String(data.display_name) : null
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  const applyGpsFix = (lat: number, lng: number, accuracy: number): void => {
    setSelectedCoords([lat, lng])
    setGpsCoords([lat, lng])
    setGpsAccuracy(Math.round(accuracy))
    setGpsStatus('success')
    setLocationSource('gps')
    setUserCorrectedLocation(false)
    setManualPinCoords(null)
    up('location', `${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    setLocationConfirmed(false)
    setShowSuggestions(false)
    setAddressSuggestions([])

    setFinalLocation({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracy: Math.round(accuracy),
      source: 'gps',
      confidence: confidenceBandFromAccuracy(accuracy),
      confirmed: false,
    })

    void (async () => {
      const resolvedAddress = await reverseGeocodeAddress(lat, lng)
      if (resolvedAddress) up('location', resolvedAddress)
    })()
  }

  const setLocationFromMapPin = (lat: number, lng: number): void => {
    setManualPinCoords([lat, lng])
    setSelectedCoords([lat, lng])
    setGpsCoords([lat, lng])
    setGpsStatus('success')
    setGpsAccuracy(null)
    setLocationSource('map_pin')
    setUserCorrectedLocation(true)
    up('location', `${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    setLocationConfirmed(false)
    setShowSuggestions(false)
    setAddressSuggestions([])
    setFinalLocation({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracy: null,
      source: 'map_pin',
      confidence: 'high',
      confirmed: false,
    })
    void (async () => {
      const resolvedAddress = await reverseGeocodeAddress(lat, lng)
      if (resolvedAddress) up('location', resolvedAddress)
    })()
  }

  const gps = (): void => {
    if (!('geolocation' in navigator)) { pushNotification('GPS not available on this device. Please enter address manually.', 'warning'); setGpsStatus('denied'); return }
    pushNotification('Requesting location to pin your report accurately...', 'info')
    setGpsStatus('requesting')
    setShowMapPicker(true)
    void (async () => {
      let bestAccuracy = Number.POSITIVE_INFINITY
      let hasFix = false

      const maybeUseFix = (pos: GeolocationPosition): void => {
        const lat = Number(pos.coords.latitude)
        const lng = Number(pos.coords.longitude)
        const accuracy = Number(pos.coords.accuracy)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return

        const shouldUpdate = !hasFix || accuracy + 20 < bestAccuracy
        if (!shouldUpdate) return

        hasFix = true
        bestAccuracy = accuracy
        applyGpsFix(lat, lng, accuracy)
      }

      try {
        // Fast first fix (better UX responsiveness)
        const quickFix = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 5000,
            maximumAge: 0,
          })
        })
        maybeUseFix(quickFix)

        // Keep refining in background for better precision.
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            maybeUseFix(pos)
            if (pos.coords.accuracy <= 30) {
              navigator.geolocation.clearWatch(watchId)
            }
          },
          () => {
            // Ignore transient watch errors.
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        )

        setTimeout(() => navigator.geolocation.clearWatch(watchId), 12000)

        const reportedAccuracy = Math.round(bestAccuracy)
        if (reportedAccuracy <= 35) {
          pushNotification(`Location captured with high precision (±${reportedAccuracy}m)`, 'success')
        } else {
          setShowMapPicker(true)
          pushNotification(`Location captured but precision is low (±${reportedAccuracy}m). Move outdoors and tap GPS again for better accuracy.`, 'warning')
        }
      } catch (err: any) {
        // If quick mode fails, attempt one high-accuracy capture before giving up.
        try {
          const fallback = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 0,
            })
          })
          maybeUseFix(fallback)
          const reportedAccuracy = Math.round(bestAccuracy)
          if (reportedAccuracy <= 35) {
            pushNotification(`Location captured with high precision (±${reportedAccuracy}m)`, 'success')
          } else {
            setShowMapPicker(true)
            pushNotification(`Location captured but precision is low (±${reportedAccuracy}m). Move outdoors and tap GPS again for better accuracy.`, 'warning')
          }
        } catch (fallbackErr: any) {
          setGpsStatus('denied')
          if (fallbackErr?.code === 1) pushNotification('Location permission denied. Please type your address or landmark instead.', 'warning')
          else pushNotification('Could not determine location accurately. Please enter address manually or retry GPS.', 'warning')
        }
      }
    })()
  }

  const requestGpsWithConsent = (source: 'auto' | 'manual'): void => {
    setGpsConsentSource(source)
    setGpsConsentOpen(true)
  }

  const confirmGpsConsent = (): void => {
    setGpsConsentOpen(false)
    if (gpsConsentSource === 'auto') setAutoGpsPromptSeen(true)
    gps()
  }

  const declineGpsConsent = (): void => {
    setGpsConsentOpen(false)
    if (gpsConsentSource === 'auto') {
      setAutoGpsPromptSeen(true)
      pushNotification('Location not requested. You can type address or tap GPS anytime.', 'info')
    }
  }

  const confirmSelectedLocation = (): void => {
    const parsed = parseCoordinateInput(form.location)
    const coords = selectedCoords || gpsCoords || parsed
    if (!coords) {
      pushNotification('Please choose a location first (GPS, search, or map pin).', 'warning')
      return
    }

    const resolvedSource: LocationSource = parsed && !selectedCoords && !gpsCoords
      ? 'manual_coordinates'
      : locationSource

    const confidence = resolvedSource === 'map_pin'
      ? 'high'
      : resolvedSource === 'manual_coordinates'
        ? 'medium'
        : confidenceBandFromAccuracy(gpsAccuracy)

    if (resolvedSource === 'gps' && confidence === 'poor') {
      setShowMapPicker(true)
      pushNotification('GPS accuracy is poor. Please place a manual map pin to confirm.', 'warning')
      return
    }

    setLocationConfirmed(true)
    setShowSuggestions(false)
    setAddressSuggestions([])
    setFinalLocation({
      lat: Number(coords[0].toFixed(6)),
      lng: Number(coords[1].toFixed(6)),
      accuracy: gpsAccuracy,
      source: resolvedSource,
      confidence,
      confirmed: true,
    })

    pushNotification(`Location confirmed (${confidence} confidence).`, 'success')
  }

  useEffect(() => {
    if (step !== 6) return
    if (autoGpsPromptSeen) return
    if (locationConfirmed || selectedCoords || gpsCoords) return
    if (form.location.trim().length < 3) return

    // Ask only after user starts typing location input, never on sudden step entry.
    setGpsConsentSource('auto')
    setGpsConsentOpen(true)
    setAutoGpsPromptSeen(true)
  }, [autoGpsPromptSeen, form.location, gpsCoords, locationConfirmed, selectedCoords, step])

  useEffect(() => {
    if (step !== 6) return
    if (isSelectingSuggestion) {
      setIsSelectingSuggestion(false)
      return
    }
    if (locationConfirmed) return
    const q = form.location.trim()
    if (q.length < 3) {
      setAddressSuggestions([])
      setShowSuggestions(false)
      return
    }
    // Skip Nominatim when value is already a coordinate pair (e.g. from GPS auto-fill)
    if (/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(q)) {
      setAddressSuggestions([])
      setShowSuggestions(false)
      return
    }

    const cached = addressCacheRef.current.get(q.toLowerCase())
    if (cached) {
      setAddressSuggestions(cached)
      setShowSuggestions(cached.length > 0)
      return
    }

    const timer = setTimeout(async () => {
      try {
        searchAbortRef.current?.abort()
        const controller = new AbortController()
        searchAbortRef.current = controller

        setIsSearchingAddress(true)
        const suggestions: AddressSuggestion[] = []
        const seen = new Set<string>()

        const postcodeLike = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(q)
        const postcodePromise = postcodeLike
          ? fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`, { signal: controller.signal })
          : Promise.resolve(null)

        const viewbox = gpsCoords
          ? `&viewbox=${gpsCoords[1] - 0.35},${gpsCoords[0] + 0.35},${gpsCoords[1] + 0.35},${gpsCoords[0] - 0.35}`
          : ''

        const nominatimPromise = fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=${encodeURIComponent(nominatimCountryCodes)}&addressdetails=1&dedupe=1&limit=10${viewbox}&q=${encodeURIComponent(q)}`, {
          headers: { 'Accept-Language': 'en' },
          signal: controller.signal,
        })

        const [postcodeResult, nominatimResult] = await Promise.allSettled([postcodePromise, nominatimPromise])

        if (postcodeResult.status === 'fulfilled' && postcodeResult.value?.ok) {
          const pcData = await postcodeResult.value.json()
          const r = pcData?.result
          if (r?.latitude && r?.longitude) {
            const label = `${(r.postcode || q).toUpperCase()}${r.admin_district ? `, ${r.admin_district}` : ''}${r.region ? `, ${r.region}` : ''}`
            seen.add(label)
            suggestions.push({ label, lat: Number(r.latitude), lng: Number(r.longitude) })
          }
        }

        if (nominatimResult.status === 'fulfilled' && nominatimResult.value.ok) {
          const rows = await nominatimResult.value.json()
          for (const row of rows || []) {
            const label = String(row.display_name || '').trim()
            if (!label || seen.has(label)) continue
            seen.add(label)
            suggestions.push({ label, lat: Number(row.lat), lng: Number(row.lon) })
          }
        }

        const ranked = suggestions
          .map((s) => ({
            ...s,
            score: scoreSuggestion(q, s.label, s.lat, s.lng, gpsCoords),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map(({ score: _score, ...s }) => s)

        addressCacheRef.current.set(q.toLowerCase(), ranked)
        setAddressSuggestions(ranked)
        setShowSuggestions(ranked.length > 0)
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        setAddressSuggestions([])
      } finally {
        setIsSearchingAddress(false)
      }
    }, 180)

    return () => {
      clearTimeout(timer)
      searchAbortRef.current?.abort()
    }
  }, [form.location, step, gpsCoords, nominatimCountryCodes, locationConfirmed, isSelectingSuggestion])

  const parseCoordinateInput = (value: string): [number, number] | null => {
    const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (!m) return null
    const lat = Number(m[1])
    const lng = Number(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return [lat, lng]
  }

  const pickSuggestion = (s: AddressSuggestion): void => {
    setIsSelectingSuggestion(true)
    up('location', s.label)
    setSelectedCoords([s.lat, s.lng])
    setGpsCoords([s.lat, s.lng])
    setManualPinCoords(null)
    setLocationSource('address_search')
    setUserCorrectedLocation(true)
    setLocationConfirmed(true)
    setAddressSuggestions([])
    setShowMapPicker(false)
    setShowSuggestions(false)
    setFinalLocation({
      lat: Number(s.lat.toFixed(6)),
      lng: Number(s.lng.toFixed(6)),
      accuracy: null,
      source: 'address_search',
      confidence: 'medium',
      confirmed: true,
    })
  }

  const locationConfidence = gpsAccuracy == null
    ? (selectedCoords ? 'manual' : 'unknown')
    : gpsAccuracy <= 25
      ? 'excellent'
      : gpsAccuracy <= 60
        ? 'good'
        : gpsAccuracy <= 150
          ? 'fair'
          : 'poor'

  const accuracyToneClass = gpsAccuracy == null
    ? 'text-gray-600'
    : gpsAccuracy < 50
      ? 'text-emerald-600'
      : gpsAccuracy <= 150
        ? 'text-amber-600'
        : 'text-red-600'

  const accuracyLabel = gpsAccuracy == null
    ? 'Accuracy unavailable'
    : `Location accuracy: ${gpsAccuracy} meters`

  function buildLocationMetadata(coords: [number, number], source: LocationSource): LocationMetadata {
    const confidence = calculateLocationConfidence(source, gpsAccuracy, userCorrectedLocation)
    return {
      lat: Number(coords[0].toFixed(6)),
      lng: Number(coords[1].toFixed(6)),
      accuracy: gpsAccuracy,
      source,
      confidence,
      user_corrected: userCorrectedLocation,
    }
  }

  const needsSub = form.incidentCategory && (DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey]?.length ?? 0) > 0

  // Custom field renderer — citizen-friendly, all fields optional
  const renderCustomField = (field: CustomFieldDef): JSX.Element => {
    const label = t(`incidents:fields.${field.key}`, { defaultValue: field.key.replace(/([A-Z])/g, ' $1').trim() })
    const val = customFields[field.key]
    const base = 'py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0'

    if (field.type === 'boolean') {
      // Three states: Yes (true) | Not sure (undefined/absent) | No (false)
      // Tapping the active button returns to "not sure"
      return (
        <div key={field.key} className={`flex items-center justify-between gap-3 ${base}`}>
          <span className="text-sm text-secondary leading-tight">{label}</span>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={() => upCustom(field.key, val === true ? undefined : true)}
              className={`px-2.5 py-1 text-xs rounded-l-full font-medium border transition-colors ${
                val === true
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-green-400 hover:text-green-600'
              }`}
            >Yes</button>
            <button
              type="button"
              onClick={() => upCustom(field.key, val === undefined ? undefined : undefined)}
              className={`px-2.5 py-1 text-xs font-medium border-y transition-colors ${
                val === undefined
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'
                  : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50'
              }`}
              title="Not sure — skip this"
            >?</button>
            <button
              type="button"
              onClick={() => upCustom(field.key, val === false ? undefined : false)}
              className={`px-2.5 py-1 text-xs rounded-r-full font-medium border transition-colors ${
                val === false
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-red-400 hover:text-red-500'
              }`}
            >No</button>
          </div>
        </div>
      )
    }

    if (field.type === 'number') {
      return (
        <div key={field.key} className={`flex items-center gap-3 ${base}`}>
          <label className="text-sm text-secondary flex-1 leading-tight">{label}</label>
          <input
            type="number"
            min={0}
            className="input w-24 text-sm py-1 text-center"
            placeholder="Unknown"
            value={val !== undefined ? String(val) : ''}
            onChange={e => upCustom(field.key, e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      )
    }

    if (field.type === 'select' && field.options) {
      return (
        <div key={field.key} className={`flex items-center gap-3 ${base}`}>
          <label className="text-sm text-gray-700 dark:text-gray-400 flex-1 leading-tight">{label}</label>
          <select
            className="input text-sm py-1 w-36"
            value={val !== undefined ? String(val) : ''}
            onChange={e => upCustom(field.key, e.target.value || undefined)}
          >
            <option value="">Not sure</option>
            {field.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )
    }

    // text
    return (
      <div key={field.key} className={`flex items-center gap-3 ${base}`}>
        <label className="text-sm text-gray-700 dark:text-gray-400 flex-1 leading-tight">{label}</label>
        <input
          type="text"
          className="input text-sm py-1 w-36"
          placeholder="Unknown"
          value={val !== undefined ? String(val) : ''}
          onChange={e => upCustom(field.key, e.target.value || undefined)}
        />
      </div>
    )
  }

  // Derive the selected incident label for display
  const selectedSubLabel = (() => {
    if (form.incidentSubtype) {
      const subs = DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey] || []
      return subs.find(s => s.key === form.incidentSubtype)?.label || form.incidentSubtype
    }
    return INCIDENT_CATEGORIES.find(c => c.key === form.incidentCategory)?.label || ''
  })()

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50" role="dialog" aria-modal="true">
      <ConfettiOverlay />
      {submitted ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg p-8 text-center animate-fade-in">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Report Submitted!</h2>
          <p className="text-gray-600 dark:text-gray-400">Your report is being reviewed by our AI system. Thank you for helping keep your community safe.</p>
        </div>
      ) : (
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto animate-fade-in">
        <div className="bg-red-600 text-white p-4 sm:p-5 rounded-t-2xl flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              {selectedSubLabel ? `Report: ${selectedSubLabel}` : 'Report Emergency'}
            </h2>
            <div className="flex items-center gap-2 mt-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-white' : 'bg-white/30'}`} />)}
              <span className="text-xs text-red-100 ml-2">{step}/6</span>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-red-700 p-2 rounded-lg" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 sm:p-5">
          {/* Step 1 — Incident category */}
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">What type of incident?</h3>
              <SearchableSelect
                options={INCIDENT_CATEGORIES.map(c => ({ key: c.key, label: c.label, icon: c.icon }))}
                value={form.incidentCategory}
                placeholder="Search or select incident type…"
                onChange={key => { up('incidentCategory', key); up('incidentSubtype', '') }}
              />
              {errors.incidentCategory && <p className="text-red-500 text-sm">{errors.incidentCategory}</p>}
            </div>
          )}

          {/* Step 2 — Incident subtype */}
          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">What specifically?</h3>
              <SearchableSelect
                options={(DISASTER_SUBTYPES[form.incidentCategory as IncidentCategoryKey] || []).map(s => ({ key: s.key, label: s.label, icon: s.icon }))}
                value={form.incidentSubtype}
                placeholder="Search or select subtype…"
                onChange={key => up('incidentSubtype', key)}
              />
              {errors.incidentSubtype && <p className="text-red-500 text-sm">{errors.incidentSubtype}</p>}
            </div>
          )}

          {/* Step 3 — Description + incident-specific custom fields */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">Describe what you see</h3>
                {selectedSubLabel && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-aegis-100 dark:bg-aegis-900/40 text-aegis-700 dark:text-aegis-300 font-medium">
                    {selectedSubLabel}
                  </span>
                )}
              </div>

              <textarea
                className={`input min-h-[100px] ${errors.description ? 'input-error' : ''}`}
                placeholder={descriptionPlaceholder}
                value={form.description}
                onChange={e => up('description', e.target.value)}
                maxLength={2000}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 text-right">{form.description.length}/2000</p>
              {errors.description && <p className="text-red-500 text-sm">{errors.description}</p>}

              {/* When did this happen? */}
              <div>
                <label className="text-xs font-medium text-muted">When did this happen?</label>
                <input
                  type="datetime-local"
                  className="input w-full text-sm mt-1"
                  max={new Date().toISOString().slice(0, 16)}
                  value={incidentTime}
                  onChange={e => setIncidentTime(e.target.value)}
                />
                <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5">Leave blank if happening right now</p>
              </div>

              {/* Incident-specific custom fields */}
              {customFieldDefs.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl p-3 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="text-blue-500 text-base mt-0.5">ℹ</span>
                    <div>
                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                        Optional — {selectedSubLabel} details
                      </p>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                        Answer what you can. Skip anything you're not sure about — your report will still be sent.
                      </p>
                    </div>
                  </div>
                  {customFieldDefs.map(renderCustomField)}
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Severity */}
          {step === 4 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">How severe?</h3>
              {SEVERITY_LEVELS.map(sv => (
                <button key={sv.key} onClick={() => { up('severity', sv.key); setStep(5) }}
                  className={`w-full p-4 border-2 rounded-xl text-left hover:shadow-md ${sv.key === 'High' ? 'border-red-200 hover:border-red-500' : sv.key === 'Medium' ? 'border-amber-200 hover:border-amber-500' : 'border-blue-200 hover:border-blue-500'}`}>
                  <p className="font-semibold">{sv.label}</p>
                  <p className="text-sm text-gray-600">{sv.description}</p>
                </button>
              ))}
            </div>
          )}

          {/* Step 5 — Trapped persons */}
          {step === 5 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Anyone trapped?</h3>
              {TRAPPED_OPTIONS.map(o => (
                <button key={o.key} onClick={() => { up('trappedPersons', o.key); setStep(6) }}
                  className={`w-full p-4 border-2 rounded-xl text-left hover:shadow-md ${o.urgent ? 'border-red-200 hover:border-red-500' : 'border-gray-200 hover:border-aegis-300'}`}>
                  <p className="font-medium text-sm">{o.label}</p>
                </button>
              ))}
            </div>
          )}

          {/* Step 6 — Location & evidence */}
          {step === 6 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Location & Evidence</h3>
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    className={`input flex-1 ${errors.location ? 'input-error' : ''}`}
                    placeholder={gpsStatus === 'denied' ? 'Type address or postcode...' : 'Address, postcode, or landmark...'}
                    value={form.location}
                    onChange={e => {
                      up('location', e.target.value)
                      setSelectedCoords(null)
                      setManualPinCoords(null)
                      setLocationSource('manual_text')
                      setUserCorrectedLocation(Boolean(gpsCoords))
                      setLocationConfirmed(false)
                      setIsSelectingSuggestion(false)
                      setFinalLocation(prev => prev ? { ...prev, confirmed: false } : null)
                      setShowSuggestions(true)
                    }}
                    onFocus={() => setShowSuggestions(!locationConfirmed && addressSuggestions.length > 0)}
                  />
                  <button onClick={() => requestGpsWithConsent('manual')} disabled={gpsStatus === 'requesting'} className={`btn-outline flex-shrink-0 ${gpsStatus === 'requesting' ? 'opacity-50' : ''}`}>
                    <MapPin className="w-4 h-4" /> {gpsStatus === 'requesting' ? '...' : 'GPS'}
                  </button>
                </div>
                {gpsConsentOpen && (
                  <div className="mt-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                    <p className="font-medium">Use your current location?</p>
                    <p className="mt-0.5">We will request GPS permission and only use it for this report.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={confirmGpsConsent} className="rounded border border-blue-600 bg-blue-600 px-2 py-1 text-white">Yes, use GPS</button>
                      <button type="button" onClick={declineGpsConsent} className="rounded border border-blue-300 bg-white px-2 py-1 text-blue-700">No, type manually</button>
                    </div>
                  </div>
                )}
                {isSearchingAddress && <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Searching address suggestions…</p>}
                {showSuggestions && addressSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                    {addressSuggestions.map((s, i) => (
                      <button key={`${s.label}-${i}`} onClick={() => pickSuggestion(s)} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {gpsStatus === 'denied' && <p className="text-[10px] text-amber-600">GPS unavailable — please type your location manually or select on map</p>}
              {errors.location && <p className="text-red-500 text-sm">{errors.location}</p>}

              {/* Multi-Image Upload */}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Confidence badge */}
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full ${
                    locationConfidence === 'excellent'
                      ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                      : locationConfidence === 'good'
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                        : locationConfidence === 'fair'
                          ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                          : locationConfidence === 'poor'
                            ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                            : 'bg-gray-100 text-gray-500 dark:text-gray-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      locationConfidence === 'excellent' ? 'bg-emerald-500'
                      : locationConfidence === 'good' ? 'bg-blue-500'
                      : locationConfidence === 'fair' ? 'bg-amber-500'
                      : locationConfidence === 'poor' ? 'bg-red-500'
                      : 'bg-gray-400'
                    }`} />
                    {locationConfidence === 'manual' ? 'Pinned' : locationConfidence === 'unknown' ? 'No location yet' : `${locationConfidence.charAt(0).toUpperCase() + locationConfidence.slice(1)} accuracy`}
                    {gpsAccuracy != null ? ` ±${gpsAccuracy}m` : ''}
                  </span>
                  <label className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-400 ml-auto">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={reportNotAtMyLocation}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setReportNotAtMyLocation(checked)
                        if (checked) setShowMapPicker(true)
                      }}
                    />
                    Not at my location
                  </label>
                </div>

                {reportNotAtMyLocation && locationSource !== 'map_pin' && (
                  <p className="text-[11px] text-red-600 mt-1 font-medium">
                    Tap the map to pin the exact incident location.
                  </p>
                )}

                {finalLocation && !finalLocation.confirmed && finalLocation.confidence === 'poor' && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    GPS accuracy is poor — tap the map to refine the pin before confirming.
                  </p>
                )}

                {/* Map picker — always visible, gold-standard UX */}
                <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 mt-1">
                  {/* Tile switcher */}
                  <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 px-2 py-1 border-b border-gray-200 dark:border-gray-700">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 mr-1">Layer:</span>
                    {FREE_TILE_PROVIDERS.map((p, i) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => { setTileLoaded(false); setTileErrorCount(0); setAllTileProvidersFailed(false); setTileProviderIndex(i) }}
                        className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                          tileProviderIndex === i
                            ? 'bg-aegis-600 text-white'
                            : 'text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                    <span className="ml-auto text-[9px] text-gray-400 dark:text-gray-400">Tap map to pin</span>
                  </div>

                  <div className="map-wrapper" style={{ height: 260, overflow: 'hidden' }} onWheel={e => e.stopPropagation()}>
                  <MapContainer
                    center={selectedCoords || gpsCoords || [defaultLat, defaultLng]}
                    zoom={selectedCoords || gpsCoords ? 15 : 13}
                    zoomControl={false}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <ZoomControl position="topright" />
                    <MapModalResizeFix visible={true} />
                    <MapFlyTo coords={selectedCoords || gpsCoords} />

                    {!tileLoaded && (
                      <div className="absolute inset-x-0 top-0 z-[500] bg-amber-50/90 text-amber-700 text-[10px] px-2 py-1 flex items-center gap-1">
                        <span className="animate-spin inline-block w-2.5 h-2.5 border border-amber-500 border-t-transparent rounded-full" />
                        Loading {FREE_TILE_PROVIDERS[tileProviderIndex].name} tiles…
                      </div>
                    )}

                    <TileLayer
                      key={`tile-${tileProviderIndex}`}
                      attribution={FREE_TILE_PROVIDERS[tileProviderIndex].attribution}
                      url={FREE_TILE_PROVIDERS[tileProviderIndex].url}
                      eventHandlers={{ tileerror: handleTileError, load: handleTileLoad }}
                    />
                    <MapClickCapture onPick={setLocationFromMapPin} />

                    {/* GPS accuracy radius ring */}
                    {gpsCoords && gpsAccuracy != null && gpsAccuracy > 20 && (
                      <Circle
                        center={gpsCoords}
                        radius={gpsAccuracy}
                        pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1.5, dashArray: '5 5' }}
                      />
                    )}

                    {/* Draggable precision pin — drag to adjust location */}
                    {(selectedCoords || gpsCoords) && (
                      <DraggablePin
                        position={selectedCoords || gpsCoords!}
                        onMove={setLocationFromMapPin}
                        isPinned={manualPinCoords != null}
                      />
                    )}
                  </MapContainer>
                  </div>

                  <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-1">
                      {manualPinCoords
                        ? 'Pinned manually — highest precision'
                        : gpsCoords
                          ? `GPS fix${gpsAccuracy != null ? ` ±${gpsAccuracy}m` : ''}`
                          : 'Tap the map to drop a pin on the exact spot'}
                    </span>
                    {allTileProvidersFailed && (
                      <button type="button" onClick={() => { setTileLoaded(false); setTileErrorCount(0); setAllTileProvidersFailed(false); setTileProviderIndex(0) }} className="text-[10px] text-blue-600 underline">Retry</button>
                    )}
                  </div>
                </div>
                {/* Quick observation tags */}
              <div className="mt-3">
                <p className="text-xs font-medium text-muted mb-1.5">What can you observe? <span className="font-normal text-muted">(tap all that apply)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_OBSERVATIONS.map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setObservedConditions(prev => prev.includes(o.key) ? prev.filter(k => k !== o.key) : [...prev, o.key])}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                        observedConditions.includes(o.key)
                          ? 'bg-aegis-600 text-white border-aegis-600'
                          : 'border-gray-300 text-gray-600 hover:border-aegis-400'
                      }`}
                    >
                      <o.icon className="w-3 h-3 inline" /> {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimated people affected */}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">People affected:</span>
                <select
                  className="input text-xs py-1 flex-1"
                  value={estimatedAffected}
                  onChange={e => setEstimatedAffected(e.target.value)}
                >
                  <option value="">Unknown</option>
                  <option value="1-5">1–5 people</option>
                  <option value="6-20">6–20 people</option>
                  <option value="21-100">21–100 people</option>
                  <option value="100+">Over 100</option>
                  <option value="neighbourhood">A neighbourhood</option>
                  <option value="district">A large area / district</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 mt-2">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    Source: <span className="font-medium">{manualPinCoords ? 'map pin' : locationSource.replace(/_/g, ' ')}</span>
                  </p>
                  <button
                    type="button"
                    onClick={confirmSelectedLocation}
                    className={`text-[11px] px-3 py-1.5 rounded-md border font-medium transition-colors ${
                      locationConfirmed
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {locationConfirmed ? '✓ Location confirmed' : 'Confirm location'}
                  </button>
                </div>
                {mediaFiles.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {mediaFiles.map((m, i) => (
                      <div key={i} className="relative group rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                        <img src={m.preview} alt={`Evidence ${i + 1}`} className="w-full h-20 object-cover" />
                        <button onClick={() => removeMedia(i)} className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity" aria-label="Remove"><X className="w-3 h-3" /></button>
                        <p className="text-[9px] text-center text-gray-500 dark:text-gray-400 py-0.5 truncate px-1">{m.file.name}</p>
                      </div>
                    ))}
                  </div>
                )}
                {mediaFiles.length < MAX_IMAGES && (
                  <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${mediaFiles.length > 0 ? 'border-green-400 bg-green-50 dark:bg-green-950/20' : 'border-gray-300 dark:border-gray-600 hover:border-aegis-400'}`} onClick={() => fileRef.current?.click()}>
                    <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={handleFiles} />
                    <Camera className="w-6 h-6 mx-auto text-gray-400 dark:text-gray-400 mb-1" />
                    <p className="text-sm font-medium">{mediaFiles.length > 0 ? `Add more (${MAX_IMAGES - mediaFiles.length} remaining)` : 'Add photo evidence'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">JPG, PNG, WEBP · Max {MAX_SIZE_MB}MB each</p>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1 text-sm">
                <p className="font-semibold">Summary</p>
                <p className="text-gray-600 dark:text-gray-400">
                  Type: <span className="font-medium text-gray-800 dark:text-gray-200">{selectedSubLabel || form.incidentCategory}</span>
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  Severity: {form.severity} | Trapped: {form.trappedPersons}
                  {mediaFiles.length > 0 ? ` | Photos: ${mediaFiles.length}` : ''}
                </p>
                {Object.keys(customFields).filter(k => customFields[k] !== undefined).length > 0 && (
                  <p className="text-gray-500 dark:text-gray-400 text-xs">
                    + {Object.keys(customFields).filter(k => customFields[k] !== undefined).length} additional {selectedSubLabel} details
                  </p>
                )}
              </div>

              <button onClick={submit} disabled={isSubmitting} className="btn-danger w-full py-3 text-base disabled:opacity-60">
                <Send className="w-5 h-5" /> {isSubmitting ? 'Submitting...' : 'Submit Emergency Report'}
              </button>
              <p className="text-xs text-center text-gray-500 dark:text-gray-400">Anonymous. Call 999 first for life-threatening emergencies.</p>
            </div>
          )}

          {/* Navigation buttons */}
          {step > 1 && step < 6 && (
            <div className="flex justify-between mt-5">
              <button onClick={prev} className="btn-ghost"><ChevronLeft className="w-4 h-4" /> Back</button>
              <button onClick={next} className="btn-primary">Next <ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
          {step === 1 && form.incidentCategory && (
            <div className="flex justify-end mt-5">
              <button onClick={next} className="btn-primary">Next <ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
          {step === 6 && (
            <div className="mt-3">
              <button onClick={prev} className="btn-ghost"><ChevronLeft className="w-4 h-4" /> Back</button>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

