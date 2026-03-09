import { useState, useEffect, useRef } from 'react'
import { X, BookOpen, Shield, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Play, RotateCcw, Trophy, Users, Clock, Star, Flame, Waves, Wind, Zap, Thermometer, AlertCircle, Filter, Timer } from 'lucide-react'
import { PREPAREDNESS_TIPS, PREPAREDNESS_SCENARIOS, EMERGENCY_KIT_ITEMS, ALL_QUIZ, BADGES } from '../../data/preparedness'
import { useAlerts } from '../../contexts/AlertsContext'
import { t } from '../../utils/i18n'

interface Props { onClose: () => void; lang?: string; isEmergencyActive?: boolean }

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
    if (quizAnswer !== null) return
    setQuizAnswer(i)
    const isCorrect = i === filteredQuiz[quizQ].correct
    if (isCorrect) setQuizScore(s => s + 1)
    setShowExplanation(true)
    setTimeout(() => {
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
    const medal = drillSeconds < 120 ? '🥇 Fast' : drillSeconds < 300 ? '🥈 Good' : '🥉 Done'
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
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[94vh] overflow-y-auto">

        {/* Header */}
        <div className="bg-gradient-to-r from-aegis-800 to-aegis-600 text-white p-4 rounded-t-2xl flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><BookOpen className="w-5 h-5" /> {t('prep.title', lang)}</h2>
            <p className="text-[10px] text-aegis-200 mt-0.5">
              {completedScenarios.size}/{PREPAREDNESS_SCENARIOS.length} {t('prep.scenarios.count', lang)} · {kitChecked.size}/{EMERGENCY_KIT_ITEMS.length} {t('prep.kit.count', lang)} · {unlockedBadges.length} {t('prep.badges.earned', lang)}
            </p>
          </div>
          <button onClick={onClose} className="hover:bg-aegis-700 p-2 rounded-lg transition-colors" aria-label={t('general.close', lang)}><X className="w-5 h-5" /></button>
        </div>

        {isEmergencyActive && (
          <div className="mx-3 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">{t('prep.emergencyActive', lang)}</p>
          </div>
        )}

        <div className="p-4">
          {/* Tabs */}
          <div className="flex gap-1 mb-4 overflow-x-auto pb-1 flex-nowrap">
            {tabConfig.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all ${tab === id ? 'bg-aegis-600 text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <Icon className="w-3.5 h-3.5 flex-shrink-0" /> {label}
              </button>
            ))}
          </div>

          {/* ── TIPS TAB ── */}
          {tab === 'tips' && (
            <div className="space-y-2">
              {PREPAREDNESS_TIPS.map(tip => (
                <div key={tip.category} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <button onClick={() => setExpanded(expanded === tip.category ? null : tip.category)}
                    className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <div className="flex items-center gap-2"><span className="text-xl">{tip.icon}</span><h3 className="font-semibold text-sm">{tip.title}</h3></div>
                    {expanded === tip.category ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                  {expanded === tip.category && (
                    <div className="px-3 pb-3 animate-fade-in border-t border-gray-100 dark:border-gray-800 pt-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {(['before', 'during', 'after'] as const).map(ph => (
                          <div key={ph} className={`rounded-xl p-3 ${ph === 'before' ? 'bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900' : ph === 'during' ? 'bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900' : 'bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900'}`}>
                            <h4 className={`font-bold text-xs mb-2 uppercase tracking-wider ${ph === 'before' ? 'text-blue-700 dark:text-blue-400' : ph === 'during' ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{ph === 'before' ? `⚡ ${t('prep.phase.before', lang)}` : ph === 'during' ? `🚨 ${t('prep.phase.during', lang)}` : `✅ ${t('prep.phase.after', lang)}`}</h4>
                            <ul className="space-y-1.5">
                              {tip[ph].map((item, i) => (
                                <li key={i} className="text-[11px] text-gray-700 dark:text-gray-300 flex gap-1.5 leading-snug">
                                  <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>{item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      {/* Scenarios shortcut */}
                      <button onClick={() => { setTab('scenarios') }} className="mt-3 text-xs text-aegis-600 dark:text-aegis-400 underline hover:no-underline flex items-center gap-1">
                        <Play className="w-3 h-3" /> Practice {tip.title} scenarios →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── SCENARIOS TAB ── */}
          {tab === 'scenarios' && !scenario && (
            <div>
              <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
                  <div className="text-lg font-bold text-aegis-600">{completedScenarios.size}</div>
                  <div>Completed</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
                  <div className="text-lg font-bold text-gray-400">{PREPAREDNESS_SCENARIOS.length - completedScenarios.size}</div>
                  <div>Remaining</div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PREPAREDNESS_SCENARIOS.map(s => {
                  const done = completedScenarios.has(s.id)
                  return (
                    <button key={s.id} onClick={() => { setScenario(s.id); setStep(0); setDrillSeconds(0); setDrillActive(false) }}
                      className={`text-left rounded-xl border-2 p-3 transition-all hover:shadow-md ${done ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/20' : 'border-gray-200 dark:border-gray-700 hover:border-aegis-300'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">{done ? '✅' : DISASTER_ICONS[s.disasterType] || '🛡️'}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.difficulty === 'beginner' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : s.difficulty === 'intermediate' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>{s.difficulty}</span>
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5 ml-auto"><Clock className="w-2.5 h-2.5" /> {s.duration}</span>
                      </div>
                      <h3 className="font-bold text-sm leading-tight">{s.title}</h3>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{s.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'scenarios' && sc && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => { setScenario(null); if (drillRef.current) clearInterval(drillRef.current); setDrillActive(false) }} className="text-xs text-gray-500 hover:text-aegis-600 flex items-center gap-1">← Back to Scenarios</button>
                {!drillActive ? (
                  <button onClick={startDrill} className="flex items-center gap-1.5 px-3 py-1.5 bg-aegis-600 text-white text-xs rounded-lg hover:bg-aegis-700 transition-colors"><Timer className="w-3 h-3" /> Start Drill Timer</button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs font-mono bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1.5 rounded-lg">
                    <Timer className="w-3 h-3" /> {Math.floor(drillSeconds / 60).toString().padStart(2, '0')}:{(drillSeconds % 60).toString().padStart(2, '0')}
                  </div>
                )}
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 mb-4">
                <h3 className="font-bold text-sm mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />{sc.title}</h3>
                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{sc.description}</p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                  <span className={`font-bold ${sc.difficulty === 'beginner' ? 'text-green-600' : sc.difficulty === 'intermediate' ? 'text-amber-600' : 'text-red-600'}`}>{sc.difficulty.toUpperCase()}</span>
                  <span>· {sc.duration}</span>
                  <span>· {sc.steps.length} steps</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-aegis-500 h-2 rounded-full transition-all duration-500" style={{ width: `${((step + 1) / sc.steps.length) * 100}%` }} />
                </div>
                <span className="text-[10px] text-gray-400 font-mono">{step + 1}/{sc.steps.length}</span>
              </div>

              <div className="space-y-2">
                {sc.steps.map((s, i) => (
                  <div key={i} className={`p-3 rounded-xl flex gap-3 transition-all duration-300 ${i < step ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800' : i === step ? 'bg-aegis-50 dark:bg-aegis-950/20 border-2 border-aegis-400 shadow-sm' : 'bg-gray-50 dark:bg-gray-800 opacity-40 border border-transparent'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-aegis-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-400'}`}>{i < step ? '✓' : i + 1}</div>
                    <p className="text-xs leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-4">
                {step < sc.steps.length - 1 ? (
                  <button onClick={() => setStep(s => s + 1)} className="flex-1 py-2.5 bg-aegis-600 hover:bg-aegis-700 text-white text-sm font-semibold rounded-xl transition-colors">Next Step →</button>
                ) : (
                  <button onClick={() => completeScenario(sc.id)} className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2">
                    <CheckCircle className="w-4 h-4" /> {completedScenarios.has(sc.id) ? 'Mark Complete Again' : 'Complete Scenario'}
                  </button>
                )}
                {step > 0 && <button onClick={() => setStep(s => s - 1)} className="px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">← Prev</button>}
              </div>
            </div>
          )}

          {/* ── KIT TAB ── */}
          {tab === 'kit' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-bold text-sm">Emergency Kit Checklist</h3>
                  <p className="text-[11px] text-gray-500">Store in a waterproof bag, accessible to all household members</p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-aegis-600">{kitChecked.size}/{EMERGENCY_KIT_ITEMS.length}</div>
                  <div className="text-[10px] text-gray-400">{Math.round(kitPct * 100)}% ready</div>
                </div>
              </div>
              <div className="relative w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mb-4 overflow-hidden">
                <div className={`h-3 rounded-full transition-all duration-500 ${kitPct >= 1 ? 'bg-green-500' : kitPct >= 0.5 ? 'bg-aegis-500' : 'bg-amber-500'}`} style={{ width: `${kitPct * 100}%` }} />
              </div>
              <div className="space-y-1.5">
                {(['essential', 'important', 'recommended'] as const).map(priority => {
                  const items = EMERGENCY_KIT_ITEMS.filter(i => i.priority === priority)
                  return (
                    <div key={priority}>
                      <h4 className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 mt-2 ${priority === 'essential' ? 'text-red-600' : priority === 'important' ? 'text-amber-600' : 'text-gray-500'}`}>
                        {priority === 'essential' ? `🔴 ${t('prep.kit.essential', lang)}` : priority === 'important' ? `🟡 ${t('prep.kit.important', lang)}` : `🟢 ${t('prep.kit.recommended', lang)}`}
                      </h4>
                      {items.map(item => (
                        <label key={item.item} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer group transition-colors">
                          <input type="checkbox" checked={kitChecked.has(item.item)} onChange={() => handleKitToggle(item.item)} className="w-4 h-4 rounded accent-aegis-600" />
                          <span className="text-base flex-shrink-0">{item.icon}</span>
                          <span className={`text-xs flex-1 leading-tight ${kitChecked.has(item.item) ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>{item.item}</span>
                        </label>
                      ))}
                    </div>
                  )
                })}
              </div>
              {kitPct >= 1 && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl text-center">
                  <div className="text-2xl mb-1">🎒✅</div>
                  <p className="text-sm font-bold text-green-700 dark:text-green-400">Your emergency kit is complete!</p>
                  <p className="text-[11px] text-green-600 dark:text-green-500 mt-0.5">Review it every 6 months and replace expired items.</p>
                </div>
              )}
            </div>
          )}

          {/* ── QUIZ TAB ── */}
          {tab === 'quiz' && !quizStarted && (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">🧠</div>
              <h3 className="text-lg font-bold mb-1">Emergency Knowledge Quiz</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{ALL_QUIZ.length} questions across all disaster types</p>
              {bestQuizScore && (
                <div className="mb-4 p-3 bg-aegis-50 dark:bg-aegis-950/20 border border-aegis-200 dark:border-aegis-800 rounded-xl inline-block">
                  <p className="text-xs text-gray-500">Best score</p>
                  <p className="text-xl font-bold text-aegis-600">{bestQuizScore.score}/{bestQuizScore.total} <span className="text-sm font-normal text-gray-400">({Math.round((bestQuizScore.score / bestQuizScore.total) * 100)}%)</span></p>
                </div>
              )}
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2 flex items-center gap-1 justify-center"><Filter className="w-3 h-3" /> Filter by category</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {['all', 'flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general'].map(cat => (
                    <button key={cat} onClick={() => setQuizFilter(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${quizFilter === cat ? 'bg-aegis-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                      {cat === 'all' ? `All (${ALL_QUIZ.length})` : `${cat} (${ALL_QUIZ.filter(q => q.category === cat).length})`}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={startQuiz} className="px-8 py-3 bg-aegis-600 hover:bg-aegis-700 text-white font-semibold rounded-xl text-sm transition-colors flex items-center gap-2 mx-auto">
                <Play className="w-4 h-4" /> Start Quiz ({filteredQuiz.length} questions)
              </button>
            </div>
          )}

          {tab === 'quiz' && quizStarted && !quizDone && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">Question {quizQ + 1}/{filteredQuiz.length}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold text-aegis-600">Score: {quizScore}</p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium capitalize ${filteredQuiz[quizQ].category === 'flood' ? 'bg-blue-100 text-blue-700' : filteredQuiz[quizQ].category === 'fire' ? 'bg-red-100 text-red-700' : filteredQuiz[quizQ].category === 'storm' ? 'bg-purple-100 text-purple-700' : filteredQuiz[quizQ].category === 'earthquake' ? 'bg-orange-100 text-orange-700' : filteredQuiz[quizQ].category === 'heatwave' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>{filteredQuiz[quizQ].category}</span>
                </div>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4">
                <div className="bg-aegis-500 h-2 rounded-full transition-all duration-300" style={{ width: `${((quizQ + 1) / filteredQuiz.length) * 100}%` }} />
              </div>
              <h3 className="font-bold text-sm mb-4 leading-relaxed">{filteredQuiz[quizQ].q}</h3>
              <div className="space-y-2 mb-3">
                {filteredQuiz[quizQ].opts.map((opt, i) => (
                  <button key={i} disabled={quizAnswer !== null} onClick={() => answerQuiz(i)}
                    className={`w-full p-3 rounded-xl border-2 text-left text-sm font-medium transition-all ${quizAnswer === null ? 'border-gray-200 dark:border-gray-700 hover:border-aegis-400 hover:bg-aegis-50 dark:hover:bg-aegis-950/20' : i === filteredQuiz[quizQ].correct ? 'border-green-500 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-200' : quizAnswer === i ? 'border-red-500 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200' : 'border-gray-200 dark:border-gray-700 opacity-40'}`}>
                    <span className="mr-2 font-bold text-gray-400 text-xs">{String.fromCharCode(65 + i)}.</span>{opt}
                  </button>
                ))}
              </div>
              {showExplanation && (
                <div className={`p-3 rounded-xl text-xs animate-fade-in ${quizAnswer === filteredQuiz[quizQ].correct ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'}`}>
                  <span className="font-bold">{quizAnswer === filteredQuiz[quizQ].correct ? '✓ Correct! ' : '✗ Incorrect. '}</span>{filteredQuiz[quizQ].explanation}
                </div>
              )}
            </div>
          )}

          {tab === 'quiz' && quizDone && (
            <div className="text-center py-6 animate-fade-in">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 ${quizScore / filteredQuiz.length >= 0.8 ? 'bg-green-100 text-green-600' : quizScore / filteredQuiz.length >= 0.5 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}`}>
                <span className="text-2xl font-bold">{quizScore}/{filteredQuiz.length}</span>
              </div>
              <div className="text-3xl mb-2">{quizScore / filteredQuiz.length >= 0.8 ? '🎉' : quizScore / filteredQuiz.length >= 0.5 ? '👍' : '📚'}</div>
              <h3 className="text-xl font-bold mb-1">{quizScore / filteredQuiz.length >= 0.8 ? 'Excellent!' : quizScore / filteredQuiz.length >= 0.5 ? 'Good effort!' : 'Keep learning!'}</h3>
              <p className="text-sm text-gray-500 mb-1">{Math.round((quizScore / filteredQuiz.length) * 100)}% correct</p>
              {bestQuizScore && <p className="text-xs text-aegis-600 mb-4">Personal best: {bestQuizScore.score}/{bestQuizScore.total}</p>}
              <div className="flex gap-2 justify-center flex-wrap">
                <button onClick={startQuiz} className="px-6 py-2.5 bg-aegis-600 hover:bg-aegis-700 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Try Again
                </button>
                <button onClick={() => { setQuizStarted(false); setQuizDone(false) }} className="px-6 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Change Category
                </button>
              </div>
            </div>
          )}

          {/* ── FAMILY PLAN TAB ── */}
          {tab === 'plan' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                <p className="text-xs text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> A family emergency plan ensures everyone knows what to do when disaster strikes.</p>
                <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1">Your answers are saved locally on this device only.</p>
              </div>
              {[
                { key: 'meeting', label: '📍 Meeting Point', hint: 'Where will your family meet if you cannot go home? (e.g. school car park, church, neighbour)' },
                { key: 'contact', label: '📞 Out-of-Area Contact', hint: 'Name and phone number of someone outside your area to coordinate with' },
                { key: 'medical', label: '💊 Medical Needs', hint: 'Any medications, conditions, or special needs across your household' },
                { key: 'pets', label: '🐾 Pet Plan', hint: 'Who is responsible for pets? Where will they shelter?' },
                { key: 'evacRoute', label: '🗺️ Evacuation Route', hint: 'Primary and alternate routes out of your area' },
                { key: 'shelter', label: '🏠 Emergency Shelter', hint: 'Nearest emergency shelter or safe location if home is unsafe' },
                { key: 'utilities', label: '⚡ Utilities Plan', hint: 'Who knows how to turn off gas, electricity and water?' },
                { key: 'comms', label: '📡 Communication Plan', hint: 'If phones are down: scheduled check-in times, phone boxes, etc.' },
              ].map(({ key, label, hint }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                  <textarea
                    value={familyPlan[key] || ''}
                    onChange={e => updatePlan(key, e.target.value)}
                    placeholder={hint}
                    rows={2}
                    className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-aegis-400 resize-none"
                  />
                </div>
              ))}
              <div className="text-center pt-2">
                <p className="text-[11px] text-gray-400">Print or screenshot this page to share with your household.</p>
              </div>
            </div>
          )}

          {/* ── BADGES TAB ── */}
          {tab === 'badges' && (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <div className="text-center bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <div className="text-xl font-bold text-aegis-600">{completedScenarios.size}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Scenarios done</div>
                </div>
                <div className="text-center bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <div className="text-xl font-bold text-blue-600">{bestQuizScore ? `${Math.round((bestQuizScore.score / bestQuizScore.total) * 100)}%` : '—'}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Best quiz score</div>
                </div>
                <div className="text-center bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <div className="text-xl font-bold text-green-600">{Math.round(kitPct * 100)}%</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Kit prepared</div>
                </div>
                <div className="text-center bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <div className="text-xl font-bold text-amber-600">{unlockedBadges.length}/{BADGES.length}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Badges earned</div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {BADGES.map(badge => {
                  const earned = badge.condition(completedScenarios, bestQuizScore?.score ?? 0, bestQuizScore?.total ?? 1, kitPct)
                  return (
                    <div key={badge.id} className={`text-center rounded-xl p-3 transition-all ${earned ? 'bg-gradient-to-br from-aegis-50 to-blue-50 dark:from-aegis-950/30 dark:to-blue-950/30 border-2 border-aegis-200 dark:border-aegis-700 shadow-sm' : 'bg-gray-50 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 opacity-50'}`}>
                      <div className="text-3xl mb-1.5">{earned ? badge.icon : '🔒'}</div>
                      <div className="text-xs font-bold text-gray-800 dark:text-gray-200 leading-tight">{badge.label}</div>
                      <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">{badge.desc}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

