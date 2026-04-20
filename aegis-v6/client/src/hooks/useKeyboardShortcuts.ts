/**
 * useKeyboardShortcuts custom React hook (keyboard shortcuts logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

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
      // Don't fire shortcuts when the user is actively typing.  INPUT, TEXTAREA,
      // and SELECT are native form controls; isContentEditable catches rich-text
      // editors (e.g. the chatbot's draft area) which are plain divs with
      // contenteditable="true".
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable

      // Ctrl+K (Windows/Linux) OR Cmd+K (Mac) — Focus search.
      // e.metaKey is true when the Mac ⌘ (Command) key is held.
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        handlers.onFocusSearch?.()
        return
      }

      // Ctrl+/ (or Cmd+/) — Toggle chatbot sidebar.
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        handlers.onToggleChat?.()
        return
      }

      // Ctrl+N — Open new incident report.  We guard against Shift to avoid
      // accidentally triggering on Ctrl+Shift+N (incognito window shortcut).
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault()
        handlers.onNewReport?.()
        return
      }

      // Ctrl+Shift+A — Jump to admin panel (operator shortcut).
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        navigate('/admin')
        return
      }

      // Escape — Close modals, drawers, or any open panel.
      if (e.key === 'Escape') {
        handlers.onEscape?.()
        return
      }

      // ? (question mark) — Show the shortcut help overlay.
      // We skip this when the user is typing so '?' in a text box works normally.
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

