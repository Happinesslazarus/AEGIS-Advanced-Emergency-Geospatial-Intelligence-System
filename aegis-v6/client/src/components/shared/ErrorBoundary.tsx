/**
 * Module: ErrorBoundary.tsx
 *
 * Error boundary shared component (reusable UI element used across pages).
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { Component, type ErrorInfo, type ReactNode, createRef } from 'react'
import * as Sentry from '@sentry/react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { t, getLanguage } from '../../utils/i18n'
import ErrorPage from '../../pages/ErrorPage'

// Helpers

/* Generate a short correlation ID for error tracking (8-char hex). */
function generateCorrelationId(): string {
  const arr = new Uint8Array(4)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

const API_BASE = String((import.meta as Record<string, any>).env?.VITE_API_BASE_URL || '')
const MAX_RETRIES_DEFAULT = 3
const COOLDOWN_BASE_MS = 2_000

// Types

interface Props {
  children: ReactNode
  /* Optional custom fallback UI — receives error & reset callback */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  /* Debug identifier shown in logs and Sentry breadcrumbs */
  name?: string
  /* When true, renders the full-page ErrorPage instead of inline card */
  fullPage?: boolean
  /* Maximum number of automatic retries before showing hard failure (default 3) */
  maxRetries?: number
  /* Called after each caught error — allows parent-level telemetry */
  onError?: (error: Error, info: ErrorInfo, correlationId: string) => void
}

interface State {
  hasError: boolean
  error: Error | null
  componentStack: string | null
  correlationId: string | null
  retryCount: number
  cooldownSeconds: number
}

// Component

export default class ErrorBoundary extends Component<Props, State> {
  private cooldownTimer: ReturnType<typeof setInterval> | null = null
  private announceRef = createRef<HTMLDivElement>()

  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      componentStack: null,
      correlationId: null,
      retryCount: 0,
      cooldownSeconds: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, correlationId: generateCorrelationId() }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const cid = this.state.correlationId || generateCorrelationId()
    const boundary = this.props.name || 'Unknown'

    this.setState({ componentStack: info.componentStack || null })

    // Sentry
    Sentry.withScope(scope => {
      scope.setTag('error_boundary', boundary)
      scope.setTag('correlation_id', cid)
      scope.setContext('componentStack', { stack: info.componentStack })
      scope.setFingerprint([boundary, error.message])
      Sentry.captureException(error)
    })

    // Console
    console.error(
      `[ErrorBoundary: ${boundary}] cid=${cid} retry=${this.state.retryCount}`,
      error,
      info.componentStack,
    )

    // Backend log
    this.logToBackend(error, info, cid)

    // Parent callback
    this.props.onError?.(error, info, cid)

    // Screen reader announcement
    this.announceError()
  }

  componentWillUnmount(): void {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer)
  }

  // Backend logging (fire-and-forget)

  private logToBackend(error: Error, info: ErrorInfo, cid: string): void {
    try {
      const payload = {
        correlation_id: cid,
        error_message: error.message,
        error_stack:
          (error.stack || '') +
          '\n--- Component Stack ---\n' +
          (info.componentStack || ''),
        component_name: this.props.name || 'Unknown',
        route: window.location.pathname,
        browser_info: navigator.userAgent,
        retry_count: this.state.retryCount,
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
      // Swallow — error logging must never break the app
    }
  }

  // A11y: screen reader live region

  private announceError(): void {
    requestAnimationFrame(() => {
      const el = this.announceRef.current
      if (!el) return
      el.textContent = ''
      setTimeout(() => {
        el.textContent = t('error.unexpected', getLanguage())
      }, 100)
    })
  }

  // Retry with exponential back-off cooldown

  private handleRetry = (): void => {
    const maxRetries = this.props.maxRetries ?? MAX_RETRIES_DEFAULT
    const nextCount = this.state.retryCount + 1

    if (nextCount > maxRetries) return

    const cooldownMs = Math.min(COOLDOWN_BASE_MS * 2 ** this.state.retryCount, 16_000)
    const cooldownSec = Math.ceil(cooldownMs / 1000)

    this.setState({ cooldownSeconds: cooldownSec })

    this.cooldownTimer = setInterval(() => {
      this.setState(prev => {
        const next = prev.cooldownSeconds - 1
        if (next <= 0) {
          if (this.cooldownTimer) clearInterval(this.cooldownTimer)
          return {
            hasError: false,
            error: null,
            componentStack: null,
            correlationId: null,
            retryCount: nextCount,
            cooldownSeconds: 0,
          } as State
        }
        return { cooldownSeconds: next } as State
      })
    }, 1000)
  }

  private handleHardReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
      correlationId: null,
      retryCount: 0,
      cooldownSeconds: 0,
    })
  }

  // Render

  render(): ReactNode {
    const srAnnouncer = (
      <div
        ref={this.announceRef}
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    )

    if (!this.state.hasError) {
      return (
        <>
          {srAnnouncer}
          {this.props.children}
        </>
      )
    }

    const maxRetries = this.props.maxRetries ?? MAX_RETRIES_DEFAULT
    const retriesExhausted = this.state.retryCount >= maxRetries
    const isCooling = this.state.cooldownSeconds > 0

    // Custom fallback
    if (this.props.fallback) {
      const fb = this.props.fallback
      return (
        <>
          {srAnnouncer}
          {typeof fb === 'function'
            ? fb(this.state.error!, this.handleHardReset)
            : fb}
        </>
      )
    }

    // Full-page mode
    if (this.props.fullPage) {
      return (
        <>
          {srAnnouncer}
          <ErrorPage
            error={this.state.error}
            componentStack={this.state.componentStack}
            correlationId={this.state.correlationId}
            resetError={retriesExhausted ? undefined : this.handleRetry}
            retriesExhausted={retriesExhausted}
            cooldownSeconds={isCooling ? this.state.cooldownSeconds : undefined}
          />
        </>
      )
    }

    // Inline card mode
    const lang = getLanguage()
    // Translate raw technical error messages into plain language
    const rawMsg = this.state.error?.message || ''
    const friendlyMsg = rawMsg.includes('Loading chunk') || rawMsg.includes('Failed to fetch dynamically imported module')
      ? 'This section failed to load. This can happen after an update — try refreshing the page.'
      : rawMsg.includes('NetworkError') || rawMsg.includes('Failed to fetch')
      ? 'Could not connect to the server. Check your internet connection.'
      : rawMsg.includes('Cannot read properties') || rawMsg.includes('is not a function') || rawMsg.includes('is undefined')
      ? 'An unexpected error occurred in this section. Our team has been notified.'
      : rawMsg || t('error.unexpected', lang)
    return (
      <>
        {srAnnouncer}
        <div className="flex flex-col items-center justify-center p-8 text-center" role="alert">
          <div className="bg-danger-surface border border-muted rounded-2xl p-6 max-w-md w-full">
            <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" aria-hidden="true" />
            <h2 className="text-lg font-bold text-red-700 dark:text-red-400 mb-2">
              {this.props.name ? `${this.props.name} failed to load` : t('shared.error.title', lang)}
            </h2>
            <p className="text-sm text-red-600 dark:text-red-300 mb-1">
              {friendlyMsg}
            </p>

            {this.state.correlationId && (
              <p className="text-[10px] font-mono text-red-400 dark:text-red-600 mb-1 select-all">
                {t('error.correlationId', lang)}: {this.state.correlationId}
              </p>
            )}

            <p className="text-xs text-red-400 dark:text-red-500 mb-4">
              {retriesExhausted
                ? t('error.retryCountExhausted', lang)
                : t('error.sectionCrashed', lang)}
            </p>

            {!retriesExhausted && (
              <button
                onClick={this.handleRetry}
                disabled={isCooling}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
              >
                <RefreshCw className={`w-4 h-4 ${isCooling ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isCooling
                  ? t('error.retryIn', lang).replace('{seconds}', String(this.state.cooldownSeconds))
                  : `${t('error.tryAgain', lang)} (${this.state.retryCount + 1}/${maxRetries})`}
              </button>
            )}

            {retriesExhausted && (
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {t('shared.error.refresh', lang)}
              </button>
            )}
          </div>
        </div>
      </>
    )
  }
}

