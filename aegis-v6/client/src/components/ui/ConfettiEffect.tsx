/**
 * ConfettiEffect — Lightweight confetti burst animation using CSS.
 * No external dependencies. Renders 30 confetti particles that fan
 * outward from the trigger point and fade away.
 * Used after report submission, quiz completion, badge unlocks, etc.
 */

import { useState, useEffect, useCallback } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

const CONFETTI_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7',
  '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#8b5cf6',
]

const PARTICLE_COUNT = 30

interface Particle {
  id: number
  color: string
  x: number
  y: number
  angle: number
  speed: number
  spin: number
  size: number
  shape: 'circle' | 'rect' | 'triangle'
}

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    x: 50 + (Math.random() - 0.5) * 20,
    y: 50 + (Math.random() - 0.5) * 10,
    angle: Math.random() * 360,
    speed: 60 + Math.random() * 120,
    spin: Math.random() * 720 - 360,
    size: 6 + Math.random() * 6,
    shape: (['circle', 'rect', 'triangle'] as const)[Math.floor(Math.random() * 3)],
  }))
}

/**
 * Hook that returns a trigger function and the confetti JSX.
 * Usage:
 *   const { triggerConfetti, ConfettiOverlay } = useConfetti()
 *   // on success: triggerConfetti()
 *   // in JSX: <ConfettiOverlay />
 */
export function useConfetti() {
  const { prefersReduced } = useReducedMotion()
  const [active, setActive] = useState(false)
  const [particles, setParticles] = useState<Particle[]>([])

  const triggerConfetti = useCallback(() => {
    if (prefersReduced) return
    setParticles(createParticles())
    setActive(true)
  }, [prefersReduced])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => {
      setActive(false)
      setParticles([])
    }, 2000)
    return () => clearTimeout(timer)
  }, [active])

  const ConfettiOverlay = () => {
    if (!active || !particles.length) return null

    return (
      <div className="fixed inset-0 z-[99999] pointer-events-none overflow-hidden" aria-hidden="true">
        {particles.map((p) => {
          const rad = (p.angle * Math.PI) / 180
          const tx = Math.cos(rad) * p.speed
          const ty = Math.sin(rad) * p.speed - 40 // bias upward

          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.shape === 'rect' ? p.size * 0.6 : p.size,
                backgroundColor: p.color,
                borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'triangle' ? '0' : '2px',
                clipPath: p.shape === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : undefined,
                animation: `confetti-burst 1.5s cubic-bezier(.25,.46,.45,.94) forwards`,
                '--tx': `${tx}px`,
                '--ty': `${ty}px`,
                '--spin': `${p.spin}deg`,
              } as React.CSSProperties}
            />
          )
        })}
        <style>{`
          @keyframes confetti-burst {
            0% {
              transform: translate(0, 0) rotate(0deg) scale(1);
              opacity: 1;
            }
            60% {
              opacity: 1;
            }
            100% {
              transform: translate(var(--tx), var(--ty)) rotate(var(--spin)) scale(0.3);
              opacity: 0;
            }
          }
        `}</style>
      </div>
    )
  }

  return { triggerConfetti, ConfettiOverlay, isActive: active }
}

export default useConfetti
