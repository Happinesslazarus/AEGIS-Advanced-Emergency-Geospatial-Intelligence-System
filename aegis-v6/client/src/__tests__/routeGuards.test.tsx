/**
 * Tests for the route-guard components and utilities that control page access
 * based on authentication status and user role.  AEGIS has two separate auth
 * systems running in parallel:
 *   - Staff auth  (admin / operator / viewer) -- uses the main JWT from api.getToken()
 *   - Citizen auth                             -- uses a separate token from CitizenAuthContext
 *
 * Route guard components live in RouteGuards and wrap React Router <Route> children.
 * They redirect or show fallback content when access requirements are not met.
 *
 * Glossary:
 *   describe()              = groups related tests
 *   it()                    = alias for test()
 *   it.each([...])          = run the same test for every value in the array
 *   expect()                = assertion helper
 *   vi.fn()                 = creates a trackable mock function
 *   vi.mock()               = replaces a module with a fake
 *   vi.mocked()             = types the mock so TypeScript knows it has mock methods
 *   render()                = mounts a React component into the jsdom DOM
 *   screen                  = query helpers for the rendered DOM
 *   MemoryRouter            = React Router component that keeps route history in memory
 *                             (not in URL); ideal for testing, no browser required
 *   Routes / Route          = define the URL-to-component mapping for the router
 *   initialEntries          = the starting URL path inside MemoryRouter
 *   AuthenticatedRoute      = redirects un-authenticated users to the login page
 *   RoleProtectedRoute      = restricts access to users with one of the specified roles
 *   AdminRoute              = AuthenticatedRoute that only allows role='admin'
 *   StaffRoute              = AuthenticatedRoute that allows admin / operator / viewer
 *   CitizenRoute            = AuthenticatedRoute for citizens only
 *   GuestOnlyRoute          = redirects already-authenticated users away from public pages
 *                             (e.g. login page) to their appropriate home
 *   getCurrentRole()        = reads the active token (staff or citizen) and returns its role
 *   getRoleFromToken()      = decodes a JWT and extracts the 'role' claim without verifying
 *   isTokenExpired()        = checks the 'exp' (expiry) claim of a JWT
 *   useRoleCheck()          = hook returning {role, isAdmin, isOperator, isViewer, canEdit}
 *   useHasRole()            = hook returning true when the current user has one of the given roles
 *   setCitizenToken()       = stores a citizen JWT in CitizenAuthContext module-level memory
 *   api.getToken()          = returns the stored staff JWT (or null)
 *   api.getAnyToken()       = returns either the staff or citizen JWT (whichever is set)
 *   createMockJwt()         = helper: builds a syntactically valid but unsigned JWT string
 *                             so token-parsing code can be tested without a real server
 *   JWT                     = JSON Web Token; a base64-encoded header.payload.signature string
 *   btoa()                  = encodes a string to Base64 (browser built-in)
 *   exp claim               = JWT expiry time as Unix seconds (Date.now()/1000)
 *   redirectTo prop         = URL path to redirect to when access is denied
 *   fallback prop           = React node to render instead of redirecting when access is denied
 *   roles prop              = array of role strings that are allowed to view the page
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom' // in-memory router for testing
import {
  AuthenticatedRoute,
  RoleProtectedRoute,
  AdminRoute,
  StaffRoute,
  CitizenRoute,
  GuestOnlyRoute,
  getCurrentRole,
  getRoleFromToken,
  isTokenExpired,
  useRoleCheck,
  useHasRole,
} from '../components/shared/RouteGuards'
import { setCitizenToken } from '../contexts/CitizenAuthContext'

//Module-level mocks

//api module -- mock getToken (staff JWT) and getAnyToken (any JWT)
vi.mock('../utils/api', () => ({
  getToken: vi.fn(() => null),    // no staff token by default
  getAnyToken: vi.fn(() => null), // no token of any kind by default
}))

import * as api from '../utils/api'

//Test helpers

/** Wrap a component in MemoryRouter so React Router guards can navigate */
function renderWithRouter(
  component: JSX.Element,
  { initialRoute = '/' } = {}
) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      {component}
    </MemoryRouter>
  )
}

