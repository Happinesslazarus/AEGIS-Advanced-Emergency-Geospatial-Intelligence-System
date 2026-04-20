/**
 * Extreme heat events incident module (handles heatwave specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface HeatwaveCustomFields {
  temperature?: number
  humidity?: number
  heatIndex?: number
  vulnerablePopulation?: boolean
  coolingCentersOpen?: boolean
}

export interface HeatwavePredictionData {
  forecastTemperature: number
  forecastHumidity: number
  consecutiveDays: number
  nighttimeTemperature: number
}

export function validateHeatwaveReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.temperature !== undefined && typeof data.temperature !== 'number') return false
  if (data.humidity !== undefined && typeof data.humidity !== 'number') return false
  if (data.heatIndex !== undefined && typeof data.heatIndex !== 'number') return false
  
  return true
}

export function sanitizeHeatwaveCustomFields(fields: Record<string, unknown>): HeatwaveCustomFields {
  return {
    temperature: typeof fields.temperature === 'number' ? fields.temperature : undefined,
    humidity: typeof fields.humidity === 'number' ? fields.humidity : undefined,
    heatIndex: typeof fields.heatIndex === 'number' ? fields.heatIndex : undefined,
    vulnerablePopulation: typeof fields.vulnerablePopulation === 'boolean' ? fields.vulnerablePopulation : undefined,
    coolingCentersOpen: typeof fields.coolingCentersOpen === 'boolean' ? fields.coolingCentersOpen : undefined
  }
}

