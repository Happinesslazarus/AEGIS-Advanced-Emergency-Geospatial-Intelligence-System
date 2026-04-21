import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, IncidentPrediction, AlertRuleContext, AlertRuleResult } from '../types.js'
import { droughtConfig } from './config.js'
import { DroughtAlertRules } from './alertRules.js'
import { DroughtAIClient } from './aiClient.js'
import { setupDroughtRoutes } from './routes.js'

class DroughtModule extends BaseIncidentModule {
  id = 'drought'

  registry: IncidentRegistryEntry = {
    ...droughtConfig,
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
    const predictions = await DroughtAIClient.getPredictions(region)
    if (predictions.length > 0) return predictions
    return this.ruleBasedPrediction(region)
  }

  async evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]> {
    return DroughtAlertRules.evaluate(context)
  }

  protected setupCustomRoutes(): void {
    setupDroughtRoutes(this.router)
  }
}

export default new DroughtModule()
