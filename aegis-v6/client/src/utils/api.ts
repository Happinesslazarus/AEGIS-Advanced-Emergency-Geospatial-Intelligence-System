/**
 * Module: api.ts
 *
 * Core API client for the AEGIS frontend.  Every HTTP call to the backend
 * goes through `apiFetch()` which handles authentication headers, timeouts,
 * retries, CSRF tokens, and 401 session-expiry redirects automatically.
 *
 * Two auth token systems run in parallel:
 *
 *   1. Staff tokens (admin / operator / viewer)
 *      Stored in the module-scoped `_accessToken` variable (in memory only).
 *      Keeping it out of localStorage protects against XSS token theft.
 *      On page reload the token is recovered by `_doRefresh()` which silently
 *      re-authenticates using the httpOnly refresh cookie sent by the server.
 *
 *   2. Citizen tokens
 *      Stored in CitizenAuthContext module memory and localStorage ('aegis-citizen-user').
 *      `getCitizenToken()` from CitizenAuthContext reads it.
 *      `getAnyToken()` bridges both systems for components that support either user type.
 *
 * Glossary:
 *   JWT               = JSON Web Token; base64-encoded header.payload.signature string;
 *                       the payload contains {role, exp, sub, …} claims
 *   exp claim         = token expiry time in Unix seconds
 *   httpOnly cookie   = a cookie the JavaScript cannot read; only the browser sends it on
 *                       matching requests; protects refresh tokens from XSS
 *   XSS               = Cross-Site Scripting; if mitigated, attacker JS cannot steal tokens
 *                       from localStorage; in-memory storage removes this risk
 *   CSRF              = Cross-Site Request Forgery; malicious site tricks the browser into
 *                       making requests using existing cookies
 *   double-submit cookie = CSRF defence: server sets aegis_csrf cookie; client reads it and
 *                       sends it as X-CSRF-Token header; server checks they match
 *   401 Unauthorized  = HTTP status meaning token is missing or expired; triggers redirect
 *   503 / 502 / 504   = server-side transient errors; safe GET requests are auto-retried
 *   AbortController   = browser API for cancelling a fetch request (used for timeout)
 *   DOMException AbortError = thrown when an AbortController aborts the fetch
 *   apiFetch()        = the central fetch wrapper used by all API functions
 *   fetchWithTimeout()= adds an AbortController-based deadline to fetch()
 *   scheduleTokenRefresh() = calculates when the current token will expire and sets
 *                       a setTimeout to call _doRefresh() 5 minutes before that
 *   _doRefresh()      = calls POST /api/auth/refresh to get a new token silently
 *   detect401RedirectTarget() = decides where to redirect after 401 (admin vs citizen login)
 *   waitForAuth()     = awaits the initial _doRefresh() promise before making API calls
 *   DEFAULT_REGION    = VITE_DEFAULT_REGION env var; defaults to 'scotland'
 *   BASE              = VITE_API_BASE_URL env var; empty string in development (same origin)
 *   encodeURIComponent() = percent-encodes special characters for safe URL embedding
 *
 * How it connects:
 * - Imported by every component or hook that calls the backend
 * - CitizenAuthContext writes the citizen token; getCitizenToken() reads it back
 * - getAnyToken() bridges both token systems for shared UI components
 * - useSocket.ts reads the citizen token from localStorage for Socket.IO auth
 */

const BASE = String(import.meta.env.VITE_API_BASE_URL || '')           // backend base URL (empty = same origin)
const DEFAULT_REGION = String(import.meta.env.VITE_DEFAULT_REGION || 'scotland') // geographic default for flood/weather queries

// ---------------------------------------------------------------------------
// In-memory token storage — XSS-safe: tokens never written to localStorage
// ---------------------------------------------------------------------------
// Storing in a module variable means an XSS attacker's injected script cannot
// read the token from document.cookie or localStorage.
// On page reload, the token is recovered via the httpOnly refresh cookie.

import { getCitizenToken } from '../contexts/CitizenAuthContext'

let _accessToken: string | null = null           // current staff JWT (null = not signed in)
let _refreshTimer: ReturnType<typeof setTimeout> | null = null  // handle for the refresh countdown
let _refreshReady: Promise<void> | null = null   // resolves when the initial refresh attempt is done
let _redirecting = false  // guard: prevent a flood of simultaneous 401 redirects
let _refreshing: Promise<string | null> | null = null  // singleton: collapses concurrent refresh calls

