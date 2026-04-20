/**
 * Modal UI primitive (low-level UI building block).
 *
 * - Renders via React portal to document body
 * - Uses useFocusTrap and useReducedMotion hooks
import React, { useEffect, useCallback, useRef, memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { CloseButton } from './Button'

// TYPES

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface ModalProps {
  /** Is modal open */
  isOpen: boolean
  /** Close handler */
  onClose: () => void
  /** Modal title (for accessibility) */
  title: string
  /** Hide visual title */
  hideTitle?: boolean
  /** Modal size */
  size?: ModalSize
  /** Show close button */
  showCloseButton?: boolean
  /** Close on overlay click */
  closeOnOverlayClick?: boolean
  /** Close on ESC */
  closeOnEscape?: boolean
  /** Center content vertically */
  centered?: boolean
  /** Initial focus ref */
  initialFocusRef?: React.RefObject<HTMLElement>
  /** Final focus ref (where to return focus) */
  finalFocusRef?: React.RefObject<HTMLElement>
  /** Lock body scroll */
  lockScroll?: boolean
  /** Additional overlay CSS classes */
  overlayClassName?: string
  /** Additional content CSS classes */
  contentClassName?: string
  /** Children */
  children: React.ReactNode
}

// STYLES

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
}

// SCROLL LOCK HOOK

const useScrollLock = (isLocked: boolean) => {
  useEffect(() => {
    if (!isLocked) return
    
    const originalStyle = window.getComputedStyle(document.body).overflow
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const isRtl = document.documentElement.dir === 'rtl' || document.body.dir === 'rtl'
    
    document.body.style.overflow = 'hidden'
    // Apply padding to correct side based on text direction (RTL fix)
    if (isRtl) {
      document.body.style.paddingLeft = `${scrollbarWidth}px`
    } else {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    
    return () => {
      document.body.style.overflow = originalStyle
      document.body.style.paddingRight = ''
      document.body.style.paddingLeft = ''
    }
  }, [isLocked])
}

// MODAL COMPONENT

export const Modal = memo<ModalProps>(({
  isOpen,
  onClose,
  title,
  hideTitle = false,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  centered = true,
  initialFocusRef,
  finalFocusRef,
  lockScroll = true,
  overlayClassName = '',
  contentClassName = '',
  children,
}) => {
  const { prefersReduced, getSafeTransition } = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  
  const modalRef = useFocusTrap<HTMLDivElement>({
    enabled: isOpen,
    onEscape: closeOnEscape ? onClose : undefined,
  })
  
  const savedFocusRef = useRef<HTMLElement | null>(null)
  
  // Lock scroll when open
  useScrollLock(isOpen && lockScroll)
  
  // Handle mounting/unmounting with animation
  useEffect(() => {
    if (isOpen) {
      // Save current focus
      savedFocusRef.current = document.activeElement as HTMLElement
      setMounted(true)
      // Small delay for CSS transition
      requestAnimationFrame(() => setVisible(true))
    } else if (mounted) {
      setVisible(false)
      const timer = setTimeout(() => {
        setMounted(false)
        // Return focus
        const focusTarget = finalFocusRef?.current || savedFocusRef.current
        focusTarget?.focus()
      }, prefersReduced ? 0 : 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen, finalFocusRef, mounted, prefersReduced])
  
  // Initial focus
  useEffect(() => {
    if (isOpen && mounted && initialFocusRef?.current) {
      initialFocusRef.current.focus()
    }
  }, [isOpen, mounted, initialFocusRef])
  
  // Handle overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnOverlayClick) {
      onClose()
    }
  }, [closeOnOverlayClick, onClose])
  
  // Don't render if not mounted
  if (!mounted) return null
  
  const modalContent = (
    <div
      className={`
        fixed inset-0 z-50 overflow-y-auto
        ${overlayClassName}
      `}
      role="presentation"
    >
      {/* Overlay */}
      <div
        className={`
          fixed inset-0 bg-black/50 backdrop-blur-sm
          transition-opacity duration-200
          ${visible ? 'opacity-100' : 'opacity-0'}
        `}
        style={{ transition: getSafeTransition('opacity 200ms ease-out') }}
        aria-hidden="true"
        onClick={handleOverlayClick}
      />
      
      {/* Container */}
      <div
        className={`
          flex min-h-full px-4 py-6
          ${centered ? 'items-center justify-center' : 'items-start justify-center pt-16'}
        `}
        onClick={handleOverlayClick}
      >
        {/* Modal */}
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={hideTitle ? undefined : 'modal-title'}
          aria-label={hideTitle ? title : undefined}
          className={`
            relative w-full bg-white dark:bg-gray-800
            rounded-xl shadow-2xl
            transform transition-all duration-200
            ${sizeClasses[size]}
            ${visible 
              ? 'opacity-100 scale-100' 
              : 'opacity-0 scale-95'
            }
            ${contentClassName}
          `}
          style={{ 
            transition: getSafeTransition('opacity 200ms ease-out, transform 200ms ease-out')
          }}
        >
          {/* Header with close button */}
          {(showCloseButton || !hideTitle) && (
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              {!hideTitle && (
                <h2
                  id="modal-title"
                  className="text-lg font-semibold text-gray-900 dark:text-gray-100"
                >
                  {title}
                </h2>
              )}
              {hideTitle && <div />}
              {showCloseButton && (
                <CloseButton
                  onClick={onClose}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                />
              )}
            </div>
          )}
          
          {/* Body */}
          <div className={!hideTitle || showCloseButton ? '' : 'pt-5'}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
  
  return createPortal(modalContent, document.body)
})

Modal.displayName = 'Modal'

// MODAL BODY

interface ModalBodyProps {
  children: React.ReactNode
  className?: string
}

export const ModalBody = memo<ModalBodyProps>(({
  children,
  className = '',
}) => (
  <div className={`px-6 pb-5 ${className}`}>
    {children}
  </div>
))

ModalBody.displayName = 'ModalBody'

// MODAL FOOTER

interface ModalFooterProps {
  children: React.ReactNode
  className?: string
}

export const ModalFooter = memo<ModalFooterProps>(({
  children,
  className = '',
}) => (
  <div className={`
    flex items-center justify-end gap-3
    px-6 py-4
    border-t border-gray-200 dark:border-gray-700
    rounded-b-xl
    ${className}
  `}>
    {children}
  </div>
))

ModalFooter.displayName = 'ModalFooter'

// CONFIRMATION DIALOG

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string | React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'danger'
  isLoading?: boolean
}

