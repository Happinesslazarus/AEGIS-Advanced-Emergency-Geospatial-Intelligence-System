import { useState, useEffect } from 'react'
import { X, ChevronRight, Shield, AlertTriangle, MessageCircle, Users, BookOpen, MapPin, Accessibility } from 'lucide-react'

const STEPS = [
  { icon: Shield, title: 'Welcome to AEGIS', desc: 'Your emergency intelligence assistant. No login needed. Everything is anonymous and private.', color: 'bg-aegis-600' },
  { icon: AlertTriangle, title: 'Report Emergencies', desc: 'Tap the red "Report" button to submit an emergency. Just describe what you see — AI verifies it automatically.', color: 'bg-red-600' },
  { icon: MapPin, title: 'Live Map', desc: 'See real-time reports and flood zones on the interactive map. Red = severe, amber = moderate, blue = low risk.', color: 'bg-blue-600' },
  { icon: MessageCircle, title: 'AI Assistant', desc: 'Chat with our AI for safety guidance in 9 languages. It covers floods, earthquakes, fires, storms, and more.', color: 'bg-purple-600' },
  { icon: Users, title: 'Community Help', desc: 'Find local resources, offer help, or request assistance. All anonymous with safety controls.', color: 'bg-green-600' },
  { icon: BookOpen, title: 'Be Prepared', desc: 'Interactive scenarios, quizzes, and emergency kit checklists to help you prepare before disaster strikes.', color: 'bg-amber-600' },
  { icon: Accessibility, title: 'Accessibility', desc: 'Tap the floating button (bottom-left) for screen reader, high contrast, large text, dyslexia mode and more.', color: 'bg-cyan-600' },
]

export default function OnboardingTutorial(): JSX.Element | null {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const seen = localStorage.getItem('aegis-onboarding-done')
    if (!seen) setShow(true)
  }, [])

  const dismiss = (): void => {
    setShow(false)
    localStorage.setItem('aegis-onboarding-done', 'true')
  }

  if (!show) return null
  const s = STEPS[step]
  const Icon = s.icon

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full animate-fade-in overflow-hidden">
        <div className={`${s.color} p-6 flex flex-col items-center text-white`}>
          <Icon className="w-12 h-12 mb-3" />
          <h2 className="text-lg font-bold text-center">{s.title}</h2>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">{s.desc}</p>
          <div className="flex items-center justify-center gap-1.5 my-4">
            {STEPS.map((_, i) => <div key={i} className={`w-2 h-2 rounded-full ${i === step ? 'bg-aegis-600' : 'bg-gray-300 dark:bg-gray-600'}`} />)}
          </div>
          <div className="flex gap-2">
            {step < STEPS.length - 1 ? (
              <>
                <button onClick={dismiss} className="btn-ghost flex-1 text-xs">Skip</button>
                <button onClick={() => setStep(s => s + 1)} className="btn-primary flex-1 text-xs">Next <ChevronRight className="w-3.5 h-3.5" /></button>
              </>
            ) : (
              <button onClick={dismiss} className="btn-primary w-full">Get Started</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
