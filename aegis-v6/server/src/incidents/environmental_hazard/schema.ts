export interface EnvironmentalHazardCustomFields {
  hazardType?: 'Air Quality' | 'Water Contamination' | 'Soil Contamination' | 'Radiation' | 'Chemical Spill'
  pollutant?: string
  airQualityIndex?: number
  healthAdvisory?: boolean
  sourceIdentified?: boolean
}

export interface EnvironmentalHazardPredictionData {
  pm25Level: number
  pm10Level: number
  o3Level: number
  no2Level: number
  historicalTrend: 'improving' | 'stable' | 'worsening'
}

export function validateEnvironmentalHazardReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.airQualityIndex !== undefined && typeof data.airQualityIndex !== 'number') return false
  if (data.healthAdvisory !== undefined && typeof data.healthAdvisory !== 'boolean') return false
  if (data.sourceIdentified !== undefined && typeof data.sourceIdentified !== 'boolean') return false
  
  return true
}

export function sanitizeEnvironmentalHazardCustomFields(fields: Record<string, unknown>): EnvironmentalHazardCustomFields {
  const validTypes = ['Air Quality', 'Water Contamination', 'Soil Contamination', 'Radiation', 'Chemical Spill']
  
  return {
    hazardType: validTypes.includes(fields.hazardType as string)
      ? (fields.hazardType as EnvironmentalHazardCustomFields['hazardType'])
      : undefined,
    pollutant: typeof fields.pollutant === 'string' ? fields.pollutant : undefined,
    airQualityIndex: typeof fields.airQualityIndex === 'number' ? fields.airQualityIndex : undefined,
    healthAdvisory: typeof fields.healthAdvisory === 'boolean' ? fields.healthAdvisory : undefined,
    sourceIdentified: typeof fields.sourceIdentified === 'boolean' ? fields.sourceIdentified : undefined
  }
}

