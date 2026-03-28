import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, ChevronDown, ChevronUp, Accessibility, Eye, Keyboard, Monitor, MousePointer, Languages, Ear, CheckCircle2, ArrowLeft, Smartphone } from 'lucide-react'
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

const SECTION_ICONS = [Accessibility, Eye, Keyboard, Monitor, MousePointer, Languages, Ear, Smartphone]
const WCAG_ITEMS = [
  { level: 'A', label: 'Perceivable', desc: 'Content is presented in ways all users can perceive', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' },
  { level: 'A', label: 'Operable', desc: 'UI components and navigation are operable', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  { level: 'AA', label: 'Understandable', desc: 'Content and UI are understandable', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  { level: 'AA', label: 'Robust', desc: 'Content can be interpreted by assistive technologies', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
]

export default function AccessibilityPage(): JSX.Element {
  const lang = useLanguage()
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]))

  const toggle = (i: number) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const expandAll = () => setOpenSections(new Set(Array.from({ length: 8 }, (_, i) => i)))
  const collapseAll = () => setOpenSections(new Set())

  const sections = Array.from({ length: 8 }, (_, i) => {
    const key = `a11yPage.s${i + 1}`
    const title = t(`${key}.title`, lang)
    const paragraphs: string[] = []
    for (let p = 1; p <= 6; p++) {
      const val = t(`${key}.p${p}`, lang) as string
      if (val && !val.startsWith(`${key}.p`)) paragraphs.push(val)
    }
    const listItems: string[] = []
    for (let li = 1; li <= 8; li++) {
      const val = t(`${key}.li${li}`, lang) as string
      if (val && !val.startsWith(`${key}.li`)) listItems.push(val)
    }
    return { title, paragraphs, listItems, icon: SECTION_ICONS[i] || Shield }
  })

  // Language badges
  const supportedLangs = [
    { code: 'gb', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'sa', label: 'العربية' },
    { code: 'cn', label: '中文' },
    { code: 'in', label: 'हिन्दी' },
    { code: 'br', label: 'Português' },
    { code: 'pl', label: 'Polski' },
    { code: 'pk', label: 'اردو' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-purple-900 via-violet-900 to-purple-800 text-white">
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-white/5 animate-pulse" style={{ width: `${50 + i * 30}px`, height: `${50 + i * 30}px`, top: `${18 + i * 16}%`, left: `${14 + i * 19}%`, animationDelay: `${i * 0.5}s`, animationDuration: `${3 + i}s` }} />
          ))}
        </div>
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-14 sm:py-18">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-5 transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to AEGIS
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Accessibility className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{t('a11yPage.pageTitle', lang)}</h1>
          </div>
          <p className="text-white/70 text-sm">{t('a11yPage.tagline', lang)}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-4">

        {/* WCAG Compliance Grid */}
        <FadeIn>
          <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" /> WCAG 2.1 Compliance
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {WCAG_ITEMS.map(({ level, label, desc, color }, i) => (
              <FadeIn key={i} delay={i * 60}>
                <div className={`${color} rounded-xl p-4 border transition-all hover:-translate-y-0.5 hover:shadow-md cursor-default`}>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{level}</span>
                  <p className="font-bold text-sm mt-1">{label}</p>
                  <p className="text-[11px] opacity-80 mt-0.5 leading-snug">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </FadeIn>

        {/* Language Support */}
        <FadeIn delay={100}>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
            <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Languages className="w-4 h-4 text-purple-500" /> {t('a11yPage.languageSupport', lang)}
            </h3>
            <div className="flex flex-wrap gap-2">
              {supportedLangs.map(({ code, label }) => (
                <span key={code} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-full border border-gray-100 dark:border-gray-700 text-sm hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors cursor-default">
                  <img src={`https://flagcdn.com/16x12/${code}.png`} alt="" className="w-4 h-3 rounded-sm" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
                </span>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Controls */}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={expandAll} className="text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 font-semibold">Expand All</button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 font-semibold">Collapse All</button>
        </div>

        {/* Accordion sections */}
        {sections.map(({ title, paragraphs, listItems, icon: Icon }, i) => {
          const isOpen = openSections.has(i)
          return (
            <FadeIn key={i} delay={i * 30}>
              <div className={`bg-white dark:bg-gray-900 rounded-xl border transition-all duration-300 ${isOpen ? 'border-purple-200 dark:border-purple-800/50 shadow-sm' : 'border-gray-100 dark:border-gray-800'}`}>
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left group"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isOpen ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`font-bold text-sm flex-1 transition-colors ${isOpen ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>{title}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="px-5 pb-5 pt-0 space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {paragraphs.map((p, pi) => (
                      <SafeHtml key={pi} html={p} className="text-sm leading-relaxed" />
                    ))}
                    {listItems.length > 0 && (
                      <ul className="space-y-1.5 mt-2">
                        {listItems.map((li, li2) => (
                          <li key={li2} className="flex items-start gap-2 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 flex-shrink-0" />
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
          <Link to="/terms" className="text-gray-500 dark:text-gray-400 hover:text-aegis-600">{t('about.termsOfUse', lang)}</Link>
        </div>
      </div>
    </div>
  )
}
