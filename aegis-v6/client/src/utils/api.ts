const BASE = String(import.meta.env.VITE_API_BASE_URL || '')
const DEFAULT_REGION = String(import.meta.env.VITE_DEFAULT_REGION || 'scotland')

// In-Memory Token Storage (XSS-safe)
// Access tokens are stored in a module-scoped variable, NOT in localStorage.
// This prevents XSS attacks from stealing JWT tokens.
// On page reload, /api/auth/refresh (using httpOnly cookie) fetches a new token.

let _accessToken: string | null = null
let _refreshTimer: ReturnType<typeof setTimeout> | null = null
let _refreshReady: Promise<void> | null = null

export function scheduleTokenRefresh(token?: string): void {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null }
  const t = token || _accessToken
  if (!t) return
  try {
    const parts = t.split('.')
    if (parts.length !== 3) return
    const { exp } = JSON.parse(atob(parts[1]))
    if (!exp) return
    const msUntilRefresh = exp * 1000 - Date.now() - 5 * 60 * 1000 // 5 min before expiry
    if (msUntilRefresh <= 0) { _doRefresh(); return }
    _refreshTimer = setTimeout(_doRefresh, msUntilRefresh)
  } catch { /* ignore */ }
}

async function _doRefresh(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (!res.ok) { console.warn('[API] Silent refresh failed — user will need to log in again'); return }
    const { token } = await res.json()
    if (token) {
      _accessToken = token
      scheduleTokenRefresh(token)
    }
  } catch (err) { console.warn('[API] Silent refresh error:', err) }
}

// On page load, attempt a silent refresh to recover the session from the
// httpOnly refresh cookie. This replaces reading the token from localStorage.
_refreshReady = _doRefresh()

/* Get the current in-memory access token (admin/operator) */
export function getToken(): string | null {
  return _accessToken
}

/* Get the best available token (citizen or admin) for shared components */
export function getAnyToken(): string | null {
  return _accessToken || localStorage.getItem('aegis-citizen-token')
}

export function setToken(t: string): void {
  _accessToken = t
  scheduleTokenRefresh(t)
}

export function clearToken(): void {
  _accessToken = null
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null }
  localStorage.removeItem('aegis-user')
  localStorage.removeItem('aegis-citizen-user')
}

/* Wait for the initial silent refresh to complete before making API calls */
export async function waitForAuth(): Promise<void> {
  if (_refreshReady) await _refreshReady
}

/**
 * Determine the correct auth page to redirect to on 401.
/**
 * Uses a priority chain: current URL path ? stored user data ? JWT role claim.
/**
 * Must be called BEFORE clearToken() wipes state.
 */
function detect401RedirectTarget(): string {
  // 1. URL path — strongest signal, always correct for the current page context
  const p = window.location.pathname
  if (p.startsWith('/citizen')) return '/citizen/login'
  if (p.startsWith('/admin'))   return '/admin'

  // 2. localStorage user type — works even from ambiguous paths like /
  if (localStorage.getItem('aegis-citizen-user')) return '/citizen/login'
  if (localStorage.getItem('aegis-user')) return '/admin'

  // 3. JWT role claim — last resort before the token is cleared
  try {
    if (_accessToken) {
      const payload = JSON.parse(atob(_accessToken.split('.')[1]))
      if (payload.role === 'citizen') return '/citizen/login'
      if (['admin', 'operator', 'viewer'].includes(payload.role)) return '/admin'
    }
  } catch { /* malformed token — fall through */ }

  // 4. Fallback — unknown user type, send to landing page
  return '/'
}
export function setUser(u: unknown): void { if (u) localStorage.setItem('aegis-user', JSON.stringify(u)); else localStorage.removeItem('aegis-user') }
export function getUser(): Operator | null { const d = localStorage.getItem('aegis-user'); return d ? JSON.parse(d) : null }
export function isAuthenticated(): boolean { return !!getToken() }

// API Response Types

export interface Operator {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'operator' | 'viewer'
  department?: string
  phone?: string
  isActive: boolean
  avatarUrl?: string
  lastLogin?: string
  createdAt: string
  [key: string]: unknown
}

