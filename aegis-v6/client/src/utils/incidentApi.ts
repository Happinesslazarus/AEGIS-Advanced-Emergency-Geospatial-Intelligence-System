/**
 * HTTP client functions for AEGIS's multi-incident plugin system.
 * All requests target the /api/v1/incidents versioned prefix and are
 * authenticated with a Bearer token via the shared v1Fetch helper.
 *
 * This file is intentionally separate from the main reports API because
 * incident modules carry plugin-specific fields (aiTier, operationalStatus,
 * supportedRegions) not present on generic citizen reports.
 *
 * Glossary:
 *   /api/v1/incidents = the versioned REST prefix for all incident module routes;
 *                       'v1' allows future breaking changes without breaking old clients
 *   Bearer token      = Authorization header value of the form 'Bearer <JWT>';
 *                       proves the caller is authenticated
 *   v1Fetch           = internal thin HTTP wrapper; injects the Bearer token,
 *                       sets Content-Type, and maps non-200 responses to thrown errors
 *   FormData          = browser API for multipart form submissions;
 *                       Content-Type must NOT be manually set for FormData bodies
 *                       (the browser auto-sets the boundary parameter)
 *   aiTier            = which AI approach a module uses:
 *                         'rule_based' = hand-coded rules (no ML)
 *                         'statistical' = aggregated statistics / thresholds
 *                         'ml' = trained machine-learning model
 *   operationalStatus = lifecycle state of an incident module:
 *                         'fully_operational' | 'partial' | 'configured_only' | 'disabled'
 *   confidence        = 0-100 score measuring how certain a prediction is
 *   confidenceSource  = which engine generated the confidence value
 *   severity          = incident danger level: 'low' | 'medium' | 'high' | 'critical'
 *   IncidentRegistryEntry = per-plugin metadata record returned by the /registry endpoint
 *   IncidentPrediction    = AI-generated forecast for a future incident event
 *   IncidentAlert         = active warning that has been issued for an ongoing event
 *   IncidentMapMarker     = a pinned point on the live map (report, sensor, prediction, etc.)
 *   IncidentMapData       = all markers + optional GeoJSON polygon layers for one incident type
 *   IncidentDashboardSummary = rolled-up statistics for the incidents command console
 *   encodeURIComponent    = URL-safe encoding of parameter values; prevents injection via
 *                           special characters in region or type strings
 *
 * - Used by client/src/components/admin/IncidentCommandConsole.tsx
 * - Server routes: server/src/routes/incidentRoutes.ts (mounted at /api/v1/incidents)
 */

import { getToken } from './api'

//VITE_API_BASE_URL is injected by Vite at build time from .env files;
//falls back to empty string so paths resolve to the same origin in production
const BASE = String(import.meta.env.VITE_API_BASE_URL || '')
//V1 is the versioned base URL appended to every fetch call in this module
const V1 = `${BASE}/api/v1/incidents`

//Internal HTTP helper

/**
 * Thin fetch wrapper for all v1 incident API calls.
 * - Attaches the JWT Bearer token from storage (if present)
 * - Automatically sets Content-Type: application/json unless body is FormData
 * - Throws a descriptive Error for any non-2xx response
 */
async function v1Fetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken() // retrieve the current JWT from in-memory storage
  const h: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (token) h['Authorization'] = `Bearer ${token}`
  //Skip Content-Type for FormData -- browser sets it automatically with the correct boundary
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json'
  //CSRF double-submit for state-changing requests
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  if (!safeMethods.includes((opts.method || 'GET').toUpperCase())) {
    const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
    if (csrfToken) h['X-CSRF-Token'] = csrfToken
  }

  let res: Response
  try {
    res = await fetch(`${V1}${path}`, { ...opts, headers: h })
  } catch {
    //Network error (no connection, CORS failure, etc.) -- give a human-readable message
    throw new Error('Cannot connect to incident API.')
  }

  if (!res.ok) {
    //Extract the error message from the JSON body if available, otherwise use the HTTP status
    const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    const errMsg = typeof e.error === 'string' ? e.error : e.error?.message || e.message || `HTTP ${res.status}`
    throw new Error(errMsg)
  }
  return res.json() as Promise<T>
}

//TypeScript interfaces -- shape of data returned by the incident API

/** Metadata record for a single incident plugin (e.g. 'flood', 'wildfire') */
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

/** One AI-generated forecast: probability, location, confidence, and validity window */
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

/** An active alert issued for an ongoing incident event */
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

/** A point on the live map from any source (report, sensor, prediction, or alert) */
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

