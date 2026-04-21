import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupWaterSupplyRoutes(router: Router): void {
  //GET /disruption-map -- water supply disruption coverage map
  router.get('/disruption-map', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'water_supply',
        region,
        disruptionZones: [],
        message: 'Disruption mapping based on report clustering'
      })
  })

  //GET /affected-count -- estimated affected households
  router.get('/affected-count', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'water_supply',
        region,
        affectedHouseholds: 0,
        message: 'Count based on citizen reports'
      })
  })

  //GET /water-quality -- water quality alerts
  router.get('/water-quality', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'water_supply',
        region,
        qualityAlerts: [],
        message: 'Water quality monitoring'
      })
  })
}