/**
 * Build a mock JWT (header.payload.signature) with the given payload.
 * The signature is a placeholder -- tests only exercise token parsing, not verification.
 */
function createMockJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) // Base64-encoded header
  const body = btoa(JSON.stringify(payload))                          // Base64-encoded payload
  const signature = 'mock-signature'                                  // not a real HMAC signature
  return `${header}.${body}.${signature}`
}

//Token utility functions
describe('Token Utilities', () => {

  describe('getRoleFromToken', () => {
    it('extracts role from valid JWT', () => {
      //Decode the payload and return the 'role' claim
      const token = createMockJwt({ role: 'admin', exp: Date.now() / 1000 + 3600 })
      expect(getRoleFromToken(token)).toBe('admin')
    })

    it('returns null for invalid token', () => {
      //Malformed tokens must not throw; return null gracefully
      expect(getRoleFromToken('invalid')).toBeNull()
      expect(getRoleFromToken(null)).toBeNull()
      expect(getRoleFromToken('')).toBeNull()
    })

    it('returns null when role is missing', () => {
      //A valid JWT without a 'role' claim returns null (no role assigned)
      const token = createMockJwt({ sub: 'user123' }) // sub = subject/user ID
      expect(getRoleFromToken(token)).toBeNull()
    })
  })

  describe('isTokenExpired', () => {
    it('returns true for expired token', () => {
 //exp = Date.now()/1000 - 3600 -> one hour in the past -> expired
      const token = createMockJwt({ exp: Date.now() / 1000 - 3600 })
      expect(isTokenExpired(token)).toBe(true)
    })

    it('returns false for valid token', () => {
 //exp one hour in the future -> token is still valid
      const token = createMockJwt({ exp: Date.now() / 1000 + 3600 })
      expect(isTokenExpired(token)).toBe(false)
    })

    it('returns true for null/invalid token', () => {
      //Treat missing or unparseable tokens as expired for safety
      expect(isTokenExpired(null)).toBe(true)
      expect(isTokenExpired('invalid')).toBe(true)
    })
  })

  describe('getCurrentRole', () => {
    beforeEach(() => {
      vi.mocked(api.getToken).mockReturnValue(null) // reset staff token
      setCitizenToken(null)                          // reset citizen token
      localStorage.clear()                           // clear any residual storage
    })

    it('returns admin role from admin token', () => {
      //When a staff token with role='admin' is present, return 'admin'
      const token = createMockJwt({ role: 'admin', exp: Date.now() / 1000 + 3600 })
      vi.mocked(api.getToken).mockReturnValue(token)

      expect(getCurrentRole()).toBe('admin')
    })

    it('returns citizen role from citizen token', () => {
      //When no staff token exists but a citizen token does, return 'citizen'
      vi.mocked(api.getToken).mockReturnValue(null)
      const token = createMockJwt({ role: 'citizen', exp: Date.now() / 1000 + 3600 })
      setCitizenToken(token) // store in CitizenAuthContext memory

      expect(getCurrentRole()).toBe('citizen')
    })

    it('returns null when no valid token', () => {
 //No tokens set -> user is unauthenticated
      expect(getCurrentRole()).toBeNull()
    })
  })
})

