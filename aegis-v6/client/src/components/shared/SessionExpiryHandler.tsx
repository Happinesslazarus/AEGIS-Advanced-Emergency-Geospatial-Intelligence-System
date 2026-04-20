/**
 * Session expiry handler shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react'

// Session timing constants (milliseconds)
const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes
const WARNING_THRESHOLD = 5 * 60 * 1000 // Show warning 5 minutes before expiry
const ACTIVITY_DEBOUNCE = 60 * 1000 // Debounce activity detection

interface SessionExpiryHandlerProps {
  /** Callback to refresh the session */
  onRefresh: () => Promise<boolean>
  /** Callback when session expires */
  onExpire: () => void
  /** Session timeout in ms (default: 30 minutes) */
  timeout?: number
  /** Warning threshold in ms (default: 5 minutes before expiry) */
  warningThreshold?: number
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean
}

/**
 * Session expiry handler component that shows a warning dialog
 * before the session expires and handles automatic logout.
 */
export function SessionExpiryHandler({
  onRefresh,
  onExpire,
  timeout = SESSION_TIMEOUT,
  warningThreshold = WARNING_THRESHOLD,
  isAuthenticated,
}: SessionExpiryHandlerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  
  const [showWarning, setShowWarning] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const lastActivityRef = useRef(Date.now())
  const warningTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const countdownRef = useRef<ReturnType<typeof setInterval>>()
  const onExpireRef = useRef(onExpire)
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  // Reset timers on activity
  const resetTimers = useCallback(() => {
    const now = Date.now()
    
    // Debounce activity detection
    if (now - lastActivityRef.current < ACTIVITY_DEBOUNCE) return
    lastActivityRef.current = now

    // Clear existing timers
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)

    setShowWarning(false)

    // Set new warning timer
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true)
      setTimeRemaining(warningThreshold)
      
      // Start countdown
      countdownRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1000) {
            clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1000
        })
      }, 1000)
    }, timeout - warningThreshold)

    // Set expiry timer
    expiryTimerRef.current = setTimeout(() => {
      setShowWarning(false)
      onExpireRef.current()
    }, timeout)
  }, [timeout, warningThreshold])

  // Track user activity
  useEffect(() => {
    if (!isAuthenticated) return

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll']
    
    activityEvents.forEach(event => {
      window.addEventListener(event, resetTimers, { passive: true })
    })

    // Initialize timers
    resetTimers()

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetTimers)
      })
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [isAuthenticated, resetTimers])

  // Handle session refresh
  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const success = await onRefresh()
      if (success) {
        resetTimers()
      } else {
        onExpire()
      }
    } catch {
      onExpire()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Format time remaining for display
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  if (!showWarning || !isAuthenticated) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
      aria-describedby="session-warning-desc"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          
          <div className="flex-1">
            <h2
              id="session-warning-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              {t('session.expiryWarningTitle', 'Session Expiring Soon')}
            </h2>
            
            <p
              id="session-warning-desc"
              className="mt-2 text-sm text-gray-600 dark:text-gray-400"
            >
              {t('session.expiryWarningDesc', 'Your session will expire due to inactivity. Would you like to continue?')}
            </p>
            
            <div className="mt-4 flex items-center gap-2 text-2xl font-mono font-bold text-amber-600 dark:text-amber-400">
              <Clock className="w-6 h-6" />
              <span aria-live="polite">{formatTime(timeRemaining)}</span>
            </div>
          </div>
        </div>
        
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex-1 px-4 py-2.5 bg-aegis-600 hover:bg-aegis-700 disabled:bg-aegis-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isRefreshing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : null}
            {t('session.stayLoggedIn', 'Stay Logged In')}
          </button>
          
          <button
            onClick={onExpire}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
          >
            {t('session.logout', 'Log Out')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook to check if session is about to expire.
 * Useful for components that need to know session state.
 */
export function useSessionStatus(timeout = SESSION_TIMEOUT) {
  const [lastActivity, setLastActivity] = useState(Date.now())
  
  useEffect(() => {
    const handleActivity = () => setLastActivity(Date.now())
    
    window.addEventListener('mousedown', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity, { passive: true })
    
    return () => {
      window.removeEventListener('mousedown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
    }
  }, [])
  
  const timeUntilExpiry = timeout - (Date.now() - lastActivity)
  const isExpiringSoon = timeUntilExpiry < WARNING_THRESHOLD
  const isExpired = timeUntilExpiry <= 0
  
  return { lastActivity, timeUntilExpiry, isExpiringSoon, isExpired }
}

export default SessionExpiryHandler
