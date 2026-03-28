import { Shield, AlertTriangle } from 'lucide-react'
import type { ConsentConfig } from '../../types'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props {
  config: ConsentConfig; onAccept: () => void; onDecline: () => void
}

export default function ConsentDialog({ config, onAccept, onDecline }: Props): JSX.Element {
  const lang = useLanguage()
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="alertdialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full animate-fade-in">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-aegis-100 dark:bg-aegis-900 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-aegis-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-gray-100">{config.title}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-300">{t('consent.privacyTitle', lang)}</p>
            </div>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">{config.description}</p>
          
          <div className="p-3 bg-warning-surface border border-muted rounded-lg mb-4 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {config.required ? t('consent.requiredWarning', lang) : t('consent.optionalWarning', lang)}
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={onAccept} className="btn-primary flex-1">{t('consent.accept', lang)}</button>
            <button onClick={onDecline} className="btn-outline flex-1">{config.required ? t('consent.goBack', lang) : t('consent.decline', lang)}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
