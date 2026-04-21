import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'volume',
    tiers: [
      { gte: 15, alert: { severity: 'critical', title: 'Severe Storm Activity',     description: (n) => `${n} storm reports received. Critical weather conditions.` } },
      { gte: 7,  alert: { severity: 'warning',  title: 'Storm Activity Increasing', description: (n) => `${n} storm reports. Warning threshold reached.` } },
    ],
  },
  {
    kind: 'sensor', source: 'weatherData', field: 'windSpeed',
    tiers: [
      { gte: 100, alert: { severity: 'critical', title: 'Extreme Wind Speeds', description: 'Wind speeds exceed 100 km/h. Dangerous conditions.' } },
      { gte: 75,  alert: { severity: 'warning',  title: 'High Wind Warning',   description: 'Wind speeds exceed 75 km/h. Exercise caution.' } },
    ],
  },
  {
    kind: 'arrayNonEmpty', field: 'damageType',
    tiers: [
      { gte: 5, alert: { severity: 'warning', title: 'Storm Damage Reported', description: (n) => `${n} reports of storm damage. Area affected.` } },
    ],
  },
  predictionRule({ gt: 0.7, severity: 'warning', title: 'High Storm Risk Forecast', description: 'Statistical model predicts {pct}% storm probability.' }),
]

export class SevereStormAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
