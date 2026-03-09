/**
 * Skeleton.tsx - Shimmer placeholder components for loading states (#55)
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />         — single line
 *   <SkeletonCard />                           — full card placeholder
 *   <SkeletonList count={5} />                 — multiple row placeholders
 */
import React from 'react'

interface SkeletonProps {
  className?: string
}

/** Basic shimmer bar */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

/** Card-shaped skeleton placeholder */
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3" role="status" aria-label="Loading content">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
    </div>
  )
}

/** Multiple row placeholders */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Dashboard stat card skeleton */
export function SkeletonStat() {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2" role="status" aria-label="Loading statistic">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}
