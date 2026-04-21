import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, AlertRuleContext, AlertRuleResult } from '../types.js'

class InfrastructureDamageModule extends BaseIncidentModule {
  id = 'infrastructure_damage'

  registry: IncidentRegistryEntry = {
    id: 'infrastructure_damage',
    name: 'Infrastructure Damage',
    category: 'infrastructure',
    icon: 'hard-hat',
    color: '#78716C',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['inspection_reports', 'citizen_reports', 'structural_sensors'],
    aiEndpoint: null,
    aiTier: 'rule_based',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'assetType', label: 'Asset Type', type: 'select', required: true, options: ['road', 'bridge', 'building', 'utility'] },
      { key: 'serviceDisruption', label: 'Service Disruption', type: 'boolean', required: false },
      { key: 'accessRestricted', label: 'Access Restricted', type: 'boolean', required: false },
    ],
    widgets: ['live_map', 'resource_allocation', 'repair_queue'],
    alertThresholds: { advisory: 2, warning: 5, critical: 10 },
  }

  async evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]> {
    const results = await super.evaluateAlertRules(context)

    //Bridge/building damage = escalated priority
    const criticalAssets = context.recentReports.filter(
      r => ['bridge', 'building'].includes(r.customFields?.assetType) && r.severity === 'Critical'
    )
    if (criticalAssets.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Critical Infrastructure Failure',
        description: `${criticalAssets.length} critical asset(s) (bridge/building) reported with severe damage. Immediate inspection required.`,
      })
    }

    return results
  }
}

export default new InfrastructureDamageModule()

