/**
 * Module: CitizenAuthContext.tsx
 *
 * Citizen auth context React context provider (shares state across components).
 *
 * How it connects:
 * - Wraps components in App.tsx via AppProviders */

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { API_BASE } from '../utils/helpers'
import { notifySocketAuthChange } from './SocketContext'

// ─── In-memory citizen access token ────────────────────────────────────────
// The access token is stored ONLY in JavaScript memory (never localStorage).
// On page reload, silentRefresh() recovers a new access token using the
// httpOnly refresh cookie the server sets on login/refresh.
// This eliminates XSS token theft — even if an attacker injects script,
// they cannot read the access token from localStorage.
let _citizenAccessToken: string | null = null

/** Get the current citizen access token (in-memory only). */
export function getCitizenToken(): string | null {
  return _citizenAccessToken
}

/** Set the citizen access token in memory. */
export function setCitizenToken(t: string | null): void {
  _citizenAccessToken = t
}

// API_BASE imported from ../utils/helpers

// Types

export interface CitizenUser {
  id: string
  email: string
  displayName: string
  role: string
  avatarUrl?: string
  phone?: string
  preferredRegion?: string
  emailVerified: boolean
  locationLat?: number
  locationLng?: number
  isVulnerable?: boolean
  vulnerabilityDetails?: string
  country?: string
  city?: string
  addressLine?: string
  bio?: string
  dateOfBirth?: string
  loginCount?: number
  lastLogin?: string
  createdAt?: string
}

export interface CitizenPreferences {
  citizen_id: string
  audio_alerts_enabled: boolean
  audio_voice: string
  audio_volume: number
  auto_play_critical: boolean
  captions_enabled: boolean
  caption_font_size: string
  caption_position: string
  notification_channels: string[]
  severity_filter: string[]
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  language: string
  dark_mode: boolean
  compact_view: boolean
}

export interface EmergencyContact {
  id: string
  citizen_id: string
  name: string
  phone: string
  relationship: string | null
  is_primary: boolean
  notify_on_help: boolean
  created_at: string
}

export interface SafetyCheckIn {
  id: string
  citizen_id: string
  status: 'safe' | 'help' | 'unsure'
  location_lat: number | null
  location_lng: number | null
  message: string | null
  escalation_status: string | null
  acknowledged_by_name: string | null
  created_at: string
}

interface CitizenAuthContextType {
  user: CitizenUser | null
  token: string | null
  preferences: CitizenPreferences | null
  emergencyContacts: EmergencyContact[]
  recentSafety: SafetyCheckIn[]
  unreadMessages: number
  loading: boolean
  isAuthenticated: boolean
  // Auth actions
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; requires2FA?: boolean; tempToken?: string }>
  complete2FA: (token: string, user: CitizenUser, preferences?: CitizenPreferences) => void
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>
  oauthLogin: (token: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  // Profile
  updateProfile: (data: Partial<CitizenUser>) => Promise<boolean>
  uploadAvatar: (file: File) => Promise<string | null>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  updatePreferences: (data: Partial<CitizenPreferences>) => Promise<boolean>
  // Emergency contacts
  addEmergencyContact: (data: { name: string; phone: string; relationship?: string; isPrimary?: boolean }) => Promise<boolean>
  removeEmergencyContact: (id: string) => Promise<boolean>
  // Safety
  submitSafetyCheckIn: (status: string, message?: string, lat?: number, lng?: number) => Promise<boolean>
  // Refresh
  refreshProfile: () => Promise<void>
}

export interface RegisterData {
  email: string
  password: string
  displayName: string
  phone?: string
  preferredRegion?: string
  isVulnerable?: boolean
  vulnerabilityDetails?: string
  country?: string
  city?: string
  dateOfBirth?: string
  bio?: string
  addressLine?: string
  statusColor?: string
}

const CitizenAuthContext = createContext<CitizenAuthContextType | null>(null)

