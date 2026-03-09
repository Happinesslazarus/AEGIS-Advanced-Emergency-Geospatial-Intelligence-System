/**
 * incidents/flood/index.ts — Flood incident module (Tier 3: ML)
 *
 * Fully operational incident with ML prediction via the AI engine,
 * river gauge data ingestion, evacuation route calculation, and
 * real-time WMS map layers.
 */

import { Request, Response } from 'express'
import { BaseIncidentModule } from '../baseModule.js'
import { getFloodPredictions } from '../../services/floodPredictionService.js'
import { calculateEvacuationRoutes, getPreCalculatedRoutes } from '../../services/evacuationService.js'
import { calculateThreatLevel } from '../../services/threatLevelService.js'
import { getActiveCityRegion } from '../../config/regions/index.js'
import type { IncidentRegistryEntry, IncidentPrediction, IncidentMapData } from '../types.js'
import fs from 'fs'
import path from 'path'

class FloodModule extends BaseIncidentModule {
  id = 'flood'

  registry: IncidentRegistryEntry = {
    id: 'flood',
    name: 'Flood',
    category: 'natural_disaster',
    icon: 'droplets',
    color: '#2563EB',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['sepa_gauges', 'ea_flood_api', 'citizen_reports', 'weather_forecast'],
    aiEndpoint: '/api/predict',
    aiTier: 'ml',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'waterDepthCm', label: 'Estimated Water Depth (cm)', type: 'number', required: false },
      { key: 'waterSpeed', label: 'Water Speed', type: 'select', required: false, options: ['slow', 'moderate', 'fast'] },
      { key: 'blockedRoutes', label: 'Blocked Routes', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'river_gauges', 'rainfall_trend', 'threat_level'],
    alertThresholds: { advisory: 30, warning: 55, critical: 75 },
  }

  protected setupCustomRoutes(): void {
    // Flood-specific: threat level
    this.router.get('/threat', async (_req: Request, res: Response) => {
      try {
        const assessment = await calculateThreatLevel()
        res.json({ incidentType: 'flood', ...assessment })
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to assess flood threat', details: err.message })
      }
    })

    // Flood-specific: evacuation routes
    this.router.post('/evacuation/route', async (req: Request, res: Response) => {
      try {
        const { startLat, startLng, floodExtentGeoJSON, destinationType } = req.body
        if (!startLat || !startLng) {
          res.status(400).json({ error: 'startLat and startLng are required' })
          return
        }
        const result = await calculateEvacuationRoutes(
          parseFloat(startLat), parseFloat(startLng),
          floodExtentGeoJSON, destinationType || 'both'
        )
        res.json(result)
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to calculate evacuation routes', details: err.message })
      }
    })

    this.router.get('/evacuation/routes', (_req: Request, res: Response) => {
      const routes = getPreCalculatedRoutes()
      res.json({ routes, count: routes.length, note: 'Pre-calculated evacuation corridors' })
    })

    // Flood-specific: river extents GeoJSON
    this.router.get('/extents/:river', (req: Request, res: Response) => {
      try {
        const filename = `${req.params.river}.geojson`
        const candidates = [
          path.join(process.cwd(), 'src', 'data', 'floodExtents', filename),
          path.resolve('src', 'data', 'floodExtents', filename),
          path.resolve('server', 'src', 'data', 'floodExtents', filename),
        ]
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            res.json(JSON.parse(fs.readFileSync(c, 'utf-8')))
            return
          }
        }
        res.status(404).json({ error: `Flood extent data not found for: ${req.params.river}` })
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to load flood extent', details: err.message })
      }
    })
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      // Use the existing ML-powered flood prediction service
      const predictions = await getFloodPredictions()
      return predictions.map((p: any) => ({
        incidentType: 'flood',
        severity: p.severity || p.risk_level || 'Medium',
        probability: p.probability || p.confidence || 0.5,
        confidence: p.confidence || 0.7,
        confidenceSource: 'ml_model' as const,
        location: p.location,
        region,
        description: p.description || 'Flood prediction based on ML model analysis',
        advisoryText: p.advisory || this.getAdvisoryText(p.severity || 'Medium'),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['sepa_gauges', 'weather_forecast', 'ml_model'],
        modelVersion: p.model_version,
      }))
    } catch {
      // Fallback to rule-based if ML service is unavailable
      return this.ruleBasedPrediction(region)
    }
  }

  async getMapData(region: string): Promise<IncidentMapData> {
    const base = await super.getMapData(region)
    const regionConfig = getActiveCityRegion()

    // Add WMS layer references for flood visualization
    if (regionConfig.wmsLayers) {
      base.layers = regionConfig.wmsLayers.map(wms => ({
        type: 'FeatureCollection' as const,
        features: [],
        properties: {
          wmsUrl: wms.url,
          wmsLayers: wms.layers,
          wmsFormat: wms.format,
          name: wms.name,
        },
      })) as any
    }

    return base
  }

  async ingestData(region: string): Promise<{ recordsIngested: number; source: string }> {
    // Flood data ingestion handled by existing cronJobs (SEPA/EA feeds)
    return { recordsIngested: 0, source: 'sepa_ea_feeds' }
  }
}

export default new FloodModule()
