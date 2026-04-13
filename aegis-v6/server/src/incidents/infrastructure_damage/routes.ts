/**
 * Module: routes.ts
 *
 * Infrastructure damage assessment incident module (handles infrastructure damage specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for infrastructure damage events.
 */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupInfrastructureDamageRoutes(router: Router): void {
  // GET /damage-assessment — damage assessment summary
  router.get('/damage-assessment', async (req: Request, res: Response) => {
    try {
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
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not generate damage assessment. Please try again.' })
    }
  })

  // GET /closures — road and infrastructure closures
  router.get('/closures', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'infrastructure_damage',
        region,
        closures: [],
        message: 'Closure tracking'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load road and area closures. Please try again.' })
    }
  })

  // GET /critical-infrastructure — critical infrastructure status
  router.get('/critical-infrastructure', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'infrastructure_damage',
        region,
        criticalInfrastructure: [],
        message: 'Critical infrastructure monitoring'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load critical infrastructure data. Please try again.' })
    }
  })
}