export const ConfirmDialog = memo<ConfirmDialogProps>(({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  isLoading = false,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null)
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      initialFocusRef={confirmRef}
    >
      <ModalBody>
        <div className="text-gray-600 dark:text-gray-400">
          {message}
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-aegis-500 disabled:opacity-60"
        >
          {cancelText}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className={`
            px-4 py-2 text-sm font-medium text-white rounded-lg
            focus:outline-none focus:ring-2 focus:ring-offset-2
            disabled:opacity-60 disabled:cursor-not-allowed
            ${variant === 'danger' 
              ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' 
              : 'bg-aegis-600 hover:bg-aegis-700 focus:ring-aegis-500'
            }
          `}
        >
          {isLoading ? 'Loading...' : confirmText}
        </button>
      </ModalFooter>
    </Modal>
  )
})

ConfirmDialog.displayName = 'ConfirmDialog'

// ALERT DIALOG

interface AlertDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string | React.ReactNode
  variant?: 'info' | 'success' | 'warning' | 'error'
  closeText?: string
}

const alertIconColors = {
  info: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40',
  success: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40',
  warning: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40',
  error: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40',
}

export const AlertDialog = memo<AlertDialogProps>(({
  isOpen,
  onClose,
  title,
  message,
  variant = 'info',
  closeText = 'OK',
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      hideTitle
      size="sm"
    >
      <div className="px-6 pt-5 pb-4 text-center">
        <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${alertIconColors[variant]}`}>
          <AlertIcon variant={variant} />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {title}
        </h3>
        <div className="text-gray-600 dark:text-gray-400">
          {message}
        </div>
      </div>
      <div className="px-6 pb-5 flex justify-center">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2 text-sm font-medium text-white bg-aegis-600 rounded-lg hover:bg-aegis-700 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2"
        >
          {closeText}
        </button>
      </div>
    </Modal>
  )
})

AlertDialog.displayName = 'AlertDialog'

// ICONS

const AlertIcon: React.FC<{ variant: 'info' | 'success' | 'warning' | 'error' }> = ({ variant }) => {
  const className = 'h-6 w-6'
  
  switch (variant) {
    case 'success':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )
    case 'warning':
    case 'error':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )
    case 'info':
    default:
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
  }
}

// EXPORTS

export default {
  Modal,
  ModalBody,
  ModalFooter,
  ConfirmDialog,
  AlertDialog,
}
