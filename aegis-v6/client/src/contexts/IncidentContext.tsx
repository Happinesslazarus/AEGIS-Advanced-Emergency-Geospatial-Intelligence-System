/**
 * IncidentContext — React context for multi-incident state management
 *
 * Provides:
 * - Incident registry (types, status, AI tiers)
 * - Active incident filtering for dashboards
 * - Cross-incident dashboard summary
 * - Loading/error state
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import {
  apiGetIncidentRegistry,
  apiGetIncidentDashboard,
  apiGetAllIncidentPredictions,
  apiGetAllIncidentAlerts,
  type IncidentRegistryEntry,
  type IncidentDashboardSummary,
} from '../utils/incidentApi'

// ─── Types ──────────────────────────────────────────────────────────────
export type IncidentTypeId =
  | 'flood' | 'severe_storm' | 'heatwave' | 'wildfire' | 'landslide'
  | 'power_outage' | 'water_supply' | 'infrastructure_damage'
  | 'public_safety' | 'environmental_hazard' | 'drought'

export interface IncidentFilter {
  types: IncidentTypeId[]       // empty = all types
  severityMin: 'low' | 'medium' | 'high' | 'critical' | null
  activeOnly: boolean
  region: string | null
}

interface IncidentContextType {
  // Registry
  registry: IncidentRegistryEntry[]
  registryLoading: boolean

  // Dashboard summary
  dashboard: IncidentDashboardSummary | null
  dashboardLoading: boolean

  // Filtering
  filter: IncidentFilter
  setFilter: (f: Partial<IncidentFilter>) => void
  resetFilter: () => void
  selectedIncidentType: IncidentTypeId | null
  setSelectedIncidentType: (t: IncidentTypeId | null) => void

  // Actions
  refreshRegistry: () => Promise<void>
  refreshDashboard: () => Promise<void>
  refreshAll: () => Promise<void>

  // Derived state
  activeIncidentCount: number
  enabledTypes: IncidentTypeId[]
  operationalTypes: IncidentTypeId[]
  getModuleByType: (type: IncidentTypeId) => IncidentRegistryEntry | undefined
}

const DEFAULT_FILTER: IncidentFilter = {
  types: [],
  severityMin: null,
  activeOnly: true,
  region: null,
}

const IncidentContext = createContext<IncidentContextType | null>(null)

// ─── Provider ───────────────────────────────────────────────────────────
export function IncidentProvider({ children }: { children: ReactNode }): JSX.Element {
  const [registry, setRegistry] = useState<IncidentRegistryEntry[]>([])
  const [registryLoading, setRegistryLoading] = useState(true)
  const [dashboard, setDashboard] = useState<IncidentDashboardSummary | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [filter, setFilterState] = useState<IncidentFilter>(DEFAULT_FILTER)
  const [selectedIncidentType, setSelectedIncidentType] = useState<IncidentTypeId | null>(null)

  const refreshRegistry = useCallback(async () => {
    setRegistryLoading(true)
    try {
      const data = await apiGetIncidentRegistry()
      setRegistry(data.modules || [])
    } catch (err) {
      console.error('[IncidentContext] Failed to load registry:', err)
    } finally {
      setRegistryLoading(false)
    }
  }, [])

  const refreshDashboard = useCallback(async () => {
    setDashboardLoading(true)
    try {
      const data = await apiGetIncidentDashboard()
      setDashboard(data)
    } catch (err) {
      console.error('[IncidentContext] Failed to load dashboard:', err)
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshRegistry(), refreshDashboard()])
  }, [refreshRegistry, refreshDashboard])

  const setFilter = useCallback((partial: Partial<IncidentFilter>) => {
    setFilterState(prev => ({ ...prev, ...partial }))
  }, [])

  const resetFilter = useCallback(() => {
    setFilterState(DEFAULT_FILTER)
    setSelectedIncidentType(null)
  }, [])

  // Derived state
  const enabledTypes = registry
    .filter(m => m.operationalStatus !== 'disabled')
    .map(m => m.id as IncidentTypeId)

  const operationalTypes = registry
    .filter(m => m.operationalStatus === 'fully_operational' || m.operationalStatus === 'partial')
    .map(m => m.id as IncidentTypeId)

  const activeIncidentCount = dashboard
    ? Object.values(dashboard.incidents || {}).reduce(
        (sum, inc: any) => sum + (inc?.predictions?.length || 0) + (inc?.alerts?.length || 0),
        0,
      )
    : 0

  const getModuleByType = useCallback(
    (type: IncidentTypeId) => registry.find(m => m.id === type),
    [registry],
  )

  // Load registry on mount
  useEffect(() => {
    refreshRegistry()
  }, [refreshRegistry])

  return (
    <IncidentContext.Provider
      value={{
        registry,
        registryLoading,
        dashboard,
        dashboardLoading,
        filter,
        setFilter,
        resetFilter,
        selectedIncidentType,
        setSelectedIncidentType,
        refreshRegistry,
        refreshDashboard,
        refreshAll,
        activeIncidentCount,
        enabledTypes,
        operationalTypes,
        getModuleByType,
      }}
    >
      {children}
    </IncidentContext.Provider>
  )
}

// ─── Hook ───────────────────────────────────────────────────────────────
export function useIncidents(): IncidentContextType {
  const ctx = useContext(IncidentContext)
  if (!ctx) throw new Error('useIncidents must be used within IncidentProvider')
  return ctx
}
