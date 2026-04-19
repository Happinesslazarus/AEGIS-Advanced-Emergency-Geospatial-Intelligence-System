/**
 * Module: LiveMap.tsx
 *
 * Live map shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useRef, useEffect, useState, useCallback } from 'react'
import { getAnyToken } from '../../utils/api'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Navigation, ZoomIn, ZoomOut, Satellite, Map as MapIcon, Mountain, RefreshCw, Layers, Eye, EyeOff } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { STATUS_HEX, SEVERITY_HEX_TITLE } from '../../utils/colorTokens'
import { OSM_TILE, SATELLITE_TILE, TOPO_TILE } from '../../utils/mapTileProviders'

const API = ''
const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278]
const DEFAULT_ZOOM = 13
const EMPTY_REPORTS: Report[] = []

const SEV_COLOURS: Record<string, string> = SEVERITY_HEX_TITLE
const STATUS_COLOURS: Record<string, string> = STATUS_HEX

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
  timestamp?: string
}

interface Props {
  reports?: Report[]
  showFloodPredictions?: boolean
  showEvacuationRoutes?: boolean
  center?: [number, number]
  zoom?: number
  className?: string
  height?: string
  onReportClick?: (r: any) => void
}

// Tile providers — imported from shared mapTileProviders.ts
const TILES = {
  dark: OSM_TILE,
  satellite: SATELLITE_TILE,
  terrain: TOPO_TILE,
}

function createSeverityIcon(severity: string): L.DivIcon {
  const colour = SEV_COLOURS[severity] || '#6b7280'
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position:relative;width:32px;height:32px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${colour}33;animation:pulse-ring 2s ease-out infinite;"></div>
        <div style="position:absolute;inset:4px;border-radius:50%;background:${colour};border:2px solid white;box-shadow:0 2px 8px ${colour}88;display:flex;align-items:center;justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

function createRiverIcon(status: string): L.DivIcon {
  const colour = STATUS_COLOURS[status] || '#22c55e'
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position:relative;width:28px;height:28px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${colour}44;"></div>
        <div style="position:absolute;inset:3px;border-radius:50%;background:${colour};border:2px solid white;box-shadow:0 2px 6px ${colour}66;display:flex;align-items:center;justify-content:center;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 16.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/>
            <path d="M7 11.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/>
            <path d="M7 6.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

function createDistressIcon(): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position:relative;width:36px;height:36px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:#ef444444;animation:distress-pulse 1s ease-out infinite;"></div>
        <div style="position:absolute;inset:0;border-radius:50%;background:#ef444422;animation:distress-pulse 1s ease-out infinite 0.5s;"></div>
        <div style="position:absolute;inset:6px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 0 12px #ef4444aa;display:flex;align-items:center;justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="0">
            <text x="12" y="17" text-anchor="middle" font-size="16" font-weight="bold">!</text>
          </svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  })
}

// Inject CSS for marker animations
const MARKER_CSS = `
  @keyframes pulse-ring {
    0% { transform: scale(1); opacity: 1; }
    100% { transform: scale(2); opacity: 0; }
  }
  @keyframes distress-pulse {
    0% { transform: scale(1); opacity: 0.8; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  .custom-marker { background: none !important; border: none !important; }
  .leaflet-popup-content-wrapper {
    background: #1f2937 !important;
    color: #f3f4f6 !important;
    border-radius: 12px !important;
    border: 1px solid #374151 !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
  }
  .leaflet-popup-tip { background: #1f2937 !important; }
  .leaflet-popup-content { margin: 10px 14px !important; font-size: 12px !important; line-height: 1.5 !important; }
  .leaflet-popup-close-button { color: #9ca3af !important; font-size: 18px !important; }
  .leaflet-popup-close-button:hover { color: #f3f4f6 !important; }
  .leaflet-control-zoom { border: none !important; }
  .leaflet-control-zoom a { background: #1f2937 !important; color: #e5e7eb !important; border: 1px solid #374151 !important; }
  .leaflet-control-zoom a:hover { background: #374151 !important; }
  /* Dark map: invert OSM tiles so they appear dark; hue-rotate restores natural water/vegetation colours.
     Scoped to .map-dark-invert wrapper so satellite basemap is unaffected. */
  .map-dark-invert .leaflet-tile { filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%) !important; }
