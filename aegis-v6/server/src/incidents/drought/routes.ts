/**
 * incidents/drought/routes.ts — Custom routes for drought incidents
 *
 * Drought-specific extensions beyond the standard BaseIncidentModule routes:
 *   GET /drought-index   — current drought index score and severity
 *   GET /water-advisory  — conservation advisory for the region
 *   GET /precipitation   — 30-day precipitation summary
 */

import { Router, type Request, type Response } from 'express'
import { DroughtService } from './service.js'
import { classifyDroughtSeverity } from './dataIngestion.js'

export function setupDroughtRoutes(router: Router): void {

  // GET /drought-index
  router.get('/drought-index', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
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
      res.status(500).json({ error: 'Failed to fetch drought index', details: err.message })
    }
  })

  // GET /water-advisory
  router.get('/water-advisory', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
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
      res.status(500).json({ error: 'Failed to generate water advisory', details: err.message })
    }
  })

  // GET /precipitation — 30-day summary
  router.get('/precipitation', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || 'aberdeen_scotland_uk')
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
      res.status(500).json({ error: 'Failed to fetch precipitation data', details: err.message })
    }
  })
}