export function scheduleTokenRefresh(token?: string): void {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null } // cancel any existing countdown
  const t = token || _accessToken
  if (!t) return
  try {
    const parts = t.split('.')             // JWT is three dot-separated Base64 segments
    if (parts.length !== 3) return
    const decoded = atob(parts[1])         // atob() = Base64 decode; reveals the payload JSON
    const { exp } = JSON.parse(decoded)    // exp = Unix timestamp seconds (expiry)
    if (!exp) return
    const msUntilRefresh = exp * 1000 - Date.now() - 5 * 60 * 1000 // refresh 5 min before expiry
    if (msUntilRefresh <= 0) { _doRefresh(); return } // already close to expiry → refresh now
    _refreshTimer = setTimeout(_doRefresh, msUntilRefresh)
  } catch { /* ignore malformed JWTs silently */ }
}

// Attempt one silent token refresh.  Returns the new token string or null on failure.
// Multiple simultaneous callers receive the same in-flight promise (singleton guard)
// so only one network request fires even when many 401s arrive at once.
async function _attemptRefresh(): Promise<string | null> {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!res.ok) { console.warn('[API] Silent refresh failed — user will need to log in again'); return null }
      const { token } = await res.json()
      if (token) {
        setToken(token)   // stores token in memory, resets _redirecting, schedules next refresh
        return token as string
      }
      return null
    } catch (err) {
      console.warn('[API] Silent refresh error:', err)
      return null
    } finally {
      _refreshing = null
    }
  })()
  return _refreshing
}

async function _doRefresh(): Promise<void> { await _attemptRefresh() }

// Attempt silent refresh on module load to recover session from the httpOnly cookie.
// Subsequent API calls await `waitForAuth()` to ensure the token is ready.
_refreshReady = _doRefresh()

/* Get the current in-memory staff JWT (admin / operator / viewer).  Returns null if not signed in. */
export function getToken(): string | null {
  return _accessToken
}

/* Return whichever token is available: staff JWT first, then citizen JWT.
   Used by shared components that work for both user types. */
export function getAnyToken(): string | null {
  return _accessToken || getCitizenToken()
}

export function setToken(t: string): void {
  _accessToken = t        // store the new JWT in memory
  _redirecting = false    // reset redirect guard so any future 401 can redirect again
  scheduleTokenRefresh(t) // schedule background renewal before it expires
  // Notify SocketContext to reconnect the sharedSocket using the new admin token.
  // The storage event only fires in OTHER tabs, so we use a custom event here.
  window.dispatchEvent(new CustomEvent('ae:token-set'))
}

export function clearToken(): void {
  _accessToken = null     // wipe the in-memory JWT
  // NOTE: _redirecting is intentionally NOT reset here — resetting it inside clearToken
  // would allow concurrent 401 handlers to each attempt a redirect.  It resets
  // naturally when the page reloads (module re-initializes to false).
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null } // cancel scheduled refresh
  localStorage.removeItem('aegis-user')         // remove stored staff user info
  localStorage.removeItem('aegis-citizen-user') // remove stored citizen user info
  window.dispatchEvent(new Event('ae:logout'))  // notify React contexts to reset auth state
}

/* Wait for the initial silent refresh to complete before making API calls.
   Components that need the token on mount should await this. */
export async function waitForAuth(): Promise<void> {
  if (_refreshReady) await _refreshReady
}

// ---------------------------------------------------------------------------
// 401 redirect target detection — decides where to send the user when a token expires
// ---------------------------------------------------------------------------
/**
 * Determine the correct auth page to redirect to on 401.
 * Uses a priority chain: current URL path → stored user data → JWT role claim.
 * Must be called BEFORE clearToken() wipes state.
 */
