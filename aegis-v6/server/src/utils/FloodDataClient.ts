export interface RegionApiConfig {
  regionId: string
  jurisdiction: 'SEPA' | 'EA' | 'NRW' | 'NIEA'
  gaugeApiUrl: string
  alertApiUrl: string
  watchGeoJsonUrl: string
  warningGeoJsonUrl: string
  enabled: boolean
}

interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
}

interface Feature {
  type: 'Feature'
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] }
  properties?: Record<string, unknown>
}

export const REGION_APIS: Readonly<Record<string, RegionApiConfig>> = {
  scotland: {
    regionId: 'scotland',
    jurisdiction: 'SEPA',
    gaugeApiUrl: 'https://environment.data.gov.uk/flood-monitoring/id/stations',
    alertApiUrl: 'https://environment.data.gov.uk/flood-monitoring/id/floods',
    watchGeoJsonUrl: 'https://environment.data.gov.uk/flood-monitoring/id/floodAreas.geojson',
    warningGeoJsonUrl: 'https://environment.data.gov.uk/flood-monitoring/id/floodAreas.geojson',
    enabled: true,
  },
  england: {
    regionId: 'england',
    jurisdiction: 'EA',
    gaugeApiUrl: 'https://environment.data.gov.uk/flood-monitoring/id/stations',
    alertApiUrl: 'https://environment.data.gov.uk/flood-monitoring/id/floods',
    watchGeoJsonUrl: 'https://environment.data.gov.uk/flood-monitoring/id/floodAreas.geojson',
    warningGeoJsonUrl: 'https://environment.data.gov.uk/flood-monitoring/id/floodAreas.geojson',
    enabled: false,
  },
  wales: {
    regionId: 'wales',
    jurisdiction: 'NRW',
    gaugeApiUrl: 'https://environment.data.gov.uk/flood-monitoring/id/stations',
    alertApiUrl: 'https://flood-warning-information.service.gov.uk/api/1.0/floods',
    watchGeoJsonUrl: 'https://flood-warning-information.service.gov.uk/api/1.0/floods.geojson',
    warningGeoJsonUrl: 'https://flood-warning-information.service.gov.uk/api/1.0/floods.geojson',
    enabled: false,
  },
  northern_ireland: {
    regionId: 'northern_ireland',
    jurisdiction: 'NIEA',
    gaugeApiUrl: 'https://watermaps.shared.nisra.gov.uk',
    alertApiUrl: 'https://www.nidirect.gov.uk/articles/river-levels-and-flood-alerts',
    watchGeoJsonUrl: 'https://www.nidirect.gov.uk/articles/river-levels-and-flood-alerts',
    warningGeoJsonUrl: 'https://www.nidirect.gov.uk/articles/river-levels-and-flood-alerts',
    enabled: false,
  },
}

type CacheSource = 'live' | 'cached'

type GeoFeature = {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties?: Record<string, unknown>
}

type GeoFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

export class RegionDataCache {
  private store = new Map<string, { data: unknown; expiresAt: number; source: CacheSource; cachedAt: string }>()

  get<T>(key: string): { data: T; source: CacheSource; cachedAt: string } | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) return null
    return { data: entry.data as T, source: entry.source, cachedAt: entry.cachedAt }
  }

  getStale<T>(key: string): { data: T; source: CacheSource; cachedAt: string } | null {
    const entry = this.store.get(key)
    if (!entry) return null
    return { data: entry.data as T, source: 'cached', cachedAt: entry.cachedAt }
  }

  set<T>(key: string, data: T, ttlMs: number, source: CacheSource): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      source,
      cachedAt: new Date().toISOString(),
    })
  }

  isExpired(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return true
    return Date.now() > entry.expiresAt
  }

  invalidate(regionId: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(`:${regionId}:`)) this.store.delete(key)
    }
  }
}

