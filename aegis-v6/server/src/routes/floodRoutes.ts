 /*
 * routes/floodRoutes.ts — Flood prediction, evacuation, and threat API
 *   GET  /api/flood/prediction             — Current flood predictions
 *   POST /api/flood/prediction/refresh     — Force refresh predictions
 *   GET  /api/flood/threat                 — Current threat level assessment
 *   POST /api/flood/evacuation/route       — Calculate evacuation routes
 *   GET  /api/flood/evacuation/routes      — Pre-calculated evacuation routes
 *   POST /api/evacuation/route             — (legacy alias)
 *   GET  /api/evacuation/routes            — (legacy alias)
 *   GET  /api/flood/extents/:river         — Flood extent GeoJSON for a river
 *   GET  /api/incidents/:incidentType/prediction        — Per-incident predictions
 *   POST /api/incidents/:incidentType/prediction/refresh
 *   GET  /api/incidents/:incidentType/threat
 *   GET  /api/incidents/:incidentType/extents/:river
 *   POST /api/incidents/:incidentType/evacuation/route
 *   GET  /api/incidents/:incidentType/evacuation/routes
  */

import { Router, Request, Response, NextFunction } from 'express'
import { getFloodPredictions } from '../services/floodPredictionService.js'
import { calculateEvacuationRoutes, getOperationalEvacuationOverview } from '../services/evacuationService.js'
import { calculateThreatLevel } from '../services/threatLevelService.js'
import { getIncidentType } from '../config/incidentTypes.js'
import { getIncidentModule } from '../incidents/index.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import fs from 'fs'
import path from 'path'
import { AppError } from '../utils/AppError.js'
import { remember, buildCacheKey, CACHE_TTL } from '../services/cacheService.js'

const router = Router()

//  Allowlist for river name parameter (path traversal prevention)
const SAFE_RIVER_NAME = /^[a-z0-9_-]{1,64}$/i

function resolveIncidentType(req: Request): string {
  return String(req.params.incidentType || req.query.incidentType || req.body?.incidentType || 'flood').toLowerCase()
}

 /*
 * Validate incident type is known and enabled.
 * Unlike the old version, this does NOT block non-flood types — it delegates
 * to the incident module registry so all 11 hazard types work.
  */
function validateIncidentType(req: Request, res: Response): string | null {
  const incidentType = resolveIncidentType(req)
  const incidentConfig = getIncidentType(incidentType)

  if (!incidentConfig) {
    throw AppError.notFound(`Unknown incident type: ${incidentType}`)
  }

  if (!incidentConfig.enabled) {
    throw AppError.forbidden(`Incident type is disabled: ${incidentType}`)
  }

  return incidentType
}

// Flood Prediction (canonical flood path)

router.get('/flood/prediction', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const region = getActiveCityRegion()
    const key = buildCacheKey('flood', [region.id, 'predictions'])
    const { data: predictions, meta } = await remember(key, CACHE_TTL.FLOOD_PREDICTIONS, async () => {
      return getFloodPredictions()
    }, { staleOnError: true, provider: 'owm+openmeteo+ai' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json({ predictions, count: predictions.length })
  } catch (err) {
    next(err)
  }
})

 /*
 * GET /api/incidents/:incidentType/prediction
 * Delegates to flood service for 'flood' type; for all others delegates to the
 * incident module registry (wildfire, heatwave, drought, etc.).
  */
router.get('/incidents/:incidentType/prediction', async (req: Request, res: Response, next: NextFunction) => {
  const incidentType = validateIncidentType(req, res)
  if (!incidentType) return

  try {
    if (incidentType === 'flood') {
      const predictions = await getFloodPredictions()
      res.json({ predictions, count: predictions.length, incidentType })
      return
    }

    // Delegate to the registered incident module
    const mod = getIncidentModule(incidentType)
    if (!mod) {
      throw AppError.notFound(`No module registered for incident type: ${incidentType}`)
    }

    const region = getActiveCityRegion()
    const predictions = await mod.getPredictions(region.id)
    res.json({ predictions, count: predictions.length, incidentType })
  } catch (err) {
    next(err)
  }
})

