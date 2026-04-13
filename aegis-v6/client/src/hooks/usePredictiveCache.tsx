/**
 * Module: usePredictiveCache.tsx
 *
 * usePredictiveCache custom React hook (predictive cache logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useCallback, useEffect, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

// Types

interface NavigationPattern {
  from: string
  to: string
  count: number
  lastVisited: number
}

interface PrefetchConfig {
  /** Route pattern (supports wildcards like /admin/*) */
  route: string
  /** Query keys to prefetch */
  queryKeys: readonly unknown[][]
  /** Query functions to call */
  queryFns: (() => Promise<unknown>)[]
  /** Minimum probability to trigger prefetch (0-1) */
  minProbability?: number
  /** Stale time for prefetched data (ms) */
  staleTime?: number
}

interface UsePredictiveCacheOptions {
  /** Prefetch configurations by route */
  configs: PrefetchConfig[]
  /** Whether to track navigation patterns */
  trackPatterns?: boolean
  /** Maximum patterns to store */
  maxPatterns?: number
  /** Minimum probability to trigger any prefetch */
  globalMinProbability?: number
}

// Storage keys
const PATTERNS_KEY = 'aegis-nav-patterns'
const TIME_PATTERNS_KEY = 'aegis-time-patterns'

// Hook

export function usePredictiveCache({
  configs,
  trackPatterns = true,
  maxPatterns = 100,
  globalMinProbability = 0.3,
}: UsePredictiveCacheOptions) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const lastPathRef = useRef<string | null>(null)
  const prefetchedRef = useRef<Set<string>>(new Set())
  
  // Load navigation patterns from storage
  const patterns = useMemo((): NavigationPattern[] => {
    try {
      const stored = localStorage.getItem(PATTERNS_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  }, [])
  
  // savePatterns: persist the updated pattern list to localStorage.
  // We sort by most recently visited and trim to maxPatterns so the storage
  // entry doesn't grow unbounded across many sessions.
  const savePatterns = useCallback((newPatterns: NavigationPattern[]) => {
    try {
      // Keep only most recent patterns
      const trimmed = newPatterns
        .sort((a, b) => b.lastVisited - a.lastVisited)
        .slice(0, maxPatterns)
      localStorage.setItem(PATTERNS_KEY, JSON.stringify(trimmed))
    } catch {
      // Ignore storage errors (e.g. private-browsing quota exceeded)
    }
  }, [maxPatterns])
  
  // Record navigation: every time the path changes, log a "from → to" transition.
  // Over time this builds a simple frequency table we use to predict where the
  // user will go next (a first-order Markov model — next step depends only on
  // the current page, not the full history).
  useEffect(() => {
    if (!trackPatterns) return
    
    const currentPath = location.pathname
    const lastPath = lastPathRef.current
    
    if (lastPath && lastPath !== currentPath) {
      // Look for an existing record of this exact (from → to) pair.
      const existingIndex = patterns.findIndex(
        p => p.from === lastPath && p.to === currentPath
      )
      
      if (existingIndex >= 0) {
        // Seen this transition before: increment its count and update timestamp.
        patterns[existingIndex] = {
          ...patterns[existingIndex]!,
          count: patterns[existingIndex]!.count + 1,
          lastVisited: Date.now(),
        }
      } else {
        // New transition: start counting from 1.
        patterns.push({
          from: lastPath,
          to: currentPath,
          count: 1,
          lastVisited: Date.now(),
        })
      }
      
      savePatterns(patterns)
    }
    
    lastPathRef.current = currentPath
  }, [location.pathname, patterns, savePatterns, trackPatterns])
  
  // Calculate probability of navigating to a route
  const getProbability = useCallback((from: string, to: string): number => {
    const relevantPatterns = patterns.filter(p => p.from === from)
    const totalNavigations = relevantPatterns.reduce((sum, p) => sum + p.count, 0)
    
    if (totalNavigations === 0) return 0
    
    const targetPattern = relevantPatterns.find(p => p.to === to)
    return targetPattern ? targetPattern.count / totalNavigations : 0
  }, [patterns])
  
  // Check if route matches pattern (supports wildcards)
  const matchRoute = useCallback((pattern: string, path: string): boolean => {
    if (pattern === path) return true
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2)
      return path.startsWith(base)
    }
    return false
  }, [])
  
  // Prefetch data for likely navigation targets
  const prefetchLikelyRoutes = useCallback(async () => {
    const currentPath = location.pathname
    
    for (const config of configs) {
      // Skip if already prefetched recently
      const cacheKey = `${currentPath}->${config.route}`
      if (prefetchedRef.current.has(cacheKey)) continue
      
      // Check probability from patterns
      const probability = getProbability(currentPath, config.route)
      const minProb = config.minProbability ?? globalMinProbability
      
      if (probability >= minProb) {
        // Prefetch all queries for this route
        for (let i = 0; i < config.queryKeys.length; i++) {
          const queryKey = config.queryKeys[i]
          const queryFn = config.queryFns[i]
          
          if (queryKey !== undefined && queryFn !== undefined) {
            await queryClient.prefetchQuery({
              queryKey: queryKey as unknown[],
              queryFn,
              staleTime: config.staleTime ?? 60 * 1000,
            })
          }
        }
        
        prefetchedRef.current.add(cacheKey)
      }
    }
  }, [location.pathname, configs, getProbability, globalMinProbability, queryClient])
  
  // Prefetch on route change  
  useEffect(() => {
    // Small delay to let current route finish loading first
    const timer = setTimeout(prefetchLikelyRoutes, 500)
    return () => clearTimeout(timer)
  }, [prefetchLikelyRoutes])
  
  // Prefetch on hover/focus (intent signal)
  const prefetchOnIntent = useCallback((targetRoute: string) => {
    const config = configs.find(c => matchRoute(c.route, targetRoute))
    if (!config) return
    
    const cacheKey = `intent->${targetRoute}`
    if (prefetchedRef.current.has(cacheKey)) return
    
    // Prefetch immediately on intent
    for (let i = 0; i < config.queryKeys.length; i++) {
      const queryKey = config.queryKeys[i]
      const queryFn = config.queryFns[i]
      
      if (queryKey !== undefined && queryFn !== undefined) {
        queryClient.prefetchQuery({
          queryKey: queryKey as unknown[],
          queryFn,
          staleTime: config.staleTime ?? 60 * 1000,
        })
      }
    }
    
    prefetchedRef.current.add(cacheKey)
  }, [configs, matchRoute, queryClient])
  
  // Clear prefetch cache (e.g., on logout)
  const clearPrefetchCache = useCallback(() => {
    prefetchedRef.current.clear()
  }, [])
  
  // Get link props with prefetch-on-hover
  const getPrefetchLinkProps = useCallback((to: string) => ({
    onMouseEnter: () => prefetchOnIntent(to),
    onFocus: () => prefetchOnIntent(to),
  }), [prefetchOnIntent])
  
  return {
    prefetchOnIntent,
    clearPrefetchCache,
    getPrefetchLinkProps,
    getProbability,
  }
}

/**
 * PrefetchLink — Link component with built-in prefetch on hover
 */
import { Link, LinkProps } from 'react-router-dom'
import React from 'react'

interface PrefetchLinkProps extends LinkProps {
  prefetchOnHover?: boolean
  children: React.ReactNode
}

export function PrefetchLink({ 
  to, 
  prefetchOnHover = true,
  children, 
  ...props 
}: PrefetchLinkProps) {
  // This would need integration with usePredictiveCache
  // For now, just render a regular link
  return (
    <Link to={to} {...props}>
      {children}
    </Link>
  )
}
