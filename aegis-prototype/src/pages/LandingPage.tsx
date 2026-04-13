import { Link } from 'react-router-dom'
import { Shield, Users, Settings, ArrowRight, Radio, Droplets, AlertTriangle, MapPin, Globe, Zap, Heart, Activity, Eye, Brain, Bell, BarChart3, Layers, Smartphone, Lock, Wifi, Map, Siren } from 'lucide-react'
import { Navbar } from '../components/Navbar'
import Footer from '../components/Footer'
import { useEffect, useRef, useState } from 'react'

function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el); return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

function AnimatedStat({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [count, setCount] = useState(0)
  const { ref, visible } = useReveal(0.3)
  useEffect(() => {
    if (!visible) return
    let c = 0; const step = Math.max(1, Math.floor(value / 40))
    const timer = setInterval(() => { c += step; if (c >= value) { setCount(value); clearInterval(timer) } else setCount(c) }, 30)
    return () => clearInterval(timer)
  }, [visible, value])
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>
}

function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal(0.1)
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden relative bg-gradient-to-b from-gray-50 via-white to-gray-50 dark:from-gray-950 dark:via-surface-ultra-dark dark:to-gray-950 text-gray-900 dark:text-white">
      <style>{`
        @keyframes lp-float{0%,100%{transform:translate(0%,0%) scale(1)}33%{transform:translate(2%,-3%) scale(1.04)}66%{transform:translate(-2%,2%) scale(.97)}}
        @keyframes lp-float-r{0%,100%{transform:translate(0%,0%)}50%{transform:translate(-3%,-2%) scale(1.06)}}
        @keyframes lp-radar{0%{transform:scale(.3);opacity:.6}100%{transform:scale(2.5);opacity:0}}
        .lp-grid-bg{background-image:radial-gradient(circle,rgba(var(--glow-color),.07) 1px,transparent 1px);background-size:40px 40px}
        .dark .lp-grid-bg{background-image:radial-gradient(circle,rgba(var(--glow-color),.04) 1px,transparent 1px)}
      `}</style>
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="lp-grid-bg absolute inset-0" />
        <div className="absolute -top-40 -left-40 w-[650px] h-[650px] bg-aegis-400/8 dark:bg-aegis-500/5 rounded-full blur-3xl" style={{ animation: 'lp-float 28s ease-in-out infinite' }} />
        <div className="absolute top-1/4 -right-32 w-[500px] h-[500px] bg-blue-400/6 dark:bg-blue-500/4 rounded-full blur-3xl" style={{ animation: 'lp-float-r 32s ease-in-out infinite' }} />
        <div className="absolute bottom-0 left-1/3 w-[450px] h-[450px] bg-amber-300/5 dark:bg-amber-400/3 rounded-full blur-3xl" style={{ animation: 'lp-float 36s ease-in-out infinite 3s' }} />
      </div>

      <Navbar transparent />

      {/* HERO */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20 text-center">
        <Reveal>
          <div className="inline-flex items-center gap-2.5 bg-aegis-500/10 border border-aegis-500/20 rounded-full px-4 py-1.5 mb-8">
            <span className="relative w-2 h-2"><span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" /><span className="relative block w-2 h-2 rounded-full bg-green-400" /></span>
            <span className="text-xs font-semibold text-aegis-600 dark:text-aegis-300 tracking-wide">Monitoring 12+ Regions</span>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-tight mb-6 leading-[1.08]">
            Protecting Communities<br/><span className="gradient-text">With Intelligent Response</span>
          </h1>
        </Reveal>
        <Reveal delay={200}>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 mb-4 max-w-2xl mx-auto leading-relaxed">
            AI-powered disaster response platform combining real-time data, geospatial intelligence, and multi-channel alerts to safeguard the UK.
          </p>
          <p className="text-sm text-gray-400 dark:text-white/50 mb-10 max-w-xl mx-auto">
            Built as a sovereign AI solution running entirely on consumer hardware — no cloud API dependency.
          </p>
        </Reveal>
        <Reveal delay={300}>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link to="/citizen" className="group relative bg-gradient-to-r from-aegis-600 to-aegis-500 hover:from-aegis-500 hover:to-aegis-400 text-white px-8 py-4 rounded-2xl font-bold text-base sm:text-lg flex items-center justify-center gap-3 transition-all shadow-xl shadow-aegis-600/25 hover:shadow-aegis-500/35 hover:scale-[1.02] active:scale-[0.98]">
              <Users className="w-5 h-5" /> Citizen Portal <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/admin" className="group bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 backdrop-blur-sm text-gray-900 dark:text-white px-8 py-4 rounded-2xl font-bold text-base sm:text-lg flex items-center justify-center gap-3 transition-all border border-gray-200 dark:border-white/10 shadow-lg hover:scale-[1.02] active:scale-[0.98]">
              <Settings className="w-5 h-5 text-aegis-500" /> Operator Console <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </Reveal>
        <Reveal delay={400}>
          <div className="relative max-w-3xl mx-auto mt-4">
            <div className="relative bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-gray-200/80 dark:border-white/[0.06] shadow-2xl p-6 sm:p-8 overflow-hidden">
              <div className="absolute top-4 right-4 w-3 h-3"><span className="absolute inset-0 rounded-full bg-green-400" style={{ animation: 'lp-radar 2.5s ease-out infinite' }} /><span className="relative block w-3 h-3 rounded-full bg-green-400" /></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                {[
                  { icon: Radio, label: 'Real-Time Alerts', desc: 'Multi-channel incident tracking with live severity updates', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10' },
                  { icon: Map, label: 'Intelligence Maps', desc: '2D + 3D layers with flood extents and evacuation routes', color: 'text-aegis-600 dark:text-aegis-400', bg: 'bg-aegis-50 dark:bg-aegis-500/10' },
                  { icon: Droplets, label: 'Flood Analytics', desc: 'Live river & rainfall monitoring from EA/SEPA gauges', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-500/10' },
                  { icon: Brain, label: 'AI Predictions', desc: 'ML-based hazard forecasting with severity assessment', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                ].map((f, i) => (
                  <Reveal key={f.label} delay={500 + i * 100}>
                    <div className="text-left group">
                      <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}><f.icon className={`w-5 h-5 ${f.color}`} /></div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{f.label}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* STATS */}
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
                  <div className="w-12 h-12 rounded-xl bg-white dark:bg-white/5 border border-gray-200/60 dark:border-white/5 flex items-center justify-center shadow-sm mb-1"><s.icon className={`w-5 h-5 ${s.color}`} /></div>
                  <p className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white"><AnimatedStat value={s.value} suffix={s.suffix} /></p>
                  <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold">{s.label}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <Reveal>
          <div className="text-center mb-16">
            <span className="text-xs font-bold text-aegis-600 dark:text-aegis-400 tracking-widest uppercase">Capabilities</span>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white mt-3 mb-4">Enterprise-Grade Emergency Intelligence</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">Combining real-time data ingestion, AI-powered analysis, and multi-channel communication to protect communities.</p>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { icon: Radio, title: '5-Channel Alert System', desc: 'Email, SMS, WhatsApp, Telegram, and Web Push simultaneously.', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', border: 'hover:border-red-300 dark:hover:border-red-500/30' },
            { icon: Map, title: '2D + 3D Intelligence Maps', desc: 'Leaflet and Deck.gl with flood overlays, evacuation routes, heatmaps.', color: 'text-aegis-600', bg: 'bg-aegis-50 dark:bg-aegis-500/10', border: 'hover:border-aegis-300 dark:hover:border-aegis-500/30' },
            { icon: Brain, title: 'AI Severity Assessment', desc: 'NLP classification, fake detection, and automated scoring.', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'hover:border-purple-300 dark:hover:border-purple-500/30' },
            { icon: BarChart3, title: 'Predictive Analytics', desc: 'ML flood, drought, and heatwave forecasting with risk scores.', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'hover:border-amber-300 dark:hover:border-amber-500/30' },
            { icon: Layers, title: 'Multi-Hazard Design', desc: 'Extensible architecture for floods, fires, earthquakes, storms.', color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'hover:border-cyan-300 dark:hover:border-cyan-500/30' },
            { icon: Eye, title: 'Real-Time Monitoring', desc: 'WebSocket dashboards with river gauges and weather feeds.', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-500/10', border: 'hover:border-green-300 dark:hover:border-green-500/30' },
            { icon: Users, title: 'Community Hub', desc: 'Crisis chat, crowd density heatmaps, and shelter finder.', color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'hover:border-indigo-300 dark:hover:border-indigo-500/30' },
            { icon: Lock, title: 'Role-Based Access', desc: 'JWT auth with citizen and operator portals plus audit trails.', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-white/5', border: 'hover:border-gray-400 dark:hover:border-gray-500/30' },
            { icon: Smartphone, title: 'Responsive & Accessible', desc: 'Mobile-first, dark mode, 9 languages (EN/ES/FR/AR/ZH…), WCAG.', color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-500/10', border: 'hover:border-pink-300 dark:hover:border-pink-500/30' },
          ].map((f, i) => (
            <Reveal key={f.title} delay={i * 60}>
              <div className={`group bg-white/70 dark:bg-white/[0.02] backdrop-blur-sm rounded-2xl border border-gray-200/80 dark:border-white/[0.06] ${f.border} p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5`}>
                <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}><f.icon className={`w-5 h-5 ${f.color}`} /></div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5">{f.title}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="relative z-10 bg-gray-50/80 dark:bg-white/[0.01] border-y border-gray-200/60 dark:border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <Reveal>
            <div className="text-center mb-16">
              <span className="text-xs font-bold text-aegis-600 dark:text-aegis-400 tracking-widest uppercase">Process</span>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white mt-3 mb-4">How AEGIS Protects Communities</h2>
            </div>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-16 left-[16.66%] right-[16.66%] h-px bg-gradient-to-r from-aegis-400/40 via-aegis-500/40 to-aegis-400/40" />
            {[
              { step: 1, title: 'Report & Detect', desc: 'Citizens report incidents. AI ingests data from EA flood gauges, SEPA monitors, and Met Office feeds.', icon: Bell },
              { step: 2, title: 'Analyse & Classify', desc: 'NLP models classify severity, detect fakes, and cross-reference with geospatial intelligence.', icon: Brain },
              { step: 3, title: 'Alert & Respond', desc: 'Operators notified instantly. Alerts broadcast across 5 channels. Resources deployed with AI recommendations.', icon: Siren },
            ].map((s, i) => (
              <Reveal key={s.step} delay={i * 150}>
                <div className="relative flex flex-col items-center text-center">
                  <div className="w-14 h-14 bg-aegis-600 rounded-2xl flex items-center justify-center shadow-lg shadow-aegis-600/20 mb-5"><s.icon className="w-7 h-7 text-white" /></div>
                  <span className="text-[10px] font-black text-aegis-600 dark:text-aegis-400 tracking-widest uppercase mb-2">Step {s.step}</span>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{s.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* DATA SOURCES */}
      <section id="data-sources" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <Reveal>
          <div className="text-center mb-12">
            <span className="text-xs font-bold text-aegis-600 dark:text-aegis-400 tracking-widest uppercase">Data Sources</span>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white mt-3 mb-4">Powered by Authoritative Open Data</h2>
          </div>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: 'Environment Agency', desc: 'Real-time flood warnings, river gauges, and rainfall across England', icon: Droplets, tag: 'Flood Data' },
            { name: 'SEPA Scotland', desc: 'Scottish river monitoring, flood extent data, and conditions', icon: Activity, tag: 'River Levels' },
            { name: 'Met Office', desc: 'Severe weather warnings, forecasts, and climate datasets', icon: AlertTriangle, tag: 'Weather' },
            { name: 'Open Infrastructure', desc: 'OSM, OS Maps, and GeoJSON boundary data for geospatial layers', icon: Globe, tag: 'Geospatial' },
          ].map((src, i) => (
            <Reveal key={src.name} delay={i * 100}>
              <div className="bg-white/70 dark:bg-white/[0.02] backdrop-blur-sm rounded-2xl border border-gray-200/80 dark:border-white/[0.06] p-5 hover:border-aegis-300 dark:hover:border-aegis-500/20 transition-all hover:shadow-md">
                <div className="flex items-center justify-between mb-3">
                  <src.icon className="w-5 h-5 text-aegis-600 dark:text-aegis-400" />
                  <span className="text-[9px] font-bold text-aegis-600 dark:text-aegis-400 bg-aegis-50 dark:bg-aegis-500/10 px-2 py-0.5 rounded-full uppercase">{src.tag}</span>
                </div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5">{src.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{src.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <Reveal>
          <div className="relative bg-gradient-to-br from-aegis-600 to-aegis-700 rounded-3xl p-8 sm:p-12 overflow-hidden">
            <div className="absolute inset-0 opacity-10"><div className="absolute -top-20 -right-20 w-64 h-64 border-[40px] border-white rounded-full" /><div className="absolute -bottom-16 -left-16 w-48 h-48 border-[30px] border-white rounded-full" /></div>
            <div className="relative z-10 text-center sm:text-left sm:flex items-center justify-between gap-8">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">Ready to Explore AEGIS?</h2>
                <p className="text-sm text-aegis-100/80 max-w-md">Access the public dashboard to view live alerts, flood maps, and community safety tools.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mt-6 sm:mt-0 flex-shrink-0">
                <Link to="/guest" className="group bg-white text-aegis-700 hover:bg-aegis-50 px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-xl">
                  <Eye className="w-4 h-4" /> Public Dashboard <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <Link to="/citizen/login" className="group bg-white/10 hover:bg-white/20 text-white border border-white/20 px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all backdrop-blur-sm">
                  <Users className="w-4 h-4" /> Create Account <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <Footer />
    </div>
  )
}
