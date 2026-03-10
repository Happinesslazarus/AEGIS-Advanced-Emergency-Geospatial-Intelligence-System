/**
 * incidents/heatwave/routes.ts — Custom routes for heatwave incidents
 */

import { Router, Request, Response } from 'express'

export function setupHeatwaveRoutes(router: Router): void {
  // GET /temperature-forecast — temperature forecast
  router.get('/temperature-forecast', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      const days = parseInt(String(req.query.days || '7'))
      res.json({
        incidentType: 'heatwave',
        region,
        days,
        forecast: [],
        message: 'Temperature forecast integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch temperature forecast', details: error.message })
    }
  })

  // GET /cooling-centers — cooling center locations
  router.get('/cooling-centers', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'heatwave',
        region,
        coolingCenters: [],
        message: 'Cooling centers data pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch cooling centers', details: error.message })
    }
  })

  // GET /heat-index — current heat index
  router.get('/heat-index', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'heatwave',
        region,
        heatIndex: null,
        message: 'Heat index calculation pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to calculate heat index', details: error.message })
    }
  })
}
