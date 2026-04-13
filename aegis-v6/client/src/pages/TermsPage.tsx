/**
 * File: TermsPage.tsx
 *
 * What this file does:
 * Terms of Service page. Static legal content explaining usage rules,
 * liability limitations, and the platform's intended purpose.
 *
 * How it connects:
 * - Routed by client/src/App.tsx at /terms
 * - Linked from the registration form and footer
 */

import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, ChevronDown, ChevronUp, Scale, FileText, AlertCircle, Users, Globe2, Gavel, ClipboardCheck, Ban, ArrowLeft, BookOpen, Info } from 'lucide-react'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import SafeHtml from '../components/shared/SafeHtml'

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true) }, { threshold: 0.1 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className={`transition-all duration-500 ${vis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

const SECTION_ICONS = [FileText, Users, Scale, Globe2, ClipboardCheck, Gavel, Ban, BookOpen, AlertCircle, Shield]

export default function TermsPage(): JSX.Element {
  const lang = useLanguage()
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]))

  const toggle = (i: number) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const expandAll = () => setOpenSections(new Set(Array.from({ length: 10 }, (_, i) => i)))
  const collapseAll = () => setOpenSections(new Set())

  const sections = Array.from({ length: 10 }, (_, i) => {
    const key = `terms.s${i + 1}`
    const title = t(`${key}.title`, lang)
    const paragraphs: string[] = []
    for (let p = 1; p <= 6; p++) {
      const val = t(`${key}.p${p}`, lang) as string
      if (val && !val.startsWith(`${key}.p`)) paragraphs.push(val)
    }
    // Pick up non-standard paragraph keys (intro, disclaimer, violations, verify, asIs)
    for (const suffix of ['intro', 'disclaimer', 'violations', 'verify', 'asIs']) {
      const val = t(`${key}.${suffix}`, lang) as string
      if (val && !val.startsWith(`${key}.${suffix}`)) paragraphs.push(val)
    }
    const listItems: string[] = []
    for (let li = 1; li <= 8; li++) {
      const val = t(`${key}.li${li}`, lang) as string
      if (val && !val.startsWith(`${key}.li`)) listItems.push(val)
    }
    return { title, paragraphs, listItems, icon: SECTION_ICONS[i] || Shield }
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-amber-900 via-yellow-900 to-amber-800 text-white">
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-white/5 animate-pulse" style={{ width: `${50 + i * 30}px`, height: `${50 + i * 30}px`, top: `${15 + i * 20}%`, left: `${12 + i * 22}%`, animationDelay: `${i * 0.4}s`, animationDuration: `${3.5 + i}s` }} />
          ))}
        </div>
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-14 sm:py-18">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-5 transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to AEGIS
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Scale className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{t('terms.pageTitle', lang)}</h1>
          </div>
          <p className="text-white/70 text-sm">{t('terms.lastUpdate', lang)}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-3">

        {/* Important Notice */}
        <FadeIn>
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="font-bold text-amber-800 dark:text-amber-300 text-sm mb-0.5">{t('terms.importantNotice', lang)}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">{t('terms.importantNoticeDesc', lang)}</p>
            </div>
          </div>
        </FadeIn>

        {/* Controls */}
        <div className="flex justify-end gap-3">
          <button onClick={expandAll} className="text-xs text-aegis-600 hover:text-aegis-700 dark:text-aegis-400 font-semibold">Expand All</button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 font-semibold">Collapse All</button>
        </div>

        {sections.map(({ title, paragraphs, listItems, icon: Icon }, i) => {
          const isOpen = openSections.has(i)
          return (
            <FadeIn key={i} delay={i * 30}>
              <div className={`bg-white dark:bg-gray-900 rounded-xl border transition-all duration-300 ${isOpen ? 'border-amber-200 dark:border-amber-800/50 shadow-sm' : 'border-gray-100 dark:border-gray-800'}`}>
                <button
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  aria-controls={`terms-section-${i}`}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left group"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isOpen ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest mr-2">Article {i + 1}</span>
                  <span className={`font-bold text-sm flex-1 transition-colors ${isOpen ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>{title}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                <div id={`terms-section-${i}`} className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="px-5 pb-5 pt-0 space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {paragraphs.map((p, pi) => (
                      <SafeHtml key={pi} html={p} className="text-sm leading-relaxed" />
                    ))}
                    {listItems.length > 0 && (
                      <ul className="space-y-1.5 mt-2">
                        {listItems.map((li, li2) => (
                          <li key={li2} className="flex items-start gap-2 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                            <SafeHtml html={li} className="text-sm" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </FadeIn>
          )
        })}

        {/* Footer nav */}
        <div className="flex flex-wrap gap-4 text-sm justify-center pt-8 border-t border-gray-200 dark:border-gray-800 mt-8">
          <Link to="/citizen" className="text-aegis-600 hover:underline">Dashboard</Link>
          <Link to="/about" className="text-gray-500 dark:text-gray-400 hover:text-aegis-600">{t('about.title', lang)}</Link>
          <Link to="/privacy" className="text-gray-500 dark:text-gray-400 hover:text-aegis-600">{t('about.privacyPolicy', lang)}</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-400 hover:text-aegis-600">{t('about.accessibility', lang)}</Link>
        </div>
      </div>
    </div>
  )
}

