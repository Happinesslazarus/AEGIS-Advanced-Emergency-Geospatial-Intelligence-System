/**
 * KeyboardShortcutsOverlay -- press ? to toggle.
 * Shows all admin keyboard shortcuts in a modal.
 */
import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

const SECTIONS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['G', 'D'], label: 'Go to Dashboard' },
      { keys: ['G', 'R'], label: 'Go to Reports' },
      { keys: ['G', 'M'], label: 'Go to Live Map' },
      { keys: ['G', 'A'], label: 'Go to Alerts' },
      { keys: ['G', 'N'], label: 'Go to Analytics' },
      { keys: ['G', 'U'], label: 'Go to User Management' },
    ],
  },
  {
    title: 'Reports',
    shortcuts: [
      { keys: ['Ctrl', 'K'], label: 'Focus search' },
      { keys: ['V'], label: 'Verify selected' },
      { keys: ['F'], label: 'Flag selected' },
      { keys: ['U'], label: 'Mark urgent' },
      { keys: ['R'], label: 'Resolve selected' },
      { keys: ['Esc'], label: 'Clear selection / close modal' },
    ],
  },
  {
    title: 'Interface',
    shortcuts: [
      { keys: ['?'], label: 'Show this help' },
      { keys: ['D'], label: 'Toggle dark/light mode' },
      { keys: ['F'], label: 'Fullscreen map' },
      { keys: ['Ctrl', 'Shift', 'R'], label: 'Refresh data' },
    ],
  },
]

export default function KeyboardShortcutsOverlay({ open, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9000] animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-gray-200 dark:ring-gray-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center">
              <Keyboard className="w-4 h-4 text-white dark:text-gray-900" />
            </div>
            <div>
              <h2 className="font-bold text-sm">Keyboard Shortcuts</h2>
              <p className="text-[10px] text-gray-400 dark:text-gray-400">Press <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[9px] font-mono">?</kbd> anytime to toggle</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Shortcuts grid */}
        <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <h3 className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.15em] mb-3">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.shortcuts.map(s => (
                  <div key={s.label} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-700 dark:text-gray-300">{s.label}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md text-[10px] font-mono font-bold ring-1 ring-gray-200 dark:ring-gray-700 shadow-sm">
                            {k}
                          </kbd>
                          {i < s.keys.length - 1 && <span className="text-[9px] text-gray-400">+</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 pb-5 text-center">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Shortcuts work when no input is focused - <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[9px] font-mono">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  )
}
