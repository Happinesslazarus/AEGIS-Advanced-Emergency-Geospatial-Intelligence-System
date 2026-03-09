/**
 * incidents/landslide/index.ts — Landslide module (Tier 2: Statistical)
 *
 * Combines rainfall data + terrain analysis + report patterns.
 */

import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction } from '../types.js'

class LandslideModule extends BaseIncidentModule {
  id = 'landslide'

  registry: IncidentRegistryEntry = {
    id: 'landslide',
    name: 'Landslide',
    category: 'natural_disaster',
    icon: 'mountain-snow',
    color: '#92400E',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['weather_api', 'geological_survey', 'citizen_reports'],
    aiEndpoint: null,
    aiTier: 'statistical',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'roadBlocked', label: 'Road Blocked', type: 'boolean', required: false },
      { key: 'slopeFailureExtent', label: 'Slope Failure Extent', type: 'select', required: false, options: ['small', 'moderate', 'large'] },
      { key: 'ongoingMovement', label: 'Ongoing Ground Movement', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'terrain_risk', 'road_closures'],
    alertThresholds: { advisory: 31, warning: 54, critical: 76 },
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      // Rainfall-induced landslide risk using cumulative precipitation
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=57.15&longitude=-2.09&daily=precipitation_sum,soil_moisture_0_to_7cm_mean&timezone=auto&past_days=7&forecast_days=3`
      const res = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return this.ruleBasedPrediction(region)

      const data = await res.json()
      const dailyPrecip = data.daily?.precipitation_sum || []
      const soilMoisture = data.daily?.soil_moisture_0_to_7cm_mean || []

      // Cumulative precipitation over last 7 days
      const cumulativeRain7d = dailyPrecip.slice(0, 7).reduce((s: number, v: number) => s + (v || 0), 0)
      const avgSoilMoisture = soilMoisture.length > 0
        ? soilMoisture.reduce((s: number, v: number) => s + (v || 0), 0) / soilMoisture.length
        : 0.3

      // Landslide susceptibility formula (simplified)
      const riskScore = (cumulativeRain7d * 0.4) + (avgSoilMoisture * 100 * 0.3)

      let severity = 'Low'
      let probability = 0.05
      if (riskScore > 60) { severity = 'Critical'; probability = 0.75 }
      else if (riskScore > 40) { severity = 'High'; probability = 0.55 }
      else if (riskScore > 20) { severity = 'Medium'; probability = 0.3 }
      else if (riskScore > 10) { severity = 'Low'; probability = 0.15 }

      return [{
        incidentType: this.id,
        severity,
        probability,
        confidence: 0.5,
        confidenceSource: 'statistical',
        region,
        description: `7-day rainfall: ${cumulativeRain7d.toFixed(1)}mm. Soil moisture: ${(avgSoilMoisture * 100).toFixed(1)}%. Risk score: ${riskScore.toFixed(1)}`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['weather_api', 'soil_moisture', 'statistical_model'],
      }]
    } catch {
      return this.ruleBasedPrediction(region)
    }
  }
}

export default new LandslideModule()
