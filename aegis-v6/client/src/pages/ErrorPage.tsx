/**
 * ErrorPage.tsx — Full-page error fallback for React Error Boundary crashes.
 *
 * Industry-standard features:
 * Correlation ID displayed and selectable for support tickets
 * Structured backend logging with deduplication guard
 * Sentry user feedback integration
 * Retry cooldown countdown UI
 * Retries-exhausted hard-failure state
 * i18n-ready via AEGIS translation system
 * Emergency contacts always visible (critical for emergency platform)
 * Reduced-motion safe animations
 * Focus management: auto-focus heading on mount
 */
import React, { useCallback, useEffect, useRef } from 'react'
import * as Sentry from '@sentry/react'
import { Shield, RefreshCw, Bug, Phone as PhoneIcon, Home, Copy, Check } from 'lucide-react'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import EmergencyBanner from '../components/shared/EmergencyBanner'

interface ErrorPageProps {
  error?: Error | null
  componentStack?: string | null
  correlationId?: string | null
  resetError?: () => void
  retriesExhausted?: boolean
  cooldownSeconds?: number
}

const API_BASE = String((import.meta as Record<string, any>).env?.VITE_API_BASE_URL || '')

export default function ErrorPage({
  error,
  componentStack,
  correlationId,
  resetError,
  retriesExhausted = false,
  cooldownSeconds,
}: ErrorPageProps) {
  const lang = useLanguage()
  const logged = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [copied, setCopied] = React.useState(false)

  // Focus heading on mount for a11y
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Log error to backend (fire-and-forget, deduplicated)
  useEffect(() => {
    if (logged.current) return
    logged.current = true
    try {
      const payload = {
        correlation_id: correlationId || 'unknown',
        error_message: error?.message || 'Unknown error',
        error_stack:
          (error?.stack || '') +
          (componentStack ? '\n--- Component Stack ---\n' + componentStack : ''),
        component_name: 'AppRoot',
        route: window.location.pathname,
        browser_info: navigator.userAgent,
        extra: {
          href: window.location.href,
          timestamp: new Date().toISOString(),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          online: navigator.onLine,
        },
      }
      fetch(`${API_BASE}/api/internal/errors/frontend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    } catch {
      // Swallow
    }
  }, [error, componentStack, correlationId])

  const handleRetry = useCallback(() => {
    if (resetError) {
      resetError()
    } else {
      window.location.reload()
    }
  }, [resetError])

  const handleReport = useCallback(() => {
    // Attempt Sentry feedback dialog first, fall back to email
    if (typeof Sentry.showReportDialog === 'function') {
      try {
        Sentry.showReportDialog({
          eventId: Sentry.lastEventId(),
          title: 'Help us fix this issue',
          subtitle: 'Our team has been notified. If you\'d like to help, tell us what happened.',
          subtitle2: '',
          labelComments: 'What happened?',
          labelSubmit: 'Send Report',
          successMessage: 'Thank you! Your feedback has been sent.',
        })
        return
      } catch {
        // Fall through to email
      }
    }
    const subject = encodeURIComponent(`AEGIS Bug Report — ${correlationId || 'No Ref'}`)
    const body = encodeURIComponent(
      `Reference: ${correlationId || 'N/A'}\nPage: ${window.location.href}\nError: ${error?.message || 'Unknown'}\nTime: ${new Date().toISOString()}\n\nPlease describe what you were doing:\n`,
    )
    window.open(`mailto:support@aegis-platform.org?subject=${subject}&body=${body}`, '_self')
  }, [error, correlationId])

  const handleCopyRef = useCallback(() => {
    if (!correlationId) return
    navigator.clipboard.writeText(correlationId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [correlationId])

  const isCooling = typeof cooldownSeconds === 'number' && cooldownSeconds > 0

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <EmergencyBanner forceShow />

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg w-full text-center">
          {/* AEGIS branding */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-aegis-500 via-aegis-600 to-aegis-700 flex items-center justify-center shadow-xl shadow-aegis-500/20">
              <Shield className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
          </div>

          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2 outline-none"
          >
            {t('error.pageTitle', lang)}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 max-w-sm mx-auto">
            {t('error.pageMessage', lang)}
          </p>

          {/* Error message (dev-visible) */}
          {error?.message && (
            <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-2 max-w-sm mx-auto truncate">
              {error.message}
            </p>
          )}

          {/* Correlation ID — selectable, copyable */}
          {correlationId && (
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 select-all bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-lg">
                {t('error.correlationId', lang)}: {correlationId}
              </span>
              <button
                onClick={handleCopyRef}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                aria-label="Copy reference ID"
                title="Copy reference ID"
              >
                {copied
                  ? <Check className="w-3.5 h-3.5 text-green-500" />
                  : <Copy className="w-3.5 h-3.5 text-gray-400" />}
              </button>
            </div>
          )}

          {/* Retry exhausted warning */}
          {retriesExhausted && (
            <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
              {t('error.retryCountExhausted', lang)}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3 flex-wrap mb-10">
            {!retriesExhausted && resetError ? (
              <button
                onClick={handleRetry}
                disabled={isCooling}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-aegis-600 hover:bg-aegis-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-lg shadow-aegis-600/20 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
              >
                <RefreshCw className={`w-4 h-4 ${isCooling ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isCooling
                  ? t('error.retryIn', lang).replace('{seconds}', String(cooldownSeconds))
                  : t('error.tryAgain', lang)}
              </button>
            ) : (
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-aegis-600 hover:bg-aegis-700 text-white text-sm font-semibold shadow-lg shadow-aegis-600/20 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {t('shared.error.refresh', lang)}
              </button>
            )}

            <button
              onClick={handleReport}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
            >
              <Bug className="w-4 h-4" aria-hidden="true" />
              {t('error.reportIssue', lang)}
            </button>

            <a
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              {t('error.goHome', lang)}
            </a>
          </div>

          {/* Emergency contacts */}
          <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 p-4 text-left max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2 mb-2">
              <PhoneIcon className="w-4 h-4" aria-hidden="true" />
              {t('emergency.contacts', lang)}
            </h3>
            <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
              <li><strong>{t('emergency.services', lang)}:</strong> 999 / 112</li>
              <li><strong>{t('emergency.floodHelpline', lang)}:</strong> 0345 988 1188</li>
              <li><strong>{t('emergency.nonEmergency', lang)}:</strong> 101</li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-gray-400 dark:text-gray-600">
        AEGIS V6 — Emergency Management Platform
      </footer>
    </div>
  )
}
