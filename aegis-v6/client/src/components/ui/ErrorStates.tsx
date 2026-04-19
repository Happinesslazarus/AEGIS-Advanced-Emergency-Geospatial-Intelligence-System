/**
 * Module: ErrorStates.tsx
 *
 * Error states UI primitive (low-level UI building block).
 *
 * - Wraps route-level components as error boundaries
 * - Used inline for fetch failures and empty data states
import React, { Component, memo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// ERROR BOUNDARY

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Fallback component to render on error */
  fallback?: React.ReactNode | ((props: { error: Error; reset: () => void }) => React.ReactNode)
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Show reset button */
  showReset?: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)
    
    // Log to error tracking service in production
    if (process.env.NODE_ENV === 'production') {
      console.error('ErrorBoundary caught an error:', error, errorInfo)
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          reset: this.handleReset,
        })
      }
      
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <ErrorDisplay
          error={this.state.error}
          onRetry={this.props.showReset !== false ? this.handleReset : undefined}
        />
      )
    }

    return this.props.children
  }
}

// ERROR DISPLAY

interface ErrorDisplayProps {
  /** Error object or message */
  error: Error | string
  /** Title override */
  title?: string
  /** Retry callback */
  onRetry?: () => void
  /** Retry button text */
  retryText?: string
  /** Additional CSS classes */
  className?: string
  /** Compact variant */
  compact?: boolean
  /** Show error details */
  showDetails?: boolean
}

export const ErrorDisplay = memo<ErrorDisplayProps>(({
  error,
  title,
  onRetry,
  retryText,
  className = '',
  compact = false,
  showDetails = false,
}) => {
  const { t } = useTranslation()
  const [showStack, setShowStack] = useState(false)
  
  const errorMessage = typeof error === 'string' ? error : error.message
  const errorStack = typeof error === 'object' ? error.stack : undefined
  
  if (compact) {
    return (
      <div
        role="alert"
        className={`
          flex items-center gap-3 p-3 rounded-lg
          bg-red-50 dark:bg-red-900/20 
          border border-red-200 dark:border-red-800
          ${className}
        `}
      >
        <ErrorIcon className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
        <span className="text-sm text-red-700 dark:text-red-300 flex-1">
          {errorMessage}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-medium text-red-700 dark:text-red-300 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded"
          >
            {retryText || t('common.retry', 'Retry')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      role="alert"
      className={`
        p-6 rounded-lg text-center
        bg-red-50 dark:bg-red-900/20 
        border border-red-200 dark:border-red-800
        ${className}
      `}
    >
      <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mb-4">
        <ErrorIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
        {title || t('error.title', 'Something went wrong')}
      </h3>
      
      <p className="text-red-700 dark:text-red-300 mb-4">
        {errorMessage}
      </p>
      
      {showDetails && errorStack && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowStack(!showStack)}
            className="text-sm text-red-600 dark:text-red-400 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
          >
            {showStack ? t('error.hideDetails', 'Hide details') : t('error.showDetails', 'Show details')}
          </button>
          {showStack && (
            <pre className="mt-2 p-3 bg-red-100 dark:bg-red-950 rounded text-left text-xs overflow-auto max-h-40 text-red-800 dark:text-red-200">
              {errorStack}
            </pre>
          )}
        </div>
      )}
      
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
        >
          <RefreshIcon className="h-4 w-4 mr-2" />
          {retryText || t('common.tryAgain', 'Try again')}
        </button>
      )}
    </div>
  )
})

ErrorDisplay.displayName = 'ErrorDisplay'

// INLINE ERROR

interface InlineErrorProps {
  /** Error message */
  message: string
  /** Associated form field ID for accessibility */
  fieldId?: string
  /** Additional CSS classes */
  className?: string
}

export const InlineError = memo<InlineErrorProps>(({
  message,
  fieldId,
  className = '',
}) => {
  return (
    <p
      role="alert"
      id={fieldId ? `${fieldId}-error` : undefined}
      className={`flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1 ${className}`}
    >
      <ErrorIcon className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </p>
  )
})

InlineError.displayName = 'InlineError'

// EMPTY STATE

interface EmptyStateProps {
  /** Icon component */
  icon?: React.ReactNode
  /** Title text */
  title: string
  /** Description text */
  description?: string
  /** Primary action */
  action?: {
    label: string
    onClick: () => void
  }
  /** Secondary action */
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  /** Additional CSS classes */
  className?: string
}

