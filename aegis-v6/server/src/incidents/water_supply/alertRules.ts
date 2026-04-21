import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'flag', field: 'waterQualityIssue',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Water Contamination Alert', description: 'Water quality issues reported. Do not consume tap water. Use bottled water only.' } },
    ],
  },
  {
    kind: 'volume',
    tiers: [
      { gte: 30, alert: { severity: 'critical', title: 'Widespread Water Disruption',    description: (n) => `${n} water supply reports. Critical infrastructure failure.` } },
      { gte: 15, alert: { severity: 'warning',  title: 'Significant Water Disruptions', description: (n) => `${n} water supply reports. Warning threshold reached.` } },
      { gte: 5,  alert: { severity: 'advisory', title: 'Water Supply Advisory',           description: (n) => `${n} localized water supply reports.` } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'disruptionType', value: 'No Water',
    tiers: [
      { gte: 10, alert: { severity: 'critical', title: 'Complete Water Loss',           description: (n) => `${n} reports of complete water loss. Critical situation.` } },
      { gte: 5,  alert: { severity: 'warning',  title: 'Multiple Water Loss Reports', description: (n) => `${n} areas without water supply.` } },
    ],
  },
  {
    kind: 'sumField', field: 'affectedHouseholds', defaultPer: 5,
    tiers: [
      { gte: 1000, alert: { severity: 'critical', title: 'Large-Scale Water Disruption', description: (n) => `Estimated ${n}+ households without water.` } },
    ],
  },
]

export class WaterSupplyAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
