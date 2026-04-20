/**
 * Shared Leaflet tile provider definitions used across all map components.
 * Import from here instead of defining tile URLs inline in each component.
 */

export interface TileProviderDef {
  name: string
  url: string
  attribution: string
  maxZoom?: number
}

/** Standard OSM street map */
export const OSM_TILE: TileProviderDef = {
  name: 'OpenStreetMap',
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}

/** Esri World Imagery (satellite) */
export const SATELLITE_TILE: TileProviderDef = {
  name: 'Satellite',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: '&copy; Esri, Maxar, Earthstar Geographics',
  maxZoom: 19,
}

/** OpenTopoMap (topographic) */
export const TOPO_TILE: TileProviderDef = {
  name: 'Topographic',
  url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  maxZoom: 17,
}

/** CartoDB Dark Matter (night mode map tiles) */
export const DARK_TILE: TileProviderDef = {
  name: 'Dark',
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 20,
}

/** All providers as an ordered array (street first) */
export const ALL_TILE_PROVIDERS: TileProviderDef[] = [OSM_TILE, TOPO_TILE, SATELLITE_TILE, DARK_TILE]

/** Named map for DisasterMap / LiveMap TILES object shape */
export const TILE_LAYERS = {
  osm: OSM_TILE,
  satellite: SATELLITE_TILE,
  topo: TOPO_TILE,
  dark: DARK_TILE,
} as const
