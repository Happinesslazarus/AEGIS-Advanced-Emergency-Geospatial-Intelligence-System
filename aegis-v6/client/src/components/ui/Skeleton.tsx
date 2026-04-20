/**
 * Shimmer skeleton placeholders for loading states. Provides Skeleton
 * (single bar), SkeletonCard, SkeletonList, and SkeletonTable variants.
 * Uses animate-pulse, and disables animation for users with reduced-motion.
 *
 * - Used by page-level components while data loads from the API
 * - Motion behaviour controlled by motion-reduce Tailwind modifier
 */

import { t, getLanguage } from '../../utils/i18n'

//Shared shimmer class -- gradient sweep for premium feel
//Uses a custom shimmer keyframe + reduced-motion fallback
const SHIMMER = 'skeleton-shimmer motion-reduce:animate-none motion-reduce:opacity-70'

interface SkeletonProps {
  className?: string
  label?: string
}

/* Basic shimmer bar */
export function Skeleton({ className = '', label }: SkeletonProps) {
  const lang = getLanguage()
  return (
    <div
      className={`${SHIMMER} rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      role="status"
      aria-label={label || t('loading.content', lang)}
      aria-busy="true"
    />
  )
}

/* Card-shaped skeleton placeholder */
export function SkeletonCard({ className = '' }: { className?: string }) {
  const lang = getLanguage()
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3 ${className}`}
      role="status"
      aria-label={t('loading.content', lang)}
      aria-busy="true"
    >
      <div className={`${SHIMMER} h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700`} />
      <div className={`${SHIMMER} h-3 w-full rounded bg-gray-200 dark:bg-gray-700`} />
      <div className={`${SHIMMER} h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700`} />
      <div className="flex gap-2 pt-2">
        <div className={`${SHIMMER} h-8 w-20 rounded-full bg-gray-200 dark:bg-gray-700`} />
        <div className={`${SHIMMER} h-8 w-20 rounded-full bg-gray-200 dark:bg-gray-700`} />
      </div>
    </div>
  )
}

/* Multiple row placeholders (e.g. lists, feeds) */
export function SkeletonList({ count = 3, className = '' }: { count?: number; className?: string }) {
  const lang = getLanguage()
  return (
    <div
      className={`space-y-3 ${className}`}
      role="status"
      aria-label={t('loading.content', lang)}
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className={`${SHIMMER} h-10 w-10 rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700`} />
          <div className="flex-1 space-y-2">
            <div className={`${SHIMMER} h-3 w-1/3 rounded bg-gray-200 dark:bg-gray-700`} />
            <div className={`${SHIMMER} h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700`} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* Dashboard stat card skeleton */
export function SkeletonStat({ className = '' }: { className?: string }) {
  const lang = getLanguage()
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2 ${className}`}
      role="status"
      aria-label={t('loading.content', lang)}
      aria-busy="true"
    >
      <div className={`${SHIMMER} h-3 w-20 rounded bg-gray-200 dark:bg-gray-700`} />
      <div className={`${SHIMMER} h-8 w-16 rounded bg-gray-200 dark:bg-gray-700`} />
    </div>
  )
}

/* Table skeleton placeholder */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className = '',
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  const lang = getLanguage()
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}
      role="status"
      aria-label={t('loading.table', lang)}
      aria-busy="true"
    >
      {/* Header row */}
      <div className="flex gap-4 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={`h-${i}`} className={`${SHIMMER} h-3 flex-1 rounded bg-gray-200 dark:bg-gray-700`} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={`${r}-${c}`}
              className={`${SHIMMER} h-3 flex-1 rounded bg-gray-200 dark:bg-gray-700 ${c === 0 ? 'max-w-[120px]' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/* Map panel skeleton placeholder */
export function SkeletonMap({ className = '' }: { className?: string }) {
  const lang = getLanguage()
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 overflow-hidden relative ${className}`}
      style={{ minHeight: 320 }}
      role="status"
      aria-label={t('loading.map', lang)}
      aria-busy="true"
    >
      <div className={`${SHIMMER} absolute inset-0 flex flex-col items-center justify-center gap-3`}>
        <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className={`${SHIMMER} h-3 w-28 rounded bg-gray-200 dark:bg-gray-700`} />
      </div>
      {/* Fake map grid lines */}
      <div className="absolute inset-0 grid grid-cols-4 grid-rows-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="border border-gray-200/50 dark:border-gray-700/30" />
        ))}
      </div>
    </div>
  )
}

/* Chart / analytics skeleton placeholder */
export function SkeletonChart({
  height = 200,
  className = '',
}: {
  height?: number
  className?: string
}) {
  const lang = getLanguage()
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${className}`}
      style={{ minHeight: height }}
      role="status"
      aria-label={t('loading.chart', lang)}
      aria-busy="true"
    >
      <div className={`${SHIMMER} h-3 w-32 rounded bg-gray-200 dark:bg-gray-700 mb-4`} />
      <div className="flex items-end gap-2 h-[calc(100%-28px)]">
        {[40, 65, 45, 80, 55, 70, 35, 90, 60, 50].map((h, i) => (
          <div key={i} className="flex-1 flex items-end">
            <div
              className={`${SHIMMER} w-full rounded-t bg-gray-200 dark:bg-gray-700`}
              style={{ height: `${h}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

