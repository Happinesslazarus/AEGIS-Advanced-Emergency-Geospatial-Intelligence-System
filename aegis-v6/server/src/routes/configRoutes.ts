/**
 * Public configuration endpoints: active region, available regions,
 * enabled hazard modules, emergency shelters, and system health.
 * These are fetched by the frontend on initial load.
 *
 * - Mounted at /api/config in index.ts
 * - Reads from config/regions.ts and config/hazards.ts
 * - Most endpoints are public (no auth) for pre-login use
 * - Admin endpoints for updating configuration require auth
 *
 * GET /api/config/region   -- Active region config
 * GET /api/config/regions  -- All available regions
 * GET /api/config/hazards  -- Enabled hazard modules
 * GET /api/config/shelters -- Emergency shelter locations
 * */

import { Router, Request, Response, NextFunction } from 'express'
import { getActiveRegion, listRegionIds, REGIONS } from '../config/regions.js'
import { getEnabledHazards, HAZARD_MODULES } from '../config/hazards.js'
import { listIncidentTypes, upsertIncidentType } from '../config/incidentTypes.js'
import { getProviderStatus } from '../services/llmRouter.js'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { regionRegistry } from '../adapters/regions/RegionRegistry.js'
import pool from '../models/db.js'
import { AppError } from '../utils/AppError.js'

const router = Router()

/* GET /api/config/region -- Active region configuration */
router.get('/region', (_req: Request, res: Response) => {
  const region = getActiveRegion()
  //Augment with adapter metadata for richer frontend config
  try {
    const adapter = regionRegistry.getActiveRegion()
    const meta = adapter.getMetadata()
    const llmCtx = adapter.getLLMContext()
    res.json({
      ...region,
      adapter: {
        regionId: meta.regionId,
        name: meta.name,
        country: meta.country,
        countryCode: meta.countryCode,
        timezone: meta.timezone,
        centre: meta.centre,
        zoom: meta.zoom,
        bounds: meta.bounds,
        emergencyNumber: meta.emergencyNumber,
        floodAuthority: meta.floodAuthority,
        weatherAuthority: meta.weatherAuthority,
        languages: meta.languages,
        units: meta.units,
        emergencyContacts: adapter.getEmergencyContacts(),
        phoneFormat: {
          countryCode: adapter.getPhoneFormat().countryCode,
          dialCode: adapter.getPhoneFormat().dialCode,
          nationalFormat: adapter.getPhoneFormat().nationalFormat,
          example: adapter.getPhoneFormat().example,
        },
        floodZones: adapter.getFloodZones(),
        supportedHazardTypes: adapter.getSupportedHazardTypes(),
        monitoredCities: adapter.getMonitoredCities(),
        llmContext: {
          floodAuthority: llmCtx.floodAuthority,
          weatherAuthority: llmCtx.weatherAuthority,
          officialSourceAdvice: llmCtx.officialSourceAdvice,
          crisisResources: llmCtx.crisisResources,
        },
      },
    })
  } catch {
    //Adapter not available -- return legacy config only
    res.json(region)
  }
})

/* GET /api/config/regions -- All available regions (legacy + adapter-backed) */
router.get('/regions', (_req: Request, res: Response) => {
  //Legacy region configs
  const legacyRegions = listRegionIds().map((id) => ({
    id,
    name: REGIONS[id].name,
    country: REGIONS[id].country,
    center: REGIONS[id].center,
  }))

  //Adapter-backed regions with richer metadata
  const adapterRegions = regionRegistry.listRegions().map((id) => {
    const adapter = regionRegistry.getRegion(id)
    if (!adapter) return null
    const meta = adapter.getMetadata()
    return {
      id: meta.regionId,
      name: meta.name,
      country: meta.country,
      countryCode: meta.countryCode,
      centre: meta.centre,
      zoom: meta.zoom,
      emergencyNumber: meta.emergencyNumber,
    }
  }).filter(Boolean)

  const activeId = regionRegistry.getActiveRegion().regionId
  res.json({ regions: legacyRegions, adapterRegions, activeRegion: activeId })
})

/* GET /api/config/hazards -- All hazard modules with enabled status */
router.get('/hazards', (_req: Request, res: Response) => {
  res.json({
    hazards: Object.values(HAZARD_MODULES),
    enabled: getEnabledHazards().map((h) => h.type),
  })
})

/* GET /api/config/incidents -- Incident type definitions (schema, widgets, AI mapping, thresholds) */
router.get('/incidents', (_req: Request, res: Response) => {
  res.json({ incidents: listIncidentTypes() })
})

