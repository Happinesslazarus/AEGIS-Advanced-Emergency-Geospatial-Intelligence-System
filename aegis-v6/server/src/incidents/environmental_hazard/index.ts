/**
 * Environmental contamination events incident module (handles environmental hazard specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction } from '../types.js'

class EnvironmentalHazardModule extends BaseIncidentModule {
  id = 'environmental_hazard'

  registry: IncidentRegistryEntry = {
    id: 'environmental_hazard',
    name: 'Environmental Hazard',
    category: 'environmental',
    icon: 'biohazard',
    color: '#16A34A',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['air_quality_api', 'water_quality', 'citizen_reports', 'satellite'],
    aiEndpoint: '/api/predict',
    aiTier: 'statistical',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'hazardMaterial', label: 'Hazard Material', type: 'text', required: false },
      { key: 'airOrWaterImpact', label: 'Air/Water Impact', type: 'select', required: false, options: ['air', 'water', 'soil', 'mixed'] },
      { key: 'containmentNeeded', label: 'Containment Needed', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'environmental_monitor', 'alerts'],
    alertThresholds: { advisory: 29, warning: 51, critical: 75 },
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      //Air quality index from Open-Meteo
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=57.15&longitude=-2.09&current=pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,european_aqi`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return this.ruleBasedPrediction(region)

      const data = await res.json()
      const aqi = data.current?.european_aqi || 0
      const pm25 = data.current?.pm2_5 || 0
      const pm10 = data.current?.pm10 || 0
      const no2 = data.current?.nitrogen_dioxide || 0

      let severity = 'Low'
      let probability = 0.05
      if (aqi > 100) { severity = 'Critical'; probability = 0.85 }
      else if (aqi > 75) { severity = 'High'; probability = 0.6 }
      else if (aqi > 50) { severity = 'Medium'; probability = 0.35 }
      else if (aqi > 25) { severity = 'Low'; probability = 0.15 }

      return [{
        incidentType: this.id,
        severity,
        probability,
        confidence: 0.6,
        confidenceSource: 'statistical',
        region,
        description: `Air Quality Index: ${aqi}. PM2.5: ${pm25}--g/m--, PM10: ${pm10}--g/m--, NO2: ${no2}--g/m--`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['air_quality_api', 'statistical_model'],
      }]
    } catch {
      return this.ruleBasedPrediction(region)
    }
  }
}

export default new EnvironmentalHazardModule()
