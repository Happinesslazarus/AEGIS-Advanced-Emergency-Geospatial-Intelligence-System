/**
 * Module: routes.ts
 *
 * Water supply disruptions incident module (handles water supply specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for water supply events.
 */

import { Router, Request, Response } from 'express'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

export function setupWaterSupplyRoutes(router: Router): void {
  // GET /disruption-map — water supply disruption coverage map
  router.get('/disruption-map', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'water_supply',
        region,
        disruptionZones: [],
        message: 'Disruption mapping based on report clustering'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load the water supply disruption map. Please try again.' })
    }
  })

  // GET /affected-count — estimated affected households
  router.get('/affected-count', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'water_supply',
        region,
        affectedHouseholds: 0,
        message: 'Count based on citizen reports'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not estimate affected households. Please try again.' })
    }
  })

  // GET /water-quality — water quality alerts
  router.get('/water-quality', async (req: Request, res: Response) => {
    try {
      const region = String(req.query.region || process.env.REGION_ID || regionRegistry.getActiveRegion().getMetadata().regionId)
      res.json({
        incidentType: 'water_supply',
        region,
        qualityAlerts: [],
        message: 'Water quality monitoring'
      })
    } catch (err: unknown) {
      res.status(500).json({ error: 'Could not load water quality data. Please try again shortly.' })
    }
  })
}