/** All map data for one incident type: pin markers + optional polygon overlay layers */
export interface IncidentMapData {
  incidentType: string
  markers: IncidentMapMarker[]
  geojsonLayers?: Array<{
    name: string
    type: 'polygon' | 'line' | 'heatmap'
    data: GeoJSON.FeatureCollection
  }>
}

/** Per-module counts for the incidents command console dashboard row */
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

/** Top-level dashboard response: summary counts + per-module breakdown */
export interface IncidentDashboardSummary {
  region: string
  generatedAt?: string
  incidents: IncidentDashboardIncident[]
  totalAlerts: number
  totalPredictions: number
}

//Cross-incident endpoints -- aggregate data across all incident types

/** Fetches all registered incident modules and their operational status from /registry */
export async function apiGetIncidentRegistry(): Promise<{ modules: IncidentRegistryEntry[]; incidents?: IncidentRegistryEntry[] }> {
  return v1Fetch('/registry')
}

/** Fetches dashboard summary (counts, statuses) for all operational incidents.
 *  Optionally scoped to a region; region param is URL-encoded to prevent injection. */
export async function apiGetIncidentDashboard(region?: string): Promise<IncidentDashboardSummary> {
  const q = region ? `?region=${encodeURIComponent(region)}` : '' // encodeURIComponent prevents special chars breaking the URL
  return v1Fetch(`/all/dashboard${q}`)
}

/** Fetches current AI predictions across all incident types, optionally filtered by region */
export async function apiGetAllIncidentPredictions(region?: string): Promise<{
  predictions: IncidentPrediction[]
  count: number
  region: string
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/all/predictions${q}`)
}

/** Fetches all active alerts across all incident types */
export async function apiGetAllIncidentAlerts(): Promise<{
  alerts: IncidentAlert[]
  count: number
  region: string
}> {
  return v1Fetch('/all/alerts')
}

/** Fetches all map markers and polygon overlays across all incident types */
export async function apiGetAllIncidentMapData(region?: string): Promise<{
  layers: IncidentMapData[]
  region: string
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/all/map-data${q}`)
}

//Per-incident-type endpoints -- data scoped to a specific incident plugin

/** Fetches reports currently flagged as active for the given incident type */
export async function apiGetIncidentActive(type: string, region?: string): Promise<{
  reports: any[]
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/${type}/active${q}`)
}

/** Fetches AI predictions for a specific incident type, e.g. 'flood' */
export async function apiGetIncidentPredictions(type: string, region?: string): Promise<{
  predictions: IncidentPrediction[]
}> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/${type}/predictions${q}`)
}

/** Fetches all active alerts for a specific incident type */
export async function apiGetIncidentAlerts(type: string): Promise<{
  alerts: IncidentAlert[]
}> {
  return v1Fetch(`/${type}/alerts`)
}

/** Fetches map markers and GeoJSON overlays for a specific incident type */
export async function apiGetIncidentMapData(type: string, region?: string): Promise<IncidentMapData> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/${type}/map-data${q}`)
}

/** Fetches historical event data for a specific incident type.
 *  days defaults to 30 (one month lookback) */
export async function apiGetIncidentHistory(type: string, days = 30): Promise<{
  history: any[]
}> {
  return v1Fetch(`/${type}/history?days=${days}`)
}

/** Submits a new citizen incident report for a specific incident type.
 *  lat/lng are WGS-84 decimal degrees; metadata is optional incident-type-specific data */
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

//Flood-specific endpoints -- kept for backward compatibility with pre-plugin code

/** Returns the current flood threat level (SEPA and AI combined) */
export async function apiGetFloodThreat(): Promise<any> {
  return v1Fetch('/flood/threat')
}

/** Calculates an evacuation route from a given lat/lng coordinate for a
 *  flood event of the specified severity; returns route geometry and waypoints */
export async function apiGetFloodEvacuationRoute(
  lat: number,
  lng: number,
  severity: string,
): Promise<any> {
  return v1Fetch(`/flood/evacuation/route?lat=${lat}&lng=${lng}&severity=${severity}`)
}

/** Returns all pre-computed evacuation routes for a region's flood zones */
export async function apiGetFloodEvacuationRoutes(region?: string): Promise<any> {
  const q = region ? `?region=${encodeURIComponent(region)}` : ''
  return v1Fetch(`/flood/evacuation/routes${q}`)
}

/** Returns flood-risk polygon extent data for a named river */
export async function apiGetFloodExtents(river: string): Promise<any> {
  return v1Fetch(`/flood/extents/${encodeURIComponent(river)}`)
}

