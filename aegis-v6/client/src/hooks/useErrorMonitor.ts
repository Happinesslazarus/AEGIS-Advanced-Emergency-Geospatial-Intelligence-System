/**
 * useErrorMonitor.ts — Global error monitoring hook.
 *
 * Captures unhandled promise rejections and global errors, forwards them
 * to Sentry with additional AEGIS context, and optionally triggers a
 * user-visible notification callback.
 *
 * Mount once in App.tsx:
 *   useErrorMonitor()
 *
 * Or with a toast callback:
 *   useErrorMonitor({ onUnhandledError: msg => showToast(msg) })
 */
import { useEffect, useRef } from 'react'
import * as Sentry from '@sentry/react'

interface ErrorMonitorOptions {
  /* Called when an unhandled error/rejection is caught. Receives a human-readable message. */
  onUnhandledError?: (message: string) => void
}

export function useErrorMonitor(options?: ErrorMonitorOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    // Unhandled promise rejections
    function handleRejection(e: PromiseRejectionEvent) {
      const reason = e.reason
      const message =
        reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection')

      Sentry.withScope(scope => {
        scope.setTag('error_type', 'unhandled_rejection')
        scope.setTag('route', window.location.pathname)
        scope.setContext('rejection', {
          href: window.location.href,
          online: navigator.onLine,
          timestamp: new Date().toISOString(),
        })
        if (reason instanceof Error) {
          Sentry.captureException(reason)
        } else {
          Sentry.captureMessage(message, 'error')
        }
      })

      optionsRef.current?.onUnhandledError?.(message)
    }

    // Global errors (syntax, runtime, resource load)
    function handleError(e: ErrorEvent) {
      // Skip errors already caught by React error boundaries
      if (e.error && e.error.__sentryHandled) return

      Sentry.withScope(scope => {
        scope.setTag('error_type', 'global_error')
        scope.setTag('route', window.location.pathname)
        scope.setContext('global_error', {
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          online: navigator.onLine,
          timestamp: new Date().toISOString(),
        })
        if (e.error instanceof Error) {
          Sentry.captureException(e.error)
        } else {
          Sentry.captureMessage(e.message || 'Unknown global error', 'error')
        }
      })

      optionsRef.current?.onUnhandledError?.(e.message || 'An unexpected error occurred')
    }

    window.addEventListener('unhandledrejection', handleRejection)
    window.addEventListener('error', handleError)

    return () => {
      window.removeEventListener('unhandledrejection', handleRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])
}
