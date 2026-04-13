import { useState, useEffect } from 'react'
import { Phone, X, AlertTriangle, MapPin, Loader } from 'lucide-react'

export default function SOSButton() {
  const [active, setActive] = useState(false)
  const [countdown, setCountdown] = useState(5)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!active || sent) return
    if (countdown <= 0) { setSent(true); return }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [active, countdown, sent])

  const cancel = () => { setActive(false); setCountdown(5); setSent(false) }

  if (!active) {
    return (
      <button onClick={() => setActive(true)} className="fixed bottom-6 left-6 z-40 group">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-red-500/30 animate-pulse-ring" />
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-xl shadow-red-500/30 hover:shadow-red-500/50 transition-all hover:scale-105 active:scale-95">
            <Phone className="w-6 h-6 text-white" />
          </div>
        </div>
        <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-red-600 text-white text-[8px] font-bold rounded-full">SOS</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-sm w-full p-6 text-center animate-scale-in border border-gray-200 dark:border-gray-700 shadow-2xl">
        {!sent ? (
          <>
            <div className="relative w-24 h-24 mx-auto mb-4">
              {/* Countdown ring */}
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-200 dark:text-gray-700" />
                <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="4" className="text-red-500" strokeDasharray={`${(countdown / 5) * 283} 283`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 1s linear' }} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-bold text-red-500">{countdown}</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h2 className="text-lg font-bold text-red-600 dark:text-red-400">SOS Alert Sending</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Your emergency alert will be sent in <strong>{countdown}</strong> seconds</p>
            <p className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-6">
              <MapPin className="w-3 h-3" /> Location: 57.1497° N, 2.0943° W
            </p>
            <button onClick={cancel} className="btn-ghost border border-gray-200 dark:border-gray-700 px-6 py-2.5 text-sm font-bold w-full flex items-center justify-center gap-2">
              <X className="w-4 h-4" /> Cancel SOS
            </button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <Phone className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-lg font-bold text-green-600 dark:text-green-400 mb-2">SOS Alert Sent</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Emergency services have been notified with your location.</p>
            <p className="text-xs text-gray-400 mb-6">Response team ETA: ~4 minutes</p>
            <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/10 mb-4">
              <p className="text-xs text-red-500 dark:text-red-400 font-bold">For life-threatening emergencies, always call 999 / 112</p>
            </div>
            <button onClick={cancel} className="btn-primary px-6 py-2.5 text-sm w-full">Dismiss</button>
          </>
        )}
      </div>
    </div>
  )
}
