/**
 * Water supply disruptions incident module (handles water supply specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface WaterSupplyCustomFields {
  disruptionType?: 'No Water' | 'Low Pressure' | 'Contamination' | 'Boil Advisory'
  affectedHouseholds?: number
  waterQualityIssue?: boolean
  estimatedDuration?: number
  alternativeSupply?: boolean
}

export interface WaterSupplyPredictionData {
  reportClusterDensity: number
  affectedAreaSize: number
  contaminationReportsCount: number
}

export function validateWaterSupplyReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.affectedHouseholds !== undefined && typeof data.affectedHouseholds !== 'number') return false
  if (data.estimatedDuration !== undefined && typeof data.estimatedDuration !== 'number') return false
  if (data.waterQualityIssue !== undefined && typeof data.waterQualityIssue !== 'boolean') return false
  
  return true
}

export function sanitizeWaterSupplyCustomFields(fields: Record<string, unknown>): WaterSupplyCustomFields {
  const validTypes = ['No Water', 'Low Pressure', 'Contamination', 'Boil Advisory']
  return {
    disruptionType: validTypes.includes(fields.disruptionType as string) 
      ? (fields.disruptionType as WaterSupplyCustomFields['disruptionType']) 
      : undefined,
    affectedHouseholds: typeof fields.affectedHouseholds === 'number' ? fields.affectedHouseholds : undefined,
    waterQualityIssue: typeof fields.waterQualityIssue === 'boolean' ? fields.waterQualityIssue : undefined,
    estimatedDuration: typeof fields.estimatedDuration === 'number' ? fields.estimatedDuration : undefined,
    alternativeSupply: typeof fields.alternativeSupply === 'boolean' ? fields.alternativeSupply : undefined
  }
}

