/**
 * incidentApi.ts — V1 Incident API client
 *
 * Interfaces with the new /api/v1/incidents/* endpoints while
 * keeping backward compatibility with existing /api/* routes.
 */

const BASE = String(import.meta.env.VITE_API_BASE_URL || '')
const V1 = `${BASE}/api/v1/incidents`

function getToken(): string | null {
  return localStorage.getItem('aegis-token')
}

async function v1Fetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  const h: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (token) h['Authorization'] = `Bearer ${token}`
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${V1}${path}`, { ...opts, headers: h })
  } catch {
    throw new Error('Cannot connect to incident API.')
  }

  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(e.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface IncidentRegistryEntry {
  id: string
  name: string
  category: string
  icon: string
  color: string
  description: string
  operationalStatus: 'fully_operational' | 'partial' | 'configured_only' | 'disabled'
  aiTier: 'rule_based' | 'statistical' | 'ml'
  supportedRegions: string[]
  enabledRegions: string[]
  dataSources: string[]
  version: string
}

export interface IncidentPrediction {
  incidentType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  probability: number
  location: { lat: number; lng: number; name?: string }
  validFrom: string
  validTo: string
  confidence: number
  confidenceSource: 'ml_model' | 'statistical' | 'rule_based'
  details?: Record<string, unknown>
}

export interface IncidentAlert {
  id: string
  incidentType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  message: string
  location?: { lat: number; lng: number; name?: string }
  issuedAt: string
  expiresAt?: string
  source: string
  acknowledged: boolean
}

export interface IncidentMapMarker {
  id: string
  incidentType: string
  lat: number
  lng: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  details?: Record<string, unknown>
  timestamp: string
  source: 'report' | 'sensor' | 'prediction' | 'alert'
}

export interface IncidentMapData {
  incidentType: string
  markers: IncidentMapMarker[]
  geojsonLayers?: Array<{
    name: string
    type: 'polygon' | 'line' | 'heatmap'
    data: GeoJSON.FeatureCollection
  }>
}

export interface IncidentDashboardIncident {
  id: string
  name: string
  icon: string
  color: string
  status: string
  aiTier: string
  activePredictions: number
  activeAlerts: number
  activeReports: number
}

export interface IncidentDashboardSummary {
  region: string
  generatedAt?: string
  incidents: IncidentDashboardIncident[]
  totalAlerts: number
  totalPredictions: number
}

// ─── Cross-incident endpoints ───────────────────────────────────────────

/** Get all registered incident modules and their status */
export async function apiGetIncidentRegistry(): Promise<{ modules: IncidentRegistryEntry[] }> {
  return v1Fetch('/registry')
}

/** Get dashboard summary for all operational incidents */
export async function apiGetIncidentDashboard(region?: string): Promise<IncidentDashboardSummary> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/all/dashboard${q}`)
}

/** Get all predictions across all incident types */
export async function apiGetAllIncidentPredictions(region?: string): Promise<{
  predictions: IncidentPrediction[]
  count: number
  region: string
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/all/predictions${q}`)
}

/** Get all alerts across all incident types */
export async function apiGetAllIncidentAlerts(): Promise<{
  alerts: IncidentAlert[]
  count: number
  region: string
}> {
  return v1Fetch('/all/alerts')
}

/** Get all map data across all incident types */
export async function apiGetAllIncidentMapData(region?: string): Promise<{
  layers: IncidentMapData[]
  region: string
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/all/map-data${q}`)
}

// ─── Per-incident endpoints ─────────────────────────────────────────────

/** Get active incidents for a specific type */
export async function apiGetIncidentActive(type: string, region?: string): Promise<{
  reports: any[]
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/${type}/active${q}`)
}

/** Get predictions for a specific incident type */
export async function apiGetIncidentPredictions(type: string, region?: string): Promise<{
  predictions: IncidentPrediction[]
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/${type}/predictions${q}`)
}

/** Get alerts for a specific incident type */
export async function apiGetIncidentAlerts(type: string): Promise<{
  alerts: IncidentAlert[]
}> {
  return v1Fetch(`/${type}/alerts`)
}

/** Get map data for a specific incident type */
export async function apiGetIncidentMapData(type: string, region?: string): Promise<IncidentMapData> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/${type}/map-data${q}`)
}

/** Get history for a specific incident type */
export async function apiGetIncidentHistory(type: string, days = 30): Promise<{
  history: any[]
}> {
  return v1Fetch(`/${type}/history?days=${days}`)
}

/** Submit a report for a specific incident type */
export async function apiSubmitIncidentReport(
  type: string,
  data: {
    lat: number
    lng: number
    severity: string
    description: string
    reporter_name?: string
    reporter_contact?: string
    metadata?: Record<string, unknown>
  },
): Promise<{ report: any }> {
  return v1Fetch(`/${type}/report`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ─── Flood-specific endpoints (backward compat) ────────────────────────

/** Flood threat level */
export async function apiGetFloodThreat(): Promise<any> {
  return v1Fetch('/flood/threat')
}

/** Flood evacuation route */
export async function apiGetFloodEvacuationRoute(
  lat: number,
  lng: number,
  severity: string,
): Promise<any> {
  return v1Fetch(`/flood/evacuation/route?lat=${lat}&lng=${lng}&severity=${severity}`)
}

/** Flood evacuation routes for a region */
export async function apiGetFloodEvacuationRoutes(region?: string): Promise<any> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/flood/evacuation/routes${q}`)
}

/** Flood extents for a river */
export async function apiGetFloodExtents(river: string): Promise<any> {
  return v1Fetch(`/flood/extents/${encodeURIComponent(river)}`)
}