/* PUT /api/config/incidents/:incidentId -- Upsert incident type definition (admin only) */
router.put('/incidents/:incidentId', authMiddleware, requireRole('admin'), (req: Request, res: Response, next: NextFunction) => {
    const incidentId = String(req.params.incidentId || '').trim().toLowerCase()
    if (!incidentId) {
      throw AppError.badRequest('incidentId is required.')
    }

    const updated = upsertIncidentType(incidentId, req.body || {})
    res.json({ incident: updated })
})

/* GET /api/config/shelters -- Active emergency shelters */
router.get('/shelters', async (req: Request, res: Response, next: NextFunction) => {
    const lat = parseFloat(req.query.lat as string)
    const lng = parseFloat(req.query.lng as string)
    const radius = Math.min(parseFloat(req.query.radius as string) || 50, 200) * 1000

    let query: string
    let params: unknown[]

    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      query = `
        SELECT id, name, address, capacity, current_occupancy, shelter_type, amenities, phone,
               ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
               ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
        FROM shelters WHERE is_active = true
          AND ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
        ORDER BY distance_km LIMIT 20`
      params = [lng, lat, radius]
    } else {
      query = `
        SELECT id, name, address, capacity, current_occupancy, shelter_type, amenities, phone,
               ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng
        FROM shelters WHERE is_active = true
        ORDER BY name LIMIT 50`
      params = []
    }

    const { rows } = await pool.query(query, params)
    res.json({ shelters: rows })
})

/* -- Shelter OSM Cache ------------------------------------------------------
 *  Persistent PostgreSQL cache for Overpass API results.
 *  - Survives server restarts (unlike the old in-memory Map)
 *  - Stale-while-revalidate: serve old data immediately, refresh in background
 * - 4-tier: fresh cache -> Overpass proxy -> stale cache -> PostGIS shelters
 * --------------------------------------------------------------------------*/

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]
const CACHE_FRESH_TTL_H  = 6   // serve from cache without refresh
const CACHE_STALE_TTL_H  = 12  // serve stale + background refresh
const CACHE_DB_INTERVAL  = `${CACHE_FRESH_TTL_H * 2} hours` // Postgres interval for expires_at

