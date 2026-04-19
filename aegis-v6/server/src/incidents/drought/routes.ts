/**
 * Module: routes.ts
 *
 * Extended drought conditions incident module (handles drought specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { Router, type Request, type Response } from 'express'
import { DroughtService } from './service.js'
import { classifyDroughtSeverity } from './dataIngestion.js'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupDroughtRoutes(router: Router): void {

  // GET /drought-index
  router.get('/drought-index', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const data = await DroughtService.getDroughtIndex()
      const severity = classifyDroughtSeverity(data)
      res.json({
        incidentType: 'drought',
        region,
        droughtIndex: data.droughtIndexScore,
        severity,
        rainfall30dMm: data.rainfall30dMm,
        avgTempC: data.avgTempC,
        riverLevelNormal: data.riverLevelNormal,
        dataSource: data.dataSource,
        fetchedAt: data.fetchedAt,
      })
    } catch (err: any) {
      res.status(500).json({ error: 'Could not load drought index data. Please try again shortly.' })
    }
  })

  // GET /water-advisory
  router.get('/water-advisory', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const severity = await DroughtService.getDroughtSeverity(region)
      const advisory = DroughtService.getConservationAdvisory(severity)
      res.json({
        incidentType: 'drought',
        region,
        severity,
        advisory,
        generatedAt: new Date().toISOString(),
      })
    } catch (err: any) {
      res.status(500).json({ error: 'Could not generate water advisory. Please try again.' })
    }
  })

  // GET /precipitation — 30-day summary
  router.get('/precipitation', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      const data = await DroughtService.getDroughtIndex()
      res.json({
        incidentType: 'drought',
        region,
        rainfall30dMm: data.rainfall30dMm,
        normalMm: 100,
        deficitMm: Math.max(0, 100 - data.rainfall30dMm),
        avgTempC: data.avgTempC,
        fetchedAt: data.fetchedAt,
      })
    } catch (err: any) {
      res.status(500).json({ error: 'Could not load precipitation data. Please try again shortly.' })
    }
  })
}

