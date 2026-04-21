import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'volume',
    tiers: [
      { gte: 10, alert: { severity: 'critical', title: 'Multiple Flood Reports', description: (n) => `${n} flood reports received in last 48 hours. Critical threshold exceeded.` } },
      { gte: 5,  alert: { severity: 'warning',  title: 'Elevated Flood Reports', description: (n) => `${n} flood reports received. Warning threshold reached.` } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'severity', value: 'Critical', scope: 'root',
    tiers: [
      { gte: 3, alert: { severity: 'critical', title: 'Critical Flood Severity', description: (n) => `${n} critical flood reports. Immediate action required.` } },
    ],
  },
  {
    kind: 'flag', field: 'evacuationNeeded',
    tiers: [
      { gte: 2, alert: { severity: 'critical', title: 'Flood Evacuation Needed', description: 'Multiple reports indicate evacuation is needed. Follow official guidance.' } },
    ],
  },
  predictionRule({ gt: 0.7, severity: 'warning', title: 'High Flood Risk Forecast', description: 'ML model predicts {pct}% flood probability.' }),
]

export class FloodAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}