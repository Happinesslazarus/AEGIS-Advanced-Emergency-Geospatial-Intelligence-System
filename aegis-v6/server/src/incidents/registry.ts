/**
 * Incident module registry (central lookup for all 11 incident types).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

import type { IncidentModule, IncidentRegistryEntry, IncidentOperationalStatus } from './types.js'

// Import all incident modules

import flood from './flood/index.js'
import severeStorm from './severe_storm/index.js'
import heatwave from './heatwave/index.js'
import wildfire from './wildfire/index.js'
import landslide from './landslide/index.js'
import powerOutage from './power_outage/index.js'
import waterSupply from './water_supply/index.js'
import infrastructureDamage from './infrastructure_damage/index.js'
import publicSafety from './public_safety/index.js'
import environmentalHazard from './environmental_hazard/index.js'
import drought from './drought/index.js'

// Registry

const MODULES: IncidentModule[] = [
  flood,
  severeStorm,
  heatwave,
  wildfire,
  landslide,
  powerOutage,
  waterSupply,
  infrastructureDamage,
  publicSafety,
  environmentalHazard,
  drought,
]

const moduleMap = new Map<string, IncidentModule>()
for (const mod of MODULES) {
  moduleMap.set(mod.id, mod)
}

// Public API

/* Get a specific incident module by ID */
export function getIncidentModule(id: string): IncidentModule | undefined {
  return moduleMap.get(id)
}

/* Get all registered incident modules */
export function getAllIncidentModules(): IncidentModule[] {
  return MODULES
}

/* Get all incident registry entries (metadata only) */
export function getAllIncidentRegistries(): IncidentRegistryEntry[] {
  return MODULES.map(m => m.registry)
}

/* Get modules filtered by operational status */
export function getModulesByStatus(status: IncidentOperationalStatus): IncidentModule[] {
  return MODULES.filter(m => m.registry.operationalStatus === status)
}

/* Get only fully operational modules (for public-facing interfaces) */
export function getOperationalModules(): IncidentModule[] {
  return MODULES.filter(m =>
    m.registry.operationalStatus === 'fully_operational' ||
    m.registry.operationalStatus === 'partial'
  )
}

/* Get modules enabled for a specific region */
export function getModulesForRegion(regionId: string): IncidentModule[] {
  return MODULES.filter(m => {
    if (m.registry.enabledRegions === 'all') return true
    return m.registry.enabledRegions.includes(regionId)
  })
}

/* Check if an incident type is registered */
export function isRegistered(id: string): boolean {
  return moduleMap.has(id)
}

/* List all incident IDs */
export function listIncidentIds(): string[] {
  return MODULES.map(m => m.id)
}

/* Get dashboard summary across all incidents for a region */
export async function getDashboardSummary(region: string): Promise<{
  incidents: Array<{
    id: string
    name: string
    icon: string
    color: string
    status: IncidentOperationalStatus
    aiTier: string
    activePredictions: number
    activeAlerts: number
    activeReports: number
  }>
  totalAlerts: number
  totalPredictions: number
}> {
  const operational = getOperationalModules()
  const incidents = await Promise.all(
    operational.map(async (mod) => {
      try {
        const [predictions, alerts] = await Promise.all([
          mod.getPredictions(region).catch(() => []),
          mod.getAlerts(region).catch(() => []),
        ])
        return {
          id: mod.id,
          name: mod.registry.name,
          icon: mod.registry.icon,
          color: mod.registry.color,
          status: mod.registry.operationalStatus,
          aiTier: mod.registry.aiTier,
          activePredictions: predictions.length,
          activeAlerts: alerts.length,
          activeReports: 0, // Could query DB but keep fast
        }
      } catch {
        return {
          id: mod.id,
          name: mod.registry.name,
          icon: mod.registry.icon,
          color: mod.registry.color,
          status: mod.registry.operationalStatus,
          aiTier: mod.registry.aiTier,
          activePredictions: 0,
          activeAlerts: 0,
          activeReports: 0,
        }
      }
    })
  )

  return {
    incidents,
    totalAlerts: incidents.reduce((s, i) => s + i.activeAlerts, 0),
    totalPredictions: incidents.reduce((s, i) => s + i.activePredictions, 0),
  }
}

export { MODULES }
export type { IncidentModule } from './types.js'

