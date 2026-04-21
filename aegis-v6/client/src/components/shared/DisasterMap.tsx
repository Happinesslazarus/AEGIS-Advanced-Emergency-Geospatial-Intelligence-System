/**
 * Primary Leaflet map used on the citizen and admin dashboards.
 * Renders incident markers, flood-depth polygons, weather radar
 * tiles, and river sensor pins. Supports click-to-inspect popups
 * and real-time marker updates via SocketContext.
 */

import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, Circle,
  GeoJSON, useMap, WMSTileLayer, ScaleControl, LayersControl, Polyline,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { useLocation } from '../../contexts/LocationContext'
import { useFloodData } from '../../hooks/useFloodData'
import { useSharedSocket } from '../../contexts/SocketContext'
import { useEventCallbacks } from '../../hooks/useEventStream'
import { createMarkerSvg, getSeverityClass } from '../../utils/helpers'
import type { Report, SeverityLevel } from '../../types'
import SpatialToolbar from './SpatialToolbar'
import IncidentMapLayers from './IncidentMapLayers'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { getAnyToken } from '../../utils/api'
import { useApiResource } from '../../hooks/useAsync'
import { TILE_LAYERS } from '../../utils/mapTileProviders'

//Types & Config

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

interface IncidentCluster {
  cluster_id: string
  incident_type: string
  reports: number
  confidence: number
  center: { lat: number; lng: number }
  radius_m: number
  time_window_minutes: number
}

interface CascadingInsight {
  chain: string[]
  confidence: number
  recommended_actions: string[]
}

interface IncidentObject {
  incident_id: string
  incident_type: string
  center: { lat: number; lng: number }
  radius_m: number
  confidence: number
  lifecycle_state: 'weak' | 'possible' | 'probable' | 'high' | 'confirmed'
  evidence_count: number
  time_window_minutes: number
}

interface EvacuationRouteExplanation {
  topHazards?: Array<{ severity: string; confidence: number; distanceM: number; reason?: string }>
  blockedSegments?: Array<{ hazardSeverity: string; hazardDistanceM: number }>
  scoreBreakdown?: {
    timeScore: number
    riskPenalty: number
    profile: 'fastest' | 'safest' | 'balanced'
    timeWeight: number
    riskWeight: number
  }
}

interface EvacuationRouteMapItem {
  id?: string
  name?: string
  description?: string
  coordinates?: any[]
  geometry?: { type: string; coordinates: any[] }
  recommendationScore?: number
  riskScore?: number
  etaConfidence?: number
  closureProximityM?: number
  isBlocked?: boolean
  explanation?: EvacuationRouteExplanation
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

//Tile layer presets -- imported from shared mapTileProviders.ts

//Sub-components

function MapUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  const prevCenterRef = useRef<[number, number]>(center)
  useEffect(() => {
    //Use primitive comparisons to avoid triggering flyTo when parent re-renders
    //pass a new array reference with the same values
    if (center[0] !== prevCenterRef.current[0] || center[1] !== prevCenterRef.current[1]) {
      prevCenterRef.current = center
      map.flyTo(center, zoom, { duration: 1.5 })
    }
  //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], zoom, map])
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

    //Dynamically import leaflet.heat
    let layer: any = null
    try {
      //leaflet.heat extends L with L.heatLayer
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
      //leaflet.heat not available ? silently skip
    }

    return () => { if (layer) map.removeLayer(layer) }
  }, [map, points])

  return null
}

//Helpers

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

