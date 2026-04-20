/**
 * useSwipeGesture -- Touch swipe detection for mobile.
 * Supports left, right, up, down swipes with configurable threshold.
 * Used for swipe-to-dismiss alerts, swipe between tabs, etc.
 */

import { useRef, useEffect, useCallback } from 'react'

type SwipeDirection = 'left' | 'right' | 'up' | 'down'

interface SwipeConfig {
  /** Callback when a swipe is detected */
  onSwipe: (direction: SwipeDirection) => void
  /** Minimum px distance to register a swipe (default: 50) */
  threshold?: number
  /** Maximum time in ms to complete the swipe (default: 300) */
  maxTime?: number
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean
  /** Prevent default touch behavior during swipe (default: false) */
  preventDefault?: boolean
}

export function useSwipeGesture<T extends HTMLElement = HTMLDivElement>({
  onSwipe,
  threshold = 50,
  maxTime = 300,
  enabled = true,
  preventDefault = false,
}: SwipeConfig) {
  const ref = useRef<T>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    startTime.current = Date.now()
  }, [enabled])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!enabled) return
    const elapsed = Date.now() - startTime.current
    if (elapsed > maxTime) return

    const endX = e.changedTouches[0].clientX
    const endY = e.changedTouches[0].clientY
    const dx = endX - startX.current
    const dy = endY - startY.current
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    //Determine if swipe is primarily horizontal or vertical
    if (absDx > absDy && absDx >= threshold) {
      if (preventDefault) e.preventDefault()
      onSwipe(dx > 0 ? 'right' : 'left')
    } else if (absDy > absDx && absDy >= threshold) {
      if (preventDefault) e.preventDefault()
      onSwipe(dy > 0 ? 'down' : 'up')
    }
  }, [enabled, maxTime, threshold, onSwipe, preventDefault])

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: !preventDefault })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchEnd, enabled, preventDefault])

  return ref
}

/**
 * useShakeGesture -- Detect device shake for shake-to-report.
 * Uses DeviceMotionEvent with a configurable acceleration threshold.
 */
export function useShakeGesture({
  onShake,
  threshold = 25,
  cooldownMs = 2000,
  enabled = true,
}: {
  onShake: () => void
  threshold?: number
  cooldownMs?: number
  enabled?: boolean
}) {
  const lastShake = useRef(0)

  useEffect(() => {
    if (!enabled || typeof DeviceMotionEvent === 'undefined') return

    const handler = (event: DeviceMotionEvent) => {
      const { x, y, z } = event.accelerationIncludingGravity || {}
      if (x == null || y == null || z == null) return

      const force = Math.sqrt(x * x + y * y + z * z)
      if (force > threshold && Date.now() - lastShake.current > cooldownMs) {
        lastShake.current = Date.now()
        onShake()
      }
    }

    window.addEventListener('devicemotion', handler)
    return () => window.removeEventListener('devicemotion', handler)
  }, [enabled, threshold, cooldownMs, onShake])
}

export default useSwipeGesture
