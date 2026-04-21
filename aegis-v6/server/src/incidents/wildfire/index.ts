import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction } from '../types.js'

class WildfireModule extends BaseIncidentModule {
  id = 'wildfire'

  registry: IncidentRegistryEntry = {
    id: 'wildfire',
    name: 'Wildfire',
    category: 'natural_disaster',
    icon: 'flame',
    color: '#F97316',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['satellite_imagery', 'weather_api', 'citizen_reports', 'fire_danger_index'],
    aiEndpoint: '/api/predict',
    aiTier: 'ml',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'smokeIntensity', label: 'Smoke Intensity', type: 'select', required: false, options: ['light', 'moderate', 'heavy'] },
      { key: 'flameVisible', label: 'Visible Flames', type: 'boolean', required: false },
      { key: 'evacuationNeeded', label: 'Evacuation Needed', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'air_quality', 'evacuation_routes'],
    alertThresholds: { advisory: 33, warning: 56, critical: 80 },
  }

  async getPredictions(region: string): Promise<IncidentPrediction[]> {
    try {
      //Fire Weather Index calculation from weather data
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=57.15&longitude=-2.09&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&daily=precipitation_sum&timezone=auto&forecast_days=3`
      const res = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return this.ruleBasedPrediction(region)

      const data = await res.json()
      const temp = data.current?.temperature_2m || 15
      const humidity = data.current?.relative_humidity_2m || 60
      const windSpeed = data.current?.wind_speed_10m || 10
      const precipitation = data.current?.precipitation || 0
      const recentRain = (data.daily?.precipitation_sum || []).reduce((s: number, v: number) => s + v, 0)

      //Simplified Fire Danger Index
      const fdi = (temp * 0.3) + ((100 - humidity) * 0.3) + (windSpeed * 0.2) - (recentRain * 2)

      let severity = 'Low'
      let probability = 0.05
      if (fdi > 40) { severity = 'Critical'; probability = 0.8 }
      else if (fdi > 25) { severity = 'High'; probability = 0.55 }
      else if (fdi > 15) { severity = 'Medium'; probability = 0.3 }
      else if (fdi > 5) { severity = 'Low'; probability = 0.15 }

      return [{
        incidentType: this.id,
        severity,
        probability,
        confidence: 0.5,
        confidenceSource: 'statistical',
        region,
        description: `Fire Danger Index: ${fdi.toFixed(1)}. Temp: ${temp}--C, Humidity: ${humidity}%, Wind: ${windSpeed} km/h, Recent rain: ${recentRain.toFixed(1)}mm`,
        advisoryText: this.getAdvisoryText(severity),
        generatedAt: new Date().toISOString(),
        dataSourcesUsed: ['weather_api', 'fire_danger_index'],
      }]
    } catch {
      return this.ruleBasedPrediction(region)
    }
  }
}

export default new WildfireModule()

