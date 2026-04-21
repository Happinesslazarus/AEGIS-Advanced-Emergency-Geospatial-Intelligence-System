import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'flag', field: 'healthAdvisory',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Health Advisory Issued', description: 'Health advisory in effect due to environmental hazard. Follow health guidance.' } },
    ],
  },
  {
    kind: 'sensor', source: 'sensorData', field: 'aqi',
    tiers: [
      { gte: 300, alert: { severity: 'critical', title: 'Hazardous Air Quality',   description: 'Air quality index exceeds 300. Hazardous conditions. Stay indoors.' } },
      { gte: 200, alert: { severity: 'warning',  title: 'Very Unhealthy Air Quality', description: 'Air quality index exceeds 200. Very unhealthy. Limit outdoor activity.' } },
      { gte: 150, alert: { severity: 'advisory', title: 'Unhealthy Air Quality',      description: 'Air quality index exceeds 150. Sensitive groups should limit exposure.' } },
    ],
  },
  {
    kind: 'volume',
    tiers: [
      { gte: 10, alert: { severity: 'critical', title: 'Major Environmental Hazard',       description: (n) => `${n} environmental hazard reports. Critical situation.` } },
      { gte: 5,  alert: { severity: 'warning',  title: 'Multiple Environmental Reports', description: (n) => `${n} environmental hazard reports. Warning threshold reached.` } },
      { gte: 2,  alert: { severity: 'advisory', title: 'Environmental Hazard Advisory',     description: (n) => `${n} environmental hazard reports.` } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'hazardType', value: 'Chemical Spill',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Chemical Spill Reported', description: 'Chemical spill incident reported. Avoid area. Shelter in place if instructed.' } },
    ],
  },
  {
    kind: 'fieldEquals', field: 'hazardType', value: 'Water Contamination',
    tiers: [
      { gte: 1, alert: { severity: 'critical', title: 'Water Contamination Detected', description: 'Water contamination reported. Do not consume tap water. Use bottled water only.' } },
    ],
  },
  predictionRule({ gt: 0.7, severity: 'warning', title: 'Environmental Hazard Risk Forecast', description: 'Statistical model predicts {pct}% environmental hazard risk.' }),
]

export class EnvironmentalHazardAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
