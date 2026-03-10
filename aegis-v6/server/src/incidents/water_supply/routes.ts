/**
 * incidents/water_supply/routes.ts — Custom routes for water supply disruption incidents
 */

import { Router, Request, Response } from 'express'

export function setupWaterSupplyRoutes(router: Router): void {
  // GET /disruption-map — water supply disruption coverage map
  router.get('/disruption-map', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'water_supply',
        region,
        disruptionZones: [],
        message: 'Disruption mapping based on report clustering'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to generate disruption map', details: error.message })
    }
  })

  // GET /affected-count — estimated affected households
  router.get('/affected-count', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'water_supply',
        region,
        affectedHouseholds: 0,
        message: 'Count based on citizen reports'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to count affected households', details: error.message })
    }
  })

  // GET /water-quality — water quality alerts
  router.get('/water-quality', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
      res.json({
        incidentType: 'water_supply',
        region,
        qualityAlerts: [],
        message: 'Water quality monitoring'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch water quality', details: error.message })
    }
  })
}