let cacheTableReady = false
async function ensureCacheTable(): Promise<void> {
  if (cacheTableReady) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shelter_osm_cache (
      cache_key    TEXT PRIMARY KEY,
      shelters     JSONB        NOT NULL DEFAULT '[]',
      element_count INT         NOT NULL DEFAULT 0,
      source       TEXT         NOT NULL DEFAULT 'overpass',
      expires_at   TIMESTAMPTZ  NOT NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_shelter_osm_cache_expires ON shelter_osm_cache (expires_at)`)
  cacheTableReady = true
}

function cacheKey(lat: number, lng: number, radius: number,
  bbox?: { south: number; north: number; west: number; east: number }): string {
  const r2 = (n: number) => Math.round(n * 100) / 100
  if (bbox) {
    return `b_${r2(bbox.south)}_${r2(bbox.north)}_${r2(bbox.west)}_${r2(bbox.east)}`
  }
  //Bucket radius: 5k / 15k / 50k / 100k
  const rb = radius <= 7500 ? 5000 : radius <= 30000 ? 15000 : radius <= 75000 ? 50000 : 100000
  return `r_${r2(lat)}_${r2(lng)}_${rb}`
}

interface NormalizedShelter {
  id: string; name: string
  type: 'shelter' | 'hospital' | 'fire_station' | 'community_centre' | 'school'
  lat: number; lng: number; address: string; phone?: string
  capacity: number; occupancy: number; amenities: string[]; isOpen: boolean
}

function parseOsmElements(elements: any[]): NormalizedShelter[] {
  const seen = new Set<string>()
  const result: NormalizedShelter[] = []
  for (let i = 0; i < Math.min(elements.length, 40); i++) {
    const el = elements[i]
    const elLat = Number(el.lat ?? el.center?.lat)
    const elLng = Number(el.lon ?? el.center?.lon)
    if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) continue
    const tags = el.tags || {}
    const amenity: string = tags.amenity || tags.social_facility || ''
    let type: NormalizedShelter['type'] = 'shelter'
    if (amenity === 'hospital')              type = 'hospital'
    else if (amenity === 'fire_station')     type = 'fire_station'
    else if (amenity === 'community_centre') type = 'community_centre'
    else if (amenity === 'school')           type = 'school'
    const name: string = tags.name || tags['name:en'] || type || 'Safe Zone'
    const address = [tags['addr:housenumber'], tags['addr:street'],
      tags['addr:city'] || tags['addr:town'] || tags['addr:village']]
      .filter(Boolean).join(', ') || `${elLat.toFixed(4)}, ${elLng.toFixed(4)}`
    const dk = `${name.toLowerCase().trim()}|${Math.round(elLat*10000)}|${Math.round(elLng*10000)}`
    if (seen.has(dk)) continue
    seen.add(dk)
    result.push({
      id: `osm-${el.id ?? i}`, name, type, lat: elLat, lng: elLng, address,
      phone: tags.phone || tags['contact:phone'] || undefined,
      capacity: parseInt(tags.capacity || '0', 10) || (type === 'hospital' ? 200 : 100),
      occupancy: 0,
      amenities: [
        ...(type === 'hospital' ? ['medical', 'food'] : []),
        ...(tags.internet_access === 'wlan' || tags.internet_access === 'yes' ? ['wifi'] : []),
        ...(type === 'shelter' || type === 'community_centre' ? ['beds', 'food'] : []),
      ],
      isOpen: tags.opening_hours !== 'closed',
    })
  }
  return result
}

/** Race all Overpass mirrors server-side -- no CORS, no browser timeouts */
async function fetchOverpassRaw(query: string): Promise<any[] | null> {
  const controllers: AbortController[] = []
  const promises = OVERPASS_MIRRORS.map(async (endpoint) => {
    const ctrl = new AbortController()
    controllers.push(ctrl)
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      controllers.forEach(c => { try { c.abort() } catch {} })
      return data.elements || []
    } catch (err) { clearTimeout(timer); throw err }
  })
  try { return await Promise.any(promises) } catch { return null }
}

function buildRadiusOQL(lat: number, lng: number, r: number): string {
  const types = ['hospital','fire_station','community_centre','shelter','school']
  return `[out:json][timeout:20];(
${types.map(t=>`    node["amenity"="${t}"](around:${r},${lat},${lng});`).join('\n')}
    node["social_facility"="shelter"](around:${r},${lat},${lng});
${['hospital','fire_station','community_centre'].map(t=>`    way["amenity"="${t}"](around:${r},${lat},${lng});`).join('\n')}
  );out center body 40;`
}

function buildBboxOQL(s: number, n: number, w: number, e: number): string {
  const types = ['hospital','fire_station','community_centre','shelter','school']
  return `[out:json][timeout:20];(
${types.map(t=>`    node["amenity"="${t}"](${s},${w},${n},${e});`).join('\n')}
    node["social_facility"="shelter"](${s},${w},${n},${e});
${['hospital','fire_station','community_centre'].map(t=>`    way["amenity"="${t}"](${s},${w},${n},${e});`).join('\n')}
  );out center body 40;`
}

/** Write to cache. Fire-and-forget -- non-fatal if it fails */
async function writeCacheRow(key: string, shelters: NormalizedShelter[]): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO shelter_osm_cache (cache_key, shelters, element_count, source, expires_at)
      VALUES ($1, $2::jsonb, $3, 'overpass', NOW() + INTERVAL '${CACHE_DB_INTERVAL}')
      ON CONFLICT (cache_key) DO UPDATE
        SET shelters = EXCLUDED.shelters, element_count = EXCLUDED.element_count,
            source = 'overpass', expires_at = EXCLUDED.expires_at, created_at = NOW()
    `, [key, JSON.stringify(shelters), shelters.length])
  } catch { /* non-fatal */ }
}

/**
 * GET /api/config/shelters/near
 *
 * The canonical shelter endpoint. The browser NEVER calls Overpass directly.
 * Query params:
 *   lat, lng        -- required (point centre)
 *   radius          -- metres, default 5000, max 100000
 *   south,north,west,east -- optional bbox override (for area-level searches)
 *
 * Tiers:
 *   1. PostgreSQL fresh cache  (< CACHE_FRESH_TTL_H hours old)
 * 2. Overpass API proxy (server -> mirrors, stored in cache)
 *   3. PostgreSQL stale cache  (> CACHE_FRESH_TTL_H but data exists)
 *   4. PostGIS shelters table  (our own database)
 */
