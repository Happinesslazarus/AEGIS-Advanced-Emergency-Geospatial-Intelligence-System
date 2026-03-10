/**
 * DisasterMap.tsx — Production map with WMS layers, clustering,
 * tile switching, heatmap, shelters, and scale bar.
 *
 * All map features are configurable via props. The component fetches
 * region config from the API on mount and renders SEPA WMS flood
 * layers, marker clusters, gauge station pins, and shelter markers.
 */

import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, Circle,
  GeoJSON, useMap, WMSTileLayer, ScaleControl, LayersControl, Polyline,
} from 'react-leaflet'
import L from 'leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { io, Socket } from 'socket.io-client'
import { useLocation } from '../../contexts/LocationContext'
import { useFloodData } from '../../hooks/useFloodData'
import { createMarkerSvg, getSeverityClass } from '../../utils/helpers'
import type { Report, SeverityLevel } from '../../types'
import SpatialToolbar from './SpatialToolbar'
import IncidentMapLayers from './IncidentMapLayers'

// ═══════════════════════════════════════════════════════════════════════════════
// Types & Config
// ═══════════════════════════════════════════════════════════════════════════════

interface WMSLayer {
  name: string
  url: string
  layers: string
  format: string
  transparent: boolean
  attribution: string
}

interface Shelter {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  capacity: number
  current_occupancy: number
  shelter_type: string
  amenities: string[]
  phone: string | null
}

interface DeploymentZone {
  id: string
  zone: string
  priority: string
  deployed: boolean
  active_reports: number
  estimated_affected?: string
  ambulances?: number
  fire_engines?: number
  rescue_boats?: number
  ai_recommendation?: string
  lat?: number | null
  lng?: number | null
}

interface Props {
  reports?: Report[]
  deployments?: DeploymentZone[]
  showFloodZones?: boolean
  showReports?: boolean
  showFloodMonitoring?: boolean
  showShelters?: boolean
  showWMSLayers?: boolean
  showHeatmap?: boolean
  showDistress?: boolean
  showEvacuation?: boolean
  showPredictions?: boolean
  showRiskLayer?: boolean
  showSpatialTools?: boolean
  onReportClick?: (r: Report) => void
  height?: string
  className?: string
  center?: [number, number]
  zoom?: number
}

// Tile layer presets for the tile switcher
const TILE_LAYERS = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  topo: {
    name: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap',
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

function MapUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => { map.setView(center, zoom) }, [center, zoom, map])
  return null
}

/**
 * Heatmap layer using leaflet.heat. We use a useEffect approach
 * because leaflet.heat is an imperative plugin without a React wrapper.
 */
function HeatmapLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) return

    // Dynamically import leaflet.heat
    let layer: any = null
    try {
      // leaflet.heat extends L with L.heatLayer
      const heat = (L as any).heatLayer
      if (heat) {
        layer = heat(points, {
          radius: 25,
          blur: 15,
          maxZoom: 17,
          gradient: { 0.2: '#2563eb', 0.4: '#10b981', 0.6: '#eab308', 0.8: '#f97316', 1.0: '#dc2626' },
        }).addTo(map)
      }
    } catch {
      // leaflet.heat not available — silently skip
    }

    return () => { if (layer) map.removeLayer(layer) }
  }, [map, points])

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function icon(color: string, size = 28): L.DivIcon {
  return L.divIcon({
    html: createMarkerSvg(color, size),
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

const shelterIcon = L.divIcon({
  html: '<div style="background:#10b981;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z"/></svg></div>',
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
})

const SC: Record<SeverityLevel, string> = { High: '#dc2626', Medium: '#d97706', Low: '#2563eb' }
const ZS: Record<string, L.CircleMarkerOptions> = {
  high: { color: '#dc2626', fillColor: '#fca5a5', fillOpacity: 0.25 },
  medium: { color: '#d97706', fillColor: '#fde68a', fillOpacity: 0.2 },
  low: { color: '#2563eb', fillColor: '#93c5fd', fillOpacity: 0.15 },
}

const floodAreaStyle = (feature: any): L.PathOptions => {
  const severity = feature?.properties?.severity || 'watch'
  return {
    color: severity === 'warning' ? '#dc2626' : '#f59e0b',
    weight: 2,
    fillColor: severity === 'warning' ? '#fca5a5' : '#fde68a',
    fillOpacity: 0.3,
  }
}

const stationPointToLayer = (feature: any, latlng: L.LatLng): L.CircleMarker => {
  const status = feature?.properties?.level_status || 'normal'
  const colorMap: Record<string, string> = {
    critical: '#dc2626',
    high: '#f59e0b',
    elevated: '#eab308',
    normal: '#10b981',
  }
  return L.circleMarker(latlng, {
    radius: 6,
    fillColor: colorMap[status] || '#10b981',
    color: '#fff',
    weight: 2,
    fillOpacity: 0.8,
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function DisasterMap({
  reports = [],
  deployments = [],
  showFloodZones = true,
  showReports = true,
  showFloodMonitoring = false,
  showShelters = false,
  showWMSLayers = false,
  showHeatmap = false,
  showDistress = true,
  showEvacuation = false,
  showPredictions = true,
  showRiskLayer = true,
  showSpatialTools = true,
  onReportClick,
  height = '400px',
  className = '',
  center: centerProp,
  zoom: zoomProp,
}: Props): JSX.Element {
  const { location } = useLocation()
  const mapCenter = centerProp || location.center
  const mapZoom = zoomProp || location.zoom
  const floodData = useFloodData()
  const [wmsLayers, setWmsLayers] = useState<WMSLayer[]>([])
  const [shelters, setShelters] = useState<Shelter[]>([])
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)
  const [activeWMS, setActiveWMS] = useState<Set<string>>(new Set())
  const [legendOpen, setLegendOpen] = useState(false)

  // Real API data state
  const [distressBeacons, setDistressBeacons] = useState<any[]>([])
  const [evacuationRoutes, setEvacuationRoutes] = useState<any[]>([])
  const [predictions, setPredictions] = useState<any[]>([])
  const [riskLayerData, setRiskLayerData] = useState<any>(null)
  const [realHeatmapData, setRealHeatmapData] = useState<[number, number, number][]>([])

  const [mapReady, setMapReady] = useState(false)
  const distressSocketRef = useRef<Socket | null>(null)

  // Interactive layer toggle state (user can enable/disable layers on the map)
  const [layerToggles, setLayerToggles] = useState({
    floodZones: showFloodZones,
    shelters: showShelters,
    predictions: showPredictions,
    distress: showDistress,
    evacuation: showEvacuation,
    heatmap: showHeatmap,
    riskLayer: showRiskLayer,
    floodMonitoring: showFloodMonitoring,
  })
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false)

  const toggleLayer = useCallback((key: keyof typeof layerToggles) => {
    setLayerToggles(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Socket.io — listen for distress:new / distress:updated in real-time
  useEffect(() => {
    if (!showDistress) return
    const token = localStorage.getItem('aegis-token')
    if (!token) return

    const socket = io('http://localhost:3001', {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    })
    distressSocketRef.current = socket

    socket.on('distress:new', (beacon: any) => {
      if (!beacon) return
      setDistressBeacons(prev => {
        const exists = prev.some(b => b.id === beacon.id)
        if (exists) return prev
        return [beacon, ...prev]
      })
    })

    socket.on('distress:updated', (beacon: any) => {
      if (!beacon) return
      setDistressBeacons(prev => prev.map(b => b.id === beacon.id ? { ...b, ...beacon } : b))
    })

    return () => {
      socket.disconnect()
      distressSocketRef.current = null
    }
  }, [showDistress])

  // Export visible report markers as GeoJSON FeatureCollection
  const exportGeoJSON = useCallback(() => {
    const features = reports
      .filter(r => r.coordinates?.length === 2)
      .map(r => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [r.coordinates![1], r.coordinates![0]],
        },
        properties: {
          id: r.id,
          reportNumber: r.reportNumber || '',
          type: r.type || r.incidentCategory || '',
          severity: r.severity,
          status: r.status,
          location: r.location || '',
          confidence: r.confidence || 0,
          timestamp: r.timestamp,
        },
      }))
    const geojson = { type: 'FeatureCollection', features }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aegis-reports-${new Date().toISOString().slice(0, 10)}.geojson`
    a.click()
    URL.revokeObjectURL(url)
  }, [reports])

  // Fetch region config for WMS layers
  useEffect(() => {
    if (!showWMSLayers) return
    fetch('/api/config/region')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.wmsLayers) {
          setWmsLayers(data.wmsLayers)
          // Enable all WMS layers by default
          setActiveWMS(new Set(data.wmsLayers.map((_: WMSLayer, i: number) => String(i))))
        }
      })
      .catch(() => {})
  }, [showWMSLayers])

  // Fetch shelters with 5-minute refresh interval
  useEffect(() => {
    if (!showShelters) return
    const [lat, lng] = mapCenter
    const load = () => fetch(`/api/config/shelters?lat=${lat}&lng=${lng}&radius=100`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.shelters) setShelters(data.shelters) })
      .catch(() => {})
    load()
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [showShelters, mapCenter])

  // Inject pulse keyframes for distress markers
  useEffect(() => {
    if (!document.getElementById('disastermap-pulse-css')) {
      const style = document.createElement('style')
      style.id = 'disastermap-pulse-css'
      style.textContent = '@keyframes dm-pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}'
      document.head.appendChild(style)
    }
  }, [])

  // Fetch distress beacons (real-time SOS signals)
  useEffect(() => {
    if (!showDistress) return
    const load = () => {
      const token = localStorage.getItem('aegis-token')
      return fetch('/api/distress/active', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setDistressBeacons(data.beacons || data.distressCalls || data.active || []) })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [showDistress])

  // Fetch evacuation routes
  useEffect(() => {
    if (!showEvacuation) return
    fetch('/api/incidents/flood/evacuation/routes')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.routes) setEvacuationRoutes(data.routes) })
      .catch(() => {})
  }, [showEvacuation])

  // Fetch AI flood predictions
  useEffect(() => {
    if (!showPredictions) return
    fetch('/api/predictions')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data)) setPredictions(data) })
      .catch(() => {})
  }, [showPredictions])

  // Fetch PostGIS risk layer (flood polygons)
  useEffect(() => {
    if (!showRiskLayer) return
    fetch('/api/map/risk-layer')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRiskLayerData(data) })
      .catch(() => {})
  }, [showRiskLayer])

  // Fetch real heatmap data from API
  useEffect(() => {
    if (!showHeatmap) return
    fetch('/api/map/heatmap-data')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.points) {
          setRealHeatmapData(data.points.map((p: any) => [p.lat, p.lng, p.intensity || 0.5] as [number, number, number]))
        }
      })
      .catch(() => {})
  }, [showHeatmap])

  // Toggle WMS layer visibility
  const toggleWMS = useCallback((idx: string) => {
    setActiveWMS((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  // Report markers with clustering
  const markers = useMemo(() => {
    if (!showReports) return null
    return reports.filter((r) => r.coordinates?.length === 2).map((r) => (
      <Marker
        key={r.id}
        position={r.coordinates}
        icon={icon(SC[r.severity] || '#6b7280')}
        eventHandlers={{ click: () => onReportClick?.(r) }}
      >
        <Popup>
          <div className="min-w-[200px]">
            <div className="flex items-center gap-2 mb-1">
              <span className={`badge ${getSeverityClass(r.severity)}`}>{r.severity}</span>
              <span className="text-xs font-mono text-gray-500">{r.id.slice(0, 8)}</span>
            </div>
            <p className="font-semibold text-sm text-gray-900 mb-1">{r.type}</p>
            <p className="text-xs text-gray-600 mb-1 line-clamp-2">{r.description}</p>
            <p className="text-xs text-gray-400">{r.location}</p>
          </div>
        </Popup>
      </Marker>
    ))
  }, [reports, showReports, onReportClick])

  // Flood zones
  const zones = useMemo(() => {
    if (!showFloodZones || !layerToggles.floodZones) return null
    return location.floodZones.map((z, i) => (
      <Circle key={i} center={z.coords} radius={500} pathOptions={ZS[z.risk] || ZS.low}>
        <Popup>
          <p className="font-semibold text-sm">{z.name}</p>
          <p className="text-xs">Risk: {z.risk.toUpperCase()}</p>
        </Popup>
      </Circle>
    ))
  }, [location.floodZones, showFloodZones, layerToggles.floodZones])

  // Flood monitoring GeoJSON layers
  const floodAreas = useMemo(() => {
    if (!showFloodMonitoring || !layerToggles.floodMonitoring || !floodData.data?.areas?.features?.length) return null
    return (
      <GeoJSON
        key={`areas-${floodData.currentRegion}`}
        data={floodData.data.areas as any}
        style={floodAreaStyle}
        onEachFeature={(feature: any, layer: any) => {
          const props = feature.properties || {}
          const name = props.ta_name || props.fws_taname || 'Flood Area'
          const severity = props.severity || 'watch'
          layer.bindPopup(`<strong>${name}</strong><br/><span style="font-size:11px">Severity: ${severity.toUpperCase()}</span>`)
        }}
      />
    )
  }, [showFloodMonitoring, layerToggles.floodMonitoring, floodData.data, floodData.currentRegion])

  const stations = useMemo(() => {
    if (!showFloodMonitoring || !layerToggles.floodMonitoring || !floodData.data?.stations?.features?.length) return null
    return (
      <GeoJSON
        key={`stations-${floodData.currentRegion}`}
        data={floodData.data.stations as any}
        pointToLayer={stationPointToLayer}
        onEachFeature={(feature: any, layer: any) => {
          const props = feature.properties || {}
          const name = props.station_name || 'Unknown Station'
          const level = props.level_m ? `${props.level_m.toFixed(2)}m` : 'N/A'
          const status = props.level_status || 'normal'
          layer.bindPopup(
            `<strong>${name}</strong><br/>` +
            `<span style="font-size:11px">Level: ${level}</span><br/>` +
            `<span style="font-size:11px">Status: ${status.toUpperCase()}</span>`,
          )
        }}
      />
    )
  }, [showFloodMonitoring, layerToggles.floodMonitoring, floodData.data, floodData.currentRegion])

  // Shelter markers
  const shelterMarkers = useMemo(() => {
    if (!showShelters || !layerToggles.shelters || !shelters.length) return null
    return shelters.map((s) => (
      <Marker key={s.id} position={[s.lat, s.lng]} icon={shelterIcon}>
        <Popup>
          <div className="min-w-[200px]">
            <p className="font-semibold text-sm">{s.name}</p>
            <p className="text-xs text-gray-600 mb-1">{s.address}</p>
            <p className="text-xs">
              Capacity: {s.current_occupancy}/{s.capacity} |
              Type: {s.shelter_type}
            </p>
            {s.amenities.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Amenities: {s.amenities.join(', ')}
              </p>
            )}
            {s.phone && (
              <p className="text-xs mt-1">
                <a href={`tel:${s.phone}`} className="text-blue-600">{s.phone}</a>
              </p>
            )}
          </div>
        </Popup>
      </Marker>
    ))
  }, [shelters, showShelters, layerToggles.shelters])

  // Heatmap points from reports + real API data
  const heatPoints = useMemo<[number, number, number][]>(() => {
    if (!showHeatmap || !layerToggles.heatmap) return []
    const points: [number, number, number][] = []
    for (const r of reports) {
      if (r.coordinates?.length === 2) {
        points.push([r.coordinates[0], r.coordinates[1], r.severity === 'High' ? 1.0 : r.severity === 'Medium' ? 0.6 : 0.3])
      }
    }
    points.push(...realHeatmapData)
    return points
  }, [reports, showHeatmap, layerToggles.heatmap, realHeatmapData])

  // Distress beacon markers
  const distressMarkerElements = useMemo(() => {
    if (!showDistress || !layerToggles.distress || !distressBeacons.length) return null
    return distressBeacons.map((b, i) => {
      const lat = b.latitude || b.location?.lat
      const lng = b.longitude || b.location?.lng
      if (!lat || !lng) return null
      const dIcon = L.divIcon({
        html: `<div style="position:relative;width:36px;height:36px;">
          <div style="position:absolute;inset:0;border-radius:50%;background:#ef444444;animation:dm-pulse 1s ease-out infinite;"></div>
          <div style="position:absolute;inset:6px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 0 12px #ef4444aa;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:11px;">SOS</div>
        </div>`,
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
      })
      return (
        <Marker key={`distress-${b.id || i}`} position={[lat, lng]} icon={dIcon}>
          <Popup>
            <div className="min-w-[180px]">
              <p className="font-bold text-red-600 text-sm mb-1">⚠ DISTRESS BEACON</p>
              <p className="text-xs font-semibold">{b.citizenName || b.citizen_name || 'Citizen'}</p>
              <p className="text-xs text-gray-600">{b.message || 'Emergency assistance requested'}</p>
              {b.isVulnerable && <p className="text-xs text-orange-600 mt-1">⚠ Vulnerable person</p>}
            </div>
          </Popup>
        </Marker>
      )
    }).filter(Boolean)
  }, [showDistress, layerToggles.distress, distressBeacons])

  // Evacuation route polylines
  const evacuationLines = useMemo(() => {
    if (!showEvacuation || !layerToggles.evacuation || !evacuationRoutes.length) return null
    return evacuationRoutes.map((route, i) => {
      if (!route.coordinates?.length) return null
      const latlngs: [number, number][] = route.coordinates.map((c: any) =>
        Array.isArray(c) ? [c[1], c[0]] as [number, number] : [c.lat, c.lng] as [number, number]
      )
      return (
        <Polyline key={`evac-${i}`} positions={latlngs} pathOptions={{ color: '#22c55e', weight: 4, opacity: 0.8, dashArray: '10 6' }}>
          <Popup>
            <p className="font-semibold text-sm">{route.name || 'Evacuation Route'}</p>
            <p className="text-xs text-gray-600">{route.description || ''}</p>
          </Popup>
        </Polyline>
      )
    }).filter(Boolean)
  }, [showEvacuation, layerToggles.evacuation, evacuationRoutes])

  // AI Flood prediction risk circles — dynamic coords from location context + prediction data
  const predictionCircles = useMemo(() => {
    if (!showPredictions || !layerToggles.predictions || !predictions.length) return null
    // Build coordinate lookup from location floodZones + prediction lat/lng
    const zoneCoords: Record<string, [number, number]> = {}
    for (const z of location.floodZones || []) {
      zoneCoords[z.name] = z.coords
    }
    return predictions.map((p, i) => {
      // Use prediction's own coordinates first, then zone lookup, then skip
      const lat = p.latitude || p.lat
      const lng = p.longitude || p.lng
      const coords: [number, number] | undefined = (lat && lng) ? [lat, lng] : zoneCoords[p.area]
      if (!coords) return null
      const prob = parseFloat(p.probability) || 0
      const colour = prob >= 0.75 ? '#dc2626' : prob >= 0.5 ? '#f97316' : '#eab308'
      return (
        <Circle key={`pred-${i}`} center={coords} radius={800 + prob * 1200}
          pathOptions={{ color: colour, weight: 1.5, fillColor: colour, fillOpacity: 0.15 }}>
          <Popup>
            <div className="min-w-[200px]">
              <p className="font-bold text-sm">{p.area}</p>
              <p className="text-xs">Flood probability: <span className="font-bold" style={{ color: colour }}>{Math.round(prob * 100)}%</span></p>
              <p className="text-xs text-gray-500">Severity: {p.severity} · Confidence: {p.confidence}%</p>
              {p.time_to_flood && <p className="text-xs text-gray-500">Time to flood: {p.time_to_flood}</p>}
              <p className="text-xs text-gray-400 mt-1">{p.model_version}</p>
            </div>
          </Popup>
        </Circle>
      )
    }).filter(Boolean)
  }, [showPredictions, layerToggles.predictions, predictions])

  // Deployment zone markers — resolve coords from DB, floodZones lookup, or offset from center
  const deploymentMarkers = useMemo(() => {
    if (!deployments || !deployments.length) return null
    // Build coordinate lookup from location floodZones
    const zoneCoords: Record<string, [number, number]> = {}
    for (const z of location.floodZones || []) {
      zoneCoords[z.name.toLowerCase()] = z.coords
    }
    const priorityColors: Record<string, { stroke: string; fill: string }> = {
      critical: { stroke: '#dc2626', fill: '#fca5a5' },
      high: { stroke: '#f59e0b', fill: '#fde68a' },
      medium: { stroke: '#3b82f6', fill: '#93c5fd' },
      low: { stroke: '#6b7280', fill: '#d1d5db' },
    }
    return deployments.map((d, i) => {
      // Try DB coordinates first, then fuzzy match zone name against floodZones, then offset from map center
      let coords: [number, number] | null = null
      if (d.lat && d.lng) {
        coords = [d.lat, d.lng]
      } else {
        // Fuzzy match: check if zone name contains or is contained by any floodZone name
        const zoneLower = d.zone.toLowerCase()
        for (const [name, c] of Object.entries(zoneCoords)) {
          if (zoneLower.includes(name) || name.includes(zoneLower) ||
              zoneLower.replace(/zone\s*[a-z]\s*[—–-]\s*/i, '').trim() === name) {
            coords = c
            break
          }
        }
        // Last resort: offset from map center based on index
        if (!coords) {
          const angle = (i / Math.max(deployments.length, 1)) * 2 * Math.PI
          const offset = 0.015 * (i + 1)
          coords = [mapCenter[0] + Math.cos(angle) * offset, mapCenter[1] + Math.sin(angle) * offset]
        }
      }
      const pc = priorityColors[d.priority?.toLowerCase()] || priorityColors.medium
      const deployedRing = d.deployed
      return (
        <Circle key={`deploy-${d.id || i}`} center={coords} radius={deployedRing ? 1000 : 700}
          pathOptions={{
            color: deployedRing ? '#16a34a' : pc.stroke,
            weight: deployedRing ? 3 : 2,
            fillColor: pc.fill,
            fillOpacity: deployedRing ? 0.25 : 0.15,
            dashArray: deployedRing ? undefined : '6 4',
          }}>
          <Popup>
            <div className="min-w-[220px]">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                  backgroundColor: d.deployed ? '#16a34a' : pc.stroke,
                }} />
                <strong style={{ fontSize: 13 }}>{d.zone}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 4 }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 8, fontWeight: 700, fontSize: 10, color: '#fff',
                  backgroundColor: pc.stroke,
                }}>{d.priority}</span>
                {d.deployed && <span style={{
                  padding: '1px 6px', borderRadius: 8, fontWeight: 700, fontSize: 10,
                  color: '#fff', backgroundColor: '#16a34a',
                }}>DEPLOYED</span>}
              </div>
              <p style={{ fontSize: 11, margin: '2px 0' }}>Active Reports: <strong>{d.active_reports}</strong></p>
              {d.estimated_affected && <p style={{ fontSize: 11, margin: '2px 0', color: '#dc2626' }}>Affected: {d.estimated_affected}</p>}
              <div style={{ display: 'flex', gap: 8, fontSize: 11, marginTop: 4 }}>
                {(d.ambulances ?? 0) > 0 && <span>🚑 {d.ambulances}</span>}
                {(d.fire_engines ?? 0) > 0 && <span>🚒 {d.fire_engines}</span>}
                {(d.rescue_boats ?? 0) > 0 && <span>🚤 {d.rescue_boats}</span>}
              </div>
              {d.ai_recommendation && <p style={{ fontSize: 10, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>AI: {d.ai_recommendation}</p>}
            </div>
          </Popup>
        </Circle>
      )
    })
  }, [deployments, location.floodZones, mapCenter])

  // PostGIS risk layer GeoJSON polygons
  const riskPolygons = useMemo(() => {
    if (!showRiskLayer || !layerToggles.riskLayer || !riskLayerData?.features?.length) return null
    const riskStyle = (feature: any): L.PathOptions => {
      const risk = feature?.properties?.risk_level || feature?.properties?.severity || 'medium'
      const cm: Record<string, { color: string; fill: string }> = {
        critical: { color: '#dc2626', fill: '#fca5a5' }, high: { color: '#f97316', fill: '#fed7aa' },
        medium: { color: '#eab308', fill: '#fef08a' }, low: { color: '#3b82f6', fill: '#93c5fd' },
      }
      const c = cm[risk] || cm.medium
      return { color: c.color, weight: 2, fillColor: c.fill, fillOpacity: 0.3 }
    }
    return (
      <GeoJSON
        key={`risk-${riskLayerData.features.length}`}
        data={riskLayerData}
        style={riskStyle}
        onEachFeature={(feature: any, layer: any) => {
          const p = feature.properties || {}
          const name = p.name || p.area_name || 'Risk Zone'
          const risk = p.risk_level || p.severity || 'medium'
          layer.bindPopup(`<strong>${name}</strong><br/><span style="font-size:11px;">Risk: ${risk.toUpperCase()}</span>${p.description ? `<br/><span style="font-size:10px;">${p.description}</span>` : ''}`)
        }}
      />
    )
  }, [showRiskLayer, layerToggles.riskLayer, riskLayerData])

  return (
    <div className={`map-wrapper relative rounded-xl overflow-hidden ${className}`} style={{ height }}>
      {/* Loading overlay while map initializes */}
      {!mapReady && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 rounded-xl gap-3">
          <div className="w-10 h-10 rounded-xl bg-aegis-600 flex items-center justify-center animate-pulse">
            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg>
          </div>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Initialising map…</p>
        </div>
      )}
      <MapContainer center={mapCenter} zoom={mapZoom} className="h-full w-full" scrollWheelZoom
        whenReady={() => setMapReady(true)}>
        <MapUpdater center={mapCenter} zoom={mapZoom} />
        <ScaleControl position="bottomright" imperial={false} />

        {/* Tile layer switcher via Leaflet LayersControl */}
        <LayersControl position="topright">
          {Object.entries(TILE_LAYERS).map(([key, layer], idx) => (
            <LayersControl.BaseLayer key={key} checked={idx === 0} name={layer.name}>
              <TileLayer attribution={layer.attribution} url={layer.url} />
            </LayersControl.BaseLayer>
          ))}
        </LayersControl>

        {/* SEPA WMS flood layers */}
        {showWMSLayers && wmsLayers.map((wms, idx) =>
          activeWMS.has(String(idx)) ? (
            <WMSTileLayer
              key={`wms-${idx}`}
              url={wms.url}
              layers={wms.layers}
              format={wms.format}
              transparent={wms.transparent}
              attribution={wms.attribution}
              opacity={0.6}
            />
          ) : null,
        )}

        {/* Flood zones, areas, stations */}
        {zones}
        {floodAreas}
        {stations}

        {/* PostGIS risk layer polygons */}
        {riskPolygons}

        {/* AI prediction risk circles */}
        {predictionCircles}

        {/* Deployment zone markers */}
        {deploymentMarkers}

        {/* Distress beacons */}
        {distressMarkerElements}

        {/* Evacuation routes */}
        {evacuationLines}

        {/* Report markers with clustering */}
        {markers && markers.length > 0 ? (
          <MarkerClusterGroup chunkedLoading maxClusterRadius={60}>
            {markers}
          </MarkerClusterGroup>
        ) : null}

        {/* Shelter markers */}
        {shelterMarkers}

        {/* Heatmap overlay */}
        {showHeatmap && layerToggles.heatmap && heatPoints.length > 0 && (
          <HeatmapLayer points={heatPoints} />
        )}

        {/* Spatial analysis tools */}
        {showSpatialTools && <SpatialToolbar reports={reports} />}

        {/* Incident type layers */}
        <IncidentMapLayers />
      </MapContainer>

      {/* Export GeoJSON button — top-left */}
      {showReports && reports.some(r => r.coordinates?.length === 2) && (
        <div className="absolute top-3 left-3 z-[800]">
          <button
            onClick={exportGeoJSON}
            className="bg-white dark:bg-gray-800 shadow-lg rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 min-h-[36px]"
            title="Export report markers as GeoJSON"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1zm0 1.5L3.5 5.25v5.5L8 13.5l4.5-2.75v-5.5L8 2.5z"/></svg>
            Export GeoJSON
          </button>
        </div>
      )}

      {/* WMS Layer toggle panel — top-left below export button */}
      {showWMSLayers && (
        <div className="absolute top-14 left-3 z-[800]">
          <button
            onClick={() => setLayerPanelOpen(!layerPanelOpen)}
            className="bg-white dark:bg-gray-800 shadow-lg rounded-lg px-3 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors min-h-[36px]"
          >
            Flood Layers {layerPanelOpen ? '▲' : '▼'}
          </button>
          {layerPanelOpen && (
            <div className="mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg p-3 w-56 border border-gray-200 dark:border-gray-700">
              {wmsLayers.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center italic">
                  No WMS layers configured for this region
                </p>
              ) : wmsLayers.map((wms, idx) => (
                <label key={idx} className="flex items-center gap-2 text-xs py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 -mx-1 transition-colors">
                  <input
                    type="checkbox"
                    checked={activeWMS.has(String(idx))}
                    onChange={() => toggleWMS(String(idx))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{wms.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Interactive Overlay Layer Controls — positioned below Leaflet LayersControl */}
      <div className="absolute top-14 right-3 z-[800]">
        <button
          onClick={() => setOverlayPanelOpen(!overlayPanelOpen)}
          className="bg-white dark:bg-gray-800 shadow-lg rounded-lg px-3 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 min-h-[36px]"
        >
          <span className="w-3.5 h-3.5 inline-block">
            <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1zm0 1.5L3.5 5.25v5.5L8 13.5l4.5-2.75v-5.5L8 2.5z"/></svg>
          </span>
          Layers {overlayPanelOpen ? '▲' : '▼'}
        </button>
        {overlayPanelOpen && (
          <div className="mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg p-3 w-56 max-h-[50vh] overflow-y-auto border border-gray-200 dark:border-gray-700">
            <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">Toggle Map Overlays</p>
            {([
              { key: 'floodZones' as const, label: 'Flood Zones', color: 'bg-red-300', enabled: showFloodZones },
              { key: 'floodMonitoring' as const, label: 'Flood Monitoring', color: 'bg-amber-500', enabled: showFloodMonitoring },
              { key: 'predictions' as const, label: 'AI Predictions', color: 'bg-yellow-500', enabled: showPredictions },
              { key: 'riskLayer' as const, label: 'Risk Zones', color: 'bg-orange-400', enabled: showRiskLayer },
              { key: 'shelters' as const, label: 'Shelters', color: 'bg-green-500', enabled: showShelters },
              { key: 'evacuation' as const, label: 'Evacuation Routes', color: 'bg-green-400', enabled: showEvacuation },
              { key: 'distress' as const, label: 'SOS Beacons', color: 'bg-red-600', enabled: showDistress },
              { key: 'heatmap' as const, label: 'Density Heatmap', color: 'bg-gradient-to-r from-blue-400 to-red-400', enabled: showHeatmap },
            ]).filter(l => l.enabled).map(layer => (
              <label key={layer.key} className="flex items-center gap-2 text-xs py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-2 -mx-1 transition-colors">
                <input
                  type="checkbox"
                  checked={layerToggles[layer.key]}
                  onChange={() => toggleLayer(layer.key)}
                  className="rounded border-gray-300 text-blue-500 w-4 h-4"
                />
                <span className={`w-3 h-3 rounded-full ${layer.color} flex-shrink-0`} />
                <span className="text-gray-700 dark:text-gray-300">{layer.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible Legend — bottom-left, compact */}
      <div className="absolute bottom-3 left-3 z-[800]">
        <button
          onClick={() => setLegendOpen(!legendOpen)}
          className="bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-lg rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 min-h-[36px]"
        >
          <span className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500"/>
            <span className="w-2 h-2 rounded-full bg-amber-500"/>
            <span className="w-2 h-2 rounded-full bg-blue-500"/>
          </span>
          Legend {legendOpen ? '▲' : '▼'}
        </button>
        {legendOpen && (
          <div className="mt-1 bg-white/95 dark:bg-gray-900/95 backdrop-blur rounded-lg p-3 shadow-xl text-xs max-h-[40vh] overflow-y-auto w-48 border border-gray-200 dark:border-gray-700">
            <div className="space-y-1.5">
              {([['bg-red-500', 'High'], ['bg-amber-500', 'Medium'], ['bg-blue-500', 'Low']] as const).map(([c, l]) => (
                <div key={l} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${c} flex-shrink-0`} />
                  <span className="text-gray-600 dark:text-gray-400">{l}</span>
                </div>
              ))}
              {showFloodZones && layerToggles.floodZones && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-300/50 border border-red-400 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Flood zone</span>
                </div>
              )}
              {showShelters && layerToggles.shelters && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Shelter</span>
                </div>
              )}
              {showFloodMonitoring && layerToggles.floodMonitoring && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                    <span className="text-gray-600 dark:text-gray-400">Warning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                    <span className="text-gray-600 dark:text-gray-400">Watch</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                    <span className="text-gray-600 dark:text-gray-400">Station</span>
                  </div>
                </>
              )}
              {showHeatmap && layerToggles.heatmap && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-red-500 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Density</span>
                </div>
              )}
              {showDistress && layerToggles.distress && distressBeacons.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">SOS ({distressBeacons.length})</span>
                </div>
              )}
              {showPredictions && layerToggles.predictions && predictions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60 border border-yellow-500 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">AI Prediction ({predictions.length})</span>
                </div>
              )}
              {showRiskLayer && layerToggles.riskLayer && riskLayerData?.features?.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded bg-orange-200 border border-orange-400 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Risk Zone ({riskLayerData.features.length})</span>
                </div>
              )}
              {showEvacuation && layerToggles.evacuation && evacuationRoutes.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded bg-green-500 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">Evacuation</span>
                </div>
              )}
              {deployments.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full border-2 border-green-500 bg-green-100 flex-shrink-0" />
                    <span className="text-gray-600 dark:text-gray-400">Deployed ({deployments.filter(d => d.deployed).length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full border-2 border-red-500 bg-red-100 flex-shrink-0" style={{ borderStyle: 'dashed' }} />
                    <span className="text-gray-600 dark:text-gray-400">Awaiting ({deployments.filter(d => !d.deployed).length})</span>
                  </div>
                </>
              )}
            </div>
            {showFloodMonitoring && floodData.loading && (
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Loading flood data...</p>
              </div>
            )}
            {showFloodMonitoring && floodData.error && (
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-red-500">Data unavailable</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
