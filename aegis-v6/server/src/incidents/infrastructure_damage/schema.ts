export interface InfrastructureDamageCustomFields {
  damageType?: 'Building' | 'Bridge' | 'Road' | 'Railway' | 'Other'
  structuralIntegrity?: 'Intact' | 'Compromised' | 'Collapsed'
  safetyHazard?: boolean
  trafficAffected?: boolean
  emergencyAccess?: boolean
}

export interface InfrastructureDamagePredictionData {
  reportClusterDensity: number
  criticalInfrastructureAffected: number
  structuralCollapseCount: number
}

export function validateInfrastructureDamageReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.safetyHazard !== undefined && typeof data.safetyHazard !== 'boolean') return false
  if (data.trafficAffected !== undefined && typeof data.trafficAffected !== 'boolean') return false
  if (data.emergencyAccess !== undefined && typeof data.emergencyAccess !== 'boolean') return false
  
  return true
}

export function sanitizeInfrastructureDamageCustomFields(fields: Record<string, unknown>): InfrastructureDamageCustomFields {
  const validDamageTypes = ['Building', 'Bridge', 'Road', 'Railway', 'Other']
  const validIntegrity = ['Intact', 'Compromised', 'Collapsed']
  
  return {
    damageType: validDamageTypes.includes(fields.damageType as string) 
      ? (fields.damageType as InfrastructureDamageCustomFields['damageType']) 
      : undefined,
    structuralIntegrity: validIntegrity.includes(fields.structuralIntegrity as string)
      ? (fields.structuralIntegrity as InfrastructureDamageCustomFields['structuralIntegrity'])
      : undefined,
    safetyHazard: typeof fields.safetyHazard === 'boolean' ? fields.safetyHazard : undefined,
    trafficAffected: typeof fields.trafficAffected === 'boolean' ? fields.trafficAffected : undefined,
    emergencyAccess: typeof fields.emergencyAccess === 'boolean' ? fields.emergencyAccess : undefined
  }
}

