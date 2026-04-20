/**
 * Water supply disruptions incident module (handles water supply specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class WaterSupplyAlertRules {
   /**
   * Evaluate water supply disruption alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Water contamination (highest priority)
    const contaminationReports = recentReports.filter(r => r.customFields?.waterQualityIssue === true)
    if (contaminationReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Water Contamination Alert',
        description: `Water quality issues reported. Do not consume tap water. Use bottled water only.`
      })
    }

    // Rule 2: Report density threshold
    if (recentReports.length >= 30) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Widespread Water Disruption',
        description: `${recentReports.length} water supply reports. Critical infrastructure failure.`
      })
    } else if (recentReports.length >= 15) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Significant Water Disruptions',
        description: `${recentReports.length} water supply reports. Warning threshold reached.`
      })
    } else if (recentReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'advisory',
        title: 'Water Supply Advisory',
        description: `${recentReports.length} localized water supply reports.`
      })
    }

    // Rule 3: No water reports (complete loss of service)
    const noWaterReports = recentReports.filter(r => 
      r.customFields?.disruptionType === 'No Water'
    )
    if (noWaterReports.length >= 10) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Complete Water Loss',
        description: `${noWaterReports.length} reports of complete water loss. Critical situation.`
      })
    } else if (noWaterReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Multiple Water Loss Reports',
        description: `${noWaterReports.length} areas without water supply.`
      })
    }

    // Rule 4: Large affected population
    const totalAffectedHouseholds = recentReports.reduce((sum, r) => {
      const households = Number(r.customFields?.affectedHouseholds || 5)
      return sum + households
    }, 0)
    
    if (totalAffectedHouseholds >= 1000) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Large-Scale Water Disruption',
        description: `Estimated ${totalAffectedHouseholds}+ households without water.`
      })
    }

    return results
  }
}
