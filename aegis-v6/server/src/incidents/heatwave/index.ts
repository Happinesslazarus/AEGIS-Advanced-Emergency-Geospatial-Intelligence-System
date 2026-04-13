/**
 * Module: index.ts
 *
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * How it connects:
 * - Part of the incident module system, registered via incidents/registry.ts
 *
 * Simple explanation:
 * Manages detection, assessment, and response for heatwave events.
 */

import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction } from '../types.js'

class HeatwaveModule extends BaseIncidentModule {
  id = 'heatwave'

  registry: IncidentRegistryEntry = {
    id: 'heatwave',
    name: 'Heatwave',
    category: 'natural_disaster',
    icon: 'thermometer-sun',
    color: '#DC2626',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['weather_api', 'met_office', 'citizen_reports', 'health_data'],
    aiEndpoint: '/api/predict',
    aiTier: 'statistical',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'temperatureC', label: 'Observed Temperature (—C)', type: 'number', required: false },
      { key: 'vulnerablePeopleAffected', label: 'Vulnerable People Affected', type: 'boolean', required: false },
      { key: 'waterAccessIssues', label: 'Water Access Issues', type: 'boolean', required: false },
    ],
    widgets: ['weather_panel', 'preparedness', 'health_advisory'],
    alertThresholds: { advisory: 35, warning: 58, critical: 78 },
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      // Try AI engine first (heatwave model exists)
      const aiUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
      try {
        const aiRes = await fetch(`${aiUrl}/api/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hazard_type: 'heatwave', region_id: region }),
          signal: AbortSignal.timeout(5000),
        })
        if (aiRes.ok) {
          const data = await aiRes.json()
          return [{
            incidentType: this.id,
            severity: data.risk_level || 'Low',
            probability: data.probability || 0.3,
            confidence: data.confidence || 0.6,
            confidenceSource: 'ml_model',
            region,
            description: data.description || 'Heatwave prediction from ML model',
            advisoryText: this.getAdvisoryText(data.risk_level || 'Low'),
            generatedAt: new Date().toISOString(),
            dataSourcesUsed: ['ml_model', 'weather_data'],
            modelVersion: data.model_version,
          }]
        }
      } catch { /* AI engine unavailable, fall through to statistical */ }

      // Statistical fallback: use weather API temperature data
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=57.15&longitude=-2.09&current=temperature_2m,apparent_temperature&daily=temperature_2m_max&timezone=auto&forecast_days=3`
      const res = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return this.ruleBasedPrediction(region)

      const data = await res.json()
      const currentTemp = data.current?.temperature_2m || 15
      const apparentTemp = data.current?.apparent_temperature || currentTemp
      const maxTemps = data.daily?.temperature_2m_max || []
      const maxForecast = Math.max(...maxTemps, currentTemp)

      // Statistical thresholds (adjusted for UK climate)
      let severity = 'Low'
      let probability = 0.1
      if (maxForecast > 35) { severity = 'Critical'; probability = 0.9 }
      else if (maxForecast > 30) { severity = 'High'; probability = 0.7 }
      else if (maxForecast > 25) { severity = 'Medium'; probability = 0.4 }
      else if (maxForecast > 20) { severity = 'Low'; probability = 0.15 }

      return [{
        incidentType: this.id,
        severity,
        probability,
        confidence: 0.6,
        confidenceSource: 'statistical',
        region,
        description: `Current: ${currentTemp}—C (feels like ${apparentTemp}—C). Forecast max: ${maxForecast}—C over 3 days.`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['weather_api', 'statistical_model'],
      }]
    } catch {
      return this.ruleBasedPrediction(region)
    }
  }
}

export default new HeatwaveModule()

