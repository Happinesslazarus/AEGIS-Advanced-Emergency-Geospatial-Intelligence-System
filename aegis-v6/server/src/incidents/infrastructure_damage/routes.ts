import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupInfrastructureDamageRoutes(router: Router): void {
  //GET /damage-assessment -- damage assessment summary
  router.get('/damage-assessment', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'infrastructure_damage',
        region,
        assessment: {
          totalReports: 0,
          criticalDamage: 0,
          roadsAffected: 0,
          bridgesAffected: 0
        },
        message: 'Assessment based on citizen reports'
      })
  })

  //GET /closures -- road and infrastructure closures
  router.get('/closures', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'infrastructure_damage',
        region,
        closures: [],
        message: 'Closure tracking'
      })
  })

  //GET /critical-infrastructure -- critical infrastructure status
  router.get('/critical-infrastructure', async (req: Request, res: Response) => {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'infrastructure_damage',
        region,
        criticalInfrastructure: [],
        message: 'Critical infrastructure monitoring'
      })
  })
}

