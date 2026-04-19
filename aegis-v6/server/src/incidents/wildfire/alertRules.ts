/**
 * Module: alertRules.ts
 *
 * Wildfire and bushfire events incident module (handles wildfire specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class WildfireAlertRules {
   /**
   * Evaluate wildfire alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Report density threshold (wildfires are critical at lower counts)
    if (recentReports.length >= 7) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Active Wildfire Threat',
        description: `${recentReports.length} wildfire reports. Critical fire danger.`
      })
    } else if (recentReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Wildfire Activity',
        description: `${recentReports.length} wildfire reports. Elevated fire danger.`
      })
    }

    // Rule 2: Evacuation orders
    const evacuationReports = recentReports.filter(r => r.customFields?.evacuationOrdered === true)
    if (evacuationReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Wildfire Evacuation Ordered',
        description: `Evacuation orders issued due to wildfire. Follow official guidance immediately.`
      })
    }

    // Rule 3: Smoke visibility widespread
    const smokeReports = recentReports.filter(r => r.customFields?.smokeVisible === true)
    if (smokeReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Widespread Smoke Detected',
        description: `Smoke visible across multiple areas. Air quality may be hazardous.`
      })
    }

    // Rule 4: Large fire size
    const largeFireReports = recentReports.filter(r => 
      r.customFields?.fireSize && Number(r.customFields.fireSize) >= 100
    )
    if (largeFireReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Large Wildfire Active',
        description: `Fire exceeds 100 hectares. Major wildfire incident.`
      })
    }

    // Rule 5: ML prediction threshold
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.75)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Extreme Fire Danger Forecast',
        description: `ML model predicts ${Math.round(highRiskPredictions[0].probability * 100)}% wildfire risk.`
      })
    }

    return results
  }
}
