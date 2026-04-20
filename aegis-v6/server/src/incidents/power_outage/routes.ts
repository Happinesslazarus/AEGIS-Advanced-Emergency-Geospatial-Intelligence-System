/**
 * Electrical grid failures incident module (handles power outage specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupPowerOutageRoutes(router: Router): void {
  //GET /outage-map -- power outage coverage map
  router.get('/outage-map', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'power_outage',
        region,
        outageZones: [],
        message: 'Outage mapping based on report clustering'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load the power outage map. Please try again.' })
    }
  })

  //GET /affected-count -- estimated affected households
  router.get('/affected-count', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'power_outage',
        region,
        affectedHouseholds: 0,
        message: 'Count based on citizen reports'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not estimate affected households. Please try again.' })
    }
  })

  //GET /critical-facilities -- critical facilities affected
  router.get('/critical-facilities', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'power_outage',
        region,
        criticalFacilities: [],
        message: 'Critical facility monitoring'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load critical facility data. Please try again.' })
    }
  })
}

