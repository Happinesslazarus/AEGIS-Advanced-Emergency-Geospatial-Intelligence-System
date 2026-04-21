import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'volume',
    tiers: [
      { gte: 10, alert: { severity: 'critical', title: 'Extreme Heat Conditions', description: (n) => `${n} heat-related reports in last 72 hours. Critical heat conditions.` } },
      { gte: 5,  alert: { severity: 'warning',  title: 'Heat Advisory',           description: (n) => `${n} heat-related reports. Warning threshold reached.` } },
    ],
  },
  {
    kind: 'sensor', source: 'weatherData', field: 'temperature',
    tiers: [
      { gte: 38, alert: { severity: 'critical', title: 'Extreme Heat Warning', description: 'Temperature exceeds 38°C. Life-threatening heat conditions.' } },
      { gte: 35, alert: { severity: 'warning',  title: 'High Temperature Alert', description: 'Temperature exceeds 35°C. Dangerous heat expected.' } },
    ],
  },
  {
    kind: 'flag', field: 'vulnerablePopulation',
    tiers: [
      { gte: 3, alert: { severity: 'critical', title: 'Vulnerable Population at Risk', description: 'Multiple reports indicate vulnerable populations affected by heat. Check on elderly and at-risk individuals.' } },
    ],
  },
  predictionRule({ gt: 0.7, severity: 'warning', title: 'Prolonged Heat Forecast', description: 'Statistical model predicts {pct}% heatwave probability.' }),
]

export class HeatwaveAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
