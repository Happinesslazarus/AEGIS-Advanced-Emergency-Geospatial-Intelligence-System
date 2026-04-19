/**
 * Module: routes.ts
 *
 * Public safety incidents incident module (handles public safety specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupPublicSafetyRoutes(router: Router): void {
  // GET /incident-log — recent public safety incidents
  router.get('/incident-log', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const hours = parseInt(String(req.query.hours || '24'))
      res.json({
        incidentType: 'public_safety',
        region,
        hours,
        incidents: [],
        message: 'Incident log tracking'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load the public safety incident log. Please try again.' })
    }
  })

  // GET /hotspots — public safety hotspot areas
  router.get('/hotspots', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'public_safety',
        region,
        hotspots: [],
        message: 'Hotspot identification based on report clustering'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not identify incident hotspots. Please try again.' })
    }
  })

  // GET /emergency-resources — emergency resource deployment
  router.get('/emergency-resources', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'public_safety',
        region,
        resources: [],
        message: 'Emergency resource tracking'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load emergency resource locations. Please try again.' })
    }
  })
}

