/**
 * File: CreatorPage.tsx
 *
 * What this file does:
 * Attribution and credits page listing the project creators, contributors,
 * and open-source libraries used. Static page with no API dependencies.
 *
 * How it connects:
 * - Routed by client/src/App.tsx (credits/creator route)
 * - Linked from LandingPage footer
 */

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Sparkles, GraduationCap, Music, Globe2, Heart, Award,
  Shield, Code2, Database, Brain, Cpu, Layers, Terminal, Palette,
  ChevronDown, Quote, Star, MapPin, Calendar, BookOpen,
  Zap, Server, Lock, Wifi, BarChart3, GitBranch
} from 'lucide-react'

/**
 * useCounter — animates a number from `start` to `end` using an easeOut cubic.
 *
 * Identical algorithm to AboutPage.tsx but with an optional `start` parameter
 * so the "Solo Developer: 1" counter begins at 1 rather than 0.
 * hasRun prevents restarting when the element scrolls in and out.
 */
function useCounter(end: number, duration = 2000, start = 0) {
  const [count, setCount] = useState(start)
  const ref = useRef<HTMLDivElement>(null)
  const hasRun = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true
          const startTime = performance.now()
          const animate = (now: number) => {
            const elapsed = now - startTime
            const progress = Math.min(elapsed / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            setCount(Math.round(start + (end - start) * eased))
            if (progress < 1) requestAnimationFrame(animate)
          }
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [end, duration, start])

  return { count, ref }
}

/**
 * FadeInSection — IntersectionObserver scroll-triggered fade + slide-up.
 *
 * Uses a 0.15 threshold (slightly more generous than FadeIn in AboutPage) so
 * taller content sections trigger earlier as they enter the viewport.
 * Optional delay staggers sibling cards when they are rendered in a loop.
 */
function FadeInSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true) },
      { threshold: 0.15 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

/* Timeline Item */
function TimelineItem({ year, title, desc, icon: Icon, color }: { year: string; title: string; desc: string; icon: React.ElementType; color: string }) {
  return (
    <div className="relative flex gap-4 pb-8 last:pb-0 group">
      <div className="flex flex-col items-center">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 w-px bg-gradient-to-b from-gray-300 dark:from-gray-600 to-transparent mt-2" />
      </div>
      <div className="flex-1 pt-0.5">
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{year}</span>
        <h4 className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">{title}</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{desc}</p>
      </div>
    </div>
  )
}

/**
 * SkillHex — interactive skill card with a mastery tier badge and dot bar.
 *
 * tierConfig maps the three tiers to:
 *   - badge gradient (gold/blue/green)
 *   - dot count (5/4/3 filled dots out of 5) for the proficiency bar.
 * The component has its own IntersectionObserver for the entrance animation
 * rather than using FadeInSection, because it needs a ref for the observer and
 * also a separate hover state.
 */
function SkillHex({ icon: Icon, label, tier, color, delay = 0 }: {
  icon: React.ElementType; label: string; tier: 'expert' | 'advanced' | 'proficient'; color: string; delay?: number
}) {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const tierConfig = {
    expert:     { label: 'Expert',     badge: 'bg-gradient-to-r from-amber-400 to-amber-600', dots: 5 },
    advanced:   { label: 'Advanced',   badge: 'bg-gradient-to-r from-blue-400 to-blue-600',   dots: 4 },
    proficient: { label: 'Proficient', badge: 'bg-gradient-to-r from-emerald-400 to-emerald-600', dots: 3 },
  }
  const tc = tierConfig[tier]

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold: 0.2 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative group cursor-default transition-all duration-500 ${visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-6 scale-95'}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className={`relative bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 transition-all duration-300 ${hovered ? 'shadow-xl -translate-y-1 border-aegis-300 dark:border-aegis-700' : 'hover:shadow-md'}`}>
        <div className={`absolute -top-2.5 right-3 ${tc.badge} text-white text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider`}>
          {tc.label}
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center transition-transform duration-300 ${hovered ? 'scale-110 rotate-3' : ''}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-bold text-gray-800 dark:text-gray-200">{label}</span>
        </div>
        <div className="flex gap-1">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                i < tc.dots ? color : 'bg-gray-100 dark:bg-gray-800'
              }`}
              style={{ transitionDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function CreatorPage(): JSX.Element {
  const [activePhilosophy, setActivePhilosophy] = useState(0)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  const stats = [
    useCounter(50000, 2500),
    useCounter(200, 2000),
    useCounter(5, 1500),
    useCounter(1, 1200, 1),
  ]

  const philosophies = [
    { title: 'Empathy-Driven Design', desc: 'Every feature begins with a question: "How will this help someone in their most vulnerable moment?" AEGIS is designed not just to inform, but to comfort and empower.' },
    { title: 'Technology for All', desc: 'From multilingual support to offline capabilities, AEGIS ensures no one is left behind. Accessibility is not an afterthought — it is foundational.' },
    { title: 'Relentless Quality', desc: 'Single-handedly engineering a full-stack platform demands meticulous attention to detail. Every API endpoint, every animation, every pixel is intentional.' },
    { title: 'Global Perspective', desc: 'With roots in Africa and a European education, the creator brings a uniquely cross-cultural understanding of disaster preparedness to this platform.' },
  ]

  // Auto-rotate through philosophies every 5 seconds to draw attention to each
  // principle.  Modulo wraps back to 0 after the last item.
  useEffect(() => {
    const timer = setInterval(() => setActivePhilosophy(p => (p + 1) % philosophies.length), 5000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* HERO*/}
      <div
        // Hero mouse-parallax: each floating orb has a different parallax
        // multiplier (10 + i*5) so they drift at slightly different speeds,
        // giving a sense of depth without a 3D library.
        className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-aegis-900 to-blue-900 text-white"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setMousePos({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height })
        }}
      >
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white/5"
              style={{
                width: `${40 + i * 35}px`,
                height: `${40 + i * 35}px`,
                top: `${10 + i * 10}%`,
                left: `${5 + i * 12}%`,
                transform: `translate(${(mousePos.x - 0.5) * (10 + i * 5)}px, ${(mousePos.y - 0.5) * (10 + i * 5)}px)`,
                transition: 'transform 0.3s ease-out',
                animation: `pulse ${3 + i * 0.5}s ease-in-out infinite`,
                animationDelay: `${i * 0.4}s`,
              }}
            />
          ))}
          <div className="absolute inset-0 opacity-[0.03]">
            <svg width="100%" height="100%"><defs><pattern id="creatorGrid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0v60" fill="none" stroke="white" strokeWidth="0.5"/></pattern></defs><rect width="100%" height="100%" fill="url(#creatorGrid)"/></svg>
          </div>
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-6 py-16 sm:py-24">
          <Link to="/about" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to About AEGIS
          </Link>

          <div className="flex flex-col lg:flex-row items-center lg:items-start gap-10 lg:gap-16">
            <div className="flex-shrink-0 relative group">
              <div className="w-52 h-64 sm:w-60 sm:h-72 rounded-3xl overflow-hidden shadow-2xl shadow-black/40 ring-4 ring-white/10 transition-transform duration-700 group-hover:scale-[1.03] group-hover:rotate-1">
                <img
                  src="/images/creator.jpg"
                  alt="Happiness Ada Lazarus"
                  className="w-full h-full object-cover object-top"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    const parent = target.parentElement
                    if (parent) {
                      parent.innerHTML = '<div class="w-full h-full bg-gradient-to-br from-aegis-500 via-aegis-600 to-blue-700 flex items-center justify-center"><span class="text-6xl font-black text-white/90">HA</span></div>'
                    }
                  }}
                />
              </div>
              <div className="absolute -bottom-4 -right-4 bg-white dark:bg-gray-800 rounded-2xl px-4 py-2 shadow-xl border border-aegis-200 dark:border-aegis-700" style={{ animation: 'float 4s ease-in-out infinite' }}>
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-aegis-600 dark:text-aegis-400" />
                  <span className="text-xs font-black text-gray-900 dark:text-white">Final Year</span>
                </div>
              </div>
              <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-aegis-500/20 to-blue-500/20 blur-xl -z-10 group-hover:from-aegis-500/30 group-hover:to-blue-500/30 transition-all duration-700" />
            </div>

            <div className="flex-1 text-center lg:text-left">
              <div className="flex items-center gap-2 justify-center lg:justify-start mb-2">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">Creator & Visionary</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-black bg-gradient-to-r from-white via-aegis-200 to-blue-200 bg-clip-text text-transparent leading-tight">
                Happiness Ada<br />Lazarus
              </h1>
              <p className="text-lg text-white/70 mt-4 max-w-lg leading-relaxed">
                Computer scientist, innovator, and the sole architect behind <strong className="text-white">AEGIS</strong> — 
                a full-stack, AI-powered disaster response platform built to protect communities worldwide.
              </p>

              <div className="flex flex-wrap gap-2 mt-6 justify-center lg:justify-start">
                {[
                  { icon: MapPin, label: 'Aberdeen, Scotland' },
                  { icon: GraduationCap, label: 'Robert Gordon University' },
                  { icon: Calendar, label: 'BSc Computing Science 2025/26' },
                ].map((tag, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-[11px] font-bold text-white/80 backdrop-blur-sm hover:bg-white/20 transition-colors cursor-default">
                    <tag.icon className="w-3 h-3" />
                    {tag.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-center mt-12">
            <ChevronDown className="w-5 h-5 text-white/30 animate-bounce" />
          </div>
        </div>
        <style>{`@keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }`}</style>
      </div>

      {/* STATS BAR*/}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { label: 'Lines of Code', suffix: '+', stat: stats[0] },
              { label: 'Components Built', suffix: '+', stat: stats[1] },
              { label: 'Languages Supported', suffix: '', stat: stats[2] },
              { label: 'Solo Developer', suffix: '', stat: stats[3] },
            ].map(({ label, suffix, stat }, i) => (
              <div key={i} ref={stat.ref} className="text-center group cursor-default">
                <p className="text-3xl sm:text-4xl font-black text-aegis-600 dark:text-aegis-400 tabular-nums group-hover:scale-110 transition-transform duration-300 inline-block">
                  {stat.count.toLocaleString()}{suffix}
                </p>
                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-16">

        {/* BIO*/}
        <FadeInSection>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Heart className="w-6 h-6 text-red-500" /> The Story
              </h2>
              <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                <p>
                  A passionate computer scientist and final-year BSc Computing Science student at <strong className="text-gray-900 dark:text-white">Robert Gordon University</strong>, Aberdeen.
                  Born with roots stretching across <strong className="text-gray-900 dark:text-white">Africa</strong> and carrying a proud <strong className="text-gray-900 dark:text-white">European lineage</strong>,
                  Happiness brings a uniquely global perspective to emergency technology.
                </p>
                <p>
                  AEGIS is more than an Honours capstone project — it is a deeply personal mission.
                  Driven by an unwavering passion for <strong className="text-gray-900 dark:text-white">making people happy</strong> and keeping communities safe,
                  she engineered a full-stack, AI-powered disaster response platform from the ground up — single-handedly.
                </p>
                <p>
                  A true lover of computing, she finds joy in solving hard problems, crafting elegant code, and pushing the limits of what one developer can build.
                  Outside of code, she loves <strong className="text-gray-900 dark:text-white">music</strong>,
                  creativity, and human connection. Her philosophy: technology should serve humanity with compassion, intelligence, and beauty.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { icon: Award, label: 'BSc Honours Project 2025/26', desc: 'Capstone project for Computing Science degree', color: 'bg-amber-500' },
                { icon: Globe2, label: 'Africa — Europe Heritage', desc: 'Cross-cultural perspective on global challenges', color: 'bg-emerald-500' },
                { icon: Music, label: 'Music & Creativity', desc: 'Finding harmony in code and composition', color: 'bg-pink-500' },
                { icon: Heart, label: 'Making People Happy', desc: 'Core philosophy driving every design decision', color: 'bg-red-500' },
                { icon: Shield, label: 'Solo Computer Scientist', desc: 'Frontend, backend, AI, DevOps — all one person', color: 'bg-blue-500' },
              ].map((item, i) => (
                <FadeInSection key={i} delay={i * 100}>
                  <div className="flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:border-aegis-300 dark:hover:border-aegis-700 hover:shadow-md transition-all duration-300 group cursor-default">
                    <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 group-hover:rotate-3 transition-transform`}>
                      <item.icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">{item.label}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                </FadeInSection>
              ))}
            </div>
          </div>
        </FadeInSection>

        {/* PHILOSOPHY*/}
        <FadeInSection>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <Star className="w-6 h-6 text-amber-500" /> Design Philosophy
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-4">
              {philosophies.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActivePhilosophy(i)}
                  className={`px-4 py-3 text-left text-xs font-bold transition-all border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-gray-800 last:border-0 relative ${
                    activePhilosophy === i
                      ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  {p.title}
                  {activePhilosophy === i && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-aegis-500 sm:h-full sm:w-0.5 sm:top-0 sm:right-0 sm:left-auto" />
                  )}
                </button>
              ))}
            </div>
            <div className="p-6 sm:p-8 min-h-[120px]">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">{philosophies[activePhilosophy].title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed max-w-2xl">{philosophies[activePhilosophy].desc}</p>
            </div>
          </div>
        </FadeInSection>

        {/* TECHNICAL MASTERY*/}
        <FadeInSection>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <Code2 className="w-6 h-6 text-blue-500" /> Technical Mastery
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Hover to explore — categorised by mastery tier</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <SkillHex icon={Code2}     label="React / TypeScript"    tier="expert"     color="bg-blue-500"    delay={0} />
            <SkillHex icon={Palette}   label="Tailwind CSS"          tier="expert"     color="bg-cyan-500"    delay={80} />
            <SkillHex icon={Terminal}  label="Node.js / Express"     tier="expert"     color="bg-green-500"   delay={160} />
            <SkillHex icon={Database}  label="PostgreSQL / PostGIS"  tier="advanced"   color="bg-indigo-500"  delay={240} />
            <SkillHex icon={Brain}     label="Python / FastAPI"      tier="advanced"   color="bg-amber-500"   delay={320} />
            <SkillHex icon={Cpu}       label="AI / Machine Learning" tier="advanced"   color="bg-purple-500"  delay={400} />
            <SkillHex icon={Lock}      label="Security / Auth"       tier="advanced"   color="bg-gray-700"    delay={480} />
            <SkillHex icon={Layers}    label="Docker / DevOps"       tier="proficient" color="bg-red-500"     delay={560} />
            <SkillHex icon={Server}    label="System Architecture"   tier="advanced"   color="bg-teal-500"    delay={640} />
            <SkillHex icon={Wifi}      label="WebSocket / Real-time" tier="advanced"   color="bg-violet-500"  delay={720} />
            <SkillHex icon={BarChart3} label="Data Visualisation"    tier="proficient" color="bg-pink-500"    delay={800} />
            <SkillHex icon={GitBranch} label="Git / CI/CD"           tier="proficient" color="bg-orange-500"  delay={880} />
          </div>
          <div className="flex flex-wrap gap-4 mt-4 justify-center">
            {[
              { tier: 'Expert', dots: 5, color: 'bg-amber-500' },
              { tier: 'Advanced', dots: 4, color: 'bg-blue-500' },
              { tier: 'Proficient', dots: 3, color: 'bg-emerald-500' },
            ].map(l => (
              <div key={l.tier} className="flex items-center gap-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`w-3 h-1 rounded-full ${i < l.dots ? l.color : 'bg-gray-200 dark:bg-gray-800'}`} />
                  ))}
                </div>
                {l.tier}
              </div>
            ))}
          </div>
        </FadeInSection>

        {/* JOURNEY TIMELINE*/}
        <FadeInSection>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-purple-500" /> The AEGIS Journey
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 sm:p-8 border border-gray-100 dark:border-gray-800">
            <TimelineItem year="2025 — Autumn" title="Research & Concept" desc="Literature review on disaster response systems, AI-driven predictions, and community resilience. The vision for AEGIS crystallises." icon={BookOpen} color="bg-purple-500" />
            <TimelineItem year="2025 — Winter" title="Architecture Design" desc="Full-stack architecture designed — React 18 + TypeScript frontend, Node.js/Express backend, PostgreSQL with PostGIS for geospatial data." icon={Layers} color="bg-blue-500" />
            <TimelineItem year="2025 — Spring" title="Core Platform Build" desc="Core systems built: authentication, real-time alerts, interactive mapping, community reporting, multi-language support across 5+ languages." icon={Code2} color="bg-green-500" />
            <TimelineItem year="2025 — Summer" title="AI Engine Integration" desc="Python-based AI engine with FastAPI — hazard classification, severity prediction, NLP-powered report analysis, and automated triage." icon={Brain} color="bg-amber-500" />
            <TimelineItem year="2025/26" title="Production Hardening" desc="Performance optimisation, security hardening, accessibility compliance, comprehensive testing, Docker containerisation, and global deployment readiness." icon={Shield} color="bg-red-500" />
          </div>
        </FadeInSection>

        {/* TECH ARCHITECTURE VISUAL*/}
        <FadeInSection>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" /> System Architecture
          </h2>
          <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 sm:p-8 border border-gray-700 overflow-hidden relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-aegis-500/10 rounded-full blur-[100px]" />
            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { title: 'Frontend', items: ['React 18 + TypeScript', 'Tailwind CSS Design System', 'Vite + Hot Module Reload', 'i18n (10+ Languages)', 'PWA + Service Worker'], color: 'from-blue-500 to-cyan-500', icon: Code2 },
                { title: 'Backend', items: ['Node.js + Express', 'PostgreSQL + PostGIS', 'JWT + bcrypt Auth', 'WebSocket Real-time', 'Redis Caching Layer'], color: 'from-green-500 to-emerald-500', icon: Server },
                { title: 'AI Engine', items: ['Python + FastAPI', 'scikit-learn Models', 'NLP Report Analysis', 'Hazard Classification', 'CLIP Vision Pipeline'], color: 'from-purple-500 to-violet-500', icon: Brain },
              ].map((layer, i) => (
                <FadeInSection key={i} delay={i * 150}>
                  <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 group">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${layer.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                      <layer.icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-sm font-black text-white mb-3">{layer.title}</h3>
                    <ul className="space-y-1.5">
                      {layer.items.map((item, j) => (
                        <li key={j} className="text-[11px] text-gray-400 flex items-center gap-2">
                          <div className={`w-1 h-1 rounded-full bg-gradient-to-r ${layer.color}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeInSection>
              ))}
            </div>
          </div>
        </FadeInSection>

        {/* QUOTE*/}
        <FadeInSection>
          <div className="relative overflow-hidden bg-gradient-to-br from-aegis-600 via-aegis-700 to-blue-700 rounded-3xl p-8 sm:p-12 text-white">
            <div className="absolute top-4 left-6 opacity-10">
              <Quote className="w-24 h-24" />
            </div>
            <div className="absolute bottom-0 right-0 w-64 h-64 bg-white/5 rounded-full translate-x-1/3 translate-y-1/3 blur-3xl" />
            <div className="relative z-10 max-w-2xl mx-auto text-center">
              <p className="text-lg sm:text-xl font-medium leading-relaxed italic">
                &ldquo;I built AEGIS because I believe every person deserves to feel safe, informed, and empowered — regardless of where they come from.
                This platform is my way of using technology to protect the people I love, and the ones I have yet to meet.&rdquo;
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-sm font-black">HA</span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold">Happiness Ada Lazarus</p>
                  <p className="text-xs text-white/60">Creator of AEGIS</p>
                </div>
              </div>
            </div>
          </div>
        </FadeInSection>

        {/* FOOTER NAV*/}
        <div className="flex flex-wrap gap-4 text-sm justify-center pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link to="/about" className="text-aegis-600 hover:underline flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> About AEGIS</Link>
          <Link to="/citizen" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">Citizen Portal</Link>
          <Link to="/privacy" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">Privacy Policy</Link>
          <Link to="/terms" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">Terms of Use</Link>
          <Link to="/accessibility" className="text-gray-500 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400">Accessibility</Link>
        </div>
      </div>
    </div>
  )
}
