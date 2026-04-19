/**
 * Module: routes.ts  (flood/routes.ts)
 *
 * Flood-specific supplementary routes mounted on top of the standard
 * BaseIncidentModule routes for the flood incident type.
 *
 * Currently registered routes:
 *   GET /gauges        — river gauge readings (stub — see TODO below)
 *   GET /flood-warnings — active EA/SEPA flood warnings (stub — see TODO below)
 *   GET /river-levels  — current river level readings (stub — see TODO below)
 *
 * NOTE: All three endpoints are implemented and call the active region adapter
 * (ScotlandAdapter / EnglandAdapter) via regionRegistry.getActiveRegion() to
 * fetch live data. The adapter layer was stabilised in v6.5; this file was
 * updated to call adapter.getRiverLevels() and adapter.getFloodWarnings()
 * directly rather than returning stub empty arrays.
 *
 * - Called from incidents/flood/service.ts (FloodModule.setupCustomRoutes)
 * - Depends on: RegionRegistry, RegionAdapter interface
 * - Will depend on: ScotlandAdapter.getFloodWarnings(), .getRiverLevels()
 */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupFloodRoutes(router: Router): void {
  // GET /gauges — river gauge readings from active region adapter
  router.get('/gauges', async (req: Request, res: Response) => {
    try {
      const regionId = String(req.query.region || process.env.REGION_ID || '')
      const adapter = regionId && regionRegistry.hasRegion(regionId)
        ? regionRegistry.getRegion(regionId)!
        : regionRegistry.getActiveRegion()
      const region = adapter.getMetadata().regionId
      const levels = await adapter.getRiverLevels()
      res.json({ incidentType: 'flood', region, gauges: levels, count: levels.length })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load river gauge data. The gauge service may be temporarily unavailable.' })
    }
  })

  // GET /flood-warnings — active flood warnings from EA/SEPA via region adapter
  router.get('/flood-warnings', async (req: Request, res: Response) => {
    try {
      const regionId = String(req.query.region || process.env.REGION_ID || '')
      const adapter = regionId && regionRegistry.hasRegion(regionId)
        ? regionRegistry.getRegion(regionId)!
        : regionRegistry.getActiveRegion()
      const region = adapter.getMetadata().regionId
      const warnings = await adapter.getFloodWarnings()
      res.json({ incidentType: 'flood', region, warnings, count: warnings.length })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load flood warnings. Please try again shortly.' })
    }
  })

  // GET /river-levels — current river level readings from region adapter
  router.get('/river-levels', async (req: Request, res: Response) => {
    try {
      const regionId = String(req.query.region || process.env.REGION_ID || '')
      const adapter = regionId && regionRegistry.hasRegion(regionId)
        ? regionRegistry.getRegion(regionId)!
        : regionRegistry.getActiveRegion()
      const region = adapter.getMetadata().regionId
      const riverLevels = await adapter.getRiverLevels()
      res.json({ incidentType: 'flood', region, riverLevels, count: riverLevels.length })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load river level data. Please try again shortly.' })
    }
  })
}

