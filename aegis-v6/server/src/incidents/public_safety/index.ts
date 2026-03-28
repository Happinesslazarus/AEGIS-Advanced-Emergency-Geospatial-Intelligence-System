/**
 * incidents/public_safety/index.ts — Public Safety Incident module (Tier 1: Rule-based)
 */

import { BaseIncidentModule } from '../baseModule.js'
import type { IncidentRegistryEntry, AlertRuleContext, AlertRuleResult } from '../types.js'

class PublicSafetyModule extends BaseIncidentModule {
  id = 'public_safety_incident'

  registry: IncidentRegistryEntry = {
    id: 'public_safety_incident',
    name: 'Public Safety Incident',
    category: 'public_safety',
    icon: 'shield-alert',
    color: '#EF4444',
    severityLevels: ['Low', 'Medium', 'High', 'Critical'],
    dataSources: ['police_feed', 'citizen_reports', 'social_media'],
    aiEndpoint: null,
    aiTier: 'rule_based',
    enabledRegions: 'all',
    operationalStatus: 'fully_operational',
    fieldSchema: [
      { key: 'injuriesReported', label: 'Injuries Reported', type: 'boolean', required: false },
      { key: 'crowdSize', label: 'Crowd Size', type: 'select', required: false, options: ['small', 'medium', 'large'] },
      { key: 'policeRequired', label: 'Police Required', type: 'boolean', required: false },
    ],
    widgets: ['incident_timeline', 'live_map', 'operator_assignments'],
    alertThresholds: { advisory: 2, warning: 5, critical: 8 },
  }

  async evaluateAlertRules(context: AlertRuleContext): Promise<AlertRuleResult[]> {
    const results = await super.evaluateAlertRules(context)

    // Injuries + large crowd = escalation
    const injuryReports = context.recentReports.filter(
      r => r.customFields?.injuriesReported === true
    )
    const largeCrowds = context.recentReports.filter(
      r => r.customFields?.crowdSize === 'large'
    )

    if (injuryReports.length >= 2 || (injuryReports.length >= 1 && largeCrowds.length >= 1)) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Major Public Safety Incident',
        description: `Multiple injury reports and/or large crowd involvement detected. Emergency services coordination required.`,
      })
    }

    return results
  }
}

export default new PublicSafetyModule()