// Helper

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = _citizenAccessToken
  // AbortController lets us cancel the fetch if it takes longer than 10 seconds.
  // After 10 000 ms we call controller.abort() which rejects the fetch promise.
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  // Attach the JWT (JSON Web Token) in the Authorization header so the server
  // can verify the caller's identity.  Bearer = "whoever holds this token is allowed".
  if (token) headers['Authorization'] = `Bearer ${token}`
  // CSRF double-submit: read the cookie and send as header for all state-changing requests
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  const method = (options.method || 'GET').toUpperCase()
  if (!safeMethods.includes(method)) {
    const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal, credentials: 'include' })
    const data = await res.json().catch(() => ({}))

    // If the server replies 401 (Unauthorized) and this isn't already a refresh or
    // login call (to avoid infinite loops), attempt a silent token refresh.
    // "Silent" = uses the httpOnly refresh cookie sent by the browser automatically.
    if (res.status === 401 && path !== '/api/citizen-auth/refresh' && path !== '/api/citizen-auth/login') {
      const refreshed = await silentRefresh()
      if (refreshed) {
        // Retry the original request with the newly issued access token.
        const newToken = _citizenAccessToken
        const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
        const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers: retryHeaders, credentials: 'include' })
        const retryData = await retryRes.json().catch(() => ({}))
        if (!retryRes.ok) {
          const errMsg = typeof retryData?.error === 'string' ? retryData.error : retryData?.error?.message || 'Request failed'
          const error: any = new Error(errMsg)
          error.status = retryRes.status
          throw error
        }
        return retryData
      }
    }

    if (!res.ok) {
      const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Request failed'
      const error: any = new Error(errMsg)
      error.status = res.status
      throw error
    }
    return data
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // The fetch was cancelled because it exceeded the 10-second timeout.
      throw new Error('Request timed out. Please try again.')
    }
    throw err
  } finally {
    // Always clear the timeout so we don't memory-leak the timer if the request
    // finishes before 10 seconds.
    window.clearTimeout(timeout)
  }
}

/* Attempt to get a new access token using the httpOnly refresh cookie.
 * httpOnly = the browser sends the cookie automatically but JavaScript cannot
 * read it (XSS protection).  The server verifies it and issues a new JWT. */