export interface Report {
  id: string
  reportNumber: string
  incidentCategory: string
  incidentSubtype: string
  displayType: string
  description: string
  severity: 'low' | 'medium' | 'high'
  status: string
  locationText: string
  coordinates: [number, number]
  hasMedia: boolean
  mediaUrl?: string
  reporterName: string
  aiConfidence: number
  aiAnalysis: Record<string, unknown>
  operatorNotes?: string
  assignedTo?: string
  createdAt: string
  updatedAt: string
}

export interface Alert {
  id: string
  title: string
  message: string
  severity: 'critical' | 'warning' | 'info'
  alertType: string
  locationText?: string
  coordinates?: [number, number]
  radiusKm: number
  isActive: boolean
  createdBy?: string
  expiresAt?: string
  createdAt: string
}

export interface ActivityEntry {
  id: string
  action: string
  actionType: string
  reportId?: string
  operatorId?: string
  operatorName?: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  action: string
  action_type: string
  entityType?: string
  entityId?: string
  performedBy?: string
  operator_id?: string
  operator_name?: string
  target_type?: string
  target_id?: string
  before_state?: Record<string, any> | null
  after_state?: Record<string, any> | null
  ip_address?: string
  user_agent?: string
  details?: Record<string, unknown>
  createdAt?: string
  created_at: string
}

export interface CommunityPost {
  id: string
  type: 'offer' | 'request'
  category: string
  title?: string
  description: string
  status: string
  contactInfo?: string
  location?: string
  createdAt: string
}

export interface Deployment {
  id: string
  resourceType: string
  status: string
  location?: string
  deployedAt?: string
  recalledAt?: string
}

export interface Prediction {
  id: string
  hazardType: string
  riskLevel: string
  probability: number
  confidence: number
  regionId?: string
  createdAt: string
  saved_to_feed?: boolean
  area?: string
}

export interface LoginResponse {
  token?: string
  user?: Operator
  requires2FA?: boolean
  tempToken?: string
}

export interface CreateAlertPayload {
  title: string
  message: string
  severity: 'critical' | 'warning' | 'info'
  alertType?: string
  locationText?: string
  lat?: number
  lng?: number
  radiusKm?: number
  expiresAt?: string
  channels?: string[]
}

export interface SubscriptionPayload {
  email?: string | null
  phone?: string | null
  telegramId?: string
  telegram_id?: string | null
  whatsapp?: string | null
  channels: string[]
  severityFilter?: string[]
  severity_filter?: string[]
  topic_filter?: string[]
  location_lat?: number | null
  location_lng?: number | null
  radius_km?: number
  consent?: boolean
}

export interface SuspendPayload {
  until?: string
  reason: string
}

const API_TIMEOUT_MS = 30_000
const API_RETRIES = 2
const API_RETRY_BASE_MS = 500

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const existing = opts.signal
  if (existing) {
    // Forward external abort into our controller
    if ((existing as AbortSignal).aborted) controller.abort()
    else (existing as AbortSignal).addEventListener('abort', () => controller.abort(), { once: true })
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof TypeError) return true // network failure
  return false
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headerInit = opts.headers as Record<string, string> | undefined
  const h: Record<string, string> = { ...(headerInit || {}) }
  if (token) h['Authorization'] = `Bearer ${token}`
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json'
  const method = (opts.method || 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD'
  const maxAttempts = canRetry ? API_RETRIES + 1 : 1
  let res: Response
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetchWithTimeout(`${BASE}${path}`, { ...opts, headers: h }, API_TIMEOUT_MS)
      // Retry on 502/503/504 for safe methods
      if (canRetry && attempt < maxAttempts - 1 && [502, 503, 504].includes(res.status)) {
        await new Promise(r => setTimeout(r, API_RETRY_BASE_MS * 2 ** attempt))
        continue
      }
      break
    } catch (err) {
      lastErr = err
      if (canRetry && attempt < maxAttempts - 1 && isRetryable(err)) {
        await new Promise(r => setTimeout(r, API_RETRY_BASE_MS * 2 ** attempt))
        continue
      }
      console.error('[API] Network error:', err)
      throw new Error('Cannot connect to server. Ensure backend API is running and VITE_API_BASE_URL is configured if needed.')
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!res!) {
    console.error('[API] All retries exhausted:', lastErr)
    throw new Error('Cannot connect to server. Ensure backend API is running and VITE_API_BASE_URL is configured if needed.')
  }
  
  // Handle 401 Unauthorized — role-aware redirect
  // Skip redirect for auth endpoints (login, register, etc.) so the server's
  // actual error message (e.g. "Invalid email or password") reaches the caller.
  const isAuthEndpoint = path.startsWith('/api/auth/') && (opts.method || 'GET').toUpperCase() === 'POST'
  if (res.status === 401 && !isAuthEndpoint) {
    console.warn('[API] 401 Unauthorized — clearing session')
    const redirectTarget = detect401RedirectTarget()
    clearToken()
    if (window.location.pathname !== redirectTarget && !window.location.search.includes('session=expired')) {
      window.location.href = `${redirectTarget}?session=expired`
    }
    throw new Error('Invalid or expired token. Please log in again.')
  }
  
  if (!res.ok) { 
    const e = await res.json().catch(()=>({error:`HTTP ${res.status}`}))
    console.error('[API] Request failed:', res.status, e)
    const errMsg = typeof e.error === 'string' ? e.error : e.error?.message || e.message || `HTTP ${res.status}`
    throw new Error(errMsg)
  }
  return res.json() as Promise<T>
}