router.get('/shelters/near', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat    = parseFloat(req.query.lat    as string)
    const lng    = parseFloat(req.query.lng    as string)
    const radius = Math.min(Math.max(parseInt(req.query.radius as string, 10) || 5000, 1000), 100_000)
    const south  = parseFloat(req.query.south  as string)
    const north  = parseFloat(req.query.north  as string)
    const west   = parseFloat(req.query.west   as string)
    const east   = parseFloat(req.query.east   as string)
    const isBbox = [south, north, west, east].every(Number.isFinite)

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'Valid lat/lng required', shelters: [] }); return
    }

    await ensureCacheTable()

    const key = isBbox
      ? cacheKey(lat, lng, radius, { south, north, west, east })
      : cacheKey(lat, lng, radius)

    //Tier 1: Fresh PostgreSQL cache
    const cacheRes = await pool.query<{ shelters: NormalizedShelter[]; source: string; age_h: number }>(`
      SELECT shelters, source,
             EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_h
      FROM shelter_osm_cache WHERE cache_key = $1
    `, [key])

    if (cacheRes.rows.length > 0) {
      const row = cacheRes.rows[0]
      if (row.age_h < CACHE_FRESH_TTL_H) {
        res.json({ shelters: row.shelters, source: `${row.source}_cache`, radius, cached: true, cacheAgeH: Math.round(row.age_h * 10) / 10 })
        return
      }
      //Stale but available -- serve immediately then refresh in background
      if (row.age_h < CACHE_STALE_TTL_H) {
        res.json({ shelters: row.shelters, source: 'stale_cache', radius, cached: true, stale: true, cacheAgeH: Math.round(row.age_h * 10) / 10 })
        //Background refresh -- don't await
        const oql = isBbox ? buildBboxOQL(south, north, west, east) : buildRadiusOQL(lat, lng, radius)
        fetchOverpassRaw(oql).then(els => { if (els) writeCacheRow(key, parseOsmElements(els)) }).catch(() => {})
        return
      }
    }

    //Tier 2: Fetch fresh from Overpass (server-side, no CORS)
    const oql = isBbox ? buildBboxOQL(south, north, west, east) : buildRadiusOQL(lat, lng, radius)
    const elements = await fetchOverpassRaw(oql)
    if (elements) {
      const shelters = parseOsmElements(elements)
      writeCacheRow(key, shelters) // non-blocking write
      res.json({ shelters, source: 'overpass', radius, cached: false }); return
    }

    //Tier 3: Stale cache (even if very old -- better than nothing)
    if (cacheRes.rows.length > 0) {
      const row = cacheRes.rows[0]
      res.json({ shelters: row.shelters, source: 'stale_cache', radius, cached: true, stale: true, cacheAgeH: Math.round(row.age_h * 10) / 10 })
      return
    }

    //Tier 4: Our own PostGIS shelters database
    const { rows: dbRows } = await pool.query(`
      SELECT id, name, address, capacity, current_occupancy, shelter_type, amenities, phone,
             ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lng
      FROM shelters WHERE is_active = true
        AND ST_DWithin(coordinates::geography,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
      ORDER BY ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
      LIMIT 20
    `, [lng, lat, radius])

    if (dbRows.length > 0) {
      const shelters: NormalizedShelter[] = dbRows.map(r => ({
        id: `db-${r.id}`, name: r.name || 'Safe Zone',
        type: (r.shelter_type || 'shelter') as NormalizedShelter['type'],
        lat: Number(r.lat), lng: Number(r.lng),
        address: r.address || `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}`,
        phone: r.phone || undefined,
        capacity: r.capacity || 100, occupancy: r.current_occupancy || 0,
        amenities: Array.isArray(r.amenities) ? r.amenities : [], isOpen: true,
      }))
      res.json({ shelters, source: 'postgis', radius, cached: false }); return
    }

    //Nothing available at all -- return graceful empty so client shows "no shelters" not an error
    res.json({ shelters: [], source: 'none', radius, cached: false })
  } catch (err) { next(err) }
})

/* GET /api/config/shelters/overpass -- Legacy proxy (kept for backwards compat) */
router.get('/shelters/overpass', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = parseFloat(req.query.lat as string)
    const lng = parseFloat(req.query.lng as string)
    const radius = Math.min(Math.max(parseInt(req.query.radius as string, 10) || 5000, 1000), 100_000)
    const south = parseFloat(req.query.south as string)
    const north = parseFloat(req.query.north as string)
    const west  = parseFloat(req.query.west  as string)
    const east  = parseFloat(req.query.east  as string)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { res.status(400).json({ error: 'Valid lat/lng required', elements: [] }); return }
    const oql = [south,north,west,east].every(Number.isFinite)
      ? buildBboxOQL(south, north, west, east)
      : buildRadiusOQL(lat, lng, radius)
    const elements = await fetchOverpassRaw(oql)
    if (!elements) { res.status(502).json({ error: 'All Overpass mirrors unavailable', elements: [] }); return }
    res.json({ elements })
  } catch (err) { next(err) }
})

/* GET /api/config/health -- Extended health check with service status */
router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  const checks: Record<string, string> = {}

  //Database
  try {
    await pool.query('SELECT 1')
    checks.database = 'connected'
  } catch {
    checks.database = 'disconnected'
  }

  //LLM providers
  const llmStatus = getProviderStatus()
  checks.llm_providers = llmStatus.length > 0 ? `${llmStatus.length} configured` : 'none configured'

  //SMTP
  checks.email = process.env.SMTP_USER ? 'configured' : 'not configured'
  checks.sms = process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not configured'
  checks.telegram = process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'
  checks.web_push = process.env.VAPID_PUBLIC_KEY ? 'configured' : 'not configured'

  const allOk = checks.database === 'connected'
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    version: '6.9.0',
    region: getActiveRegion().name,
    timestamp: new Date().toISOString(),
    services: checks,
  })
})

export default router