export const EmptyState = memo<EmptyStateProps>(({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
}) => {
  return (
    <div
      className={`py-12 px-6 text-center ${className}`}
      role="status"
    >
      {icon && (
        <div className="mx-auto w-16 h-16 mb-4 text-gray-400 dark:text-gray-500">
          {icon}
        </div>
      )}
      
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h3>
      
      {description && (
        <p className="text-gray-600 dark:text-gray-400 max-w-sm mx-auto mb-6">
          {description}
        </p>
      )}
      
      {(action || secondaryAction) && (
        <div className="flex items-center justify-center gap-3">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-aegis-600 text-white font-medium hover:bg-aegis-700 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 transition-colors"
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

EmptyState.displayName = 'EmptyState'

// OFFLINE INDICATOR

interface OfflineIndicatorProps {
  /** Is currently offline */
  isOffline: boolean
  /** Message when offline */
  message?: string
  /** Position */
  position?: 'top' | 'bottom'
  /** Additional CSS classes */
  className?: string
}

export const OfflineIndicator = memo<OfflineIndicatorProps>(({
  isOffline,
  message,
  position = 'top',
  className = '',
}) => {
  const { t } = useTranslation()
  
  if (!isOffline) return null
  
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`
        fixed left-0 right-0 z-50 px-4 py-2
        bg-amber-500 text-white text-center text-sm font-medium
        ${position === 'top' ? 'top-0' : 'bottom-0'}
        ${className}
      `}
    >
      <OfflineIcon className="inline h-4 w-4 mr-2" />
      {message || t('network.offline', 'You are offline. Some features may be unavailable.')}
    </div>
  )
})

OfflineIndicator.displayName = 'OfflineIndicator'

// RETRY WRAPPER

interface RetryWrapperProps {
  /** Async function to retry */
  fetchFn: () => Promise<void>
  /** Maximum retry attempts */
  maxRetries?: number
  /** Initial delay in ms */
  initialDelay?: number
  /** Backoff multiplier */
  backoffMultiplier?: number
  /** Render prop for children */
  children: (props: {
    loading: boolean
    error: Error | null
    retry: () => void
    retryCount: number
  }) => React.ReactNode
}

export const RetryWrapper: React.FC<RetryWrapperProps> = ({
  fetchFn,
  maxRetries = 3,
  initialDelay = 1000,
  backoffMultiplier = 2,
  children,
}) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  
  const execute = useCallback(async (attempt = 0) => {
    setLoading(true)
    setError(null)
    setRetryCount(attempt)
    
    try {
      await fetchFn()
      setLoading(false)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt)
        setTimeout(() => execute(attempt + 1), delay)
      } else {
        setError(error)
        setLoading(false)
      }
    }
  }, [fetchFn, maxRetries, initialDelay, backoffMultiplier])
  
  const retry = useCallback(() => {
    execute(0)
  }, [execute])
  
  return <>{children({ loading, error, retry, retryCount })}</>
}

// NOT FOUND

interface NotFoundProps {
  /** Resource type that wasn't found */
  resourceType?: string
  /** Title override */
  title?: string
  /** Description override */
  description?: string
  /** Back button configuration */
  backButton?: {
    label: string
    onClick: () => void
  }
  /** Additional CSS classes */
  className?: string
}

export const NotFound = memo<NotFoundProps>(({
  resourceType,
  title,
  description,
  backButton,
  className = '',
}) => {
  const { t } = useTranslation()
  
  return (
    <div className={`py-16 px-6 text-center ${className}`}>
      <div className="text-6xl font-bold text-gray-200 dark:text-gray-700 mb-4">
        404
      </div>
      
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title || t('notFound.title', resourceType ? `${resourceType} not found` : 'Page not found')}
      </h2>
      
      <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
        {description || t('notFound.description', 'The page you\'re looking for doesn\'t exist or has been moved.')}
      </p>
      
      {backButton && (
        <button
          type="button"
          onClick={backButton.onClick}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-aegis-600 text-white font-medium hover:bg-aegis-700 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 transition-colors"
        >
          <BackIcon className="h-4 w-4 mr-2" />
          {backButton.label}
        </button>
      )}
    </div>
  )
})

NotFound.displayName = 'NotFound'

// ACCESS DENIED

interface AccessDeniedProps {
  /** Title override */
  title?: string
  /** Description override */
  description?: string
  /** Contact support action */
  onContactSupport?: () => void
  /** Back action */
  onBack?: () => void
  /** Additional CSS classes */
  className?: string
}

export const AccessDenied = memo<AccessDeniedProps>(({
  title,
  description,
  onContactSupport,
  onBack,
  className = '',
}) => {
  const { t } = useTranslation()
  
  return (
    <div className={`py-16 px-6 text-center ${className}`}>
      <div className="mx-auto w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mb-4">
        <LockIcon className="h-8 w-8 text-red-600 dark:text-red-400" />
      </div>
      
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title || t('accessDenied.title', 'Access Denied')}
      </h2>
      
      <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
        {description || t('accessDenied.description', 'You don\'t have permission to access this resource.')}
      </p>
      
      <div className="flex items-center justify-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 transition-colors"
          >
            <BackIcon className="h-4 w-4 mr-2" />
            {t('common.goBack', 'Go back')}
          </button>
        )}
        {onContactSupport && (
          <button
            type="button"
            onClick={onContactSupport}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-aegis-600 text-white font-medium hover:bg-aegis-700 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 transition-colors"
          >
            {t('common.contactSupport', 'Contact Support')}
          </button>
        )}
      </div>
    </div>
  )
})

AccessDenied.displayName = 'AccessDenied'

// ICONS (Inline SVG for tree-shaking)

const ErrorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
)

const OfflineIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414" />
  </svg>
)

const BackIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)

const LockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
)

// EXPORTS

export default {
  ErrorBoundary,
  ErrorDisplay,
  InlineError,
  EmptyState,
  OfflineIndicator,
  RetryWrapper,
  NotFound,
  AccessDenied,
}