function detect401RedirectTarget(): string {
  // 1. URL path — strongest signal, always correct for the current page context
  const p = window.location.pathname
  if (p.startsWith('/citizen')) return '/citizen/login'
  if (p.startsWith('/admin'))   return '/admin'

  // 2. localStorage user type — works even from ambiguous paths like '/'
  if (localStorage.getItem('aegis-citizen-user')) return '/citizen/login'
  if (localStorage.getItem('aegis-user')) return '/admin'

  // 3. JWT role claim — last resort before the token is cleared below
  try {
    if (_accessToken && _accessToken.split('.').length === 3) {
      const payload = JSON.parse(atob(_accessToken.split('.')[1])) // Base64 decode the payload segment
      if (payload.role === 'citizen') return '/citizen/login'
      if (['admin', 'operator', 'viewer'].includes(payload.role)) return '/admin'
    }
  } catch { /* malformed token — fall through */ }

  // 4. Fallback — unknown user type, send to landing page
  return '/'
}
export function setUser(u: unknown): void { if (u) localStorage.setItem('aegis-user', JSON.stringify(u)); else localStorage.removeItem('aegis-user') }
export function getUser(): Operator | null { try { const d = localStorage.getItem('aegis-user'); return d ? JSON.parse(d) : null } catch { return null } }
export function isAuthenticated(): boolean { return !!getToken() }

// ---------------------------------------------------------------------------
// API response types — TypeScript interfaces for backend payloads
// ---------------------------------------------------------------------------

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
  before_state?: Record<string, unknown> | null
  after_state?: Record<string, unknown> | null
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
  zone: string
  priority: string
  active_reports: number
  estimated_affected: string | null
  ai_recommendation: string | null
  ambulances: number
  fire_engines: number
  rescue_boats: number
  deployed: boolean
  deployed_at: string | null
  deployed_by: string | null
  created_at: string
  updated_at: string | null
  lat: number | null
  lng: number | null
  report_id: string | null
  report_number: string | null
  prediction_id: string | null
  is_ai_draft: boolean
  ai_draft_acknowledged_at: string | null
  ai_draft_acknowledged_by: string | null
  ops_log: Array<{ ts: string; operator: string; note: string }>
  needs_mutual_aid: boolean
  incident_commander: string | null
  hazard_type: string | null
}

export interface DeploymentAsset {
  id: string
  deployment_id: string
  asset_type: 'ambulance' | 'fire_engine' | 'rescue_boat' | 'helicopter' | 'hazmat_unit' | 'police' | 'medical_unit' | 'urban_search_rescue' | 'other'
  call_sign: string
  status: 'staging' | 'en_route' | 'on_site' | 'returning' | 'available' | 'off_duty'
  crew_count: number
  last_lat: number | null
  last_lng: number | null
  last_seen_at: string | null
  notes: string | null
  created_at: string
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
  subscriber_name?: string | null
}

export interface SuspendPayload {
  until?: string
  reason: string
}

const API_TIMEOUT_MS = 30_000  // abort request after 30 seconds of no response
const API_RETRIES = 2           // retry GET/HEAD requests up to 2 extra times on transient errors
const API_RETRY_BASE_MS = 500   // base delay for exponential back-off (500ms, 1s, 2s, …)

// fetchWithTimeout wraps fetch() with an AbortController-based deadline.
// If the request takes longer than timeoutMs it is aborted and throws an AbortError.
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

// isRetryable returns true for errors that are worth retrying
// (network failure or timeout) versus logic errors that retrying cannot fix.
function isRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true // timeout
  if (err instanceof TypeError) return true // network failure (DNS, no connection)
  return false
}

