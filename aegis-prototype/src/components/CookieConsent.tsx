import { useState, useEffect } from 'react'
import { Cookie, X, Settings, Check, Shield } from 'lucide-react'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [prefs, setPrefs] = useState({ necessary: true, analytics: false, functional: true })

  useEffect(() => {
    const saved = localStorage.getItem('aegis-cookie-consent')
    if (!saved) setTimeout(() => setVisible(true), 1500)
  }, [])

  const accept = () => { localStorage.setItem('aegis-cookie-consent', 'all'); setVisible(false) }
  const save = () => { localStorage.setItem('aegis-cookie-consent', JSON.stringify(prefs)); setVisible(false) }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-fade-up">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl p-5">
        {!showPrefs ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-9 h-9 rounded-xl bg-aegis-500/10 flex items-center justify-center flex-shrink-0">
                <Cookie className="w-4 h-4 text-aegis-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold mb-0.5">Cookie Preferences</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">We use cookies for essential functionality and optional analytics to improve AEGIS. <button onClick={() => setShowPrefs(true)} className="text-aegis-500 hover:underline font-semibold">Manage preferences</button></p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => { setPrefs(p => ({ ...p, analytics: false })); save() }} className="btn-ghost text-xs px-3 py-2 border border-gray-200 dark:border-gray-700">Essential Only</button>
              <button onClick={accept} className="btn-primary text-xs px-4 py-2">Accept All</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2"><Settings className="w-4 h-4 text-gray-500" /> Cookie Settings</h3>
              <button onClick={() => setShowPrefs(false)} className="text-xs text-aegis-500 font-semibold">← Back</button>
            </div>
            {[
              { key: 'necessary', label: 'Necessary', desc: 'Required for the platform to function. Cannot be disabled.', locked: true },
              { key: 'functional', label: 'Functional', desc: 'Theme preferences, language settings, and session data.' },
              { key: 'analytics', label: 'Analytics', desc: 'Anonymous usage data to improve AEGIS.' },
            ].map(c => (
              <div key={c.key} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                <div>
                  <p className="text-xs font-bold">{c.label}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">{c.desc}</p>
                </div>
                <button
                  onClick={() => !c.locked && setPrefs(p => ({ ...p, [c.key]: !p[c.key as keyof typeof p] }))}
                  className={`w-10 h-5 rounded-full transition-colors relative ${prefs[c.key as keyof typeof prefs] ? 'bg-aegis-500' : 'bg-gray-300 dark:bg-gray-600'} ${c.locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${prefs[c.key as keyof typeof prefs] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button onClick={save} className="btn-primary text-xs px-4 py-2 flex items-center gap-1"><Check className="w-3 h-3" /> Save Preferences</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