`

export default function LiveMap({
  reports = EMPTY_REPORTS,
  showFloodPredictions = true,
  showEvacuationRoutes = false,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className = '',
  height = '100%',
  onReportClick,
}: Props): JSX.Element {
  const lang = useLanguage()
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const reportLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const riverLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const distressLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const evacuationLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const predictionLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const stationLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const riskLayerRef = useRef<L.LayerGroup>(L.layerGroup())
  const heatmapLayerRef = useRef<L.Layer | null>(null)
  // Stable ref for onReportClick — avoids infinite loop when parent doesn't memoize the callback
  const onReportClickRef = useRef(onReportClick)
  useEffect(() => { onReportClickRef.current = onReportClick })

  const [basemap, setBasemap] = useState<'dark' | 'satellite' | 'terrain'>('dark')
  const [evacuationData, setEvacuationData] = useState<any[]>([])
  const [markerCount, setMarkerCount] = useState({ reports: 0, rivers: 0, distress: 0, stations: 0, predictions: 0 })
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [layers, setLayers] = useState({
    reports: true,
    rivers: true,
    distress: true,
    stations: true,
    predictions: true,
    riskZones: true,
    heatmap: true,
    evacuation: true,
  })

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

    // Deterministic fallback: seed around current map center without hardcoded cities.
    const seed = String(prediction?.area || prediction?.id || index)
    let hash = 0
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    const latOffset = (((hash % 1000) / 1000) - 0.5) * 0.08
    const lngOffset = ((((hash / 1000) % 1000) / 1000) - 0.5) * 0.12
    return [center[0] + latOffset, center[1] + lngOffset]
  }, [center?.[0], center?.[1]])

  // Toggle layer visibility on map
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    const toggleLayer = (layer: L.LayerGroup | L.Layer | null, visible: boolean) => {
      if (!layer) return
      if (visible && !map.hasLayer(layer)) map.addLayer(layer)
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer)
    }
    toggleLayer(reportLayerRef.current, layers.reports)
    toggleLayer(riverLayerRef.current, layers.rivers)
    toggleLayer(distressLayerRef.current, layers.distress)
    toggleLayer(stationLayerRef.current, layers.stations)
    toggleLayer(predictionLayerRef.current, layers.predictions)
    toggleLayer(riskLayerRef.current, layers.riskZones)
    toggleLayer(evacuationLayerRef.current, layers.evacuation)
    toggleLayer(heatmapLayerRef.current, layers.heatmap)
  }, [layers])

  // Inject custom CSS once
  useEffect(() => {
    if (!document.getElementById('livemap-styles')) {
      const style = document.createElement('style')
      style.id = 'livemap-styles'
      style.textContent = MARKER_CSS
      document.head.appendChild(style)
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: false,
    })

    const tiles = L.tileLayer(TILES.dark.url, {
      attribution: TILES.dark.attribution,
      maxZoom: 19,
    }).addTo(map)
    tileLayerRef.current = tiles

    // Add attribution in bottom-right
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)

    // Add layers
    reportLayerRef.current.addTo(map)
    riverLayerRef.current.addTo(map)
    distressLayerRef.current.addTo(map)
    evacuationLayerRef.current.addTo(map)
    predictionLayerRef.current.addTo(map)
    stationLayerRef.current.addTo(map)
    riskLayerRef.current.addTo(map)

    mapRef.current = map

    // Fix Leaflet size calc on mount
    setTimeout(() => map.invalidateSize(), 100)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Fly to new location when center/zoom props change
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.flyTo(center, zoom, { animate: true, duration: 1.5 })
  }, [center[0], center[1], zoom])

  // Switch basemap tiles
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return
    const tileInfo = TILES[basemap]
    tileLayerRef.current.setUrl(tileInfo.url)
  }, [basemap])

  // Render report markers
  useEffect(() => {
    const layer = reportLayerRef.current
    layer.clearLayers()

    let count = 0
    for (const r of reports) {
      const lat = r.latitude ?? r.coordinates?.[0]
      const lng = r.longitude ?? r.coordinates?.[1]
      if (!lat || !lng) continue

      const severity = r.severity || 'Low'
      const marker = L.marker([lat, lng], { icon: createSeverityIcon(severity) })

      const popupContent = `
        <div style="min-width:180px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="background:${SEV_COLOURS[severity] || '#6b7280'};color:white;font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;">${severity}</span>
            <span style="color:#9ca3af;font-size:9px;">#${r.id}</span>
          </div>
          <p style="font-weight:600;font-size:13px;margin:0 0 4px;">${r.title || r.category || r.type || t('map.reportDefault', lang)}</p>
          <p style="color:#9ca3af;font-size:11px;margin:0 0 4px;">${r.location || ''}</p>
          ${r.description ? `<p style="color:#d1d5db;font-size:10px;margin:0 0 6px;max-height:40px;overflow:hidden;">${r.description.substring(0, 120)}${r.description.length > 120 ? '—' : ''}</p>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #374151;padding-top:6px;margin-top:4px;">
            <span style="font-size:9px;color:#6b7280;">${r.status || ''}</span>
            <span style="font-size:9px;color:#6b7280;">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
          </div>
        </div>
      `
      marker.bindPopup(popupContent, { maxWidth: 280, closeButton: true })

      if (onReportClickRef.current) {
        marker.on('click', () => onReportClickRef.current!(r))
      }
      marker.addTo(layer)
      count++
    }
    setMarkerCount(prev => ({ ...prev, reports: count }))
  }, [reports])

  // Fetch & render river gauge stations
  const fetchRivers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/rivers/levels`)
      if (!res.ok) return
      const data = await res.json()
      const levels = data.levels || []

      const layer = riverLayerRef.current
      layer.clearLayers()
      let count = 0

      for (const station of levels) {
        const lat = station.coordinates?.lat
        const lng = station.coordinates?.lng
        if (!lat || !lng) continue

        const colour = STATUS_COLOURS[station.status] || '#22c55e'
        const marker = L.marker([lat, lng], { icon: createRiverIcon(station.status) })

        const pctOfFlood = station.percentageOfFloodLevel || 0
        const barWidth = Math.min(pctOfFlood, 100)

        marker.bindPopup(`
          <div style="min-width:200px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2"><path d="M7 16.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/><path d="M7 11.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/></svg>
              <span style="font-weight:700;font-size:13px;">${station.stationName || station.riverName}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
              <div>
                <span style="font-size:9px;color:#9ca3af;text-transform:uppercase;">${t('map.level', lang)}</span>
                <div style="font-size:18px;font-weight:800;font-family:monospace;">${station.levelMetres?.toFixed(2)}m</div>
              </div>
              <div>
                <span style="font-size:9px;color:#9ca3af;text-transform:uppercase;">${t('map.flow', lang)}</span>
                <div style="font-size:14px;font-weight:700;font-family:monospace;">${station.flowCumecs?.toFixed(1) ?? '—'} m—/s</div>
              </div>
            </div>
            <div style="margin-bottom:6px;">
              <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:2px;">
                <span>${t('map.floodRisk', lang)}</span>
                <span style="color:${colour};font-weight:600;">${pctOfFlood}%</span>
              </div>
              <div style="height:6px;background:#374151;border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${barWidth}%;background:${colour};border-radius:99px;transition:width 0.5s;"></div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid #374151;padding-top:6px;">
              <span style="background:${colour}30;color:${colour};font-size:9px;font-weight:600;padding:2px 8px;border-radius:99px;">${station.status}</span>
              <span style="font-size:9px;color:#6b7280;">${t('map.trend', lang)}: ${station.trend || t('map.trendSteady', lang)}</span>
            </div>
            <div style="margin-top:4px;font-size:8px;color:#4b5563;">${station.dataSource || ''}</div>
          </div>
        `, { maxWidth: 300 })

        marker.addTo(layer)
        count++
      }
      setMarkerCount(prev => ({ ...prev, rivers: count }))
    } catch {}
  }, [])

  // Fetch & render distress beacons
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
      const beacons = data.beacons || data.distressCalls || data.active || []

      const layer = distressLayerRef.current
      layer.clearLayers()
      let count = 0

      for (const b of beacons) {
        const lat = b.latitude || b.location?.lat
        const lng = b.longitude || b.location?.lng
        if (!lat || !lng) continue

        const marker = L.marker([lat, lng], { icon: createDistressIcon() })
        marker.bindPopup(`
          <div style="min-width:180px;">
            <div style="color:#ef4444;font-weight:700;font-size:14px;margin-bottom:4px;">🚨 ${t('map.distressBeacon', lang)}</div>
            <p style="font-size:12px;margin:0 0 4px;">${b.citizenName || b.citizen_name || t('map.citizen', lang)}</p>
            <p style="font-size:10px;color:#9ca3af;margin:0;">${b.message || t('map.emergencyAssistance', lang)}</p>
            <div style="margin-top:6px;border-top:1px solid #374151;padding-top:4px;font-size:9px;color:#6b7280;">
              ${b.activatedAt ? new Date(b.activatedAt).toLocaleString() : ''}
            </div>
          </div>
        `)
        marker.addTo(layer)
        count++
      }
      setMarkerCount(prev => ({ ...prev, distress: count }))
    } catch {}
  }, [])

  // Fetch evacuation routes
  const fetchEvacuation = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/incidents/flood/evacuation/routes`)
      if (!res.ok) return
      const data = await res.json()
      setEvacuationData(data.routes || [])
    } catch {}
  }, [])

  // Render evacuation routes
  useEffect(() => {
    const layer = evacuationLayerRef.current
    layer.clearLayers()

    if (!showEvacuationRoutes) return

    for (const route of evacuationData) {
      if (!route.coordinates || !route.coordinates.length) continue

      const latlngs = route.coordinates.map((c: any) =>
        Array.isArray(c) ? [c[1], c[0]] : [c.lat, c.lng]
      )

      const line = L.polyline(latlngs, {
        color: '#22c55e',
        weight: 4,
        opacity: 0.8,
        dashArray: '10 6',
      })

      line.bindPopup(`
        <div>
          <p style="font-weight:700;font-size:13px;margin:0 0 4px;">${route.name || t('map.evacuationRoute', lang)}</p>
          <p style="font-size:10px;color:#9ca3af;margin:0;">${route.description || ''}</p>
        </div>
      `)
      line.addTo(layer)
    }
  }, [showEvacuationRoutes, evacuationData])

  // Fetch & render real SEPA/EA gauge stations
  const fetchStations = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        lat: String(center[0]),
        lng: String(center[1]),
        dist: '120',
      })

      let res = await fetch(`${API}/api/flood-data/stations?${params.toString()}`)
      if (!res.ok) {
        // Fallback keeps backward compatibility with older backends.
        res = await fetch(`${API}/api/flood-data/stations?region=global&${params.toString()}`)
      }
      if (!res.ok) return
      const data = await res.json()
      const features: any[] = data.features || []

      const layer = stationLayerRef.current
      layer.clearLayers()
      let count = 0

      for (const f of features) {
        const lng = f.geometry?.coordinates?.[0]
        const lat = f.geometry?.coordinates?.[1]
        if (!lat || !lng) continue

        const p = f.properties || {}
        const level = parseFloat(p.level_m) || 0
        const typical = parseFloat(p.typical_high_m) || 0
        const pct = typical > 0 ? Math.round((level / typical) * 100) : 0
        const status = p.level_status || 'normal'
        const colour = status === 'high' || status === 'severe' ? '#f97316'
          : status === 'above normal' ? '#eab308'
          : '#22c55e'
        const barWidth = Math.min(pct, 100)

        const icon = L.divIcon({
          className: 'custom-marker',
          html: `
            <div style="position:relative;width:22px;height:22px;">
              <div style="position:absolute;inset:0;border-radius:50%;background:${colour}44;"></div>
              <div style="position:absolute;inset:3px;border-radius:50%;background:${colour};border:1.5px solid white;box-shadow:0 1px 5px ${colour}66;display:flex;align-items:center;justify-content:center;">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round">
                  <path d="M7 16.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/>
                  <path d="M7 11.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/>
                </svg>
              </div>
            </div>
          `,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          popupAnchor: [0, -13],
        })

        const marker = L.marker([lat, lng], { icon })
        marker.bindPopup(`
          <div style="min-width:190px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2"><path d="M7 16.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/><path d="M7 11.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/></svg>
              <span style="font-weight:700;font-size:12px;">${p.station_name || p.station_id}</span>
            </div>
            <div style="font-size:9px;color:#9ca3af;margin-bottom:4px;">${p.river_name || ''} — ${p.jurisdiction || 'EA'}</div>
            ${level > 0 ? `
              <div style="margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:2px;">
                  <span>${t('map.level', lang)}: ${level.toFixed(2)}m</span>
                  <span style="color:${colour};font-weight:600;">${pct}% ${t('map.ofTypicalHigh', lang)}</span>
                </div>
                <div style="height:5px;background:#374151;border-radius:99px;overflow:hidden;">
                  <div style="height:100%;width:${barWidth}%;background:${colour};border-radius:99px;"></div>
                </div>
              </div>
            ` : `<div style="font-size:9px;color:#6b7280;margin-bottom:4px;">${t('map.noLevelReading', lang)}</div>`}
            <div style="display:flex;justify-content:space-between;border-top:1px solid #374151;padding-top:4px;">
              <span style="background:${colour}30;color:${colour};font-size:8px;font-weight:600;padding:1px 6px;border-radius:99px;">${status.toUpperCase()}</span>
              <span style="font-size:8px;color:#6b7280;">${t('map.trend', lang)}: ${p.trend || t('map.trendSteady', lang)}</span>
            </div>
          </div>
        `, { maxWidth: 260 })
        marker.addTo(layer)
        count++
      }
      setMarkerCount(prev => ({ ...prev, stations: count }))
    } catch {}
  }, [center])

  // Fetch & render live flood predictions as risk circles
  const fetchPredictions = useCallback(async () => {
    if (!showFloodPredictions) return
    try {
      const res = await fetch(`${API}/api/predictions`)
      if (!res.ok) return
      const data: any[] = await res.json()

      const layer = predictionLayerRef.current
      layer.clearLayers()
      let count = 0

      for (let idx = 0; idx < data.length; idx += 1) {
        const p = data[idx]
        const coords = resolvePredictionCoords(p, idx)

        const prob = parseFloat(p.probability) || 0
        const colour = prob >= 0.75 ? '#dc2626' : prob >= 0.5 ? '#f97316' : '#eab308'
        const radiusM = 800 + prob * 1200 // 800—2000m based on probability

        // Shaded risk circle
        const circle = L.circle(coords, {
          radius: radiusM,
          color: colour,
          weight: 1.5,
          opacity: 0.8,
          fillColor: colour,
          fillOpacity: 0.12,
        })

        const pctLabel = `${Math.round(prob * 100)}%`
        const severityBg = prob >= 0.75 ? '#dc262630' : prob >= 0.5 ? '#f9731630' : '#eab30830'
        circle.bindPopup(`
          <div style="min-width:210px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <span style="background:${severityBg};color:${colour};font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;">${p.severity || 'MEDIUM'} ${t('map.risk', lang)}</span>
              <span style="font-size:9px;color:#9ca3af;">${t('map.aiPrediction', lang)}</span>
            </div>
            <p style="font-weight:700;font-size:13px;margin:0 0 2px;">${p.area}</p>
            <div style="margin-bottom:6px;">
              <div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:2px;">
                <span>${t('map.floodProbability', lang)}</span>
                <span style="color:${colour};font-weight:700;">${pctLabel}</span>
              </div>
              <div style="height:5px;background:#374151;border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${pctLabel};background:${colour};border-radius:99px;"></div>
              </div>
            </div>
            <div style="font-size:9px;color:#9ca3af;margin-bottom:4px;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${p.time_to_flood || 'Unknown'}</div>
            <div style="font-size:9px;color:#60a5fa;margin-bottom:4px;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${p.matched_pattern || ''}</div>
            ${p.next_areas?.length ? `<div style="font-size:9px;color:#fbbf24;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" style="flex-shrink:0;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>${t('map.downstream', lang)}: ${p.next_areas.join(', ')}</div>` : ''}
            <div style="border-top:1px solid #374151;padding-top:4px;margin-top:4px;font-size:8px;color:#6b7280;">
              ${t('map.confidence', lang)}: ${p.confidence}% — ${p.model_version}
            </div>
          </div>
        `, { maxWidth: 300 })
        circle.addTo(layer)
        count++
      }
      setMarkerCount(prev => ({ ...prev, predictions: count }))
    } catch {}
  }, [showFloodPredictions, resolvePredictionCoords])

  // Fetch & render PostGIS risk layer (flood polygons)
  const fetchRiskLayer = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/map/risk-layer`)
      if (!res.ok) return
      const data = await res.json()
      if (!data?.features?.length) return

      const layer = riskLayerRef.current
      layer.clearLayers()

      const geoLayer = L.geoJSON(data, {
        style: (feature: any) => {
          const risk: string = feature?.properties?.risk_level || feature?.properties?.severity || 'medium'
          const cm: Record<string, { color: string; fill: string }> = {
            critical: { color: '#dc2626', fill: '#fca5a5' }, high: { color: '#f97316', fill: '#fed7aa' },
            medium: { color: '#eab308', fill: '#fef08a' }, low: { color: '#3b82f6', fill: '#93c5fd' },
          }
          const c = cm[risk] || cm.medium
          return { color: c.color, weight: 2, fillColor: c.fill, fillOpacity: 0.25, dashArray: risk === 'critical' ? '' : '5 3' }
        },
        onEachFeature: (feature: any, lyr: any) => {
          const p = feature.properties || {}
          const name = p.name || p.area_name || t('map.riskZone', lang)
          const risk: string = p.risk_level || p.severity || 'medium'
          const riskColourMap: Record<string, string> = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#3b82f6' }
          const riskColour = riskColourMap[risk] || '#eab308'
          lyr.bindPopup(`
            <div style="min-width:180px;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                <span style="background:${riskColour}30;color:${riskColour};font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;">${risk} ${t('map.risk', lang)}</span>
              </div>
              <p style="font-weight:700;font-size:13px;margin:0 0 2px;">${name}</p>
              ${p.description ? `<p style="color:#9ca3af;font-size:10px;margin:0;">${p.description}</p>` : ''}
            </div>
          `, { maxWidth: 260 })
        },
      })
      geoLayer.addTo(layer)
    } catch {}
  }, [])

  // Fetch & render real heatmap data
  const fetchHeatmap = useCallback(async () => {
    try {
      if (!mapRef.current) return
      const res = await fetch(`${API}/api/map/heatmap-data`)
      if (!res.ok) return
      const data = await res.json()
      if (!data?.points?.length) return

      // Remove old heatmap
      if (heatmapLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(heatmapLayerRef.current)
        heatmapLayerRef.current = null
      }

      const points: [number, number, number][] = data.points.map((p: any) =>
        [p.lat, p.lng, p.intensity || 0.5] as [number, number, number]
      )

      try {
        const heat = (L as any).heatLayer
        if (heat) {
          heatmapLayerRef.current = heat(points, {
            radius: 30, blur: 20, maxZoom: 17,
            gradient: { 0.2: '#2563eb', 0.4: '#10b981', 0.6: '#eab308', 0.8: '#f97316', 1.0: '#dc2626' },
          }).addTo(mapRef.current)
        }
      } catch {}
    } catch {}
  }, [])

  // Initial data fetch — after all useCallbacks are declared
  useEffect(() => {
    fetchRivers()
    fetchDistress()
    fetchEvacuation()
    fetchStations()
    fetchPredictions()
    fetchRiskLayer()
    fetchHeatmap()

    // Refresh live data every 5 minutes
    const interval = setInterval(() => {
      fetchRivers()
      fetchStations()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchRivers, fetchDistress, fetchEvacuation, fetchStations, fetchPredictions, fetchRiskLayer, fetchHeatmap])

  // Custom controls
  const zoomIn = () => mapRef.current?.zoomIn()
  const zoomOut = () => mapRef.current?.zoomOut()
  const resetView = () => mapRef.current?.setView(center, zoom, { animate: true })

  const refreshAll = useCallback(() => {
    fetchRivers()
    fetchDistress()
    fetchEvacuation()
    fetchStations()
    fetchPredictions()
    fetchRiskLayer()
    fetchHeatmap()
  }, [fetchRivers, fetchDistress, fetchEvacuation, fetchStations, fetchPredictions, fetchRiskLayer, fetchHeatmap])

  return (
    <div className={`relative ${className}${basemap !== 'satellite' ? ' map-dark-invert' : ''}`} style={{ height }}>
      {/* Map container */}
      <div ref={containerRef} className="w-full h-full" style={{ background: '#0f172a' }} />

      {/* Basemap switcher — top-right */}
      <div className="absolute top-3 right-3 z-10 flex gap-1 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 p-1">
        <button
          onClick={() => setBasemap('dark')}
          className={`p-1.5 rounded-md transition-all ${basemap === 'dark' ? 'bg-blue-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`}
          title={t('map.dark', lang)}
        >
          <MapIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setBasemap('satellite')}
          className={`p-1.5 rounded-md transition-all ${basemap === 'satellite' ? 'bg-blue-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`}
          title={t('map.satellite', lang)}
        >
          <Satellite className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setBasemap('terrain')}
          className={`p-1.5 rounded-md transition-all ${basemap === 'terrain' ? 'bg-blue-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`}
          title={t('map.terrain', lang)}
        >
          <Mountain className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Zoom controls — right side */}
      <div className="absolute right-3 top-14 z-10 flex flex-col gap-1 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 p-1">
        <button onClick={zoomIn} className="p-1.5 text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition" title={t('map.zoomIn', lang)}>
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={zoomOut} className="p-1.5 text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition" title={t('map.zoomOut', lang)}>
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <div className="h-px bg-gray-700/50" />
        <button onClick={resetView} className="p-1.5 text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition" title={t('map.resetView', lang)}>
          <Navigation className="w-3.5 h-3.5" />
        </button>
        <button onClick={refreshAll} className="p-1.5 text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition" title={t('map.refreshData', lang)}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <div className="h-px bg-gray-700/50" />
        <button onClick={() => setShowLayerPanel(p => !p)} className={`p-1.5 rounded-md transition ${showLayerPanel ? 'bg-blue-600 text-white' : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-gray-800'}`} title={t('map.toggleLayers', lang)}>
          <Layers className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Layer toggle panel */}
      {showLayerPanel && (
        <div className="absolute right-14 top-14 z-10 bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700/50 p-3 w-52 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-300 dark:text-gray-300 uppercase tracking-wide">{t('map.mapLayers', lang)}</span>
            <button
              onClick={() => {
                const allOn = Object.values(layers).every(Boolean)
                const val = !allOn
                setLayers({ reports: val, rivers: val, distress: val, stations: val, predictions: val, riskZones: val, heatmap: val, evacuation: val })
              }}
              className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold"
            >
              {Object.values(layers).every(Boolean) ? t('map.hideAll', lang) : t('map.showAll', lang)}
            </button>
          </div>
          <div className="space-y-1">
            {([
              { key: 'reports', label: t('map.layer.reports', lang), color: '#ef4444' },
              { key: 'rivers', label: t('map.layer.riverGauges', lang), color: '#3b82f6' },
              { key: 'stations', label: t('map.layer.sepaStations', lang), color: '#22c55e' },
              { key: 'predictions', label: t('map.layer.aiFlood', lang), color: '#a855f7' },
              { key: 'distress', label: t('map.layer.distressBeacons', lang), color: '#f97316' },
              { key: 'riskZones', label: t('map.layer.riskZones', lang), color: '#eab308' },
              { key: 'heatmap', label: t('map.layer.heatmap', lang), color: '#06b6d4' },
              { key: 'evacuation', label: t('map.layer.evacuation', lang), color: '#10b981' },
            ] as const).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setLayers(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition ${
                  layers[key as keyof typeof layers]
                    ? 'bg-gray-800/80 text-gray-200'
                    : 'bg-gray-800/30 text-gray-500 dark:text-gray-300'
                } hover:bg-gray-700/80`}
              >
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: layers[key as keyof typeof layers] ? color : '#4b5563' }} />
                <span className="flex-1 text-left truncate">{label}</span>
                {layers[key as keyof typeof layers]
                  ? <Eye className="w-3 h-3 text-gray-400 dark:text-gray-300 flex-shrink-0" />
                  : <EyeOff className="w-3 h-3 text-gray-600 flex-shrink-0" />
                }
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live status badge — bottom-left */}
      <div className="absolute bottom-3 left-3 z-10 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 px-3 py-1.5 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-semibold text-green-400">{t('map.live', lang)}</span>
        </div>
        <div className="h-3 w-px bg-gray-700" />
        <span className="text-[10px] text-gray-400 dark:text-gray-300">
          {markerCount.reports} {t('map.reports', lang)} — {markerCount.rivers + markerCount.stations} {t('map.stations', lang)} — {markerCount.predictions} {t('map.predictions', lang)} — {markerCount.distress} SOS
        </span>
      </div>
    </div>
  )
}

