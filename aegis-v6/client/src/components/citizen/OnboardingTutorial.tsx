/**
 * Module: OnboardingTutorial.tsx
 *
 * Onboarding tutorial citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, Shield, AlertTriangle, MessageCircle, Users, BookOpen, MapPin, Accessibility, Sparkles, Check } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

const STEPS = [
  { icon: Shield, title: 'Welcome to AEGIS', desc: 'Your emergency intelligence assistant. No login needed. Everything is anonymous and private.', color: 'from-aegis-600 to-aegis-700', tip: 'Your location is only collected when you submit a report — never in the background.' },
  { icon: AlertTriangle, title: 'Report Emergencies', desc: 'Tap the red "Report" button to submit an emergency. Just describe what you see — AI verifies it automatically.', color: 'from-red-500 to-red-700', tip: 'Reports are anonymous. You can attach photos and pin a location on the map.' },
  { icon: MapPin, title: 'Live Map', desc: 'See real-time reports and flood zones on the interactive map. Red = severe, amber = moderate, blue = low risk.', color: 'from-blue-500 to-blue-700', tip: 'Switch between satellite, topographic, and dark map styles with the tile picker.' },
  { icon: MessageCircle, title: 'AI Assistant', desc: 'Chat with our AI for safety guidance in 9 languages. It covers floods, earthquakes, fires, storms, and more.', color: 'from-purple-500 to-purple-700', tip: 'The chatbot works offline too — it switches to a rule-based fallback when there\'s no internet.' },
  { icon: Users, title: 'Community Help', desc: 'Find local resources, offer help, or request assistance. All anonymous with safety controls.', color: 'from-green-500 to-green-700', tip: 'Community posts are moderated by AI and human operators for your safety.' },
  { icon: BookOpen, title: 'Be Prepared', desc: 'Interactive scenarios, quizzes, and emergency kit checklists to help you prepare before disaster strikes.', color: 'from-amber-500 to-amber-700', tip: 'Complete drills and quizzes to earn badges and track your readiness score.' },
  { icon: Accessibility, title: 'Accessibility', desc: 'Tap the floating button (bottom-left) for screen reader, high contrast, large text, dyslexia mode and more.', color: 'from-cyan-500 to-cyan-700', tip: 'Seven accessibility modes available. Works with screen readers and keyboard navigation.' },
]

export default function OnboardingTutorial(): JSX.Element | null {
  const lang = useLanguage()
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [animating, setAnimating] = useState(false)
  const [progress, setProgress] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const seen = localStorage.getItem('aegis-onboarding-done')
    if (!seen) setShow(true)
  }, [])

  // Auto-progress bar (8 seconds per step)
  useEffect(() => {
    if (!show) return
    setProgress(0)
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min((elapsed / 8000) * 100, 100)
      setProgress(pct)
      if (pct >= 100) {
        if (timerRef.current) clearInterval(timerRef.current)
        if (step < STEPS.length - 1) goNext()
      }
    }, 50)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [step, show])

  const dismiss = useCallback((): void => {
    setShow(false)
    localStorage.setItem('aegis-onboarding-done', 'true')
  }, [])

  const goNext = useCallback((): void => {
    if (animating || step >= STEPS.length - 1) return
    setDirection('next')
    setAnimating(true)
    setTimeout(() => { setStep(s => s + 1); setAnimating(false) }, 250)
  }, [animating, step])

  const goPrev = useCallback((): void => {
    if (animating || step <= 0) return
    setDirection('prev')
    setAnimating(true)
    setTimeout(() => { setStep(s => s - 1); setAnimating(false) }, 250)
  }, [animating, step])

  // Keyboard navigation
  useEffect(() => {
    if (!show) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [show, goNext, goPrev, dismiss])

  if (!show) return null
  const s = STEPS[step]
  const Icon = s.icon

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true" aria-label="Onboarding tutorial">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-enter">

        {/* Header with gradient + icon */}
        <div className={`bg-gradient-to-br ${s.color} p-7 flex flex-col items-center text-white relative overflow-hidden`}>
          {/* Decorative circles */}
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-white/5" />

          {/* Close button */}
          <button onClick={dismiss} className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/20 transition text-white/70 hover:text-white" aria-label={t('common.close', lang)}>
            <X className="w-4 h-4" />
          </button>

          {/* Step counter */}
          <span className="text-xs font-medium bg-white/20 px-2.5 py-0.5 rounded-full mb-3">
            {step + 1} / {STEPS.length}
          </span>

          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-3 shadow-lg">
            <Icon className="w-9 h-9 drop-shadow" />
          </div>
          <h2 className="text-xl font-bold text-center drop-shadow">{s.title}</h2>

          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div className="h-full bg-white/60 transition-all duration-100 ease-linear" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Body with animation */}
        <div className="p-6">
          <div
            className={`transition-all duration-250 ${
              animating
                ? direction === 'next' ? 'opacity-0 translate-x-8' : 'opacity-0 -translate-x-8'
                : 'opacity-100 translate-x-0'
            }`}
          >
            <p className="text-sm text-gray-600 dark:text-gray-300 text-center leading-relaxed mb-3">{s.desc}</p>

            {/* Pro tip callout */}
            <div className="flex items-start gap-2 bg-aegis-50 dark:bg-aegis-950/30 rounded-lg px-3 py-2.5 border border-aegis-100 dark:border-aegis-900/50">
              <Sparkles className="w-4 h-4 text-aegis-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-aegis-700 dark:text-aegis-300 leading-relaxed">{s.tip}</p>
            </div>
          </div>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-2 my-5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => { setDirection(i > step ? 'next' : 'prev'); setAnimating(true); setTimeout(() => { setStep(i); setAnimating(false) }, 250) }}
                className={`transition-all duration-300 rounded-full ${
                  i === step
                    ? 'w-6 h-2.5 bg-aegis-600'
                    : i < step
                    ? 'w-2.5 h-2.5 bg-aegis-300 dark:bg-aegis-700'
                    : 'w-2.5 h-2.5 bg-gray-300 dark:bg-gray-600'
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={goPrev} className="btn-ghost flex items-center gap-1 text-xs px-3">
                <ChevronLeft className="w-3.5 h-3.5" /> {t('common.back', lang) || 'Back'}
              </button>
            )}
            {step === 0 && (
              <button onClick={dismiss} className="btn-ghost flex-1 text-xs">{t('common.skip', lang)}</button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={goNext} className="btn-primary btn-ripple flex-1 flex items-center justify-center gap-1 text-xs">
                {t('common.next', lang) || 'Next'} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button onClick={dismiss} className="btn-primary btn-ripple w-full flex items-center justify-center gap-1.5">
                <Check className="w-4 h-4" /> {t('common.getStarted', lang)}
              </button>
            )}
          </div>

          {/* Keyboard hint */}
          <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center mt-3">
            Use ← → arrow keys to navigate &middot; Esc to close
          </p>
        </div>
      </div>
    </div>
  )
}

