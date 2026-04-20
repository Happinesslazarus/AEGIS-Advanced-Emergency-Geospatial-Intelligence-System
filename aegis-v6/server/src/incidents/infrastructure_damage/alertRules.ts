/**
 * Infrastructure damage assessment incident module (handles infrastructure damage specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class InfrastructureDamageAlertRules {
   /**
   * Evaluate infrastructure damage alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, predictions } = context

    // Rule 1: Structural collapse (highest priority)
    const collapsedReports = recentReports.filter(r => 
      r.customFields?.structuralIntegrity === 'Collapsed'
    )
    if (collapsedReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Structural Collapse',
        description: `Building or infrastructure collapsed. Emergency response activated. Avoid area.`
      })
    }

    // Rule 2: Emergency access blocked
    const blockedAccessReports = recentReports.filter(r => r.customFields?.emergencyAccess === true)
    if (blockedAccessReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Emergency Access Blocked',
        description: `Emergency vehicle access blocked by infrastructure damage. Critical situation.`
      })
    }

    // Rule 3: Report density threshold
    if (recentReports.length >= 15) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Widespread Infrastructure Damage',
        description: `${recentReports.length} infrastructure damage reports. Critical threshold exceeded.`
      })
    } else if (recentReports.length >= 8) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Significant Infrastructure Damage',
        description: `${recentReports.length} infrastructure damage reports. Warning threshold reached.`
      })
    } else if (recentReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'advisory',
        title: 'Infrastructure Damage Advisory',
        description: `${recentReports.length} infrastructure damage reports.`
      })
    }

    // Rule 4: Bridge damage (critical infrastructure)
    const bridgeDamageReports = recentReports.filter(r => 
      r.customFields?.damageType === 'Bridge'
    )
    if (bridgeDamageReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Bridge Damage Reported',
        description: `Bridge structural integrity compromised. Use alternate routes.`
      })
    }

    // Rule 5: Safety hazards
    const safetyHazardReports = recentReports.filter(r => r.customFields?.safetyHazard === true)
    if (safetyHazardReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Multiple Safety Hazards',
        description: `${safetyHazardReports.length} infrastructure safety hazards reported. Exercise extreme caution.`
      })
    }

    return results
  }
}
