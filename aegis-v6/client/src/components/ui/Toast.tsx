/**
 * Module: Toast.tsx
 *
 * Toast UI primitive (low-level UI building block).
 *
 * - Provides ToastContext consumed via useToast() hook
 * - Uses useReducedMotion for animation preferences
import React, { createContext, useContext, useReducer, useCallback, useEffect, memo } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { visuallyHiddenStyles } from '../../utils/accessibility'

// TYPES

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'
export type ToastPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  variant: ToastVariant
  title?: string
  message: string
  duration?: number // ms, 0 for persistent
  action?: ToastAction
  dismissible?: boolean
  createdAt: number
}

export interface ToastOptions {
  variant?: ToastVariant
  title?: string
  duration?: number
  action?: ToastAction
  dismissible?: boolean
}

// CONTEXT & REDUCER

type ToastAction_ = 
  | { type: 'ADD_TOAST'; payload: Toast }
  | { type: 'REMOVE_TOAST'; payload: string }
  | { type: 'CLEAR_ALL' }

interface ToastState {
  toasts: Toast[]
}

const toastReducer = (state: ToastState, action: ToastAction_): ToastState => {
  switch (action.type) {
    case 'ADD_TOAST': {
      const newToasts = [...state.toasts, action.payload]
      // Evict oldest toasts beyond hard limit to prevent memory leak
      if (newToasts.length > 20) {
        return { toasts: newToasts.slice(-20) }
      }
      return { toasts: newToasts }
    }
    case 'REMOVE_TOAST':
      return { toasts: state.toasts.filter(t => t.id !== action.payload) }
    case 'CLEAR_ALL':
      return { toasts: [] }
    default:
      return state
  }
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (message: string, options?: ToastOptions) => string
  toastSuccess: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  toastError: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  toastWarning: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  toastInfo: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  dismiss: (id: string) => void
  clearAll: () => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

// PROVIDER

interface ToastProviderProps {
  children: React.ReactNode
  /** Position of toast container */
  position?: ToastPosition
  /** Maximum toasts to show at once */
  maxToasts?: number
  /** Default duration in ms */
  defaultDuration?: number
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
  children,
  position = 'top-right',
  maxToasts = 5,
  defaultDuration = 5000,
}) => {
  const [state, dispatch] = useReducer(toastReducer, { toasts: [] })
  
  const generateId = () => `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  const toast = useCallback((message: string, options: ToastOptions = {}): string => {
    const id = generateId()
    const newToast: Toast = {
      id,
      variant: options.variant || 'info',
      title: options.title,
      message,
      duration: options.duration ?? defaultDuration,
      action: options.action,
      dismissible: options.dismissible ?? true,
      createdAt: Date.now(),
    }
    
    dispatch({ type: 'ADD_TOAST', payload: newToast })
    return id
  }, [defaultDuration])
  
  const toastSuccess = useCallback((message: string, options?: Omit<ToastOptions, 'variant'>) => 
    toast(message, { ...options, variant: 'success' }), [toast])
  
  const toastError = useCallback((message: string, options?: Omit<ToastOptions, 'variant'>) => 
    toast(message, { ...options, variant: 'error' }), [toast])
  
  const toastWarning = useCallback((message: string, options?: Omit<ToastOptions, 'variant'>) => 
    toast(message, { ...options, variant: 'warning' }), [toast])
  
  const toastInfo = useCallback((message: string, options?: Omit<ToastOptions, 'variant'>) => 
    toast(message, { ...options, variant: 'info' }), [toast])
  
  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_TOAST', payload: id })
  }, [])
  
  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' })
  }, [])
  
  // Limit visible toasts
  const visibleToasts = state.toasts.slice(-maxToasts)
  
  const value: ToastContextValue = {
    toasts: visibleToasts,
    toast,
    toastSuccess,
    toastError,
    toastWarning,
    toastInfo,
    dismiss,
    clearAll,
  }
  
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer position={position} toasts={visibleToasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// HOOK

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// TOAST CONTAINER

interface ToastContainerProps {
  position: ToastPosition
  toasts: Toast[]
  onDismiss: (id: string) => void
}

const positionClasses: Record<ToastPosition, string> = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
}

const ToastContainer: React.FC<ToastContainerProps> = ({ position, toasts, onDismiss }) => {
  const isTop = position.startsWith('top')
  
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={`fixed z-[100] flex flex-col gap-2 pointer-events-none ${positionClasses[position]}`}
      style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}
    >
      {/* Screen reader announcement region */}
      <div style={visuallyHiddenStyles} role="status" aria-live="assertive">
        {toasts.length > 0 && `${toasts.length} notification${toasts.length > 1 ? 's' : ''}`}
      </div>
      
      {(isTop ? toasts : [...toasts].reverse()).map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

// TOAST ITEM

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: string) => void
}

const variantStyles: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-200 dark:border-blue-800',
    icon: 'text-blue-600 dark:text-blue-400',
  },
  success: {
    bg: 'bg-green-50 dark:bg-green-900/30',
    border: 'border-green-200 dark:border-green-800',
    icon: 'text-green-600 dark:text-green-400',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    border: 'border-red-200 dark:border-red-800',
    icon: 'text-red-600 dark:text-red-400',
  },
}

const ToastItem = memo<ToastItemProps>(({ toast, onDismiss }) => {
  const { prefersReduced, getSafeTransition } = useReducedMotion()
  const styles = variantStyles[toast.variant]
  
  // Auto-dismiss
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => onDismiss(toast.id), toast.duration)
      return () => clearTimeout(timer)
    }
  }, [toast.id, toast.duration, onDismiss])
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && toast.dismissible) {
      onDismiss(toast.id)
    }
  }
  
  return (
    <div
      role="alert"
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
      className={`
        pointer-events-auto w-full rounded-lg shadow-lg border p-4
        ${styles.bg} ${styles.border}
        ${prefersReduced ? '' : 'animate-toast-in'}
      `}
      style={{ transition: getSafeTransition('all 150ms ease-out') }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`flex-shrink-0 ${styles.icon}`}>
          <ToastIcon variant={toast.variant} />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          {toast.title && (
            <p className="font-medium text-gray-900 dark:text-gray-100 mb-0.5">
              {toast.title}
            </p>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {toast.message}
          </p>
          
          {/* Action */}
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick()
                onDismiss(toast.id)
              }}
              className="mt-2 text-sm font-medium text-aegis-600 dark:text-aegis-400 hover:underline focus:outline-none focus:ring-2 focus:ring-aegis-500 rounded"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        
        {/* Close button */}
        {toast.dismissible && (
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="flex-shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-aegis-500 transition-colors"
            aria-label="Dismiss notification"
          >
            <CloseIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </button>
        )}
      </div>
      
      {/* Progress bar for auto-dismiss */}
      {toast.duration && toast.duration > 0 && !prefersReduced && (
        <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-lg">
          <div
            className={`h-full ${variantStyles[toast.variant].icon.replace('text-', 'bg-')}`}
            style={{
              animation: `toast-progress ${toast.duration}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  )
})

ToastItem.displayName = 'ToastItem'

// ICONS

const ToastIcon: React.FC<{ variant: ToastVariant }> = ({ variant }) => {
  const className = 'h-5 w-5'
  
  switch (variant) {
    case 'success':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )
    case 'error':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )
    case 'warning':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )
    case 'info':
    default:
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
  }
}

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

// CSS ANIMATIONS (inject into global styles)

export const toastAnimations = `
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes toast-progress {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

.animate-toast-in {
  animation: toast-in 200ms ease-out;
}
`

// EXPORTS

export default {
  ToastProvider,
  useToast,
  toastAnimations,
}
