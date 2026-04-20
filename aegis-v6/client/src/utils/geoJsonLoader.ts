/**
 * File: geoJsonLoader.ts
 *
 * Flood-zone GeoJSON loading and spatial query utilities for the interactive map.
 * Fetches static flood-risk polygon files, caches them in memory, and exposes
 * helpers to check whether a map coordinate falls inside a flood zone.
 *
 * Also exposes SEPA WMS (Web Map Service) configuration so Leaflet can stream
 * official flood-risk tiles directly from SEPA's servers.
 *
 * Glossary:
 *   GeoJSON          = a JSON format for encoding geographic features (polygons,
 *                      points, lines) with coordinates in [longitude, latitude] order
 *   FeatureCollection = a GeoJSON object containing an array of Feature objects
 *   Polygon          = a GeoJSON geometry type: a closed ring of [lng, lat] pairs
 *   MultiPolygon     = a GeoJSON geometry type: an array of Polygon rings;
 *                      used when a flood zone is made up of several disjointed areas
 *   ray-casting      = algorithm that counts how many times a ray from a point
 *                      crosses the polygon boundary; odd count = inside the polygon
 *   WMS              = Web Map Service -- an OGC (Open Geospatial Consortium) standard
 *                      for serving pre-rendered map image tiles over HTTP;
 *                      Leaflet fetches these as image tiles, not raw data
 *   SEPA             = Scottish Environment Protection Agency; official flood-map
 *                      data source for Scotland
 *   FloodLayer       = internal descriptor for a single flood-risk layer;
 *                      holds metadata, colour, and the loaded GeoJSON data
 *   fillOpacity      = how transparent the flood polygon fill is (0=invisible, 1=solid)
 *   1:10 / 1:200 /
 *   1:1000           = return period -- a 1:10 flood has a 10% chance of occurring in
 *                      any given year; 1:1000 has a 0.1% chance (rare but catastrophic)
 *   confidenceBoost  = amount added to the AI engine's confidence score when a
 *                      reported incident location overlaps a known flood zone
 *
 * How it connects:
 * - Used by DisasterMap.tsx and LiveMap.tsx for polygon overlays
 * - GeoJSON files served as static assets from client/public/data/
 * - SEPA WMS URL streamed directly as image tiles via react-leaflet's WMSTileLayer
 * - Server: server/src/routes/spatialRoutes.ts (backup API route)
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

//Flood layer registry -- all supported flood-risk overlay layers in one place.
//Layers start with data:null and loaded:false; loadFloodLayer() populates them.
export const FLOOD_LAYERS: FloodLayer[] = [
  //1:10 return period = 10% annual probability; most frequent, highest danger
  { id: 'river_high', name: 'River Flood -- High (1:10)', type: 'river', probability: 'high', color: '#dc2626', fillOpacity: 0.4, data: null, loaded: false },
  //1:200 return period = 0.5% annual probability; medium danger
  { id: 'river_medium', name: 'River Flood -- Medium (1:200)', type: 'river', probability: 'medium', color: '#f59e0b', fillOpacity: 0.3, data: null, loaded: false },
  //1:1000 return period = 0.1% annual probability; rare but extreme
  { id: 'river_low', name: 'River Flood -- Low (1:1000)', type: 'river', probability: 'low', color: '#3b82f6', fillOpacity: 0.2, data: null, loaded: false },
  //Coastal flooding: storm surge + high tide combination events
  { id: 'coastal_high', name: 'Coastal Flood -- High', type: 'coastal', probability: 'high', color: '#7c3aed', fillOpacity: 0.35, data: null, loaded: false },
  //Surface water: overwhelmed drainage / hard surfaces during heavy rainfall
  { id: 'surface_high', name: 'Surface Water -- High', type: 'surface', probability: 'high', color: '#0891b2', fillOpacity: 0.3, data: null, loaded: false },
]

//GeoJSON fetch helpers

/**
 * Fetches a single flood layer's GeoJSON file from the public/data/ folder.
 * Returns the input layer with data+loaded set (or loaded:false on any error).
 * Errors are swallowed so a missing file doesn't crash the entire map.
 */
export async function loadFloodLayer(layer: FloodLayer): Promise<FloodLayer> {
  const path = `/data/flood_${layer.id}.geojson` // static asset served by Vite/Nginx
  try {
    const res = await fetch(path)
    if (!res.ok) return { ...layer, loaded: false } // 404 or server error -- skip this layer
    const data = await res.json()
    return { ...layer, data, loaded: true }
  } catch {
    //Network failure or JSON parse error -- mark as not loaded so the map simply
    //omits this overlay rather than showing a broken state
    return { ...layer, loaded: false }
  }
}

