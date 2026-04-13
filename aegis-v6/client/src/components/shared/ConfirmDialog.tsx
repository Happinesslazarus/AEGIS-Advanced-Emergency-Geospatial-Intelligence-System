/**
 * Module: ConfirmDialog.tsx
 *
 * Confirm dialog shared component (reusable UI element used across pages).
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import { AlertTriangle } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { title: string; message: string; confirmLabel?: string; cancelLabel?: string; variant?: 'danger' | 'warning' | 'info'; onConfirm: () => void; onCancel: () => void }

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, variant = 'warning', onConfirm, onCancel }: Props): JSX.Element {
  const lang = useLanguage()
  const colors = { danger: 'bg-red-600 hover:bg-red-700', warning: 'bg-amber-600 hover:bg-amber-700', info: 'bg-aegis-600 hover:bg-aegis-700' }
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]" role="alertdialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-[min(24rem,calc(100vw-2rem))] animate-fade-in p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-amber-600" /></div>
          <h3 className="font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">{message}</p>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button onClick={onConfirm} className={`btn flex-1 min-h-[44px] text-white ${colors[variant]}`}>{confirmLabel || t('confirm.confirm', lang)}</button>
          <button onClick={onCancel} className="btn-outline flex-1 min-h-[44px]">{cancelLabel || t('confirm.cancel', lang)}</button>
        </div>
      </div>
    </div>
  )
}
