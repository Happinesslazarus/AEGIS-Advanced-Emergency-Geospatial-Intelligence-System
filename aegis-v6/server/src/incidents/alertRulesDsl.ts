/**
 * Declarative alert-rules DSL.
 *
 * Before: every hazard module hand-coded a 60-100 line `evaluate()` method that
 * repeated the same structural patterns (tier on count, filter-then-count,
 * sensor threshold, prediction probability) with only the field names and
 * thresholds differing. Those imperative variants are collapsed into a
 * declarative list of AlertRule objects -- the same execution engine runs
 * them for every hazard.
 *
 * Supported rule shapes (all accept tiered thresholds where applicable;
 * tiers MUST be ordered highest gte -> lowest so the first match wins):
 *   - volume             : recentReports.length
 *   - flag               : count of customFields[field] === true
 *   - fieldEquals        : count of reports where (customFields or root)[field] === value
 *   - numericField       : count of reports where Number(customFields[field]) >= gte
 *   - sumField           : sum of customFields[field] (optional defaultPer row)
 *   - sensor             : weatherData[field] or sensorData[field] numeric value
 *   - prediction         : any prediction with probability > gt
 *   - locationCluster    : count of reports with lat/lng populated
 */

import type { AlertRuleContext, AlertRuleResult } from './types.js'

type Severity = 'advisory' | 'warning' | 'critical'

export interface Alert {
  severity: Severity
  title: string
  /** Plain string, or a formatter receiving the rule's computed value (count, sum, probability pct, etc.). */
  description: string | ((value: number) => string)
}

export interface Tier { gte: number; alert: Alert }

export type AlertRule =
  | { kind: 'volume'; tiers: Tier[] }
  | { kind: 'flag'; field: string; tiers: Tier[] }
  | { kind: 'fieldEquals'; field: string; value: string | number; scope?: 'customFields' | 'root'; tiers: Tier[] }
  | { kind: 'numericField'; field: string; gte: number; tiers: Tier[] }
  | { kind: 'sumField'; field: string; defaultPer?: number; tiers: Tier[] }
  | { kind: 'arrayNonEmpty'; field: string; tiers: Tier[] }
  | { kind: 'sensor'; field: string; source: 'weatherData' | 'sensorData'; tiers: Tier[] }
  | { kind: 'prediction'; gt: number; alert: Alert }
  | { kind: 'locationCluster'; tiers: Tier[] }

function emit(out: AlertRuleResult[], alert: Alert, value: number): void {
  out.push({
    shouldAlert: true,
    severity: alert.severity,
    title: alert.title,
    description: typeof alert.description === 'function' ? alert.description(value) : alert.description,
  })
}

function emitTier(out: AlertRuleResult[], tiers: Tier[], value: number): void {
  for (const t of tiers) {
    if (value >= t.gte) { emit(out, t.alert, value); return }
  }
}

export function evaluateRules(rules: AlertRule[], ctx: AlertRuleContext): AlertRuleResult[] {
  const out: AlertRuleResult[] = []
  const reports = ctx.recentReports

  for (const rule of rules) {
    switch (rule.kind) {
      case 'volume':
        emitTier(out, rule.tiers, reports.length)
        break
      case 'flag': {
        const n = reports.filter(r => r.customFields?.[rule.field] === true).length
        emitTier(out, rule.tiers, n)
        break
      }
      case 'fieldEquals': {
        const n = reports.filter(r => {
          const v = rule.scope === 'root' ? (r as Record<string, unknown>)[rule.field] : r.customFields?.[rule.field]
          return v === rule.value
        }).length
        emitTier(out, rule.tiers, n)
        break
      }
      case 'numericField': {
        const n = reports.filter(r => {
          const v = r.customFields?.[rule.field]
          return v != null && Number(v) >= rule.gte
        }).length
        emitTier(out, rule.tiers, n)
        break
      }
      case 'sumField': {
        const sum = reports.reduce((acc, r) => {
          const v = r.customFields?.[rule.field]
          return acc + Number(v ?? rule.defaultPer ?? 0)
        }, 0)
        emitTier(out, rule.tiers, sum)
        break
      }
      case 'arrayNonEmpty': {
        const n = reports.filter(r => {
          const v = r.customFields?.[rule.field]
          return Array.isArray(v) && v.length > 0
        }).length
        emitTier(out, rule.tiers, n)
        break
      }
      case 'sensor': {
        const source = rule.source === 'weatherData' ? ctx.weatherData : ctx.sensorData
        const v = source?.[rule.field]
        if (v == null) break
        emitTier(out, rule.tiers, Number(v))
        break
      }
      case 'prediction': {
        const hits = ctx.predictions?.filter(p => p.probability > rule.gt) ?? []
        if (hits.length > 0) emit(out, rule.alert, Math.round(hits[0].probability * 100))
        break
      }
      case 'locationCluster': {
        const n = reports.filter(r => r.location?.lat != null && r.location?.lng != null).length
        emitTier(out, rule.tiers, n)
        break
      }
    }
  }
  return out
}

/**
 * Common helper: build the canonical "ML/statistical prediction over X%" rule used by
 * most hazards. The description interpolates the integer percentage of the first matching hit.
 */
export function predictionRule(opts: {
  gt: number
  severity: Severity
  title: string
  /** Description template -- {pct} is replaced with the integer percentage. */
  description: string
}): AlertRule {
  return {
    kind: 'prediction',
    gt: opts.gt,
    alert: {
      severity: opts.severity,
      title: opts.title,
      description: (pct: number) => opts.description.replace('{pct}', String(pct)),
    },
  }
}
