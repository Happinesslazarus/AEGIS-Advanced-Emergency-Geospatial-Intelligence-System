import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupPowerOutageRoutes(router: Router): void {
  //GET /outage-map -- power outage coverage map
  router.get('/outage-map', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'power_outage',
        region,
        outageZones: [],
        message: 'Outage mapping based on report clustering'
      })
  })

  //GET /affected-count -- estimated affected households
  router.get('/affected-count', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'power_outage',
        region,
        affectedHouseholds: 0,
        message: 'Count based on citizen reports'
      })
  })

  //GET /critical-facilities -- critical facilities affected
  router.get('/critical-facilities', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'power_outage',
        region,
        criticalFacilities: [],
        message: 'Critical facility monitoring'
      })
  })
}

