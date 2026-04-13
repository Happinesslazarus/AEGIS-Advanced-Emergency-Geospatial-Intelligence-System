/**
 * Module: LoadingStates.tsx
 *
 * Loading states UI primitive (low-level UI building block).
 *
 * How it connects:
 * - Used by data-fetching components as placeholder content
 * - Respects useReducedMotion for animation preferences
 * Simple explanation:
 * Reusable loading indicators with reduced-motion support. */

import React, { memo } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { visuallyHiddenStyles } from '../../utils/accessibility'

// SPINNER

interface SpinnerProps {
  /** Size variant */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Color variant */
  variant?: 'primary' | 'secondary' | 'white' | 'current'
  /** Accessible label for screen readers */
  label?: string
  /** Additional CSS classes */
  className?: string
}

const sizeClasses: Record<NonNullable<SpinnerProps['size']>, string> = {
  xs: 'h-3 w-3 border',
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-2',
  xl: 'h-12 w-12 border-3',
}

const variantClasses: Record<NonNullable<SpinnerProps['variant']>, string> = {
  primary: 'border-aegis-600 border-t-transparent',
  secondary: 'border-gray-400 border-t-transparent',
  white: 'border-white border-t-transparent',
  current: 'border-current border-t-transparent',
}

export const Spinner = memo<SpinnerProps>(({
  size = 'md',
  variant = 'primary',
  label = 'Loading...',
  className = '',
}) => {
  const { prefersReduced } = useReducedMotion()
  
  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center justify-center ${className}`}
    >
      <div
        className={`
          rounded-full
          ${sizeClasses[size]}
          ${variantClasses[variant]}
          ${prefersReduced ? '' : 'animate-spin'}
        `}
        aria-hidden="true"
      />
      <span style={visuallyHiddenStyles}>{label}</span>
    </div>
  )
})

Spinner.displayName = 'Spinner'

// SKELETON

interface SkeletonProps {
  /** Width (Tailwind class or CSS value) */
  width?: string
  /** Height (Tailwind class or CSS value) */
  height?: string
  /** Border radius variant */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full'
  /** Show shimmer animation */
  shimmer?: boolean
  /** Additional CSS classes */
  className?: string
  /** Accessible label */
  label?: string
}

const roundedClasses: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
}

export const Skeleton = memo<SkeletonProps>(({
  width,
  height = 'h-4',
  rounded = 'md',
  shimmer = true,
  className = '',
  label = 'Loading content...',
}) => {
  const { prefersReduced } = useReducedMotion()
  const showShimmer = shimmer && !prefersReduced
  
  return (
    <div
      role="status"
      aria-label={label}
      className={`
        bg-gray-200 dark:bg-gray-700
        ${roundedClasses[rounded]}
        ${width || 'w-full'}
        ${height}
        ${showShimmer ? 'animate-shimmer bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 bg-[length:200%_100%]' : ''}
        ${className}
      `}
      aria-busy="true"
    >
      <span style={visuallyHiddenStyles}>{label}</span>
    </div>
  )
})

Skeleton.displayName = 'Skeleton'

// SKELETON TEXT

interface SkeletonTextProps {
  /** Number of lines */
  lines?: number
  /** Last line width */
  lastLineWidth?: string
  /** Line spacing */
  spacing?: 'tight' | 'normal' | 'relaxed'
  /** Additional CSS classes */
  className?: string
}

const spacingClasses: Record<NonNullable<SkeletonTextProps['spacing']>, string> = {
  tight: 'space-y-1',
  normal: 'space-y-2',
  relaxed: 'space-y-3',
}

export const SkeletonText = memo<SkeletonTextProps>(({
  lines = 3,
  lastLineWidth = 'w-3/4',
  spacing = 'normal',
  className = '',
}) => {
  return (
    <div 
      className={`${spacingClasses[spacing]} ${className}`}
      role="status"
      aria-label={`Loading ${lines} lines of text`}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? lastLineWidth : 'w-full'}
          height="h-4"
          label=""
        />
      ))}
    </div>
  )
})

SkeletonText.displayName = 'SkeletonText'

// SKELETON CARD

interface SkeletonCardProps {
  /** Show image placeholder */
  hasImage?: boolean
  /** Image aspect ratio */
  imageAspect?: 'square' | 'video' | 'wide'
  /** Number of text lines */
  lines?: number
  /** Additional CSS classes */
  className?: string
}

const aspectClasses: Record<NonNullable<SkeletonCardProps['imageAspect']>, string> = {
  square: 'aspect-square',
  video: 'aspect-video',
  wide: 'aspect-[21/9]',
}

export const SkeletonCard = memo<SkeletonCardProps>(({
  hasImage = true,
  imageAspect = 'video',
  lines = 2,
  className = '',
}) => {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden ${className}`}
      role="status"
      aria-label="Loading card content"
    >
      {hasImage && (
        <Skeleton
          width="w-full"
          height={aspectClasses[imageAspect]}
          rounded="none"
          label=""
        />
      )}
      <div className="p-4 space-y-3">
        <Skeleton width="w-2/3" height="h-5" label="" />
        <SkeletonText lines={lines} />
      </div>
    </div>
  )
})

SkeletonCard.displayName = 'SkeletonCard'

// SKELETON TABLE

interface SkeletonTableProps {
  /** Number of rows */
  rows?: number
  /** Number of columns */
  columns?: number
  /** Show header row */
  hasHeader?: boolean
  /** Additional CSS classes */
  className?: string
}

