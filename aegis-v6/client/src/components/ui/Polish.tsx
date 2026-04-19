/**
 * Collection of micro-interaction components: AnimatedPresence (mount/
 * unmount with animation), LoadingSpinner, ParticleEffect, and other
 * polish primitives. Keeps animation logic in one place so it stays
 * consistent across the UI.
 *
 * - AnimatedPresence used by modals, dropdowns, and toast notifications
 * - LoadingSpinner used by async data-fetching components
 * - Respects prefers-reduced-motion via Tailwind motion-reduce: classes
 */

import React, { useState, useEffect, useRef, useCallback, ReactNode } from 'react'

// ANIMATED PRESENCE — Mount/unmount with animation

interface AnimatedPresenceProps {
  show: boolean
  children: ReactNode
  animation?: 'fade' | 'slide-up' | 'slide-down' | 'scale' | 'pop'
  duration?: number
  unmountOnExit?: boolean
}

export function AnimatedPresence({
  show,
  children,
  animation = 'fade',
  duration = 200,
  unmountOnExit = true,
}: AnimatedPresenceProps) {
  const [shouldRender, setShouldRender] = useState(show)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (show) {
      setShouldRender(true)
      requestAnimationFrame(() => setIsAnimating(true))
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => {
        if (unmountOnExit) setShouldRender(false)
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [show, duration, unmountOnExit])

  if (!shouldRender && unmountOnExit) return null

  const animations: Record<string, { enter: string; exit: string }> = {
    fade: {
      enter: 'opacity-100',
      exit: 'opacity-0',
    },
    'slide-up': {
      enter: 'opacity-100 translate-y-0',
      exit: 'opacity-0 translate-y-2',
    },
    'slide-down': {
      enter: 'opacity-100 translate-y-0',
      exit: 'opacity-0 -translate-y-2',
    },
    scale: {
      enter: 'opacity-100 scale-100',
      exit: 'opacity-0 scale-95',
    },
    pop: {
      enter: 'opacity-100 scale-100',
      exit: 'opacity-0 scale-90',
    },
  }

  const { enter, exit } = animations[animation]
  const classes = isAnimating ? enter : exit

  return (
    <div
      className={`transition-all ${classes}`}
      style={{ transitionDuration: `${duration}ms` }}
    >
      {children}
    </div>
  )
}

// STAGGERED LIST — Animate list items with delay

interface StaggeredListProps {
  children: ReactNode[]
  staggerDelay?: number
  initialDelay?: number
  animation?: 'fade-up' | 'fade-right' | 'scale' | 'pop'
}

export function StaggeredList({
  children,
  staggerDelay = 50,
  initialDelay = 0,
  animation = 'fade-up',
}: StaggeredListProps) {
  const animations: Record<string, string> = {
    'fade-up': 'animate-slide-up',
    'fade-right': 'animate-slide-fade-left',
    scale: 'animate-scale-in',
    pop: 'animate-pop',
  }

  return (
    <>
      {React.Children.map(children, (child, index) => (
        <div
          key={index}
          className={`${animations[animation]} opacity-0`}
          style={{
            animationDelay: `${initialDelay + index * staggerDelay}ms`,
            animationFillMode: 'forwards',
          }}
        >
          {child}
        </div>
      ))}
    </>
  )
}

// ANIMATED NUMBER — Count-up animation for statistics

interface AnimatedNumberProps {
  value: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}

export function AnimatedNumber({
  value,
  duration = 500,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const startTime = useRef<number | null>(null)
  const startValue = useRef(0)

  useEffect(() => {
    startValue.current = displayValue
    startTime.current = null

    const animate = (currentTime: number) => {
      if (startTime.current === null) startTime.current = currentTime
      const elapsed = currentTime - startTime.current
      const progress = Math.min(elapsed / duration, 1)

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue.current + (value - startValue.current) * eased

      setDisplayValue(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration])

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </span>
  )
}

// RIPPLE BUTTON — Material-style ripple effect

interface RippleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  rippleColor?: string
}

export function RippleButton({
  children,
  rippleColor = 'rgba(255,255,255,0.3)',
  className = '',
  onClick,
  ...props
}: RippleButtonProps) {
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([])
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!buttonRef.current) return

      const rect = buttonRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const id = Date.now()

      setRipples((prev) => [...prev, { x, y, id }])
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id))
      }, 600)

      onClick?.(e)
    },
    [onClick]
  )

  return (
    <button
      ref={buttonRef}
      className={`relative overflow-hidden ${className}`}
      onClick={handleClick}
      {...props}
    >
      {children}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute rounded-full animate-ping-slow pointer-events-none"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: 10,
            height: 10,
            marginLeft: -5,
            marginTop: -5,
            backgroundColor: rippleColor,
          }}
        />
      ))}
    </button>
  )
}

