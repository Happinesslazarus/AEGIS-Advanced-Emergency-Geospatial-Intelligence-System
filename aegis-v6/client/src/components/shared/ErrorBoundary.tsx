/**
 * ErrorBoundary.tsx — React error boundary that catches render crashes
 * and displays a user-friendly fallback instead of a blank page.
 *
 * Logs errors to console in dev and could be extended to send to
 * a remote logging service in production.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { t, getLanguage } from '../../utils/i18n'

interface Props {
  children: ReactNode
  /** Optional custom fallback UI */
  fallback?: ReactNode
  /** Name shown in the error card for debugging context */
  name?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ''}]`, error, info.componentStack)

    // Report to backend error logging endpoint (fire-and-forget)
    try {
      const payload = {
        error_message: error.message,
        error_stack: (error.stack || '') + '\n--- Component Stack ---\n' + (info.componentStack || ''),
        component_name: this.props.name || 'Unknown',
        route: window.location.pathname,
        browser_info: navigator.userAgent,
        extra: {
          href: window.location.href,
          timestamp: new Date().toISOString(),
        },
      }
      fetch('http://localhost:3001/api/internal/errors/frontend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {}) // Swallow — error logging must never break the app
    } catch {
      // Swallow
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex flex-col items-center justify-center p-8 text-center" role="alert">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl p-6 max-w-md">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-red-700 dark:text-red-400 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-600 dark:text-red-300 mb-1">
            {this.props.name && (
              <span className="font-mono text-xs bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded mr-2">
                {this.props.name}
              </span>
            )}
            {this.state.error?.message || t('error.unexpected', getLanguage())}
          </p>
          <p className="text-xs text-red-400 dark:text-red-500 mb-4">
            {t('error.sectionCrashed', getLanguage())}
          </p>
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t('error.tryAgain', getLanguage())}
          </button>
        </div>
      </div>
    )
  }
}