export async function apiLogin(email: string, password: string) { return apiFetch<LoginResponse>('/api/auth/login', { method:'POST', body: JSON.stringify({email,password}) }) }
export async function apiInviteOperator(fd: FormData) { const token = getToken(); const h: Record<string, string> = {}; if(token) h['Authorization']=`Bearer ${token}`; const r = await fetch('/api/auth/invite',{method:'POST',body:fd,headers:h}); if(!r.ok){const e=await r.json().catch(()=>({error:'failed'}));const msg=typeof e.error==='string'?e.error:e.error?.message||e.message||'Invite failed';throw new Error(msg)} return r.json() }
export async function apiForgotPassword(email: string) { return apiFetch('/api/auth/forgot-password', { method:'POST', body: JSON.stringify({ email }) }) }
export async function apiResetPassword(token: string, password: string) { return apiFetch('/api/auth/reset-password', { method:'POST', body: JSON.stringify({ token, password }) }) }
export async function apiGetCurrentOperator() { return apiFetch('/api/auth/me') }
export async function apiGetReports(): Promise<Report[]> {
  await waitForAuth()
  const token = getAnyToken()
  const h: Record<string,string> = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Bearer ${token}`
  const res = await fetchWithTimeout(`${BASE}/api/reports`, { headers: h }, API_TIMEOUT_MS)
  if (!res.ok) { const e = await res.json().catch(()=>({error:`HTTP ${res.status}`})); throw new Error(typeof e.error === 'string' ? e.error : `HTTP ${res.status}`) }
  const json = await res.json()
  return Array.isArray(json) ? json : (json.data ?? [])
}
export async function apiGetReportAnalytics(range: '24h' | '7d' | '30d' | 'all' = '24h') {
  return apiFetch(`/api/reports/analytics?range=${encodeURIComponent(range)}`)
}
export async function apiGetCommandCenterAnalytics() {
  return apiFetch('/api/reports/command-center')
}
export async function apiSubmitReport(fd: FormData) {
  // Use ONLY the citizen token — never fall back to the operator token.
  // If no citizen is signed in the request goes unauthenticated so the server
  // saves "Anonymous Citizen" instead of whichever operator happens to be open.
  const token = localStorage.getItem('aegis-citizen-token')
  const h: Record<string, string> = {}
  if (token) h['Authorization'] = `Bearer ${token}`
  const r = await fetch(`${BASE}/api/reports`, { method: 'POST', body: fd, headers: h })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: 'Submit failed' }))
    throw new Error(typeof e.error === 'string' ? e.error : 'Submit failed')
  }
  return r.json()
}
export async function apiUpdateReportStatus(id: string, status: string) { return apiFetch(`/api/reports/${id}/status`, { method:'PUT', body: JSON.stringify({status}) }) }
export async function apiBulkUpdateReportStatus(reportIds: string[], status: string, reason?: string) { return apiFetch('/api/reports/bulk/status', { method:'PUT', body: JSON.stringify({reportIds, status, reason}) }) }
export async function apiUpdateReportNotes(id: string, notes: string) { return apiFetch(`/api/reports/${id}/notes`, { method:'PUT', body: JSON.stringify({notes}) }) }
export async function apiGetAlerts(): Promise<Alert[]> { return apiFetch<Alert[]>('/api/alerts') }
export async function apiCreateAlert(data: CreateAlertPayload) { return apiFetch('/api/alerts', { method:'POST', body: JSON.stringify(data) }) }
export async function apiGetActivity(): Promise<ActivityEntry[]> { return apiFetch<ActivityEntry[]>('/api/activity') }
export async function apiLogActivity(action: string, type: string, reportId?: string) { return apiFetch('/api/activity', { method:'POST', body: JSON.stringify({action,actionType:type,reportId}) }) }
export async function apiGetAIModels() { return apiFetch('/api/ai/models') }
export async function apiGetGovernanceModels() { return apiFetch('/api/ai/governance/models') }
export async function apiGetConfidenceDistribution(model?: string) { return apiFetch(`/api/ai/confidence-distribution${model ? `?model=${model}` : ''}`) }
export async function apiGetAIAuditLog(limit = 50, offset = 0, model?: string) { return apiFetch(`/api/ai/audit?limit=${limit}&offset=${offset}${model ? `&model=${model}` : ''}`) }

// Model Lifecycle Management
export async function apiGetRegistryVersions(hazardType: string, regionId: string) { return apiFetch(`/api/ai/registry/versions/${hazardType}/${regionId}`) }
export async function apiPromoteModel(hazardType: string, regionId: string, version: string) { return apiFetch(`/api/ai/registry/promote/${hazardType}/${regionId}/${encodeURIComponent(version)}`, { method: 'POST' }) }
export async function apiDemoteModel(hazardType: string, regionId: string) { return apiFetch(`/api/ai/registry/demote/${hazardType}/${regionId}`, { method: 'POST' }) }
export async function apiValidateModel(hazardType: string, regionId: string, version: string) { return apiFetch(`/api/ai/registry/validate/${hazardType}/${regionId}/${encodeURIComponent(version)}`) }
export async function apiCleanupVersions(hazardType: string, regionId: string, keep = 3, dryRun = true) { return apiFetch(`/api/ai/registry/cleanup/${hazardType}/${regionId}?keep=${keep}&dry_run=${dryRun}`, { method: 'POST' }) }
export async function apiGetModelHealth(hazardType: string, regionId: string) { return apiFetch(`/api/ai/registry/health/${hazardType}/${regionId}`) }
export async function apiGetAllModelHealth() { return apiFetch('/api/ai/registry/health') }
export async function apiGetModelDrift(hazardType: string, regionId: string, version: string) { return apiFetch(`/api/ai/registry/drift/${hazardType}/${regionId}/${encodeURIComponent(version)}`) }
export async function apiMarkModelDegraded(hazardType: string, regionId: string, version: string, drift_score = 0.8, reason = 'manual_mark_degraded') {
  return apiFetch(`/api/ai/registry/mark-degraded/${hazardType}/${regionId}/${encodeURIComponent(version)}`, {
    method: 'POST',
    body: JSON.stringify({ drift_score, reason }),
  })
}
export async function apiRecommendRollback(hazardType: string, regionId: string) { return apiFetch(`/api/ai/registry/recommend-rollback/${hazardType}/${regionId}`) }
export async function apiGetWeather(lat: number, lng: number) { return apiFetch(`/api/weather/${lat}/${lng}`) }
export async function apiCheckFloodZone(lat: number, lng: number) { return apiFetch(`/api/flood-check?lat=${lat}&lng=${lng}`) }

/* DEPARTMENTS */
export async function apiGetDepartments(): Promise<{ id: string; name: string }[]> {
  return apiFetch('/api/departments')
}

/* SUBSCRIPTIONS */
export async function apiSubscribe(data: SubscriptionPayload): Promise<{ id: string }> {
  return apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiGetSubscriptions(email: string): Promise<{ id: string; channels: string[] }[]> {
  return apiFetch(`/api/subscriptions?email=${encodeURIComponent(email)}`)
}

export async function apiUnsubscribe(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/subscriptions/${id}`, { method: 'DELETE' })
}

