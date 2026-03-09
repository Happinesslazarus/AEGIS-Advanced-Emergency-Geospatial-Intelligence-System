/*
 * CitizenAuthContext.tsx - Citizen Authentication Context
 *
 * Provides citizen auth state across the entire app:
 * - Login/Register/Logout
 * - JWT token management (localStorage)
 * - Profile, preferences, emergency contacts
 * - Auto-refresh on mount
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { API_BASE } from '../utils/helpers'

// API_BASE imported from ../utils/helpers

// ─── Types ───────────────────────────────────────────────────────────────────

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
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
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

// ─── Helper ──────────────────────────────────────────────────────────────────

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('aegis-citizen-token')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal, credentials: 'include' })
    const data = await res.json().catch(() => ({}))

    // If 401 and not already a refresh call, try silent refresh (#24)
    if (res.status === 401 && path !== '/api/citizen-auth/refresh' && path !== '/api/citizen-auth/login') {
      const refreshed = await silentRefresh()
      if (refreshed) {
        // Retry original request with new token
        const newToken = localStorage.getItem('aegis-citizen-token')
        const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
        const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers: retryHeaders, credentials: 'include' })
        const retryData = await retryRes.json().catch(() => ({}))
        if (!retryRes.ok) {
          const error: any = new Error(retryData?.error || 'Request failed')
          error.status = retryRes.status
          throw error
        }
        return retryData
      }
    }

    if (!res.ok) {
      const error: any = new Error(data?.error || 'Request failed')
      error.status = res.status
      throw error
    }
    return data
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.')
    }
    throw err
  } finally {
    window.clearTimeout(timeout)
  }
}

/** Attempt to get a new access token using the httpOnly refresh cookie */
let refreshPromise: Promise<boolean> | null = null
async function silentRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh attempts
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
        localStorage.setItem('aegis-citizen-token', data.token)
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

// ─── Provider ────────────────────────────────────────────────────────────────

export function CitizenAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<CitizenUser | null>(() => {
    try {
      const raw = localStorage.getItem('aegis-citizen-user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('aegis-citizen-token'))
  const [preferences, setPreferences] = useState<CitizenPreferences | null>(null)
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([])
  const [recentSafety, setRecentSafety] = useState<SafetyCheckIn[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [loading, setLoading] = useState(!!token)

  const isAuthenticated = !!user && !!token

  // Save token to localStorage
  const saveToken = useCallback((t: string) => {
    setToken(t)
    localStorage.setItem('aegis-citizen-token', t)
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
    setToken(null)
    setPreferences(null)
    setEmergencyContacts([])
    setRecentSafety([])
    setUnreadMessages(0)
    localStorage.removeItem('aegis-citizen-token')
    // Clear server-side refresh cookie (#25)
    fetch(`${API_BASE}/api/citizen-auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
  }, [saveUser])

  // Refresh full profile
  const refreshProfile = useCallback(async () => {
    if (!localStorage.getItem('aegis-citizen-token')) {
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

  // Auto-refresh on mount if token exists
  useEffect(() => {
    if (token) refreshProfile()
    else setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Login
  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiFetch('/api/citizen-auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
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

  // OAuth login — use token from Google OAuth redirect hash
  const oauthLogin = useCallback(async (oauthToken: string) => {
    try {
      saveToken(oauthToken)
      // Fetch full profile using the OAuth-issued token
      const data = await apiFetch('/api/citizen-auth/me')
      saveUser(data.user)
      setPreferences(data.preferences)
      setEmergencyContacts(data.emergencyContacts || [])
      setRecentSafety(data.recentSafetyCheckIns || [])
      setUnreadMessages(data.unreadMessages || 0)
      return { success: true }
    } catch (err: any) {
      // Token was invalid — clear it
      localStorage.removeItem('aegis-citizen-token')
      setToken(null)
      return { success: false, error: err.message }
    }
  }, [saveToken, saveUser])

  // Handle OAuth redirect token from URL hash (#26)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('oauth_token=')) {
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
      const tk = localStorage.getItem('aegis-citizen-token')
      const res = await fetch(`${API_BASE}/api/citizen-auth/avatar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tk}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
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
      login, register, oauthLogin, logout,
      updateProfile, uploadAvatar, changePassword, updatePreferences,
      addEmergencyContact, removeEmergencyContact,
      submitSafetyCheckIn, refreshProfile,
    }}>
      {children}
    </CitizenAuthContext.Provider>
  )
}

export function useCitizenAuth(): CitizenAuthContextType {
  const ctx = useContext(CitizenAuthContext)
  if (!ctx) throw new Error('useCitizenAuth must be within CitizenAuthProvider')
  return ctx
}
