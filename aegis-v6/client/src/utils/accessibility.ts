/**
 * Shared a11y utilities — focus trapping, ARIA helpers, and screen-reader
 * announcements used across the entire UI layer.
 *
 * - Imported by components that need focus trapping or ARIA attributes
 * - Meets WCAG 2.1 AA and Section 508 requirements
 */

//FOCUS MANAGEMENT

//FOCUSABLE_SELECTORS: a CSS selector string that matches every element a
//keyboard user can navigate to using Tab or Shift+Tab.
//Each rule follows WCAG 2.1 Success Criterion 2.1.1 (Keyboard Accessible):
// :not([disabled]) -- skip form controls that are disabled
// :not([aria-hidden="true"]) -- skip elements hidden from assistive tech
// [tabindex]:not([tabindex="-1"]) -- skip elements removed from tab order
export const FOCUSABLE_SELECTORS = [
  'a[href]:not([disabled]):not([aria-hidden="true"])',
  'button:not([disabled]):not([aria-hidden="true"])',
  'input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"])',
  'select:not([disabled]):not([aria-hidden="true"])',
  'textarea:not([disabled]):not([aria-hidden="true"])',
  '[tabindex]:not([tabindex="-1"]):not([disabled]):not([aria-hidden="true"])',
  '[contenteditable="true"]:not([aria-hidden="true"])',
  'audio[controls]:not([aria-hidden="true"])',
  'video[controls]:not([aria-hidden="true"])',
  'details > summary:not([aria-hidden="true"])',
].join(', ')

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
  return Array.from(elements).filter(el => {
    //getComputedStyle checks actual visual state, not just attributes.
    //An element can match the selector yet still be visually invisible
    //due to inherited CSS rules, so we filter those out.
    //el.offsetParent === null means the element (or an ancestor) has
    //display:none, making it unfocusable even without a disabled attribute.
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           el.offsetParent !== null
  })
}

/**
 * Focus first focusable element in container
 */
export function focusFirstElement(container: HTMLElement): boolean {
  const elements = getFocusableElements(container)
  if (elements.length > 0) {
    elements[0].focus()
    return true
  }
  return false
}

/**
 * Focus last focusable element in container
 */
export function focusLastElement(container: HTMLElement): boolean {
  const elements = getFocusableElements(container)
  if (elements.length > 0) {
    elements[elements.length - 1].focus()
    return true
  }
  return false
}

/**
 * Trap focus within a container (for modals/dialogs)
 */
export function createFocusTrap(container: HTMLElement): {
  activate: () => void
  deactivate: () => void
} {
  let previouslyFocused: HTMLElement | null = null
  
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    
    const elements = getFocusableElements(container)
    if (elements.length === 0) return
    
    const firstElement = elements[0]
    const lastElement = elements[elements.length - 1]
    
    if (e.shiftKey) {
      //Shift + Tab
      if (document.activeElement === firstElement) {
        e.preventDefault()
        lastElement.focus()
      }
    } else {
      //Tab
      if (document.activeElement === lastElement) {
        e.preventDefault()
        firstElement.focus()
      }
    }
  }
  
  return {
    activate() {
      previouslyFocused = document.activeElement as HTMLElement
      document.addEventListener('keydown', handleKeyDown)
      //Focus first element after slight delay
      requestAnimationFrame(() => focusFirstElement(container))
    },
    deactivate() {
      document.removeEventListener('keydown', handleKeyDown)
      //Return focus to previously focused element
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }
}

/**
 * Roving tabindex management for widget patterns
 */
