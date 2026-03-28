import { Link } from 'react-router-dom'
import { Shield, Users, Settings, ArrowRight, Radio, Droplets, AlertTriangle, MapPin, Globe, Zap, Heart, Activity, Eye, Brain, Bell, BarChart3, Layers, Smartphone, Lock, Wifi, ChevronRight, ExternalLink, Map, Siren } from 'lucide-react'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { resetConsent } from '../utils/cookiePreferences'
import ThemeSelector from '../components/ui/ThemeSelector'
import LanguageSelector from '../components/shared/LanguageSelector'
import { useTheme } from '../contexts/ThemeContext'
import { useEffect, useRef, useState, useCallback } from 'react'

/*  Scroll-reveal hook using IntersectionObserver  */
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

/*  Animated counter  */
function AnimatedStat({ value, suffix = '', duration = 1800 }: { value: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0)
  const { ref, visible } = useReveal(0.3)
  useEffect(() => {
    if (!visible) return
    let start = 0
    const step = Math.max(1, Math.floor(value / 60))
    const interval = duration / (value / step)
    const timer = setInterval(() => {
      start += step
      if (start >= value) { setCount(value); clearInterval(timer) }
      else setCount(start)
    }, interval)
    return () => clearInterval(timer)
  }, [visible, value, duration])
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>
}

/*  Section Reveal wrapper  */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal(0.1)
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

