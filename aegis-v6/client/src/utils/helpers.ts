/**
 * Shared UI helper functions used across multiple components. Includes
 * severity colour mapping, status label formatting, date display helpers,
 * and text truncation utilities.
 *
 * - Imported by components throughout client/src/components/ and pages/
 * - Pure functions with no side effects and no API calls
 *
 * - client/src/types/index.ts -- SeverityLevel and ReportStatus types used here
 */

import type { SeverityLevel, ReportStatus } from '../types'
import { t } from './i18n'

//API_BASE -- centralised API base URL

export const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || ''

//TIME UTILITIES

/* Relative time string -- e.g. "just now", "5m ago", "3h ago", "2d ago" */
export function timeAgo(dateStr: string | undefined | null): string {
  if (!dateStr) return 'Unknown'
  //diff = milliseconds since the event; divides to minutes, hours, days.
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)    // 60 000 ms = 1 minute
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/* Compact relative time -- "now", "5m", "3h", "2d" (no "ago" suffix) */
export function timeAgoCompact(dateStr: string | undefined | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

//PASSWORD STRENGTH
//Scoring rubric (1 point each -- max 5):
//  length ≥ 8, length ≥ 12, has uppercase, has digit, has special character.
//Totals map to colour-coded strength labels used in the password-change form.
export function getPasswordStrength(pw: string, lang = 'en'): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++  // has a special character
  if (score <= 1) return { score, label: t('citizen.auth.password.weak', lang), color: 'bg-red-500' }
  if (score <= 2) return { score, label: t('citizen.auth.password.fair', lang), color: 'bg-amber-500' }
  if (score <= 3) return { score, label: t('citizen.auth.password.good', lang), color: 'bg-yellow-500' }
  if (score <= 4) return { score, label: t('citizen.auth.password.strong', lang), color: 'bg-green-500' }
  return { score, label: t('citizen.auth.password.veryStrong', lang), color: 'bg-emerald-500' }
}

//EXISTING STYLE HELPERS

export function getSeverityClass(severity: SeverityLevel | string): string {
  const map: Record<string, string> = {
    High: 'badge-critical', Medium: 'badge-medium', Low: 'badge-low',
    high: 'badge-critical', medium: 'badge-medium', low: 'badge-low',
  }
  return map[severity] || 'badge-info'
}

export function getStatusClass(status: ReportStatus | string): string {
  const map: Record<string, string> = {
    Verified: 'badge-verified', Unverified: 'badge-pending', Urgent: 'badge-urgent',
    Flagged: 'badge-flagged', Pending: 'badge-pending',
  }
  return map[status] || 'badge-info'
}

export function getSeverityBorderClass(severity: string): string {
  const map: Record<string, string> = {
    high: 'border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/20',
    medium: 'border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/20',
    low: 'border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/20',
  }
  return map[severity.toLowerCase()] || ''
}

export function getPriorityColor(priority: string): string {
  const map: Record<string, string> = {
    Critical: 'text-red-600 dark:text-red-400', High: 'text-orange-600 dark:text-orange-400',
    Medium: 'text-amber-600 dark:text-amber-400', Low: 'text-blue-600 dark:text-blue-400',
  }
  return map[priority] || 'text-gray-600'
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return 'text-green-600 dark:text-green-400'
  if (confidence >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export function truncate(str: string, len = 80): string {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

/* Escape user-controlled strings before interpolating into HTML templates. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function createMarkerSvg(color: string, size = 32): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`
}