export function createRovingTabindex(
  container: HTMLElement,
  selector: string,
  options: { orientation?: 'horizontal' | 'vertical' | 'both'; loop?: boolean } = {}
): { cleanup: () => void } {
  const { orientation = 'both', loop = true } = options
  const items = container.querySelectorAll<HTMLElement>(selector)
  
  if (items.length === 0) return { cleanup: () => {} }
  
  //Initialize - first item is focusable
  items.forEach((item, index) => {
    item.setAttribute('tabindex', index === 0 ? '0' : '-1')
  })
  
  let currentIndex = 0
  
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    const index = Array.from(items).indexOf(target)
    if (index === -1) return
    
    let nextIndex = index
    const horizontal = orientation === 'horizontal' || orientation === 'both'
    const vertical = orientation === 'vertical' || orientation === 'both'
    
    switch (e.key) {
      case 'ArrowRight':
        if (horizontal) {
          e.preventDefault()
          nextIndex = loop ? (index + 1) % items.length : Math.min(index + 1, items.length - 1)
        }
        break
      case 'ArrowLeft':
        if (horizontal) {
          e.preventDefault()
          nextIndex = loop ? (index - 1 + items.length) % items.length : Math.max(index - 1, 0)
        }
        break
      case 'ArrowDown':
        if (vertical) {
          e.preventDefault()
          nextIndex = loop ? (index + 1) % items.length : Math.min(index + 1, items.length - 1)
        }
        break
      case 'ArrowUp':
        if (vertical) {
          e.preventDefault()
          nextIndex = loop ? (index - 1 + items.length) % items.length : Math.max(index - 1, 0)
        }
        break
      case 'Home':
        e.preventDefault()
        nextIndex = 0
        break
      case 'End':
        e.preventDefault()
        nextIndex = items.length - 1
        break
    }
    
    if (nextIndex !== index) {
      items[index].setAttribute('tabindex', '-1')
      items[nextIndex].setAttribute('tabindex', '0')
      items[nextIndex].focus()
      currentIndex = nextIndex
    }
  }
  
  container.addEventListener('keydown', handleKeyDown)
  
  return {
    cleanup() {
      container.removeEventListener('keydown', handleKeyDown)
    }
  }
}

//REDUCED MOTION

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Get motion-safe animation duration
 */
export function getSafeAnimationDuration(defaultMs: number): number {
  return prefersReducedMotion() ? 0 : defaultMs
}

/**
 * Create reduced motion listener
 */
export function onReducedMotionChange(
  callback: (prefersReduced: boolean) => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const handler = (e: MediaQueryListEvent) => callback(e.matches)
  
  mediaQuery.addEventListener('change', handler)
  return () => mediaQuery.removeEventListener('change', handler)
}

//COLOR CONTRAST

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

/**
 * Calculate relative luminance (WCAG 2.1)
 */
function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const sRGB = c / 255
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Calculate contrast ratio between two colors (WCAG 2.1)
 */
export function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)
  
  if (!rgb1 || !rgb2) return 0
  
  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b)
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b)
  
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Check if contrast meets WCAG AA requirements
 */
export function meetsContrastAA(
  foreground: string, 
  background: string, 
  isLargeText: boolean = false
): boolean {
  const ratio = getContrastRatio(foreground, background)
  return isLargeText ? ratio >= 3 : ratio >= 4.5
}

/**
 * Check if contrast meets WCAG AAA requirements
 */
export function meetsContrastAAA(
  foreground: string, 
  background: string, 
  isLargeText: boolean = false
): boolean {
  const ratio = getContrastRatio(foreground, background)
  return isLargeText ? ratio >= 4.5 : ratio >= 7
}

/**
 * Get accessible text color for a background
 */
export function getAccessibleTextColor(backgroundColor: string): '#000000' | '#ffffff' {
  const rgb = hexToRgb(backgroundColor)
  if (!rgb) return '#000000'
  
  const luminance = getRelativeLuminance(rgb.r, rgb.g, rgb.b)
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

//ARIA UTILITIES

/**
 * Generate unique ID for ARIA relationships
 */
let ariaIdCounter = 0
export function generateAriaId(prefix: string = 'aegis'): string {
  return `${prefix}-${++ariaIdCounter}-${Date.now().toString(36)}`
}

/**
 * Create ARIA describedby relationship
 */
export function createAriaDescribedBy(
  elementId: string,
  descriptionId: string
): { 'aria-describedby': string } {
  return { 'aria-describedby': `${descriptionId}` }
}

/**
 * Create ARIA labelledby relationship
 */
export function createAriaLabelledBy(
  ...labelIds: string[]
): { 'aria-labelledby': string } {
  return { 'aria-labelledby': labelIds.join(' ') }
}

/**
 * Create live region attributes
 */
export function createLiveRegion(
  politeness: 'polite' | 'assertive' = 'polite',
  atomic: boolean = true
): { 'aria-live': string; 'aria-atomic': string } {
  return {
    'aria-live': politeness,
    'aria-atomic': String(atomic),
  }
}

/**
 * Create expanded/collapsed state attributes
 */
export function createExpandableAttrs(
  expanded: boolean,
  controlsId: string
): {
  'aria-expanded': string
  'aria-controls': string
} {
  return {
    'aria-expanded': String(expanded),
    'aria-controls': controlsId,
  }
}

/**
 * Create Dialog ARIA attributes
 */
export function createDialogAttrs(
  labelId: string,
  descriptionId?: string
): {
  role: 'dialog'
  'aria-modal': 'true'
  'aria-labelledby': string
  'aria-describedby'?: string
} {
  const attrs: any = {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': labelId,
  }
  if (descriptionId) {
    attrs['aria-describedby'] = descriptionId
  }
  return attrs
}

/**
 * Create Alert Dialog ARIA attributes
 */
export function createAlertDialogAttrs(
  labelId: string,
  descriptionId: string
): {
  role: 'alertdialog'
  'aria-modal': 'true'
  'aria-labelledby': string
  'aria-describedby': string
} {
  return {
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': labelId,
    'aria-describedby': descriptionId,
  }
}

//KEYBOARD NAVIGATION

/**
 * Common keyboard keys
 */
export const Keys = {
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
} as const

/**
 * Check if event matches key(s)
 */
export function isKey(event: KeyboardEvent, ...keys: string[]): boolean {
  return keys.includes(event.key)
}

/**
 * Create keyboard click handler (Enter + Space)
 */
export function createKeyboardClickHandler(
  onClick: (event: React.KeyboardEvent) => void
): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick(event)
    }
  }
}