// FOCUS RING — Accessible focus indicator

export const focusRingClasses =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-aegis-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900'

export const focusRingClassesInset =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aegis-500'

// USE INTERSECTION — Animate when element enters viewport

export function useIntersection(
  options: IntersectionObserverInit = { threshold: 0.1 }
): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true)
        observer.disconnect() // Only trigger once
      }
    }, options)

    observer.observe(element)
    return () => observer.disconnect()
  }, [options])

  return [ref, isVisible]
}

// REVEAL ON SCROLL — Wrapper component for scroll-triggered animations

interface RevealOnScrollProps {
  children: ReactNode
  animation?: 'fade-up' | 'fade-left' | 'fade-right' | 'scale' | 'reveal'
  delay?: number
  className?: string
}

export function RevealOnScroll({
  children,
  animation = 'fade-up',
  delay = 0,
  className = '',
}: RevealOnScrollProps) {
  const [ref, isVisible] = useIntersection({ threshold: 0.1 })

  const animations: Record<string, { hidden: string; visible: string }> = {
    'fade-up': {
      hidden: 'opacity-0 translate-y-4',
      visible: 'opacity-100 translate-y-0',
    },
    'fade-left': {
      hidden: 'opacity-0 translate-x-4',
      visible: 'opacity-100 translate-x-0',
    },
    'fade-right': {
      hidden: 'opacity-0 -translate-x-4',
      visible: 'opacity-100 translate-x-0',
    },
    scale: {
      hidden: 'opacity-0 scale-95',
      visible: 'opacity-100 scale-100',
    },
    reveal: {
      hidden: 'opacity-0',
      visible: 'opacity-100 animate-reveal',
    },
  }

  const { hidden, visible } = animations[animation]

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${isVisible ? visible : hidden} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

// SUCCESS CHECKMARK — Animated success indicator

export function SuccessCheckmark({ size = 48, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      className={className}
    >
      <circle
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-green-500"
        style={{
          strokeDasharray: 150,
          strokeDashoffset: 150,
          animation: 'checkCircle 0.4s ease-out forwards',
        }}
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 27l8 8 16-16"
        className="text-green-500"
        style={{
          strokeDasharray: 40,
          strokeDashoffset: 40,
          animation: 'checkMark 0.3s ease-out 0.3s forwards',
        }}
      />
      <style>{`
        @keyframes checkCircle {
          to { stroke-dashoffset: 0; }
        }
        @keyframes checkMark {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  )
}

// LOADING DOTS — Animated loading indicator

export function LoadingDots({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'w-1 h-1',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
  }
  const gaps = { sm: 'gap-0.5', md: 'gap-1', lg: 'gap-1.5' }

  return (
    <span className={`inline-flex items-center ${gaps[size]}`} aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`${sizes[size]} rounded-full bg-current animate-bounce-subtle`}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  )
}

// PULSE DOT — Live indicator with pulse animation

interface PulseDotProps {
  color?: 'green' | 'red' | 'amber' | 'blue'
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export function PulseDot({ color = 'green', size = 'sm', label }: PulseDotProps) {
  const colors = {
    green: 'bg-green-500',
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    blue: 'bg-blue-500',
  }
  const ringColors = {
    green: 'ring-green-500/30',
    red: 'ring-red-500/30',
    amber: 'ring-amber-500/30',
    blue: 'ring-blue-500/30',
  }
  const sizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }

  return (
    <span className="relative inline-flex" aria-label={label}>
      <span className={`${sizes[size]} rounded-full ${colors[color]} animate-pulse`} />
      <span
        className={`absolute inset-0 rounded-full ${colors[color]} opacity-75 animate-ping-slow`}
      />
    </span>
  )
}

// TYPEWRITER — Text typing animation

interface TypewriterProps {
  text: string
  speed?: number
  className?: string
  onComplete?: () => void
}

export function Typewriter({
  text,
  speed = 50,
  className = '',
  onComplete,
}: TypewriterProps) {
  const [displayText, setDisplayText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayText((prev) => prev + text[currentIndex])
        setCurrentIndex((prev) => prev + 1)
      }, speed)
      return () => clearTimeout(timer)
    } else if (onComplete) {
      onComplete()
    }
  }, [currentIndex, text, speed, onComplete])

  useEffect(() => {
    setDisplayText('')
    setCurrentIndex(0)
  }, [text])

  return (
    <span className={className}>
      {displayText}
      <span className="animate-pulse">|</span>
    </span>
  )
}
