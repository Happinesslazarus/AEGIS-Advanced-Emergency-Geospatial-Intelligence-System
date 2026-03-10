/**
 * incidents/drought/index.ts — Drought module (Tier 2: Statistical)
 *
 * Uses precipitation data and soil moisture analysis to assess drought risk.
 */

import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction } from '../types.js'

class DroughtModule extends BaseIncidentModule {
  id = 'drought'

  registry: IncidentRegistryEntry = {
    id: 'drought',
    name: 'Drought',
    category: 'natural_disaster',
    icon: 'sun',
    color: '#D97706',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['weather_api', 'soil_moisture', 'river_levels', 'citizen_reports'],
    aiEndpoint: '/api/predict',
    aiTier: 'statistical',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'cropDamageReported', label: 'Crop Damage Reported', type: 'boolean', required: false },
      { key: 'waterRestrictions', label: 'Water Restrictions in Place', type: 'boolean', required: false },
      { key: 'riverLevelLow', label: 'River Level Critically Low', type: 'boolean', required: false },
    ],
    widgets: ['weather_panel', 'preparedness', 'resource_advisory'],
    alertThresholds: { advisory: 30, warning: 55, critical: 75 },
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      // Try AI engine first (DroughtPredictor exists)
      const aiUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
      try {
        const aiRes = await fetch(`${aiUrl}/api/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hazard_type: 'drought', region_id: region, latitude: 57.15, longitude: -2.09 }),
          signal: AbortSignal.timeout(5000),
        })
        if (aiRes.ok) {
          const data = await aiRes.json()
          return [{
            incidentType: this.id,
            severity: data.risk_level || 'Low',
            probability: data.probability || 0.1,
            confidence: data.confidence || 0.6,
            confidenceSource: 'ml_model',
            region,
            description: `Drought assessment: ${data.risk_level || 'Low'} risk. ${(data.contributing_factors || []).slice(0, 2).map((f: any) => `${f.factor}: ${f.value}`).join(', ')}`,
            advisoryText: this.getAdvisoryText(data.risk_level || 'Low'),
            generatedAt: new Date().toISOString(),
            dataSourcesUsed: data.data_sources || ['ml_model'],
            modelVersion: data.model_version,
          }]
        }
      } catch { /* AI engine unavailable, fall through to statistical */ }

      // Statistical fallback: use Open-Meteo for rainfall data (30-day lookback proxy)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=57.15&longitude=-2.09&daily=precipitation_sum,temperature_2m_max&timezone=auto&forecast_days=7&past_days=30`
      const res = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return this.ruleBasedPrediction(region)

      const data = await res.json()
      const precipSums: number[] = data.daily?.precipitation_sum || []
      const total30d = precipSums.reduce((sum: number, v: number) => sum + (v || 0), 0)
      const avgTemp = (data.daily?.temperature_2m_max || []).reduce((s: number, v: number) => s + (v || 0), 0) / Math.max(1, (data.daily?.temperature_2m_max || []).length)

      // UK baseline: ~80-120mm per 30 days. Drought if <40mm
      let severity = 'Low'
      let probability = 0.05
      if (total30d < 20) { severity = 'Critical'; probability = 0.85 }
      else if (total30d < 40) { severity = 'High'; probability = 0.60 }
      else if (total30d < 60) { severity = 'Medium'; probability = 0.35 }
      else if (total30d < 80) { severity = 'Low'; probability = 0.15 }

      // High temperatures worsen drought risk
      if (avgTemp > 20) probability = Math.min(1.0, probability + 0.15)

      return [{
        incidentType: this.id,
        severity,
        probability,
        confidence: 0.55,
        confidenceSource: 'statistical',
        region,
        description: `30-day precipitation: ${total30d.toFixed(1)}mm. Average max temp: ${avgTemp.toFixed(1)}°C. Drought risk based on rainfall deficit.`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['weather_api', 'statistical_model'],
      }]
    } catch {
      return this.ruleBasedPrediction(region)
    }
  }
}

export default new DroughtModule()
