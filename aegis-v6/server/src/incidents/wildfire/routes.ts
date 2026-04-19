/**
 * Module: routes.ts
 *
 * Wildfire and bushfire events incident module (handles wildfire specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

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
      res.status(500).json({ error: 'Could not load fire hotspot data. Please try again.' })
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
      res.status(500).json({ error: 'Could not assess fire risk at this time. Please try again.' })
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
      res.status(500).json({ error: 'Could not load smoke and air quality forecast. Please try again.' })
    }
  })
}

