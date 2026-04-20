/**
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class HeatwaveAlertRules {
   /**
   * Evaluate heatwave alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, weatherData, predictions } = context

    //Rule 1: Report density threshold
    if (recentReports.length >= 10) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Extreme Heat Conditions',
        description: `${recentReports.length} heat-related reports in last 72 hours. Critical heat conditions.`
      })
    } else if (recentReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Heat Advisory',
        description: `${recentReports.length} heat-related reports. Warning threshold reached.`
      })
    }

    //Rule 2: Temperature threshold (if weather data available)
    if (weatherData?.temperature && Number(weatherData.temperature) >= 38) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Extreme Heat Warning',
        description: `Temperature exceeds 38--C. Life-threatening heat conditions.`
      })
    } else if (weatherData?.temperature && Number(weatherData.temperature) >= 35) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'High Temperature Alert',
        description: `Temperature exceeds 35--C. Dangerous heat expected.`
      })
    }

    //Rule 3: Vulnerable population impact
    const vulnerableReports = recentReports.filter(r => r.customFields?.vulnerablePopulation === true)
    if (vulnerableReports.length >= 3) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Vulnerable Population at Risk',
        description: `Multiple reports indicate vulnerable populations affected by heat. Check on elderly and at-risk individuals.`
      })
    }

    //Rule 4: Statistical prediction threshold
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.7)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Prolonged Heat Forecast',
        description: `Statistical model predicts ${Math.round(highRiskPredictions[0].probability * 100)}% heatwave probability.`
      })
    }

    return results
  }
}
