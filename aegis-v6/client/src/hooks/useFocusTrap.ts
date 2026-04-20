/**
 * useFocusTrap custom React hook (focus trap logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useEffect, useRef, useCallback } from 'react'
import { createFocusTrap, focusFirstElement } from '../utils/accessibility'

interface UseFocusTrapOptions {
  /** Whether the trap is currently active */
  enabled?: boolean
  /** Auto-focus first element when enabled */
  autoFocus?: boolean
  /** Return focus to trigger element on disable */
  returnFocus?: boolean
  /** Callback when escape is pressed */
  onEscape?: () => void
}

//useFocusTrap: keeps keyboard focus locked inside a container element
//essential for accessible modals, drawers, and dialog boxes.  Without a
//focus trap, pressing Tab would move focus outside the modal to elements
//the user can't see, breaking keyboard navigation.
//Usage: `const ref = useFocusTrap<HTMLDivElement>({ enabled: isOpen, onEscape: close })`
export function useFocusTrap<T extends HTMLElement>(
  options: UseFocusTrapOptions = {}
): React.RefObject<T> {
  const {
    enabled = true,
    autoFocus = true,
    returnFocus = true,
    onEscape,
  } = options
  
  const containerRef = useRef<T>(null)
  //Store the element that had focus before the trap activated so we can
  //restore it when the trap deactivates (e.g. closing a modal returns focus
  //to the button that opened it, as required by WCAG 2.1 criterion 2.4.3).
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const trapRef = useRef<ReturnType<typeof createFocusTrap> | null>(null)
  
  //Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault()
      onEscape()
    }
  }, [onEscape])
  
  useEffect(() => {
    if (!enabled || !containerRef.current) {
      //Cleanup if disabled
      if (trapRef.current) {
        trapRef.current.deactivate()
        trapRef.current = null
      }
      return
    }
    
    //Store the element that currently has focus BEFORE activating the trap.
    if (returnFocus) {
      previousFocusRef.current = document.activeElement as HTMLElement
    }
    
    //Create and activate trap
    trapRef.current = createFocusTrap(containerRef.current)
    
    if (autoFocus) {
      trapRef.current.activate()
    }
    
    //Add escape handler
    if (onEscape) {
      document.addEventListener('keydown', handleKeyDown)
    }
    
    return () => {
      //Deactivate trap
      if (trapRef.current) {
        trapRef.current.deactivate()
        trapRef.current = null
      }
      
      //Return focus to where it was before the trap opened.
      if (returnFocus && previousFocusRef.current) {
        try {
          previousFocusRef.current.focus()
        } catch {
          //Element may have been removed from the DOM between trap open and close.
          //Calling .focus() on a detached element throws in some browsers.
        }
      }
      
      //Remove escape handler
      if (onEscape) {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [enabled, autoFocus, returnFocus, handleKeyDown, onEscape])
  
  return containerRef
}

export default useFocusTrap
