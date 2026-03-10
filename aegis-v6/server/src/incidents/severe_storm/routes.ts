/**
 * incidents/severe_storm/routes.ts — Custom routes for severe storm incidents
 */

import { Router, Request, Response } from 'express'

export function setupSevereStormRoutes(router: Router): void {
  // GET /weather-forecast — severe weather forecast
  router.get('/weather-forecast', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'severe_storm',
        region,
        forecast: [],
        message: 'Weather forecast integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch weather forecast', details: error.message })
    }
  })

  // GET /radar — weather radar data
  router.get('/radar', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'severe_storm',
        region,
        radarData: null,
        message: 'Weather radar integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch radar data', details: error.message })
    }
  })

  // GET /wind-alerts — high wind alerts
  router.get('/wind-alerts', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'severe_storm',
        region,
        windAlerts: [],
        message: 'Wind alerts integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch wind alerts', details: error.message })
    }
  })
}
