/**
 * useErrorMonitor custom React hook (error monitor logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useEffect, useRef } from 'react'
import * as Sentry from '@sentry/react'

interface ErrorMonitorOptions {
  /* Called when an unhandled error/rejection is caught. Receives a human-readable message. */
  onUnhandledError?: (message: string) => void
}

export function useErrorMonitor(options?: ErrorMonitorOptions) {
  //Stable ref pattern: storing options in a ref prevents us from needing to
  //re-register the event listeners every time the caller's component re-renders
  //with different option objects.  The listeners always read the *current*
  //options value without being recreated.
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    //unhandledrejection fires when a Promise rejects with no .catch() handler.
    //Common sources: forgotten await calls, network errors in background fetches.
    function handleRejection(e: PromiseRejectionEvent) {
      const reason = e.reason
      const message =
        reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection')

      //Sentry.withScope: temporarily adds extra context tags to the next
      //captured event without affecting all other events.
      Sentry.withScope(scope => {
        scope.setTag('error_type', 'unhandled_rejection')
        scope.setTag('route', window.location.pathname)
        //setContext attaches a named metadata block visible in the Sentry UI.
        scope.setContext('rejection', {
          href: window.location.href,
          online: navigator.onLine,  // was the device connected when it crashed?
          timestamp: new Date().toISOString(),
        })
        if (reason instanceof Error) {
          Sentry.captureException(reason)   // preserves the full stack trace
        } else {
          Sentry.captureMessage(message, 'error')  // string rejection (no stack)
        }
      })

      optionsRef.current?.onUnhandledError?.(message)
    }

    // 'error' event fires for synchronous runtime errors and resource-load
    //failures (e.g. a <script> tag 404).
    function handleError(e: ErrorEvent) {
      //sentryHandled: flag set by the React error boundary Sentry integration.
      //Skipping here prevents the same error from being reported twice.
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

    //Cleanup: remove listeners when the component using this hook unmounts,
    //so we don't accumulate duplicate listeners across hot-reloads in dev mode.
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])
}