router.post('/flood/prediction/refresh', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const predictions = await getFloodPredictions()
    res.json({ predictions, count: predictions.length, refreshed: true })
  } catch (err) {
    next(err)
  }
})

router.post('/incidents/:incidentType/prediction/refresh', async (req: Request, res: Response, next: NextFunction) => {
  const incidentType = validateIncidentType(req, res)
  if (!incidentType) return

  try {
    if (incidentType === 'flood') {
      const predictions = await getFloodPredictions()
      res.json({ predictions, count: predictions.length, refreshed: true, incidentType })
      return
    }

    const mod = getIncidentModule(incidentType)
    if (!mod) {
      throw AppError.notFound(`No module registered for: ${incidentType}`)
    }

    const region = getActiveCityRegion()
    const predictions = await mod.getPredictions(region.id)
    res.json({ predictions, count: predictions.length, refreshed: true, incidentType })
  } catch (err) {
    next(err)
  }
})

// Threat Level

router.get('/flood/threat', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const region = getActiveCityRegion()
    const key = buildCacheKey('flood', [region.id, 'threat'])
    const { data: assessment, meta } = await remember(key, CACHE_TTL.FLOOD_WARNINGS, async () => {
      return calculateThreatLevel()
    }, { staleOnError: true, provider: 'threat-calc' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(assessment)
  } catch (err) {
    next(err)
  }
})

router.get('/incidents/:incidentType/threat', async (req: Request, res: Response, next: NextFunction) => {
  const incidentType = validateIncidentType(req, res)
  if (!incidentType) return

  try {
    if (incidentType === 'flood') {
      const assessment = await calculateThreatLevel()
      res.json({ ...assessment, incidentType })
      return
    }

    const mod = getIncidentModule(incidentType)
    if (!mod) {
      throw AppError.notFound(`No module registered for: ${incidentType}`)
    }

    const region = getActiveCityRegion()
    const alerts = await mod.getAlerts(region.id)
    const maxSeverity = alerts.reduce((max: string, a: any) => {
      const rank: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 }
      return (rank[a.severity] ?? 0) > (rank[max] ?? 0) ? a.severity : max
    }, 'low')

    res.json({
      incidentType,
      level: maxSeverity,
      alertCount: alerts.length,
      assessedAt: new Date().toISOString(),
    })
  } catch (err) {
    next(err)
  }
})

// Flood Extents — SAFE file loading with allowlist validation

function loadExtentFile(riverParam: string, res: Response): boolean {
  // SECURITY: strict allowlist — prevents path traversal attacks
  if (!SAFE_RIVER_NAME.test(riverParam)) {
    throw AppError.badRequest('Invalid river name. Only alphanumeric characters, hyphens and underscores are allowed.')
  }

  const filename = `${riverParam}.geojson`
  const candidates = [
    path.join(process.cwd(), 'src', 'data', 'floodExtents', filename),
    path.resolve('src', 'data', 'floodExtents', filename),
    path.resolve('server', 'src', 'data', 'floodExtents', filename),
    path.resolve('aegis-v6', 'server', 'src', 'data', 'floodExtents', filename),
  ]

  for (const candidate of candidates) {
    // Resolve to absolute and ensure it stays within the expected directory
    const resolved = path.resolve(candidate)
    const expectedDir = path.resolve(path.dirname(candidate))
    if (!resolved.startsWith(expectedDir)) continue  // Prevent traversal even with allowlist bypass

    if (fs.existsSync(resolved)) {
      try {
        const raw = fs.readFileSync(resolved, 'utf-8')
        const geojson = JSON.parse(raw)
        res.json(geojson)
        return true
      } catch (parseErr) {
        res.status(500).json({ error: 'Flood extent data is malformed', river: riverParam })
        return false
      }
    }
  }

  return false  // Not found
}

