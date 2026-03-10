/**
 * incidents/power_outage/alertRules.ts — Alert rule evaluation for power outage incidents
 */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class PowerOutageAlertRules {
  /**
   * Evaluate power outage alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Report density threshold
    if (recentReports.length >= 30) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Widespread Power Outages',
        description: `${recentReports.length} power outage reports. Critical infrastructure failure.`
      })
    } else if (recentReports.length >= 15) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Significant Power Disruptions',
        description: `${recentReports.length} power outage reports. Warning threshold reached.`
      })
    } else if (recentReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'advisory',
        title: 'Power Outage Advisory',
        description: `${recentReports.length} localized power outage reports.`
      })
    }

    // Rule 2: Critical facilities affected
    const criticalFacilityReports = recentReports.filter(r => r.customFields?.criticalFacility === true)
    if (criticalFacilityReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Critical Facility Power Outage',
        description: `Power outage affecting critical infrastructure (hospital, emergency services, etc.). Emergency response required.`
      })
    }

    // Rule 3: Large affected population
    const totalAffectedHouseholds = recentReports.reduce((sum, r) => {
      const households = Number(r.customFields?.affectedHouseholds || 5)
      return sum + households
    }, 0)
    
    if (totalAffectedHouseholds >= 1000) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Large-Scale Power Outage',
        description: `Estimated ${totalAffectedHouseholds}+ households without power.`
      })
    } else if (totalAffectedHouseholds >= 500) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Significant Outage Impact',
        description: `Estimated ${totalAffectedHouseholds}+ households affected.`
      })
    }

    return results
  }
}
