/**
 * File: animations.ts
  *
  * What this file does:
  * Shared animation duration and easing constants used across the UI.
  * Centralising these values ensures consistent motion feel and makes
  * it easy to tune the whole app by adjusting one place.
  *
  * How it connects:
  * - Imported by components/ui/Polish.tsx and other animated components
  * - Values align with Tailwind transition duration classes
 */

//DURATION CONSTANTS (milliseconds)

/** Instant feedback (buttons, toggles) */
export const DURATION_INSTANT = 50

/** Fast transitions (dropdowns, tooltips) */
export const DURATION_FAST = 150

/** Normal transitions (modals, panels) */
export const DURATION_NORMAL = 200

/** Slow transitions (page transitions, complex animations) */
export const DURATION_SLOW = 300

/** Emphasis animations (attention-grabbing effects) */
export const DURATION_EMPHASIS = 500

/** All duration values */
export const DURATIONS = {
  instant: DURATION_INSTANT,
  fast: DURATION_FAST,
  normal: DURATION_NORMAL,
  slow: DURATION_SLOW,
  emphasis: DURATION_EMPHASIS,
} as const

//EASING FUNCTIONS

/** Quick start, gradual stop -- most common for UI */
export const EASE_OUT = 'cubic-bezier(0.0, 0.0, 0.2, 1)'

/** Gradual start, quick stop -- for exits */
export const EASE_IN = 'cubic-bezier(0.4, 0.0, 1, 1)'

/** Symmetric ease -- for loops or reversible animations */
export const EASE_IN_OUT = 'cubic-bezier(0.4, 0.0, 0.2, 1)'

/** Linear -- for progress bars, continuous animations */
export const EASE_LINEAR = 'linear'

/** Bouncy effect -- for playful UI elements */
export const EASE_BOUNCE = 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'

/** Snappy spring -- for quick, responsive feedback */
export const EASE_SPRING = 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'

/** All easing functions */
export const EASINGS = {
  out: EASE_OUT,
  in: EASE_IN,
  inOut: EASE_IN_OUT,
  linear: EASE_LINEAR,
  bounce: EASE_BOUNCE,
  spring: EASE_SPRING,
} as const

//PRESET COMBINATIONS

/** Quick feedback for interactive elements */
export const TRANSITION_FAST = `${DURATION_FAST}ms ${EASE_OUT}`

/** Standard UI transitions */
export const TRANSITION_NORMAL = `${DURATION_NORMAL}ms ${EASE_OUT}`

/** Deliberate, attention-drawing transitions */
export const TRANSITION_SLOW = `${DURATION_SLOW}ms ${EASE_IN_OUT}`

/** All transition presets */
export const TRANSITIONS = {
  fast: TRANSITION_FAST,
  normal: TRANSITION_NORMAL,
  slow: TRANSITION_SLOW,
} as const

//DELAY CONSTANTS (for staggered animations)

/** Base delay for staggered list items */
export const STAGGER_DELAY = 50

/** Calculate delay for nth item in a staggered animation */
export function getStaggerDelay(index: number, baseDelay = STAGGER_DELAY): number {
  return index * baseDelay
}

//REDUCED MOTION UTILITIES

/** Check if user prefers reduced motion */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Get duration respecting reduced motion preference */
export function getMotionSafeDuration(duration: number): number {
  return prefersReducedMotion() ? 0 : duration
}

/** Get CSS transition string respecting reduced motion */
export function getMotionSafeTransition(
  property: string,
  duration: number = DURATION_NORMAL,
  easing: string = EASE_OUT
): string {
  const safeDuration = getMotionSafeDuration(duration)
  return `${property} ${safeDuration}ms ${easing}`
}

//CSS CUSTOM PROPERTIES (inject into document)

/** CSS custom properties for animation timing */
export const CSS_ANIMATION_VARS = `
  :root {
    /* Durations */
    --duration-instant: ${DURATION_INSTANT}ms;
    --duration-fast: ${DURATION_FAST}ms;
    --duration-normal: ${DURATION_NORMAL}ms;
    --duration-slow: ${DURATION_SLOW}ms;
    --duration-emphasis: ${DURATION_EMPHASIS}ms;
    
    /* Easings */
    --ease-out: ${EASE_OUT};
    --ease-in: ${EASE_IN};
    --ease-in-out: ${EASE_IN_OUT};
    --ease-linear: ${EASE_LINEAR};
    --ease-bounce: ${EASE_BOUNCE};
    --ease-spring: ${EASE_SPRING};
    
    /* Stagger */
    --stagger-delay: ${STAGGER_DELAY}ms;
  }
  
  /* Respect reduced motion preferences */
  @media (prefers-reduced-motion: reduce) {
    :root {
      --duration-instant: 0ms;
      --duration-fast: 0ms;
      --duration-normal: 0ms;
      --duration-slow: 0ms;
      --duration-emphasis: 0ms;
      --stagger-delay: 0ms;
    }
  }
`

//KEYFRAME ANIMATION PRESETS

/** Fade in animation */
export const KEYFRAMES_FADE_IN = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`

/** Fade out animation */
export const KEYFRAMES_FADE_OUT = `
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
`

/** Slide up animation */
export const KEYFRAMES_SLIDE_UP = `
  @keyframes slideUp {
    from { transform: translateY(10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`

/** Slide down animation */
export const KEYFRAMES_SLIDE_DOWN = `
  @keyframes slideDown {
    from { transform: translateY(-10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`

/** Scale in animation */
export const KEYFRAMES_SCALE_IN = `
  @keyframes scaleIn {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
`

/** Pulse animation for attention */
export const KEYFRAMES_PULSE = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`

/** Shake animation for errors */
export const KEYFRAMES_SHAKE = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
    20%, 40%, 60%, 80% { transform: translateX(4px); }
  }
`

/** All keyframe definitions */
export const ALL_KEYFRAMES = [
  KEYFRAMES_FADE_IN,
  KEYFRAMES_FADE_OUT,
  KEYFRAMES_SLIDE_UP,
  KEYFRAMES_SLIDE_DOWN,
  KEYFRAMES_SCALE_IN,
  KEYFRAMES_PULSE,
  KEYFRAMES_SHAKE,
].join('\n')