router.get('/flood/extents/:river', (req: Request, res: Response) => {
  const found = loadExtentFile(req.params.river, res)
  if (!found && !res.headersSent) {
    res.status(404).json({ error: `Flood extent data not found for: ${req.params.river}` })
  }
})

router.get('/incidents/:incidentType/extents/:river', (req: Request, res: Response) => {
  const incidentType = validateIncidentType(req, res)
  if (!incidentType) return

  const riverParam = req.params.river
  if (!SAFE_RIVER_NAME.test(riverParam)) {
    throw AppError.badRequest('Invalid river name parameter.')
  }

  const filename = `${riverParam}.geojson`
  const candidates = [
    path.join(process.cwd(), 'src', 'data', 'floodExtents', filename),
    path.resolve('src', 'data', 'floodExtents', filename),
    path.resolve('server', 'src', 'data', 'floodExtents', filename),
    path.resolve('aegis-v6', 'server', 'src', 'data', 'floodExtents', filename),
  ]

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    const expectedDir = path.resolve(path.dirname(candidate))
    if (!resolved.startsWith(expectedDir)) continue

    if (fs.existsSync(resolved)) {
      try {
        const geojson = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
        res.json({ incidentType, river: riverParam, extent: geojson })
        return
      } catch {
        res.status(500).json({ error: 'Extent data is malformed', river: riverParam })
        return
      }
    }
  }

  res.status(404).json({ error: `Incident extent data not found for: ${riverParam}` })
})

// Evacuation — canonical paths under /flood/ prefix + legacy aliases

const evacuationPostHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      startLat,
      startLng,
      floodExtentGeoJSON,
      destinationType,
      optimizeFor,
      refreshWindowSeconds,
      liveClosures,
    } = req.body

    const parsedLat = parseFloat(startLat)
    const parsedLng = parseFloat(startLng)

    if (!startLat || !startLng) {
      throw AppError.badRequest('startLat and startLng are required')
    }
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      throw AppError.badRequest('startLat must be a valid latitude between -90 and 90')
    }
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      throw AppError.badRequest('startLng must be a valid longitude between -180 and 180')
    }

    const result = await calculateEvacuationRoutes(
      parsedLat,
      parsedLng,
      floodExtentGeoJSON,
      destinationType || 'both',
      {
        optimizeFor,
        refreshWindowSeconds,
        liveClosures,
      },
    )

    res.json(result)
  } catch (err) {
    next(err)
  }
}

const evacuationGetHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const destinationType = String(req.query.destinationType || 'both') as 'shelter' | 'high_ground' | 'both'
    const optimizeFor = String(req.query.optimizeFor || 'balanced') as 'fastest' | 'safest' | 'balanced'
    const refreshWindowSeconds = parseInt(String(req.query.refreshWindowSeconds || '30'), 10) || 30
    const result = await getOperationalEvacuationOverview(destinationType, {
      optimizeFor,
      refreshWindowSeconds,
    })
    res.json({
      ...result,
      count: result.routes.length,
      note: 'Operational evacuation corridors ranked against live nearby hazards',
    })
  } catch (err) {
    next(err)
  }
}

// Canonical paths
router.post('/flood/evacuation/route', evacuationPostHandler)
router.get('/flood/evacuation/routes', evacuationGetHandler)
router.post('/incidents/:incidentType/evacuation/route', async (req: Request, res: Response, next: NextFunction) => {
  if (!validateIncidentType(req, res)) return
  await evacuationPostHandler(req, res, next)
})
router.get('/incidents/:incidentType/evacuation/routes', async (req: Request, res: Response, next: NextFunction) => {
  if (!validateIncidentType(req, res)) return
  await evacuationGetHandler(req, res, next)
})

// Legacy aliases
router.post('/evacuation/route', evacuationPostHandler)
router.get('/evacuation/routes', evacuationGetHandler)

export default router
