/**
 * Spatial toolbar shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useMap, useMapEvents, Marker, Circle, Polyline, Polygon, Popup } from 'react-leaflet'
import L from 'leaflet'
import {
  Ruler, Pentagon, CircleDot, Search, Droplets, Home, Mountain,
  MapPin, Compass, Download, X, ChevronRight, RotateCcw, Database, Flame,
} from 'lucide-react'
import type { Report } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { sanitizeHtml } from './SafeHtml'

// Types

type ToolId =
  | 'distance' | 'area' | 'buffer' | 'radius-search'
  | 'flood-risk' | 'nearest-shelter' | 'elevation'
  | 'coord-lookup' | 'bearing' | 'export'
  | 'buffer-analysis' | 'density'

interface ToolDef {
  id: ToolId
  label: string
  icon: React.ReactNode
  description: string
}

interface ElevationPoint {
  lat: number
  lng: number
  elevation: number | null
}

interface ShelterResult {
  name: string
  distance: number
  lat: number
  lng: number
  capacity: number
  current_occupancy: number
}

interface BufferAnalysisResult {
  center: { lat: number; lng: number }
  radius_km: number
  reports: { count: number; items: any[] }
  shelters: { count: number; items: any[] }
  alerts: { count: number; items: any[] }
  flood_zones: { count: number; items: any[] }
}

interface DensityPoint {
  lat: number
  lng: number
  intensity: number
}

interface Props {
  reports?: Report[]
  open?: boolean
  hideToggle?: boolean
}

// Haversine & Geodesic Math

const R_EARTH = 6371 // Earth radius in km

function toRad(deg: number): number { return deg * (Math.PI / 180) }
function toDeg(rad: number): number { return rad * (180 / Math.PI) }

/* Haversine distance between two points in km */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/* Spherical polygon area using the spherical excess formula (km²) */
function sphericalPolygonArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0
  const n = coords.length
  let sum = 0
  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = coords[i]
    const [lat2, lng2] = coords[(i + 1) % n]
    sum += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }
  return Math.abs(sum * R_EARTH * R_EARTH / 2)
}

