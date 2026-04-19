/**
 * Module: routes.ts
 *
 * Ground movement and landslides incident module (handles landslide specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupLandslideRoutes(router: Router): void {
  // GET /risk-zones — landslide risk zones
  router.get('/risk-zones', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'landslide',
        region,
        riskZones: [],
        message: 'Risk zone data pending'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load landslide risk zones. Please try again.' })
    }
  })

  // GET /soil-moisture — soil moisture levels
  router.get('/soil-moisture', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'landslide',
        region,
        soilMoisture: null,
        message: 'Soil moisture data pending'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load soil moisture data. Please try again shortly.' })
    }
  })

  // GET /rainfall-accumulation — recent rainfall accumulation
  router.get('/rainfall-accumulation', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const hours = parseInt(String(req.query.hours || '72'))
      res.json({
        incidentType: 'landslide',
        region,
        hours,
        accumulation: 0,
        message: 'Rainfall accumulation calculation pending'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not calculate rainfall accumulation. Please try again.' })
    }
  })
}

