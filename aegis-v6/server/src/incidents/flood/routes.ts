/**
 * incidents/flood/routes.ts — Custom routes for flood incidents
 */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupFloodRoutes(router: Router): void {
  // GET /gauges — river gauge readings
  router.get('/gauges', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'flood',
        region,
        gauges: [],
        message: 'Gauge data integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch gauge data', details: error.message })
    }
  })

  // GET /flood-warnings — active flood warnings from EA
  router.get('/flood-warnings', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'flood',
        region,
        warnings: [],
        message: 'EA flood warnings integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch flood warnings', details: error.message })
    }
  })

  // GET /river-levels — current river levels
  router.get('/river-levels', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'flood',
        region,
        riverLevels: [],
        message: 'River level data integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch river levels', details: error.message })
    }
  })
}
