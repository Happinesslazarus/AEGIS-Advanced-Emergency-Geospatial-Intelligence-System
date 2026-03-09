/**
 * IncidentMapLayers.tsx — Multi-incident map layer overlay
 *
 * Renders per-incident-type markers, circles, and geoJSON layers on the
 * Leaflet map. Works alongside the existing DisasterMap component.
 *
 * Uses the v1 incident API to fetch map data for all enabled incident types
 * and renders them with per-type colours, icons, and severity styling.
 */

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Marker, Popup, Circle, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useIncidents, type IncidentTypeId } from '../../contexts/IncidentContext'
import { apiGetAllIncidentMapData, type IncidentMapData, type IncidentMapMarker } from '../../utils/incidentApi'

// ─── Incident colour & icon config ──────────────────────────────────────
const INCIDENT_COLORS: Record<string, string> = {
  flood: '#2563EB',
  severe_storm: '#7C3AED',
  heatwave: '#DC2626',
  wildfire: '#F97316',
  landslide: '#92400E',
  power_outage: '#FBBF24',
  water_supply: '#06B6D4',
  infrastructure_damage: '#78716C',
  public_safety: '#EF4444',
  environmental_hazard: '#16A34A',
}

const INCIDENT_ICONS: Record<string, string> = {
  flood: '💧',
  severe_storm: '⛈️',
  heatwave: '🌡️',
  wildfire: '🔥',
  landslide: '⛰️',
  power_outage: '⚡',
  water_supply: '🚰',
  infrastructure_damage: '🏗️',
  public_safety: '🛡️',
  environmental_hazard: '☣️',
}

const SEVERITY_OPACITY: Record<string, number> = {
  critical: 0.9,
  high: 0.7,
  medium: 0.5,
  low: 0.3,
}

function createIncidentIcon(type: string, severity: string): L.DivIcon {
  const color = INCIDENT_COLORS[type] || '#6B7280'
  const emoji = INCIDENT_ICONS[type] || '⚠️'
  const borderWidth = severity === 'critical' ? 3 : 2
  const size = severity === 'critical' ? 36 : 30

  return L.divIcon({
    html: `<div style="
      background:${color};
      width:${size}px;height:${size}px;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      border:${borderWidth}px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      font-size:${size * 0.5}px;
      ${severity === 'critical' ? 'animation:pulse 1.5s infinite;' : ''}
    ">${emoji}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

// ─── Component ──────────────────────────────────────────────────────────
interface Props {
  /** Which incident types to show. Empty = all enabled */
  visibleTypes?: IncidentTypeId[]
  /** Region for filtering */
  region?: string
  /** Whether to show the layer control panel */
  showLayerControl?: boolean
  /** Refresh interval in ms (0 = no auto-refresh) */
  refreshInterval?: number
}

export default function IncidentMapLayers({
  visibleTypes = [],
  region,
  showLayerControl = false,
  refreshInterval = 60000,
}: Props): JSX.Element | null {
  const { operationalTypes } = useIncidents()
  const [mapDataByType, setMapDataByType] = useState<Record<string, IncidentMapData>>({})
  const [enabledLayers, setEnabledLayers] = useState<Set<string>>(new Set(operationalTypes))
  const [loading, setLoading] = useState(false)

  const typesToFetch = visibleTypes.length > 0 ? visibleTypes : operationalTypes

  const fetchMapData = useCallback(async () => {
    if (typesToFetch.length === 0) return
    setLoading(true)
    try {
      const data = await apiGetAllIncidentMapData(region)
      setMapDataByType(data.mapData || {})
    } catch (err) {
      console.error('[IncidentMapLayers] Failed to fetch map data:', err)
    } finally {
      setLoading(false)
    }
  }, [typesToFetch.length, region])

  useEffect(() => {
    fetchMapData()
    if (refreshInterval > 0) {
      const interval = setInterval(fetchMapData, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [fetchMapData, refreshInterval])

  const toggleLayer = useCallback((type: string) => {
    setEnabledLayers(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const visibleMarkers = useMemo(() => {
    const markers: IncidentMapMarker[] = []
    for (const [type, data] of Object.entries(mapDataByType)) {
      if (!enabledLayers.has(type)) continue
      markers.push(...(data.markers || []))
    }
    return markers
  }, [mapDataByType, enabledLayers])

  return (
    <>
      {/* Layer Control Panel */}
      {showLayerControl && (
        <div className="absolute top-2 right-2 z-[1000] bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 max-w-[200px]">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
            Incident Layers
          </h4>
          {typesToFetch.map(type => (
            <label key={type} className="flex items-center gap-2 text-sm cursor-pointer mb-1">
              <input
                type="checkbox"
                checked={enabledLayers.has(type)}
                onChange={() => toggleLayer(type)}
                className="rounded"
              />
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: INCIDENT_COLORS[type] }}
              />
              <span className="capitalize text-gray-700 dark:text-gray-300">
                {type.replace(/_/g, ' ')}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Incident Markers */}
      {visibleMarkers.map(marker => (
        <Marker
          key={marker.id}
          position={[marker.lat, marker.lng]}
          icon={createIncidentIcon(marker.incidentType, marker.severity)}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-bold text-base mb-1">{marker.title}</div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="px-2 py-0.5 rounded text-xs text-white font-medium"
                  style={{ backgroundColor: INCIDENT_COLORS[marker.incidentType] }}
                >
                  {marker.incidentType.replace(/_/g, ' ')}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  marker.severity === 'critical' ? 'bg-red-100 text-red-800' :
                  marker.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                  marker.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {marker.severity}
                </span>
              </div>
              <div className="text-gray-500 text-xs">
                {marker.source} • {new Date(marker.timestamp).toLocaleString()}
              </div>
              {marker.details && Object.keys(marker.details).length > 0 && (
                <div className="mt-1 text-xs text-gray-600">
                  {Object.entries(marker.details).slice(0, 4).map(([k, v]) => (
                    <div key={k}><strong>{k}:</strong> {String(v)}</div>
                  ))}
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {/* GeoJSON layers for each incident type */}
      {Object.entries(mapDataByType).map(([type, data]) => {
        if (!enabledLayers.has(type)) return null
        return (data.geojsonLayers || []).map((layer, i) => (
          <GeoJSON
            key={`${type}-${layer.name}-${i}`}
            data={layer.data}
            style={() => ({
              color: INCIDENT_COLORS[type] || '#6B7280',
              weight: 2,
              fillColor: INCIDENT_COLORS[type] || '#6B7280',
              fillOpacity: layer.type === 'heatmap' ? 0.4 : 0.2,
            })}
          />
        ))
      })}
    </>
  )
}

export { INCIDENT_COLORS, INCIDENT_ICONS }
