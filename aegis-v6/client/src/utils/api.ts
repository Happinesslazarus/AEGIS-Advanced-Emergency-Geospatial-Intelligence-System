const BASE = String(import.meta.env.VITE_API_BASE_URL || '')
const DEFAULT_REGION = String(import.meta.env.VITE_DEFAULT_REGION || 'scotland')
function getToken(): string | null { return localStorage.getItem('aegis-token') }
export function setToken(t: string): void { localStorage.setItem('aegis-token', t) }
export function clearToken(): void { localStorage.removeItem('aegis-token'); localStorage.removeItem('aegis-user') }
export function setUser(u: any): void { localStorage.setItem('aegis-user', JSON.stringify(u)) }
export function getUser(): any { const d = localStorage.getItem('aegis-user'); return d ? JSON.parse(d) : null }
export function isAuthenticated(): boolean { return !!getToken() }

async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headerInit = opts.headers as Record<string, string> | undefined
  const h: Record<string, string> = { ...(headerInit || {}) }
  if (token) h['Authorization'] = `Bearer ${token}`
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json'
  let res: Response
  try { res = await fetch(`${BASE}${path}`, { ...opts, headers: h }) }
  catch { throw new Error('Cannot connect to server. Ensure backend API is running and VITE_API_BASE_URL is configured if needed.') }
  if (!res.ok) { const e = await res.json().catch(()=>({error:`HTTP ${res.status}`})); throw new Error(e.error || `HTTP ${res.status}`) }
  return res.json() as Promise<T>
}

export async function apiLogin(email: string, password: string) { return apiFetch('/api/auth/login', { method:'POST', body: JSON.stringify({email,password}) }) }
export async function apiRegister(fd: FormData) { const token = getToken(); const h: any = {}; if(token) h['Authorization']=`Bearer ${token}`; const r = await fetch('/api/auth/register',{method:'POST',body:fd,headers:h}); if(!r.ok){const e=await r.json().catch(()=>({error:'failed'}));throw new Error(e.error)} return r.json() }
export async function apiForgotPassword(email: string) { return apiFetch('/api/auth/forgot-password', { method:'POST', body: JSON.stringify({ email }) }) }
export async function apiResetPassword(token: string, password: string) { return apiFetch('/api/auth/reset-password', { method:'POST', body: JSON.stringify({ token, password }) }) }
export async function apiGetCurrentOperator() { return apiFetch('/api/auth/me') }
export async function apiGetReports() { return apiFetch('/api/reports') }
export async function apiGetReportAnalytics(range: '24h' | '7d' | '30d' | 'all' = '24h') {
  return apiFetch(`/api/reports/analytics?range=${encodeURIComponent(range)}`)
}
export async function apiGetCommandCenterAnalytics() {
  return apiFetch('/api/reports/command-center')
}
export async function apiSubmitReport(fd: FormData) { const token = getToken(); const h: any = {}; if(token) h['Authorization']=`Bearer ${token}`; const r = await fetch('/api/reports',{method:'POST',body:fd,headers:h}); if(!r.ok) throw new Error('Submit failed'); return r.json() }
export async function apiUpdateReportStatus(id: string, status: string) { return apiFetch(`/api/reports/${id}/status`, { method:'PUT', body: JSON.stringify({status}) }) }
export async function apiBulkUpdateReportStatus(reportIds: string[], status: string, reason?: string) { return apiFetch('/api/reports/bulk/status', { method:'PUT', body: JSON.stringify({reportIds, status, reason}) }) }
export async function apiUpdateReportNotes(id: string, notes: string) { return apiFetch(`/api/reports/${id}/notes`, { method:'PUT', body: JSON.stringify({notes}) }) }
export async function apiGetAlerts() { return apiFetch('/api/alerts') }
export async function apiCreateAlert(data: any) { return apiFetch('/api/alerts', { method:'POST', body: JSON.stringify(data) }) }
export async function apiGetActivity() { return apiFetch('/api/activity') }
export async function apiLogActivity(action: string, type: string, reportId?: string) { return apiFetch('/api/activity', { method:'POST', body: JSON.stringify({action,actionType:type,reportId}) }) }
export async function apiGetAIModels() { return apiFetch('/api/ai/models') }
export async function apiGetGovernanceModels() { return apiFetch('/api/ai/governance/models') }
export async function apiGetConfidenceDistribution(model?: string) { return apiFetch(`/api/ai/confidence-distribution${model ? `?model=${model}` : ''}`) }
export async function apiGetAIAuditLog(limit = 50, offset = 0, model?: string) { return apiFetch(`/api/ai/audit?limit=${limit}&offset=${offset}${model ? `&model=${model}` : ''}`) }
export async function apiGetWeather(lat: number, lng: number) { return apiFetch(`/api/weather/${lat}/${lng}`) }
export async function apiCheckFloodZone(lat: number, lng: number) { return apiFetch(`/api/flood-check?lat=${lat}&lng=${lng}`) }

/* DEPARTMENTS */
export async function apiGetDepartments(): Promise<any[]> {
  return apiFetch('/api/departments')
}

