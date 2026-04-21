import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction } from '../types.js'
import { regionRegistry } from '../../adapters/regions/RegionRegistry.js'

class SevereStormModule extends BaseIncidentModule {
  id = 'severe_storm'

  registry: IncidentRegistryEntry = {
    id: 'severe_storm',
    name: 'Severe Storm',
    category: 'natural_disaster',
    icon: 'cloud-lightning',
    color: '#7C3AED',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['weather_api', 'met_office', 'citizen_reports'],
    aiEndpoint: null,
    aiTier: 'statistical',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'windDamage', label: 'Wind Damage Observed', type: 'boolean', required: false },
      { key: 'hailPresent', label: 'Hail Present', type: 'boolean', required: false },
      { key: 'powerLinesDown', label: 'Power Lines Down', type: 'boolean', required: false },
    ],
    widgets: ['weather_panel', 'live_map', 'incident_timeline'],
    alertThresholds: { advisory: 28, warning: 52, critical: 74 },
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    //Statistical approach: use weather data + report patterns
    try {
      const meta = regionRegistry.getActiveRegion().getMetadata()
      const weatherUrl = process.env.WEATHER_API_KEY
        ? `https://api.openweathermap.org/data/2.5/weather?lat=${meta.centre.lat}&lon=${meta.centre.lng}&appid=${process.env.WEATHER_API_KEY}&units=metric`
        : `https://api.open-meteo.com/v1/forecast?latitude=${meta.centre.lat}&longitude=${meta.centre.lng}&current=wind_speed_10m,wind_gusts_10m,precipitation`

      const res = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return this.ruleBasedPrediction(region)

      const data = await res.json()
      const windSpeed = data.current?.wind_speed_10m || data.wind?.speed || 0
      const gusts = data.current?.wind_gusts_10m || data.wind?.gust || 0
      const precipitation = data.current?.precipitation || data.rain?.['1h'] || 0

      //Statistical thresholds for storm severity
      let severity = 'Low'
      let probability = 0.1
      if (gusts > 80 || windSpeed > 60) { severity = 'Critical'; probability = 0.85 }
      else if (gusts > 60 || windSpeed > 45) { severity = 'High'; probability = 0.65 }
      else if (gusts > 40 || windSpeed > 30) { severity = 'Medium'; probability = 0.45 }
      else if (gusts > 25 || precipitation > 10) { severity = 'Low'; probability = 0.25 }

      return [{
        incidentType: this.id,
        severity,
        probability,
        confidence: 0.55,
        confidenceSource: 'statistical',
        region,
        description: `Wind: ${windSpeed} km/h, Gusts: ${gusts} km/h, Precipitation: ${precipitation}mm`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['weather_api', 'statistical_model'],
      }]
    } catch {
      return this.ruleBasedPrediction(region)
    }
  }
}

export default new SevereStormModule()