/* AUDIT LOG */
export async function apiAuditLog(data: Record<string, unknown>): Promise<{ id: string }> {
  return apiFetch('/api/audit', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiGetAuditLog(filters?: Record<string, string>): Promise<AuditEntry[]> {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return apiFetch(`/api/audit${params}`)
}

/* COMMUNITY HELP */
export async function apiGetCommunityHelp(filters?: Record<string, string>): Promise<CommunityPost[]> {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return apiFetch(`/api/community${params}`)
}

export async function apiCreateCommunityHelp(data: Partial<CommunityPost>): Promise<CommunityPost> {
  return apiFetch('/api/community', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiUpdateCommunityStatus(id: string, status: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/community/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
}

/* FLOOD PREDICTIONS */
export async function apiGetPredictions(): Promise<Prediction[]> {
  return apiFetch('/api/predictions')
}

export async function apiSendPreAlert(id: string, operatorId?: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/predictions/${id}/pre-alert`, { method: 'POST', body: JSON.stringify({ operator_id: operatorId }) })
}

/* RESOURCE DEPLOYMENTS */
export async function apiGetDeployments(): Promise<Deployment[]> {
  return apiFetch('/api/deployments')
}

export async function apiDeployResources(id: string, operatorId?: string, reason?: string, reportId?: string): Promise<Deployment> {
  return apiFetch(`/api/deployments/${id}/deploy`, { method: 'POST', body: JSON.stringify({ operator_id: operatorId, reason: reason || '', report_id: reportId }) })
}

export async function apiRecallResources(id: string, reason?: string, outcomeSummary?: string, reportId?: string): Promise<Deployment> {
  return apiFetch(`/api/deployments/${id}/recall`, { method: 'POST', body: JSON.stringify({ reason: reason || '', outcome_summary: outcomeSummary || '', report_id: reportId }) })
}

/* REPORT MEDIA */
export async function apiGetReportMedia(reportId: string): Promise<{ id: string; url: string; type: string }[]> {
  return apiFetch(`/api/reports/${reportId}/media`)
}

/* AI STATUS */
export async function apiGetAIStatus(): Promise<Record<string, unknown>> {
  return apiFetch('/api/ai/status')
}

/* ACCOUNT GOVERNANCE */
export async function apiDeactivateOperator(id: string, data: { reason: string }): Promise<{ success: boolean }> {
  return apiFetch(`/api/operators/${id}/deactivate`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiReactivateOperator(id: string, data: { reason: string }): Promise<{ success: boolean }> {
  return apiFetch(`/api/operators/${id}/reactivate`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiSuspendOperator(id: string, data: SuspendPayload): Promise<{ success: boolean }> {
  return apiFetch(`/api/operators/${id}/suspend`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiAnonymiseOperator(id: string, data: { reason: string; password: string }): Promise<{ success: boolean }> {
  return apiFetch(`/api/operators/${id}/anonymise`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiGetOperators(): Promise<Operator[]> {
  return apiFetch('/api/operators')
}
export async function apiUpdateProfile(id: string, data: Partial<Operator>): Promise<Operator> {
  return apiFetch(`/api/operators/${id}/profile`, { method: 'PUT', body: JSON.stringify(data) })
}

/* REGION-AWARE FLOOD DATA */
export interface RegionInfo {
  id: string
  name: string
  jurisdiction: string
  enabled: boolean
}

export interface StationReadingsResponse {
  station: { station_id: string; jurisdiction: string }
  readings: Array<{ timestamp: string; level_m: number }>
  bankfull_m: number | null
}

export interface FloodRiskOverlayResponse {
  region: string
  sepa_status: 'live' | 'cached' | 'unavailable'
  cached_at: string | null
  areas: GeoJSON.FeatureCollection
  stations: GeoJSON.FeatureCollection
  alerts: GeoJSON.FeatureCollection
  metadata?: { jurisdiction: string; generated_at: string }
}

export interface ImageClassificationResponse {
  model_version: string
  hazard_type: string
  probability: number
  risk_level: string
  confidence: number
}

export interface NewsItem {
  title: string
  source: string
  time: string
  url: string
  type: 'alert' | 'warning' | 'community' | 'info' | 'tech' | 'disaster'
}

export const apiGetFloodRiskOverlay = (region = DEFAULT_REGION) =>
  apiFetch<FloodRiskOverlayResponse>(`/api/flood-data/risk-overlay?region=${region}`)

export const apiGetFloodAreas = (region = DEFAULT_REGION) =>
  apiFetch<GeoJSON.FeatureCollection>(`/api/flood-data/areas?region=${region}`)

export const apiGetFloodStations = (region = DEFAULT_REGION) =>
  apiFetch<GeoJSON.FeatureCollection>(`/api/flood-data/stations?region=${region}`)

export const apiGetStationReadings = (id: string, hours = 24, region = DEFAULT_REGION) =>
  apiFetch<StationReadingsResponse>(`/api/flood-data/stations/${id}/readings?hours=${hours}&region=${region}`)

export const apiGetEnabledRegions = () =>
  apiFetch<{ regions: RegionInfo[] }>('/api/flood-data/enabled-regions')

export interface IncidentTypeConfig {
  id: string
  name: string
  category: string
  enabled: boolean
  severityLevels: string[]
  fieldSchema: Array<{ key: string; label: string; type: string; required: boolean; options?: string[] }>
  widgets: string[]
  aiModel: string
  alertThresholds: { advisory: number; warning: number; critical: number }
}

export const apiGetIncidentTypes = () =>
  apiFetch<{ incidents: IncidentTypeConfig[] }>('/api/config/incidents')

export const apiUpsertIncidentType = (incidentId: string, payload: Partial<IncidentTypeConfig>) =>
  apiFetch<{ incident: IncidentTypeConfig }>(`/api/config/incidents/${encodeURIComponent(incidentId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

export const apiClassifyImage = (file: File) => {
  const fd = new FormData()
  fd.append('image', file)
  return apiFetch<ImageClassificationResponse>('/api/ai/classify-image', { method: 'POST', body: fd })
}

export const apiCheckAvailability = (fields: { email?: string; phone?: string }) =>
  apiFetch<{ emailAvailable?: boolean; phoneAvailable?: boolean }>('/api/citizen/check-availability', {
    method: 'POST',
    body: JSON.stringify(fields),
  })

export const apiGetNews = (fresh = false, page = 1) => {
  const params = new URLSearchParams()
  if (fresh) params.set('fresh', 'true')
  if (page > 1) params.set('page', String(page))
  params.set('pageSize', '30') // always request 30 items per page
  return apiFetch<{ items: NewsItem[]; fetched_at: string; total: number; page: number; totalPages: number }>(`/api/news?${params.toString()}`)
}

/* AI PREDICTION ENGINE */
export async function apiRunPrediction(data: Record<string, unknown>): Promise<Prediction> {
  return apiFetch('/api/predictions/run', { method: 'POST', body: JSON.stringify(data) })
}

/* SETUP / FIRST-RUN ONBOARDING */
export async function apiSetupRegion(region: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/setup/region', { method: 'POST', body: JSON.stringify({ region }) })
}
export async function apiSetupNotifications(channels: Record<string, unknown>): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/setup/notifications', { method: 'POST', body: JSON.stringify({ channels }) })
}
export async function apiSetupComplete(): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/setup/complete', { method: 'POST', body: JSON.stringify({}) })
}
export async function apiSetupReset(): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/setup/reset', { method: 'POST', body: JSON.stringify({}) })
}

/* SPATIAL / GIS */
export async function apiGetRiskLayer(): Promise<GeoJSON.FeatureCollection> {
  return apiFetch('/api/map/risk-layer')
}
export async function apiGetHeatmapData(): Promise<GeoJSON.FeatureCollection> {
  return apiFetch('/api/map/heatmap-data')
}

/* USER MANAGEMENT (Super Admin only) */
export async function apiGetUsers(): Promise<Operator[]> {
  return apiFetch('/api/users')
}
export async function apiGetUser(id: string): Promise<Operator> {
  return apiFetch(`/api/users/${id}`)
}
export async function apiUpdateUser(id: string, data: Partial<Operator>): Promise<Operator> {
  return apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiSuspendUser(id: string, data: SuspendPayload): Promise<{ success: boolean }> {
  return apiFetch(`/api/users/${id}/suspend`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiActivateUser(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/users/${id}/activate`, { method: 'PUT', body: JSON.stringify({}) })
}
export async function apiResetUserPassword(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({}) })
}
export async function apiDeleteUser(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/users/${id}`, { method: 'DELETE' })
}

/* AI GOVERNANCE ADVANCED */
export async function apiGetAIDrift(modelName?: string, hours = 24): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ hours: String(hours) })
  if (modelName) params.set('model_name', modelName)
  return apiFetch(`/api/ai/drift?${params}`)
}
export async function apiGetAIPredictionStats(modelName?: string, hours = 24): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ hours: String(hours) })
  if (modelName) params.set('model_name', modelName)
  return apiFetch(`/api/ai/predictions/stats?${params}`)
}
export async function apiGetGovernanceDrift(): Promise<Record<string, unknown>> {
  return apiFetch('/api/ai/governance/drift')
}
export async function apiGetChatStatus(): Promise<Record<string, unknown>> {
  return apiFetch('/api/chat/status')
}
export async function apiGetAIModelVersions(modelName: string, limit = 20): Promise<Record<string, unknown>> {
  return apiFetch(`/api/ai/models/${modelName}/versions?limit=${limit}`)
}
export async function apiRetrainModel(hazardType: string, regionId?: string): Promise<{ success: boolean }> {
  return apiFetch('/api/ai/retrain', { method: 'POST', body: JSON.stringify({ hazard_type: hazardType, region_id: regionId || 'uk-default' }) })
}

