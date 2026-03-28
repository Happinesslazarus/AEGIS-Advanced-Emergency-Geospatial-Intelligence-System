/**
 * incidents/drought/alertRules.ts — Alert rule evaluation for drought incidents
 */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class DroughtAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Citizen reports of water restrictions or crop damage
    const restrictionReports = recentReports.filter(r => r.customFields?.waterRestrictions === true)
    if (restrictionReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Water Restrictions Reported',
        description: `${restrictionReports.length} reports of water restrictions in place. Conservation measures recommended.`,
      })
    }

    const cropDamageReports = recentReports.filter(r => r.customFields?.cropDamageReported === true)
    if (cropDamageReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Agricultural Impact Reported',
        description: `${cropDamageReports.length} reports of crop damage. Drought conditions may be impacting food production.`,
      })
    }

    // Rule 2: Low river level reports
    const lowRiverReports = recentReports.filter(r => r.customFields?.riverLevelLow === true)
    if (lowRiverReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Critically Low River Levels',
        description: `${lowRiverReports.length} reports of dangerously low river levels. Water supply may be at risk.`,
      })
    }

    // Rule 3: General report volume
    if (recentReports.length >= 8) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Multiple Drought Reports',
        description: `${recentReports.length} drought-related reports in last 48 hours. Conditions appear widespread.`,
      })
    } else if (recentReports.length >= 4) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Drought Conditions Emerging',
        description: `${recentReports.length} reports of drought conditions. Monitor water supply situation closely.`,
      })
    }

    // Rule 4: High-probability AI prediction
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.60)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Elevated Drought Risk Forecast',
        description: `Statistical model indicates ${Math.round(highRiskPredictions[0].probability * 100)}% drought probability. Prepare water conservation plans.`,
      })
    }

    return results
  }
}
