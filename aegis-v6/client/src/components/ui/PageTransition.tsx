/**
 * PageTransition -- CSS-only animated route wrapper.
 * Applies a fade + slide-up entrance when a route mounts.
 * Respects prefers-reduced-motion for accessibility.
 */

import { useRef, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface Props {
  children: ReactNode
  className?: string
}

export default function PageTransition({ children, className = '' }: Props): JSX.Element {
  const { pathname } = useLocation()
  const { prefersReduced } = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const prevPath = useRef(pathname)

  useEffect(() => {
    if (prefersReduced) {
      setVisible(true)
      return
    }
    //Reset on route change
    if (pathname !== prevPath.current) {
      setVisible(false)
      prevPath.current = pathname
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(true)
    }
  }, [pathname, prefersReduced])

  return (
    <div
      className={`${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(12px)',
        transition: prefersReduced ? 'none' : 'opacity 350ms cubic-bezier(0,0,0.2,1), transform 350ms cubic-bezier(0,0,0.2,1)',
        willChange: visible ? 'auto' : 'opacity, transform',
      }}
    >
      {children}
    </div>
  )
}
