/**
 * incidents/environmental_hazard/routes.ts — Custom routes for environmental hazard incidents
 */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupEnvironmentalHazardRoutes(router: Router): void {
  // GET /air-quality — current air quality readings
  router.get('/air-quality', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'environmental_hazard',
        region,
        airQuality: {
          aqi: 0,
          pm25: 0,
          pm10: 0,
          o3: 0,
          no2: 0
        },
        message: 'OpenAQ air quality integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch air quality', details: error.message })
    }
  })

  // GET /pollutant-levels — detailed pollutant levels
  router.get('/pollutant-levels', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const pollutant = String(req.query.pollutant || 'pm25')
      res.json({
        incidentType: 'environmental_hazard',
        region,
        pollutant,
        levels: [],
        message: 'Pollutant monitoring integration pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to fetch pollutant levels', details: error.message })
    }
  })

  // GET /health-advisory — health advisory based on air quality
  router.get('/health-advisory', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'environmental_hazard',
        region,
        advisory: {
          level: 'Good',
          message: 'Air quality is satisfactory',
          recommendations: []
        },
        message: 'Health advisory generation pending'
      })
    } catch (err: unknown) {
      const error = err as Error
      res.status(500).json({ error: 'Failed to generate health advisory', details: error.message })
    }
  })
}
