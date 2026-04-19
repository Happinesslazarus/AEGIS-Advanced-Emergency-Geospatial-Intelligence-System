/**
 * Module: schema.ts
 *
 * River and surface water flooding incident module (handles flood specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface FloodCustomFields {
  waterLevel?: number
  affectedArea?: string
  evacuationNeeded?: boolean
  propertyDamage?: 'None' | 'Minor' | 'Moderate' | 'Severe'
  riverName?: string
}

export interface FloodPredictionData {
  riverGaugeId?: string
  waterLevelTrend: 'rising' | 'stable' | 'falling'
  forecastRainfall: number
  soilSaturation: number
  historicalRisk: number
}

export function validateFloodReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.waterLevel !== undefined && typeof data.waterLevel !== 'number') return false
  if (data.evacuationNeeded !== undefined && typeof data.evacuationNeeded !== 'boolean') return false
  
  return true
}

export function sanitizeFloodCustomFields(fields: Record<string, unknown>): FloodCustomFields {
  return {
    waterLevel: typeof fields.waterLevel === 'number' ? fields.waterLevel : undefined,
    affectedArea: typeof fields.affectedArea === 'string' ? fields.affectedArea : undefined,
    evacuationNeeded: typeof fields.evacuationNeeded === 'boolean' ? fields.evacuationNeeded : undefined,
    propertyDamage: ['None', 'Minor', 'Moderate', 'Severe'].includes(fields.propertyDamage as string)
      ? (fields.propertyDamage as FloodCustomFields['propertyDamage'])
      : undefined,
    riverName: typeof fields.riverName === 'string' ? fields.riverName : undefined
  }
}

