/**
 * Module: auth.ts
 *
 * Client-side logout and session inspection helpers. Provides a unified
 * logout() function that hits both the operator and citizen logout endpoints,
 * clears all in-memory tokens, localStorage/sessionStorage keys, non-httpOnly
 * cookies, and fires the 'ae:logout' custom DOM event so every React auth
 * context resets its state in a single coordinated operation.
 *
 * How it connects:
 * - getSession() reads the current operator/admin user from memory via api.ts
 * - logout() is called from header dropdowns, idle timeouts, and 401 handlers
 * - The 'ae:logout' event is listened to by CitizenAuthContext and auth middleware
 * - Works alongside CitizenAuthContext for citizen-specific session clearing * tells React contexts to reset so the UI returns to its logged-out state.
 */

import { getUser, clearToken, setUser, getAnyToken, waitForAuth } from './api'
import { setCitizenToken } from '../contexts/CitizenAuthContext'
import type { Operator } from '../types'

export function getSession(): Operator | null {
  return getUser()
}

export async function logout(): Promise<void> {

  // Try admin logout endpoint, then citizen logout endpoint. Ignore errors.
  // Both endpoints instruct the server to invalidate the session and clear
  // the httpOnly refresh cookie (JavaScript cannot clear httpOnly cookies;
  // only a Set-Cookie response header from the server can do that).
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch {}
  try { await fetch('/api/citizen-auth/logout', { method: 'POST', credentials: 'include' }) } catch {}

  // Clear in-memory tokens (operator + citizen)
  try { clearToken() } catch {}
  try { setCitizenToken(null) } catch {}

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

  // Expire all non-httpOnly cookies that JavaScript CAN clear.
  // Setting expires to the Unix epoch (1970-01-01) immediately deletes the cookie.
  // httpOnly cookies (the refresh token) can only be deleted by the server.
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

  // 'ae:logout' = custom DOM event (ae = AEGIS Event).  React auth contexts
  // across the entire app listen for this and reset their state to logged-out
  // without needing prop drilling or a shared module-level variable.
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
    // JWT structure: header.payload.signature (three Base64URL sections joined by dots).
    // We decode ONLY the payload section (index 1) to read the 'exp' claim.
    // We deliberately avoid a JWT library here to keep the bundle small; we don't
    // need signature verification on the CLIENT — the server verifies on every request.
    const parts = token.split('.')
    if (parts.length !== 3) {
      return false
    }

    // atob() decodes a Base64 string back to its original bytes.
    // The JWT payload is a JSON object like { sub: '123', exp: 1700000000, ... }.
    const payload = JSON.parse(atob(parts[1]))
    const exp = payload.exp
    
    if (!exp) {
      return true // If no expiration, assume valid
    }

    // exp is Unix time in SECONDS; Date.now() returns milliseconds, so we divide.
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
  // Deprecated sync wrapper preserved for compatibility.
  // Prefer validateTokenOrRedirectAsync() so we can await silent refresh first.
  const token = getAnyToken()
  if (!token) return true
  if (isTokenValid()) return true
  console.warn('[Auth] Invalid token detected, clearing and redirecting...')
  clearToken()
  const isAdminPath = window.location.pathname.startsWith('/admin')
  const loginPath = isAdminPath ? '/admin' : '/citizen/login'
  if (window.location.pathname !== loginPath) {
    window.location.href = loginPath
  }
  return false
}

/**
 * Async token validation that waits for initial silent refresh before deciding.
 * Prevents false logouts on page/view changes while refresh is still in flight.
 */
export async function validateTokenOrRedirectAsync(): Promise<boolean> {
  await waitForAuth()
  return validateTokenOrRedirect()
}
