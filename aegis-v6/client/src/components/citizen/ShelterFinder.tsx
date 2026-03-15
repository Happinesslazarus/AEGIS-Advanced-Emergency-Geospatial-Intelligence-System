/* ShelterFinder.tsx � Professional Safe-Zone Finder  �  Real Overpass API data */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Home,
  MapPin,
  Navigation,
  Phone,
  Shield,
  Loader2,
  ChevronRight,
  AlertTriangle,
  Users,
  Wifi,
  Droplets,
  Zap,
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
  Clock,
  ExternalLink,
  Activity,
  Building2,
  GraduationCap,
  Heart,
  MapPinned,
  Compass,
  Star,
  ArrowUpRight,
} from 'lucide-react'
import { forwardGeocode, getDeviceLocation, haversineKm, reverseGeocode, type Coordinates } from '../../utils/locationUtils'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

/* --------------------------------------------------------------------------- */
/*  Types & constants                                                        */
/* --------------------------------------------------------------------------- */

interface Shelter {
  id: string
  name: string
  type: 'shelter' | 'hospital' | 'fire_station' | 'community_centre' | 'school'
  lat: number
  lng: number
  address: string
  phone?: string
  capacity: number
  occupancy: number
  amenities: string[]
  isOpen: boolean
  distance?: number
}

