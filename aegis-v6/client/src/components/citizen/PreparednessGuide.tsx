/**
 * Interactive citizen preparedness trainer with five tabs:
 * - Tips: per-hazard safety advice cards with expand/collapse
 * - Scenarios: guided step-by-step drills with a live countdown timer
 * - Kit: emergency supply checklist persisted to localStorage
 * - Quiz: multi-category safety knowledge quiz with explanation popups
 * - Badges: gamification awards earned from drills, quizzes, and kit checks
 *
 * State persistence: four localStorage keys track progress across sessions
 * so users don't lose their readiness score on page reload.
 *
 * - Rendered by CitizenPage.tsx / CitizenDashboard.tsx
 * - Reads preparedness data from client/src/data/preparedness.ts
 * - Uses AlertsContext to push congratulatory notifications on achievements
 * */

import { useState, useEffect, useRef } from 'react'
import { X, BookOpen, Shield, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Play, RotateCcw, Trophy, Users, Clock, Star, Flame, Waves, Wind, Zap, Thermometer, AlertCircle, Filter, Timer, Award, Target, Heart, ArrowRight, Sparkles, ThumbsUp, Droplets, Package, Flashlight, Cross, Pill, BatteryCharging, FileText, Banknote, Radio, Shirt, Volume2, Hand, CloudRain, Glasses, Wrench, Map, Box, Baby, PawPrint, Phone, Globe, Crown, Backpack, Lock, type LucideIcon } from 'lucide-react'
import { PREPAREDNESS_TIPS, PREPAREDNESS_SCENARIOS, EMERGENCY_KIT_ITEMS, ALL_QUIZ, BADGES } from '../../data/preparedness'
import { useAlerts } from '../../contexts/AlertsContext'
import { t } from '../../utils/i18n'

const ICON_MAP: Record<string, LucideIcon> = {
  Waves, Globe, Flame, Wind, Shield, Droplets, Package, Flashlight, Cross, Pill,
  BatteryCharging, FileText, Banknote, Radio, Shirt, Volume2, Hand, CloudRain,
  Glasses, Wrench, Map, Box, Sparkles, Baby, PawPrint, Phone, Target, Trophy,
  Star, Award, Crown, Backpack, CheckCircle, Lock,
}

// Safe icon lookup with fallback to prevent blank spaces when icon name is missing
function getIcon(name: string | undefined): LucideIcon {
  if (!name) return Shield
  return ICON_MAP[name] || Shield
}
import { useLanguage } from '../../hooks/useLanguage'

/* Inline SVG — Readiness Ring */
function ReadinessRing({ pct, size = 100, light }: { pct: number; size?: number; light?: boolean }) {
  const r = (size - 14) / 2, c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(pct / 100, 1))
  const color = pct >= 75 ? '#22c55e' : pct >= 50 ? '#eab308' : pct >= 25 ? '#f97316' : '#ef4444'
  return (
    <svg width={size} height={size} className="transform -rotate-90 drop-shadow-lg">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={5} className={light ? 'text-white/10' : 'text-gray-200 dark:text-gray-700'} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  )
}

/* Inline SVG — Mini Progress Ring */
function MiniRing({ pct, size = 28, color = '#6366f1' }: { pct: number; size?: number; color?: string }) {
  const sw = 2.5, r = (size - sw * 2) / 2, c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(pct, 1))
  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={sw} className="text-gray-200 dark:text-gray-700" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
    </svg>
  )
}

interface Props { onClose: () => void; lang?: string; isEmergencyActive?: boolean }

// localStorage keys for cross-session persistence.
// Storing sets/objects as JSON strings so progress survives page reloads.
const STORAGE_KEY_SCENARIOS = 'aegis_completed_scenarios'
const STORAGE_KEY_QUIZ = 'aegis_quiz_best'
const STORAGE_KEY_KIT = 'aegis_kit_checked'
const STORAGE_KEY_PLAN = 'aegis_family_plan'

const DISASTER_ICONS: Record<string, JSX.Element> = {
  flood: <Waves className="w-3.5 h-3.5" />,
  fire: <Flame className="w-3.5 h-3.5" />,
  storm: <Wind className="w-3.5 h-3.5" />,
  earthquake: <Zap className="w-3.5 h-3.5" />,
  heatwave: <Thermometer className="w-3.5 h-3.5" />,
  tsunami: <AlertCircle className="w-3.5 h-3.5" />,
  general: <Shield className="w-3.5 h-3.5" />,
}

const DISASTER_COLORS: Record<string, string> = {
  flood: '#3b82f6', fire: '#ef4444', storm: '#8b5cf6',
  earthquake: '#f97316', heatwave: '#f59e0b', tsunami: '#06b6d4', general: '#6366f1',
}

