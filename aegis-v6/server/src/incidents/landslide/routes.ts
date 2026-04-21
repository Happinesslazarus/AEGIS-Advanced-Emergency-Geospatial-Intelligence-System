import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupLandslideRoutes(router: Router): void {
  //GET /risk-zones -- landslide risk zones
  router.get('/risk-zones', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'landslide',
        region,
        riskZones: [],
        message: 'Risk zone data pending'
      })
  })

  //GET /soil-moisture -- soil moisture levels
  router.get('/soil-moisture', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'landslide',
        region,
        soilMoisture: null,
        message: 'Soil moisture data pending'
      })
  })

  //GET /rainfall-accumulation -- recent rainfall accumulation
  router.get('/rainfall-accumulation', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const hours = parseInt(String(req.query.hours || '72'))
      res.json({
        incidentType: 'landslide',
        region,
        hours,
        accumulation: 0,
        message: 'Rainfall accumulation calculation pending'
      })
  })
}

