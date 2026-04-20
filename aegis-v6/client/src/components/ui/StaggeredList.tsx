/**
 * StaggeredList -- Animates children in with cascading delay.
 * Each child slides up and fades in with a stagger offset.
 * Respects prefers-reduced-motion.
 */

import { type ReactNode, Children } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface Props {
  children: ReactNode
  /** Base delay between items (ms) */
  staggerMs?: number
  /** Animation duration per item (ms) */
  durationMs?: number
  className?: string
  /** Direction of entrance */
  direction?: 'up' | 'down' | 'left' | 'right'
}

const TRANSFORMS = {
  up: 'translateY(16px)',
  down: 'translateY(-16px)',
  left: 'translateX(16px)',
  right: 'translateX(-16px)',
}

export default function StaggeredList({
  children,
  staggerMs = 50,
  durationMs = 400,
  className = '',
  direction = 'up',
}: Props): JSX.Element {
  const { prefersReduced } = useReducedMotion()

  return (
    <div className={className}>
      {Children.map(children, (child, index) => {
        if (!child) return null
        if (prefersReduced) return child

        return (
          <div
            style={{
              animation: `staggerFadeIn ${durationMs}ms cubic-bezier(0,0,0.2,1) ${index * staggerMs}ms both`,
              willChange: 'opacity, transform',
            }}
          >
            {child}
          </div>
        )
      })}
      {!prefersReduced && (
        <style>{`
          @keyframes staggerFadeIn {
            from { opacity: 0; transform: ${TRANSFORMS[direction]}; }
            to   { opacity: 1; transform: translate(0); }
          }
        `}</style>
      )}
    </div>
  )
}