const TYPE_CONFIG = {
  shelter:          { icon: Home,          label: 'Emergency Shelter', short: 'Shelter',    gradient: 'from-emerald-500 to-teal-600',   ring: 'ring-emerald-500/40', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
  hospital:         { icon: Heart,         label: 'Hospital',          short: 'Hospital',   gradient: 'from-red-500 to-rose-600',       ring: 'ring-red-500/40',     dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-950/20' },
  fire_station:     { icon: Zap,           label: 'Fire Station',      short: 'Fire Stn',   gradient: 'from-amber-500 to-orange-600',   ring: 'ring-amber-500/40',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-950/20' },
  community_centre: { icon: Building2,     label: 'Community Centre',  short: 'Community',  gradient: 'from-blue-500 to-indigo-600',    ring: 'ring-blue-500/40',    dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-950/20' },
  school:           { icon: GraduationCap, label: 'School',            short: 'School',     gradient: 'from-violet-500 to-purple-600',  ring: 'ring-violet-500/40',  dot: 'bg-violet-500',  text: 'text-violet-600 dark:text-violet-400',   bg: 'bg-violet-50 dark:bg-violet-950/20' },
} as const

const AMENITY_META: Record<string, { icon: typeof Wifi; label: string; color: string }> = {
  wifi:    { icon: Wifi,     label: 'Wi-Fi',      color: 'text-blue-500  bg-blue-50 dark:bg-blue-950/30' },
  beds:    { icon: Home,     label: 'Beds',       color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' },
  food:    { icon: Droplets, label: 'Food/Water', color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/30' },
  medical: { icon: Shield,   label: 'Medical',    color: 'text-red-500 bg-red-50 dark:bg-red-950/30' },
}

function estimateWalkMin(km: number | undefined): string {
  if (km == null) return '--'
  const mins = Math.round(km / 0.08)  // ~4.8 km/h walking speed
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

function safetyScore(s: Shelter): number {
  let score = 50
  if (s.isOpen) score += 15
  if (s.amenities.includes('medical')) score += 15
  if (s.amenities.includes('food')) score += 10
  if (s.amenities.includes('wifi')) score += 5
  if (s.amenities.includes('beds')) score += 5
  const occPct = s.capacity ? (s.occupancy / s.capacity) * 100 : 0
  if (occPct < 50) score += 10
  else if (occPct < 80) score += 5
  return Math.min(score, 100)
}

/* --------------------------------------------------------------------------- */
/*  Overpass API fetch (unchanged logic)                                     */
/* --------------------------------------------------------------------------- */

async function fetchRealShelters(lat: number, lng: number): Promise<{ items: Omit<Shelter, 'distance'>[]; sourceAvailable: boolean }> {
  const radius = 5000
  const query = `[out:json][timeout:20];(
    node["amenity"="hospital"](around:${radius},${lat},${lng});
    node["amenity"="fire_station"](around:${radius},${lat},${lng});
    node["amenity"="community_centre"](around:${radius},${lat},${lng});
    node["amenity"="shelter"](around:${radius},${lat},${lng});
    node["social_facility"="shelter"](around:${radius},${lat},${lng});
    node["amenity"="school"](around:${radius},${lat},${lng});
    way["amenity"="hospital"](around:${radius},${lat},${lng});
    way["amenity"="fire_station"](around:${radius},${lat},${lng});
    way["amenity"="community_centre"](around:${radius},${lat},${lng});
  );out center body 30;`

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    if (!res.ok) return { items: [], sourceAvailable: false }

    const data = await res.json()
    const elements: any[] = data.elements || []

    const items = elements
      .slice(0, 30)
      .map((el, i) => {
        const elLat = Number(el.lat ?? el.center?.lat)
        const elLng = Number(el.lon ?? el.center?.lon)
        if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) return null

        const tags = el.tags || {}
        const amenity = tags.amenity || tags.social_facility || ''

        let type: Shelter['type'] = 'shelter'
        if (amenity === 'hospital') type = 'hospital'
        else if (amenity === 'fire_station') type = 'fire_station'
        else if (amenity === 'community_centre') type = 'community_centre'
        else if (amenity === 'school') type = 'school'

        const name = tags.name || tags['name:en'] || TYPE_CONFIG[type].label || 'Safe Zone'
        const street = tags['addr:street'] || ''
        const houseNumber = tags['addr:housenumber'] || ''
        const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || ''
        const address = [houseNumber, street, city].filter(Boolean).join(', ') || `${elLat.toFixed(4)}, ${elLng.toFixed(4)}`

        return {
          id: `osm-${el.id || i}`,
          name,
          type,
          lat: elLat,
          lng: elLng,
          address,
          phone: tags.phone || tags['contact:phone'] || undefined,
          capacity: parseInt(tags.capacity || '0', 10) || (type === 'hospital' ? 200 : 100),
          occupancy: 0,
          amenities: [
            ...(type === 'hospital' ? ['medical', 'food'] : []),
            ...(tags.internet_access === 'wlan' || tags.internet_access === 'yes' ? ['wifi'] : []),
            ...(type === 'shelter' || type === 'community_centre' ? ['beds', 'food'] : []),
          ],
          isOpen: tags.opening_hours !== 'closed',
        }
      })
      .filter(Boolean) as Omit<Shelter, 'distance'>[]

    return { items, sourceAvailable: true }
  } catch {
    return { items: [], sourceAvailable: false }
  }
}

/* --------------------------------------------------------------------------- */
/*  Component                                                                */
/* --------------------------------------------------------------------------- */

export default function ShelterFinder(): JSX.Element {
  const lang = useLanguage()
  const [origin, setOrigin] = useState<Coordinates | null>(null)
  const [locationName, setLocationName] = useState('Search or use GPS')
  const [locationError, setLocationError] = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')
  const [showOnlyOpen, setShowOnlyOpen] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheltersDB, setSheltersDB] = useState<Omit<Shelter, 'distance'>[]>([])
  const [fetchingReal, setFetchingReal] = useState(false)
  const [apiUnavailable, setApiUnavailable] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const shelters = useMemo(() => {
    let list = sheltersDB.map((s) => ({
      ...s,
      distance: origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : undefined,
    }))
    if (showOnlyOpen) list = list.filter((s) => s.isOpen)
    if (filterType !== 'all') list = list.filter((s) => s.type === filterType)
    if (origin) list.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    return list
  }, [origin, filterType, showOnlyOpen, sheltersDB])

  /* Derived stats */
  const stats = useMemo(() => {
    const all = sheltersDB.map((s) => ({ ...s, distance: origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : undefined }))
    const open = all.filter((s) => s.isOpen).length
    const nearest = all.filter(s => s.isOpen && s.distance != null).sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))[0]
    const totalCap = all.reduce((t, s) => t + s.capacity, 0)
    const totalOcc = all.reduce((t, s) => t + s.occupancy, 0)
    const typeCounts: Record<string, number> = {}
    for (const s of all) typeCounts[s.type] = (typeCounts[s.type] || 0) + 1
    return { total: all.length, open, nearest, totalCap, totalOcc, typeCounts, avgCap: all.length ? Math.round(totalCap / all.length) : 0 }
  }, [sheltersDB, origin])

  const loadShelters = useCallback(async (coords: Coordinates) => {
    setFetchingReal(true)
    setApiUnavailable(false)
    const result = await fetchRealShelters(coords.lat, coords.lng)
    setSheltersDB(result.items)
    setApiUnavailable(!result.sourceAvailable)
    setFetchingReal(false)
    setLastRefreshed(new Date())
  }, [])

  const requestGPS = useCallback(async () => {
    setLocationError('')
    setLocationName('Detecting location...')
    setGpsLoading(true)
    try {
      const coords = await getDeviceLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
      setOrigin(coords)
      const place = await reverseGeocode(coords, 11)
      setLocationName(place.displayName)
      await loadShelters(coords)
    } catch {
      setLocationError('Enable location to see local data')
      setLocationName('Location unavailable')
    }
    setGpsLoading(false)
  }, [loadShelters])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    const result = await forwardGeocode(searchQuery.trim())
    if (result) {
      const coords = { lat: result.lat, lng: result.lng }
      setOrigin(coords)
      setLocationName(result.label)
      setLocationError('')
      await loadShelters(coords)
    } else {
      setLocationError('Location not found. Try a city, postcode, or region.')
    }
    setSearching(false)
  }

  useEffect(() => {}, [requestGPS])

  const nearest = shelters[0]
  const hasData = sheltersDB.length > 0

  /* -- Render -- */
  return (
    <div className="animate-fade-in space-y-4">

      {/* ----------- HEADER ----------- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-600/25">
              <Shield className="w-5.5 h-5.5 text-white" />
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-white dark:border-gray-900 items-center justify-center">
                <span className="text-[6px] font-black text-white">{stats.total}</span>
              </span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">{t('shelter.safeZones', lang)}</h2>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 font-medium mt-0.5">
              {fetchingReal ? 'Searching real locations via OpenStreetMap...' : apiUnavailable ? 'Source unavailable � retry to load' : locationName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={requestGPS}
            disabled={gpsLoading}
            className="flex items-center gap-1.5 text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all border border-emerald-200/50 dark:border-emerald-800/50"
          >
            {gpsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
            GPS
          </button>
          {hasData && (
            <button
              onClick={() => origin ? loadShelters(origin) : requestGPS()}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${fetchingReal ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* ----------- SEARCH BAR ----------- */}
      <div className="glass-card rounded-2xl p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('shelter.searchPlaceholder', lang)}
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find Zones'}
          </button>
        </div>
        {locationError && <p className="text-[10px] text-red-500 font-medium mt-1.5 ml-1">{locationError}</p>}
      </div>

      {/* ----------- NEAREST SHELTER HERO ----------- */}
      {nearest && nearest.distance != null && (
        <div className="relative glass-card rounded-2xl overflow-hidden border border-emerald-200/50 dark:border-emerald-800/40">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-teal-500/5" />
          <div className="relative p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPinned className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[9px] font-extrabold text-emerald-700 dark:text-emerald-300 uppercase tracking-widest">{t('shelter.nearestOpen', lang)}</span>
            </div>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white truncate">{nearest.name}</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-0.5">{nearest.address}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    <Navigation className="w-3 h-3" /> {nearest.distance.toFixed(1)} km
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                    <Clock className="w-3 h-3" /> ~{estimateWalkMin(nearest.distance)} walk
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 dark:text-green-400">
                    <Activity className="w-3 h-3" /> Open
                  </span>
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${nearest.lat},${nearest.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[10px] font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-2 rounded-xl transition-all shadow-md shadow-emerald-500/20 hover:scale-[1.02] flex-shrink-0 ml-3"
              >
                <Navigation className="w-3.5 h-3.5" /> Directions
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ----------- QUICK STATS ROW ----------- */}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.total}</div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('shelter.totalZones', lang)}</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 leading-none">{stats.open}</div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('shelter.openNow', lang)}</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">{stats.nearest?.distance != null ? `${stats.nearest.distance.toFixed(1)}` : '--'}<span className="text-sm font-bold ml-0.5">km</span></div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('shelter.nearest', lang)}</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 leading-none">{stats.avgCap}</div>
            <div className="text-[9px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase mt-1">{t('shelter.avgCapacity', lang)}</div>
          </div>
        </div>
      )}

      {/* ----------- ZONE TYPE DISTRIBUTION BAR ----------- */}
      {hasData && (
        <div className="glass-card rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider">{t('shelter.typeDistribution', lang)}</span>
            <span className="text-[9px] font-medium text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{stats.total} locations</span>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40">
            {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = stats.typeCounts[key] || 0
              const pct = stats.total ? (count / stats.total) * 100 : 0
              if (pct === 0) return null
              return (
                <div
                  key={key}
                  className={`h-full bg-gradient-to-r ${cfg.gradient} transition-all duration-700 cursor-pointer hover:opacity-80`}
                  style={{ width: `${pct}%` }}
                  onClick={() => setFilterType(filterType === key ? 'all' : key)}
                  title={`${cfg.label}: ${count}`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
              const count = stats.typeCounts[key] || 0
              if (count === 0) return null
              return (
                <span key={key} className="flex items-center gap-1 text-[9px] font-medium text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />{cfg.short} {count}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* ----------- FILTER PILLS ----------- */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {[
          { key: 'all', label: 'All Zones', count: stats.total },
          ...Object.entries(TYPE_CONFIG).map(([k, v]) => ({ key: k, label: v.short, count: stats.typeCounts[k] || 0 })),
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterType(f.key)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
              filterType === f.key
                ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/60'
            }`}
          >
            {f.label}
            {f.count > 0 && (
              <span className={`px-1.5 rounded-full text-[8px] ${filterType === f.key ? 'bg-white/20' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>
                {f.count}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setShowOnlyOpen(!showOnlyOpen)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
            showOnlyOpen ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'
          }`}
        >
          {showOnlyOpen ? 'Open Only' : 'Show All'}
        </button>
      </div>

      {/* ----------- SHELTERS LIST ----------- */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-lg">
        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[520px] overflow-y-auto custom-scrollbar">
          {fetchingReal ? (
            <div className="py-12 text-center">
              <Loader2 className="w-8 h-8 text-emerald-500 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.searchingOSM', lang)}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">Locating shelters, hospitals, fire stations & more within 5 km</p>
            </div>
          ) : apiUnavailable ? (
            <div className="py-10 text-center space-y-3">
              <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.dataUnavailable', lang)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">Overpass API could not be reached. Retry to load nearby facilities.</p>
              <button
                onClick={() => origin ? loadShelters(origin) : requestGPS()}
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : !origin && shelters.length === 0 ? (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-950/40 dark:to-teal-950/40 flex items-center justify-center mx-auto">
                <Compass className="w-8 h-8 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.setLocation', lang)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">Use GPS or search a city / postcode to find nearby shelters</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button onClick={requestGPS} disabled={gpsLoading} className="inline-flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-5 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-500/20">
                  {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />} Use My Location
                </button>
                <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('shelter.orSearchAbove', lang)}</span>
              </div>
            </div>
          ) : shelters.length === 0 ? (
            <div className="py-10 text-center">
              <Home className="w-10 h-10 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('shelter.noMatching', lang)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">
                Try adjusting filters or{' '}
                <button onClick={() => { setFilterType('all'); setShowOnlyOpen(false) }} className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">clear all filters</button>
              </p>
            </div>
          ) : (
            shelters.map((s, idx) => {
              const cfg = TYPE_CONFIG[s.type]
              const TypeIcon = cfg.icon
              const occupancyPct = s.capacity ? Math.round((s.occupancy / s.capacity) * 100) : 0
              const score = safetyScore(s)
              const isSelected = selectedId === s.id
              const capColor = occupancyPct > 85 ? 'bg-red-500' : occupancyPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
              const scoreColor = score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : score >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(isSelected ? null : s.id)}
                  className={`w-full text-left p-4 transition-all duration-200 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 ${isSelected ? `${cfg.bg} ${cfg.ring} ring-2 ring-inset` : ''}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon + rank */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-md`}>
                        <TypeIcon className="w-5 h-5 text-white" />
                      </div>
                      {idx < 3 && s.distance != null && (
                        <span className="text-[7px] font-black text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">#{idx + 1}</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: Name + distance */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{s.name}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${s.isOpen ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'}`}>
                            {s.isOpen ? 'OPEN' : 'CLOSED'}
                          </span>
                        </div>
                        {s.distance != null && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className={`text-xs font-black ${cfg.text}`}>{s.distance.toFixed(1)} km</span>
                          </div>
                        )}
                      </div>

                      {/* Row 2: Address */}
                      <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate mt-0.5">{s.address}</p>

                      {/* Row 3: Meta chips */}
                      <div className="flex items-center flex-wrap gap-1.5 mt-2">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                          {cfg.short}
                        </span>
                        {s.distance != null && (
                          <span className="text-[9px] font-medium text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> ~{estimateWalkMin(s.distance)}
                          </span>
                        )}
                        <span className={`text-[9px] font-bold flex items-center gap-0.5 ${scoreColor}`}>
                          <Star className="w-2.5 h-2.5" /> {score}
                        </span>
                      </div>

                      {/* Row 4: Capacity bar */}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-2 bg-gray-200/60 dark:bg-gray-700/40 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${capColor}`} style={{ width: `${Math.max(occupancyPct, 2)}%` }} />
                        </div>
                        <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0">
                          {s.occupancy}/{s.capacity} <span className="text-[8px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">({occupancyPct}%)</span>
                        </span>
                      </div>

                      {/* Row 5: Amenity badges */}
                      {s.amenities.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          {s.amenities.map((a) => {
                            const am = AMENITY_META[a]
                            if (!am) return null
                            return (
                              <span key={a} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold ${am.color}`}>
                                <am.icon className="w-2.5 h-2.5" /> {am.label}
                              </span>
                            )
                          })}
                        </div>
                      )}

                      {/* Expand: contact + directions */}
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/30 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {s.phone && (
                              <a
                                href={`tel:${s.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                              >
                                <Phone className="w-3 h-3" /> {s.phone}
                              </a>
                            )}
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all"
                            >
                              <Navigation className="w-3 h-3" /> Get Directions <ArrowUpRight className="w-2.5 h-2.5" />
                            </a>
                            <a
                              href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-700/60 transition-all"
                            >
                              <ExternalLink className="w-3 h-3" /> View on Map
                            </a>
                          </div>
                          <p className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <ChevronRight className={`w-4 h-4 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 flex-shrink-0 mt-2 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* -- Footer -- */}
        {hasData && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-3 text-[9px] font-medium">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Real-time � OpenStreetMap
              </span>
              {lastRefreshed && (
                <span className="text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
            <span className="text-[9px] font-bold text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">
              {shelters.length} of {stats.total} zones
            </span>
          </div>
        )}
      </div>
    </div>
  )
}





