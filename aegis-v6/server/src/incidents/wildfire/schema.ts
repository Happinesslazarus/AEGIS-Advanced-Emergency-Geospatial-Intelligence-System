/**
 * Wildfire and bushfire events incident module (handles wildfire specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface WildfireCustomFields {
  fireSize?: number
  windDirection?: string
  evacuationOrdered?: boolean
  containment?: number
  smokeVisible?: boolean
}

export interface WildfirePredictionData {
  hotspotCount: number
  windSpeedForecast: number
  temperatureForecast: number
  humidityForecast: number
  vegetationDryness: number
}

export function validateWildfireReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.fireSize !== undefined && typeof data.fireSize !== 'number') return false
  if (data.containment !== undefined && typeof data.containment !== 'number') return false
  if (data.evacuationOrdered !== undefined && typeof data.evacuationOrdered !== 'boolean') return false
  
  return true
}

export function sanitizeWildfireCustomFields(fields: Record<string, unknown>): WildfireCustomFields {
  return {
    fireSize: typeof fields.fireSize === 'number' ? fields.fireSize : undefined,
    windDirection: typeof fields.windDirection === 'string' ? fields.windDirection : undefined,
    evacuationOrdered: typeof fields.evacuationOrdered === 'boolean' ? fields.evacuationOrdered : undefined,
    containment: typeof fields.containment === 'number' ? Math.min(100, Math.max(0, fields.containment)) : undefined,
    smokeVisible: typeof fields.smokeVisible === 'boolean' ? fields.smokeVisible : undefined
  }
}

