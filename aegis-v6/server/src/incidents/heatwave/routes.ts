import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupHeatwaveRoutes(router: Router): void {
  //GET /temperature-forecast -- temperature forecast
  router.get('/temperature-forecast', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const days = parseInt(String(req.query.days || '7'))
      res.json({
        incidentType: 'heatwave',
        region,
        days,
        forecast: [],
        message: 'Temperature forecast integration pending'
      })
  })

  //GET /cooling-centers -- cooling center locations
  router.get('/cooling-centers', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'heatwave',
        region,
        coolingCenters: [],
        message: 'Cooling centers data pending'
      })
  })

  //GET /heat-index -- current heat index
  router.get('/heat-index', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'heatwave',
        region,
        heatIndex: null,
        message: 'Heat index calculation pending'
      })
  })
}