export default function PreparednessGuide({ onClose, lang = 'en', isEmergencyActive = false }: Props): JSX.Element {
  const [tab, setTab] = useState<'tips' | 'scenarios' | 'kit' | 'quiz' | 'plan' | 'badges'>('tips')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [scenario, setScenario] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [quizFilter, setQuizFilter] = useState<string>('all')
  const [quizQ, setQuizQ] = useState(0)
  const [quizScore, setQuizScore] = useState(0)
  const [quizDone, setQuizDone] = useState(false)
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null)
  const [quizStarted, setQuizStarted] = useState(false)
  const [showExplanation, setShowExplanation] = useState(false)
  const [drillSeconds, setDrillSeconds] = useState(0)
  const [drillActive, setDrillActive] = useState(false)
  const [familyPlan, setFamilyPlan] = useState<Record<string, string>>({})
  const drillRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const quizTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timers on unmount
  useEffect(() => () => {
    if (drillRef.current) clearInterval(drillRef.current)
    if (quizTimerRef.current) clearTimeout(quizTimerRef.current)
  }, [])

  // Lazy state initialisers: load persisted sets from localStorage on first render.
  // try/catch guards against corrupted or missing localStorage values.
  const [completedScenarios, setCompletedScenarios] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_SCENARIOS) || '[]')) } catch { return new Set() }
  })
  const [bestQuizScore, setBestQuizScore] = useState<{ score: number; total: number } | null>(() => {
    try { const v = localStorage.getItem(STORAGE_KEY_QUIZ); return v ? JSON.parse(v) : null } catch { return null }
  })
  const [kitChecked, setKitChecked] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_KIT) || '[]')) } catch { return new Set() }
  })

  const { pushNotification } = useAlerts()

  useEffect(() => {
    try { const v = localStorage.getItem(STORAGE_KEY_PLAN); if (v) setFamilyPlan(JSON.parse(v)) } catch {}
  }, [])

  const persistCompletedScenarios = (s: Set<string>) => {
    localStorage.setItem(STORAGE_KEY_SCENARIOS, JSON.stringify([...s]))
  }
  const persistKit = (s: Set<string>) => {
    localStorage.setItem(STORAGE_KEY_KIT, JSON.stringify([...s]))
  }
  const persistPlan = (p: Record<string, string>) => {
    localStorage.setItem(STORAGE_KEY_PLAN, JSON.stringify(p))
  }

  const filteredQuiz = quizFilter === 'all' ? ALL_QUIZ : ALL_QUIZ.filter(q => q.category === quizFilter)

  const startQuiz = () => {
    setQuizQ(0); setQuizScore(0); setQuizDone(false); setQuizAnswer(null); setShowExplanation(false); setQuizStarted(true)
  }

  const answerQuiz = (i: number): void => {
    if (quizAnswer !== null) return // prevent double-answering
    setQuizAnswer(i)
    const isCorrect = i === filteredQuiz[quizQ].correct
    if (isCorrect) setQuizScore(s => s + 1)
    setShowExplanation(true)
    // Pause 2 seconds so the user can read the explanation before advancing.
    quizTimerRef.current = setTimeout(() => {
      if (quizQ < filteredQuiz.length - 1) {
        setQuizQ(q => q + 1); setQuizAnswer(null); setShowExplanation(false)
      } else {
        const finalScore = isCorrect ? quizScore + 1 : quizScore
        setQuizDone(true)
        if (!bestQuizScore || finalScore > bestQuizScore.score) {
          const newBest = { score: finalScore, total: filteredQuiz.length }
          setBestQuizScore(newBest)
          localStorage.setItem(STORAGE_KEY_QUIZ, JSON.stringify(newBest))
        }
      }
    }, 2000)
  }

  // Drill timer: counts elapsed seconds using setInterval.
  // drillRef holds the interval ID so completeScenario can clear it.
  const startDrill = () => {
    setDrillActive(true); setDrillSeconds(0)
    drillRef.current = setInterval(() => setDrillSeconds(s => s + 1), 1000)
  }

  const completeScenario = (id: string) => {
    if (drillRef.current) clearInterval(drillRef.current)
    setDrillActive(false)
    const updated = new Set([...completedScenarios, id])
    setCompletedScenarios(updated)
    persistCompletedScenarios(updated)
    const medal = drillSeconds < 120 ? 'Fast' : drillSeconds < 300 ? 'Good' : 'Done'
    pushNotification(`${medal} — Scenario complete in ${Math.floor(drillSeconds / 60)}m ${drillSeconds % 60}s!`, 'success')
    setScenario(null)
  }

  const handleKitToggle = (item: string) => {
    setKitChecked(prev => {
      const n = new Set(prev)
      n.has(item) ? n.delete(item) : n.add(item)
      persistKit(n)
      return n
    })
  }

  const updatePlan = (key: string, val: string) => {
    const updated = { ...familyPlan, [key]: val }
    setFamilyPlan(updated)
    persistPlan(updated)
  }

  useEffect(() => {
    return () => { if (drillRef.current) clearInterval(drillRef.current) }
  }, [])

  const sc = PREPAREDNESS_SCENARIOS.find(s => s.id === scenario)
  const kitPct = kitChecked.size / EMERGENCY_KIT_ITEMS.length
  const unlockedBadges = BADGES.filter(b => b.condition(completedScenarios, bestQuizScore?.score ?? 0, bestQuizScore?.total ?? 1, kitPct))

  const planFields = ['meeting','contact','medical','pets','evacRoute','shelter','utilities','comms']
  const planPct = planFields.filter(k => (familyPlan[k] || '').trim().length > 0).length / planFields.length
  const scenarioPct = completedScenarios.size / PREPAREDNESS_SCENARIOS.length
  const quizPct = bestQuizScore ? bestQuizScore.score / bestQuizScore.total : 0
  const readiness = Math.round(scenarioPct * 25 + quizPct * 25 + kitPct * 25 + planPct * 25)
  const readinessLabel = readiness >= 75 ? 'Excellent' : readiness >= 50 ? 'Good' : readiness >= 25 ? 'Building' : 'Getting Started'

  const tabConfig = [
    { id: 'tips' as const, label: t('prep.tab.tips', lang), Icon: Shield },
    { id: 'scenarios' as const, label: t('prep.tab.scenarios', lang), Icon: Play },
    { id: 'kit' as const, label: t('prep.tab.kit', lang), Icon: CheckCircle },
    { id: 'quiz' as const, label: t('prep.tab.quiz', lang), Icon: BookOpen },
    { id: 'plan' as const, label: t('prep.tab.plan', lang), Icon: Users },
    { id: 'badges' as const, label: `${t('prep.tab.badges', lang)} ${unlockedBadges.length}/${BADGES.length}`, Icon: Trophy },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 z-50" role="dialog" aria-modal="true" aria-label={t('prep.title', lang)}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[94vh] flex flex-col overflow-hidden">

        {/* HERO HEADER */}
        <div className="relative bg-gradient-to-br from-slate-900 via-aegis-900 to-slate-800 text-white p-5 pb-4 rounded-t-2xl flex-shrink-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '18px 18px' }} />

          <div className="relative flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight flex items-center gap-2.5">
                <div className="p-1.5 bg-white/10 rounded-lg backdrop-blur"><BookOpen className="w-5 h-5" /></div>
                {t('prep.title', lang)}
              </h2>
              <p className="text-[11px] text-white/40 mt-1 ml-10">Disaster preparedness training &amp; readiness tracker</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors" aria-label={t('general.close', lang)}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="relative flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <ReadinessRing pct={readiness} light />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black tabular-nums leading-none">{readiness}</span>
                <span className="text-[7px] uppercase tracking-[0.15em] text-white/40 font-bold mt-0.5">Readiness</span>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-2">
              {[
                { label: 'Scenarios', value: `${completedScenarios.size}/${PREPAREDNESS_SCENARIOS.length}`, pct: scenarioPct, color: '#8b5cf6' },
                { label: 'Quiz Best', value: bestQuizScore ? `${Math.round(quizPct * 100)}%` : '—', pct: quizPct, color: '#06b6d4' },
                { label: 'Kit Ready', value: `${Math.round(kitPct * 100)}%`, pct: kitPct, color: '#22c55e' },
                { label: 'Plan', value: `${Math.round(planPct * 100)}%`, pct: planPct, color: '#f59e0b' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2">
                  <MiniRing pct={s.pct} size={28} color={s.color} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold tabular-nums leading-tight">{s.value}</div>
                    <div className="text-[9px] text-white/35 leading-tight">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-3 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full overflow-hidden bg-white/10">
              <div className={`h-full rounded-full transition-all duration-1000 ${readiness >= 75 ? 'bg-green-400' : readiness >= 50 ? 'bg-yellow-400' : readiness >= 25 ? 'bg-orange-400' : 'bg-red-400'}`} style={{ width: `${readiness}%` }} />
            </div>
            <span className={`text-[10px] font-bold ${readiness >= 75 ? 'text-green-400' : readiness >= 50 ? 'text-yellow-400' : readiness >= 25 ? 'text-orange-400' : 'text-red-400'}`}>{readinessLabel}</span>
          </div>
        </div>

        {isEmergencyActive && (
          <div className="mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center gap-2 flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">{t('prep.emergencyActive', lang)}</p>
          </div>
        )}

        {/* TAB BAR */}
        <div className="flex-shrink-0 border-b border-gray-100 dark:border-gray-800 px-4 pt-3">
          <div className="flex gap-1 overflow-x-auto pb-0 flex-nowrap">
            {tabConfig.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`relative px-3.5 py-2.5 flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all rounded-t-lg ${tab === id ? 'text-aegis-700 dark:text-aegis-400' : 'text-gray-400 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-400'}`}>
                <Icon className="w-3.5 h-3.5 flex-shrink-0" /> {label}
                {tab === id && <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-aegis-600" />}
              </button>
            ))}
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* TIPS TAB */}
          {tab === 'tips' && (
            <div className="space-y-2.5">
              {PREPAREDNESS_TIPS.map(tip => {
                const dColor = DISASTER_COLORS[tip.category] || '#6366f1'
                return (
                  <div key={tip.category} className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 hover:shadow-md transition-shadow">
                    <button onClick={() => setExpanded(expanded === tip.category ? null : tip.category)}
                      className="w-full p-3.5 flex items-center gap-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style={{ backgroundColor: dColor }}>
                        {DISASTER_ICONS[tip.category] || <Shield className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 text-left">
                        <h3 className="font-bold text-sm leading-tight">{tip.title}</h3>
                        <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5">{tip.before.length + tip.during.length + tip.after.length} tips across 3 phases</p>
                      </div>
                      <div className={`p-1.5 rounded-lg transition-transform duration-200 ${expanded === tip.category ? 'rotate-180 bg-aegis-50 dark:bg-aegis-950/30' : 'bg-gray-50 dark:bg-gray-800'}`}>
                        <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-400" />
                      </div>
                    </button>
                    {expanded === tip.category && (
                      <div className="px-3.5 pb-3.5 animate-fade-in border-t border-gray-100 dark:border-gray-800">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3">
                          {([
                            { phase: 'before' as const, label: t('prep.phase.before', lang), Icon: Zap, gradient: 'from-blue-500 to-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-100 dark:border-blue-900/50', text: 'text-blue-700 dark:text-blue-400' },
                            { phase: 'during' as const, label: t('prep.phase.during', lang), Icon: AlertTriangle, gradient: 'from-red-500 to-red-600', bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-100 dark:border-red-900/50', text: 'text-red-700 dark:text-red-400' },
                            { phase: 'after' as const, label: t('prep.phase.after', lang), Icon: CheckCircle, gradient: 'from-green-500 to-green-600', bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-100 dark:border-green-900/50', text: 'text-green-700 dark:text-green-400' },
                          ]).map(({ phase, label, Icon, gradient, bg, border }) => (
                            <div key={phase} className={`rounded-xl overflow-hidden border ${border}`}>
                              <div className={`bg-gradient-to-r ${gradient} px-3 py-1.5`}>
                                <h4 className="font-bold text-[10px] uppercase tracking-wider text-white flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</h4>
                              </div>
                              <div className={`${bg} p-3`}>
                                <ul className="space-y-1.5">
                                  {tip[phase].map((item, i) => (
                                    <li key={i} className="text-[11px] text-secondary flex gap-2 leading-snug">
                                      <span className="text-gray-300 dark:text-gray-400 flex-shrink-0 mt-0.5">›</span>{item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setTab('scenarios')} className="mt-3 text-xs text-aegis-600 dark:text-aegis-400 hover:underline flex items-center gap-1 font-medium">
                          <Play className="w-3 h-3" /> Practice {tip.title} scenarios <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* SCENARIOS TAB — LIST */}
          {tab === 'scenarios' && !scenario && (
            <div>
              <div className="flex items-center gap-3 mb-4 p-3 bg-gradient-to-r from-aegis-50 to-purple-50 dark:from-aegis-950/20 dark:to-purple-950/20 border border-aegis-100 dark:border-aegis-800/50 rounded-xl">
                <div className="relative flex-shrink-0">
                  <MiniRing pct={scenarioPct} size={44} color="#8b5cf6" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-black text-purple-600 dark:text-purple-400">{completedScenarios.size}</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-400">{completedScenarios.size} of {PREPAREDNESS_SCENARIOS.length} scenarios completed</p>
                    <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">{Math.round(scenarioPct * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-aegis-500 transition-all duration-700" style={{ width: `${scenarioPct * 100}%` }} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {PREPAREDNESS_SCENARIOS.map(s => {
                  const done = completedScenarios.has(s.id)
                  const dColor = DISASTER_COLORS[s.disasterType] || '#6366f1'
                  return (
                    <button key={s.id} onClick={() => { setScenario(s.id); setStep(0); setDrillSeconds(0); setDrillActive(false) }}
                      className={`group text-left rounded-xl border p-3.5 transition-all hover:shadow-lg ${done ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10' : 'border-gray-100 dark:border-gray-800 hover:border-aegis-200 dark:hover:border-aegis-700 bg-white dark:bg-gray-900'}`}>
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white flex-shrink-0" style={{ backgroundColor: done ? '#22c55e' : dColor }}>
                          {done ? <CheckCircle className="w-3.5 h-3.5" /> : (DISASTER_ICONS[s.disasterType] || <Shield className="w-3.5 h-3.5" />)}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${s.difficulty === 'beginner' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : s.difficulty === 'intermediate' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>{s.difficulty}</span>
                          <span className="text-[9px] text-gray-400 dark:text-gray-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{s.duration}</span>
                        </div>
                      </div>
                      <h3 className="font-bold text-[13px] leading-tight mb-1 group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors">{s.title}</h3>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">{s.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* SCENARIOS TAB — DRILL */}
          {tab === 'scenarios' && sc && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => { setScenario(null); if (drillRef.current) clearInterval(drillRef.current); setDrillActive(false) }} className="text-xs text-gray-500 dark:text-gray-400 hover:text-aegis-600 flex items-center gap-1 font-medium">← Back</button>
                {!drillActive ? (
                  <button onClick={startDrill} className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-aegis-600 to-aegis-700 text-white text-xs font-bold rounded-xl hover:from-aegis-500 hover:to-aegis-600 transition-all shadow-lg shadow-aegis-600/20"><Timer className="w-3.5 h-3.5" /> Start Drill Timer</button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs font-mono bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 px-4 py-2 rounded-xl font-bold">
                    <Timer className="w-3.5 h-3.5 animate-pulse" /> {Math.floor(drillSeconds / 60).toString().padStart(2, '0')}:{(drillSeconds % 60).toString().padStart(2, '0')}
                  </div>
                )}
              </div>

              <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm mb-1">{sc.title}</h3>
                    <p className="text-xs text-secondary leading-relaxed">{sc.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
                      <span className={`font-bold uppercase ${sc.difficulty === 'beginner' ? 'text-green-600' : sc.difficulty === 'intermediate' ? 'text-amber-600' : 'text-red-600'}`}>{sc.difficulty}</span>
                      <span>· {sc.duration}</span>
                      <span>· {sc.steps.length} steps</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div className="bg-gradient-to-r from-aegis-500 to-aegis-400 h-2 rounded-full transition-all duration-500 ease-out" style={{ width: `${((step + 1) / sc.steps.length) * 100}%` }} />
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-400 font-mono font-bold">{step + 1}/{sc.steps.length}</span>
              </div>

              <div className="space-y-2">
                {sc.steps.map((s, i) => (
                  <div key={i} className={`p-3.5 rounded-xl flex gap-3 transition-all duration-300 ${i < step ? 'bg-green-50 dark:bg-green-950/10 border border-green-200 dark:border-green-800' : i === step ? 'bg-white dark:bg-gray-800 border-2 border-aegis-400 shadow-lg shadow-aegis-500/10' : 'bg-gray-50 dark:bg-gray-800/50 opacity-35 border border-transparent'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold transition-all ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-aegis-600 text-white shadow-md shadow-aegis-500/30' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                      {i < step ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <p className="text-xs leading-relaxed pt-1">{s}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-5">
                {step > 0 && <button onClick={() => setStep(s => s - 1)} className="px-5 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium">← Prev</button>}
                {step < sc.steps.length - 1 ? (
                  <button onClick={() => setStep(s => s + 1)} className="flex-1 py-2.5 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-500 hover:to-aegis-600 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-aegis-600/20">Next Step →</button>
                ) : (
                  <button onClick={() => completeScenario(sc.id)} className="flex-1 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-600/20 flex items-center justify-center gap-2">
                    <CheckCircle className="w-4 h-4" /> {completedScenarios.has(sc.id) ? 'Mark Complete Again' : 'Complete Scenario'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* KIT TAB */}
          {tab === 'kit' && (
            <div>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {(['essential', 'important', 'recommended'] as const).map(priority => {
                  const items = EMERGENCY_KIT_ITEMS.filter(i => i.priority === priority)
                  const checked = items.filter(i => kitChecked.has(i.item)).length
                  const pct = checked / items.length
                  const cfg = priority === 'essential' ? { color: '#ef4444', label: t('prep.kit.essential', lang), bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-100 dark:border-red-900/50' }
                    : priority === 'important' ? { color: '#f59e0b', label: t('prep.kit.important', lang), bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-100 dark:border-amber-900/50' }
                    : { color: '#22c55e', label: t('prep.kit.recommended', lang), bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-100 dark:border-green-900/50' }
                  return (
                    <div key={priority} className={`${cfg.bg} border ${cfg.border} rounded-xl p-3 text-center`}>
                      <div className="relative mx-auto w-fit">
                        <MiniRing pct={pct} size={40} color={cfg.color} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[9px] font-black" style={{ color: cfg.color }}>{checked}</span>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-gray-600 dark:text-gray-400 mt-1.5 capitalize">{cfg.label}</div>
                      <div className="text-[9px] text-gray-400 dark:text-gray-400">{checked}/{items.length}</div>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${kitPct >= 1 ? 'bg-gradient-to-r from-green-500 to-emerald-400' : kitPct >= 0.5 ? 'bg-gradient-to-r from-aegis-500 to-blue-400' : 'bg-gradient-to-r from-amber-500 to-orange-400'}`} style={{ width: `${kitPct * 100}%` }} />
                </div>
                <span className="text-xs font-bold text-gray-600 dark:text-gray-400 tabular-nums">{Math.round(kitPct * 100)}%</span>
              </div>

              <p className="text-[11px] text-gray-400 dark:text-gray-400 mb-3">Store in a waterproof bag, accessible to all household members.</p>

              <div className="space-y-3">
                {(['essential', 'important', 'recommended'] as const).map(priority => {
                  const items = EMERGENCY_KIT_ITEMS.filter(i => i.priority === priority)
                  return (
                    <div key={priority}>
                      <h4 className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${priority === 'essential' ? 'text-red-600' : priority === 'important' ? 'text-amber-600' : 'text-green-600'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${priority === 'essential' ? 'bg-red-500' : priority === 'important' ? 'bg-amber-500' : 'bg-green-500'}`} />
                        {priority === 'essential' ? t('prep.kit.essential', lang) : priority === 'important' ? t('prep.kit.important', lang) : t('prep.kit.recommended', lang)}
                        <span className="text-gray-300 dark:text-gray-400 font-normal">({items.filter(i => kitChecked.has(i.item)).length}/{items.length})</span>
                      </h4>
                      <div className="space-y-0.5">
                        {items.map(item => (
                          <label key={item.item} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer group transition-colors">
                            <input type="checkbox" checked={kitChecked.has(item.item)} onChange={() => handleKitToggle(item.item)} className="w-4 h-4 rounded accent-aegis-600 flex-shrink-0" />
                            {(() => { const IC = ICON_MAP[item.icon]; return IC ? <IC className="w-4 h-4 text-gray-500 flex-shrink-0" /> : null })()}
                            <span className={`text-xs flex-1 leading-tight transition-all ${kitChecked.has(item.item) ? 'line-through text-gray-400 dark:text-gray-400' : 'text-gray-700 dark:text-gray-400'}`}>{item.item}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {kitPct >= 1 && (
                <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border border-green-200 dark:border-green-800 rounded-xl text-center">
                  <div className="flex items-center justify-center gap-2 mb-1.5"><Shield className="w-7 h-7 text-green-600" /><CheckCircle className="w-7 h-7 text-green-600" /></div>
                  <p className="text-sm font-bold text-green-700 dark:text-green-400">Your emergency kit is complete!</p>
                  <p className="text-[11px] text-green-600/70 mt-0.5">Review every 6 months and replace expired items.</p>
                </div>
              )}
            </div>
          )}

          {/* QUIZ TAB — PRE-START */}
          {tab === 'quiz' && !quizStarted && (
            <div className="text-center py-2">
              <div className="relative mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-aegis-500 to-purple-600 flex items-center justify-center mb-4 shadow-xl shadow-aegis-500/20">
                <BookOpen className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-extrabold mb-1">Emergency Knowledge Quiz</h3>
              <p className="text-sm text-gray-400 dark:text-gray-400 mb-4">{ALL_QUIZ.length} questions across all disaster types</p>

              {bestQuizScore && (
                <div className="mb-4 inline-flex items-center gap-3 p-3 bg-aegis-50 dark:bg-aegis-950/20 border border-aegis-200 dark:border-aegis-800 rounded-xl">
                  <div className="relative">
                    <MiniRing pct={bestQuizScore.score / bestQuizScore.total} size={40} color="#6366f1" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Trophy className="w-3.5 h-3.5 text-aegis-600" />
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] text-gray-400 dark:text-gray-400">Personal Best</p>
                    <p className="text-sm font-bold text-aegis-600">{bestQuizScore.score}/{bestQuizScore.total} <span className="text-xs font-normal text-gray-400 dark:text-gray-400">({Math.round((bestQuizScore.score / bestQuizScore.total) * 100)}%)</span></p>
                  </div>
                </div>
              )}

              <div className="mb-5">
                <p className="text-xs text-gray-400 dark:text-gray-400 mb-2 flex items-center gap-1 justify-center"><Filter className="w-3 h-3" /> Filter by category</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {['all', 'flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general'].map(cat => (
                    <button key={cat} onClick={() => setQuizFilter(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${quizFilter === cat ? 'bg-aegis-600 text-white shadow-md shadow-aegis-600/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                      {cat === 'all' ? `All (${ALL_QUIZ.length})` : `${cat} (${ALL_QUIZ.filter(q => q.category === cat).length})`}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={startQuiz} className="px-8 py-3 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-500 hover:to-aegis-600 text-white font-bold rounded-xl text-sm transition-all shadow-xl shadow-aegis-600/20 flex items-center gap-2 mx-auto">
                <Play className="w-4 h-4" /> Start Quiz ({filteredQuiz.length} questions)
              </button>
            </div>
          )}

          {/* QUIZ TAB — IN PROGRESS */}
          {tab === 'quiz' && quizStarted && !quizDone && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400">Q{quizQ + 1}<span className="text-gray-300 dark:text-gray-400">/{filteredQuiz.length}</span></span>
                  <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold capitalize ${filteredQuiz[quizQ].category === 'flood' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : filteredQuiz[quizQ].category === 'fire' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : filteredQuiz[quizQ].category === 'storm' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : filteredQuiz[quizQ].category === 'earthquake' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : filteredQuiz[quizQ].category === 'heatwave' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'}`}>{filteredQuiz[quizQ].category}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-aegis-50 dark:bg-aegis-950/20 px-2.5 py-1 rounded-lg">
                  <Star className="w-3 h-3 text-aegis-500" />
                  <span className="text-xs font-bold text-aegis-600">{quizScore}</span>
                </div>
              </div>

              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 mb-5">
                <div className="bg-gradient-to-r from-aegis-500 to-purple-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${((quizQ + 1) / filteredQuiz.length) * 100}%` }} />
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl p-4 mb-4">
                <h3 className="font-bold text-sm leading-relaxed">{filteredQuiz[quizQ].q}</h3>
              </div>

              <div className="space-y-2 mb-3">
                {filteredQuiz[quizQ].opts.map((opt, i) => (
                  <button key={i} disabled={quizAnswer !== null} onClick={() => answerQuiz(i)}
                    className={`w-full p-3.5 rounded-xl border-2 text-left text-sm font-medium transition-all ${quizAnswer === null ? 'border-gray-100 dark:border-gray-800 hover:border-aegis-300 hover:bg-aegis-50/50 dark:hover:bg-aegis-950/20 hover:shadow-md' : i === filteredQuiz[quizQ].correct ? 'border-green-400 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-200' : quizAnswer === i ? 'border-red-400 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200' : 'border-gray-100 dark:border-gray-800 opacity-30'}`}>
                    <span className="inline-flex w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-700 items-center justify-center text-[10px] font-bold text-gray-500 dark:text-gray-400 mr-2.5">{String.fromCharCode(65 + i)}</span>{opt}
                  </button>
                ))}
              </div>

              {showExplanation && (
                <div className={`p-3.5 rounded-xl text-xs animate-fade-in ${quizAnswer === filteredQuiz[quizQ].correct ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'}`}>
                  <span className="font-bold">{quizAnswer === filteredQuiz[quizQ].correct ? '✓ Correct! ' : '✗ Incorrect. '}</span>{filteredQuiz[quizQ].explanation}
                </div>
              )}
            </div>
          )}

          {/* QUIZ TAB — RESULTS */}
          {tab === 'quiz' && quizDone && (
            <div className="text-center py-4 animate-fade-in">
              <div className="relative mx-auto w-fit mb-4">
                <ReadinessRing pct={Math.round((quizScore / filteredQuiz.length) * 100)} size={110} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-gray-800 dark:text-white">{quizScore}</span>
                  <span className="text-[9px] text-gray-400 dark:text-gray-400 font-bold">/ {filteredQuiz.length}</span>
                </div>
              </div>
              <div className="text-3xl mb-2">{quizScore / filteredQuiz.length >= 0.8 ? <Sparkles className="w-8 h-8 text-yellow-500 mx-auto" /> : quizScore / filteredQuiz.length >= 0.5 ? <ThumbsUp className="w-8 h-8 text-blue-500 mx-auto" /> : <BookOpen className="w-8 h-8 text-purple-500 mx-auto" />}</div>
              <h3 className="text-xl font-extrabold mb-1">{quizScore / filteredQuiz.length >= 0.8 ? 'Excellent!' : quizScore / filteredQuiz.length >= 0.5 ? 'Good effort!' : 'Keep learning!'}</h3>
              <p className="text-sm text-gray-400 dark:text-gray-400 mb-1">{Math.round((quizScore / filteredQuiz.length) * 100)}% correct</p>
              {bestQuizScore && <p className="text-xs text-aegis-600 mb-5">Personal best: {bestQuizScore.score}/{bestQuizScore.total}</p>}

              <div className="flex gap-2 justify-center flex-wrap">
                <button onClick={startQuiz} className="px-6 py-2.5 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-500 hover:to-aegis-600 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-aegis-600/20 flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Try Again
                </button>
                <button onClick={() => { setQuizStarted(false); setQuizDone(false) }} className="px-6 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Change Category
                </button>
              </div>
            </div>
          )}

          {/* FAMILY PLAN TAB */}
          {tab === 'plan' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-blue-700 dark:text-blue-300 font-bold">Family Emergency Plan</p>
                  <p className="text-[10px] text-blue-600/60 dark:text-blue-400/50 mt-0.5">Ensures everyone knows what to do. Saved locally on this device only.</p>
                </div>
                <div className="flex-shrink-0">
                  <MiniRing pct={planPct} size={32} color="#3b82f6" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { key: 'meeting', label: 'Meeting Point', icon: <Target className="w-3.5 h-3.5" />, hint: 'Where will your family meet if you cannot go home?' },
                  { key: 'contact', label: 'Out-of-Area Contact', icon: <Users className="w-3.5 h-3.5" />, hint: 'Name & phone of someone outside your area' },
                  { key: 'medical', label: 'Medical Needs', icon: <Heart className="w-3.5 h-3.5" />, hint: 'Medications, conditions, or special needs' },
                  { key: 'pets', label: 'Pet Plan', icon: <Shield className="w-3.5 h-3.5" />, hint: 'Who is responsible for pets? Where will they shelter?' },
                  { key: 'evacRoute', label: 'Evacuation Route', icon: <ArrowRight className="w-3.5 h-3.5" />, hint: 'Primary and alternate routes out of your area' },
                  { key: 'shelter', label: 'Emergency Shelter', icon: <Shield className="w-3.5 h-3.5" />, hint: 'Nearest shelter or safe location if home is unsafe' },
                  { key: 'utilities', label: 'Utilities Plan', icon: <Zap className="w-3.5 h-3.5" />, hint: 'Who knows how to turn off gas, electricity, water?' },
                  { key: 'comms', label: 'Communication Plan', icon: <AlertCircle className="w-3.5 h-3.5" />, hint: 'If phones are down: check-in times, phone boxes, etc.' },
                ].map(({ key, label, icon, hint }) => {
                  const filled = (familyPlan[key] || '').trim().length > 0
                  return (
                    <div key={key} className={`rounded-xl border p-3 transition-all ${filled ? 'bg-white dark:bg-gray-900 border-green-200 dark:border-green-800/50' : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${filled ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-400'}`}>
                          {filled ? <CheckCircle className="w-3.5 h-3.5" /> : icon}
                        </div>
                        <label className="text-xs font-bold text-gray-700 dark:text-gray-400">{label}</label>
                      </div>
                      <textarea
                        value={familyPlan[key] || ''}
                        onChange={e => updatePlan(key, e.target.value)}
                        placeholder={hint}
                        rows={2}
                        className="w-full text-xs border border-gray-100 dark:border-gray-800 rounded-lg p-2.5 bg-gray-50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-aegis-400 focus:border-transparent resize-none transition-all"
                      />
                    </div>
                  )
                })}
              </div>

              <p className="text-center text-[11px] text-gray-300 dark:text-gray-400 pt-2">Print or screenshot this page to share with your household.</p>
            </div>
          )}

          {/* BADGES TAB */}
          {tab === 'badges' && (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
                {[
                  { label: 'Scenarios', value: completedScenarios.size, sub: `of ${PREPAREDNESS_SCENARIOS.length}`, pct: scenarioPct, color: '#8b5cf6' },
                  { label: 'Quiz Best', value: bestQuizScore ? `${Math.round(quizPct * 100)}%` : '—', sub: 'score', pct: quizPct, color: '#06b6d4' },
                  { label: 'Kit Ready', value: `${Math.round(kitPct * 100)}%`, sub: 'checked', pct: kitPct, color: '#22c55e' },
                  { label: 'Badges', value: unlockedBadges.length, sub: `of ${BADGES.length}`, pct: unlockedBadges.length / BADGES.length, color: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl p-3 text-center">
                    <div className="relative mx-auto w-fit mb-1.5">
                      <MiniRing pct={s.pct} size={36} color={s.color} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] font-black" style={{ color: s.color }}>{s.value}</span>
                      </div>
                    </div>
                    <div className="text-[10px] font-bold text-gray-600 dark:text-gray-400">{s.label}</div>
                    <div className="text-[9px] text-gray-300 dark:text-gray-400">{s.sub}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {BADGES.map(badge => {
                  const earned = badge.condition(completedScenarios, bestQuizScore?.score ?? 0, bestQuizScore?.total ?? 1, kitPct)
                  return (
                    <div key={badge.id} className={`text-center rounded-xl p-3.5 transition-all ${earned ? 'bg-gradient-to-br from-aegis-50 via-white to-purple-50 dark:from-aegis-950/30 dark:via-gray-900 dark:to-purple-950/20 border-2 border-aegis-200 dark:border-aegis-700 shadow-lg shadow-aegis-500/10' : 'bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 opacity-50 grayscale'}`}>
                      <div className={`flex items-center justify-center mb-2 ${earned ? 'drop-shadow-lg' : ''}`}>{(() => { const IC = earned ? ICON_MAP[badge.icon] : Lock; return IC ? <IC className="w-8 h-8" /> : null })()}</div>
                      <div className="text-xs font-bold text-gray-800 dark:text-gray-200 leading-tight">{badge.label}</div>
                      <div className="text-[9px] text-gray-400 dark:text-gray-300 mt-0.5 leading-tight">{badge.desc}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-300 dark:text-gray-400">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            AEGIS Preparedness Engine
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-300 dark:text-gray-400">
            <Award className="w-3 h-3" />
            {unlockedBadges.length}/{BADGES.length} badges earned
          </div>
        </div>
      </div>
    </div>
  )
}

