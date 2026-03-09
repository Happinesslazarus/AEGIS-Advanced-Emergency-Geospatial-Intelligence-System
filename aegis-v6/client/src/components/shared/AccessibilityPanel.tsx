import { useState, useEffect, useCallback, useRef } from 'react'
import { Accessibility, X, Eye, Type, Contrast, Monitor, MousePointer, Volume2 } from 'lucide-react'

interface A11y { screenReader: boolean; highContrast: boolean; largeText: boolean; dyslexiaFont: boolean; reducedMotion: boolean; colourBlind: string; focusHighlight: boolean }
const DEF: A11y = { screenReader: false, highContrast: false, largeText: false, dyslexiaFont: false, reducedMotion: false, colourBlind: 'none', focusHighlight: false }

/** Read text aloud via Web Speech API */
function speak(text: string, rate = 1.0): void {
  if (!('speechSynthesis' in window) || !text.trim()) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.trim().slice(0, 500))
  u.rate = rate
  u.pitch = 1
  u.volume = 1
  // Prefer an English voice
  const voices = window.speechSynthesis.getVoices()
  const en = voices.find(v => v.lang.startsWith('en') && v.default) || voices.find(v => v.lang.startsWith('en'))
  if (en) u.voice = en
  window.speechSynthesis.speak(u)
}

