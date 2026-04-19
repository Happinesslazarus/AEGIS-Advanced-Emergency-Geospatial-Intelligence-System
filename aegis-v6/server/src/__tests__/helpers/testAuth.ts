/**
 * Module: testAuth.ts
 *
 * Test auth server module.
 *
 * - Run by the test runner (Vitest or Jest)
 */

import jwt, { type SignOptions } from 'jsonwebtoken'

// Ensure test secrets are set (idempotent if already set by the test file)
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-at-least-32-chars'

const JWT_SECRET = process.env.JWT_SECRET

// Token payloads

export interface TestUser {
  id: string
  email: string
  role: string
  displayName: string
  department?: string
}

export const TEST_CITIZEN: TestUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'citizen@test.aegis.local',
  role: 'citizen',
  displayName: 'Test Citizen',
}

export const TEST_OPERATOR: TestUser = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'operator@test.aegis.local',
  role: 'operator',
  displayName: 'Test Operator',
  department: 'Emergency Response',
}

export const TEST_ADMIN: TestUser = {
  id: '00000000-0000-0000-0000-000000000003',
  email: 'admin@test.aegis.local',
  role: 'admin',
  displayName: 'Test Admin',
}

export const TEST_MANAGER: TestUser = {
  id: '00000000-0000-0000-0000-000000000004',
  email: 'manager@test.aegis.local',
  role: 'manager',
  displayName: 'Test Manager',
}

// Token generators

/**
 * Generate a valid JWT access token for a given user.
 * Default expiry: 1 hour (plenty for tests).
 */
export function generateTestToken(
  user: TestUser,
  expiresIn: SignOptions['expiresIn'] = '1h',
): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
    JWT_SECRET!,
    { expiresIn },
  )
}

/* Shorthand: citizen token */
export function citizenToken(): string {
  return generateTestToken(TEST_CITIZEN)
}

/* Shorthand: operator token */
export function operatorToken(): string {
  return generateTestToken(TEST_OPERATOR)
}

/* Shorthand: admin token */
export function adminToken(): string {
  return generateTestToken(TEST_ADMIN)
}

/* Shorthand: manager token */
export function managerToken(): string {
  return generateTestToken(TEST_MANAGER)
}

/* Generate an expired token (useful for testing rejection). */
export function expiredToken(user: TestUser = TEST_CITIZEN): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET!,
    { expiresIn: '-1h' as SignOptions['expiresIn'] },   // already expired
  )
}

/* Generate a token signed with the wrong secret. */
export function wrongSecretToken(user: TestUser = TEST_CITIZEN): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    'this-is-the-wrong-secret-entirely',
    { expiresIn: '1h' },
  )
}

/* Authorization header value for supertest `.set()`. */
export function authHeader(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`]
}
