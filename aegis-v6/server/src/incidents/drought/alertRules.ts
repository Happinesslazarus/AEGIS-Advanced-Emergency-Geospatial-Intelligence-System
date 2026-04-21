import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'flag', field: 'waterRestrictions',
    tiers: [
      { gte: 3, alert: { severity: 'warning', title: 'Water Restrictions Reported', description: (n) => `${n} reports of water restrictions in place. Conservation measures recommended.` } },
    ],
  },
  {
    kind: 'flag', field: 'cropDamageReported',
    tiers: [
      { gte: 2, alert: { severity: 'warning', title: 'Agricultural Impact Reported', description: (n) => `${n} reports of crop damage. Drought conditions may be impacting food production.` } },
    ],
  },
  {
    kind: 'flag', field: 'riverLevelLow',
    tiers: [
      { gte: 2, alert: { severity: 'critical', title: 'Critically Low River Levels', description: (n) => `${n} reports of dangerously low river levels. Water supply may be at risk.` } },
    ],
  },
  {
    kind: 'volume',
    tiers: [
      { gte: 8, alert: { severity: 'critical', title: 'Multiple Drought Reports', description: (n) => `${n} drought-related reports in last 48 hours. Conditions appear widespread.` } },
      { gte: 4, alert: { severity: 'warning',  title: 'Drought Conditions Emerging', description: (n) => `${n} reports of drought conditions. Monitor water supply situation closely.` } },
    ],
  },
  predictionRule({ gt: 0.60, severity: 'warning', title: 'Elevated Drought Risk Forecast', description: 'Statistical model indicates {pct}% drought probability. Prepare water conservation plans.' }),
]

export class DroughtAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
