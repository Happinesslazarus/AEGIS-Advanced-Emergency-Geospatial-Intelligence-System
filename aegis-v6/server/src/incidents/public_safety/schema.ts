/**
 * Public safety incidents incident module (handles public safety specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface PublicSafetyCustomFields {
  incidentType?: 'Suspicious Activity' | 'Hazmat' | 'Civil Disturbance' | 'Missing Person' | 'Other'
  policeNotified?: boolean
  areaSecured?: boolean
  publicAtRisk?: boolean
  evacuationNeeded?: boolean
}

export interface PublicSafetyPredictionData {
  reportClusterDensity: number
  highPriorityIncidents: number
  areasSafetyScore: number
}

export function validatePublicSafetyReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.policeNotified !== undefined && typeof data.policeNotified !== 'boolean') return false
  if (data.areaSecured !== undefined && typeof data.areaSecured !== 'boolean') return false
  if (data.publicAtRisk !== undefined && typeof data.publicAtRisk !== 'boolean') return false
  
  return true
}

export function sanitizePublicSafetyCustomFields(fields: Record<string, unknown>): PublicSafetyCustomFields {
  const validTypes = ['Suspicious Activity', 'Hazmat', 'Civil Disturbance', 'Missing Person', 'Other']
  
  return {
    incidentType: validTypes.includes(fields.incidentType as string)
      ? (fields.incidentType as PublicSafetyCustomFields['incidentType'])
      : undefined,
    policeNotified: typeof fields.policeNotified === 'boolean' ? fields.policeNotified : undefined,
    areaSecured: typeof fields.areaSecured === 'boolean' ? fields.areaSecured : undefined,
    publicAtRisk: typeof fields.publicAtRisk === 'boolean' ? fields.publicAtRisk : undefined,
    evacuationNeeded: typeof fields.evacuationNeeded === 'boolean' ? fields.evacuationNeeded : undefined
  }
}

