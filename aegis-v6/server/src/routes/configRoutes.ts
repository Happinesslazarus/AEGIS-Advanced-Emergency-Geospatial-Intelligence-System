/**
 * routes/configRoutes.ts — Region, hazard, and system configuration API
 *
 * Exposes configuration data to the frontend so it doesn't need to
 * hardcode region-specific details like map centres or flood authorities.
 *
 *   GET /api/config/region      — Active region config
 *   GET /api/config/regions     — All available regions
 *   GET /api/config/hazards     — All hazard module configs
 *   GET /api/config/shelters    — Emergency shelter locations
 *   GET /api/config/health      — Extended health check
 */

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

/* GET /api/config/region — Active region configuration */
router.get('/region', (_req: Request, res: Response) => {
  const region = getActiveRegion()
  // Augment with adapter metadata for richer frontend config
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
    // Adapter not available — return legacy config only
    res.json(region)
  }
})

/* GET /api/config/regions — All available regions (legacy + adapter-backed) */
router.get('/regions', (_req: Request, res: Response) => {
  // Legacy region configs
  const legacyRegions = listRegionIds().map((id) => ({
    id,
    name: REGIONS[id].name,
    country: REGIONS[id].country,
    center: REGIONS[id].center,
  }))

  // Adapter-backed regions with richer metadata
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

/* GET /api/config/hazards — All hazard modules with enabled status */
router.get('/hazards', (_req: Request, res: Response) => {
  res.json({
    hazards: Object.values(HAZARD_MODULES),
    enabled: getEnabledHazards().map((h) => h.type),
  })
})

/* GET /api/config/incidents — Incident type definitions (schema, widgets, AI mapping, thresholds) */
router.get('/incidents', (_req: Request, res: Response) => {
  res.json({ incidents: listIncidentTypes() })
})

/* PUT /api/config/incidents/:incidentId — Upsert incident type definition (admin only) */
router.put('/incidents/:incidentId', authMiddleware, requireRole('admin'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const incidentId = String(req.params.incidentId || '').trim().toLowerCase()
    if (!incidentId) {
      throw AppError.badRequest('incidentId is required.')
    }

    const updated = upsertIncidentType(incidentId, req.body || {})
    res.json({ incident: updated })
  } catch (err) {
    next(err)
  }
})

/* GET /api/config/shelters — Active emergency shelters */
router.get('/shelters', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = parseFloat(req.query.lat as string)
    const lng = parseFloat(req.query.lng as string)
    const radius = Math.min(parseFloat(req.query.radius as string) || 50, 200) * 1000

    let query: string
    let params: unknown[]

    if (!isNaN(lat) && !isNaN(lng)) {
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
  } catch (err) {
    next(err)
  }
})

/* GET /api/config/health — Extended health check with service status */
router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  const checks: Record<string, string> = {}

  // Database
  try {
    await pool.query('SELECT 1')
    checks.database = 'connected'
  } catch {
    checks.database = 'disconnected'
  }

  // LLM providers
  const llmStatus = getProviderStatus()
  checks.llm_providers = llmStatus.length > 0 ? `${llmStatus.length} configured` : 'none configured'

  // SMTP
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
