/**
 * hooks/useKeyboardShortcuts.ts — Global keyboard shortcuts for AEGIS.
 *
 * Provides productivity shortcuts for power users and operators:
 *   Ctrl+K — Focus search / command palette
 *   Ctrl+/ — Toggle chatbot
 *   Ctrl+N — New report
 *   Ctrl+Shift+A — Go to admin panel
 *   Escape — Close modals / panels
 * — Show keyboard shortcut help (when not in an input)
 */

import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

interface ShortcutHandlers {
  onToggleChat?: () => void
  onNewReport?: () => void
  onFocusSearch?: () => void
  onShowHelp?: () => void
  onEscape?: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}): void {
  const navigate = useNavigate()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable

      // Ctrl+K — Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        handlers.onFocusSearch?.()
        return
      }

      // Ctrl+/ — Toggle chatbot
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        handlers.onToggleChat?.()
        return
      }

      // Ctrl+N — New report
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault()
        handlers.onNewReport?.()
        return
      }

      // Ctrl+Shift+A — Go to admin
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        navigate('/admin')
        return
      }

      // Escape — Close things
      if (e.key === 'Escape') {
        handlers.onEscape?.()
        return
      }

      // — Show shortcut help (only when not typing in an input)
      if (e.key === '?' && !isInput) {
        e.preventDefault()
        handlers.onShowHelp?.()
        return
      }
    },
    [handlers, navigate]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

/* All available shortcuts for the help overlay */
export const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Focus search / command palette' },
  { keys: ['Ctrl', '/'], description: 'Toggle AI chatbot' },
  { keys: ['Ctrl', 'N'], description: 'Submit new report' },
  { keys: ['Ctrl', 'Shift', 'A'], description: 'Go to admin panel' },
  { keys: ['Esc'], description: 'Close modal / panel' },
  { keys: ['?'], description: 'Show keyboard shortcuts' },
] as const
