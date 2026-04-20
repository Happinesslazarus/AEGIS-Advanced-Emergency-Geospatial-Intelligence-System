/**
 * Extended 3D map with colour-coded risk overlays and hazard-zone
 * extrusions. Layers are toggled through the HazardPredictionTimeline
 * and the colour ramp follows the global severity palette.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getAnyToken } from '../../utils/api'
import { Map as MapLibreMap, NavigationControl, AttributionControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Deck } from '@deck.gl/core'
import { ScatterplotLayer, ArcLayer, ColumnLayer, TextLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import {
  RotateCcw, RefreshCw, Eye, EyeOff,
  Maximize2, CircleDot, Orbit
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { RISK_HEX, STATION_HEX, SEVERITY_RGBA, STATUS_RGBA } from '../../utils/colorTokens'

const RISK_COLORS: Record<string, string> = RISK_HEX
const STATION_COLORS: Record<string, string> = STATION_HEX

const API = ''

// Global fallback centre (only used when no center prop is provided)
const DEFAULT_CENTER: [number, number] = [0, 0] // [lng, lat] for MapLibre
const DEFAULT_ZOOM = 3
const DEFAULT_PITCH = 55
const DEFAULT_BEARING = -20

const SEV_COLOURS = SEVERITY_RGBA
const STATUS_COLOURS = STATUS_RGBA

// OpenFreeMap dark style (free, no token, OSM-based) — replaces CARTO which is unavailable
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

interface Report {
  id: string | number
  location?: string
  latitude?: number
  longitude?: number
  coordinates?: [number, number]
  severity?: string
  status?: string
  type?: string
  category?: string
  description?: string
  title?: string
  created_at?: string
}

interface Props {
  reports?: Report[]
  showFloodPredictions?: boolean
  showEvacuationRoutes?: boolean
  center?: [number, number] // [lat, lng]
  zoom?: number
  className?: string
  height?: string
  onReportClick?: (r: any) => void
}

export default function Map3DView({
  reports = [],
  showFloodPredictions = true,
  showEvacuationRoutes = false,
  center,
  zoom = DEFAULT_ZOOM,
  className = '',
  height = '100%',
  onReportClick,
}: Props): JSX.Element {
  const lang = useLanguage()

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const deckRef = useRef<Deck | null>(null)
  const animFrameRef = useRef<number>(0)
  const onReportClickRef = useRef(onReportClick)
  useEffect(() => { onReportClickRef.current = onReportClick }, [onReportClick])

  const [riverData, setRiverData] = useState<any[]>([])
  const [distressData, setDistressData] = useState<any[]>([])
  const [evacuationData, setEvacuationData] = useState<any[]>([])
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [show3DBuildings, setShow3DBuildings] = useState(true)
  const [animationTime, setAnimationTime] = useState(0)
  const [markerCount, setMarkerCount] = useState({ reports: 0, rivers: 0, distress: 0, riskZones: 0, stations: 0, predictions: 0 })

  // Real API data (replaces static globalFloodData)
  const [riskLayerData, setRiskLayerData] = useState<any[]>([])
  const [stationsData, setStationsData] = useState<any[]>([])
  const [predictionsData, setPredictionsData] = useState<any[]>([])

  // Convert center from [lat, lng] to [lng, lat] for MapLibre
  const mapCenter = useMemo<[number, number]>(() => {
    if (center) return [center[1], center[0]]
    return DEFAULT_CENTER
  }, [center?.[0], center?.[1]])

  const resolvePredictionCoords = useCallback((prediction: any, index: number): [number, number] => {
    const directLat = Number(
      prediction?.lat ?? prediction?.latitude ?? prediction?.coords?.[0] ?? prediction?.center?.lat
    )
    const directLng = Number(
      prediction?.lng ?? prediction?.lon ?? prediction?.longitude ?? prediction?.coords?.[1] ?? prediction?.center?.lng
    )

    if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
      return [directLat, directLng]
    }

    const seed = String(prediction?.area || prediction?.id || index)
    let hash = 0
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    const baseLat = center?.[0] ?? mapCenter[1]
    const baseLng = center?.[1] ?? mapCenter[0]
    const latOffset = (((hash % 1000) / 1000) - 0.5) * 0.08
    const lngOffset = ((((hash / 1000) % 1000) / 1000) - 0.5) * 0.12
    return [baseLat + latOffset, baseLng + lngOffset]
  }, [center, mapCenter])

  // Animation loop for pulsing effects
  useEffect(() => {
    let running = true
    const animate = () => {
      if (!running) return
      setAnimationTime(Date.now() % 10000)
      animFrameRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => { running = false; if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [])

  // Init MapLibre
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: DARK_STYLE,
      center: mapCenter,
      zoom,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      attributionControl: false,
    })

    map.addControl(new NavigationControl({ showCompass: true, showZoom: false, visualizePitch: true }), 'bottom-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      // 3D buildings layer from OSM data in the CartoDB style
      if (map.getSource('carto')) {
        map.addLayer({
          id: '3d-buildings',
          source: 'carto',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': '#1a1a2e',
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 16, ['get', 'render_height']],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.7,
          },
        })
      }
    })

    mapRef.current = map

    // Deck.gl overlay
    const deck = new Deck({
      parent: containerRef.current,
      style: { position: 'absolute', top: '0', left: '0', zIndex: '1', pointerEvents: 'none' },
      viewState: {
        longitude: mapCenter[0],
        latitude: mapCenter[1],
        zoom,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
      },
      controller: false, // MapLibre handles controls
      layers: [],
      getTooltip: ({ object }: any) => {
        if (!object) return null
        if (object._type === 'report') {
          return { html: `<div style="background:#1f2937;color:white;padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid #374151;max-width:250px;"><b>${object.title || object.category || 'Report'}</b><br/><span style="color:#9ca3af">${object.location || ''}</span><br/><span style="color:${object.severity === 'High' ? '#ef4444' : object.severity === 'Medium' ? '#f59e0b' : '#3b82f6'};font-weight:600">${object.severity || ''}</span></div>` }
        }
        if (object._type === 'river') {
          return { html: `<div style="background:#1f2937;color:white;padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid #374151;"><b>${object.stationName || object.riverName}</b><br/><span style="font-size:18px;font-weight:800;font-family:monospace">${object.levelMetres?.toFixed(2)}m</span><br/><span style="color:${object.status === 'NORMAL' ? '#22c55e' : '#ef4444'}">${object.status}</span></div>` }
        }
        if (object._type === 'distress') {
          return { html: `<div style="background:#1f2937;color:#ef4444;padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid #7f1d1d;"><b>🚨 DISTRESS BEACON</b><br/><span style="color:white">${object.citizenName || 'Citizen'}</span></div>` }
        }
        if (object._type === 'globalZone') {
          const pop = object.population >= 1000000 ? `${(object.population / 1000000).toFixed(1)}M` : `${(object.population / 1000).toFixed(0)}K`
          return { html: `<div style="background:#1f2937;color:white;padding:10px 14px;border-radius:10px;font-size:12px;border:1px solid #374151;max-width:300px;"><b style="font-size:14px;">${object.name}</b><br/><span style="color:${(RISK_COLORS as any)[object.risk]};font-weight:700;text-transform:uppercase;font-size:10px;">${object.risk} RISK</span> <span style="color:#9ca3af;font-size:10px;">— ${object.type} — ${object.country}</span><br/><span style="color:#d1d5db;font-size:11px;line-height:1.4;">${object.description}</span><br/><span style="color:#60a5fa;font-size:10px;">Pop: ${pop}</span>${object.rivers?.length ? `<br/><span style="color:#22d3ee;font-size:10px;">🌊 ${object.rivers.join(', ')}</span>` : ''}</div>` }
        }
        if (object._type === 'globalRiver') {
          return { html: `<div style="background:#1f2937;color:white;padding:10px 14px;border-radius:10px;font-size:12px;border:1px solid #374151;max-width:280px;"><b style="font-size:14px;">🌊 ${object.name}</b><br/><span style="color:${(RISK_COLORS as any)[object.floodRisk]};font-weight:700;text-transform:uppercase;font-size:10px;">${object.floodRisk} flood risk</span><br/><span style="color:#9ca3af;">${object.country}</span><br/><span style="font-family:monospace;font-size:13px;font-weight:700;">${object.lengthKm?.toLocaleString()} km</span> <span style="color:#9ca3af;">— Basin: ${object.basinPopulationMillions}M people</span></div>` }
        }
        if (object._type === 'globalStation') {
          return { html: `<div style="background:#1f2937;color:white;padding:10px 14px;border-radius:10px;font-size:12px;border:1px solid #374151;max-width:260px;"><b style="font-size:13px;">${object.name}</b><br/><span style="color:${(STATION_COLORS as any)[object.status]};font-weight:700;text-transform:uppercase;font-size:10px;">${object.status}</span> <span style="color:#9ca3af;">— ${object.country}</span>${object.waterLevel != null ? `<br/><span style="font-size:18px;font-weight:800;font-family:monospace;">${object.waterLevel}m</span> <span style="color:#6b7280;">/ ${object.maxLevel}m max</span><br/><span style="color:#9ca3af;font-size:10px;">Trend: ${object.trend || 'unknown'}</span>` : ''}</div>` }
        }
        return null
      },
    })

    // Sync deck viewState with MapLibre
    map.on('move', () => {
      const center = map.getCenter()
      deck.setProps({
        viewState: {
          longitude: center.lng,
          latitude: center.lat,
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        },
      })
    })

    // Click handler — pick Deck.gl objects via MapLibre click event
    map.on('click', (e) => {
      if (!deckRef.current) return
      const picked = deckRef.current.pickObject({ x: e.point.x, y: e.point.y, radius: 10 })
      if (picked?.object?._type === 'report' && onReportClickRef.current) {
        onReportClickRef.current(picked.object)
      }
    })

    // Cursor change on hover over clickable layers
    map.on('mousemove', (e) => {
      if (!deckRef.current) return
      const picked = deckRef.current.pickObject({ x: e.point.x, y: e.point.y, radius: 6 })
      map.getCanvas().style.cursor = picked?.object?._type === 'report' ? 'pointer' : ''
    })

    deckRef.current = deck

    return () => {
      deck.finalize()
      map.remove()
      mapRef.current = null
      deckRef.current = null
    }
  }, [])

  // Fly to new location when center/zoom props change
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.flyTo({
      center: mapCenter,
      zoom,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      duration: 1500,
    })
  }, [mapCenter, zoom])

  // Fetch live data
  const fetchRivers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/rivers/levels`)
      if (!res.ok) return
      const data = await res.json()
      setRiverData(data.levels || [])
    } catch {}
  }, [])

  const fetchDistress = useCallback(async () => {
    try {
      const token = getAnyToken()
      const rawUser = localStorage.getItem('aegis-user') || localStorage.getItem('aegis-citizen-user')
      let role = ''
      try { role = String(rawUser ? JSON.parse(rawUser)?.role || '' : '').toLowerCase() } catch {}
      if (!token || !['admin', 'operator', 'manager'].includes(role)) return
      const res = await fetch(`${API}/api/distress/active`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return
      const data = await res.json()
      setDistressData(data.beacons || data.active || [])
    } catch {}
  }, [])

  const fetchEvacuation = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/incidents/flood/evacuation/routes`)
      if (!res.ok) return
      const data = await res.json()
      setEvacuationData(data.routes || [])
    } catch {}
  }, [])

  // Fetch PostGIS risk layer (flood polygons) — replaces static GLOBAL_FLOOD_ZONES
  const fetchRiskLayer = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/map/risk-layer`)
      if (!res.ok) return
      const data = await res.json()
      if (data?.features) {
        setRiskLayerData(data.features.map((f: any) => {
          const p = f.properties || {}
          const coords = f.geometry?.type === 'Point'
            ? [f.geometry.coordinates[1], f.geometry.coordinates[0]]
            : f.geometry?.coordinates?.[0]?.[0]
              ? [f.geometry.coordinates[0][0][1], f.geometry.coordinates[0][0][0]]
              : null
          return coords ? {
            name: p.name || p.area_name || 'Risk Zone',
            coords,
            risk: p.risk_level || p.severity || 'medium',
            description: p.description || '',
            type: p.type || 'flood',
          } : null
        }).filter(Boolean))
      }
    } catch {}
  }, [])

  // Fetch real monitoring stations — replaces static GLOBAL_STATIONS
  const fetchStations = useCallback(async () => {
    try {
      const targetLat = center?.[0] ?? mapCenter[1]
      const targetLng = center?.[1] ?? mapCenter[0]
      const params = new URLSearchParams({
        lat: String(targetLat),
        lng: String(targetLng),
        dist: '120',
      })

      let res = await fetch(`${API}/api/flood-data/stations?${params.toString()}`)
      if (!res.ok) {
        res = await fetch(`${API}/api/flood-data/stations?region=global&${params.toString()}`)
      }
      if (!res.ok) return
      const data = await res.json()
      const features: any[] = data.features || []
      setStationsData(features.map((f: any) => {
        const p = f.properties || {}
        const lng = f.geometry?.coordinates?.[0]
        const lat = f.geometry?.coordinates?.[1]
        if (!lat || !lng) return null
        const level = parseFloat(p.level_m) || 0
        const typical = parseFloat(p.typical_high_m) || 0
        const status = p.level_status || 'normal'
        return {
          name: p.station_name || p.station_id || 'Station',
          coords: [lat, lng],
          status,
          waterLevel: level,
          maxLevel: typical,
          trend: p.trend || 'steady',
          river: p.river_name || '',
          jurisdiction: p.jurisdiction || 'EA',
        }
      }).filter(Boolean))
    } catch {}
  }, [center, mapCenter])

  // Fetch AI predictions — replaces hardcoded prediction columns
  const fetchPredictions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/predictions`)
      if (!res.ok) return
      const data: any[] = await res.json()
      setPredictionsData(
        data
          .map((p, idx) => ({
            ...p,
            coords: resolvePredictionCoords(p, idx),
            prob: parseFloat(p.probability) || 0,
          }))
          .filter(Boolean)
      )
    } catch {}
  }, [resolvePredictionCoords])

  useEffect(() => {
    fetchRivers()
    fetchDistress()
    fetchEvacuation()
    fetchRiskLayer()
    fetchStations()
    fetchPredictions()
    const interval = setInterval(() => {
      fetchRivers()
      fetchStations()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchRivers, fetchDistress, fetchEvacuation, fetchRiskLayer, fetchStations, fetchPredictions])

  // Auto-rotate
  useEffect(() => {
    if (!autoRotate || !mapRef.current) return
    const map = mapRef.current
    let bearing = map.getBearing()
    const rotate = () => {
      if (!autoRotate) return
      bearing = (bearing + 0.15) % 360
      map.setBearing(bearing)
      animFrameRef.current = requestAnimationFrame(rotate)
    }
    rotate()
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [autoRotate])

  // Toggle 3D buildings
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    try {
      if (map.getLayer('3d-buildings')) {
        map.setLayoutProperty('3d-buildings', 'visibility', show3DBuildings ? 'visible' : 'none')
      }
    } catch {}
  }, [show3DBuildings])

  // Update Deck.gl layers
  useEffect(() => {
    if (!deckRef.current) return

    const pulse = Math.sin(animationTime / 500) * 0.3 + 0.7 // 0.4 to 1.0

    const layers: any[] = []

    // Report columns (3D extruded)
    const reportData = reports.filter(r => {
      const lat = r.latitude ?? r.coordinates?.[0]
      const lng = r.longitude ?? r.coordinates?.[1]
      return lat && lng
    }).map(r => ({
      ...r,
      _type: 'report',
      _lat: r.latitude ?? r.coordinates?.[0] ?? 0,
      _lng: r.longitude ?? r.coordinates?.[1] ?? 0,
    }))

    if (reportData.length > 0) {
      layers.push(
        new ColumnLayer({
          id: 'report-columns',
          data: reportData,
          getPosition: (d: any) => [d._lng, d._lat],
          getElevation: (d: any) => d.severity === 'High' ? 300 : d.severity === 'Medium' ? 200 : 120,
          getFillColor: (d: any) => SEV_COLOURS[d.severity || 'Low'] || [107, 114, 128, 180],
          radius: 25,
          diskResolution: 12,
          extruded: true,
          pickable: true,
          opacity: 0.9,
          elevationScale: 1,
        })
      )

      // Glow rings at base
      layers.push(
        new ScatterplotLayer({
          id: 'report-glow',
          data: reportData,
          getPosition: (d: any) => [d._lng, d._lat],
          getRadius: 60 * pulse,
          getFillColor: (d: any) => {
            const c = SEV_COLOURS[d.severity || 'Low'] || [107, 114, 128, 180]
            return [c[0], c[1], c[2], 80]
          },
          pickable: false,
        })
      )
    }

    // Heatmap mode
    if (showHeatmap && reportData.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: 'report-heatmap',
          data: reportData,
          getPosition: (d: any) => [d._lng, d._lat],
          getWeight: (d: any) => d.severity === 'High' ? 5 : d.severity === 'Medium' ? 3 : 1,
          radiusPixels: 60,
          intensity: 1.5,
          threshold: 0.1,
          colorRange: [
            [65, 182, 196],
            [127, 205, 187],
            [199, 233, 180],
            [237, 248, 177],
            [255, 255, 204],
            [255, 237, 160],
            [254, 217, 118],
            [254, 178, 76],
            [253, 141, 60],
            [252, 78, 42],
            [227, 26, 28],
            [177, 0, 38],
          ],
        })
      )
    }

    // River gauge stations (3D orbs)
    const riverMarkers = riverData.filter(r => r.coordinates?.lat && r.coordinates?.lng).map(r => ({
      ...r,
      _type: 'river',
    }))

    if (riverMarkers.length > 0) {
      // Column for water level
      layers.push(
        new ColumnLayer({
          id: 'river-columns',
          data: riverMarkers,
          getPosition: (d: any) => [d.coordinates.lng, d.coordinates.lat],
          getElevation: (d: any) => (d.levelMetres || 1) * 100,
          getFillColor: (d: any) => STATUS_COLOURS[d.status] || [34, 197, 94, 180],
          radius: 35,
          diskResolution: 20,
          extruded: true,
          pickable: true,
          opacity: 0.85,
        })
      )

      // Glow base
      layers.push(
        new ScatterplotLayer({
          id: 'river-glow',
          data: riverMarkers,
          getPosition: (d: any) => [d.coordinates.lng, d.coordinates.lat],
          getRadius: 80 * pulse,
          getFillColor: (d: any) => {
            const c = STATUS_COLOURS[d.status] || [34, 197, 94, 180]
            return [c[0], c[1], c[2], 60]
          },
          pickable: false,
        })
      )
    }

    // Distress beacons (pulsing red pillars)
    const distressMarkers = distressData.filter((b: any) => {
      const lat = b.latitude || b.location?.lat
      const lng = b.longitude || b.location?.lng
      return lat && lng
    }).map((b: any) => ({
      ...b,
      _type: 'distress',
      _lat: b.latitude || b.location?.lat,
      _lng: b.longitude || b.location?.lng,
    }))

    if (distressMarkers.length > 0) {
      layers.push(
        new ColumnLayer({
          id: 'distress-columns',
          data: distressMarkers,
          getPosition: (d: any) => [d._lng, d._lat],
          getElevation: 500,
          getFillColor: [239, 68, 68, Math.round(200 * pulse)],
          radius: 20,
          diskResolution: 16,
          extruded: true,
          pickable: true,
          opacity: 0.95,
        })
      )

      layers.push(
        new ScatterplotLayer({
          id: 'distress-pulse',
          data: distressMarkers,
          getPosition: (d: any) => [d._lng, d._lat],
          getRadius: 120 * pulse,
          getFillColor: [239, 68, 68, 60],
          pickable: false,
        })
      )
    }

    // Evacuation route arcs
    if (showEvacuationRoutes && evacuationData.length > 0) {
      const arcData = evacuationData.filter((r: any) => r.coordinates?.length >= 2).map((route: any) => {
        const coords = route.coordinates
        const start = Array.isArray(coords[0]) ? coords[0] : [coords[0].lng, coords[0].lat]
        const end = Array.isArray(coords[coords.length - 1]) ? coords[coords.length - 1] : [coords[coords.length - 1].lng, coords[coords.length - 1].lat]
        return { ...route, _start: start, _end: end }
      })

      if (arcData.length > 0) {
        layers.push(
          new ArcLayer({
            id: 'evacuation-arcs',
            data: arcData,
            getSourcePosition: (d: any) => d._start,
            getTargetPosition: (d: any) => d._end,
            getSourceColor: [34, 197, 94, 200],
            getTargetColor: [59, 130, 246, 200],
            getWidth: 3,
            pickable: true,
          })
        )
      }
    }

    // Risk Zones from real API (replaces static GLOBAL_FLOOD_ZONES)
    const hexToRgba = (hex: string, alpha: number): [number, number, number, number] => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return [r, g, b, alpha]
    }

    const riskZoneData = riskLayerData.map(z => ({
      ...z,
      _type: 'globalZone' as const,
      _lng: z.coords[1],
      _lat: z.coords[0],
      population: 0,
      country: '',
      rivers: [],
    }))

    if (riskZoneData.length > 0) {
      layers.push(
        new ColumnLayer({
          id: 'risk-zone-columns',
          data: riskZoneData,
          getPosition: (d: any) => [d._lng, d._lat],
          getElevation: (d: any) => d.risk === 'critical' ? 800 : d.risk === 'high' ? 500 : d.risk === 'medium' ? 300 : 150,
          getFillColor: (d: any) => hexToRgba(RISK_COLORS[d.risk] || RISK_COLORS.medium, 200),
          radius: 1500,
          diskResolution: 16,
          extruded: true,
          pickable: true,
          opacity: 0.85,
          elevationScale: 1,
        })
      )

      layers.push(
        new ScatterplotLayer({
          id: 'risk-zone-glow',
          data: riskZoneData,
          getPosition: (d: any) => [d._lng, d._lat],
          getRadius: (d: any) => (d.risk === 'critical' ? 3000 : d.risk === 'high' ? 2000 : 1500) * pulse,
          getFillColor: (d: any) => hexToRgba(RISK_COLORS[d.risk] || RISK_COLORS.medium, 60),
          pickable: false,
        })
      )

      layers.push(
        new TextLayer({
          id: 'risk-zone-labels',
          data: riskZoneData,
          getPosition: (d: any) => [d._lng, d._lat],
          getText: (d: any) => d.name.length > 25 ? d.name.substring(0, 22) + '—' : d.name,
          getSize: 11,
          getColor: [255, 255, 255, 200],
          getAngle: 0,
          getTextAnchor: 'middle' as const,
          getAlignmentBaseline: 'top' as const,
          getPixelOffset: [0, 18],
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 200],
          billboard: true,
          sizeScale: 1,
          sizeMinPixels: 8,
          sizeMaxPixels: 14,
        })
      )
    }

    // Real Monitoring Stations from API (replaces static GLOBAL_STATIONS)
    const stationLayerData = stationsData.map(s => ({
      ...s,
      _type: 'globalStation' as const,
      _lng: s.coords[1],
      _lat: s.coords[0],
    }))

    if (stationLayerData.length > 0) {
      layers.push(
        new ColumnLayer({
          id: 'station-columns',
          data: stationLayerData,
          getPosition: (d: any) => [d._lng, d._lat],
          getElevation: (d: any) => d.waterLevel ? d.waterLevel * 80 : 50,
          getFillColor: (d: any) => hexToRgba(STATION_COLORS[d.status] || STATION_COLORS.normal, 200),
          radius: 200,
          diskResolution: 20,
          extruded: true,
          pickable: true,
          opacity: 0.9,
        })
      )

      layers.push(
        new ScatterplotLayer({
          id: 'station-glow',
          data: stationLayerData,
          getPosition: (d: any) => [d._lng, d._lat],
          getRadius: 400 * pulse,
          getFillColor: (d: any) => hexToRgba(STATION_COLORS[d.status] || STATION_COLORS.normal, 50),
          pickable: false,
        })
      )
    }

    // AI Predictions as 3D columns
    const predLayerData = predictionsData.map(p => ({
      ...p,
      _type: 'prediction' as const,
      _lng: p.coords[1],
      _lat: p.coords[0],
    }))

    if (predLayerData.length > 0) {
      layers.push(
        new ColumnLayer({
          id: 'prediction-columns',
          data: predLayerData,
          getPosition: (d: any) => [d._lng, d._lat],
          getElevation: (d: any) => d.prob * 600 + 100,
          getFillColor: (d: any) => {
            const p = d.prob || 0
            return p >= 0.75 ? [220, 38, 38, 200] : p >= 0.5 ? [249, 115, 22, 200] : [234, 179, 8, 200]
          },
          radius: 400,
          diskResolution: 16,
          extruded: true,
          pickable: true,
          opacity: 0.85,
        })
      )

      layers.push(
        new ScatterplotLayer({
          id: 'prediction-glow',
          data: predLayerData,
          getPosition: (d: any) => [d._lng, d._lat],
          getRadius: 800 * pulse,
          getFillColor: (d: any) => {
            const p = d.prob || 0
            return p >= 0.75 ? [220, 38, 38, 60] : p >= 0.5 ? [249, 115, 22, 60] : [234, 179, 8, 60]
          },
          pickable: false,
        })
      )
    }

    setMarkerCount({
      reports: reportData.length,
      rivers: riverMarkers.length,
      distress: distressMarkers.length,
      riskZones: riskZoneData.length,
      stations: stationLayerData.length,
      predictions: predLayerData.length,
    })

    deckRef.current.setProps({ layers })
  }, [reports, riverData, distressData, evacuationData, riskLayerData, stationsData, predictionsData, showFloodPredictions, showEvacuationRoutes, showHeatmap, animationTime])

  // Controls
  const resetView = () => {
    mapRef.current?.flyTo({
      center: mapCenter,
      zoom,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      duration: 1500,
    })
  }

  const refreshAll = useCallback(() => {
    fetchRivers()
    fetchDistress()
    fetchEvacuation()
    fetchRiskLayer()
    fetchStations()
    fetchPredictions()
  }, [fetchRivers, fetchDistress, fetchEvacuation, fetchRiskLayer, fetchStations, fetchPredictions])

  return (
    <div className={`relative ${className}`} style={{ height }}>
      {/* MapLibre + Deck.gl container */}
      <div ref={containerRef} className="w-full h-full" style={{ background: '#0a0a1a' }} />

      {/* Controls — top-right (below the overlay panels area) */}
      <div className="absolute bottom-16 right-3 z-[1000] flex flex-col gap-1 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 p-1">
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          className={`p-1.5 rounded-md transition-all ${autoRotate ? 'bg-blue-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`}
          title={autoRotate ? 'Stop Rotation' : 'Auto Rotate'}
        >
          <Orbit className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShow3DBuildings(!show3DBuildings)}
          className={`p-1.5 rounded-md transition-all ${show3DBuildings ? 'bg-blue-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`}
          title={show3DBuildings ? 'Hide Buildings' : 'Show Buildings'}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShowHeatmap(!showHeatmap)}
          className={`p-1.5 rounded-md transition-all ${showHeatmap ? 'bg-orange-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`}
          title={showHeatmap ? 'Hide Heatmap' : 'Show Heatmap'}
        >
          <CircleDot className="w-3.5 h-3.5" />
        </button>
        <div className="h-px bg-gray-700/50" />
        <button onClick={resetView} className="p-1.5 text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition" title="Reset View">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button onClick={refreshAll} className="p-1.5 text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition" title="Refresh Data">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3D Mode badge — bottom-left */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 px-3 py-1.5 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-[10px] font-semibold text-purple-400">3D MODE</span>
        </div>
        <div className="h-3 w-px bg-gray-700" />
        <span className="text-[10px] text-gray-400 dark:text-gray-300">
          {markerCount.reports} reports — {markerCount.rivers + markerCount.stations} stations — {markerCount.riskZones} zones — {markerCount.predictions} predictions — {markerCount.distress} SOS
        </span>
      </div>
    </div>
  )
}