export default function LandingPage(): JSX.Element {
  const lang = useLanguage()
  const { dark } = useTheme()
  const [mobileNav, setMobileNav] = useState(false)

  return (
    <div className="min-h-screen overflow-hidden relative bg-gradient-to-b from-gray-50 via-white to-gray-50 dark:from-gray-950 dark:via-surface-ultra-dark dark:to-gray-950 text-gray-900 dark:text-white">
      {/*  Atmospheric background  */}
      <style>{`
        @keyframes lp-float { 0%, 100% { transform: translate(0%, 0%) scale(1); } 33% { transform: translate(2%, -3%) scale(1.04); } 66% { transform: translate(-2%, 2%) scale(0.97); } }
        @keyframes lp-float-r { 0%, 100% { transform: translate(0%, 0%); } 50% { transform: translate(-3%, -2%) scale(1.06); } }
        @keyframes lp-grid-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes lp-radar { 0% { transform: scale(0.3); opacity: 0.6; } 100% { transform: scale(2.5); opacity: 0; } }
        .lp-grid-bg { background-image: radial-gradient(circle, rgba(var(--glow-color), 0.07) 1px, transparent 1px); background-size: 40px 40px; animation: lp-grid-fade 1.5s ease-out; }
        .dark .lp-grid-bg { background-image: radial-gradient(circle, rgba(var(--glow-color), 0.04) 1px, transparent 1px); }
      `}</style>
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="lp-grid-bg absolute inset-0" />
        <div className="absolute -top-40 -left-40 w-[650px] h-[650px] bg-aegis-400/8 dark:bg-aegis-500/5 rounded-full blur-3xl" style={{ animation: 'lp-float 28s ease-in-out infinite' }} />
        <div className="absolute top-1/4 -right-32 w-[500px] h-[500px] bg-blue-400/6 dark:bg-blue-500/4 rounded-full blur-3xl" style={{ animation: 'lp-float-r 32s ease-in-out infinite' }} />
        <div className="absolute bottom-0 left-1/3 w-[450px] h-[450px] bg-amber-300/5 dark:bg-amber-400/3 rounded-full blur-3xl" style={{ animation: 'lp-float 36s ease-in-out infinite 3s' }} />
      </div>

      {/*
          NAVIGATION
       */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-2xl border-b border-gray-200/60 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/25 group-hover:shadow-aegis-400/40 transition-all group-hover:scale-105">
              <Shield className="w-5.5 h-5.5 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="leading-none">
              <span className="font-black text-base tracking-wide"><span className="text-aegis-600 dark:text-aegis-400">AEGIS</span></span>
              <span className="hidden sm:block text-[9px] text-gray-400 dark:text-gray-300 tracking-[0.2em] uppercase">Emergency Intelligence</span>
            </div>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-6">
            {[
              { href: '#features', label: t('landing.nav.features', lang) },
              { href: '#how-it-works', label: t('landing.nav.howItWorks', lang) },
              { href: '#data-sources', label: t('landing.nav.dataSources', lang) },
              { href: '/about', label: 'About', external: true },
            ].map(link => (
              link.external ? (
                <Link key={link.label} to={link.href} className="text-xs font-semibold text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">{link.label}</Link>
              ) : (
                <a key={link.label} href={link.href} className="text-xs font-semibold text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">{link.label}</a>
              )
            ))}
          </div>

          <div className="flex items-center gap-2">
            <LanguageSelector darkNav={dark} />
            <ThemeSelector darkNav={dark} />
            <Link to="/citizen" className="hidden sm:flex text-xs font-bold text-white bg-aegis-600 hover:bg-aegis-500 px-4 py-2 rounded-xl transition-all shadow-lg shadow-aegis-600/20 hover:shadow-aegis-500/30 items-center gap-1.5">
              {t('landing.cta.getStarted', lang)} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            {/* Mobile hamburger */}
            <button onClick={() => setMobileNav(!mobileNav)} className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors" aria-label="Toggle menu">
              <div className="space-y-1.5">
                <span className={`block w-5 h-0.5 bg-gray-600 dark:bg-gray-300 transition-transform ${mobileNav ? 'rotate-45 translate-y-[4px]' : ''}`} />
                <span className={`block w-5 h-0.5 bg-gray-600 dark:bg-gray-300 transition-opacity ${mobileNav ? 'opacity-0' : ''}`} />
                <span className={`block w-5 h-0.5 bg-gray-600 dark:bg-gray-300 transition-transform ${mobileNav ? '-rotate-45 -translate-y-[4px]' : ''}`} />
              </div>
            </button>
          </div>
        </div>
        {/* Mobile nav dropdown */}
        {mobileNav && (
          <div className="md:hidden border-t border-gray-200/60 dark:border-white/5 bg-white/95 dark:bg-gray-950/95 backdrop-blur-2xl px-4 py-4 space-y-3">
            {[
              { href: '#features', label: t('landing.nav.features', lang) },
              { href: '#how-it-works', label: t('landing.nav.howItWorks', lang) },
              { href: '#data-sources', label: t('landing.nav.dataSources', lang) },
              { href: '/about', label: 'About' },
            ].map(link => (
              <a key={link.label} href={link.href} onClick={() => setMobileNav(false)} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors">{link.label}</a>
            ))}
            <Link to="/citizen" onClick={() => setMobileNav(false)} className="block text-center text-sm font-bold text-white bg-aegis-600 hover:bg-aegis-500 px-4 py-2.5 rounded-xl transition-all">{t('landing.cta.getStarted', lang)}</Link>
          </div>
        )}
      </nav>

      {/*
          HERO SECTION
       */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20 text-center">
        <Reveal>
          <div className="inline-flex items-center gap-2.5 bg-aegis-500/10 border border-aegis-500/20 rounded-full px-4 py-1.5 mb-8">
            <span className="relative w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
              <span className="relative block w-2 h-2 rounded-full bg-green-400" />
            </span>
            <span className="text-xs font-semibold text-aegis-600 dark:text-aegis-300 tracking-wide">{t('landing.monitoring', lang)} 12 {t('landing.monitoringRegions', lang)}</span>
          </div>
        </Reveal>

        <Reveal delay={100}>
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-tight mb-6 leading-[1.08] text-gray-900 dark:text-white">
            {t('landing.hero.mainTitle', lang).split('\n').map((line, i) => i === 0 ? <span key={i}>{line}<br/></span> : <span key={i} className="gradient-text">{line}</span>)}
          </h1>
        </Reveal>

        <Reveal delay={200}>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 mb-4 max-w-2xl mx-auto leading-relaxed">
            {t('landing.hero.subtitle', lang)}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-300 dark:text-white/50 mb-10 max-w-xl mx-auto leading-relaxed">
            {t('landing.hero.description', lang)}
          </p>
        </Reveal>

        <Reveal delay={300}>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link to="/citizen" className="group relative bg-gradient-to-r from-aegis-600 to-aegis-500 hover:from-aegis-500 hover:to-aegis-400 text-white px-8 py-4 rounded-2xl font-bold text-base sm:text-lg flex items-center justify-center gap-3 transition-all shadow-xl shadow-aegis-600/25 hover:shadow-aegis-500/35 hover:scale-[1.02] active:scale-[0.98]">
              <Users className="w-5 h-5" />
              {t('landing.hero.btnCitizen', lang)}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
            <Link to="/admin" className="group relative bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 backdrop-blur-sm text-gray-900 dark:text-white px-8 py-4 rounded-2xl font-bold text-base sm:text-lg flex items-center justify-center gap-3 transition-all border border-gray-200 dark:border-white/10 hover:border-aegis-400/40 dark:hover:border-aegis-500/30 shadow-lg shadow-gray-200/30 dark:shadow-none hover:scale-[1.02] active:scale-[0.98]">
              <Settings className="w-5 h-5 text-aegis-500" />
              {t('landing.hero.btnOperator', lang)}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </Reveal>

        {/*  Hero visual — animated radar/pulse  */}
        <Reveal delay={400}>
          <div className="relative max-w-3xl mx-auto mt-4">
            <div className="relative bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-white/[0.06] shadow-2xl shadow-gray-200/40 dark:shadow-black/40 p-6 sm:p-8 overflow-hidden">
              {/* Mini radar pulse */}
              <div className="absolute top-4 right-4 w-3 h-3">
                <span className="absolute inset-0 rounded-full bg-green-400" style={{ animation: 'lp-radar 2.5s ease-out infinite' }} />
                <span className="relative block w-3 h-3 rounded-full bg-green-400" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                {[
                  { icon: Radio, label: 'Real-Time Alerts', desc: 'Multi-channel incident tracking across all regions with live severity updates', color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10' },
                  { icon: Map, label: 'Intelligence Maps', desc: '2D + 3D map layers with flood extents, evacuation routes, and prediction overlays', color: 'text-aegis-600 dark:text-aegis-400', bg: 'bg-aegis-50 dark:bg-aegis-500/10' },
                  { icon: Droplets, label: 'Flood Analytics', desc: 'Live river & rainfall monitoring from EA/SEPA gauges with trend analysis', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-500/10' },
                  { icon: Brain, label: 'AI Predictions', desc: 'ML-based hazard forecasting with confidence scores and severity assessment', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                ].map((f, i) => (
                  <Reveal key={f.label} delay={500 + i * 100}>
                    <div className="group text-left">
                      <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                        <f.icon className={`w-5 h-5 ${f.color}`} />
                      </div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{f.label}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-300 leading-relaxed">{f.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/*
          STATS SECTION — Animated counters
       */}
      <section className="relative z-10 border-y border-gray-200/60 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.01]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {[
              { icon: Globe, label: 'Regions Covered', value: 12, suffix: '+', color: 'text-aegis-600 dark:text-aegis-400' },
              { icon: Activity, label: 'Data Points Daily', value: 50, suffix: 'K+', color: 'text-blue-600 dark:text-blue-400' },
              { icon: Heart, label: 'Citizens Protected', value: 100, suffix: 'K+', color: 'text-emerald-600 dark:text-emerald-400' },
              { icon: AlertTriangle, label: 'Incidents Tracked', value: 5, suffix: 'K+', color: 'text-amber-600 dark:text-amber-400' },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 100}>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-white dark:bg-white/5 border border-gray-200/60 dark:border-white/5 flex items-center justify-center shadow-sm mb-1">
                    <s.icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <p className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
                    <AnimatedStat value={s.value} suffix={s.suffix} />
                  </p>
                  <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-300 uppercase tracking-wider font-semibold">{s.label}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/*
          FEATURES SHOWCASE
       */}
      <section id="features" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <Reveal>
          <div className="text-center mb-16">
            <span className="text-xs font-bold text-aegis-600 dark:text-aegis-400 tracking-widest uppercase">Capabilities</span>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white mt-3 mb-4">Enterprise-Grade Emergency Intelligence</h2>
            <p className="text-sm text-gray-500 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">A comprehensive platform combining real-time data ingestion, AI-powered analysis, and multi-channel communication to protect communities.</p>
          </div>
        </Reveal>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { icon: Radio, title: '5-Channel Alert System', desc: 'Broadcast emergency alerts via Email, SMS, WhatsApp, Telegram, and Web Push simultaneously.', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', border: 'hover:border-red-300 dark:hover:border-red-500/30' },
            { icon: Map, title: '2D + 3D Intelligence Maps', desc: 'Leaflet and Deck.gl-powered maps with flood prediction overlays, evacuation routes, and heatmaps.', color: 'text-aegis-600', bg: 'bg-aegis-50 dark:bg-aegis-500/10', border: 'hover:border-aegis-300 dark:hover:border-aegis-500/30' },
            { icon: Brain, title: 'AI Severity Assessment', desc: 'NLP-based report classification, fake detection, and automated severity scoring with confidence levels.', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'hover:border-purple-300 dark:hover:border-purple-500/30' },
            { icon: BarChart3, title: 'Predictive Analytics', desc: 'Machine learning models for flood, drought, and heatwave forecasting with regional risk scores.', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'hover:border-amber-300 dark:hover:border-amber-500/30' },
            { icon: Layers, title: 'Multi-Hazard Modular Design', desc: 'Extensible architecture supporting floods, fires, earthquakes, storms — any hazard type.', color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'hover:border-cyan-300 dark:hover:border-cyan-500/30' },
            { icon: Eye, title: 'Real-Time Monitoring', desc: 'WebSocket-driven live dashboards with river gauges, weather feeds, and incident status updates.', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-500/10', border: 'hover:border-green-300 dark:hover:border-green-500/30' },
            { icon: Users, title: 'Community Hub', desc: 'Citizen reporting portal with crisis chat, crowd density heatmaps, and shelter finder.', color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'hover:border-indigo-300 dark:hover:border-indigo-500/30' },
            { icon: Lock, title: 'Role-Based Access Control', desc: 'JWT authentication with separate citizen and operator portals, rate limiting, and audit trails.', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-white/5', border: 'hover:border-gray-400 dark:hover:border-gray-500/30' },
            { icon: Smartphone, title: 'Responsive & Accessible', desc: 'Full mobile support, dark mode, multi-language (EN/ES/FR/AR/ZH), and WCAG accessibility.', color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-500/10', border: 'hover:border-pink-300 dark:hover:border-pink-500/30' },
          ].map((f, i) => (
            <Reveal key={f.title} delay={i * 60}>
              <div className={`group bg-white/70 dark:bg-white/[0.02] backdrop-blur-sm rounded-2xl border border-gray-200/80 dark:border-white/[0.06] ${f.border} p-5 transition-all duration-300 hover:shadow-lg dark:hover:shadow-none hover:-translate-y-0.5`}>
                <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5">{f.title}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 leading-relaxed">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/*
          HOW IT WORKS — 3 step flow
       */}
      <section id="how-it-works" className="relative z-10 bg-gray-50/80 dark:bg-white/[0.01] border-y border-gray-200/60 dark:border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <Reveal>
            <div className="text-center mb-16">
              <span className="text-xs font-bold text-aegis-600 dark:text-aegis-400 tracking-widest uppercase">Process</span>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white mt-3 mb-4">How AEGIS Protects Communities</h2>
              <p className="text-sm text-gray-500 dark:text-gray-300 max-w-2xl mx-auto">From citizen report to emergency response in seconds — powered by AI and real-time data.</p>
            </div>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-16 left-[16.66%] right-[16.66%] h-px bg-gradient-to-r from-aegis-400/40 via-aegis-500/40 to-aegis-400/40" />

            {[
              { step: 1, title: 'Report & Detect', desc: 'Citizens report incidents via the portal. AI simultaneously ingests data from EA flood gauges, SEPA river monitors, and Met Office weather feeds.', icon: Bell, color: 'bg-aegis-600' },
              { step: 2, title: 'Analyse & Classify', desc: 'NLP models classify severity, detect fake reports, and cross-reference with geospatial intelligence to build a real-time threat picture.', icon: Brain, color: 'bg-aegis-600' },
              { step: 3, title: 'Alert & Respond', desc: 'Emergency operators are notified instantly. Alerts broadcast across 5 channels. Resources are deployed with AI-recommended response strategies.', icon: Siren, color: 'bg-aegis-600' },
            ].map((s, i) => (
              <Reveal key={s.step} delay={i * 150}>
                <div className="relative flex flex-col items-center text-center">
                  <div className={`w-14 h-14 ${s.color} rounded-2xl flex items-center justify-center shadow-lg shadow-aegis-600/20 mb-5`}>
                    <s.icon className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-[10px] font-black text-aegis-600 dark:text-aegis-400 tracking-widest uppercase mb-2">Step {s.step}</span>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{s.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-300 leading-relaxed max-w-xs">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/*
          DATA SOURCES — Trust badges
       */}
      <section id="data-sources" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <Reveal>
          <div className="text-center mb-12">
            <span className="text-xs font-bold text-aegis-600 dark:text-aegis-400 tracking-widest uppercase">Data Sources</span>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white mt-3 mb-4">Powered by Authoritative Open Data</h2>
            <p className="text-sm text-gray-500 dark:text-gray-300 max-w-2xl mx-auto">AEGIS integrates real-time feeds from official UK government and environmental agencies for maximum accuracy and reliability.</p>
          </div>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: 'Environment Agency', desc: 'Real-time flood warnings, river gauge levels, and rainfall monitoring across England', icon: Droplets, tag: 'Flood Data' },
            { name: 'SEPA Scotland', desc: 'Scottish river level monitoring, flood extent data, and environmental condition feeds', icon: Activity, tag: 'River Levels' },
            { name: 'Met Office', desc: 'Severe weather warnings, forecasts, and historical climate datasets for the UK', icon: AlertTriangle, tag: 'Weather' },
            { name: 'Open Infrastructure', desc: 'OpenStreetMap, OS Maps, and GeoJSON boundary data for geospatial intelligence layers', icon: Globe, tag: 'Geospatial' },
          ].map((src, i) => (
            <Reveal key={src.name} delay={i * 100}>
              <div className="bg-white/70 dark:bg-white/[0.02] backdrop-blur-sm rounded-2xl border border-gray-200/80 dark:border-white/[0.06] p-5 hover:border-aegis-300 dark:hover:border-aegis-500/20 transition-all hover:shadow-md">
                <div className="flex items-center justify-between mb-3">
                  <src.icon className="w-5 h-5 text-aegis-600 dark:text-aegis-400" />
                  <span className="text-[9px] font-bold text-aegis-600 dark:text-aegis-400 bg-aegis-50 dark:bg-aegis-500/10 px-2 py-0.5 rounded-full tracking-wider uppercase">{src.tag}</span>
                </div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5">{src.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 leading-relaxed">{src.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/*
          CTA BANNER
       */}
      <section className="relative z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
          <Reveal>
            <div className="relative bg-gradient-to-br from-aegis-600 to-aegis-700 rounded-3xl p-8 sm:p-12 overflow-hidden">
              {/* Background decoration */}
              <div className="absolute inset-0 opacity-10">
                <div className="absolute -top-20 -right-20 w-64 h-64 border-[40px] border-white rounded-full" />
                <div className="absolute -bottom-16 -left-16 w-48 h-48 border-[30px] border-white rounded-full" />
              </div>
              <div className="relative z-10 text-center sm:text-left sm:flex items-center justify-between gap-8">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">Ready to Explore AEGIS?</h2>
                  <p className="text-sm text-aegis-100/80 max-w-md leading-relaxed">Access the public dashboard to view live alerts, flood maps, and community safety tools — no login required.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 mt-6 sm:mt-0 flex-shrink-0">
                  <Link to="/guest" className="group bg-white text-aegis-700 hover:bg-aegis-50 px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-xl">
                    <Eye className="w-4 h-4" /> Public Dashboard <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                  <Link to="/citizen/login" className="group bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-white/40 px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all backdrop-blur-sm">
                    <Users className="w-4 h-4" /> Create Account <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/*
          FOOTER
       */}
      <footer className="relative z-10 border-t border-gray-200/60 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.01]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            {/* Brand column */}
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <span className="font-black text-sm text-aegis-600 dark:text-aegis-400">AEGIS</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-300 leading-relaxed mb-3">
                Advanced Emergency Geospatial Intelligence System — AI-powered disaster response for the UK.
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-300">{t('landing.meta.projectCredit', lang)}</p>
            </div>

            {/* Platform links */}
            <div>
              <h4 className="text-xs font-bold text-gray-900 dark:text-white tracking-wider uppercase mb-3">Platform</h4>
              <div className="space-y-2">
                {[
                  { to: '/citizen', label: 'Citizen Portal' },
                  { to: '/admin', label: 'Operator Console' },
                  { to: '/guest', label: 'Public Dashboard' },
                ].map(l => (
                  <Link key={l.to} to={l.to} className="block text-xs text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors">{l.label}</Link>
                ))}
              </div>
            </div>

            {/* Resources */}
            <div>
              <h4 className="text-xs font-bold text-gray-900 dark:text-white tracking-wider uppercase mb-3">Resources</h4>
              <div className="space-y-2">
                {[
                  { to: '/about', label: 'About AEGIS' },
                  { href: '#features', label: 'Features' },
                  { href: '#how-it-works', label: 'How It Works' },
                  { href: '#data-sources', label: 'Data Sources' },
                ].map(l => (
                  'to' in l ? (
                    <Link key={l.label} to={l.to!} className="block text-xs text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors">{l.label}</Link>
                  ) : (
                    <a key={l.label} href={l.href} className="block text-xs text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors">{l.label}</a>
                  )
                ))}
              </div>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-bold text-gray-900 dark:text-white tracking-wider uppercase mb-3">Legal</h4>
              <div className="space-y-2">
                {[
                  { to: '/privacy', label: 'Privacy Policy' },
                  { to: '/terms', label: 'Terms of Service' },
                  { to: '/accessibility', label: 'Accessibility' },
                ].map(l => (
                  <Link key={l.to} to={l.to} className="block text-xs text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors">{l.label}</Link>
                ))}
                <button onClick={resetConsent} className="block text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors text-left">{t('footer.cookiePreferences', lang)}</button>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="pt-6 border-t border-gray-200/60 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[10px] text-gray-400 dark:text-gray-300">{t('landing.footerSignature', lang)}</p>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-300"><Lock className="w-3 h-3" /> End-to-End Encrypted</span>
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-300"><Wifi className="w-3 h-3" /> 99.9% Uptime</span>
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-300">GDPR Compliant</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
