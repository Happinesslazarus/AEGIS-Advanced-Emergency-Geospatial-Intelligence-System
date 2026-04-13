import { Navbar } from '../components/Navbar'
import Footer from '../components/Footer'
import { Shield, Eye, Keyboard, Type, Monitor, Moon, Globe, Volume2, Subtitles } from 'lucide-react'
import { useState } from 'react'

export default function AccessibilityPage() {
  const [fontSize, setFontSize] = useState(16)
  const [highContrast, setHighContrast] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [screenReader, setScreenReader] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12">
          <section className="text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-aegis-500 to-blue-600 flex items-center justify-center mx-auto">
              <Eye className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold">Accessibility</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto">AEGIS is designed for everyone. Customise your experience below.</p>
          </section>

          {/* Live Settings */}
          <section className="card p-6">
            <h2 className="text-lg font-bold mb-6">Accessibility Settings</h2>
            <div className="space-y-5">
              {/* Font Size */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <Type className="w-5 h-5 text-aegis-500" />
                  <div>
                    <p className="text-sm font-bold">Text Size</p>
                    <p className="text-[10px] text-gray-500">{fontSize}px</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setFontSize(f => Math.max(12, f - 2))} className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-bold text-sm">A-</button>
                  <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-aegis-500 rounded-full" style={{ width: `${((fontSize - 12) / 12) * 100}%` }} />
                  </div>
                  <button onClick={() => setFontSize(f => Math.min(24, f + 2))} className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-bold text-sm">A+</button>
                </div>
              </div>

              {/* Toggles */}
              {[
                { icon: Monitor, label: 'High Contrast Mode', desc: 'Increase contrast for better visibility', value: highContrast, set: setHighContrast },
                { icon: Eye, label: 'Reduced Motion', desc: 'Minimise animations and transitions', value: reducedMotion, set: setReducedMotion },
                { icon: Volume2, label: 'Screen Reader Optimised', desc: 'Enhanced ARIA labels and live regions', value: screenReader, set: setScreenReader },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <s.icon className="w-5 h-5 text-aegis-500" />
                    <div>
                      <p className="text-sm font-bold">{s.label}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">{s.desc}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => s.set(!s.value)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${s.value ? 'bg-aegis-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${s.value ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Keyboard Shortcuts */}
          <section className="card p-6">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4"><Keyboard className="w-4 h-4 text-aegis-500" /> Keyboard Navigation</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                { keys: 'Tab / Shift+Tab', action: 'Navigate between elements' },
                { keys: 'Enter / Space', action: 'Activate buttons and links' },
                { keys: 'Escape', action: 'Close modals and overlays' },
                { keys: 'Arrow Keys', action: 'Navigate within menus' },
                { keys: 'Ctrl + K', action: 'Open command palette' },
                { keys: '/', action: 'Focus search' },
              ].map(s => (
                <div key={s.keys} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-white/[0.02]">
                  <kbd className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-[10px] font-mono font-bold whitespace-nowrap">{s.keys}</kbd>
                  <span className="text-xs text-gray-600 dark:text-gray-400">{s.action}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Features */}
          <section className="card p-6">
            <h2 className="text-sm font-bold mb-4">Accessibility Features</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { icon: Eye, title: 'WCAG 2.1 AA', desc: 'Meets Web Content Accessibility Guidelines' },
                { icon: Globe, title: '9 Languages', desc: 'EN, ES, FR, AR, ZH, HI, PT, PL, UR + RTL' },
                { icon: Moon, title: 'Dark Mode', desc: '8 theme options including high-contrast' },
                { icon: Keyboard, title: 'Full Keyboard', desc: 'Every feature accessible via keyboard' },
                { icon: Subtitles, title: 'Live Captions', desc: 'Audio alerts include text alternatives' },
                { icon: Shield, title: 'Safe Design', desc: 'No flashing content, predictable navigation' },
              ].map(f => (
                <div key={f.title} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                  <f.icon className="w-4 h-4 text-aegis-500 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold">{f.title}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