//AuthenticatedRoute -- redirects unauthenticated users
describe('AuthenticatedRoute', () => {
  beforeEach(() => {
    vi.mocked(api.getAnyToken).mockReturnValue(null) // no auth token by default
  })

  it('redirects when not authenticated', () => {
    //Without a token, the guard must navigate to /login
    renderWithRouter(
      <Routes>
        <Route path="/" element={
          <AuthenticatedRoute redirectTo="/login">
            <div>Protected Content</div>
          </AuthenticatedRoute>
        } />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    )

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    expect(screen.getByText('Login Page')).toBeInTheDocument() // redirected
  })

  it('renders children when authenticated', () => {
    //With a valid token present, the guard lets the children render
    vi.mocked(api.getAnyToken).mockReturnValue('valid-token')

    renderWithRouter(
      <AuthenticatedRoute>
        <div>Protected Content</div>
      </AuthenticatedRoute>
    )

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('renders fallback instead of redirecting when provided', () => {
    //fallback prop shows inline content instead of navigating away
    renderWithRouter(
      <AuthenticatedRoute fallback={<div>Please Log In</div>}>
        <div>Protected Content</div>
      </AuthenticatedRoute>
    )

    expect(screen.getByText('Please Log In')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})

//RoleProtectedRoute -- restricts access to specified roles
describe('RoleProtectedRoute', () => {
  beforeEach(() => {
    vi.mocked(api.getToken).mockReturnValue(null)
    vi.mocked(api.getAnyToken).mockReturnValue(null)
    localStorage.clear()
  })

  it('allows access when user has required role', () => {
    //admin token satisfies roles=['admin','operator']
    const token = createMockJwt({ role: 'admin', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)
    vi.mocked(api.getAnyToken).mockReturnValue(token)

    renderWithRouter(
      <RoleProtectedRoute roles={['admin', 'operator']}>
        <div>Admin Content</div>
      </RoleProtectedRoute>
    )

    expect(screen.getByText('Admin Content')).toBeInTheDocument()
  })

  it('denies access when user lacks required role', () => {
    //viewer token fails against roles=['admin']
    const token = createMockJwt({ role: 'viewer', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)
    vi.mocked(api.getAnyToken).mockReturnValue(token)

    renderWithRouter(
      <Routes>
        <Route path="/" element={
          <RoleProtectedRoute roles={['admin']} redirectTo="/unauthorized">
            <div>Admin Only</div>
          </RoleProtectedRoute>
        } />
        <Route path="/unauthorized" element={<div>Access Denied</div>} />
      </Routes>
    )

    expect(screen.queryByText('Admin Only')).not.toBeInTheDocument()
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
  })
})

//AdminRoute -- only role='admin' passes
describe('AdminRoute', () => {
  it('only allows admin role', () => {
    const token = createMockJwt({ role: 'admin', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)
    vi.mocked(api.getAnyToken).mockReturnValue(token)

    renderWithRouter(
      <AdminRoute>
        <div>Admin Panel</div>
      </AdminRoute>
    )

    expect(screen.getByText('Admin Panel')).toBeInTheDocument()
  })

  it('blocks operator role', () => {
    //Operators have elevated rights but are not admins -- cannot access AdminRoute
    const token = createMockJwt({ role: 'operator', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)
    vi.mocked(api.getAnyToken).mockReturnValue(token)

    renderWithRouter(
      <Routes>
        <Route path="/" element={
          <AdminRoute redirectTo="/denied">
            <div>Admin Panel</div>
          </AdminRoute>
        } />
        <Route path="/denied" element={<div>No Access</div>} />
      </Routes>
    )

    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument()
  })
})

//StaffRoute -- admin, operator, or viewer roles
describe('StaffRoute', () => {
  //it.each runs the test body for admin, operator, and viewer in sequence
  it.each(['admin', 'operator', 'viewer'])('allows %s role', (role) => {
    const token = createMockJwt({ role, exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)
    vi.mocked(api.getAnyToken).mockReturnValue(token)

    renderWithRouter(
      <StaffRoute>
        <div>Staff Area</div>
      </StaffRoute>
    )

    expect(screen.getByText('Staff Area')).toBeInTheDocument()
  })

  it('blocks citizen role', () => {
    //Citizens have their own context and routes; they cannot access staff areas
    vi.mocked(api.getToken).mockReturnValue(null)
    const token = createMockJwt({ role: 'citizen', exp: Date.now() / 1000 + 3600 })
    setCitizenToken(token)
    vi.mocked(api.getAnyToken).mockReturnValue(token)

    renderWithRouter(
      <Routes>
        <Route path="/" element={
          <StaffRoute redirectTo="/citizen">
            <div>Staff Area</div>
          </StaffRoute>
        } />
        <Route path="/citizen" element={<div>Citizen Area</div>} />
      </Routes>
    )

    expect(screen.queryByText('Staff Area')).not.toBeInTheDocument()
  })
})

//GuestOnlyRoute -- login/register pages that redirect authenticated users away
describe('GuestOnlyRoute', () => {
  it('allows unauthenticated users', () => {
 //No token -> user is a guest; show the guest content (e.g. login form)
    vi.mocked(api.getAnyToken).mockReturnValue(null)

    renderWithRouter(
      <GuestOnlyRoute>
        <div>Login Form</div>
      </GuestOnlyRoute>
    )

    expect(screen.getByText('Login Form')).toBeInTheDocument()
  })

  it('redirects authenticated users', () => {
 //Already logged in -> no need to see the login page; redirect to dashboard
    vi.mocked(api.getAnyToken).mockReturnValue('valid-token')
    const token = createMockJwt({ role: 'admin', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)

    renderWithRouter(
      <Routes>
        <Route path="/" element={
          <GuestOnlyRoute redirectTo="/dashboard">
            <div>Login Form</div>
          </GuestOnlyRoute>
        } />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
        <Route path="/admin" element={<div>Admin Dashboard</div>} />
      </Routes>
    )

    expect(screen.queryByText('Login Form')).not.toBeInTheDocument()
  })
})

//Hook: useRoleCheck -- returns computed role permissions for the current user

/** Minimal test component that renders the role-check hook values as text */
function TestComponent() {
  const roleCheck = useRoleCheck()
  return (
    <div>
      <span data-testid="role">{roleCheck.role || 'none'}</span>
      <span data-testid="isAdmin">{roleCheck.isAdmin.toString()}</span>
      <span data-testid="canEdit">{roleCheck.canEdit.toString()}</span>
    </div>
  )
}

describe('useRoleCheck', () => {
  it('returns correct role information for admin', () => {
    const token = createMockJwt({ role: 'admin', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)

    renderWithRouter(<TestComponent />)

    expect(screen.getByTestId('role')).toHaveTextContent('admin')
 expect(screen.getByTestId('isAdmin')).toHaveTextContent('true') // admin -> isAdmin
    expect(screen.getByTestId('canEdit')).toHaveTextContent('true')   // admin can edit
  })

  it('returns correct role information for viewer', () => {
    const token = createMockJwt({ role: 'viewer', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)

    renderWithRouter(<TestComponent />)

    expect(screen.getByTestId('role')).toHaveTextContent('viewer')
    expect(screen.getByTestId('isAdmin')).toHaveTextContent('false')  // viewer is not admin
    expect(screen.getByTestId('canEdit')).toHaveTextContent('false')  // viewer cannot edit
  })
})

//Hook: useHasRole -- boolean check against an allowed-roles array

/** Renders the useHasRole() result as text for easy assertion */
function HasRoleTestComponent({ roles }: { roles: ('admin' | 'operator' | 'viewer' | 'citizen' | 'guest')[] }) {
  const hasRole = useHasRole(roles)
  return <span data-testid="hasRole">{hasRole.toString()}</span>
}

describe('useHasRole', () => {
  it('returns true when user has one of the roles', () => {
 //operator is in ['admin','operator'] -> hasRole=true
    const token = createMockJwt({ role: 'operator', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)

    renderWithRouter(<HasRoleTestComponent roles={['admin', 'operator']} />)

    expect(screen.getByTestId('hasRole')).toHaveTextContent('true')
  })

  it('returns false when user lacks all roles', () => {
 //viewer is not in ['admin','operator'] -> hasRole=false
    const token = createMockJwt({ role: 'viewer', exp: Date.now() / 1000 + 3600 })
    vi.mocked(api.getToken).mockReturnValue(token)

    renderWithRouter(<HasRoleTestComponent roles={['admin', 'operator']} />)

    expect(screen.getByTestId('hasRole')).toHaveTextContent('false')
  })
})

//TOKEN UTILITY TESTS
