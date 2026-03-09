/**
 * routes/floodRoutes.ts — Flood prediction, evacuation, and threat API
 *
 *   GET  /api/flood/prediction             — Current flood predictions
 *   POST /api/flood/prediction/refresh     — Force refresh predictions
 *   GET  /api/flood/threat                 — Current threat level assessment
 *   POST /api/flood/evacuation/route       — Calculate evacuation routes
 *   GET  /api/flood/evacuation/routes      — Pre-calculated evacuation routes
 *   POST /api/evacuation/route             — (legacy alias)
 *   GET  /api/evacuation/routes            — (legacy alias)
 *   GET  /api/flood/extents/:river         — Flood extent GeoJSON for a river
 */

import { Router, Request, Response } from 'express'
import { getFloodPredictions } from '../services/floodPredictionService.js'
import { calculateEvacuationRoutes, getPreCalculatedRoutes } from '../services/evacuationService.js'
import { calculateThreatLevel } from '../services/threatLevelService.js'
import { getIncidentType } from '../config/incidentTypes.js'
import fs from 'fs'
import path from 'path'

const router = Router()

function resolveIncidentType(req: Request): string {
  return String(req.params.incidentType || req.query.incidentType || req.body?.incidentType || 'flood').toLowerCase()
}

function requireSupportedIncident(req: Request, res: Response): boolean {
  const incidentType = resolveIncidentType(req)
  const incidentConfig = getIncidentType(incidentType)

  if (!incidentConfig) {
    res.status(404).json({ error: `Unknown incident type: ${incidentType}` })
    return false
  }

  if (!incidentConfig.enabled) {
    res.status(403).json({ error: `Incident type is disabled: ${incidentType}` })
    return false
  }

  if (incidentType !== 'flood') {
    res.status(501).json({
      error: `Incident type '${incidentType}' is configured but this endpoint currently supports flood runtime logic only.`,
      supportedIncidentTypes: ['flood'],
    })
    return false
  }

  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flood Prediction
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/flood/prediction', async (_req: Request, res: Response) => {
  try {
    const predictions = await getFloodPredictions()
    res.json({ predictions, count: predictions.length })
  } catch (err: any) {
    console.error('[Flood] Prediction failed:', err.message)
    res.status(500).json({ error: 'Failed to generate flood predictions', details: err.message })
  }
})

router.get('/incidents/:incidentType/prediction', async (req: Request, res: Response) => {
  if (!requireSupportedIncident(req, res)) return
  try {
    const predictions = await getFloodPredictions()
    res.json({ predictions, count: predictions.length, incidentType: resolveIncidentType(req) })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate incident predictions', details: err.message })
  }
})

router.post('/flood/prediction/refresh', async (_req: Request, res: Response) => {
  try {
    const predictions = await getFloodPredictions()
    res.json({ predictions, count: predictions.length, refreshed: true })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to refresh predictions', details: err.message })
  }
})

router.post('/incidents/:incidentType/prediction/refresh', async (req: Request, res: Response) => {
  if (!requireSupportedIncident(req, res)) return
  try {
    const predictions = await getFloodPredictions()
    res.json({ predictions, count: predictions.length, refreshed: true, incidentType: resolveIncidentType(req) })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to refresh incident predictions', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Threat Level
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/flood/threat', async (_req: Request, res: Response) => {
  try {
    const assessment = await calculateThreatLevel()
    res.json(assessment)
  } catch (err: any) {
    console.error('[Flood] Threat assessment failed:', err.message)
    res.status(500).json({ error: 'Failed to assess threat level', details: err.message })
  }
})

router.get('/incidents/:incidentType/threat', async (req: Request, res: Response) => {
  if (!requireSupportedIncident(req, res)) return
  try {
    const assessment = await calculateThreatLevel()
    res.json({ ...assessment, incidentType: resolveIncidentType(req) })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to assess incident threat level', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Flood Extents
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/flood/extents/:river', (req: Request, res: Response) => {
  try {
    const riverParam = req.params.river
    const filename = `${riverParam}.geojson`

    const candidates = [
      path.join(process.cwd(), 'src', 'data', 'floodExtents', filename),
      path.resolve('src', 'data', 'floodExtents', filename),
      path.resolve('server', 'src', 'data', 'floodExtents', filename),
      path.resolve('aegis-v6', 'server', 'src', 'data', 'floodExtents', filename),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const geojson = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
        res.json(geojson)
        return
      }
    }

    res.status(404).json({ error: `Flood extent data not found for: ${riverParam}` })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load flood extent', details: err.message })
  }
})

router.get('/incidents/:incidentType/extents/:river', (req: Request, res: Response) => {
  if (!requireSupportedIncident(req, res)) return
  try {
    const riverParam = req.params.river
    const filename = `${riverParam}.geojson`

    const candidates = [
      path.join(process.cwd(), 'src', 'data', 'floodExtents', filename),
      path.resolve('src', 'data', 'floodExtents', filename),
      path.resolve('server', 'src', 'data', 'floodExtents', filename),
      path.resolve('aegis-v6', 'server', 'src', 'data', 'floodExtents', filename),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const geojson = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
        res.json({ incidentType: resolveIncidentType(req), river: riverParam, extent: geojson })
        return
      }
    }

    res.status(404).json({ error: `Incident extent data not found for: ${riverParam}` })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load incident extent', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Evacuation — canonical paths under /flood/ prefix + legacy aliases
// ═══════════════════════════════════════════════════════════════════════════════

const evacuationPostHandler = async (req: Request, res: Response) => {
  try {
    const { startLat, startLng, floodExtentGeoJSON, destinationType } = req.body

    if (!startLat || !startLng) {
      res.status(400).json({ error: 'startLat and startLng are required' })
      return
    }

    const result = await calculateEvacuationRoutes(
      parseFloat(startLat),
      parseFloat(startLng),
      floodExtentGeoJSON,
      destinationType || 'both',
    )

    res.json(result)
  } catch (err: any) {
    console.error('[Evacuation] Route calculation failed:', err.message)
    res.status(500).json({ error: 'Failed to calculate evacuation routes', details: err.message })
  }
}

const evacuationGetHandler = (_req: Request, res: Response) => {
  const routes = getPreCalculatedRoutes()
  res.json({
    routes,
    count: routes.length,
    note: 'Pre-calculated evacuation corridors for the active region',
  })
}

const incidentEvacuationPostHandler = async (req: Request, res: Response) => {
  if (!requireSupportedIncident(req, res)) return
  await evacuationPostHandler(req, res)
}

const incidentEvacuationGetHandler = async (req: Request, res: Response) => {
  if (!requireSupportedIncident(req, res)) return
  evacuationGetHandler(req, res)
}

// Canonical paths (match client /api/flood/evacuation/*)
router.post('/flood/evacuation/route', evacuationPostHandler)
router.get('/flood/evacuation/routes', evacuationGetHandler)
router.post('/incidents/:incidentType/evacuation/route', incidentEvacuationPostHandler)
router.get('/incidents/:incidentType/evacuation/routes', incidentEvacuationGetHandler)

// Legacy aliases
router.post('/evacuation/route', evacuationPostHandler)
router.get('/evacuation/routes', evacuationGetHandler)

export default router
