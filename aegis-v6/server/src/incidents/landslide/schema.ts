/**
 * Ground movement and landslides incident module (handles landslide specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface LandslideCustomFields {
  slopeAngle?: number
  soilMoisture?: number
  recentRainfall?: number
  roadBlocked?: boolean
  structuresDamaged?: boolean
}

export interface LandslidePredictionData {
  rainfall24h: number
  rainfall72h: number
  slopeStability: number
  geologicalRiskScore: number
}

export function validateLandslideReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.slopeAngle !== undefined && typeof data.slopeAngle !== 'number') return false
  if (data.soilMoisture !== undefined && typeof data.soilMoisture !== 'number') return false
  if (data.recentRainfall !== undefined && typeof data.recentRainfall !== 'number') return false
  
  return true
}

export function sanitizeLandslideCustomFields(fields: Record<string, unknown>): LandslideCustomFields {
  return {
    slopeAngle: typeof fields.slopeAngle === 'number' ? fields.slopeAngle : undefined,
    soilMoisture: typeof fields.soilMoisture === 'number' ? fields.soilMoisture : undefined,
    recentRainfall: typeof fields.recentRainfall === 'number' ? fields.recentRainfall : undefined,
    roadBlocked: typeof fields.roadBlocked === 'boolean' ? fields.roadBlocked : undefined,
    structuresDamaged: typeof fields.structuresDamaged === 'boolean' ? fields.structuresDamaged : undefined
  }
}

