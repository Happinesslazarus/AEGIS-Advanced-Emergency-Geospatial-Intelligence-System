/**
 * Module: alertRules.ts
 *
 * Environmental contamination events incident module (handles environmental hazard specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { AlertRuleContext, AlertRuleResult } from '../types.js'

export class EnvironmentalHazardAlertRules {
   /**
   * Evaluate environmental hazard alert rules based on context
   */
  static evaluate(context: AlertRuleContext): AlertRuleResult[] {
    const results: AlertRuleResult[] = []
    const { recentReports, sensorData, predictions } = context

    // Rule 1: Health advisory issued
    const healthAdvisoryReports = recentReports.filter(r => r.customFields?.healthAdvisory === true)
    if (healthAdvisoryReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Environmental Health Advisory',
        description: `Health advisory issued due to environmental hazards. Follow guidance.`
      })
    }

    // Rule 2: AQI threshold (if sensor data available)
    if (sensorData?.aqi) {
      const aqi = Number(sensorData.aqi)
      if (aqi >= 300) {
        results.push({
          shouldAlert: true,
          severity: 'critical',
          title: 'Hazardous Air Quality',
          description: `Air Quality Index: ${aqi}. Dangerous pollution levels. Stay indoors.`
        })
      } else if (aqi >= 200) {
        results.push({
          shouldAlert: true,
          severity: 'warning',
          title: 'Unhealthy Air Quality',
          description: `Air Quality Index: ${aqi}. Elevated pollution. Limit outdoor exposure.`
        })
      } else if (aqi >= 150) {
        results.push({
          shouldAlert: true,
          severity: 'advisory',
          title: 'Moderate Air Quality',
          description: `Air Quality Index: ${aqi}. Sensitive groups should reduce prolonged outdoor exertion.`
        })
      }
    }

    // Rule 3: Report density threshold
    if (recentReports.length >= 10) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Widespread Environmental Hazard',
        description: `${recentReports.length} environmental hazard reports. Critical threshold exceeded.`
      })
    } else if (recentReports.length >= 5) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'Significant Environmental Concerns',
        description: `${recentReports.length} environmental hazard reports. Warning threshold reached.`
      })
    } else if (recentReports.length >= 2) {
      results.push({
        shouldAlert: true,
        severity: 'advisory',
        title: 'Environmental Hazard Advisory',
        description: `${recentReports.length} environmental hazard reports.`
      })
    }

    // Rule 4: Chemical spill
    const chemicalSpillReports = recentReports.filter(r => 
      r.customFields?.hazardType === 'Chemical Spill'
    )
    if (chemicalSpillReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Chemical Spill Reported',
        description: `Chemical spill incident. Evacuate area. Avoid exposure.`
      })
    }

    // Rule 5: Water contamination
    const waterContaminationReports = recentReports.filter(r => 
      r.customFields?.hazardType === 'Water Contamination'
    )
    if (waterContaminationReports.length >= 1) {
      results.push({
        shouldAlert: true,
        severity: 'critical',
        title: 'Water Contamination',
        description: `Water contamination reported. Do not consume tap water.`
      })
    }

    // Rule 6: ML prediction threshold
    const highRiskPredictions = predictions?.filter(p => p.probability > 0.7)
    if (highRiskPredictions && highRiskPredictions.length > 0) {
      results.push({
        shouldAlert: true,
        severity: 'warning',
        title: 'High Environmental Risk Forecast',
        description: `ML model predicts ${Math.round(highRiskPredictions[0].probability * 100)}% environmental hazard risk.`
      })
    }

    return results
  }
}
