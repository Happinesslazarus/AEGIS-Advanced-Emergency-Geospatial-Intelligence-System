import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, AlertRuleContext, AlertRuleResult } from '../types.js'

class WaterSupplyModule extends BaseIncidentModule {
  id = 'water_supply_disruption'

  registry: IncidentRegistryEntry = {
    id: 'water_supply_disruption',
    name: 'Water Supply Disruption',
    category: 'community_safety',
    icon: 'droplet-off',
    color: '#06B6D4',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['utility_api', 'citizen_reports', 'water_quality_sensors'],
    aiEndpoint: null,
    aiTier: 'rule_based',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'waterUnavailable', label: 'No Running Water', type: 'boolean', required: false },
      { key: 'contaminationSuspected', label: 'Contamination Suspected', type: 'boolean', required: false },
      { key: 'durationHours', label: 'Duration (hours)', type: 'number', required: false },
    ],
    widgets: ['incident_timeline', 'community_help', 'alerts'],
    alertThresholds: { advisory: 3, warning: 6, critical: 12 },
  }

  async evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]> {
    const results = await super.evaluateAlertRules(context)

    //Contamination reports = immediate critical alert
    const contaminationReports = context.recentReports.filter(
      r => r.customFields?.contaminationSuspected === true
    )
    if (contaminationReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Water Contamination Alert',
        description: `${contaminationReports.length} report(s) of suspected water contamination. Do not consume tap water until confirmed safe.`,
      })
    }

    return results
  }
}

export default new WaterSupplyModule()