export const SkeletonTable = memo<SkeletonTableProps>(({
  rows = 5,
  columns = 4,
  hasHeader = true,
  className = '',
}) => {
  return (
    <div
      className={`w-full ${className}`}
      role="status"
      aria-label={`Loading table with ${rows} rows`}
    >
      {hasHeader && (
        <div className="flex gap-4 p-4 border-b border-gray-200 dark:border-gray-700">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton
              key={i}
              width="flex-1"
              height="h-4"
              label=""
            />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex gap-4 p-4 border-b border-gray-100 dark:border-gray-800"
        >
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton
              key={colIndex}
              width="flex-1"
              height="h-4"
              label=""
            />
          ))}
        </div>
      ))}
    </div>
  )
})

SkeletonTable.displayName = 'SkeletonTable'

// PROGRESS BAR

interface ProgressBarProps {
  /** Progress value (0-100) */
  value: number
  /** Maximum value */
  max?: number
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Color variant */
  variant?: 'primary' | 'success' | 'warning' | 'danger'
  /** Show percentage label */
  showLabel?: boolean
  /** Indeterminate mode (no value) */
  indeterminate?: boolean
  /** Accessible label */
  label?: string
  /** Additional CSS classes */
  className?: string
}

const progressSizeClasses: Record<NonNullable<ProgressBarProps['size']>, string> = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
}

const progressVariantClasses: Record<NonNullable<ProgressBarProps['variant']>, string> = {
  primary: 'bg-aegis-600',
  success: 'bg-green-600',
  warning: 'bg-amber-500',
  danger: 'bg-red-600',
}

export const ProgressBar = memo<ProgressBarProps>(({
  value,
  max = 100,
  size = 'md',
  variant = 'primary',
  showLabel = false,
  indeterminate = false,
  label = 'Progress',
  className = '',
}) => {
  const { prefersReduced } = useReducedMotion()
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  
  return (
    <div className={`w-full ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className={`
          w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden
          ${progressSizeClasses[size]}
        `}
      >
        <div
          className={`
            h-full rounded-full transition-all duration-300
            ${progressVariantClasses[variant]}
            ${indeterminate && !prefersReduced ? 'animate-progress-indeterminate' : ''}
          `}
          style={indeterminate ? undefined : { width: `${percentage}%` }}
        />
      </div>
      {showLabel && !indeterminate && (
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-400 text-right">
          {Math.round(percentage)}%
        </div>
      )}
    </div>
  )
})

ProgressBar.displayName = 'ProgressBar'

// LOADING OVERLAY

interface LoadingOverlayProps {
  /** Is loading */
  isLoading: boolean
  /** Loading message */
  message?: string
  /** Show spinner */
  showSpinner?: boolean
  /** Blur background */
  blur?: boolean
  /** Full screen or relative to parent */
  fullScreen?: boolean
  /** Children to overlay */
  children?: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

export const LoadingOverlay = memo<LoadingOverlayProps>(({
  isLoading,
  message = 'Loading...',
  showSpinner = true,
  blur = false,
  fullScreen = false,
  children,
  className = '',
}) => {
  if (!isLoading && !children) return null
  
  return (
    <div className={`relative ${className}`}>
      {children}
      {isLoading && (
        <div
          className={`
            absolute inset-0 z-50 flex flex-col items-center justify-center
            bg-white/80 dark:bg-gray-900/80
            ${blur ? 'backdrop-blur-sm' : ''}
            ${fullScreen ? 'fixed' : ''}
          `}
          role="alert"
          aria-busy="true"
          aria-live="polite"
        >
          {showSpinner && <Spinner size="lg" className="mb-3" label="" />}
          <span className="text-gray-700 dark:text-gray-300 font-medium">
            {message}
          </span>
        </div>
      )}
    </div>
  )
})

LoadingOverlay.displayName = 'LoadingOverlay'

// SUSPENSE FALLBACK

interface SuspenseFallbackProps {
  /** Message to display */
  message?: string
  /** Minimum height */
  minHeight?: string
  /** Additional CSS classes */
  className?: string
}

export const SuspenseFallback = memo<SuspenseFallbackProps>(({
  message = 'Loading...',
  minHeight = 'min-h-[200px]',
  className = '',
}) => {
  return (
    <div
      className={`
        flex flex-col items-center justify-center
        ${minHeight}
        ${className}
      `}
      role="status"
      aria-live="polite"
    >
      <Spinner size="lg" className="mb-3" label="" />
      <span className="text-gray-600 dark:text-gray-400">{message}</span>
    </div>
  )
})

SuspenseFallback.displayName = 'SuspenseFallback'

// LOADING DOTS

interface LoadingDotsProps {
  /** Size of dots */
  size?: 'sm' | 'md' | 'lg'
  /** Color */
  color?: string
  /** Additional CSS classes */
  className?: string
}

const dotSizeClasses: Record<NonNullable<LoadingDotsProps['size']>, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-3 w-3',
}

export const LoadingDots = memo<LoadingDotsProps>(({
  size = 'md',
  color = 'bg-aegis-600',
  className = '',
}) => {
  const { prefersReduced } = useReducedMotion()
  
  return (
    <div
      className={`flex space-x-1 ${className}`}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`
            ${dotSizeClasses[size]}
            ${color}
            rounded-full
            ${prefersReduced ? '' : 'animate-bounce'}
          `}
          style={prefersReduced ? {} : { animationDelay: `${i * 0.15}s` }}
        />
      ))}
      <span style={visuallyHiddenStyles}>Loading</span>
    </div>
  )
})

LoadingDots.displayName = 'LoadingDots'

// EXPORTS

export default {
  Spinner,
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTable,
  ProgressBar,
  LoadingOverlay,
  SuspenseFallback,
  LoadingDots,
}