// ---------------------------------------------------------------------------
// apiFetch — central fetch wrapper used by every exported API function
// ---------------------------------------------------------------------------
export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  // Wait for the initial silent refresh to complete before reading the token.
  // This prevents a race condition on page load where dashboard components fire
  // API calls before _doRefresh() has finished setting _accessToken.
  // After the first refresh attempt this is effectively a no-op (resolved promise).
  await waitForAuth()
  const token = getToken()  // read the in-memory staff JWT
  const headerInit = opts.headers as Record<string, string> | undefined
  const h: Record<string, string> = { ...(headerInit || {}) }            // copy caller-supplied headers
  if (token) h['Authorization'] = `Bearer ${token}`                       // attach staff JWT if present
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json' // JSON unless file upload
  // Attach CSRF token for state-changing requests (double-submit cookie pattern)
  // GET / HEAD / OPTIONS are safe methods — they cannot change server state so no CSRF needed
  const method = (opts.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
    if (csrfToken) h['X-CSRF-Token'] = csrfToken // double-submit: header value must match cookie
  }
  const canRetry = method === 'GET' || method === 'HEAD' // only safe methods are idempotent (safe to re-send)
  const maxAttempts = canRetry ? API_RETRIES + 1 : 1     // POST/PUT/DELETE: only one attempt
  let res: Response
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetchWithTimeout(`${BASE}${path}`, { ...opts, headers: h }, API_TIMEOUT_MS)
      // Retry on 502/503/504 (gateway/server-side transient errors) for safe methods only
      if (canRetry && attempt < maxAttempts - 1 && [502, 503, 504].includes(res.status)) {
        await new Promise(r => setTimeout(r, API_RETRY_BASE_MS * 2 ** attempt)) // exponential back-off
        continue
      }
      break
    } catch (err) {
      lastErr = err
      if (canRetry && attempt < maxAttempts - 1 && isRetryable(err)) {
        await new Promise(r => setTimeout(r, API_RETRY_BASE_MS * 2 ** attempt))
        continue
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.error('[API] Request timed out:', path)
        throw new Error('The request timed out. The server may be under load — please try again in a moment.')
      }
      console.error('[API] Network error:', err)
      throw new Error('Cannot reach the AEGIS server. Check your internet connection and try again.')
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!res!) {
    console.error('[API] All retries exhausted:', lastErr)
    throw new Error('Cannot reach the AEGIS server after multiple attempts. Check your connection and try again.')
  }
  
  // Handle 401 Unauthorized — role-aware redirect to the correct login page.
  // Auth endpoints (login, register, etc.) are excluded so their actual error
  // messages ('Invalid email or password') reach the caller unchanged.
  const isAuthEndpoint = path.startsWith('/api/auth/') && (opts.method || 'GET').toUpperCase() === 'POST'
  if (res.status === 401 && !isAuthEndpoint) {
    // Before logging the user out, attempt one silent token refresh.
    // This recovers the common case where the 15-min access token expired and the
    // scheduled background refresh failed silently (network blip, sleep/wake, etc.).
    const newToken = await _attemptRefresh()
    if (newToken) {
      // Refresh succeeded — replay the original request with the fresh token.
      const retryHeaders: Record<string, string> = { ...h, 'Authorization': `Bearer ${newToken}` }
      try {
        const retryRes = await fetchWithTimeout(`${BASE}${path}`, { ...opts, headers: retryHeaders }, API_TIMEOUT_MS)
        if (retryRes.ok) return retryRes.json() as Promise<T>
        // Retry also 401/error — fall through to logout
      } catch { /* network error on retry — fall through to logout */ }
    }
    // Refresh failed or retried request still unauthorized — clear session and redirect.
    console.warn('[API] 401 Unauthorized — session cannot be refreshed, clearing session')
    const redirectTarget = detect401RedirectTarget()
    clearToken()  // wipe the expired token
    if (!_redirecting && !window.location.search.includes('session=expired')) {
      _redirecting = true
      window.location.href = `${redirectTarget}?session=expired`
    }
    throw new Error('Your session has expired. Please sign in again.')
  }

  if (!res.ok) {
    let body: any = {}
    try { body = await res.json() } catch { /* non-JSON response */ }

    // CSRF mismatch: stale cookie from a previous server session.
    // Auto-reload to get a fresh CSRF cookie — prevents the stuck error banner.
    if (res.status === 403 && body?.code === 'CSRF_INVALID') {
      window.location.reload()
      return new Promise(() => {}) as Promise<T>
    }

    console.error('[API] Request failed:', res.status, body)

    // Prefer the server's own message, then fall back to status-code translations
    const serverMsg: string | undefined =
      typeof body.error === 'string' ? body.error :
      typeof body.error?.message === 'string' ? body.error.message :
      typeof body.message === 'string' ? body.message :
      undefined

    // If the server gave a clear message (not a raw HTTP status string), use it
    if (serverMsg && !serverMsg.startsWith('HTTP ')) {
      throw new Error(serverMsg)
    }

    // Status-code fallbacks — always human-readable
    const STATUS_MESSAGES: Record<number, string> = {
      400: 'The request was invalid. Please check your input and try again.',
      401: 'You are not signed in. Please log in and try again.',
      403: 'You do not have permission to perform this action.',
      404: 'The requested item could not be found. It may have been moved or deleted.',
      408: 'The request timed out. Please try again.',
      409: 'A conflict occurred — a record with this value may already exist.',
      413: 'The file or data you sent is too large. Please reduce the size and try again.',
      422: 'The data you submitted could not be processed. Please check your input.',
      429: 'Too many requests. Please wait a moment before trying again.',
      500: 'The server encountered an unexpected error. Please try again, or contact support.',
      502: 'The server is temporarily unreachable. Please try again shortly.',
      503: 'The AEGIS service is temporarily unavailable. Please try again shortly.',
      504: 'The server took too long to respond. Please try again.',
    }

    throw new Error(STATUS_MESSAGES[res.status] ?? `Unexpected error (${res.status}). Please try again.`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Authentication endpoints
// ---------------------------------------------------------------------------
export async function apiLogin(email: string, password: string) { return apiFetch<LoginResponse>('/api/auth/login', { method:'POST', body: JSON.stringify({email,password}) }) }
export async function apiInviteOperator(fd: FormData) { const token = getToken(); const h: Record<string, string> = {}; if(token) h['Authorization']=`Bearer ${token}`; const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]; if(csrfToken) h['X-CSRF-Token']=csrfToken; const r = await fetch(`${BASE}/api/auth/invite`,{method:'POST',body:fd,headers:h}); if(!r.ok){const e=await r.json().catch(()=>({error:'failed'}));const msg=typeof e.error==='string'?e.error:e.error?.message||e.message||'Invite failed';throw new Error(msg)} return r.json() }
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
  const token = getCitizenToken()
  const h: Record<string, string> = {}
  if (token) h['Authorization'] = `Bearer ${token}`
  // CSRF double-submit: read the cookie and echo it as a header
  const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
  if (csrfToken) h['X-CSRF-Token'] = csrfToken
  const r = await fetch(`${BASE}/api/reports`, { method: 'POST', body: fd, headers: h })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    const msg = typeof e.error === 'string' ? e.error
      : typeof e.message === 'string' ? e.message
      : r.status === 413 ? 'Your attachment is too large. Please use a photo under 10 MB.'
      : r.status === 429 ? 'You are submitting reports too quickly. Please wait a moment.'
      : r.status === 400 ? 'Some required information is missing or invalid. Please check your report and try again.'
      : 'Report submission failed. Please try again.'
    throw new Error(msg)
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
// Used by registration forms to populate the department dropdown.
export async function apiGetDepartments(): Promise<{ id: string; name: string }[]> {
  return apiFetch('/api/departments')
}

/* SUBSCRIPTIONS — alert subscription management (email / SMS / Telegram) */
export async function apiSubscribe(data: SubscriptionPayload): Promise<{ id: string }> {
  // Prefer citizen token (signed-in citizen), then operator token, then unauthenticated.
  // This lets the server store citizen_id and differentiate anonymous vs authenticated.
  const token = getCitizenToken() || getToken()
  const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Bearer ${token}`
  if (csrfToken) h['X-CSRF-Token'] = csrfToken
  const res = await fetchWithTimeout(`${BASE}/api/subscriptions`, { method: 'POST', body: JSON.stringify(data), headers: h }, API_TIMEOUT_MS)
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(
      typeof e.error === 'string' ? e.error :
      typeof e.error?.message === 'string' ? e.error.message :
      typeof e.message === 'string' ? e.message :
      'Subscription failed. Please try again.'
    )
  }
  return res.json()
}

export async function apiGetSubscriptions(email: string): Promise<{ id: string; channels: string[] }[]> {
  return apiFetch(`/api/subscriptions?email=${encodeURIComponent(email)}`)
}

export async function apiUnsubscribe(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/subscriptions/${id}`, { method: 'DELETE' })
}

