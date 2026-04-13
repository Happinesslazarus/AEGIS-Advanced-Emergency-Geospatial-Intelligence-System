/**
 * File: LazyImage.tsx
 *
 * What this file does:
 * Deferred image loading via IntersectionObserver. Shows a placeholder
 * (blur-up effect optional) until the image scrolls into view, then
 * fetches and fades in the real image. Falls back gracefully on error.
 *
 * How it connects:
 * - Used by community post galleries and media evidence thumbnails
 * - rootMargin defaults to 200px so images load just before they appear
 */

import { useState, useRef, useEffect, type ImgHTMLAttributes } from 'react'

interface LazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'loading'> {
  /** Image source URL */
  src: string
  /** Alt text (required for accessibility) */
  alt: string
  /** Optional low-quality placeholder (data URI or tiny image URL) */
  placeholder?: string
  /** Whether to use blur-up effect */
  blurUp?: boolean
  /** Custom classNames when loading */
  loadingClassName?: string
  /** Custom classNames when loaded */
  loadedClassName?: string
  /** Callback when image loads */
  onLoad?: () => void
  /** Callback when image fails to load */
  onError?: () => void
  /** Root margin for intersection observer (default: 200px) */
  rootMargin?: string
}

/**
 * LazyImage component with native lazy loading and progressive enhancement.
 * 
 * Features:
 * - Native `loading="lazy"` for modern browsers
 * - Intersection Observer fallback for older browsers
 * - Optional blur-up effect with placeholder
 * - Graceful error handling with fallback
 * - Proper aria attributes for accessibility
 * 
 * @example
 * <LazyImage
 *   src="/images/hero.jpg"
 *   alt="Hero image"
 *   className="w-full h-64 object-cover"
 *   blurUp
 * />
 */
export function LazyImage({
  src,
  alt,
  placeholder,
  blurUp = false,
  loadingClassName = 'opacity-0 scale-[1.02]',
  loadedClassName = 'opacity-100 scale-100',
  onLoad,
  onError,
  rootMargin = '200px',
  className = '',
  style,
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Use Intersection Observer for browsers that don't support native lazy loading
  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    // Check if native lazy loading is supported
    if ('loading' in HTMLImageElement.prototype) {
      setShouldLoad(true)
      return
    }

    // Fallback to Intersection Observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true)
            observer.disconnect()
          }
        })
      },
      { rootMargin }
    )

    observer.observe(img)
    return () => observer.disconnect()
  }, [rootMargin])

  const handleLoad = () => {
    setIsLoaded(true)
    onLoad?.()
  }

  const handleError = () => {
    setHasError(true)
    onError?.()
  }

  // Combine transition classes for blur-up effect
  const transitionClasses = blurUp
    ? `transition-all duration-300 ease-out ${isLoaded ? loadedClassName : loadingClassName}`
    : ''

  // Error fallback display
  if (hasError) {
    return (
      <div
        className={`bg-gray-100 dark:bg-gray-800 flex items-center justify-center ${className}`}
        style={style}
        role="img"
        aria-label={alt}
      >
        <span className="text-gray-400 dark:text-gray-500 text-sm">⚠ Image unavailable</span>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden" style={style}>
      {/* Low-quality placeholder */}
      {blurUp && placeholder && !isLoaded && (
        <img
          src={placeholder}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 w-full h-full object-cover blur-sm scale-110 ${className}`}
        />
      )}
      
      {/* Main image */}
      <img
        ref={imgRef}
        src={shouldLoad ? src : undefined}
        data-src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={`${className} ${transitionClasses}`}
        {...props}
      />
    </div>
  )
}

/**
 * Generate a tiny placeholder data URI for blur-up effect.
 * This creates a solid color placeholder based on the image theme.
 */
export function generatePlaceholder(
  color: string = '#e5e7eb',
  width: number = 10,
  height: number = 10
): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'%3E%3Crect fill='${encodeURIComponent(color)}' width='100%25' height='100%25'/%3E%3C/svg%3E`
}

/**
 * Hook to preload images for critical above-the-fold content.
 * 
 * @example
 * useImagePreload(['/hero.jpg', '/logo.png'])
 */
export function useImagePreload(urls: string[]): void {
  useEffect(() => {
    urls.forEach((url) => {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.href = url
      document.head.appendChild(link)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

export default LazyImage
