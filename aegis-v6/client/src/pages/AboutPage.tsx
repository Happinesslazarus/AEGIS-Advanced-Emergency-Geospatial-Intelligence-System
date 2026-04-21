/**
 * Static informational page describing the AEGIS project, its mission,
 * technology stack, and team. No API calls -- purely presentational.
 *
 * - Routed by client/src/App.tsx at /about
 * - Linked from LandingPage.tsx footer
 */

import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Globe, Users, BookOpen, Heart, Award, ArrowLeft, Zap, Bell, Map, Sparkles, ArrowRight, ChevronDown, Server, Brain, Code2 } from 'lucide-react'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'

/**
 * FadeIn -- lazy reveal animation driven by IntersectionObserver.
 *
 * Sets `visible` to true once the element's top edge enters the viewport
 * (threshold 0.1 = 10% visible).  The CSS class transition then slides the
 * element from translate-y-6 (slightly below) to translate-y-0 and fades it
 * from opacity 0 to 1.  An optional delay prop staggers multiple FadeIn
 * wrappers when they are rendered together in a grid.
 */
function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold: 0.1 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className={`transition-all duration-600 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

/**
 * useCounter -- animates a number from 0 to `end` using an easeOut cubic curve.
 *
 * The counter only starts once the attached ref element scrolls into view
 * (threshold 0.3).  `hasRun` prevents restarting if the user scrolls away and
 * back.  The easing formula `1 - (1-p)^3` decelerates near the end so the
 * number appears to settle naturally rather than stopping abruptly.
 */
function useCounter(end: number, duration = 2000) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const hasRun = useRef(false)
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !hasRun.current) {
        hasRun.current = true
        if (reducedMotion) { setCount(end); return }
        const start = performance.now()
        const animate = (now: number) => {
          const p = Math.min((now - start) / duration, 1)
          setCount(Math.round(end * (1 - Math.pow(1 - p, 3))))
          if (p < 1) requestAnimationFrame(animate)
        }
        requestAnimationFrame(animate)
      }
    }, { threshold: 0.3 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [end, duration])
  return { count, ref }
}

export default function AboutPage(): JSX.Element {
  const lang = useLanguage()
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null)
  const stats = [useCounter(50000, 2000), useCounter(10, 1500), useCounter(200, 1800), useCounter(24, 1200)]

  const features = [
    { icon: Bell, title: 'Live Alerts', desc: 'Multi-channel notifications via email, SMS, WhatsApp, Telegram, and web push to keep you informed instantly.', color: 'from-red-500 to-rose-600', bg: 'bg-red-50 dark:bg-red-950/30' },
    { icon: Map, title: 'Flood Monitoring', desc: 'Real-time integration with SEPA and Environment Agency river-gauge data, plus AI-driven flood predictions.', color: 'from-blue-500 to-cyan-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
    { icon: Users, title: 'Community Reporting', desc: 'Citizens can submit geotagged incident reports with photos, enabling real-time crowdsourced situational awareness.', color: 'from-green-500 to-emerald-600', bg: 'bg-green-50 dark:bg-green-950/30' },
    { icon: BookOpen, title: 'Emergency Preparedness', desc: 'Guided training modules, risk assessments, and an offline emergency card to build personal resilience.', color: 'from-purple-500 to-violet-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
    { icon: Globe, title: 'Multi-Language Support', desc: 'Full interface translation across 9+ languages including Gaelic, Welsh, Arabic, and Chinese.', color: 'from-aegis-500 to-aegis-700', bg: 'bg-aegis-50 dark:bg-aegis-950/30' },
    { icon: Award, title: 'AI-Powered Analysis', desc: 'Machine learning models analyse reports, detect misinformation, assess severity, and provide intelligent risk insights.', color: 'from-amber-500 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-aegis-900 to-blue-900 text-white">
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-white/5 animate-pulse" style={{ width: `${60 + i * 40}px`, height: `${60 + i * 40}px`, top: `${15 + i * 15}%`, left: `${10 + i * 18}%`, animationDelay: `${i * 0.6}s`, animationDuration: `${4 + i}s` }} />
          ))}
        </div>
        <div className="relative z-10 max-w-4xl mx-auto px-6 py-16 sm:py-20">
          <Link to="/citizen" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6 transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> {'Back to AEGIS'}
          </Link>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-lg" style={{ animation: 'pulse 3s ease-in-out infinite' }}>
              <Shield className="w-9 h-9 text-white" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{'About AEGIS'}</h1>
              <p className="text-aegis-200/70 text-sm mt-0.5">{'Adaptive Emergency Geospatial Intelligence System'}</p>
            </div>
          </div>
          <p className="text-lg text-white/80 max-w-2xl leading-relaxed">{'A comprehensive AI-powered platform for real-time emergency management, flood monitoring, and community resilience across Scotland.'}</p>
          <div className="flex justify-center mt-10">
            <ChevronDown className="w-5 h-5 text-white/30 animate-bounce" />
          </div>
        </div>
      </div>

      {/* Impact Stats */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { label: 'Lines of Code', suffix: '+', stat: stats[0] },
              { label: 'Languages', suffix: '+', stat: stats[1] },
              { label: 'Components', suffix: '+', stat: stats[2] },
              { label: 'Uptime (hrs)', suffix: '/7', stat: stats[3] },
            ].map(({ label, suffix, stat }, i) => (
              <div key={i} ref={stat.ref} className="text-center group cursor-default">
                <p className="text-3xl font-black text-aegis-600 dark:text-aegis-400 tabular-nums group-hover:scale-110 transition-transform inline-block">{stat.count.toLocaleString()}{suffix}</p>
                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-14">

        {/* Mission - compact card, not a long text block */}
        <FadeIn>
          <div className="bg-gradient-to-br from-aegis-50 to-blue-50 dark:from-aegis-950/30 dark:to-blue-950/20 rounded-2xl p-6 sm:p-8 border border-aegis-100 dark:border-aegis-800">
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Heart className="w-5 h-5 text-red-500" /> {'Our Mission'}
            </h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{'AEGIS is dedicated to saving lives through intelligent emergency management. We combine machine learning, real-time environmental data, and community engagement to deliver timely flood monitoring, risk assessment, and multi-channel alerts.'}</p>
          </div>
        </FadeIn>

        {/* Key Features -- interactive card grid */}
        <FadeIn>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-5 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" /> {'Key Features'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map(({ icon: Icon, title, desc, color, bg }, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div
                  onMouseEnter={() => setHoveredFeature(i)}
                  onMouseLeave={() => setHoveredFeature(null)}
                  className={`${bg} rounded-2xl p-5 border border-gray-100 dark:border-gray-800 transition-all duration-300 cursor-default ${
                    hoveredFeature === i ? 'shadow-xl -translate-y-1 border-aegis-300 dark:border-aegis-700' : 'hover:shadow-md'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-3 transition-transform duration-300 ${hoveredFeature === i ? 'scale-110 rotate-3' : ''}`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-1">{title}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </FadeIn>

        {/* Tech Stack - visual architecture blocks, not text */}
        <FadeIn>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-5">{'Technology Stack'}</h2>
          <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 border border-gray-700 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] bg-aegis-500/10 rounded-full blur-[80px]" />
            <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'React - TypeScript - Vite', tech: 'React 18 + TypeScript', icon: Code2, color: 'from-blue-500 to-cyan-500' },
                { label: 'Node.js - Express - PostgreSQL', tech: 'Node.js + Express', icon: Server, color: 'from-green-500 to-emerald-500' },
                { label: 'Python - PyTorch - FastAPI', tech: 'Python + FastAPI', icon: Brain, color: 'from-purple-500 to-violet-500' },
                { label: 'SEPA - Environment Agency - Met Office', tech: 'SEPA, EA Flood, Open-Meteo', icon: Globe, color: 'from-amber-500 to-orange-500' },
              ].map(({ label, tech, icon: Icon, color }, i) => (
                <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all hover:-translate-y-0.5 group">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-0.5">{label}</p>
                  <p className="text-xs text-gray-300 font-medium">{tech}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Research -- compact */}
        <FadeIn>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-500" /> {'Research & Academic Background'}
            </h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-4">{'AEGIS is developed as an honours-year project at Robert Gordon University, Aberdeen. It applies advanced computing techniques -- machine learning, geospatial analysis, real-time data streaming -- to the domain of emergency management.'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              {[
                { label: 'Institution', value: 'Robert Gordon University' },
                { label: 'Module', value: 'Honours Project 2025/26' },
                { label: 'Location', value: 'Aberdeen, Scotland' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">{label}</p>
                  <p className="font-bold text-gray-800 dark:text-gray-200 text-sm mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Creator Link */}
        <FadeIn>
          <Link
            to="/creator"
            className="group relative overflow-hidden bg-gradient-to-r from-aegis-600 to-blue-600 hover:from-aegis-500 hover:to-blue-500 rounded-2xl p-6 sm:p-8 shadow-lg hover:shadow-xl transition-all duration-300 block"
          >
            <div className="absolute top-0 right-0 w-60 h-60 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl" />
            <div className="relative z-10 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-1">Meet the Creator</h3>
                <p className="text-white/80 text-sm">Learn about Happiness Ada Lazarus -- the visionary behind AEGIS</p>
              </div>
              <ArrowRight className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all flex-shrink-0" />
            </div>
          </Link>
        </FadeIn>

        {/* Contact - compact */}
        <FadeIn>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-3">{'Contact'}</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{'For questions about this project, contact the development team at Robert Gordon University.'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { label: 'Institution', value: 'Robert Gordon University' },
                { label: 'Module', value: 'Honours Project -- Computing Science' },
                { label: 'Location', value: 'Aberdeen, Scotland' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm">
                  <span className="font-bold text-gray-500 dark:text-gray-400 text-xs">{label}:</span>{' '}
                  <span className="text-gray-700 dark:text-gray-300">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Footer nav */}
        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/citizen" className="text-aegis-600 hover:underline">{'Back to Dashboard'}</Link>
          <Link to="/creator" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">Creator</Link>
          <Link to="/privacy" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{'Privacy Policy'}</Link>
          <Link to="/terms" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{'Terms of Use'}</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">{'Accessibility'}</Link>
        </div>
      </div>
    </div>
  )
}