/* AUDIT LOG — immutable record of all admin actions for compliance */
export async function apiAuditLog(data: Record<string, unknown>): Promise<{ id: string }> {
  return apiFetch('/api/audit', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiGetAuditLog(filters?: Record<string, string>): Promise<AuditEntry[]> {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return apiFetch(`/api/audit${params}`)
}

/* COMMUNITY HELP — neighbourhood offers / requests board (mutual aid) */
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

/* FLOOD PREDICTIONS — ML risk forecast records saved to the database */
export async function apiGetPredictions(): Promise<Prediction[]> {
  return apiFetch('/api/predictions')
}

export async function apiSendPreAlert(id: string, operatorId?: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/predictions/${id}/pre-alert`, { method: 'POST', body: JSON.stringify({ operator_id: operatorId }) })
}

/* RESOURCE DEPLOYMENTS — track ambulances, fire engines, rescue boats */
export async function apiGetDeployments(): Promise<Deployment[]> {
  return apiFetch('/api/deployments')
}

export async function apiDeployResources(id: string, operatorId?: string, reason?: string, reportId?: string): Promise<Deployment> {
  return apiFetch(`/api/deployments/${id}/deploy`, { method: 'POST', body: JSON.stringify({ operator_id: operatorId, reason: reason || '', report_id: reportId }) })
}

export async function apiRecallResources(id: string, reason?: string, outcomeSummary?: string, reportId?: string, aiFeedback?: string): Promise<Deployment> {
  return apiFetch(`/api/deployments/${id}/recall`, { method: 'POST', body: JSON.stringify({ reason: reason || '', outcome_summary: outcomeSummary || '', report_id: reportId, ai_feedback: aiFeedback }) })
}

export async function apiCreateDeployment(data: {
  zone: string; priority: string; active_reports?: number; estimated_affected?: string;
  ai_recommendation?: string; ambulances?: number; fire_engines?: number; rescue_boats?: number;
  lat?: number; lng?: number; report_id?: string; prediction_id?: string; is_ai_draft?: boolean; hazard_type?: string;
}): Promise<Deployment> {
  return apiFetch('/api/deployments', { method: 'POST', body: JSON.stringify(data) })
}

export async function apiDeleteDeployment(id: string): Promise<{ deleted: boolean; id: string }> {
  return apiFetch(`/api/deployments/${id}`, { method: 'DELETE' })
}

export async function apiUpdateDeployment(id: string, data: Partial<Pick<Deployment, 'zone' | 'priority' | 'active_reports' | 'estimated_affected' | 'ai_recommendation' | 'ambulances' | 'fire_engines' | 'rescue_boats' | 'hazard_type' | 'incident_commander'>>): Promise<Deployment> {
  return apiFetch(`/api/deployments/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function apiGetDeploymentAssets(deploymentId: string): Promise<DeploymentAsset[]> {
  return apiFetch(`/api/deployments/${deploymentId}/assets`)
}

export async function apiAddDeploymentAsset(deploymentId: string, data: {
  asset_type: string; call_sign: string; status?: string; crew_count?: number; notes?: string;
}): Promise<DeploymentAsset> {
  return apiFetch(`/api/deployments/${deploymentId}/assets`, { method: 'POST', body: JSON.stringify(data) })
}

export async function apiUpdateDeploymentAsset(assetId: string, data: {
  status?: string; last_lat?: number; last_lng?: number; crew_count?: number; notes?: string;
}): Promise<DeploymentAsset> {
  return apiFetch(`/api/deployments/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function apiDeleteDeploymentAsset(assetId: string): Promise<{ deleted: boolean; id: string }> {
  return apiFetch(`/api/deployments/assets/${assetId}`, { method: 'DELETE' })
}

export async function apiAcknowledgeDraft(deploymentId: string): Promise<{ id: string; ai_draft_acknowledged_at: string; ai_draft_acknowledged_by: string }> {
  return apiFetch(`/api/deployments/${deploymentId}/acknowledge`, { method: 'PATCH' })
}

export async function apiAddOpsLog(deploymentId: string, note: string): Promise<{ id: string; ops_log: Array<{ ts: string; operator: string; note: string }> }> {
  return apiFetch(`/api/deployments/${deploymentId}/ops-log`, { method: 'PATCH', body: JSON.stringify({ note }) })
}

export async function apiToggleMutualAid(deploymentId: string, needsMutualAid: boolean, incidentCommander?: string): Promise<{ id: string; needs_mutual_aid: boolean; incident_commander: string | null }> {
  return apiFetch(`/api/deployments/${deploymentId}/mutual-aid`, { method: 'PATCH', body: JSON.stringify({ needs_mutual_aid: needsMutualAid, incident_commander: incidentCommander }) })
}

/* REPORT MEDIA — images/videos attached to a citizen report */
export async function apiGetReportMedia(reportId: string): Promise<{ id: string; url: string; type: string }[]> {
  return apiFetch(`/api/reports/${reportId}/media`)
}

/* AI STATUS — health check for the AI engine */
export async function apiGetAIStatus(): Promise<Record<string, unknown>> {
  return apiFetch('/api/ai/status')
}

/* ACCOUNT GOVERNANCE — profile update routes on /api/auth (not /api/users) */
export async function apiUpdateProfile(id: string, data: Partial<Operator>): Promise<Operator> {
  return apiFetch('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) })
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
  if (fresh) {
    params.set('fresh', 'true')
    params.set('_t', String(Date.now())) // bypass browser HTTP cache on force-refresh
  }
  if (page > 1) params.set('page', String(page))
  params.set('pageSize', '50') // request 50 items per page
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
export async function apiGetSpatialDensity(bounds?: { north: number; south: number; east: number; west: number }): Promise<{ cell_size_km: number; point_count: number; points: { lat: number; lng: number; intensity: number }[] }> {
  return apiFetch('/api/spatial/density', { method: 'POST', body: JSON.stringify({ bounds }) })
}

/* HISTORICAL DATA */

/** Historical event from aggregated reports */
export interface HistoricalEvent {
  id: string
  date: string
  type: string
  severity: string
  location?: string
  coordinates?: [number, number]
  description?: string
  impact?: string
  casualties?: number
  damage_estimate?: number
}

/** Seasonal trend data point */
export interface SeasonalTrend {
  month: number
  year: number
  incident_count: number
  severity_breakdown: Record<string, number>
  top_categories: string[]
}

export async function apiGetHistoricalEvents(): Promise<{ events: HistoricalEvent[]; total: number; source: string }> {
  return apiFetch('/api/reports/historical-events')
}
export async function apiGetSeasonalTrends(): Promise<{ trends: SeasonalTrend[]; source: string }> {
  return apiFetch('/api/reports/seasonal-trends')
}

/* USER MANAGEMENT — Super Admin only routes; not available to operator/viewer roles */
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
  const body: Record<string, string> = { hazard_type: hazardType }
  if (regionId) body.region_id = regionId
  return apiFetch('/api/ai/retrain', { method: 'POST', body: JSON.stringify(body) })
}

/* TWO-FACTOR AUTHENTICATION — TOTP setup, verify, authenticate, and backup-code management */

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

// api2FAAuthenticate must NOT include an Authorization header because the user
// is not yet fully authenticated (they only have a tempToken, not a full JWT).
// It uses raw fetch() to bypass apiFetch's automatic Bearer header injection.
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

// Citizen 2FA — same pattern as staff 2FA but uses /api/citizen-auth/ endpoints
// and returns a CitizenTwoFactorAuthResponse which includes citizen preferences.
export interface CitizenTwoFactorAuthResponse {
  success: boolean
  token: string
  user: Record<string, any>
  preferences?: Record<string, any>
  backupCodeUsed?: boolean
  backupCodeWarning?: string
  deviceTrusted?: boolean
}

export async function apiCitizen2FAGetStatus(): Promise<TwoFactorStatusResponse> {
  return apiFetch('/api/citizen-auth/2fa/status')
}

export async function apiCitizen2FASetup(): Promise<TwoFactorSetupResponse> {
  return apiFetch('/api/citizen-auth/2fa/setup', { method: 'POST', body: JSON.stringify({}) })
}

export async function apiCitizen2FAVerify(code: string): Promise<TwoFactorVerifyResponse> {
  return apiFetch('/api/citizen-auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) })
}

export async function apiCitizen2FAAuthenticate(tempToken: string, code: string, rememberDevice?: boolean): Promise<CitizenTwoFactorAuthResponse> {
  const res = await fetch(`${BASE}/api/citizen-auth/2fa/authenticate`, {
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

export async function apiCitizen2FADisable(password: string, code: string): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/citizen-auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) })
}

export async function apiCitizen2FARegenerateBackupCodes(password: string, code: string): Promise<TwoFactorVerifyResponse> {
  return apiFetch('/api/citizen-auth/2fa/regenerate-backup-codes', { method: 'POST', body: JSON.stringify({ password, code }) })
}

