/**
 * Module: schema.ts
 *
 * Extended drought conditions incident module (handles drought specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface DroughtCustomFields {
  cropDamageReported?: boolean
  waterRestrictions?: boolean
  riverLevelLow?: boolean
}

export interface DroughtPredictionData {
  rainfall30dMm: number
  baselineMm: number
  deficitMm: number
  avgTempC: number
  riskLevel: string
}

export function validateDroughtReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  if (data.cropDamageReported !== undefined && typeof data.cropDamageReported !== 'boolean') return false
  if (data.waterRestrictions !== undefined && typeof data.waterRestrictions !== 'boolean') return false
  if (data.riverLevelLow !== undefined && typeof data.riverLevelLow !== 'boolean') return false
  return true
}

export function sanitizeDroughtCustomFields(fields: Record<string, unknown>): DroughtCustomFields {
  return {
    cropDamageReported: typeof fields.cropDamageReported === 'boolean' ? fields.cropDamageReported : undefined,
    waterRestrictions:  typeof fields.waterRestrictions  === 'boolean' ? fields.waterRestrictions  : undefined,
    riverLevelLow:      typeof fields.riverLevelLow      === 'boolean' ? fields.riverLevelLow      : undefined,
  }
}

