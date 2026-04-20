/**
 * Electrical grid failures incident module (handles power outage specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, AlertRuleContext, AlertRuleResult } from '../types.js'

class PowerOutageModule extends BaseIncidentModule {
  id = 'power_outage'

  registry: IncidentRegistryEntry = {
    id: 'power_outage',
    name: 'Power Outage',
    category: 'community_safety',
    icon: 'zap-off',
    color: '#FBBF24',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['utility_api', 'citizen_reports', 'smart_grid'],
    aiEndpoint: null,
    aiTier: 'rule_based',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'outageDurationHours', label: 'Outage Duration (hours)', type: 'number', required: false },
      { key: 'criticalServicesImpacted', label: 'Critical Services Impacted', type: 'boolean', required: false },
      { key: 'areaWide', label: 'Area-wide Outage', type: 'boolean', required: false },
    ],
    widgets: ['incident_timeline', 'resource_allocation', 'community_help'],
    alertThresholds: { advisory: 3, warning: 8, critical: 15 },
  }

  async evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]> {
    const results = await super.evaluateAlertRules(context)

    //Additional rule: check for critical services affected
    const criticalReports = context.recentReports.filter(
      r => r.customFields?.criticalServicesImpacted === true
    )
    if (criticalReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Critical Infrastructure Power Failure',
        description: `${criticalReports.length} report(s) indicate critical services (hospitals, emergency services) are affected by power outage.`,
      })
    }

    //Rule: check outage duration
    const longOutages = context.recentReports.filter(
      r => (r.customFields?.outageDurationHours || 0) > 6
    )
    if (longOutages.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Extended Power Outage',
        description: `${longOutages.length} areas reporting power outages exceeding 6 hours.`,
      })
    }

    return results
  }
}

export default new PowerOutageModule()

