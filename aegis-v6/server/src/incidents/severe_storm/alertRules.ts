/**
 * Severe weather and storm systems incident module (handles severe storm specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class SevereStormAlertRules {
   /**
   * Evaluate severe storm alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, weatherData, predictions } = context

    // Rule 1: Report density threshold
    if (recentReports.length >= 15) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Severe Storm Activity',
        description: `${recentReports.length} storm reports received. Critical weather conditions.`
      })
    } else if (recentReports.length >= 7) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Storm Activity Increasing',
        description: `${recentReports.length} storm reports. Warning threshold reached.`
      })
    }

    // Rule 2: Wind speed threshold (if weather data available)
    if (weatherData?.windSpeed && Number(weatherData.windSpeed) >= 100) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Extreme Wind Speeds',
        description: `Wind speeds exceed 100 km/h. Dangerous conditions.`
      })
    } else if (weatherData?.windSpeed && Number(weatherData.windSpeed) >= 75) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'High Wind Warning',
        description: `Wind speeds exceed 75 km/h. Exercise caution.`
      })
    }

    // Rule 3: Damage reports
    const damageReports = recentReports.filter(r => 
      r.customFields?.damageType && Array.isArray(r.customFields.damageType) && r.customFields.damageType.length > 0
    )
    if (damageReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Storm Damage Reported',
        description: `${damageReports.length} reports of storm damage. Area affected.`
      })
    }

    // Rule 4: Statistical prediction threshold
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.7)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'High Storm Risk Forecast',
        description: `Statistical model predicts ${Math.round(highRiskPredictions[0].probability * 100)}% storm probability.`
      })
    }

    return results
  }
}
