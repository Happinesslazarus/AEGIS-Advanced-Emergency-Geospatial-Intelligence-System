/**
 * incidents/landslide/routes.ts — Custom routes for landslide incidents
 */

import { Router, Request, Response } from 'express'

export function setupLandslideRoutes(router: Router): void {
  // GET /risk-zones — landslide risk zones
  router.get('/risk-zones', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'landslide',
        region,
        riskZones: [],
        message: 'Risk zone data pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch risk zones', details: error.message })
    }
  })

  // GET /soil-moisture — soil moisture levels
  router.get('/soil-moisture', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'landslide',
        region,
        soilMoisture: null,
        message: 'Soil moisture data pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch soil moisture', details: error.message })
    }
  })

  // GET /rainfall-accumulation — recent rainfall accumulation
  router.get('/rainfall-accumulation', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      const hours = parseInt(String(req.query.hours || '72'))
      res.json({
        incidentType: 'landslide',
        region,
        hours,
        accumulation: 0,
        message: 'Rainfall accumulation calculation pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to calculate rainfall', details: error.message })
    }
  })
}
