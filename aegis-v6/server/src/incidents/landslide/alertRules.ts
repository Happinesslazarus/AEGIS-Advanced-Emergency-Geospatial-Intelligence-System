import type { AlertRuleContext, AlertRuleResult } from '../types.js'
import { evaluateRules, predictionRule, type AlertRule } from '../alertRulesDsl.js'

const RULES: AlertRule[] = [
  {
    kind: 'volume',
    tiers: [
      { gte: 7, alert: { severity: 'critical', title: 'Multiple Landslide Reports', description: (n) => `${n} landslide reports in last 72 hours. Critical geological conditions.` } },
      { gte: 3, alert: { severity: 'warning',  title: 'Landslide Activity',         description: (n) => `${n} landslide reports. Warning threshold reached.` } },
    ],
  },
  {
    kind: 'sensor', source: 'weatherData', field: 'rainfall24h',
    tiers: [
      { gte: 100, alert: { severity: 'critical', title: 'Extreme Rainfall - Landslide Risk',    description: 'Rainfall exceeds 100mm in 24 hours. Critical landslide conditions.' } },
      { gte: 75,  alert: { severity: 'warning',  title: 'Heavy Rainfall - Landslide Warning', description: 'Rainfall exceeds 75mm. Elevated landslide risk.' } },
    ],
  },
  {
    kind: 'flag', field: 'roadBlocked',
    tiers: [
      { gte: 3, alert: { severity: 'warning', title: 'Multiple Roads Blocked', description: (n) => `${n} roads blocked by landslides. Travel disrupted.` } },
    ],
  },
  {
    kind: 'flag', field: 'structuresDamaged',
    tiers: [
      { gte: 2, alert: { severity: 'critical', title: 'Structures Damaged by Landslides', description: 'Buildings or structures damaged. Evacuate vulnerable areas.' } },
    ],
  },
  predictionRule({ gt: 0.7, severity: 'warning', title: 'High Landslide Risk Forecast', description: 'Statistical model predicts {pct}% landslide risk.' }),
]

export class LandslideAlertRules {
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    return evaluateRules(RULES, context)
  }
}
