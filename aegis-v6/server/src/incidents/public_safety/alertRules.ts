/**
 * Module: alertRules.ts
 *
 * Public safety incidents incident module (handles public safety specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class PublicSafetyAlertRules {
   /**
   * Evaluate public safety alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Evacuation needed (highest priority)
    const evacuationReports = recentReports.filter(r => r.customFields?.evacuationNeeded === true)
    if (evacuationReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Evacuation Required',
        description: `Evacuation needed due to public safety incident. Follow official guidance immediately.`
      })
    }

    // Rule 2: Public at risk
    const publicAtRiskReports = recentReports.filter(r => r.customFields?.publicAtRisk === true)
    if (publicAtRiskReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Public Safety Threat',
        description: `Public at risk. Avoid affected areas. Follow emergency guidance.`
      })
    }

    // Rule 3: Hazmat incidents
    const hazmatReports = recentReports.filter(r => 
      r.customFields?.incidentType === 'Hazmat'
    )
    if (hazmatReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Hazardous Materials Incident',
        description: `Hazmat incident reported. Evacuate area. Avoid exposure.`
      })
    }

    // Rule 4: Report density threshold
    if (recentReports.length >= 10) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Multiple Public Safety Incidents',
        description: `${recentReports.length} public safety reports in last 12 hours. Heightened alert.`
      })
    } else if (recentReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Elevated Safety Concerns',
        description: `${recentReports.length} public safety reports. Warning threshold reached.`
      })
    } else if (recentReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'advisory',
        title: 'Public Safety Advisory',
        description: `${recentReports.length} public safety incidents reported. Stay alert.`
      })
    }

    // Rule 5: Critical severity concentration
    const criticalReports = recentReports.filter(r => r.severity === 'Critical')
    if (criticalReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Critical Safety Incidents',
        description: `${criticalReports.length} critical public safety incidents. Emergency response active.`
      })
    }

    // Rule 6: Geographic clustering (hotspot detection)
    const reportsWithLocation = recentReports.filter(r => r.location?.lat && r.location?.lng)
    if (reportsWithLocation.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Public Safety Hotspot',
        description: `Multiple incidents in concentrated area. Exercise extreme caution.`
      })
    }

    return results
  }
}