/* Compass bearing from point A to point B */
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function compassDirection(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

function formatDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`
}

// Tool Definitions

function getTools(lang: string): ToolDef[] {
  return [
  { id: 'distance', label: t('spatial.distance', lang), icon: <Ruler className="w-4 h-4" />, description: t('spatial.distanceDesc', lang) },
  { id: 'area', label: t('spatial.area', lang), icon: <Pentagon className="w-4 h-4" />, description: t('spatial.areaDesc', lang) },
  { id: 'buffer', label: t('spatial.bufferZone', lang), icon: <CircleDot className="w-4 h-4" />, description: t('spatial.bufferZoneDesc', lang) },
  { id: 'radius-search', label: t('spatial.radiusSearch', lang), icon: <Search className="w-4 h-4" />, description: t('spatial.radiusSearchDesc', lang) },
  { id: 'flood-risk', label: t('spatial.floodRisk', lang), icon: <Droplets className="w-4 h-4" />, description: t('spatial.floodRiskDesc', lang) },
  { id: 'nearest-shelter', label: t('spatial.nearestShelter', lang), icon: <Home className="w-4 h-4" />, description: t('spatial.nearestShelterDesc', lang) },
  { id: 'elevation', label: t('spatial.elevation', lang), icon: <Mountain className="w-4 h-4" />, description: t('spatial.elevationDesc', lang) },
  { id: 'coord-lookup', label: t('spatial.coordinates', lang), icon: <MapPin className="w-4 h-4" />, description: t('spatial.coordinatesDesc', lang) },
  { id: 'bearing', label: t('spatial.bearing', lang), icon: <Compass className="w-4 h-4" />, description: t('spatial.bearingDesc', lang) },
  { id: 'buffer-analysis', label: t('spatial.fullAnalysis', lang), icon: <Database className="w-4 h-4" />, description: t('spatial.fullAnalysisDesc', lang) },
  { id: 'density', label: t('spatial.density', lang), icon: <Flame className="w-4 h-4" />, description: t('spatial.densityDesc', lang) },
  { id: 'export', label: t('spatial.exportView', lang), icon: <Download className="w-4 h-4" />, description: t('spatial.exportViewDesc', lang) },
]
}

// Marker Icons

function toolIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="background:${color};width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">${label}</div>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  })
}

// Click Handler Sub-component

function ToolClickHandler({ activeTool, onMapClick }: { activeTool: ToolId | null; onMapClick: (e: L.LeafletMouseEvent) => void }) {
  useMapEvents({
    click(e) {
      if (activeTool && activeTool !== 'export') {
        onMapClick(e)
      }
    },
  })
  return null
}

// Main Component

export default function SpatialToolbar({ reports = [], open, hideToggle }: Props): JSX.Element {
  const map = useMap()
  const lang = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const effectiveExpanded = open !== undefined ? open : expanded
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [points, setPoints] = useState<[number, number][]>([])
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [bufferRadius, setBufferRadius] = useState(1) // km
  const [elevationData, setElevationData] = useState<ElevationPoint[]>([])
  const [nearestShelter, setNearestShelter] = useState<ShelterResult | null>(null)
  const [radiusResults, setRadiusResults] = useState<{ reports: number; shelters: ShelterResult[] } | null>(null)
  const [geocodeResult, setGeocodeResult] = useState<string | null>(null)
  const [bufferAnalysis, setBufferAnalysis] = useState<BufferAnalysisResult | null>(null)
  const [densityPoints, setDensityPoints] = useState<DensityPoint[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // Cursor style when tool active
  useEffect(() => {
    const container = map.getContainer()
    if (activeTool && activeTool !== 'export') {
      container.style.cursor = 'crosshair'
    } else {
      container.style.cursor = ''
    }
    return () => { container.style.cursor = '' }
  }, [activeTool, map])

  const reset = useCallback(() => {
    setPoints([])
    setResult(null)
    setElevationData([])
    setNearestShelter(null)
    setRadiusResults(null)
    setGeocodeResult(null)
    setBufferAnalysis(null)
    setDensityPoints([])
    setLoading(false)
    abortRef.current?.abort()
  }, [])

  const selectTool = useCallback((id: ToolId) => {
    reset()
    if (id === activeTool) {
      setActiveTool(null)
    } else {
      setActiveTool(id)
      // Export shows format picker — no immediate action needed
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, reset])

  //  Distance

  const totalDistance = useMemo(() => {
    if (points.length < 2) return 0
    let d = 0
    for (let i = 1; i < points.length; i++) {
      d += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    }
    return d
  }, [points])

  //  Area

  const polygonArea = useMemo(() => {
    if (points.length < 3) return 0
    return sphericalPolygonArea(points)
  }, [points])

  //  Reverse Geocode

  const reverseGeocode = useCallback(async (lat: number, lng: number): Promise<string> => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`, {
        headers: { 'Accept-Language': 'en' },
      })
      if (!r.ok) return 'Address unavailable'
      const data = await r.json()
      return data.display_name || 'Unknown location'
    } catch {
      return 'Geocoding unavailable'
    }
  }, [])

  //  Elevation Lookup

  const fetchElevation = useCallback(async (coords: [number, number][]): Promise<ElevationPoint[]> => {
    try {
      const locations = coords.map(c => `${c[0]},${c[1]}`).join('|')
      const r = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${locations}`)
      if (!r.ok) throw new Error('Elevation API error')
      const data = await r.json()
      return data.results?.map((p: any, i: number) => ({
        lat: coords[i][0],
        lng: coords[i][1],
        elevation: p.elevation ?? null,
      })) || []
    } catch {
      // Fallback: mark elevation as unavailable
      return coords.map(c => ({ lat: c[0], lng: c[1], elevation: null }))
    }
  }, [])

  //  Nearest Shelter

  const findNearestShelter = useCallback(async (lat: number, lng: number): Promise<ShelterResult | null> => {
    // Try PostGIS nearest-neighbour first (uses KNN <-> operator)
    try {
      const pgr = await fetch('/api/spatial/nearest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, type: 'shelter' }),
      })
      if (pgr.ok) {
        const pgData = await pgr.json()
        if (pgData.result) {
          return {
            name: pgData.result.name,
            lat: parseFloat(pgData.result.lat),
            lng: parseFloat(pgData.result.lng),
            capacity: pgData.result.capacity || 0,
            current_occupancy: pgData.result.current_occupancy || 0,
            distance: parseFloat(pgData.result.distance_km) || 0,
          }
        }
      }
    } catch { /* PostGIS unavailable, fall through to client-side */ }

    // Fallback: client-side Haversine distance sort
    try {
      const r = await fetch(`/api/config/shelters?lat=${lat}&lng=${lng}&radius=100`)
      if (!r.ok) return null
      const data = await r.json()
      const shelters = data.shelters || []
      if (!shelters.length) return null

      const withDist = shelters.map((s: any) => ({
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        capacity: s.capacity,
        current_occupancy: s.current_occupancy,
        distance: haversine(lat, lng, s.lat, s.lng),
      }))
      withDist.sort((a: ShelterResult, b: ShelterResult) => a.distance - b.distance)
      return withDist[0]
    } catch {
      return null
    }
  }, [])

  //  Flood Risk Query

  const queryFloodRisk = useCallback(async (lat: number, lng: number): Promise<string> => {
    // Try PostGIS ST_Contains / ST_DWithin flood zone check first
    try {
      const pgr = await fetch('/api/spatial/flood-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      })
      if (pgr.ok) {
        const pgData = await pgr.json()
        const lines: string[] = []
        lines.push(`**Flood Risk: ${pgData.risk_level}**`)
        if (pgData.in_flood_zone && pgData.zones.length > 0) {
          pgData.zones.forEach((z: any) => {
            lines.push(`Zone: ${z.zone_name || 'Unknown'} — ${z.flood_type || ''} (${Math.round((z.probability || 0) * 100)}%)`)
          })
        } else if (pgData.nearby_zones.length > 0) {
          lines.push('Nearby flood zones:')
          pgData.nearby_zones.forEach((z: any) => {
            lines.push(`  ${z.zone_name} — ${formatDist(parseFloat(z.distance_km) || 0)} away`)
          })
        }
        if (pgData.predictions.length > 0) {
          lines.push('\nRecent AI Predictions:')
          pgData.predictions.forEach((p: any) => {
            lines.push(`  ${p.hazard_type}: ${Math.round((p.probability || 0) * 100)}% (${p.region_name || ''})`)
          })
        }
        if (lines.length > 1) return lines.join('\n')
      }
    } catch { /* PostGIS unavailable, fall through */ }

    // Fallback: client-side point-in-polygon check
    try {
      const r = await fetch(`/api/map/risk-layer`)
      if (!r.ok) return 'No flood risk data available'
      const data = await r.json()
      if (!data?.features?.length) return 'No flood risk zones found in database'

      // Check if point is inside any risk polygon
      const pt = L.latLng(lat, lng)
      for (const feature of data.features) {
        if (feature.geometry?.type === 'Polygon') {
          const coords = feature.geometry.coordinates[0].map((c: number[]) => L.latLng(c[1], c[0]))
          const polygon = L.polygon(coords)
          if (polygon.getBounds().contains(pt)) {
            const props = feature.properties || {}
            const risk = props.risk_level || props.severity || 'unknown'
            const name = props.name || props.area_name || 'Unnamed zone'
            return `**${name}**\nRisk Level: ${risk.toUpperCase()}${props.description ? `\n${props.description}` : ''}`
          }
        }
      }
      return 'Location is outside mapped flood risk zones'
    } catch {
      return 'Flood risk query failed — database may be unavailable'
    }
  }, [])

  //  Radius Search

  const doRadiusSearch = useCallback(async (lat: number, lng: number, radiusKm: number) => {
    // Try PostGIS ST_DWithin buffer analysis first
    try {
      const pgr = await fetch('/api/spatial/buffer-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radius_km: radiusKm }),
      })
      if (pgr.ok) {
        const pgData = await pgr.json()
        return {
          reports: pgData.reports?.count || 0,
          shelters: (pgData.shelters?.items || []).map((s: any) => ({
            name: s.name,
            lat: parseFloat(s.lat),
            lng: parseFloat(s.lng),
            capacity: s.capacity || 0,
            current_occupancy: s.current_occupancy || 0,
            distance: parseFloat(s.distance_km) || 0,
          })),
        }
      }
    } catch { /* PostGIS unavailable, fall through */ }

    // Fallback: client-side Haversine filter
    const nearbyReports = reports.filter(r => {
      if (!r.coordinates?.length) return false
      return haversine(lat, lng, r.coordinates[0], r.coordinates[1]) <= radiusKm
    })

    // Fetch shelters within radius
    let shelters: ShelterResult[] = []
    try {
      const sr = await fetch(`/api/config/shelters?lat=${lat}&lng=${lng}&radius=${radiusKm}`)
      if (sr.ok) {
        const data = await sr.json()
        shelters = (data.shelters || []).map((s: any) => ({
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          capacity: s.capacity,
          current_occupancy: s.current_occupancy,
          distance: haversine(lat, lng, s.lat, s.lng),
        }))
      }
    } catch { /* ignore */ }

    return { reports: nearbyReports.length, shelters }
  }, [reports])

  //  PostGIS Buffer Analysis

  const runBufferAnalysis = useCallback(async (lat: number, lng: number, radiusKm: number): Promise<BufferAnalysisResult | null> => {
    try {
      const r = await fetch('/api/spatial/buffer-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radius_km: radiusKm }),
      })
      if (!r.ok) return null
      return await r.json()
    } catch {
      return null
    }
  }, [])

  //  PostGIS Density Map

  const fetchDensity = useCallback(async (): Promise<DensityPoint[]> => {
    try {
      const bounds = map.getBounds()
      const r = await fetch('/api/spatial/density', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bounds: {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          },
        }),
      })
      if (!r.ok) return []
      const data = await r.json()
      return data.points || []
    } catch {
      return []
    }
  }, [map])

  //  Export View

  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'geojson' | 'kml'>('json')

  const getExportData = useCallback(() => {
    const bounds = map.getBounds()
    const center = map.getCenter()
    const zoom = map.getZoom()
    return {
      center, zoom, bounds,
      visibleReports: reports.filter(r => {
        if (!r.coordinates?.length) return false
        return bounds.contains(L.latLng(r.coordinates[0], r.coordinates[1]))
      }),
    }
  }, [map, reports])

  const handleExport = useCallback((format?: 'json' | 'csv' | 'geojson' | 'kml') => {
    const fmt = format || exportFormat
    const { center, zoom, bounds, visibleReports } = getExportData()
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    let blob: Blob
    let ext: string

    if (fmt === 'csv') {
      const header = 'id,type,severity,status,location,latitude,longitude,confidence,timestamp\n'
      const rows = visibleReports.map(r =>
        `"${r.reportNumber || r.id}","${r.type || ''}","${r.severity}","${r.status}","${(r.location || '').replace(/"/g, '""')}",${r.coordinates?.[0] || ''},${r.coordinates?.[1] || ''},${r.confidence || 0},"${r.timestamp || ''}"`
      ).join('\n')
      blob = new Blob([header + rows], { type: 'text/csv' })
      ext = 'csv'
    } else if (fmt === 'geojson') {
      const gj = {
        type: 'FeatureCollection' as const,
        features: visibleReports.map(r => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [r.coordinates?.[1] || 0, r.coordinates?.[0] || 0] },
          properties: { id: r.id, type: r.type, severity: r.severity, status: r.status, location: r.location, confidence: r.confidence },
        })),
      }
      blob = new Blob([JSON.stringify(gj, null, 2)], { type: 'application/geo+json' })
      ext = 'geojson'
    } else if (fmt === 'kml') {
      const placemarks = visibleReports.map(r =>
        `<Placemark><name>${r.type || 'Report'} - ${r.severity}</name><description>${(r.location || '').replace(/&/g, '&amp;')}</description><Point><coordinates>${r.coordinates?.[1] || 0},${r.coordinates?.[0] || 0},0</coordinates></Point></Placemark>`
      ).join('\n')
      const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>AEGIS Map Export</name><description>Exported ${visibleReports.length} reports at ${new Date().toISOString()}</description>\n${placemarks}\n</Document></kml>`
      blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' })
      ext = 'kml'
    } else {
      const data = {
        timestamp: new Date().toISOString(),
        viewport: { center: [center.lat, center.lng], zoom, bounds: { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() } },
        reports_in_view: visibleReports.length,
        reports: visibleReports.map(r => ({ id: r.id, type: r.type, severity: r.severity, location: r.location, coordinates: r.coordinates, status: r.status, confidence: r.confidence })),
      }
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      ext = 'json'
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aegis-map-export-${ts}.${ext}`
    a.click()
    URL.revokeObjectURL(url)

    setResult(`Exported ${visibleReports.length} reports as ${fmt.toUpperCase()}`)
    setActiveTool(null)
  }, [map, reports, exportFormat, getExportData])

  //  Map Click Handler

  const handleMapClick = useCallback(async (e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng
    const pt: [number, number] = [lat, lng]

    switch (activeTool) {
      case 'distance':
        setPoints(prev => [...prev, pt])
        break

      case 'area':
        setPoints(prev => [...prev, pt])
        break

      case 'buffer':
        setPoints([pt])
        setResult(`Buffer zone: ${bufferRadius} km radius at ${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        break

      case 'radius-search': {
        setPoints([pt])
        setLoading(true)
        const res = await doRadiusSearch(lat, lng, bufferRadius)
        setRadiusResults(res)
        setResult(`Found ${res.reports} reports and ${res.shelters.length} shelters within ${bufferRadius} km`)
        setLoading(false)
        break
      }

      case 'flood-risk': {
        setPoints([pt])
        setLoading(true)
        const risk = await queryFloodRisk(lat, lng)
        setResult(risk)
        setLoading(false)
        break
      }

      case 'nearest-shelter': {
        setPoints([pt])
        setLoading(true)
        const shelter = await findNearestShelter(lat, lng)
        setNearestShelter(shelter)
        if (shelter) {
          setResult(`Nearest: **${shelter.name}** (${formatDist(shelter.distance)})\nCapacity: ${shelter.current_occupancy}/${shelter.capacity}`)
        } else {
          setResult('No shelters found in the database')
        }
        setLoading(false)
        break
      }

      case 'elevation': {
        const newPts = [...points, pt]
        setPoints(newPts)
        setLoading(true)
        const elev = await fetchElevation(newPts)
        setElevationData(elev)
        const vals = elev.filter(e => e.elevation !== null)
        if (vals.length) {
          const min = Math.min(...vals.map(e => e.elevation!))
          const max = Math.max(...vals.map(e => e.elevation!))
          setResult(`Elevation: ${min.toFixed(0)}m – ${max.toFixed(0)}m (${newPts.length} points)`)
        } else {
          setResult('Elevation data unavailable for these coordinates')
        }
        setLoading(false)
        break
      }

      case 'coord-lookup': {
        setPoints([pt])
        setLoading(true)
        const addr = await reverseGeocode(lat, lng)
        setGeocodeResult(addr)
        setResult(`${lat.toFixed(6)}, ${lng.toFixed(6)}\n${addr}`)
        setLoading(false)
        break
      }

      case 'bearing': {
        const newPts = [...points, pt]
        if (newPts.length > 2) {
          setPoints([pt])
          setResult(null)
        } else {
          setPoints(newPts)
          if (newPts.length === 2) {
            const b = bearing(newPts[0][0], newPts[0][1], newPts[1][0], newPts[1][1])
            const dist = haversine(newPts[0][0], newPts[0][1], newPts[1][0], newPts[1][1])
            setResult(`Bearing: ${b.toFixed(1)}° (${compassDirection(b)})\nDistance: ${formatDist(dist)}`)
          }
        }
        break
      }

      case 'buffer-analysis': {
        setPoints([pt])
        setLoading(true)
        const analysis = await runBufferAnalysis(lat, lng, bufferRadius)
        setBufferAnalysis(analysis)
        if (analysis) {
          const lines: string[] = [
            `**PostGIS Buffer Analysis** (${bufferRadius} km)`,
            `Reports: ${analysis.reports.count}`,
            `Shelters: ${analysis.shelters.count}`,
            `Active Alerts: ${analysis.alerts.count}`,
            `Flood Zones: ${analysis.flood_zones.count}`,
          ]
          setResult(lines.join('\n'))
        } else {
          setResult('PostGIS buffer analysis unavailable — ensure database has PostGIS extension')
        }
        setLoading(false)
        break
      }

      case 'density': {
        setPoints([pt])
        setLoading(true)
        const pts = await fetchDensity()
        setDensityPoints(pts)
        setResult(`**Incident Density**: ${pts.length} data points in current view\n${pts.length > 0 ? 'Density markers shown on map' : 'No incident data found in this area'}`)
        setLoading(false)
        break
      }

      default:
        break
    }
  }, [activeTool, points, bufferRadius, doRadiusSearch, queryFloodRisk, findNearestShelter, fetchElevation, reverseGeocode, runBufferAnalysis, fetchDensity])

  // Auto-update distance result
  useEffect(() => {
    if (activeTool === 'distance' && points.length >= 2) {
      setResult(`Total distance: ${formatDist(totalDistance)} (${points.length} points)`)
    }
  }, [activeTool, points, totalDistance])

  // Auto-update area result
  useEffect(() => {
    if (activeTool === 'area' && points.length >= 3) {
      const area = polygonArea
      setResult(`Area: ${area < 1 ? `${(area * 1e6).toFixed(0)} m²` : `${area.toFixed(3)} km²`} (${points.length} vertices)`)
    }
  }, [activeTool, points, polygonArea])

  const activeToolDef = getTools(lang).find(td => td.id === activeTool)

  return (
    <>
      {/* Click handler */}
      <ToolClickHandler activeTool={activeTool} onMapClick={handleMapClick} />

      {/* Distance measurement line */}
      {activeTool === 'distance' && points.length >= 2 && (
        <Polyline positions={points} pathOptions={{ color: '#3b82f6', weight: 3, dashArray: '8 4' }} />
      )}

      {/* Area measurement polygon */}
      {activeTool === 'area' && points.length >= 3 && (
        <Polygon positions={points} pathOptions={{ color: '#8b5cf6', weight: 2, fillColor: '#8b5cf6', fillOpacity: 0.15 }} />
      )}
      {activeTool === 'area' && points.length >= 2 && points.length < 3 && (
        <Polyline positions={points} pathOptions={{ color: '#8b5cf6', weight: 2, dashArray: '6 4' }} />
      )}

      {/* Buffer / Radius search circle */}
      {(activeTool === 'buffer' || activeTool === 'radius-search' || activeTool === 'buffer-analysis') && points.length === 1 && (
        <Circle
          center={points[0]}
          radius={bufferRadius * 1000}
          pathOptions={{
            color: activeTool === 'buffer' ? '#f59e0b' : activeTool === 'buffer-analysis' ? '#7c3aed' : '#10b981',
            weight: 2,
            fillColor: activeTool === 'buffer' ? '#f59e0b' : activeTool === 'buffer-analysis' ? '#7c3aed' : '#10b981',
            fillOpacity: 0.1,
          }}
        />
      )}

      {/* Elevation profile line */}
      {activeTool === 'elevation' && points.length >= 2 && (
        <Polyline positions={points} pathOptions={{ color: '#92400e', weight: 3, dashArray: '4 4' }} />
      )}

      {/* Bearing line */}
      {activeTool === 'bearing' && points.length === 2 && (
        <Polyline positions={points} pathOptions={{ color: '#dc2626', weight: 2, dashArray: '10 6' }}>
          <Popup>
            <p className="text-xs font-semibold">{result}</p>
          </Popup>
        </Polyline>
      )}

      {/* Nearest shelter marker */}
      {activeTool === 'nearest-shelter' && nearestShelter && (
        <>
          <Marker position={[nearestShelter.lat, nearestShelter.lng]} icon={toolIcon('#10b981', '<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;12&quot; height=&quot;12&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;white&quot; stroke-width=&quot;2.5&quot;><path d=&quot;m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z&quot;/><polyline points=&quot;9 22 9 12 15 12 15 22&quot;/></svg>')}>
            <Popup>
              <p className="font-semibold text-sm">{nearestShelter.name}</p>
              <p className="text-xs">{t('spatial.distanceLabel', lang)}: {formatDist(nearestShelter.distance)}</p>
              <p className="text-xs">{t('spatial.occupancy', lang)}: {nearestShelter.current_occupancy}/{nearestShelter.capacity}</p>
            </Popup>
          </Marker>
          {points.length > 0 && (
            <Polyline
              positions={[points[0], [nearestShelter.lat, nearestShelter.lng]]}
              pathOptions={{ color: '#10b981', weight: 2, dashArray: '6 4' }}
            />
          )}
        </>
      )}

      {/* Density map circles */}
      {activeTool === 'density' && densityPoints.map((dp, i) => (
        <Circle
          key={`density-${i}`}
          center={[dp.lat, dp.lng]}
          radius={200}
          pathOptions={{
            color: dp.intensity > 0.7 ? '#ef4444' : dp.intensity > 0.4 ? '#f59e0b' : '#22c55e',
            weight: 1,
            fillColor: dp.intensity > 0.7 ? '#ef4444' : dp.intensity > 0.4 ? '#f59e0b' : '#22c55e',
            fillOpacity: 0.35 + dp.intensity * 0.3,
          }}
        />
      ))}

      {/* Buffer analysis shelter markers */}
      {activeTool === 'buffer-analysis' && bufferAnalysis?.shelters.items.map((s: any, i: number) => (
        <Marker
          key={`ba-shelter-${i}`}
          position={[parseFloat(s.lat), parseFloat(s.lng)]}
          icon={toolIcon('#7c3aed', '<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;12&quot; height=&quot;12&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;white&quot; stroke-width=&quot;2.5&quot;><path d=&quot;m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z&quot;/><polyline points=&quot;9 22 9 12 15 12 15 22&quot;/></svg>')}
        >
          <Popup>
            <p className="font-semibold text-sm">{s.name}</p>
            <p className="text-xs">{formatDist(parseFloat(s.distance_km) || 0)} {t('spatial.away', lang)}</p>
            <p className="text-xs">{t('spatial.capacity', lang)}: {s.current_occupancy || 0}/{s.capacity || '?'}</p>
          </Popup>
        </Marker>
      ))}

      {/* Point markers */}
      {points.map((p, i) => (
        <Marker key={`tool-pt-${i}`} position={p} icon={toolIcon('#3b82f6', String(i + 1))}>
          {activeTool === 'elevation' && elevationData[i] && (
            <Popup>
              <p className="text-xs">
                Elevation: {elevationData[i].elevation !== null ? `${elevationData[i].elevation!.toFixed(0)} m` : 'N/A'}
              </p>
            </Popup>
          )}
          {activeTool === 'coord-lookup' && geocodeResult && (
            <Popup>
              <div className="text-xs max-w-[250px]">
                <p className="font-mono">{p[0].toFixed(6)}, {p[1].toFixed(6)}</p>
                <p className="mt-1 text-gray-600">{geocodeResult}</p>
              </div>
            </Popup>
          )}
        </Marker>
      ))}

      {/*  Toolbar UI  */}
      <div className="absolute top-3 right-3 z-[760] select-none" style={{ pointerEvents: 'auto' }}>
        {/* Toggle button — hidden when the parent toolbar controls it */}
        {!hideToggle && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="bg-white dark:bg-gray-800 shadow-lg rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
            title={t('spatial.spatialAnalysisTools', lang)}
          >
            <Ruler className="w-4 h-4" />
            {t('spatial.displayTools', lang)}
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}

        {/* Tool panel */}
        {effectiveExpanded && (
          <div className="mt-1 bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden w-64">
            {/* Tool buttons */}
            <div className="p-2 grid grid-cols-3 gap-1">
              {getTools(lang).map(tool => (
                <button
                  key={tool.id}
                  onClick={() => selectTool(tool.id)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                    activeTool === tool.id
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={tool.description}
                >
                  {tool.icon}
                  {tool.label}
                </button>
              ))}
            </div>

            {/* Active tool info + result */}
            {activeTool && (
              <div className="border-t border-gray-200 dark:border-gray-700 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{activeToolDef?.label}</p>
                  <div className="flex gap-1">
                    <button onClick={reset} className="text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" title={t('common.reset', lang)}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { reset(); setActiveTool(null) }} className="text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" title={t('spatial.closeTool', lang)}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-300 mb-2">{activeToolDef?.description}</p>

                {/* Radius input for buffer/radius-search/buffer-analysis */}
                {(activeTool === 'buffer' || activeTool === 'radius-search' || activeTool === 'buffer-analysis') && (
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-[10px] text-gray-500 dark:text-gray-300">{t('spatial.radius', lang)}:</label>
                    <input
                      type="range"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={bufferRadius}
                      onChange={e => setBufferRadius(Number(e.target.value))}
                      className="flex-1 h-1"
                    />
                    <span className="text-[10px] font-mono w-12 text-right text-gray-600 dark:text-gray-300">{bufferRadius} km</span>
                  </div>
                )}

                {/* Export format picker */}
                {activeTool === 'export' && (
                  <div className="mb-2">
                    <label className="text-[10px] text-gray-500 dark:text-gray-300 mb-1 block">{t('spatial.exportFormat', lang)}:</label>
                    <div className="grid grid-cols-2 gap-1">
                      {(['json', 'csv', 'geojson', 'kml'] as const).map(fmt => (
                        <button
                          key={fmt}
                          onClick={() => { setExportFormat(fmt); handleExport(fmt) }}
                          className={`text-[10px] px-2 py-1.5 rounded font-medium transition-colors
                            ${exportFormat === fmt
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900'
                            }`}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Loading indicator */}
                {loading && (
                  <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                    <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    {t('common.querying', lang)}
                  </div>
                )}

                {/* Result */}
                {result && !loading && (
                  <div className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap leading-relaxed">
                    {result.split('\n').map((line, i) => {
                      // SECURITY: Sanitize HTML before rendering to prevent XSS
                      const html = sanitizeHtml(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'))
                      return <p key={i} dangerouslySetInnerHTML={{ __html: html }} />
                    })}
                  </div>
                )}

                {/* Elevation mini chart */}
                {activeTool === 'elevation' && elevationData.length >= 2 && (
                  <div className="mt-2">
                    <p className="text-[10px] text-gray-500 dark:text-gray-300 mb-1">{t('spatial.elevationProfile', lang)}</p>
                    <div className="flex items-end gap-px h-12 bg-gray-100 dark:bg-gray-900 rounded p-1">
                      {elevationData.map((e, i) => {
                        const vals = elevationData.filter(v => v.elevation !== null).map(v => v.elevation!)
                        const min = Math.min(...vals)
                        const max = Math.max(...vals)
                        const range = max - min || 1
                        const h = e.elevation !== null ? ((e.elevation - min) / range) * 100 : 0
                        return (
                          <div
                            key={i}
                            className="flex-1 bg-amber-500 dark:bg-amber-600 rounded-t"
                            style={{ height: `${Math.max(4, h)}%` }}
                            title={e.elevation !== null ? `${e.elevation.toFixed(0)} m` : 'N/A'}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Radius search results */}
                {activeTool === 'radius-search' && radiusResults && (
                  <div className="mt-2 space-y-1">
                    {radiusResults.shelters.slice(0, 3).map((s, i) => (
                      <div key={i} className="text-[10px] text-gray-600 dark:text-gray-300 flex justify-between">
                        <span className="truncate">{s.name}</span>
                        <span className="font-mono">{formatDist(s.distance)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Buffer analysis detailed results */}
                {activeTool === 'buffer-analysis' && bufferAnalysis && (
                  <div className="mt-2 space-y-1.5">
                    {bufferAnalysis.reports.count > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">Top Reports:</p>
                        {bufferAnalysis.reports.items.slice(0, 3).map((r: any, i: number) => (
                          <div key={i} className="text-[10px] text-gray-500 dark:text-gray-300 flex justify-between">
                            <span className="truncate">{r.type || 'Report'} ({r.severity})</span>
                            <span className="font-mono">{formatDist(parseFloat(r.distance_km) || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {bufferAnalysis.shelters.count > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">Shelters:</p>
                        {bufferAnalysis.shelters.items.slice(0, 3).map((s: any, i: number) => (
                          <div key={i} className="text-[10px] text-gray-500 dark:text-gray-300 flex justify-between">
                            <span className="truncate">{s.name}</span>
                            <span className="font-mono">{formatDist(parseFloat(s.distance_km) || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {bufferAnalysis.flood_zones.count > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-600 dark:text-red-400">Flood Zones: {bufferAnalysis.flood_zones.count}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Density legend */}
                {activeTool === 'density' && densityPoints.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] text-gray-500 dark:text-gray-300 mb-1">Density Legend</p>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Low</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Medium</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> High</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

