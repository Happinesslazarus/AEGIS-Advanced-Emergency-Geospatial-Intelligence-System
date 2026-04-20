/**
 * River and surface water flooding incident module (handles flood specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class FloodAlertRules {
   /**
   * Evaluate flood alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Report density threshold
    if (recentReports.length >= 10) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Multiple Flood Reports',
        description: `${recentReports.length} flood reports received in last 48 hours. Critical threshold exceeded.`
      })
    } else if (recentReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Elevated Flood Reports',
        description: `${recentReports.length} flood reports received. Warning threshold reached.`
      })
    }

    // Rule 2: High severity concentration
    const criticalReports = recentReports.filter(r => r.severity === 'Critical')
    if (criticalReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Critical Flood Severity',
        description: `${criticalReports.length} critical flood reports. Immediate action required.`
      })
    }

    // Rule 3: Evacuation flags
    const evacuationReports = recentReports.filter(r => r.customFields?.evacuationNeeded === true)
    if (evacuationReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Flood Evacuation Needed',
        description: `Multiple reports indicate evacuation is needed. Follow official guidance.`
      })
    }

    // Rule 4: ML prediction threshold
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.7)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'High Flood Risk Forecast',
        description: `ML model predicts ${Math.round(highRiskPredictions[0].probability * 100)}% flood probability.`
      })
    }

    return results
  }
}