//SCREEN READER UTILITIES

/**
 * Visually hidden styles (for screen reader only content)
 */
export const visuallyHiddenStyles: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/**
 * Create status message for screen readers
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  const announcement = document.createElement('div')
  Object.assign(announcement.style, visuallyHiddenStyles)
  announcement.setAttribute('aria-live', priority)
  announcement.setAttribute('aria-atomic', 'true')
  announcement.setAttribute('role', priority === 'assertive' ? 'alert' : 'status')
  
  document.body.appendChild(announcement)
  
  //Set content after a tick to ensure it's announced
  requestAnimationFrame(() => {
    announcement.textContent = message
    //Remove after announcement
    setTimeout(() => {
      document.body.removeChild(announcement)
    }, 1000)
  })
}

//SKIP LINKS

/**
 * Skip link targets for main landmarks
 */
export const SKIP_LINK_TARGETS = {
  mainContent: 'main-content',
  navigation: 'main-navigation',
  search: 'search-input',
  footer: 'main-footer',
} as const

/**
 * Create skip link configuration
 */
export function createSkipLinks(): Array<{ href: string; label: string }> {
  return [
    { href: `#${SKIP_LINK_TARGETS.mainContent}`, label: 'Skip to main content' },
    { href: `#${SKIP_LINK_TARGETS.navigation}`, label: 'Skip to navigation' },
    { href: `#${SKIP_LINK_TARGETS.search}`, label: 'Skip to search' },
  ]
}

//HIGH CONTRAST MODE

/**
 * Check if user prefers high contrast
 */
export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-contrast: more)').matches ||
         window.matchMedia('(-ms-high-contrast: active)').matches
}

/**
 * Check if user prefers dark color scheme
 */
export function prefersDarkColorScheme(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

//FORM ACCESSIBILITY

/**
 * Create accessible form field props
 */
export function createFormFieldProps(config: {
  id: string
  label: string
  error?: string
  hint?: string
  required?: boolean
}): {
  inputProps: Record<string, string | boolean | undefined>
  labelProps: Record<string, string>
  errorProps: Record<string, string>
  hintProps: Record<string, string>
} {
  const { id, error, hint, required } = config
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  
  const describedBy = [
    hint ? hintId : null,
    error ? errorId : null,
  ].filter(Boolean).join(' ') || undefined
  
  return {
    inputProps: {
      id,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy,
      'aria-required': required ? 'true' : undefined,
    },
    labelProps: {
      htmlFor: id,
    },
    errorProps: {
      id: errorId,
      role: 'alert',
      'aria-live': 'polite',
    },
    hintProps: {
      id: hintId,
    },
  }
}

//Default export
export default {
  FOCUSABLE_SELECTORS,
  getFocusableElements,
  focusFirstElement,
  focusLastElement,
  createFocusTrap,
  createRovingTabindex,
  prefersReducedMotion,
  getSafeAnimationDuration,
  onReducedMotionChange,
  getContrastRatio,
  meetsContrastAA,
  meetsContrastAAA,
  getAccessibleTextColor,
  generateAriaId,
  createDialogAttrs,
  createAlertDialogAttrs,
  createExpandableAttrs,
  createLiveRegion,
  Keys,
  isKey,
  createKeyboardClickHandler,
  visuallyHiddenStyles,
  announceToScreenReader,
  createSkipLinks,
  SKIP_LINK_TARGETS,
  prefersHighContrast,
  prefersDarkColorScheme,
  createFormFieldProps,
}
