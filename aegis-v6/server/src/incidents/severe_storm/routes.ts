import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupSevereStormRoutes(router: Router): void {
  //GET /weather-forecast -- severe weather forecast
  router.get('/weather-forecast', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'severe_storm',
        region,
        forecast: [],
        message: 'Weather forecast integration pending'
      })
  })

  //GET /radar -- weather radar data
  router.get('/radar', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'severe_storm',
        region,
        radarData: null,
        message: 'Weather radar integration pending'
      })
  })

  //GET /wind-alerts -- high wind alerts
  router.get('/wind-alerts', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'severe_storm',
        region,
        windAlerts: [],
        message: 'Wind alerts integration pending'
      })
  })
}

