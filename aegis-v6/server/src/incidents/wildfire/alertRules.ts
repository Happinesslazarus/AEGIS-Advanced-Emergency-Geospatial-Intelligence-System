import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'volume',
    tiers: [
      { gte: 7, alert: { severity: 'critical', title: 'Active Wildfire Threat', description: (n) => `${n} wildfire reports. Critical fire danger.` } },
      { gte: 3, alert: { severity: 'warning',  title: 'Wildfire Activity',      description: (n) => `${n} wildfire reports. Elevated fire danger.` } },
    ],
  },
  {
    kind: 'flag', field: 'evacuationOrdered',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Wildfire Evacuation Ordered', description: 'Evacuation orders issued due to wildfire. Follow official guidance immediately.' } },
    ],
  },
  {
    kind: 'flag', field: 'smokeVisible',
    tiers: [
      { gte: 5, alert: { severity: 'warning', title: 'Widespread Smoke Detected', description: 'Smoke visible across multiple areas. Air quality may be hazardous.' } },
    ],
  },
  {
    kind: 'numericField', field: 'fireSize', gte: 100,
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Large Wildfire Active', description: 'Fire exceeds 100 hectares. Major wildfire incident.' } },
    ],
  },
  predictionRule({ gt: 0.75, severity: 'warning', title: 'Extreme Fire Danger Forecast', description: 'ML model predicts {pct}% wildfire risk.' }),
]

export class WildfireAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