/* SUBSCRIPTIONS */
export async function apiSubscribe(data: any): Promise<any> {
  return apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiGetSubscriptions(email: string): Promise<any[]> {
  return apiFetch(`/api/subscriptions?email=${encodeURIComponent(email)}`)
}

export async function apiUnsubscribe(id: string): Promise<any> {
  return apiFetch(`/api/subscriptions/${id}`, { method: 'DELETE' })
}

/* AUDIT LOG */
export async function apiAuditLog(data: any): Promise<any> {
  return apiFetch('/api/audit', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiGetAuditLog(filters?: any): Promise<any[]> {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return apiFetch(`/api/audit${params}`)
}

/* COMMUNITY HELP */
export async function apiGetCommunityHelp(filters?: any): Promise<any[]> {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return apiFetch(`/api/community${params}`)
}

export async function apiCreateCommunityHelp(data: any): Promise<any> {
  return apiFetch('/api/community', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiUpdateCommunityStatus(id: string, status: string): Promise<any> {
  return apiFetch(`/api/community/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
}

/* FLOOD PREDICTIONS */
export async function apiGetPredictions(): Promise<any[]> {
  return apiFetch('/api/predictions')
}

export async function apiSendPreAlert(id: string, operatorId?: string): Promise<any> {
  return apiFetch(`/api/predictions/${id}/pre-alert`, { method: 'POST', body: JSON.stringify({ operator_id: operatorId }) })
}

/* RESOURCE DEPLOYMENTS */
export async function apiGetDeployments(): Promise<any[]> {
  return apiFetch('/api/deployments')
}

export async function apiDeployResources(id: string, operatorId?: string): Promise<any> {
  return apiFetch(`/api/deployments/${id}/deploy`, { method: 'POST', body: JSON.stringify({ operator_id: operatorId }) })
}

export async function apiRecallResources(id: string): Promise<any> {
  return apiFetch(`/api/deployments/${id}/recall`, { method: 'POST', body: JSON.stringify({}) })
}

/* REPORT MEDIA */
export async function apiGetReportMedia(reportId: string): Promise<any[]> {
  return apiFetch(`/api/reports/${reportId}/media`)
}

/* AI STATUS */
export async function apiGetAIStatus(): Promise<any> {
  return apiFetch('/api/ai/status')
}

/* ACCOUNT GOVERNANCE */
export async function apiDeactivateOperator(id: string, data: any): Promise<any> {
  return apiFetch(`/api/operators/${id}/deactivate`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiReactivateOperator(id: string, data: any): Promise<any> {
  return apiFetch(`/api/operators/${id}/reactivate`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiSuspendOperator(id: string, data: any): Promise<any> {
  return apiFetch(`/api/operators/${id}/suspend`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiAnonymiseOperator(id: string, data: any): Promise<any> {
  return apiFetch(`/api/operators/${id}/anonymise`, { method: 'POST', body: JSON.stringify(data) })
}
export async function apiGetOperators(): Promise<any[]> {
  return apiFetch('/api/operators')
}
export async function apiUpdateProfile(id: string, data: any): Promise<any> {
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
  type: 'alert' | 'warning' | 'community' | 'info' | 'tech'
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

export const apiGetNews = () =>
  apiFetch<{ items: NewsItem[]; fetched_at: string }>('/api/news')

/* AI PREDICTION ENGINE */
export async function apiRunPrediction(data: any): Promise<any> {
  return apiFetch('/api/predictions/run', { method: 'POST', body: JSON.stringify(data) })
}

/* SPATIAL / GIS */
export async function apiGetRiskLayer(): Promise<any> {
  return apiFetch('/api/map/risk-layer')
}
export async function apiGetHeatmapData(): Promise<any> {
  return apiFetch('/api/map/heatmap-data')
}

/* USER MANAGEMENT (Super Admin only) */
export async function apiGetUsers(): Promise<any> {
  return apiFetch('/api/users')
}
export async function apiGetUser(id: string): Promise<any> {
  return apiFetch(`/api/users/${id}`)
}
export async function apiUpdateUser(id: string, data: any): Promise<any> {
  return apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiSuspendUser(id: string, data: { until?: string, reason: string }): Promise<any> {
  return apiFetch(`/api/users/${id}/suspend`, { method: 'PUT', body: JSON.stringify(data) })
}
export async function apiActivateUser(id: string): Promise<any> {
  return apiFetch(`/api/users/${id}/activate`, { method: 'PUT', body: JSON.stringify({}) })
}
export async function apiResetUserPassword(id: string): Promise<any> {
  return apiFetch(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({}) })
}
export async function apiDeleteUser(id: string): Promise<any> {
  return apiFetch(`/api/users/${id}`, { method: 'DELETE' })
}

/* AI GOVERNANCE ADVANCED */
export async function apiGetAIDrift(modelName?: string, hours = 24): Promise<any> {
  const params = new URLSearchParams({ hours: String(hours) })
  if (modelName) params.set('model_name', modelName)
  return apiFetch(`/api/ai/drift?${params}`)
}
export async function apiGetAIPredictionStats(modelName?: string, hours = 24): Promise<any> {
  const params = new URLSearchParams({ hours: String(hours) })
  if (modelName) params.set('model_name', modelName)
  return apiFetch(`/api/ai/predictions/stats?${params}`)
}
export async function apiGetGovernanceDrift(): Promise<any> {
  return apiFetch('/api/ai/governance/drift')
}
export async function apiGetChatStatus(): Promise<any> {
  return apiFetch('/api/chat/status')
}
export async function apiGetAIModelVersions(modelName: string, limit = 20): Promise<any> {
  return apiFetch(`/api/ai/models/${modelName}/versions?limit=${limit}`)
}
export async function apiRetrainModel(hazardType: string, regionId?: string): Promise<any> {
  return apiFetch('/api/ai/retrain', { method: 'POST', body: JSON.stringify({ hazard_type: hazardType, region_id: regionId || 'uk-default' }) })
}
