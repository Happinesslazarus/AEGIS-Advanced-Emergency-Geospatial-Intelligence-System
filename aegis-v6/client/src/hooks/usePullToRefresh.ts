/**
 * Module: usePullToRefresh.ts
 *
 * usePullToRefresh custom React hook (pull to refresh logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useRef, useEffect, useCallback, useState } from 'react'

interface PullToRefreshOptions {
  /* Callback invoked when user pulls past threshold and releases */
  onRefresh: () => Promise<void>
  /* Distance in px required to trigger refresh (default: 80) */
  threshold?: number
  /* Max pull distance in px (default: 150) */
  maxPull?: number
  /* Whether the hook is enabled (set false to disable on desktop) */
  enabled?: boolean
}

/**
 * Pull-to-refresh hook for mobile touch devices.
/**
 * Returns a ref to attach to the scrollable container and the current pull state.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 150,
  enabled = true,
}: PullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const pulling = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || refreshing) return
    const el = containerRef.current
    // Only trigger when scrolled to top
    if (el && el.scrollTop <= 0) {
      startY.current = e.touches[0].clientY
      pulling.current = true
    }
  }, [enabled, refreshing])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current || refreshing) return
    const delta = e.touches[0].clientY - startY.current
    if (delta > 0) {
      // Square-root dampening: applying Math.sqrt gives a rubber-band feel —
      // the first few pixels of pull move the indicator quickly (responsive),
      // but large pulls slow down (prevents over-shooting the spinner).
      // Multiplying by 4 scales the low sqrt values back to a visible range.
      const dampened = Math.min(Math.sqrt(delta) * 4, maxPull)
      setPullDistance(dampened)
      if (delta > 10) e.preventDefault() // prevent scroll-bounce
    } else {
      pulling.current = false
      setPullDistance(0)
    }
  }, [refreshing, maxPull])

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return
    pulling.current = false
    if (pullDistance >= threshold) {
      setRefreshing(true)
      setPullDistance(threshold * 0.5) // hold at indicator position
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, threshold, onRefresh])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, enabled])

  return {
    containerRef,
    pullDistance,
    refreshing,
    /* Whether user has pulled past the threshold */
    pastThreshold: pullDistance >= threshold,
  }
}

