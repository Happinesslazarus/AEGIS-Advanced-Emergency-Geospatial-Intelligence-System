/**
 * Module: CommunityGuidelines.tsx
 *
 * Community guidelines citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle, X, Eye, EyeOff, ChevronDown, Sparkles, Shield } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface GuidelinesModalProps {
  isOpen: boolean
  onClose: () => void
}

interface Section {
  id: string
  icon: typeof CheckCircle
  iconBg: string
  iconColor: string
  borderColor?: string
  titleKey: string
  bullets: string[]
  descKey?: string
  isValues?: boolean
  isWarning?: boolean
}

export function CommunityGuidelines({ isOpen, onClose }: GuidelinesModalProps) {
  const lang = useLanguage()
  const [readSections, setReadSections] = useState<Set<string>>(new Set())
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  const sections: Section[] = useMemo(() => [
    {
      id: 'respectful',
      icon: CheckCircle,
      iconBg: 'bg-green-100 dark:bg-green-900/30',
      iconColor: 'text-green-600 dark:text-green-400',
      titleKey: 'community.beRespectful',
      bullets: ['community.respectBullet1', 'community.respectBullet2', 'community.respectBullet3', 'community.respectBullet4'],
    },
    {
      id: 'prohibited',
      icon: AlertCircle,
      iconBg: 'bg-red-100 dark:bg-red-900/30',
      iconColor: 'text-red-600 dark:text-red-400',
      borderColor: 'border-l-4 border-red-500',
      titleKey: 'community.prohibitedContent',
      descKey: 'community.doNotPost',
      bullets: ['community.prohibitedBullet1', 'community.prohibitedBullet2', 'community.prohibitedBullet3', 'community.prohibitedBullet4', 'community.prohibitedBullet5', 'community.prohibitedBullet6', 'community.prohibitedBullet7'],
    },
    {
      id: 'accurate',
      icon: Eye,
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-400',
      titleKey: 'community.postAccurate',
      bullets: ['community.accurateBullet1', 'community.accurateBullet2', 'community.accurateBullet3', 'community.accurateBullet4', 'community.accurateBullet5'],
    },
    {
      id: 'privacy',
      icon: EyeOff,
      iconBg: 'bg-purple-100 dark:bg-purple-900/30',
      iconColor: 'text-purple-600 dark:text-purple-400',
      titleKey: 'community.protectPrivacy',
      bullets: ['community.privacyBullet1', 'community.privacyBullet2', 'community.privacyBullet3', 'community.privacyBullet4'],
    },
    {
      id: 'values',
      icon: Shield,
      iconBg: 'bg-aegis-100 dark:bg-aegis-900/30',
      iconColor: 'text-aegis-600 dark:text-aegis-400',
      titleKey: 'community.ourValues',
      isValues: true,
      bullets: [],
    },
  ], [])

  const totalSections = sections.length
  const readCount = readSections.size
  const progressPct = Math.round((readCount / totalSections) * 100)
  const allRead = readCount === totalSections

  // Mark section as read when expanded / clicked
  const toggleSection = (id: string) => {
    setExpandedSection(prev => prev === id ? null : id)
    setReadSections(prev => new Set(prev).add(id))
  }

  // Intersection observer to mark sections read on scroll-into-view
  useEffect(() => {
    if (!isOpen) return
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-section')
            if (id) setReadSections(prev => new Set(prev).add(id))
          }
        })
      },
      { threshold: 0.6 }
    )
    Object.values(sectionRefs.current).forEach(el => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [isOpen])

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setReadSections(new Set())
      setExpandedSection(null)
    }
  }, [isOpen])

  // Keyboard: Escape closes
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl animate-enter flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('community.guidelines', lang)}
      >
        {/* Header with progress */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-aegis-600 to-aegis-700 text-white p-6 flex flex-col gap-3">
          <div className="flex items-start justify-between">
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

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-300 to-green-400 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[11px] font-bold tabular-nums whitespace-nowrap">
              {readCount}/{totalSections}
            </span>
            {/* Section dots */}
            <div className="flex gap-1">
              {sections.map(sec => (
                <div
                  key={sec.id}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${readSections.has(sec.id) ? 'bg-green-400 scale-110' : 'bg-white/30'}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {sections.map(sec => {
            const Icon = sec.icon
            const isExpanded = expandedSection === sec.id
            const isRead = readSections.has(sec.id)

            return (
              <section
                key={sec.id}
                ref={el => { sectionRefs.current[sec.id] = el }}
                data-section={sec.id}
                className={`rounded-xl border transition-all duration-300 ${isRead ? 'border-green-200 dark:border-green-800/40 bg-green-50/30 dark:bg-green-900/5' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'} ${sec.borderColor || ''}`}
              >
                <button
                  onClick={() => toggleSection(sec.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors rounded-xl"
                  aria-expanded={isExpanded}
                >
                  <div className={`w-8 h-8 rounded-full ${sec.iconBg} flex items-center justify-center flex-shrink-0 transition-transform duration-300 ${isExpanded ? 'scale-110' : ''}`}>
                    {isRead ? (
                      <CheckCircle className="w-5 h-5 text-green-500 dark:text-green-400" />
                    ) : (
                      <Icon className={`w-5 h-5 ${sec.iconColor}`} />
                    )}
                  </div>
                  <span className="flex-1 font-bold text-gray-900 dark:text-white text-sm">
                    {t(sec.titleKey, lang)}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expandable content */}
                <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="px-4 pb-4 pl-[60px]">
                    {sec.descKey && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{t(sec.descKey, lang)}</p>
                    )}
                    {sec.isValues ? (
                      <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5">
                        {[
                          { titleKey: 'community.valueSafetyFirstTitle', descKey: 'community.valueSafetyFirstDesc' },
                          { titleKey: 'community.valueTransparencyTitle', descKey: 'community.valueTransparencyDesc' },
                          { titleKey: 'community.valueInclusivityTitle', descKey: 'community.valueInclusivityDesc' },
                          { titleKey: 'community.valueResponsibilityTitle', descKey: 'community.valueResponsibilityDesc' },
                          { titleKey: 'community.valueSupportTitle', descKey: 'community.valueSupportDesc' },
                        ].map(v => (
                          <li key={v.titleKey}>✓ <strong>{t(v.titleKey, lang)}:</strong> {t(v.descKey, lang)}</li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5">
                        {sec.bullets.map(b => <li key={b}>• {t(b, lang)}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            )
          })}

          {/* Consequences */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
            <p className="text-sm text-yellow-900 dark:text-yellow-100">
              <strong>{t('community.guidelineConsequencesTitle', lang)}:</strong> {t('community.guidelineConsequencesBody', lang)}
            </p>
          </div>
        </div>

        {/* Footer with completion reward */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
          {allRead ? (
            <div className="flex items-center justify-between animate-enter">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-semibold">{t('community.guidelinesAcknowledge', lang)}</span>
              </div>
              <button
                onClick={onClose}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] shadow-lg shadow-green-500/25 flex items-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                {t('community.gotIt', lang)}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Read all {totalSections} sections to continue
              </span>
              <button
                disabled
                className="bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-6 py-2.5 rounded-xl font-bold text-sm cursor-not-allowed"
              >
                {t('community.gotIt', lang)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CommunityGuidelines