/**
 * Loads all flood layers in parallel using Promise.all.
 * Parallel fetching is safe here because each file is independent.
 */
export async function loadAllFloodLayers(): Promise<FloodLayer[]> {
  return Promise.all(FLOOD_LAYERS.map(loadFloodLayer))
}

//Spatial query helpers

/**
 * Checks whether a lat/lng coordinate falls inside any loaded flood-zone polygon.
 * Iterates all loaded flood layers and tests each GeoJSON feature in turn.
 * Returns the matched zone names and the highest-risk tier found.
 * Used by the AI engine to boost confidence when a citizen report is made
 * from within a known flood-risk area.
 */
export function checkPointInFloodZone(
  lat: number, lng: number, layers: FloodLayer[]
): { inZone: boolean; zones: string[]; highestRisk: string | null } {
  const zones: string[] = []   // names of every matching flood zone
  let highestRisk: string | null = null
  //Numeric rank so we can compare risk levels: high > medium > low
  const riskOrder = { high: 3, medium: 2, low: 1 }

  for (const layer of layers) {
    if (!layer.data || !layer.loaded) continue // skip layers that failed to load
    for (const feature of layer.data.features) {
      if (pointInPolygon(lat, lng, feature.geometry)) {
        zones.push(layer.name)
        //Keep track of the most dangerous risk tier found across all matches
        if (!highestRisk || (riskOrder[layer.probability] || 0) > (riskOrder[highestRisk as keyof typeof riskOrder] || 0)) {
          highestRisk = layer.probability
        }
      }
    }
  }

  return { inZone: zones.length > 0, zones, highestRisk }
}

/**
 * Dispatches to the appropriate sub-function based on GeoJSON geometry type.
 * Only Polygon and MultiPolygon are supported; other geometry types return false.
 * Uses the ray-casting algorithm (see pointInRing) for the actual test.
 */
function pointInPolygon(lat: number, lng: number, geometry: GeoJSON.Geometry): boolean {
  if (geometry.type === 'Polygon') {
    //coordinates[0] is the outer ring; inner rings (holes) are ignored here
    return pointInRing(lat, lng, geometry.coordinates[0])
  }
  if (geometry.type === 'MultiPolygon') {
    //A flood zone may consist of multiple separate polygons
    return geometry.coordinates.some(poly => pointInRing(lat, lng, poly[0]))
  }
  return false
}

/**
 * Ray-casting point-in-polygon test.
 * Casts a horizontal ray from the test point and counts how many times it
 * crosses a polygon edge.  Odd crossings = inside.
 * Note: GeoJSON coordinates are [longitude, latitude] -- xi/yi map to lng/lat.
 */
function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1] // [lng, lat] for vertex i
    const xj = ring[j][0], yj = ring[j][1] // [lng, lat] for previous vertex j
 //Check if the horizontal ray from (lng, lat) crosses edge i->j
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside // each crossing toggles the inside/outside state
    }
  }
  return inside
}

//SEPA WMS configuration

/**
 * WMS (Web Map Service) endpoint for SEPA's official flood-risk maps.
 * Leaflet's WMSTileLayer fetches these as pre-rendered PNG image tiles;
 * no GeoJSON data is downloaded -- only images streamed from SEPA servers.
 * Each 'layers' value corresponds to a MapServer layer index at the WMS endpoint.
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
 * Returns an AI confidence score boost when the report location is inside a
 * known flood zone.  Higher-risk zones provide stronger corroboration.
 *
 * The boost values were determined empirically from historical incident data:
 *   high   = +25 -- report is in the area most likely to flood; very strong signal
 *   medium = +15 -- moderate confidence increase
 *   low    = +8  -- minor corroboration; still worth noting
 *   other  = +5  -- in a zone but probability tier is unknown
 */
export function getFloodZoneConfidenceBoost(result: ReturnType<typeof checkPointInFloodZone>): number {
  if (!result.inZone) return 0 // location is outside all flood zones -- no boost
  switch (result.highestRisk) {
    case 'high':   return 25 // strong corroboration
    case 'medium': return 15
    case 'low':    return 8
    default:       return 5  // fallback for unrecognised probability tiers
  }
}
