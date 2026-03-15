/*
 * CommunityGuidelines.tsx — Guidelines Modal
 * 
 * Displays community guidelines to users to prevent harmful content
 * and enforce respectful behavior in the community feed
 */

import React, { useState } from 'react'
import { AlertCircle, CheckCircle, X, Eye, EyeOff } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface GuidelinesModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CommunityGuidelines({ isOpen, onClose }: GuidelinesModalProps) {
  const lang = useLanguage()
  const [understood, setUnderstood] = useState(false)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-aegis-600 to-aegis-700 text-white p-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <div>
              <h2 className="text-xl font-bold">{t('community.guidelines', lang)}</h2>
              <p className="text-sm text-white/80">{t('community.guidelinesSubtitle', lang)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('common.close', lang)} className="p-1 hover:bg-white/20 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Section 1: Respectful Communication */}
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">{t('community.beRespectful', lang)}</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-1">
                  <li>• {t('community.respectBullet1', lang)}</li>
                  <li>• {t('community.respectBullet2', lang)}</li>
                  <li>• {t('community.respectBullet3', lang)}</li>
                  <li>• {t('community.respectBullet4', lang)}</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 2: No Harmful Content */}
          <section className="space-y-3 border-l-4 border-red-500 pl-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">{t('community.prohibitedContent', lang)}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-2">{t('community.doNotPost', lang)}</p>
                <ul className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-1">
                  <li>• {t('community.prohibitedBullet1', lang)}</li>
                  <li>• {t('community.prohibitedBullet2', lang)}</li>
                  <li>• {t('community.prohibitedBullet3', lang)}</li>
                  <li>• {t('community.prohibitedBullet4', lang)}</li>
                  <li>• {t('community.prohibitedBullet5', lang)}</li>
                  <li>• {t('community.prohibitedBullet6', lang)}</li>
                  <li>• {t('community.prohibitedBullet7', lang)}</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 3: Accurate Information */}
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Eye className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">{t('community.postAccurate', lang)}</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-1">
                  <li>• {t('community.accurateBullet1', lang)}</li>
                  <li>• {t('community.accurateBullet2', lang)}</li>
                  <li>• {t('community.accurateBullet3', lang)}</li>
                  <li>• {t('community.accurateBullet4', lang)}</li>
                  <li>• {t('community.accurateBullet5', lang)}</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 4: Privacy & Security */}
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <EyeOff className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">{t('community.protectPrivacy', lang)}</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-1">
                  <li>• {t('community.privacyBullet1', lang)}</li>
                  <li>• {t('community.privacyBullet2', lang)}</li>
                  <li>• {t('community.privacyBullet3', lang)}</li>
                  <li>• {t('community.privacyBullet4', lang)}</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 5: Community Values */}
          <section className="space-y-3 bg-aegis-50 dark:bg-aegis-900/20 rounded-lg p-4 border border-aegis-200 dark:border-aegis-800">
            <h3 className="font-bold text-gray-900 dark:text-white">{t('community.ourValues', lang)}</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 space-y-1">
              <li>✓ <strong>{t('community.valueSafetyFirstTitle', lang)}:</strong> {t('community.valueSafetyFirstDesc', lang)}</li>
              <li>✓ <strong>{t('community.valueTransparencyTitle', lang)}:</strong> {t('community.valueTransparencyDesc', lang)}</li>
              <li>✓ <strong>{t('community.valueInclusivityTitle', lang)}:</strong> {t('community.valueInclusivityDesc', lang)}</li>
              <li>✓ <strong>{t('community.valueResponsibilityTitle', lang)}:</strong> {t('community.valueResponsibilityDesc', lang)}</li>
              <li>✓ <strong>{t('community.valueSupportTitle', lang)}:</strong> {t('community.valueSupportDesc', lang)}</li>
            </ul>
          </section>

          {/* Consequences */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-900 dark:text-yellow-100">
              <strong>{t('community.guidelineConsequencesTitle', lang)}:</strong> {t('community.guidelineConsequencesBody', lang)}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={understood}
              onChange={e => setUnderstood(e.target.checked)}
              className="w-4 h-4 rounded accent-aegis-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">
              {t('community.guidelinesAcknowledge', lang)}
            </span>
          </label>
          <button
            onClick={onClose}
            disabled={!understood}
            className="bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white px-6 py-2 rounded-lg font-semibold text-sm transition"
          >
            {t('community.gotIt', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CommunityGuidelines




