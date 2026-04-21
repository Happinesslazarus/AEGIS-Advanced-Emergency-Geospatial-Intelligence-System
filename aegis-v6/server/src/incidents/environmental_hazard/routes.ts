import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupEnvironmentalHazardRoutes(router: Router): void {
  //GET /air-quality -- current air quality readings
  router.get('/air-quality', async (req: Request, res: Response) => {
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
  })

  //GET /pollutant-levels -- detailed pollutant levels
  router.get('/pollutant-levels', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const pollutant = String(req.query.pollutant || 'pm25')
      res.json({
        incidentType: 'environmental_hazard',
        region,
        pollutant,
        levels: [],
        message: 'Pollutant monitoring integration pending'
      })
  })

  //GET /health-advisory -- health advisory based on air quality
  router.get('/health-advisory', async (req: Request, res: Response) => {
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
  })
}

