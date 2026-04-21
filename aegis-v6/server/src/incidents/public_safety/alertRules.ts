import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'flag', field: 'evacuationNeeded',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Public Safety Evacuation', description: 'Evacuation needed due to public safety incident. Follow official guidance immediately.' } },
    ],
  },
  {
    kind: 'flag', field: 'publicAtRisk',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Public Safety Threat', description: (n) => `${n} reports indicate public is at immediate risk. Emergency response activated.` } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'incidentType', value: 'Hazmat',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Hazardous Materials Incident', description: 'Hazmat situation reported. Avoid area. Shelter in place if instructed.' } },
    ],
  },
  {
    kind: 'volume',
    tiers: [
      { gte: 10, alert: { severity: 'critical', title: 'Major Public Safety Incident',    description: (n) => `${n} public safety reports. Critical situation developing.` } },
      { gte: 5,  alert: { severity: 'warning',  title: 'Multiple Public Safety Reports', description: (n) => `${n} public safety reports. Warning threshold reached.` } },
      { gte: 2,  alert: { severity: 'advisory', title: 'Public Safety Advisory',           description: (n) => `${n} public safety reports.` } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'severity', value: 'Critical', scope: 'root',
    tiers: [
      { gte: 2, alert: { severity: 'critical', title: 'Critical Public Safety Incidents', description: (n) => `${n} critical public safety reports. Immediate response required.` } },
    ],
  },
  {
    kind: 'locationCluster',
    tiers: [
      { gte: 3, alert: { severity: 'warning', title: 'Geographic Incident Cluster', description: (n) => `${n} incidents reported in area. Geographic pattern detected.` } },
    ],
  },
]

export class PublicSafetyAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
