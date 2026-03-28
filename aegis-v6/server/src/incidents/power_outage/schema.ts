/**
 * incidents/power_outage/schema.ts — Power Outage report validation schema
 */

export interface PowerOutageCustomFields {
  affectedHouseholds?: number
  cause?: 'Storm' | 'Equipment Failure' | 'Maintenance' | 'Unknown'
  criticalFacility?: boolean
  estimatedRepairTime?: number
  backupPowerAvailable?: boolean
}

export interface PowerOutagePredictionData {
  reportClusterDensity: number
  affectedAreaSize: number
  criticalFacilitiesCount: number
}

export function validatePowerOutageReport(data: Record<string, unknown>): boolean {
  if (!data.title || typeof data.title !== 'string') return false
  if (!data.severity || typeof data.severity !== 'string') return false
  
  const validSeverities = ['Low', 'Medium', 'High', 'Critical']
  if (!validSeverities.includes(data.severity as string)) return false
  
  if (data.affectedHouseholds !== undefined && typeof data.affectedHouseholds !== 'number') return false
  if (data.estimatedRepairTime !== undefined && typeof data.estimatedRepairTime !== 'number') return false
  if (data.criticalFacility !== undefined && typeof data.criticalFacility !== 'boolean') return false
  
  return true
}

export function sanitizePowerOutageCustomFields(fields: Record<string, unknown>): PowerOutageCustomFields {
  const validCauses = ['Storm', 'Equipment Failure', 'Maintenance', 'Unknown']
  return {
    affectedHouseholds: typeof fields.affectedHouseholds === 'number' ? fields.affectedHouseholds : undefined,
    cause: validCauses.includes(fields.cause as string) ? (fields.cause as PowerOutageCustomFields['cause']) : undefined,
    criticalFacility: typeof fields.criticalFacility === 'boolean' ? fields.criticalFacility : undefined,
    estimatedRepairTime: typeof fields.estimatedRepairTime === 'number' ? fields.estimatedRepairTime : undefined,
    backupPowerAvailable: typeof fields.backupPowerAvailable === 'boolean' ? fields.backupPowerAvailable : undefined
  }
}
