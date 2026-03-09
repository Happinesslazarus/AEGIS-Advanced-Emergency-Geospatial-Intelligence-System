/*
 * auth.ts - Authentication utilities
 * Wraps the JWT token/user stored in localStorage
 */
import { getUser, clearToken } from './api'
import type { Operator } from '../types'

export function getSession(): Operator | null {
  return getUser()
}

export function logout(): void {
  clearToken()
}
