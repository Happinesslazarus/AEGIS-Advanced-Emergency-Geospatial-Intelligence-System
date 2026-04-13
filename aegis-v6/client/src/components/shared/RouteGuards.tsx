/**
 * Module: RouteGuards.tsx
 *
 * Route guards shared component (reusable UI element used across pages).
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getToken, getAnyToken } from '../../utils/api'
import { getCitizenToken } from '../../contexts/CitizenAuthContext'

// TYPES

export type UserRole = 'admin' | 'operator' | 'viewer' | 'citizen' | 'guest'

interface RouteGuardProps {
  children: ReactNode
  /** Redirect path if access denied */
  redirectTo?: string
  /** Custom fallback component instead of redirect */
  fallback?: ReactNode
}

interface RoleGuardProps extends RouteGuardProps {
  /** Required roles (user must have at least one) */
  roles: UserRole[]
}

// TOKEN UTILITIES

/** Parse JWT payload without verification (client-side only) */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = atob(parts[1])
    return JSON.parse(payload)
  } catch {
    return null
  }
}

/** Extract role from JWT token */
export function getRoleFromToken(token: string | null): UserRole | null {
  if (!token) return null
  const payload = parseJwtPayload(token)
  if (!payload || typeof payload.role !== 'string') return null
  return payload.role as UserRole
}

/** Check if token is expired */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true
  const payload = parseJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return true
  return payload.exp * 1000 < Date.now()
}

/** Get current user's role from stored tokens */
export function getCurrentRole(): UserRole | null {
  // Check admin/operator token first
  const adminToken = getToken()
  if (adminToken && !isTokenExpired(adminToken)) {
    return getRoleFromToken(adminToken)
  }
  
  // Check citizen token
  const citizenToken = getCitizenToken()
  if (citizenToken && !isTokenExpired(citizenToken)) {
    return 'citizen'
  }
  
  return null
}

// GUARD COMPONENTS

/**
 * Requires any authenticated user (admin, operator, viewer, or citizen).
 * 
 * @example
 * <AuthenticatedRoute redirectTo="/login">
 *   <Dashboard />
 * </AuthenticatedRoute>
 */
export function AuthenticatedRoute({
  children,
  redirectTo = '/',
  fallback,
}: RouteGuardProps) {
  const location = useLocation()
  const isAuthenticated = !!getAnyToken()
  
  if (!isAuthenticated) {
    if (fallback) return <>{fallback}</>
    return <Navigate to={redirectTo} state={{ from: location }} replace />
  }
  
  return <>{children}</>
}

/**
 * Requires specific role(s) for access.
 * 
 * @example
 * <RoleProtectedRoute roles={['admin', 'operator']} redirectTo="/unauthorized">
 *   <AdminPanel />
 * </RoleProtectedRoute>
 */
export function RoleProtectedRoute({
  children,
  roles,
  redirectTo = '/',
  fallback,
}: RoleGuardProps) {
  const location = useLocation()
  const currentRole = getCurrentRole()
  
  const hasAccess = currentRole && roles.includes(currentRole)
  
  if (!hasAccess) {
    if (fallback) return <>{fallback}</>
    return <Navigate to={redirectTo} state={{ from: location }} replace />
  }
  
  return <>{children}</>
}

/**
 * Admin-only route guard.
 * Shorthand for RoleProtectedRoute with roles={['admin']}.
 */
export function AdminRoute({ children, redirectTo = '/admin', fallback }: RouteGuardProps) {
  return (
    <RoleProtectedRoute roles={['admin']} redirectTo={redirectTo} fallback={fallback}>
      {children}
    </RoleProtectedRoute>
  )
}

/**
 * Staff route guard (admin, operator, viewer).
 * For pages accessible to all staff but not citizens.
 */
export function StaffRoute({ children, redirectTo = '/admin', fallback }: RouteGuardProps) {
  return (
    <RoleProtectedRoute roles={['admin', 'operator', 'viewer']} redirectTo={redirectTo} fallback={fallback}>
      {children}
    </RoleProtectedRoute>
  )
}

/**
 * Citizen-only route guard.
 * For pages only citizens should access.
 */
export function CitizenRoute({ children, redirectTo = '/citizen/login', fallback }: RouteGuardProps) {
  return (
    <RoleProtectedRoute roles={['citizen']} redirectTo={redirectTo} fallback={fallback}>
      {children}
    </RoleProtectedRoute>
  )
}

/**
 * Guest-only route (not authenticated).
 * Useful for login/register pages that shouldn't be accessed when logged in.
 * 
 * @example
 * <GuestOnlyRoute redirectTo="/dashboard">
 *   <LoginPage />
 * </GuestOnlyRoute>
 */
export function GuestOnlyRoute({
  children,
  redirectTo = '/',
  fallback,
}: RouteGuardProps) {
  const location = useLocation()
  const isAuthenticated = !!getAnyToken()
  
  // If trying to access login while authenticated, redirect to dashboard
  if (isAuthenticated) {
    const currentRole = getCurrentRole()
    const defaultRedirect = currentRole === 'citizen' ? '/citizen/dashboard' : '/admin'
    
    if (fallback) return <>{fallback}</>
    return <Navigate to={location.state?.from?.pathname || redirectTo || defaultRedirect} replace />
  }
  
  return <>{children}</>
}

// HOOKS

/**
 * Hook to check current user's role and permissions.
 * 
 * @example
 * const { role, isAdmin, canEdit } = useRoleCheck()
 */
export function useRoleCheck() {
  const role = getCurrentRole()
  
  return {
    role,
    isAuthenticated: role !== null,
    isAdmin: role === 'admin',
    isOperator: role === 'operator',
    isViewer: role === 'viewer',
    isCitizen: role === 'citizen',
    isStaff: role === 'admin' || role === 'operator' || role === 'viewer',
    canEdit: role === 'admin' || role === 'operator',
    canDelete: role === 'admin',
    canManageUsers: role === 'admin',
  }
}

/**
 * Hook to check if user has any of the specified roles.
 * 
 * @example
 * const canAccessReports = useHasRole(['admin', 'operator'])
 */
export function useHasRole(roles: UserRole[]): boolean {
  const currentRole = getCurrentRole()
  return currentRole !== null && roles.includes(currentRole)
}
