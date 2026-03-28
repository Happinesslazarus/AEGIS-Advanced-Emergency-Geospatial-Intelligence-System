/**
 * incidents/landslide/alertRules.ts — Alert rule evaluation for landslide incidents
 */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class LandslideAlertRules {
   /**
   * Evaluate landslide alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, weatherData, predictions } = context

    // Rule 1: Report density threshold
    if (recentReports.length >= 7) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Multiple Landslide Reports',
        description: `${recentReports.length} landslide reports in last 72 hours. Critical geological conditions.`
      })
    } else if (recentReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Landslide Activity',
        description: `${recentReports.length} landslide reports. Warning threshold reached.`
      })
    }

    // Rule 2: Heavy rainfall threshold (if weather data available)
    if (weatherData?.rainfall24h && Number(weatherData.rainfall24h) >= 100) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Extreme Rainfall - Landslide Risk',
        description: `Rainfall exceeds 100mm in 24 hours. Critical landslide conditions.`
      })
    } else if (weatherData?.rainfall24h && Number(weatherData.rainfall24h) >= 75) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Heavy Rainfall - Landslide Warning',
        description: `Rainfall exceeds 75mm. Elevated landslide risk.`
      })
    }

    // Rule 3: Road blockages
    const roadBlockedReports = recentReports.filter(r => r.customFields?.roadBlocked === true)
    if (roadBlockedReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Multiple Roads Blocked',
        description: `${roadBlockedReports.length} roads blocked by landslides. Travel disrupted.`
      })
    }

    // Rule 4: Structural damage
    const structureDamageReports = recentReports.filter(r => r.customFields?.structuresDamaged === true)
    if (structureDamageReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Structures Damaged by Landslides',
        description: `Buildings or structures damaged. Evacuate vulnerable areas.`
      })
    }

    // Rule 5: Statistical prediction threshold
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.7)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'High Landslide Risk Forecast',
        description: `Statistical model predicts ${Math.round(highRiskPredictions[0].probability * 100)}% landslide risk.`
      })
    }

    return results
  }
}