export default function AccessibilityPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState<A11y>(() => { try { const v = localStorage.getItem('aegis-a11y'); return v ? { ...DEF, ...JSON.parse(v) } : DEF } catch { return DEF } })
  const observerRef = useRef<MutationObserver | null>(null)

  // Apply CSS-based accessibility settings
  useEffect(() => {
    localStorage.setItem('aegis-a11y', JSON.stringify(s)); const r = document.documentElement
    r.classList.toggle('high-contrast', s.highContrast); r.classList.toggle('large-text', s.largeText)
    r.classList.toggle('dyslexia-font', s.dyslexiaFont); r.classList.toggle('reduce-motion', s.reducedMotion)
    r.classList.toggle('focus-highlight', s.focusHighlight)
    document.body.style.filter = s.colourBlind !== 'none' ? `url(#${s.colourBlind})` : ''
  }, [s])

  // Screen reader: read focused element on hover/focus, read alerts automatically
  const handleFocusRead = useCallback((e: FocusEvent | MouseEvent) => {
    if (!s.screenReader) return
    const el = e.target as HTMLElement
    if (!el) return
    // Read from aria-label, alt, textContent in priority
    const text = el.getAttribute('aria-label')
      || (el as HTMLImageElement).alt
      || el.getAttribute('title')
      || (el.closest('button, a, [role="button"]') as HTMLElement)?.getAttribute('aria-label')
      || el.textContent?.trim()?.slice(0, 200)
    if (text && text.length > 1) speak(text, 1.1)
  }, [s.screenReader])

  useEffect(() => {
    if (!s.screenReader) {
      window.speechSynthesis?.cancel()
      if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null }
      return
    }

    // Announce activation
    speak('Screen reader activated. Hover over or focus on elements to hear them read aloud.')

    // Listen for focus events to read out elements
    document.addEventListener('focusin', handleFocusRead, true)

    // MutationObserver: automatically read new alert/notification elements
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return
          // Read elements with role="alert", role="status", or aria-live
          const alertEl = node.matches('[role="alert"],[role="status"],[aria-live]')
            ? node
            : node.querySelector('[role="alert"],[role="status"],[aria-live]')
          if (alertEl) {
            const txt = alertEl.textContent?.trim()
            if (txt) speak(`Alert: ${txt}`, 1.0)
          }
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    observerRef.current = observer

    return () => {
      document.removeEventListener('focusin', handleFocusRead, true)
      observer.disconnect()
      observerRef.current = null
    }
  }, [s.screenReader, handleFocusRead])

  const tog = (k: keyof A11y): void => setS(p => ({ ...p, [k]: !p[k] }))
  const cnt = Object.entries(s).filter(([k, v]) => k !== 'colourBlind' ? v === true : v !== 'none').length
  const items: { key: keyof A11y; icon: typeof Eye; title: string; desc: string }[] = [
    { key: 'screenReader', icon: Volume2, title: 'Screen Reader', desc: 'Read aloud focused elements & alerts' },
    { key: 'highContrast', icon: Contrast, title: 'High Contrast', desc: 'Stronger borders for low vision' },
    { key: 'largeText', icon: Type, title: 'Large Text', desc: 'Increase text size 25%' },
    { key: 'dyslexiaFont', icon: Monitor, title: 'Dyslexia-Friendly', desc: 'Wider spacing, heavier weight' },
    { key: 'reducedMotion', icon: MousePointer, title: 'Reduced Motion', desc: 'Disable animations' },
    { key: 'focusHighlight', icon: Eye, title: 'Focus Highlight', desc: 'Bold outlines for keyboard nav' },
  ]

  return (
    <>
      <svg className="absolute w-0 h-0" aria-hidden="true"><defs>
        <filter id="protanopia"><feColorMatrix type="matrix" values="0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0"/></filter>
        <filter id="deuteranopia"><feColorMatrix type="matrix" values="0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0"/></filter>
        <filter id="tritanopia"><feColorMatrix type="matrix" values="0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0"/></filter>
      </defs></svg>
      <button onClick={() => setOpen(!open)} className="fixed bottom-5 left-5 z-[9998] w-12 h-12 sm:w-14 sm:h-14 bg-aegis-600 hover:bg-aegis-700 text-white rounded-full shadow-lg flex items-center justify-center" aria-label="Accessibility">
        <Accessibility className="w-6 h-6 sm:w-7 sm:h-7" />{cnt > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-[10px] font-bold rounded-full flex items-center justify-center">{cnt}</span>}
      </button>
      {open && (
        <div className="fixed bottom-20 left-5 z-[9998] w-[calc(100vw-2.5rem)] max-w-xs bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 animate-slide-up" role="dialog" aria-label="Accessibility">
          <div className="bg-aegis-700 text-white p-3 rounded-t-2xl flex items-center justify-between"><div className="flex items-center gap-2"><Accessibility className="w-4 h-4" /><h3 className="font-semibold text-sm">Accessibility</h3></div><button onClick={() => setOpen(false)} className="hover:bg-aegis-600 p-1 rounded" aria-label="Close"><X className="w-4 h-4" /></button></div>
          <div className="p-3 space-y-2 max-h-[55vh] overflow-y-auto">
            {items.map(({ key, icon: Icon, title, desc }) => (
              <button key={key} onClick={() => tog(key)} className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border-2 text-left ${s[key] ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s[key] ? 'bg-aegis-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}><Icon className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0"><p className="font-semibold text-xs">{title}</p><p className="text-[10px] text-gray-500 truncate">{desc}</p></div>
                <div className={`w-9 h-5 rounded-full flex-shrink-0 ${s[key] ? 'bg-aegis-600' : 'bg-gray-300'}`}><div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-all ${s[key] ? 'ml-[18px]' : 'ml-0.5'}`} /></div>
              </button>
            ))}
            <div className="p-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-700">
              <p className="font-semibold text-xs mb-2 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Colour Vision</p>
              <div className="grid grid-cols-2 gap-1">{([['none','Default'],['protanopia','Protanopia'],['deuteranopia','Deuteranopia'],['tritanopia','Tritanopia']] as const).map(([k,l]) => (
                <button key={k} onClick={() => setS(p => ({...p, colourBlind: k}))} className={`px-2 py-1.5 rounded-lg text-[10px] font-medium ${s.colourBlind === k ? 'bg-aegis-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600'}`}>{l}</button>
              ))}</div>
            </div>
            <button onClick={() => setS(DEF)} className="w-full btn-ghost text-xs py-1.5">Reset All</button>
          </div>
        </div>
      )}
    </>
  )
}