//Main Component

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
  const lang = useLanguage()

  const { location } = useLocation()
  const mapCenter = centerProp || location.center
  const mapZoom = zoomProp || location.zoom
  const floodData = useFloodData()
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)
  const [activeWMS, setActiveWMS] = useState<Set<string>>(new Set())
  const [legendOpen, setLegendOpen] = useState(false)
  //Distress beacons: polled from API + patched in real-time by socket events
  const [distressBeacons, setDistressBeacons] = useState<any[]>([])
  const sharedSocket = useSharedSocket()

  const [mapReady, setMapReady] = useState(false)

  const getAuthContext = useCallback((): { token: string | null; role: string | null } => {
    const token = getAnyToken()
    const rawUser = localStorage.getItem('aegis-user') || localStorage.getItem('aegis-citizen-user')
    let role: string | null = null
    try {
      role = rawUser ? String(JSON.parse(rawUser)?.role || '').toLowerCase() : null
    } catch {
      role = null
    }
    return { token, role }
  }, [])

  const canReadDistress = useMemo(() => {
    const { role } = getAuthContext()
    return ['admin', 'operator', 'manager'].includes(String(role || ''))
  }, [getAuthContext])

  //API resource hooks — replaces manual fetch+useState+useEffect boilerplate
  const { data: regionConfig } = useApiResource<{ wmsLayers: WMSLayer[] }>(
    showWMSLayers ? '/api/config/region' : null, { auth: false })
  const wmsLayers = regionConfig?.wmsLayers ?? []

  const { data: sheltersResp } = useApiResource<{ shelters: Shelter[] }>(
    showShelters ? `/api/config/shelters?lat=${mapCenter[0]}&lng=${mapCenter[1]}&radius=100` : null,
    { auth: false, pollMs: 5 * 60 * 1000 })
  const shelters = sheltersResp?.shelters ?? []

  const { data: distressApiResp } = useApiResource<any>(
    showDistress && canReadDistress ? '/api/distress/active' : null, { pollMs: 30000 })

  const { data: evacuationResp } = useApiResource<{ routes: EvacuationRouteMapItem[] }>(
    showEvacuation ? '/api/incidents/flood/evacuation/routes' : null)
  const evacuationRoutes = evacuationResp?.routes ?? []

  const { data: predictionsData } = useApiResource<any[]>(showPredictions ? '/api/predictions' : null)
  const predictions = Array.isArray(predictionsData) ? predictionsData : []

  const { data: riskLayerData } = useApiResource<any>(showRiskLayer ? '/api/map/risk-layer' : null)

  const { data: heatmapResp } = useApiResource<{ points: Array<{ lat: number; lng: number; intensity?: number }> }>(
    showHeatmap ? '/api/map/heatmap-data' : null)
  const realHeatmapData = useMemo<[number, number, number][]>(
    () => heatmapResp?.points?.map(p => [p.lat, p.lng, p.intensity ?? 0.5]) ?? [],
    [heatmapResp])

  const { data: clustersResp } = useApiResource<{ clusters: IncidentCluster[] }>(
    '/api/reports/clusters?minutes=180&radiusMeters=1000&minReports=3', { pollMs: 60000 })
  const incidentClusters = clustersResp?.clusters ?? []

  const { data: cascadingResp } = useApiResource<{ inferred_cascades: CascadingInsight[] }>(
    '/api/reports/cascading-insights?windowMinutes=180', { pollMs: 90000 })
  const cascadingInsights = cascadingResp?.inferred_cascades ?? []

  const { data: incidentObjectsResp } = useApiResource<{ incidents: IncidentObject[] }>(
    '/api/reports/incident-objects?minutes=180&radiusMeters=1000&minReports=3', { pollMs: 60000 })
  const incidentObjects = incidentObjectsResp?.incidents ?? []

  //Interactive layer toggle state (user can enable/disable layers on the map)
  const [layerToggles, setLayerToggles] = useState({
    floodZones: showFloodZones,
    shelters: showShelters,
    predictions: showPredictions,
    distress: showDistress,
    evacuation: showEvacuation,
    heatmap: showHeatmap,
    riskLayer: showRiskLayer,
    floodMonitoring: showFloodMonitoring,
    confidenceHalos: true,
    clusters: true,
  })
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [displayToolsOpen, setDisplayToolsOpen] = useState(false)
  const mapWrapperRef = useRef<HTMLDivElement>(null)

  const toggleLayer = useCallback((key: keyof typeof layerToggles) => {
    setLayerToggles(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      mapWrapperRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFSChange)
    return () => document.removeEventListener('fullscreenchange', onFSChange)
  }, [])

  //Initialise activeWMS checkboxes when region config first loads
  const wmsInitRef = useRef(false)
  useEffect(() => {
    if (wmsLayers.length > 0 && !wmsInitRef.current) {
      wmsInitRef.current = true
      setActiveWMS(new Set(wmsLayers.map((_, i) => String(i))))
    }
  }, [wmsLayers])

  //Sync polled distress API response into state; socket events patch in real-time additions
  useEffect(() => {
    if (distressApiResp) {
      setDistressBeacons(distressApiResp.beacons ?? distressApiResp.distressCalls ?? distressApiResp.active ?? [])
    }
  }, [distressApiResp])

  //Socket.io – listen for distress:new / distress:updated in real-time via typed hook
  const distressEnabled = showDistress && canReadDistress
  useEventCallbacks(distressEnabled ? {
    'distress:new': (beacon) => {
      if (!beacon?.id) return
      setDistressBeacons(prev => prev.some(b => b.id === beacon.id) ? prev : [beacon as unknown as typeof prev[number], ...prev])
    },
    'distress:updated': (beacon) => {
      if (!beacon?.id) return
      setDistressBeacons(prev => prev.map(b => b.id === beacon.id ? { ...b, ...(beacon as Partial<typeof b>) } : b))
    },
  } : {})

  //Export visible report markers as GeoJSON FeatureCollection
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

  //Inject pulse keyframes for distress markers
  useEffect(() => {
    if (!document.getElementById('disastermap-pulse-css')) {
      const style = document.createElement('style')
      style.id = 'disastermap-pulse-css'
      style.textContent = '@keyframes dm-pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}'
      document.head.appendChild(style)
    }
  }, [])

  //Toggle WMS layer visibility
  const toggleWMS = useCallback((idx: string) => {
    setActiveWMS((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  //Report markers with clustering
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
          <div style={{ minWidth: 200, fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span className={`badge ${getSeverityClass(r.severity)}`}>{r.severity}</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#374151' }}>{r.id.slice(0, 8)}</span>
            </div>
            <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: '0 0 4px' }}>{r.type}</p>
            <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 4px', lineHeight: 1.4 }}>{r.description}</p>
            <p style={{ fontSize: 11, color: '#4b5563', margin: 0 }}>{r.location}</p>
          </div>
        </Popup>
      </Marker>
    ))
  }, [reports, showReports, onReportClick])

  //Confidence halos around reports: high = solid, medium = dashed, low = translucent
  const confidenceHalos = useMemo(() => {
    if (!showReports || !layerToggles.confidenceHalos) return null

    if (incidentObjects.length > 0) {
      return incidentObjects.map((incident) => {
        const confidence = Number(incident.confidence || 0)
        const lifecycle = incident.lifecycle_state
        const radius = Math.max(90, Number(incident.radius_m || 120))

        let color = '#9ca3af'
        let dashArray: string | undefined = '8 6'
        let fillOpacity = 0.04

        if (lifecycle === 'confirmed') {
          color = '#16a34a'
          dashArray = undefined
          fillOpacity = 0.14
        } else if (lifecycle === 'high') {
          color = '#10b981'
          dashArray = undefined
          fillOpacity = 0.11
        } else if (lifecycle === 'probable') {
          color = '#f59e0b'
          dashArray = '7 6'
          fillOpacity = 0.09
        } else if (lifecycle === 'possible') {
          color = '#f97316'
          dashArray = '6 6'
          fillOpacity = 0.07
        }

        return (
          <Circle
            key={`incident-halo-${incident.incident_id}`}
            center={[incident.center.lat, incident.center.lng]}
            radius={radius}
            pathOptions={{ color, weight: 2, fillColor: color, fillOpacity, dashArray }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: '0 0 4px' }}>{incident.incident_type.replace(/_/g, ' ')} {'Incident'}</p>
                <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'State'}: {incident.lifecycle_state.toUpperCase()}</p>
                <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'Confidence'}: {Math.round(confidence * 100)}%</p>
                <p style={{ fontSize: 12, color: '#1f2937', margin: 0 }}>{'Evidence'}: {incident.evidence_count} -- {'Window'}: {incident.time_window_minutes} {'min'}</p>
              </div>
            </Popup>
          </Circle>
        )
      })
    }

    return reports
      .filter((r) => r.coordinates?.length === 2)
      .map((r) => {
        const raw = Number(r.confidence ?? 50)
        const confidence = raw > 1 ? raw / 100 : raw
        const radius = Math.max(80, Math.round(120 + (1 - confidence) * 320))

        let color = '#10b981'
        let dashArray: string | undefined
        let fillOpacity = 0.08

        if (confidence < 0.5) {
          color = '#9ca3af'
          fillOpacity = 0.04
        } else if (confidence < 0.75) {
          color = '#f59e0b'
          dashArray = '7 6'
          fillOpacity = 0.07
        }

        return (
          <Circle
            key={`halo-${r.id}`}
            center={r.coordinates}
            radius={radius}
            pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity, dashArray }}
          />
        )
      })
  }, [reports, incidentObjects, showReports, layerToggles.confidenceHalos, lang])

  //Spatiotemporal incident cluster visualisation
  const clusterCircles = useMemo(() => {
    if (!layerToggles.clusters || incidentClusters.length === 0) return null
    return incidentClusters.map((cluster) => {
      const confidence = Number(cluster.confidence || 0)
      const stroke = confidence >= 0.8 ? '#16a34a' : confidence >= 0.6 ? '#d97706' : '#dc2626'
      return (
        <Circle
          key={cluster.cluster_id}
          center={[cluster.center.lat, cluster.center.lng]}
          radius={Math.max(80, cluster.radius_m)}
          pathOptions={{ color: stroke, weight: 2.5, fillColor: stroke, fillOpacity: 0.12, dashArray: confidence >= 0.75 ? undefined : '8 6' }}
        >
          <Popup>
            <div style={{ minWidth: 220 }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: '0 0 4px' }}>{cluster.incident_type} {'Cluster'}</p>
              <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'Reports'}: {cluster.reports} -- {'Radius'}: {cluster.radius_m}m</p>
              <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'Time Window'}: {cluster.time_window_minutes} {'min'}</p>
              <p style={{ fontSize: 12, color: '#1f2937', margin: 0 }}>{'Confidence'}: {Math.round(confidence * 100)}%</p>
            </div>
          </Popup>
        </Circle>
      )
    })
  }, [incidentClusters, layerToggles.clusters, lang])

  //Flood zones
  const zones = useMemo(() => {
    if (!showFloodZones || !layerToggles.floodZones) return null
    return (location.floodZones || []).map((z, i) => (
      <Circle key={i} center={z.coords} radius={500} pathOptions={ZS[z.risk] || ZS.low}>
        <Popup>
          <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: '0 0 2px' }}>{z.name}</p>
          <p style={{ fontSize: 12, color: '#1f2937', margin: 0 }}>{'Risk'}: {z.risk.toUpperCase()}</p>
        </Popup>
      </Circle>
    ))
  }, [location.floodZones, showFloodZones, layerToggles.floodZones])

  //Flood monitoring GeoJSON layers
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
          layer.bindPopup(`<strong>${name}</strong><br/><span style="font-size:11px">${'Severity'}: ${severity.toUpperCase()}</span>`)
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
            `<span style="font-size:11px">${'Level'}: ${level}</span><br/>` +
            `<span style="font-size:11px">${'Status'}: ${status.toUpperCase()}</span>`,
          )
        }}
      />
    )
  }, [showFloodMonitoring, layerToggles.floodMonitoring, floodData.data, floodData.currentRegion])

  //Shelter markers
  const shelterMarkers = useMemo(() => {
    if (!showShelters || !layerToggles.shelters || !shelters.length) return null
    return shelters.map((s) => (
      <Marker key={s.id} position={[s.lat, s.lng]} icon={shelterIcon}>
        <Popup>
          <div style={{ minWidth: 200 }}>
            <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: '0 0 2px' }}>{s.name}</p>
            <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 4px' }}>{s.address}</p>
            <p style={{ fontSize: 12, color: '#1f2937', margin: 0 }}>
              {'Capacity'}: {s.current_occupancy}/{s.capacity} |
              {'Type'}: {s.shelter_type}
            </p>
            {s.amenities.length > 0 && (
              <p style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>
                {'Amenities'}: {s.amenities.join(', ')}
              </p>
            )}
            {s.phone && (
              <p style={{ fontSize: 11, marginTop: 4 }}>
                <a href={`tel:${s.phone}`} style={{ color: '#2563eb' }}>{s.phone}</a>
              </p>
            )}
          </div>
        </Popup>
      </Marker>
    ))
  }, [shelters, showShelters, layerToggles.shelters])

  //Heatmap points from reports + real API data
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

  //Distress beacon markers
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
            <div style={{ minWidth: 180 }}>
              <p style={{ fontWeight: 700, color: '#dc2626', fontSize: 13, margin: '0 0 4px' }}>🚨 {'DISTRESS BEACON'}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>{b.citizenName || b.citizen_name || 'Citizen'}</p>
              <p style={{ fontSize: 12, color: '#1f2937', margin: 0 }}>{b.message || 'Emergency assistance requested'}</p>
 {b.isVulnerable && <p style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>!️ {'Vulnerable person'}</p>}
            </div>
          </Popup>
        </Marker>
      )
    }).filter(Boolean)
  }, [showDistress, layerToggles.distress, distressBeacons])

  //Evacuation route polylines
  const evacuationLines = useMemo(() => {
    if (!showEvacuation || !layerToggles.evacuation || !evacuationRoutes.length) return null
    return evacuationRoutes.map((route: EvacuationRouteMapItem, i) => {
      const rawCoords = route.coordinates?.length ? route.coordinates : route.geometry?.coordinates
      if (!rawCoords?.length) return null
      const latlngs: [number, number][] = rawCoords.map((c: any) =>
        Array.isArray(c) ? [c[1], c[0]] as [number, number] : [c.lat, c.lng] as [number, number]
      )
      return (
        <Polyline key={`evac-${route.id || i}`} positions={latlngs} pathOptions={{ color: route.isBlocked ? '#ef4444' : '#22c55e', weight: 4, opacity: 0.8, dashArray: route.isBlocked ? '4 8' : '10 6' }}>
          <Popup>
            <div style={{ minWidth: 220 }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: '0 0 4px' }}>{route.name || 'Evacuation Route'}</p>
              {route.description && <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{route.description}</p>}
              {typeof route.recommendationScore === 'number' && (
                <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'Recommendation'}: {Math.round(route.recommendationScore * 100)}% -- {'Risk'}: {Math.round((route.riskScore || 0) * 100)}%</p>
              )}
              {typeof route.etaConfidence === 'number' && (
                <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'ETA confidence'}: {Math.round(route.etaConfidence * 100)}%{route.closureProximityM ? ` -- ${'Closure proximity'} ${route.closureProximityM}m` : ''}</p>
              )}
              {route.explanation?.scoreBreakdown && (
                <p style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>{'Profile'}: {route.explanation.scoreBreakdown.profile} -- {'Time'} {Math.round(route.explanation.scoreBreakdown.timeScore * 100)} -- {'Risk penalty'} {Math.round(route.explanation.scoreBreakdown.riskPenalty * 100)}</p>
              )}
              {route.explanation?.blockedSegments?.length ? (
                <div style={{ marginTop: 4 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c' }}>{'Blocked segments'}</p>
                  <p style={{ fontSize: 12, color: '#1f2937' }}>{route.explanation.blockedSegments.length} {'segment(s) affected -- closest'} {Math.min(...route.explanation.blockedSegments.map((segment) => segment.hazardDistanceM))}m</p>
                </div>
              ) : null}
              {route.explanation?.topHazards?.length ? (
                <div style={{ marginTop: 4 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#111827' }}>{'Top hazards'}</p>
                  <p style={{ fontSize: 12, color: '#1f2937' }}>{route.explanation.topHazards.slice(0, 2).map((h) => `${h.severity} ${h.distanceM}m${h.reason ? ` (${h.reason})` : ''}`).join(' -- ')}</p>
                </div>
              ) : null}
            </div>
          </Popup>
        </Polyline>
      )
    }).filter(Boolean)
  }, [showEvacuation, layerToggles.evacuation, evacuationRoutes, lang])

  //AI Flood prediction risk circles ? dynamic coords from location context + prediction data
  const predictionCircles = useMemo(() => {
    if (!showPredictions || !layerToggles.predictions || !predictions.length) return null
    //Build coordinate lookup from location floodZones + prediction lat/lng
    const zoneCoords: Record<string, [number, number]> = {}
    for (const z of location.floodZones || []) {
      zoneCoords[z.name] = z.coords
    }
    return predictions.map((p, i) => {
      //Use prediction's own coordinates first, then zone lookup, then skip
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
            <div style={{ minWidth: 200 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#111827', margin: '0 0 4px' }}>{p.area}</p>
              <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'Flood probability'}: <span style={{ fontWeight: 700, color: colour }}>{Math.round(prob * 100)}%</span></p>
              <p style={{ fontSize: 12, color: '#1f2937', margin: '0 0 2px' }}>{'Severity'}: {p.severity} -- {'Confidence'}: {p.confidence}%</p>
              <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px' }}>{'Uncertainty band'}: {Math.max(0, Math.round((Number(p.probability || 0) - (100 - Number(p.confidence || 0)) / 200) * 100))}% - {Math.min(100, Math.round((Number(p.probability || 0) + (100 - Number(p.confidence || 0)) / 200) * 100))}%</p>
              {p.time_to_flood && <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px' }}>{'Time to flood'}: {p.time_to_flood}</p>}
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{p.model_version}</p>
            </div>
          </Popup>
        </Circle>
      )
    }).filter(Boolean)
  }, [showPredictions, layerToggles.predictions, predictions])

  //Deployment zone markers ? resolve coords from DB, floodZones lookup, or offset from center
  const deploymentMarkers = useMemo(() => {
    if (!deployments || !deployments.length) return null
    //Build coordinate lookup from location floodZones
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
      //Try DB coordinates first, then fuzzy match zone name against floodZones, then offset from map center
      let coords: [number, number] | null = null
      if (d.lat && d.lng) {
        coords = [d.lat, d.lng]
      } else {
        //Fuzzy match: check if zone name contains or is contained by any floodZone name
        const zoneLower = d.zone.toLowerCase()
        for (const [name, c] of Object.entries(zoneCoords)) {
          if (zoneLower.includes(name) || name.includes(zoneLower) ||
              zoneLower.replace(/zone\s*[a-z]\s*[\u2013\u2014-]\s*/i, '').trim() === name) {
            coords = c
            break
          }
        }
        //Last resort: offset from map center based on index
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
                }}>{'DEPLOYED'}</span>}
              </div>
              <p style={{ fontSize: 11, margin: '2px 0' }}>{'Active Reports'}: <strong>{d.active_reports}</strong></p>
              {d.estimated_affected && <p style={{ fontSize: 11, margin: '2px 0' }} className="text-red-600 dark:text-red-400">{'Affected'}: {d.estimated_affected}</p>}
              <div style={{ display: 'flex', gap: 8, fontSize: 11, marginTop: 4 }}>
                {(d.ambulances ?? 0) > 0 && <span>🚑 {d.ambulances}</span>}
                {(d.fire_engines ?? 0) > 0 && <span>🚒 {d.fire_engines}</span>}
                {(d.rescue_boats ?? 0) > 0 && <span>⚓ {d.rescue_boats}</span>}
              </div>
              {d.ai_recommendation && <p style={{ fontSize: 10, marginTop: 4, fontStyle: 'italic' }} className="text-gray-500 dark:text-gray-300">{'AI'}: {d.ai_recommendation}</p>}
            </div>
          </Popup>
        </Circle>
      )
    })
  }, [deployments, location.floodZones, mapCenter, lang])

  //PostGIS risk layer GeoJSON polygons
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
          layer.bindPopup(`<strong>${name}</strong><br/><span style="font-size:11px;">${'Risk'}: ${risk.toUpperCase()}</span>${p.description ? `<br/><span style="font-size:10px;">${p.description}</span>` : ''}`)
        }}
      />
    )
  }, [showRiskLayer, layerToggles.riskLayer, riskLayerData])

  return (
    <div
      ref={mapWrapperRef}
      className={`map-wrapper flex flex-col rounded-xl overflow-hidden ${className}`}
      style={isFullscreen ? { height: '100dvh' } : { height }}
    >
      {/* Unified map toolbar (hidden in focus mode) */}
      {!focusMode && (
        <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 bg-gray-900/85 backdrop-blur-md border-b border-white/10 z-[750]">
          {/* Left control group */}
          <div className="flex items-center gap-1 flex-1 min-w-0">

            {/* Overlay Layers dropdown */}
            <div className="relative">
              <button
                onClick={() => { setOverlayPanelOpen(p => !p); setLayerPanelOpen(false); setLegendOpen(false) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/90 hover:bg-white/10 transition-colors"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                  <path d="M8 1l6 3.5L8 8 2 4.5 8 1zm0 4.5L2 9l6 3.5L14 9 8 5.5zm0 4.5L2 13.5 8 17l6-3.5L8 10z"/>
                </svg>
                <span className="hidden sm:inline">{'Layers'}</span>
                <svg viewBox="0 0 10 6" fill="currentColor" className="w-2 h-2 flex-shrink-0 opacity-60">
                  <path d={overlayPanelOpen ? 'M5 0L0 6h10z' : 'M5 6L0 0h10z'} />
                </svg>
              </button>
              {overlayPanelOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg p-3 w-56 max-h-[50vh] overflow-y-auto border border-gray-200 dark:border-gray-700 z-[760]">
                  <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-300 mb-2 uppercase tracking-wider">{'Toggle Map Overlays'}</p>
                  {([
                    { key: 'floodZones' as const, label: 'Flood Zones', color: 'bg-red-300', enabled: showFloodZones },
                    { key: 'floodMonitoring' as const, label: 'Flood Monitoring', color: 'bg-amber-500', enabled: showFloodMonitoring },
                    { key: 'predictions' as const, label: 'AI Predictions', color: 'bg-yellow-500', enabled: showPredictions },
                    { key: 'riskLayer' as const, label: 'Risk Zones', color: 'bg-orange-400', enabled: showRiskLayer },
                    { key: 'shelters' as const, label: 'Shelters', color: 'bg-green-500', enabled: showShelters },
                    { key: 'evacuation' as const, label: 'Evacuation Routes', color: 'bg-green-400', enabled: showEvacuation },
                    { key: 'distress' as const, label: 'SOS Beacons', color: 'bg-red-600', enabled: showDistress },
                    { key: 'heatmap' as const, label: 'Density Heatmap', color: 'bg-gradient-to-r from-blue-400 to-red-400', enabled: showHeatmap },
                    { key: 'confidenceHalos' as const, label: 'Confidence Halos', color: 'bg-emerald-400', enabled: true },
                    { key: 'clusters' as const, label: 'Incident Clusters', color: 'bg-lime-500', enabled: true },
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

            {/* Flood / WMS layers dropdown */}
            {showWMSLayers && (
              <div className="relative">
                <button
                  onClick={() => { setLayerPanelOpen(p => !p); setOverlayPanelOpen(false); setLegendOpen(false) }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/90 hover:bg-white/10 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                    <path d="M12 3.5c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm4 10h-3v3h-2v-3H8v-2h3v-3h2v3h3v2z"/>
                  </svg>
                  <span className="hidden sm:inline">{'Flood Data'}</span>
                  <svg viewBox="0 0 10 6" fill="currentColor" className="w-2 h-2 flex-shrink-0 opacity-60">
                    <path d={layerPanelOpen ? 'M5 0L0 6h10z' : 'M5 6L0 0h10z'} />
                  </svg>
                </button>
                {layerPanelOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg p-3 w-56 border border-gray-200 dark:border-gray-700 z-[760]">
                    {wmsLayers.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-300 py-2 text-center italic">
                        {'No WMS layers configured for this region'}
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

            {/* Legend toggle */}
            <div className="relative">
              <button
                onClick={() => { setLegendOpen(p => !p); setOverlayPanelOpen(false); setLayerPanelOpen(false) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/90 hover:bg-white/10 transition-colors"
              >
                <span className="flex gap-0.5 items-center">
                  <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                </span>
                <span className="hidden sm:inline">{'Legend'}</span>
              </button>
              {legendOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white/95 dark:bg-gray-900/95 backdrop-blur rounded-lg p-3 shadow-xl text-xs max-h-[40vh] overflow-y-auto w-48 border border-gray-200 dark:border-gray-700 z-[760]">
                  <div className="space-y-1.5">
                    {([['bg-red-500', 'High'], ['bg-amber-500', 'Medium'], ['bg-blue-500', 'Low']] as [string, string][]).map(([c, l]) => (
                      <div key={l} className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${c} flex-shrink-0`} />
                        <span className="text-gray-600 dark:text-gray-300">{l}</span>
                      </div>
                    ))}
                    {showFloodZones && layerToggles.floodZones && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-300/50 border border-red-400 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'Flood zone'}</span>
                      </div>
                    )}
                    {showShelters && layerToggles.shelters && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'Shelter'}</span>
                      </div>
                    )}
                    {showFloodMonitoring && layerToggles.floodMonitoring && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                          <span className="text-gray-600 dark:text-gray-300">{'Warning'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                          <span className="text-gray-600 dark:text-gray-300">{'Watch'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                          <span className="text-gray-600 dark:text-gray-300">{'Station'}</span>
                        </div>
                      </>
                    )}
                    {showHeatmap && layerToggles.heatmap && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-red-500 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'Density'}</span>
                      </div>
                    )}
                    {showDistress && layerToggles.distress && distressBeacons.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">SOS ({distressBeacons.length})</span>
                      </div>
                    )}
                    {showPredictions && layerToggles.predictions && predictions.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60 border border-yellow-500 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'AI Prediction'} ({predictions.length})</span>
                      </div>
                    )}
                    {layerToggles.confidenceHalos && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60 border border-emerald-500 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">
                          {incidentObjects.length > 0 ? `${'Confidence lifecycle'} (${incidentObjects.length})` : 'Confidence halo'}
                        </span>
                      </div>
                    )}
                    {layerToggles.clusters && incidentClusters.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-lime-500/70 border border-lime-600 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'Clusters'} ({incidentClusters.length})</span>
                      </div>
                    )}
                    {showRiskLayer && layerToggles.riskLayer && riskLayerData?.features?.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded bg-orange-200 border border-orange-400 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'Risk Zone'} ({riskLayerData.features.length})</span>
                      </div>
                    )}
                    {showEvacuation && layerToggles.evacuation && evacuationRoutes.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded bg-green-500 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-300">{'Evacuation'}</span>
                      </div>
                    )}
                    {deployments.length > 0 && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full border-2 border-green-500 bg-green-100 flex-shrink-0" />
                          <span className="text-gray-600 dark:text-gray-300">{'Deployed'} ({deployments.filter(d => d.deployed).length})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full border-2 border-red-500 bg-red-100 flex-shrink-0" style={{ borderStyle: 'dashed' }} />
                          <span className="text-gray-600 dark:text-gray-300">{'Awaiting'} ({deployments.filter(d => !d.deployed).length})</span>
                        </div>
                      </>
                    )}
                  </div>
                  {showFloodMonitoring && floodData.loading && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-gray-500 dark:text-gray-300">{'Loading flood data...'}</p>
                    </div>
                  )}
                  {showFloodMonitoring && floodData.error && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-red-500">{'Data unavailable'}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Export GeoJSON */}
            {showReports && reports.some(r => r.coordinates?.length === 2) && (
              <>
                <div className="w-px h-4 bg-white/20 mx-0.5 flex-shrink-0" />
                <button
                  onClick={exportGeoJSON}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/90 hover:bg-white/10 transition-colors"
                  title="Export report markers as GeoJSON"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                    <path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1zm0 1.5L3.5 5.25v5.5L8 13.5l4.5-2.75v-5.5L8 2.5z"/>
                  </svg>
                  <span className="hidden sm:inline">{'Export'}</span>
                </button>
              </>
            )}

            {/* Display Tools */}
            {showSpatialTools && (
              <>
                <div className="w-px h-4 bg-white/20 mx-0.5 flex-shrink-0" />
                <button
                  onClick={() => { setDisplayToolsOpen(p => !p); setOverlayPanelOpen(false); setLayerPanelOpen(false); setLegendOpen(false) }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${displayToolsOpen ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`}
                  title="Spatial analysis &amp; display tools"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 flex-shrink-0">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  <span className="hidden sm:inline">{'Display Tools'}</span>
                </button>
              </>
            )}
          </div>

          {/* Right: Focus Mode + Fullscreen */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className="w-px h-4 bg-white/20 mx-0.5" />
            <button
              onClick={() => setFocusMode(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/90 hover:text-white hover:bg-white/10 transition-colors"
              title="Focus mode -- hide controls"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 flex-shrink-0">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/>
              </svg>
              <span className="hidden sm:inline">{'Focus'}</span>
            </button>
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/90 hover:text-white hover:bg-white/10 transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
            >
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 flex-shrink-0">
                  <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 flex-shrink-0">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                </svg>
              )}
              <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Full'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Map canvas area */}
      <div className="relative flex-1 min-h-0">
        {/* Loading overlay while map initializes */}
        {!mapReady && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 gap-3">
            <div className="w-10 h-10 rounded-xl bg-aegis-600 flex items-center justify-center animate-pulse">
              <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg>
            </div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">{'Initialising map...'}</p>
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

        {/* Confidence halos and incident clusters */}
        {confidenceHalos}
        {clusterCircles}

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
        {showSpatialTools && <SpatialToolbar reports={reports} open={displayToolsOpen} hideToggle />}

        {/* Incident type layers */}
        <IncidentMapLayers />
      </MapContainer>

        {/* Focus mode exit pill */}
        {focusMode && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center z-[750] pointer-events-none">
            <button
              onClick={() => setFocusMode(false)}
              className="pointer-events-auto bg-gray-900/90 text-white/90 text-xs font-medium px-5 py-2 rounded-full backdrop-blur-md shadow-xl hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              {'Exit Focus Mode'}
            </button>
          </div>
        )}

        {/* Cascading disaster intelligence card */}
        {!focusMode && cascadingInsights.length > 0 && (
          <div className="absolute bottom-3 right-3 z-[720] max-w-[320px]">
            <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur rounded-lg border border-gray-200 dark:border-gray-700 shadow-xl p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300 mb-2">{'Cascading Insights'}</p>
              <div className="space-y-2 max-h-[180px] overflow-y-auto">
                {cascadingInsights.slice(0, 3).map((insight, idx) => (
                  <div key={`cascade-${idx}`} className="rounded-md border border-gray-200 dark:border-gray-700 p-2">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                      {insight.chain.join(' -> ')}
                    </p>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300">
                      {'Confidence'}: {Math.round(insight.confidence * 100)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
