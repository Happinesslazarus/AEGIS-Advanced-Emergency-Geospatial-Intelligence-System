import { useState, useRef, useEffect } from 'react'
import { Bot, Send, X, Minimize2, Maximize2, Sparkles, Shield, ChevronDown } from 'lucide-react'

interface Message { id: string; role: 'user' | 'bot'; text: string; time: string }

const RESPONSES: Record<string, string> = {
  flood: "**Flood Safety**\n\n• Move to higher ground immediately\n• Never walk/drive through flood water\n• Turn off gas, electricity, water\n• Call 999 if trapped\n• Report via AEGIS so responders know your location",
  fire: "**Fire Safety**\n\n• GET OUT, STAY OUT, CALL 999\n• Crawl low under smoke\n• Close doors to slow spread\n• Never use lifts\n• STOP-DROP-ROLL if clothes catch fire",
  storm: "**Storm Safety**\n\n• Stay indoors, away from windows\n• Interior room, lowest floor\n• Use torch, not candles\n• Secure outdoor objects beforehand",
  earthquake: "**Earthquake — DROP, COVER, HOLD ON**\n\n• DROP to hands and knees\n• COVER your head under sturdy furniture\n• HOLD ON until shaking stops",
  shelter: "**Finding Shelter**\n\nCheck the AEGIS map for marked shelters. Council emergency housing: 01224 522000.\nRed Cross: 0800 068 4141",
  report: "**How to Report**\n\n1. Tap 'Report Emergency' button\n2. Select incident type\n3. Describe what you see\n4. Rate severity\n5. Add location (GPS or type)\n6. Upload photo if safe\n\nReports are anonymous — no login required.",
  contacts: "**Emergency Contacts**\n\n🇬🇧 UK: 999 (emergency) | 111 (NHS)\n🇺🇸 USA: 911\n🇪🇺 EU: 112 (universal)\n🇦🇺 Australia: 000\n\nMental health: Samaritans 116 123 (UK, 24/7)",
  mental: "**Your mental health matters.**\n\nCommon after disasters: sleep issues, irritability, replaying events.\n\n24/7 Support:\n• Samaritans: 116 123\n• Crisis text: SHOUT to 85258\n• NHS 111 press 2 for mental health",
  help: "I can help with:\n\n• Any disaster — flood, earthquake, fire, storm\n• Evacuation, shelter, supplies\n• Emergency contacts\n• Mental health support\n• First aid basics\n• How to report incidents\n\nTry: \"What do I do in a flood?\" or \"emergency numbers\"",
}

function getResponse(text: string): string {
  const t = text.toLowerCase()
  if (/flood|water rising|river/.test(t)) return RESPONSES.flood
  if (/fire|burning|smoke/.test(t)) return RESPONSES.fire
  if (/storm|hurricane|wind|tornado/.test(t)) return RESPONSES.storm
  if (/earthquake|quake|shaking/.test(t)) return RESPONSES.earthquake
  if (/shelter|safe place|refuge/.test(t)) return RESPONSES.shelter
  if (/report|submit|how to/.test(t)) return RESPONSES.report
  if (/emergency|999|911|112|contacts|call/.test(t)) return RESPONSES.contacts
  if (/mental|scared|anxious|stress|trauma/.test(t)) return RESPONSES.mental
  return RESPONSES.help
}

export default function Chatbot({ onClose }: { onClose?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'bot', text: "Hello! I'm the AEGIS Emergency AI Assistant. I can help with safety guidance, emergency contacts, and disaster information. What do you need?", time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  const send = () => {
    if (!input.trim()) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: input.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    setMessages(prev => [...prev, userMsg])
    const q = input.trim()
    setInput('')
    setTyping(true)
    setTimeout(() => {
      const botMsg: Message = { id: (Date.now() + 1).toString(), role: 'bot', text: getResponse(q), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      setMessages(prev => [...prev, botMsg])
      setTyping(false)
    }, 800 + Math.random() * 600)
  }

  if (minimized) {
    return (
      <button onClick={() => setMinimized(false)} className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-gradient-to-br from-aegis-500 to-aegis-700 text-white shadow-xl shadow-aegis-500/30 flex items-center justify-center hover:scale-105 transition-transform">
        <Bot className="w-6 h-6" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-950" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[360px] max-h-[520px] flex flex-col bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden animate-scale-in">
      {/* Header */}
      <div className="bg-gradient-to-r from-aegis-600 to-aegis-700 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-bold">AEGIS AI Assistant</p>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] opacity-80">Online — Multilingual</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(true)} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-3 py-2 flex gap-1.5 overflow-x-auto border-b border-gray-100 dark:border-gray-800">
        {['Flood safety', 'Emergency contacts', 'Report incident', 'Shelter finder'].map(q => (
          <button key={q} onClick={() => { setInput(q); setTimeout(send, 50) }} className="whitespace-nowrap px-2.5 py-1 rounded-full bg-aegis-50 dark:bg-aegis-500/10 text-aegis-600 dark:text-aegis-400 text-[10px] font-semibold hover:bg-aegis-100 dark:hover:bg-aegis-500/20 transition-colors flex-shrink-0">
            {q}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[240px] max-h-[340px]">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
              m.role === 'user'
                ? 'bg-aegis-500 text-white rounded-br-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
            }`}>
              <div className="whitespace-pre-line">{m.text}</div>
              <p className={`text-[9px] mt-1 ${m.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>{m.time}</p>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex gap-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-100 dark:border-gray-800">
        <form onSubmit={e => { e.preventDefault(); send() }} className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type your question..."
            className="flex-1 px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm border-0 focus:outline-none focus:ring-2 focus:ring-aegis-500/30"
          />
          <button type="submit" disabled={!input.trim()} className="w-9 h-9 rounded-xl bg-aegis-500 text-white flex items-center justify-center hover:bg-aegis-600 transition-colors disabled:opacity-40">
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[9px] text-gray-400 mt-1.5 text-center flex items-center justify-center gap-1">
          <Sparkles className="w-2.5 h-2.5" /> Powered by AEGIS AI — For emergencies call 999
        </p>
      </div>
    </div>
  )
}
