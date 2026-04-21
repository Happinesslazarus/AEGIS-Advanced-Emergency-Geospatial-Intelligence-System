import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'volume',
    tiers: [
      { gte: 30, alert: { severity: 'critical', title: 'Widespread Power Outages',    description: (n) => `${n} power outage reports. Critical infrastructure failure.` } },
      { gte: 15, alert: { severity: 'warning',  title: 'Significant Power Disruptions', description: (n) => `${n} power outage reports. Warning threshold reached.` } },
      { gte: 5,  alert: { severity: 'advisory', title: 'Power Outage Advisory',          description: (n) => `${n} localized power outage reports.` } },
    ],
  },
  {
    kind: 'flag', field: 'criticalFacility',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Critical Facility Power Outage', description: 'Power outage affecting critical infrastructure (hospital, emergency services, etc.). Emergency response required.' } },
    ],
  },
  {
    kind: 'sumField', field: 'affectedHouseholds', defaultPer: 5,
    tiers: [
      { gte: 1000, alert: { severity: 'critical', title: 'Large-Scale Power Outage',    description: (n) => `Estimated ${n}+ households without power.` } },
      { gte: 500,  alert: { severity: 'warning',  title: 'Significant Outage Impact', description: (n) => `Estimated ${n}+ households affected.` } },
    ],
  },
]

export class PowerOutageAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