let refreshPromise: Promise<boolean> | null = null
async function silentRefresh(): Promise<boolean> {
  // If another component already started a refresh, reuse that promise instead
  // of sending duplicate requests.  This prevents a race condition where two
  // expired requests both try to refresh at the same time.
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/citizen-auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return false
      const data = await res.json()
      if (data.token) {
        _citizenAccessToken = data.token
        return true
      }
      return false
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

// Provider

export function CitizenAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<CitizenUser | null>(() => {
    try {
      const raw = localStorage.getItem('aegis-citizen-user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [token, setToken] = useState<string | null>(() => _citizenAccessToken)
  const [preferences, setPreferences] = useState<CitizenPreferences | null>(null)
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([])
  const [recentSafety, setRecentSafety] = useState<SafetyCheckIn[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [loading, setLoading] = useState(!!token)

  const isAuthenticated = !!user && !!token

  // Save token to in-memory store (no longer persisted to localStorage)
  const saveToken = useCallback((t: string) => {
    _citizenAccessToken = t
    setToken(t)
    notifySocketAuthChange()
  }, [])

  const saveUser = useCallback((u: CitizenUser | null) => {
    setUser(u)
    if (u) {
      // Store minimal PII in localStorage (#78) - only what's needed for offline display
      const safeUser = {
        id: u.id,
        displayName: u.displayName,
        role: u.role,
        avatarUrl: u.avatarUrl,
        preferredRegion: u.preferredRegion,
        isVulnerable: u.isVulnerable,
        emailVerified: u.emailVerified,
      }
      localStorage.setItem('aegis-citizen-user', JSON.stringify(safeUser))
    } else {
      localStorage.removeItem('aegis-citizen-user')
    }
  }, [])

  const clearAuth = useCallback(() => {
    saveUser(null)
    _citizenAccessToken = null
    setToken(null)
    setPreferences(null)
    setEmergencyContacts([])
    setRecentSafety([])
    setUnreadMessages(0)
    notifySocketAuthChange()
    // Clear server-side refresh cookie (#25)
    fetch(`${API_BASE}/api/citizen-auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(err => console.warn('[CitizenAuth] Logout sync failed:', err))
  }, [saveUser])

  // Refresh full profile
  const refreshProfile = useCallback(async () => {
    if (!_citizenAccessToken) {
      setLoading(false)
      return
    }
    try {
      const data = await apiFetch('/api/citizen-auth/me')
      saveUser(data.user)
      setPreferences(data.preferences)
      setEmergencyContacts(data.emergencyContacts || [])
      setRecentSafety(data.recentSafetyCheckIns || [])
      setUnreadMessages(data.unreadMessages || 0)
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        clearAuth()
      } else {
        console.warn('[CitizenAuth] refreshProfile transient failure; keeping local session')
      }
    } finally {
      setLoading(false)
    }
  }, [clearAuth, saveUser])

  // On mount: attempt silent refresh via httpOnly cookie to recover session.
  // If we already have a token in memory (e.g. SPA navigation), just refresh profile.
  // If not, try the server's refresh endpoint — the browser sends the httpOnly
  // cookie automatically, and the server issues a new access token if valid.
  useEffect(() => {
    if (_citizenAccessToken) {
      refreshProfile()
    } else {
      // Try silent refresh — the stored user hint tells us a session may exist
      const hasUserHint = !!localStorage.getItem('aegis-citizen-user')
      if (hasUserHint) {
        setLoading(true)
        silentRefresh().then((ok) => {
          if (ok) {
            setToken(_citizenAccessToken)
            refreshProfile()
          } else {
            setLoading(false)
          }
        })
      } else {
        setLoading(false)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Login
  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiFetch('/api/citizen-auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      // 2FA gate: server returns requires2FA + tempToken when 2FA is enabled
      if (data.requires2FA) {
        return { success: false, requires2FA: true, tempToken: data.tempToken }
      }
      saveToken(data.token)
      saveUser(data.user)
      setPreferences(data.preferences)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }, [saveToken])

  // Register
  const register = useCallback(async (regData: RegisterData) => {
    try {
      const data = await apiFetch('/api/citizen-auth/register', {
        method: 'POST',
        body: JSON.stringify(regData),
      })
      saveToken(data.token)
      saveUser(data.user)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }, [saveToken])

  // Complete 2FA — called after successful 2FA challenge to save auth state
  const complete2FA = useCallback((authToken: string, authUser: CitizenUser, prefs?: CitizenPreferences) => {
    saveToken(authToken)
    saveUser(authUser)
    if (prefs) setPreferences(prefs)
  }, [saveToken, saveUser])

  // OAuth login — use token from Google OAuth redirect hash
  // Validate token BEFORE persisting to avoid broken auth state
  const oauthLogin = useCallback(async (oauthToken: string) => {
    try {
      // Temporarily set token in memory so apiFetch can use it
      _citizenAccessToken = oauthToken
      const data = await apiFetch('/api/citizen-auth/me')
      // Token validated — now persist properly
      saveToken(oauthToken)
      saveUser(data.user)
      setPreferences(data.preferences)
      setEmergencyContacts(data.emergencyContacts || [])
      setRecentSafety(data.recentSafetyCheckIns || [])
      setUnreadMessages(data.unreadMessages || 0)
      return { success: true }
    } catch (err: any) {
      // Token was invalid — clear it
      _citizenAccessToken = null
      setToken(null)
      return { success: false, error: err.message }
    }
  }, [saveToken, saveUser])

  // Handle OAuth redirect token from URL hash (#26) — process only once
  const oauthProcessedRef = useRef(false)
  useEffect(() => {
    if (oauthProcessedRef.current) return
    const hash = window.location.hash
    if (hash.includes('oauth_token=')) {
      oauthProcessedRef.current = true
      const tokenMatch = hash.match(/oauth_token=([^&]+)/)
      if (tokenMatch?.[1]) {
        // Clear hash immediately to prevent token leaking in history/referrer
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        oauthLogin(tokenMatch[1])
      }
    }
  }, [oauthLogin])

  // Logout
  const logout = useCallback(() => {
    clearAuth()
  }, [clearAuth])

  // Listen for global logout events (from shared logout util) and clear auth state
  useEffect(() => {
    const handler = () => clearAuth()
    window.addEventListener('ae:logout', handler)
    return () => window.removeEventListener('ae:logout', handler)
  }, [clearAuth])

  // Update profile
  const updateProfile = useCallback(async (data: Partial<CitizenUser>) => {
    try {
      const result = await apiFetch('/api/citizen-auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      if (result.user) {
        saveUser(user ? { ...user, ...result.user } : result.user)
      }
      return true
    } catch {
      return false
    }
  }, [saveUser, user])

  // Upload avatar (multipart form)
  const uploadAvatar = useCallback(async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData()
      formData.append('avatar', file)
      const res = await fetch(`${API_BASE}/api/citizen-auth/avatar`, {
        method: 'POST',
        headers: { ...(_citizenAccessToken ? { 'Authorization': `Bearer ${_citizenAccessToken}` } : {}) },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Upload failed')
      saveUser(user ? { ...user, avatarUrl: data.avatarUrl } : user)
      return data.avatarUrl
    } catch {
      return null
    }
  }, [saveUser, user])

  // Change password
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await apiFetch('/api/citizen-auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }, [])

  // Update preferences
  const updatePreferences = useCallback(async (data: Partial<CitizenPreferences>) => {
    try {
      const result = await apiFetch('/api/citizen-auth/preferences', {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      setPreferences(result)
      return true
    } catch {
      return false
    }
  }, [])

  // Emergency contacts
  const addEmergencyContact = useCallback(async (data: { name: string; phone: string; relationship?: string; isPrimary?: boolean }) => {
    try {
      const result = await apiFetch('/api/citizen-auth/emergency-contacts', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      setEmergencyContacts(prev => [...prev, result])
      return true
    } catch {
      return false
    }
  }, [])

  const removeEmergencyContact = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/citizen-auth/emergency-contacts/${id}`, { method: 'DELETE' })
      setEmergencyContacts(prev => prev.filter(c => c.id !== id))
      return true
    } catch {
      return false
    }
  }, [])

  // Safety check-in
  const submitSafetyCheckIn = useCallback(async (status: string, message?: string, lat?: number, lng?: number) => {
    try {
      const result = await apiFetch('/api/citizen/safety', {
        method: 'POST',
        body: JSON.stringify({ status, message, locationLat: lat, locationLng: lng }),
      })
      setRecentSafety(prev => [result, ...prev].slice(0, 5))
      return true
    } catch {
      return false
    }
  }, [])

  return (
    <CitizenAuthContext.Provider value={{
      user, token, preferences, emergencyContacts, recentSafety, unreadMessages,
      loading, isAuthenticated,
      login, complete2FA, register, oauthLogin, logout,
      updateProfile, uploadAvatar, changePassword, updatePreferences,
      addEmergencyContact, removeEmergencyContact,
      submitSafetyCheckIn, refreshProfile,
    }}>
      {children}
    </CitizenAuthContext.Provider>
  )
}

/* Safe fallback returned when the provider is temporarily unavailable
   (e.g. during Vite HMR, ErrorBoundary fallback renders, or SSR). */
const CITIZEN_AUTH_DEFAULTS: CitizenAuthContextType = {
  user: null,
  token: null,
  preferences: null,
  emergencyContacts: [],
  recentSafety: [],
  unreadMessages: 0,
  loading: true,
  isAuthenticated: false,
  login: async () => ({ success: false, error: 'Auth not initialised' }),
  complete2FA: () => {},
  register: async () => ({ success: false, error: 'Auth not initialised' }),
  oauthLogin: async () => ({ success: false, error: 'Auth not initialised' }),
  logout: () => {},
  updateProfile: async () => false,
  uploadAvatar: async () => null,
  changePassword: async () => ({ success: false, error: 'Auth not initialised' }),
  updatePreferences: async () => false,
  addEmergencyContact: async () => false,
  removeEmergencyContact: async () => false,
  submitSafetyCheckIn: async () => false,
  refreshProfile: async () => {},
}

export function useCitizenAuth(): CitizenAuthContextType {
  const ctx = useContext(CitizenAuthContext)
  if (!ctx) {
    if (import.meta.env.DEV) {
      console.warn('[CitizenAuth] Context unavailable — returning safe defaults. This is normal during HMR.')
    }
    return CITIZEN_AUTH_DEFAULTS
  }
  return ctx
}

