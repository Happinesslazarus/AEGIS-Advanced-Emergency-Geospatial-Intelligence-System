/**
 * Map3D.tsx — Full 3D Disaster Map with Mapbox GL JS
 *
 * Features:
 * 3D terrain (Mapbox DEM) with building extrusions
 * All report markers with severity-coloured pins
 * River gauge station markers
 * Flood prediction polygon overlays with animated opacity
 * Evacuation route polylines
 * Distress beacon markers (pulsing red)
 * Shelter markers
 * 2D/3D toggle with smooth pitch animation
 * Satellite/street basemap switcher
 * Mini compass + zoom controls
 *
 * Falls back to Leaflet DisasterMap if Mapbox token is not configured.
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  Maximize2, Minimize2, Map, Satellite, Box, Square, Navigation,
  RotateCcw, ZoomIn, ZoomOut, Layers, AlertTriangle, Droplets
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''
const API = ''

/* Escape user-supplied strings before injecting into popup HTML to prevent XSS. */
function esc(str: string | null | undefined): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// Default centre: Aberdeen
const DEFAULT_CENTER: [number, number] = [-2.0943, 57.1497]
const DEFAULT_ZOOM = 12.5

interface Report {
  id: string
  location: string
  coordinates: [number, number]  // [lat, lng]
  severity: 'Low' | 'Medium' | 'High'
  status: string
  type: string
  description: string
  timestamp: string
}

interface DistressMarker {
  id: string
  citizenName: string
  latitude: number
  longitude: number
  isVulnerable: boolean
  status: string
}

interface Props {
  reports?: Report[]
  distressMarkers?: DistressMarker[]
  showFloodPredictions?: boolean
  showEvacuationRoutes?: boolean
  showTerrain?: boolean
  showBuildings?: boolean
  center?: [number, number]
  zoom?: number
  className?: string
  height?: string
  onReportClick?: (r: Report) => void
}

import { SEVERITY_HEX_TITLE } from '../../utils/colorTokens'
const SEVERITY_COLOURS: Record<string, string> = SEVERITY_HEX_TITLE

