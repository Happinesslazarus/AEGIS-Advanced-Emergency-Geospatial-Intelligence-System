/**
 * GeoJSON Loader for SEPA flood data
 * Supports: local GeoJSON files, SEPA WMS service, point-in-polygon checks
 * 
 * HOW TO USE WITH YOUR QGIS EXPORTS:
 * 1. Export flood zones from QGIS as GeoJSON (EPSG:4326)
 * 2. Place files in public/data/ folder
 * 3. They will auto-load on the map
 * 
 * File naming convention:
 *   flood_river_high.geojson
 *   flood_river_medium.geojson
 *   flood_river_low.geojson
 *   flood_coastal_high.geojson
 *   flood_surface_high.geojson
 *   scotland_councils.geojson
 *   scotland_rivers.geojson
 */

export interface FloodLayer {
  id: string
  name: string
  type: 'river' | 'coastal' | 'surface'
  probability: 'high' | 'medium' | 'low'
  color: string
  fillOpacity: number
  data: GeoJSON.FeatureCollection | null
  loaded: boolean
}

export const FLOOD_LAYERS: FloodLayer[] = [
  { id: 'river_high', name: 'River Flood — High (1:10)', type: 'river', probability: 'high', color: '#dc2626', fillOpacity: 0.4, data: null, loaded: false },
  { id: 'river_medium', name: 'River Flood — Medium (1:200)', type: 'river', probability: 'medium', color: '#f59e0b', fillOpacity: 0.3, data: null, loaded: false },
  { id: 'river_low', name: 'River Flood — Low (1:1000)', type: 'river', probability: 'low', color: '#3b82f6', fillOpacity: 0.2, data: null, loaded: false },
  { id: 'coastal_high', name: 'Coastal Flood — High', type: 'coastal', probability: 'high', color: '#7c3aed', fillOpacity: 0.35, data: null, loaded: false },
  { id: 'surface_high', name: 'Surface Water — High', type: 'surface', probability: 'high', color: '#0891b2', fillOpacity: 0.3, data: null, loaded: false },
]

export async function loadFloodLayer(layer: FloodLayer): Promise<FloodLayer> {
  const path = `/data/flood_${layer.id}.geojson`
  try {
    const res = await fetch(path)
    if (!res.ok) return { ...layer, loaded: false }
    const data = await res.json()
    return { ...layer, data, loaded: true }
  } catch {
    return { ...layer, loaded: false }
  }
}

export async function loadAllFloodLayers(): Promise<FloodLayer[]> {
  return Promise.all(FLOOD_LAYERS.map(loadFloodLayer))
}

/**
 * Check if a coordinate falls inside any flood polygon
 * Used by AI confidence scoring
 */
export function checkPointInFloodZone(
  lat: number, lng: number, layers: FloodLayer[]
): { inZone: boolean; zones: string[]; highestRisk: string | null } {
  const zones: string[] = []
  let highestRisk: string | null = null
  const riskOrder = { high: 3, medium: 2, low: 1 }

  for (const layer of layers) {
    if (!layer.data || !layer.loaded) continue
    for (const feature of layer.data.features) {
      if (pointInPolygon(lat, lng, feature.geometry)) {
        zones.push(layer.name)
        if (!highestRisk || (riskOrder[layer.probability] || 0) > (riskOrder[highestRisk as keyof typeof riskOrder] || 0)) {
          highestRisk = layer.probability
        }
      }
    }
  }

  return { inZone: zones.length > 0, zones, highestRisk }
}

/**
 * Ray-casting algorithm for point-in-polygon check
 */
function pointInPolygon(lat: number, lng: number, geometry: GeoJSON.Geometry): boolean {
  if (geometry.type === 'Polygon') {
    return pointInRing(lat, lng, geometry.coordinates[0])
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => pointInRing(lat, lng, poly[0]))
  }
  return false
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * SEPA WMS URL for direct Leaflet integration
 * This loads flood maps directly from SEPA servers without downloading
 */
export const SEPA_WMS = {
  url: 'https://map.sepa.org.uk/server/services/Open/Flood_Maps/MapServer/WMSServer',
  layers: {
    riverHigh: '0',
    riverMedium: '1',
    riverLow: '2',
    coastalHigh: '3',
    coastalMedium: '4',
    coastalLow: '5',
    surfaceHigh: '6',
    surfaceMedium: '7',
    surfaceLow: '8',
  },
  format: 'image/png',
  transparent: true,
  attribution: '&copy; SEPA 2025, Open Government Licence v3.0',
}

/**
 * Confidence boost when report location matches SEPA flood zone
 */
export function getFloodZoneConfidenceBoost(result: ReturnType<typeof checkPointInFloodZone>): number {
  if (!result.inZone) return 0
  switch (result.highestRisk) {
    case 'high': return 25 // Strong corroboration
    case 'medium': return 15
    case 'low': return 8
    default: return 5
  }
}