/* TWO-FACTOR AUTHENTICATION */

export interface TwoFactorSetupResponse {
  success: boolean
  manualKey: string
  otpAuthUrl: string
  qrCodeDataUrl: string
}

export interface TwoFactorVerifyResponse {
  success: boolean
  backupCodes: string[]
}

export interface TwoFactorStatusResponse {
  enabled: boolean
  enabledAt: string | null
  lastVerifiedAt: string | null
  recoveryCodesGeneratedAt: string | null
  backupCodesRemaining: number | null
}

export interface TwoFactorAuthResponse {
  success: boolean
  token: string
  user: Operator
  backupCodeUsed?: boolean
  backupCodeWarning?: string
  deviceTrusted?: boolean
}

export async function api2FAGetStatus(): Promise<TwoFactorStatusResponse> {
  return apiFetch('/api/auth/2fa/status')
}

export async function api2FASetup(): Promise<TwoFactorSetupResponse> {
  return apiFetch('/api/auth/2fa/setup', { method: 'POST', body: JSON.stringify({}) })
}

export async function api2FAVerify(code: string): Promise<TwoFactorVerifyResponse> {
  return apiFetch('/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) })
}

export async function api2FAAuthenticate(tempToken: string, code: string, rememberDevice?: boolean): Promise<TwoFactorAuthResponse> {
  // This call must NOT include Authorization header (user isn't fully authenticated yet)
  // Use raw fetch to avoid the automatic auth header injection
  const res = await fetch(`${BASE}/api/auth/2fa/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ tempToken, code, rememberDevice: rememberDevice || false }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    const errMsg = typeof e.error === 'string' ? e.error : e.error?.message || e.message || `HTTP ${res.status}`
    throw new Error(errMsg)
  }
  return res.json()
}

export async function api2FADisable(password: string, code: string): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) })
}

export async function api2FARegenerateBackupCodes(password: string, code: string): Promise<TwoFactorVerifyResponse> {
  return apiFetch('/api/auth/2fa/regenerate-backup-codes', { method: 'POST', body: JSON.stringify({ password, code }) })
}

