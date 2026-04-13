/**
 * Module: IncidentContext.tsx
 *
 * Incident context React context provider (shares state across components).
 *
 * How it connects:
 * - Wraps components in App.tsx via AppProviders */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  apiGetIncidentRegistry,
  apiGetIncidentDashboard,
  apiGetAllIncidentPredictions,
  apiGetAllIncidentAlerts,
  type IncidentRegistryEntry,
  type IncidentDashboardSummary,
} from '../utils/incidentApi'

// Types
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

export interface LiveIncidentAlert {
  incidentType: string
  regionId: string
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical'
  probability: number
  confidence: number
  title: string
  description: string
  affectedArea?: { lat: number; lng: number; radiusKm: number }
  timestamp: string
  sourceModel?: string
}

interface IncidentContextType {
  registry: IncidentRegistryEntry[]
  registryLoading: boolean
  dashboard: IncidentDashboardSummary | null
  dashboardLoading: boolean
  filter: IncidentFilter
  setFilter: (f: Partial<IncidentFilter>) => void
  resetFilter: () => void
  selectedIncidentType: IncidentTypeId | null
  setSelectedIncidentType: (t: IncidentTypeId | null) => void
  refreshRegistry: () => Promise<void>
  refreshDashboard: () => Promise<void>
  refreshAll: () => Promise<void>
  activeIncidentCount: number
  enabledTypes: IncidentTypeId[]
  operationalTypes: IncidentTypeId[]
  getModuleByType: (type: IncidentTypeId) => IncidentRegistryEntry | undefined
  liveAlerts: LiveIncidentAlert[]
  clearLiveAlerts: () => void
}

const DEFAULT_FILTER: IncidentFilter = {
  types: [],
  severityMin: null,
  activeOnly: true,
  region: null,
}

const FALLBACK_INCIDENT_CONTEXT: IncidentContextType = {
  registry: [],
  registryLoading: false,
  dashboard: null,
  dashboardLoading: false,
  filter: DEFAULT_FILTER,
  setFilter: () => {},
  resetFilter: () => {},
  selectedIncidentType: null,
  setSelectedIncidentType: () => {},
  refreshRegistry: async () => {},
  refreshDashboard: async () => {},
  refreshAll: async () => {},
  activeIncidentCount: 0,
  enabledTypes: [],
  operationalTypes: [],
  getModuleByType: () => undefined,
  liveAlerts: [],
  clearLiveAlerts: () => {},
}

const IncidentContext = createContext<IncidentContextType | null>(null)

// Use same origin so Vite's /socket.io proxy forwards WebSocket to port 3001.
// An empty string means "connect to the same host the page was loaded from",
// which lets the Vite dev server proxy the WebSocket connection automatically.
const API_BASE = import.meta.env.VITE_API_URL ?? ''

export function IncidentProvider({ children }: { children: ReactNode }): JSX.Element {
  const [registry, setRegistry] = useState<IncidentRegistryEntry[]>([])
  const [registryLoading, setRegistryLoading] = useState(true)
  const [dashboard, setDashboard] = useState<IncidentDashboardSummary | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [filter, setFilterState] = useState<IncidentFilter>(DEFAULT_FILTER)
  const [selectedIncidentType, setSelectedIncidentType] = useState<IncidentTypeId | null>(null)
  const [liveAlerts, setLiveAlerts] = useState<LiveIncidentAlert[]>([])

  const refreshRegistry = useCallback(async () => {
    setRegistryLoading(true)
    try {
      const data = await apiGetIncidentRegistry()
      setRegistry(data.modules || data.incidents || [])
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

  const clearLiveAlerts = useCallback(() => {
    setLiveAlerts([])
  }, [])

  useEffect(() => {
    // io() opens a Socket.IO connection (WebSocket with auto-fallback to HTTP
    // long-polling).  We pass both transports explicitly so the server doesn't
    // have to negotiate from scratch on every reconnect.
    const socket: Socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    })
    // 'incident:alert' — routine incoming prediction (appended to the end of the list).
    socket.on('incident:alert', (data: LiveIncidentAlert) => {
      setLiveAlerts(prev => [...prev, data])
    })
    // 'incident:alert:priority' — high-urgency alert.  We prepend it so it
    // appears at the top, and cap the list at 50 to avoid unbounded growth.
    socket.on('incident:alert:priority', (data: LiveIncidentAlert) => {
      setLiveAlerts(prev => [data, ...prev].slice(0, 50))
    })
    // When the AI engine finishes a retrain, it emits this event.  We refresh
    // the dashboard so accuracy metrics and risk numbers are up to date.
    socket.on('incident:predictions_updated', () => {
      refreshDashboard()
    })
    return () => { socket.disconnect() }
  }, [])

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
        liveAlerts,
        clearLiveAlerts,
      }}
    >
      {children}
    </IncidentContext.Provider>
  )
}

export function useIncidents(): IncidentContextType {
  const ctx = useContext(IncidentContext)
  if (!ctx) {
    console.error('[IncidentContext] useIncidents called outside IncidentProvider — using safe fallback context')
    return FALLBACK_INCIDENT_CONTEXT
  }
  return ctx
}

