/**
 * ToastContext -- global non-blocking notification toasts.
 * Renders in a fixed portal (#toast-root).
 * Usage: const { toast } = useToast()
 *        toast({ title: 'New urgent report', type: 'error' })
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle, Info, X, Siren, Bell } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'urgent'

interface ToastItem {
  id: string
  title: string
  message?: string
  type: ToastType
  duration?: number
  exiting?: boolean
}

interface ToastContextValue {
  toast: (opts: Omit<ToastItem, 'id' | 'exiting'>) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error:   AlertTriangle,
  warning: Bell,
  info:    Info,
  urgent:  Siren,
}

const STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-900/95 ring-emerald-700/50 text-emerald-100',
  error:   'bg-red-900/95 ring-red-700/50 text-red-100',
  warning: 'bg-amber-900/95 ring-amber-700/50 text-amber-100',
  info:    'bg-gray-900/95 ring-gray-700/50 text-gray-100',
  urgent:  'bg-red-950/98 ring-red-500/60 text-white',
}

const ICON_STYLES: Record<ToastType, string> = {
  success: 'text-emerald-400',
  error:   'text-red-400',
  warning: 'text-amber-400',
  info:    'text-blue-400',
  urgent:  'text-red-300 animate-pulse',
}

function ToastItemEl({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = ICONS[item.type]
  return (
    <div
      className={`toast-item ${item.exiting ? 'toast-exit' : ''} flex items-start gap-3 px-4 py-3 rounded-xl ring-1 backdrop-blur-md shadow-2xl ${STYLES[item.type]}`}
      role="alert"
      aria-live="assertive"
    >
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${ICON_STYLES[item.type]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight">{item.title}</p>
        {item.message && <p className="text-xs opacity-80 mt-0.5 leading-snug">{item.message}</p>}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="flex-shrink-0 w-5 h-5 rounded opacity-60 hover:opacity-100 transition-opacity flex items-center justify-center"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 280)
  }, [])

  const toast = useCallback((opts: Omit<ToastItem, 'id' | 'exiting'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const duration = opts.duration ?? (opts.type === 'urgent' ? 8000 : 4500)
    setToasts(prev => [...prev.slice(-4), { ...opts, id }]) // max 5 toasts
    const timer = setTimeout(() => dismiss(id), duration)
    timerRefs.current.set(id, timer)
    return id
  }, [dismiss])

  //Cleanup timers on unmount
  useEffect(() => {
    return () => { timerRefs.current.forEach(t => clearTimeout(t)) }
  }, [])

  //Ensure portal root exists
  useEffect(() => {
    if (!document.getElementById('toast-root')) {
      const el = document.createElement('div')
      el.id = 'toast-root'
      document.body.appendChild(el)
    }
  }, [])

  const portalRoot = document.getElementById('toast-root')

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {portalRoot && createPortal(
        <div className="flex flex-col gap-2">
          {toasts.map(item => (
            <ToastItemEl key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        portalRoot
      )}
    </ToastContext.Provider>
  )
}
