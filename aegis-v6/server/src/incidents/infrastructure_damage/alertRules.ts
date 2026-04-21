import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'fieldEquals', field: 'structuralIntegrity', value: 'Collapsed',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Structural Collapse', description: 'Building or infrastructure collapsed. Emergency response activated. Avoid area.' } },
    ],
  },
  {
    kind: 'flag', field: 'emergencyAccess',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Emergency Access Blocked', description: 'Emergency vehicle access blocked by infrastructure damage. Critical situation.' } },
    ],
  },
  {
    kind: 'volume',
    tiers: [
      { gte: 15, alert: { severity: 'critical', title: 'Widespread Infrastructure Damage',    description: (n) => `${n} infrastructure damage reports. Critical threshold exceeded.` } },
      { gte: 8,  alert: { severity: 'warning',  title: 'Significant Infrastructure Damage', description: (n) => `${n} infrastructure damage reports. Warning threshold reached.` } },
      { gte: 3,  alert: { severity: 'advisory', title: 'Infrastructure Damage Advisory',       description: (n) => `${n} infrastructure damage reports.` } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'damageType', value: 'Bridge',
    tiers: [
      { gte: 1, alert: { severity: 'warning', title: 'Bridge Damage Reported', description: 'Bridge structural integrity compromised. Use alternate routes.' } },
    ],
  },
  {
    kind: 'flag', field: 'safetyHazard',
    tiers: [
      { gte: 5, alert: { severity: 'warning', title: 'Multiple Safety Hazards', description: (n) => `${n} infrastructure safety hazards reported. Exercise extreme caution.` } },
    ],
  },
]

export class InfrastructureDamageAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