export async function fetchWithRetry(url: string, opts?: RequestInit, retries = 3): Promise<Response> {
  let attempt = 0
  let delayMs = 300
  let lastError: Error | null = null

  while (attempt < retries) {
    try {
      const response = await fetch(url, opts)
      if (response.ok) return response
      if (response.status < 500) return response
      lastError = new Error(`HTTP ${response.status} for ${url}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown fetch error')
    }

    attempt += 1
    if (attempt >= retries) break
    const jitter = Math.floor(Math.random() * 120)
    await new Promise(resolve => setTimeout(resolve, delayMs + jitter))
    delayMs *= 2
  }

  throw lastError ?? new Error(`Failed request: ${url}`)
}

function emptyFeatureCollection(): GeoFeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function asFeatureCollection(data: unknown): GeoFeatureCollection {
  if (typeof data === 'object' && data !== null) {
    const candidate = data as { type?: unknown; features?: unknown }
    if (candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
      return candidate as GeoFeatureCollection
    }
  }
  return emptyFeatureCollection()
}

function toSeverity(value: string | undefined): 'normal' | 'elevated' | 'high' | 'critical' {
  const text = (value ?? '').toLowerCase()
  if (text.includes('critical') || text.includes('severe')) return 'critical'
  if (text.includes('high') || text.includes('warning')) return 'high'
  if (text.includes('elevated') || text.includes('watch')) return 'elevated'
  return 'normal'
}

export class FloodDataClient {
  private cache = new RegionDataCache()

  getEnabledRegions(): Array<{ id: string; name: string; jurisdiction: string; enabled: boolean }> {
    return Object.values(REGION_APIS).map(region => ({
      id: region.regionId,
      name: region.regionId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()),
      jurisdiction: region.jurisdiction,
      enabled: region.enabled,
    }))
  }

  resolveRegion(regionId?: string): RegionApiConfig {
    const enabled = Object.values(REGION_APIS).filter(r => r.enabled)
    const fallback = enabled[0] ?? REGION_APIS.scotland
    if (!regionId) return fallback
    return REGION_APIS[regionId] ?? fallback
  }

  async getFloodAreas(regionId?: string): Promise<GeoFeatureCollection> {
    const region = this.resolveRegion(regionId)
    const cacheKey = `areas:${region.regionId}:v1`
    const cached = this.cache.get<GeoFeatureCollection>(cacheKey)
    if (cached) return cached.data

    const [watchRes, warningRes] = await Promise.all([
      fetchWithRetry(region.watchGeoJsonUrl),
      fetchWithRetry(region.warningGeoJsonUrl),
    ])

    const watch = asFeatureCollection(await watchRes.json())
    const warning = asFeatureCollection(await warningRes.json())

    const watchFeatures = watch.features.map(feature => ({
      ...feature,
      properties: { ...(feature.properties ?? {}), severity: 'watch', jurisdiction: region.jurisdiction },
    }))
    const warningFeatures = warning.features.map(feature => ({
      ...feature,
      properties: { ...(feature.properties ?? {}), severity: 'warning', jurisdiction: region.jurisdiction },
    }))

    const merged: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [...warningFeatures, ...watchFeatures],
    }

    this.cache.set(cacheKey, merged, 5 * 60 * 1000, 'live')
    return merged
  }

  async getStations(regionId?: string, lat?: number, lng?: number, dist = 50): Promise<GeoFeatureCollection> {
    const region = this.resolveRegion(regionId)
    const cacheKey = `stations:${region.regionId}:${lat}:${lng}:${dist}:v1`
    const cached = this.cache.get<GeoFeatureCollection>(cacheKey)
    if (cached) return cached.data

    // If lat/lng provided, request nearby stations; otherwise get all
    let apiUrl = `${region.gaugeApiUrl}?parameter=level&_limit=500`
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      apiUrl = `${region.gaugeApiUrl}?parameter=level&lat=${lat}&long=${lng}&dist=${dist}&_limit=50`
    }
    const response = await fetchWithRetry(apiUrl)
    const payload = await response.json()
    const items: any[] = Array.isArray(payload) ? payload : payload?.items ?? []

    const features: GeoFeature[] = items
      .map((item: any) => {
        const lat = Number(item.lat ?? item.latitude)
        const lon = Number(item.long ?? item.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

        const level = Number(item.measures?.[0]?.latestReading?.value ?? 0)
        const typicalHigh = Number(item.stageScale?.typicalRangeHigh ?? item.measures?.[0]?.stageScale?.typicalRangeHigh ?? 0)
        const ratio = typicalHigh > 0 ? (level / typicalHigh) * 100 : 0
        const status = ratio >= 130 ? 'critical' : ratio >= 100 ? 'high' : ratio >= 80 ? 'elevated' : 'normal'

        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            station_id: String(item.stationReference ?? item.notation ?? item.id ?? ''),
            station_name: String(item.label ?? item.name ?? 'Unknown Station'),
            river_name: String(item.riverName ?? ''),
            station_latitude: lat,
            station_longitude: lon,
            level_m: level,
            typical_high_m: typicalHigh || null,
            percent_of_typical_high: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : 0,
            level_status: status,
            trend: 'steady',
            jurisdiction: region.jurisdiction,
          },
        } as GeoFeature
      })
      .filter((feature): feature is GeoFeature => feature !== null)

    const fc: GeoFeatureCollection = { type: 'FeatureCollection', features }
    this.cache.set(cacheKey, fc, 5 * 60 * 1000, 'live')
    return fc
  }

  async getStationReadings(stationId: string, regionId?: string, hours = 24): Promise<{ station: any; readings: any[]; bankfull_m: number | null }> {
    const region = this.resolveRegion(regionId)
    const readingsUrl = `https://environment.data.gov.uk/flood-monitoring/data/readings?stationReference=${encodeURIComponent(stationId)}&_sorted&_limit=100`

    const response = await fetchWithRetry(readingsUrl)
    const payload = await response.json()
    const items: any[] = Array.isArray(payload) ? payload : payload?.items ?? []

    const now = Date.now()
    const horizonMs = Math.max(1, hours) * 60 * 60 * 1000
    const readings = items
      .map(item => ({
        timestamp: item.dateTime ?? item.timestamp,
        level_m: Number(item.value ?? item.level ?? 0),
      }))
      .filter(reading => !!reading.timestamp)
      .filter(reading => now - new Date(reading.timestamp).getTime() <= horizonMs)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return {
      station: { station_id: stationId, jurisdiction: region.jurisdiction },
      readings,
      bankfull_m: null,
    }
  }

  async getActiveAlerts(regionId?: string): Promise<GeoFeatureCollection> {
    const region = this.resolveRegion(regionId)
    const cacheKey = `alerts:${region.regionId}:v1`
    const cached = this.cache.get<GeoFeatureCollection>(cacheKey)
    if (cached) return cached.data

    const response = await fetchWithRetry(region.alertApiUrl)
    const payload = await response.json()
    const features = asFeatureCollection(payload)

    this.cache.set(cacheKey, features, 5 * 60 * 1000, 'live')
    return features
  }

  async getRiskOverlay(regionId?: string): Promise<{
    region: string
    sepa_status: 'live' | 'cached' | 'unavailable'
    cached_at: string | null
    areas: GeoFeatureCollection
    stations: GeoFeatureCollection
    alerts: GeoFeatureCollection
    metadata: { jurisdiction: string; generated_at: string }
  }> {
    const region = this.resolveRegion(regionId)

    try {
      const [areas, stations, alerts] = await Promise.all([
        this.getFloodAreas(region.regionId),
        this.getStations(region.regionId),
        this.getActiveAlerts(region.regionId),
      ])

      return {
        region: region.regionId,
        sepa_status: 'live',
        cached_at: new Date().toISOString(),
        areas,
        stations,
        alerts,
        metadata: {
          jurisdiction: region.jurisdiction,
          generated_at: new Date().toISOString(),
        },
      }
    } catch {
      return {
        region: region.regionId,
        sepa_status: 'unavailable',
        cached_at: null,
        areas: emptyFeatureCollection(),
        stations: emptyFeatureCollection(),
        alerts: emptyFeatureCollection(),
        metadata: {
          jurisdiction: region.jurisdiction,
          generated_at: new Date().toISOString(),
        },
      }
    }
  }
}
