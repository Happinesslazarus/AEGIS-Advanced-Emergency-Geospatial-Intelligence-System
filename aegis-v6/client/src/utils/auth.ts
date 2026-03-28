/*
 * auth.ts - Authentication utilities
 * Wraps the JWT token/user stored in localStorage
 */
import { getUser, clearToken, setUser, getAnyToken } from './api'
import type { Operator } from '../types'

export function getSession(): Operator | null {
  return getUser()
}

export async function logout(): Promise<void> {

  // Try admin logout endpoint, then citizen logout endpoint. Ignore errors.
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch {}
  try { await fetch('/api/citizen-auth/logout', { method: 'POST', credentials: 'include' }) } catch {}

  // Clear token helpers and known auth keys
  try { clearToken() } catch {}

  try {
    localStorage.removeItem('aegis-user')
    localStorage.removeItem('aegis-citizen-user')
    localStorage.removeItem('token')
  } catch {}

  try {
    sessionStorage.removeItem('aegis-user')
    sessionStorage.removeItem('aegis-token')
    sessionStorage.removeItem('aegis-citizen-token')
    sessionStorage.removeItem('aegis-citizen-user')
    sessionStorage.clear()
  } catch {}

  // Expire all non-HttpOnly cookies that can be cleared client-side
  try {
    document.cookie.split(';').forEach((c) => {
      const eqPos = c.indexOf('=')
      const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim()
      if (!name) return
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${location.hostname}`
    })
  } catch {}

  // Try to clear any stored user via helper (best-effort)
  try { setUser(null) } catch {}

  // Notify any React auth contexts/providers to clear their in-memory state
  try { window.dispatchEvent(new Event('ae:logout')) } catch {}

  // Immediately redirect to appropriate login page
  const isAdminPath = window.location.pathname.startsWith('/admin')
  try { window.location.href = isAdminPath ? '/admin' : '/citizen/login' } catch {}
}

 /**
 * Check if the current token is valid by attempting to decode it
 * Returns true if token appears valid (not expired), false otherwise
 */
export function isTokenValid(): boolean {
  const token = getAnyToken()
  if (!token) {
    return false
  }

  try {
    // Decode JWT to check expiration (format: header.payload.signature)
    const parts = token.split('.')
    if (parts.length !== 3) {
      return false
    }

    const payload = JSON.parse(atob(parts[1]))
    const exp = payload.exp
    
    if (!exp) {
      return true // If no expiration, assume valid
    }

    const now = Math.floor(Date.now() / 1000)
    const isValid = exp > now
    
    if (!isValid) {
      // Token expired
    }
    
    return isValid
  } catch (err) {
    return false
  }
}

 /**
 * Validate token and redirect to login if invalid
 */
export function validateTokenOrRedirect(): boolean {
  if (!isTokenValid()) {
    console.warn('[Auth] Invalid token detected, clearing and redirecting...')
    clearToken()
    const isAdminPath = window.location.pathname.startsWith('/admin')
    // Admin login lives at /admin (not /admin/login); citizen login at /citizen/login
    const loginPath = isAdminPath ? '/admin' : '/citizen/login'

    // Don't redirect if already on the login page
    if (window.location.pathname !== loginPath) {
      window.location.href = loginPath
    }
    return false
  }
  return true
}
