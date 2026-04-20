/**
 * Keyboard-accessible skip-to-content links rendered at the very top of
 * each page. Normally hidden off-screen but visible on :focus so keyboard
 * and screen-reader users can jump straight to main content.
 *
 * - Rendered in client/src/App.tsx above all other content
 * - Targets #main-content, #navigation, and any custom IDs passed as props
 * - Accessibility requirement: WCAG 2.4.1 (Bypass Blocks)
 */

import React, { memo, useCallback } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useTranslation } from 'react-i18next'

//TYPES

export interface SkipLink {
  /** Label for the link */
  label: string
  /** Target element ID (without #) */
  targetId: string
}

interface SkipLinksProps {
  /** Links to render (default: main content) */
  links?: SkipLink[]
  /** Additional CSS classes */
  className?: string
}

//DEFAULT LINKS

const defaultLinks: SkipLink[] = [
  { label: 'Skip to main content', targetId: 'main-content' },
  { label: 'Skip to navigation', targetId: 'main-nav' },
]

//SKIP LINKS COMPONENT

export const SkipLinks = memo<SkipLinksProps>(({
  links = defaultLinks,
  className = '',
}) => {
  const { t } = useTranslation()
  const { prefersReduced } = useReducedMotion()
  
  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault()
    
    const target = document.getElementById(targetId)
    if (!target) return
    
    //Make target focusable if not naturally focusable
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1')
    }
    
    //Scroll to target
    target.scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'start',
    })
    
    //Focus target
    target.focus({ preventScroll: true })
  }, [prefersReduced])
  
  return (
    <nav
      aria-label={t('skipLinks.label', 'Skip links')}
      className={`skip-links ${className}`}
    >
      {links.map((link, index) => (
        <a
          key={link.targetId}
          href={`#${link.targetId}`}
          onClick={(e) => handleClick(e, link.targetId)}
          className="
            skip-link
            absolute left-4 z-[9999]
            px-4 py-2 rounded-lg
            bg-aegis-600 text-white font-medium
            transform -translate-y-full
            focus:translate-y-4
            focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2
            transition-transform duration-200
            sr-only focus:not-sr-only
          "
          style={{ top: `${index * 48}px` }}
        >
          {t(`skipLinks.${link.targetId}`, link.label)}
        </a>
      ))}
    </nav>
  )
})

SkipLinks.displayName = 'SkipLinks'

//SKIP LINK TARGET (wrapper for main content areas)

interface SkipLinkTargetProps {
  /** Target ID */
  id: string
  /** HTML element to use */
  as?: 'main' | 'nav' | 'section' | 'div'
  /** ARIA role override */
  role?: string
  /** ARIA label */
  'aria-label'?: string
  /** Children */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

export const SkipLinkTarget = memo<SkipLinkTargetProps>(({
  id,
  as: Component = 'div',
  role,
  'aria-label': ariaLabel,
  children,
  className = '',
}) => {
  return (
    <Component
      id={id}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      className={`outline-none ${className}`}
    >
      {children}
    </Component>
  )
})

SkipLinkTarget.displayName = 'SkipLinkTarget'

//CSS (to be added to global styles)

export const skipLinkStyles = `
/* Skip link styles */
.skip-link:focus {
  position: fixed !important;
  width: auto !important;
  height: auto !important;
  clip: auto !important;
  clip-path: none !important;
}

/* Ensure skip link targets don't show focus ring when clicked */
[id]:focus:not(:focus-visible) {
  outline: none;
}

/* Skip link targets should show focus for keyboard users */
[id]:focus-visible {
  outline: 2px solid var(--color-aegis-500, #7c3aed);
  outline-offset: 2px;
}
`

//EXPORTS

export default {
  SkipLinks,
  SkipLinkTarget,
  skipLinkStyles,
}
