/**
 * incidents/wildfire/routes.ts — Custom routes for wildfire incidents
 */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupWildfireRoutes(router: Router): void {
  // GET /hotspots — active fire hotspots from NASA FIRMS
  router.get('/hotspots', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'wildfire',
        region,
        hotspots: [],
        message: 'NASA FIRMS hotspot integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch fire hotspots', details: error.message })
    }
  })

  // GET /fire-risk — current fire risk assessment
  router.get('/fire-risk', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'wildfire',
        region,
        riskLevel: 'Low',
        factors: [],
        message: 'Fire risk assessment pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to assess fire risk', details: error.message })
    }
  })

  // GET /smoke-forecast — smoke dispersion forecast
  router.get('/smoke-forecast', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'wildfire',
        region,
        smokeForecast: null,
        message: 'Smoke forecast integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch smoke forecast', details: error.message })
    }
  })
}
