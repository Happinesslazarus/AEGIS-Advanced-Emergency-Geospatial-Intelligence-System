/**
 * routes/incidentRoutes.ts — Unified v1 incident API
 *
 * Dynamically mounts routes for all registered incident modules.
 *
 * Standard contract for every incident:
 *   GET  /api/v1/incidents/{type}/active
 *   GET  /api/v1/incidents/{type}/predictions
 *   POST /api/v1/incidents/{type}/report
 *   GET  /api/v1/incidents/{type}/history
 *   GET  /api/v1/incidents/{type}/alerts
 *   GET  /api/v1/incidents/{type}/map-data
 *
 * Cross-incident:
 *   GET  /api/v1/incidents/all/dashboard
 *   GET  /api/v1/incidents/registry
 */

import { Router, Request, Response } from 'express'
import {
  getAllIncidentModules,
  getAllIncidentRegistries,
  getIncidentModule,
  getOperationalModules,
  getDashboardSummary,
  listIncidentIds,
} from '../incidents/index.js'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-incident endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/incidents/registry — List all registered incident types with metadata
 */
router.get('/registry', (_req: Request, res: Response) => {
  const registries = getAllIncidentRegistries()
  res.json({
    incidents: registries,
    count: registries.length,
    operational: registries.filter(r => r.operationalStatus === 'fully_operational').length,
  })
})

/**
 * GET /api/v1/incidents/all/dashboard — Cross-incident dashboard summary
 */
router.get('/all/dashboard', async (req: Request, res: Response) => {
  try {
    const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
    const summary = await getDashboardSummary(region)
    res.json({ region, ...summary })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate dashboard summary', details: err.message })
  }
})

/**
 * GET /api/v1/incidents/all/predictions — All predictions across incident types
 */
router.get('/all/predictions', async (req: Request, res: Response) => {
  try {
    const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
    const modules = getOperationalModules()
    const allPredictions = await Promise.all(
      modules.map(async (mod) => {
        try {
          const predictions = await mod.getPredictions(region)
          return predictions
        } catch {
          return []
        }
      })
    )
    const flat = allPredictions.flat()
    res.json({ region, predictions: flat, count: flat.length })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch all predictions', details: err.message })
  }
})

/**
 * GET /api/v1/incidents/all/alerts — All alerts across incident types
 */
router.get('/all/alerts', async (req: Request, res: Response) => {
  try {
    const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
    const modules = getOperationalModules()
    const allAlerts = await Promise.all(
      modules.map(async (mod) => {
        try {
          return await mod.getAlerts(region)
        } catch {
          return []
        }
      })
    )
    const flat = allAlerts.flat()
    res.json({ region, alerts: flat, count: flat.length })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch all alerts', details: err.message })
  }
})

/**
 * GET /api/v1/incidents/all/map-data — Combined map data for all incidents
 */
router.get('/all/map-data', async (req: Request, res: Response) => {
  try {
    const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
    const modules = getOperationalModules()
    const allMapData = await Promise.all(
      modules.map(async (mod) => {
        try {
          const data = await mod.getMapData(region)
          return { incidentType: mod.id, ...data }
        } catch {
          return { incidentType: mod.id, markers: [] }
        }
      })
    )
    res.json({ region, layers: allMapData })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch map data', details: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Dynamic per-incident routing — mounts each module's router
// ═══════════════════════════════════════════════════════════════════════════════

// Mount each incident module's router at /api/v1/incidents/{incidentId}/
for (const mod of getAllIncidentModules()) {
  router.use(`/${mod.id}`, mod.router)
}

// Fallback: catch unknown incident types
router.all('/:incidentType/*', (req: Request, res: Response) => {
  const incidentType = req.params.incidentType
  if (incidentType === 'all') return // handled above

  const known = listIncidentIds()
  res.status(404).json({
    error: `Unknown incident type: ${incidentType}`,
    availableTypes: known,
  })
})

export default router
