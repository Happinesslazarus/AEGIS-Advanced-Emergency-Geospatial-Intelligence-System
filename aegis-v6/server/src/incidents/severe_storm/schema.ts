export interface SevereStormCustomFields {
  windSpeed?: number
  rainfall?: number
  lightningDetected?: boolean
  damageType?: string[]
  roadsClosed?: boolean
}

export interface SevereStormPredictionData {
  windGustForecast: number
  precipitationForecast: number
  pressureTrend: 'rising' | 'stable' | 'falling'
  weatherCode: number
}

export function validateSevereStormReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.windSpeed !== undefined && typeof data.windSpeed !== 'number') return false
  if (data.rainfall !== undefined && typeof data.rainfall !== 'number') return false
  if (data.lightningDetected !== undefined && typeof data.lightningDetected !== 'boolean') return false
  
  return true
}

export function sanitizeSevereStormCustomFields(fields: Record<string, unknown>): SevereStormCustomFields {
  return {
    windSpeed: typeof fields.windSpeed === 'number' ? fields.windSpeed : undefined,
    rainfall: typeof fields.rainfall === 'number' ? fields.rainfall : undefined,
    lightningDetected: typeof fields.lightningDetected === 'boolean' ? fields.lightningDetected : undefined,
    damageType: Array.isArray(fields.damageType) ? fields.damageType : undefined,
    roadsClosed: typeof fields.roadsClosed === 'boolean' ? fields.roadsClosed : undefined
  }
}

