/**
 * Severe weather and storm systems incident module (handles severe storm specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupSevereStormRoutes(router: Router): void {
  // GET /weather-forecast — severe weather forecast
  router.get('/weather-forecast', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'severe_storm',
        region,
        forecast: [],
        message: 'Weather forecast integration pending'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load the weather forecast. The weather service may be temporarily unavailable.' })
    }
  })

  // GET /radar — weather radar data
  router.get('/radar', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'severe_storm',
        region,
        radarData: null,
        message: 'Weather radar integration pending'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load radar data. Please try again shortly.' })
    }
  })

  // GET /wind-alerts — high wind alerts
  router.get('/wind-alerts', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'severe_storm',
        region,
        windAlerts: [],
        message: 'Wind alerts integration pending'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load wind alerts. Please try again.' })
    }
  })
}