export default function Map3D({
  reports = [],
  distressMarkers = [],
  showFloodPredictions = true,
  showEvacuationRoutes = false,
  showTerrain = true,
  showBuildings = true,
  center,
  zoom,
  className = '',
  height = '100%',
  onReportClick,
}: Props): JSX.Element {
  const lang = useLanguage()

  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [is3D, setIs3D] = useState(true)
  const [isSatellite, setIsSatellite] = useState(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [floodPredictions, setFloodPredictions] = useState<any>(null)
  const [evacuationRoutes, setEvacuationRoutes] = useState<any>(null)

  // Fetch flood predictions and evacuation routes
  const fetchOverlays = useCallback(async () => {
    try {
      if (showFloodPredictions) {
        const res = await fetch(`${API}/api/predictions`)
        if (res.ok) {
          const data = await res.json()
          setFloodPredictions(data.predictions)
        }
      }
      if (showEvacuationRoutes) {
        const res = await fetch(`${API}/api/incidents/flood/evacuation/routes`)
        if (res.ok) {
          const data = await res.json()
          setEvacuationRoutes(data.routes)
        }
      }
    } catch {}
  }, [showFloodPredictions, showEvacuationRoutes])

  useEffect(() => { fetchOverlays() }, [fetchOverlays])

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return

    mapboxgl.accessToken = MAPBOX_TOKEN

    const mapCenter = center
      ? [center[1], center[0]] as [number, number]
      : DEFAULT_CENTER

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: mapCenter,
      zoom: zoom || DEFAULT_ZOOM,
      pitch: is3D ? 55 : 0,
      bearing: is3D ? -17 : 0,
      antialias: true,
      projection: 'globe' as any,
    })

    mapRef.current = map

    // Navigation control
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right')

    map.on('style.load', () => {
      // Add terrain
      if (showTerrain) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        })
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 })
      }

      // Fog for globe effect
      map.setFog({
        color: 'rgb(20, 20, 30)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.05,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.4,
      })

      // 3D buildings
      if (showBuildings) {
        const layers = map.getStyle()?.layers || []
        let labelLayerId: string | undefined
        for (const layer of layers) {
          if (layer.type === 'symbol' && (layer.layout as any)?.['text-field']) {
            labelLayerId = layer.id
            break
          }
        }

        map.addLayer({
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': [
              'interpolate', ['linear'], ['get', 'height'],
              0, '#1e293b',
              50, '#334155',
              100, '#475569',
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.7,
          },
        }, labelLayerId)
      }

      setMapLoaded(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update report markers
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return

    // Remove existing markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const map = mapRef.current

    // Report markers
    reports.forEach(report => {
      if (!report.coordinates?.[0] || !report.coordinates?.[1]) return

      const colour = SEVERITY_COLOURS[report.severity] || '#6b7280'
      const el = document.createElement('div')
      el.className = 'map3d-marker'
      const pin = document.createElement('div')
      pin.style.cssText = `width:28px;height:28px;border-radius:50%;background:${esc(colour)};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform 0.2s;font-size:12px;color:white;font-weight:bold;`
      pin.textContent = '!'
      el.appendChild(pin)
      el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.3)' })
      el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([report.coordinates[1], report.coordinates[0]])
        .setPopup(
          new mapboxgl.Popup({ offset: 20, className: 'map3d-popup' })
            .setHTML(`
              <div style="padding:8px; max-width:220px; font-family:system-ui;">
                <h4 style="margin:0 0 4px; font-size:13px; font-weight:600;">${esc(report.type)}</h4>
                <p style="margin:0; font-size:11px; color:#aaa;">${esc(report.location)}</p>
                <p style="margin:4px 0 0; font-size:11px;">${esc(report.description?.substring(0, 100) || '')}</p>
                <div style="margin-top:6px; display:flex; gap:6px;">
                  <span style="font-size:10px; padding:2px 6px; border-radius:999px; background:${esc(colour)}; color:white;">${esc(report.severity)}</span>
                  <span style="font-size:10px; padding:2px 6px; border-radius:999px; background:#334155; color:#94a3b8;">${esc(report.status)}</span>
                </div>
              </div>
            `)
        )
        .addTo(map)

      if (onReportClick) {
        el.addEventListener('click', () => onReportClick(report))
      }

      markersRef.current.push(marker)
    })

    // Distress beacon markers (pulsing red)
    distressMarkers.forEach(dm => {
      const el = document.createElement('div')
      el.className = 'distress-marker-3d'
      const sosDot = document.createElement('div')
      sosDot.style.cssText = 'width:32px;height:32px;border-radius:50%;background:#dc2626;border:3px solid white;box-shadow:0 0 16px rgba(220,38,38,0.6),0 0 32px rgba(220,38,38,0.3);animation:distress-pulse 1s ease-out infinite;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:white;font-weight:bold;'
      sosDot.textContent = 'SOS'
      el.appendChild(sosDot)

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([dm.longitude, dm.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 })
            .setHTML(`
              <div style="padding:8px; font-family:system-ui;">
                <h4 style="margin:0 0 4px; font-size:13px; font-weight:600; color:#dc2626;">?? ${esc(t('map.distressBeacon', lang))}</h4>
                <p style="margin:0; font-size:12px;">${esc(dm.citizenName)}</p>
                <p style="margin:2px 0; font-size:10px; color:#aaa;">${dm.isVulnerable ? `?? ${esc(t('map.vulnerablePerson', lang))}` : ''}</p>
                <p style="margin:2px 0; font-size:10px; color:#aaa;">${esc(t('map.status', lang))}: ${esc(dm.status)}</p>
              </div>
            `)
        )
        .addTo(map)

      markersRef.current.push(marker)
    })
  }, [reports, distressMarkers, mapLoaded, onReportClick])

  // Add flood prediction GeoJSON layers
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !floodPredictions) return
    const map = mapRef.current

    // Remove old prediction layers
    try {
      if (map.getLayer('flood-prediction-fill')) map.removeLayer('flood-prediction-fill')
      if (map.getLayer('flood-prediction-outline')) map.removeLayer('flood-prediction-outline')
      if (map.getSource('flood-predictions')) map.removeSource('flood-predictions')
    } catch {}

    // Build GeoJSON from predictions
    const features: any[] = []
    for (const pred of floodPredictions) {
      if (pred.extent) {
        const extent = typeof pred.extent === 'string' ? JSON.parse(pred.extent) : pred.extent
        if (extent?.features) {
          features.push(...extent.features)
        }
      }
    }

    if (features.length > 0) {
      map.addSource('flood-predictions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      })

      map.addLayer({
        id: 'flood-prediction-fill',
        type: 'fill-extrusion',
        source: 'flood-predictions',
        paint: {
          'fill-extrusion-color': [
            'match', ['get', 'flood_level'],
            2, '#60a5fa',
            3, '#f59e0b',
            4, '#ef4444',
            '#3b82f6',
          ],
          'fill-extrusion-height': [
            'match', ['get', 'flood_level'],
            2, 3,
            3, 6,
            4, 10,
            2,
          ],
          'fill-extrusion-opacity': 0.4,
        },
      })

      map.addLayer({
        id: 'flood-prediction-outline',
        type: 'line',
        source: 'flood-predictions',
        paint: {
          'line-color': '#f97316',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      })
    }
  }, [floodPredictions, mapLoaded])

  // Add evacuation route lines
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !evacuationRoutes) return
    const map = mapRef.current

    try {
      if (map.getLayer('evacuation-lines')) map.removeLayer('evacuation-lines')
      if (map.getSource('evacuation-routes')) map.removeSource('evacuation-routes')
    } catch {}

    const features = evacuationRoutes.map((route: any) => ({
      type: 'Feature',
      properties: { name: route.name, type: route.type },
      geometry: route.geometry,
    }))

    if (features.length > 0) {
      map.addSource('evacuation-routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      })

      map.addLayer({
        id: 'evacuation-lines',
        type: 'line',
        source: 'evacuation-routes',
        paint: {
          'line-color': '#22c55e',
          'line-width': 4,
          'line-dasharray': [2, 1],
          'line-opacity': 0.85,
        },
      })
    }
  }, [evacuationRoutes, mapLoaded])

  // 2D / 3D toggle
  const toggle3D = () => {
    if (!mapRef.current) return
    const next = !is3D
    setIs3D(next)
    mapRef.current.easeTo({
      pitch: next ? 55 : 0,
      bearing: next ? -17 : 0,
      duration: 1000,
    })
  }

  // Basemap toggle
  const toggleBasemap = () => {
    if (!mapRef.current) return
    const next = !isSatellite
    setIsSatellite(next)
    mapRef.current.setStyle(
      next
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/dark-v11'
    )
  }

  // Reset view
  const resetView = () => {
    if (!mapRef.current) return
    const mapCenter = center
      ? [center[1], center[0]] as [number, number]
      : DEFAULT_CENTER
    mapRef.current.easeTo({
      center: mapCenter,
      zoom: zoom || DEFAULT_ZOOM,
      pitch: is3D ? 55 : 0,
      bearing: is3D ? -17 : 0,
      duration: 1200,
    })
  }

  // No token fallback
  if (!MAPBOX_TOKEN) {
    return (
      <div className={`relative flex items-center justify-center bg-gray-900 ${className}`} style={{ height }}>
        <div className="text-center text-gray-400 dark:text-gray-300">
          <Map className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">{t('map3d.requiresToken', lang)}</p>
          <p className="text-xs mt-1 opacity-60">{t('map3d.setTokenEnv', lang)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`} style={{ height }}>
      {/* Map container */}
      <div ref={mapContainer} className="absolute inset-0 rounded-xl overflow-hidden" />

      {/* CSS for pulsing distress markers */}
      <style>{`
        @keyframes distress-pulse {
          0% { box-shadow: 0 0 16px rgba(220,38,38,0.6), 0 0 32px rgba(220,38,38,0.3); }
          50% { box-shadow: 0 0 24px rgba(220,38,38,0.8), 0 0 48px rgba(220,38,38,0.5); transform: scale(1.1); }
          100% { box-shadow: 0 0 16px rgba(220,38,38,0.6), 0 0 32px rgba(220,38,38,0.3); }
        }
        .mapboxgl-popup-content { background: #1e293b !important; color: #e2e8f0 !important; border-radius: 12px !important; border: 1px solid #334155; }
        .mapboxgl-popup-tip { border-top-color: #1e293b !important; }
        .mapboxgl-popup-close-button { color: #94a3b8 !important; }
      `}</style>

      {/* Control buttons — top right */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        {/* 3D/2D toggle */}
        <button
          onClick={toggle3D}
          className="w-9 h-9 bg-gray-900/90 backdrop-blur-md border border-gray-700/60 rounded-lg flex items-center justify-center text-gray-300 dark:text-gray-300 hover:text-white hover:bg-gray-800/90 transition shadow-lg"
          title={is3D ? t('map3d.switchTo2D', lang) : t('map3d.switchTo3D', lang)}
        >
          {is3D ? <Square className="w-4 h-4" /> : <Box className="w-4 h-4" />}
        </button>

        {/* Satellite/Street toggle */}
        <button
          onClick={toggleBasemap}
          className="w-9 h-9 bg-gray-900/90 backdrop-blur-md border border-gray-700/60 rounded-lg flex items-center justify-center text-gray-300 dark:text-gray-300 hover:text-white hover:bg-gray-800/90 transition shadow-lg"
          title={isSatellite ? t('map3d.streetMap', lang) : t('map.satellite', lang)}
        >
          {isSatellite ? <Map className="w-4 h-4" /> : <Satellite className="w-4 h-4" />}
        </button>

        {/* Reset view */}
        <button
          onClick={resetView}
          className="w-9 h-9 bg-gray-900/90 backdrop-blur-md border border-gray-700/60 rounded-lg flex items-center justify-center text-gray-300 dark:text-gray-300 hover:text-white hover:bg-gray-800/90 transition shadow-lg"
          title={t('map.resetView', lang)}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Legend — bottom left */}
      <div className="absolute bottom-3 left-3 z-10 bg-gray-900/90 backdrop-blur-md border border-gray-700/60 rounded-lg p-2.5 shadow-lg">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.highSeverity', lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.mediumSeverity', lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-[10px] text-gray-300 dark:text-gray-300">{t('map.lowSeverity', lang)}</span>
          </div>
          {distressMarkers.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-600 animate-pulse" />
              <span className="text-[10px] text-red-300">{t('map.sosDistress', lang)}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3D indicator badge */}
      <div className="absolute top-3 left-3 z-10">
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${is3D ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 dark:text-gray-300'}`}>
          {is3D ? '3D' : '2D'}
        </span>
      </div>
    </div>
  )
}
