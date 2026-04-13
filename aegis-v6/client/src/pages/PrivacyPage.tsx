/**
 * File: PrivacyPage.tsx
 *
 * What this file does:
 * Privacy policy page for AEGIS. Describes what data is collected,
 * how it is used, and user rights. Static legal content, no API calls.
 *
 * How it connects:
 * - Routed by client/src/App.tsx at /privacy
 * - Linked from LandingPage.tsx and cookie consent banner
 */

import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, ChevronDown, ChevronUp, Lock, Eye, Database, Server, Trash2, UserCheck, Globe2, Mail, FileText, ArrowLeft } from 'lucide-react'
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

const SECTION_ICONS = [Lock, Eye, Database, Server, UserCheck, Globe2, Trash2, Mail, FileText, Shield]

export default function PrivacyPage(): JSX.Element {
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
    const key = `privacy.s${i + 1}`
    const title = t(`${key}.title`, lang)
    const paragraphs: string[] = []
    for (let p = 1; p <= 6; p++) {
      const val = t(`${key}.p${p}`, lang) as string
      if (val && !val.startsWith(`${key}.p`)) paragraphs.push(val)
    }
    // Pick up non-standard paragraph keys (voluntary, automatic, local, contact)
    for (const suffix of ['voluntary', 'automatic', 'local', 'contact']) {
      const val = t(`${key}.${suffix}`, lang) as string
      if (val && !val.startsWith(`${key}.${suffix}`)) paragraphs.push(val)
    }
    const listItems: string[] = []
    for (let li = 1; li <= 8; li++) {
      const val = t(`${key}.li${li}`, lang) as string
      if (val && !val.startsWith(`${key}.li`)) listItems.push(val)
    }
    // Pick up numbered sub-items (vol1-3, auto1-3, local1-4)
    for (const prefix of ['vol', 'auto', 'local']) {
      for (let n = 1; n <= 4; n++) {
        const val = t(`${key}.${prefix}${n}`, lang) as string
        if (val && !val.startsWith(`${key}.${prefix}${n}`)) listItems.push(val)
      }
    }
    return { title, paragraphs, listItems, icon: SECTION_ICONS[i] || Shield }
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-900 via-indigo-900 to-blue-800 text-white">
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-white/5 animate-pulse" style={{ width: `${50 + i * 30}px`, height: `${50 + i * 30}px`, top: `${20 + i * 18}%`, left: `${15 + i * 20}%`, animationDelay: `${i * 0.5}s`, animationDuration: `${3 + i}s` }} />
          ))}
        </div>
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-14 sm:py-18">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-5 transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to AEGIS
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{t('privacy.pageTitle', lang)}</h1>
          </div>
          <p className="text-white/70 text-sm">{t('privacy.lastUpdate', lang)}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-3">
        {/* Expand/Collapse controls */}
        <div className="flex justify-end gap-3 mb-2">
          <button onClick={expandAll} className="text-xs text-aegis-600 hover:text-aegis-700 dark:text-aegis-400 font-semibold">Expand All</button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 font-semibold">Collapse All</button>
        </div>

        {sections.map(({ title, paragraphs, listItems, icon: Icon }, i) => {
          const isOpen = openSections.has(i)
          return (
            <FadeIn key={i} delay={i * 30}>
              <div className={`bg-white dark:bg-gray-900 rounded-xl border transition-all duration-300 ${isOpen ? 'border-aegis-200 dark:border-aegis-800 shadow-sm' : 'border-gray-100 dark:border-gray-800'}`}>
                <button
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  aria-controls={`privacy-section-${i}`}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left group"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isOpen ? 'bg-aegis-100 dark:bg-aegis-900/40 text-aegis-600 dark:text-aegis-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest mr-2">{String(i + 1).padStart(2, '0')}</span>
                  <span className={`font-bold text-sm flex-1 transition-colors ${isOpen ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>{title}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                <div id={`privacy-section-${i}`} className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="px-5 pb-5 pt-0 space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {paragraphs.map((p, pi) => (
                      <SafeHtml key={pi} html={p} className="text-sm leading-relaxed" />
                    ))}
                    {listItems.length > 0 && (
                      <ul className="space-y-1.5 mt-2">
                        {listItems.map((li, li2) => (
                          <li key={li2} className="flex items-start gap-2 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-aegis-400 mt-1.5 flex-shrink-0" />
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
          <Link to="/terms" className="text-gray-500 dark:text-gray-400 hover:text-aegis-600">{t('about.termsOfUse', lang)}</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-400 hover:text-aegis-600">{t('about.accessibility', lang)}</Link>
        </div>
      </div>
    </div>
  )
}

