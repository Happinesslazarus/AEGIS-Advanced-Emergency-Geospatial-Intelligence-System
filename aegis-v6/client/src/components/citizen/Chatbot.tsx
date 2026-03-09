/**
 * Chatbot.tsx — LLM-powered emergency assistant chat panel.
 *
 * Calls the /api/chat backend which rotates between Gemini, Groq,
 * OpenRouter, and HuggingFace LLMs with RAG context from the vector
 * store. Falls back to the local pattern-match engine when the API
 * is unreachable so the chatbot always works, even offline.
 */

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react'
import { Send, X, Bot, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { generateChatResponse, getSuggestions } from '../../utils/chatbotEngine'
import { t } from '../../utils/i18n'
import type { ChatMessage } from '../../types'

// Use relative paths so Vite's proxy handles API requests
const API = ''

interface Props { onClose: () => void; lang?: string; anchor?: 'left' | 'right' }

export default function Chatbot({ onClose, lang = 'en', anchor = 'right' }: Props): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { sender: 'bot', text: "Hello! I'm the AEGIS Emergency Assistant. I can help with safety guidance for **floods, storms, earthquakes, fires**, mental health support, and more.\n\nI understand multiple languages — feel free to ask in yours.\n\nWhat do you need help with?", timestamp: new Date() },
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { inputRef.current?.focus() }, [])

  // Cleanup in-flight request on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const callChatAPI = useCallback(async (msg: string): Promise<{ text: string; confidence?: number; model?: string; toolsUsed?: string[]; sources?: Array<{ title: string; relevance: number }> | string[] }> => {
    abortRef.current = new AbortController()
    const body: Record<string, unknown> = { message: msg }
    if (sessionId) body.sessionId = sessionId

    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortRef.current.signal,
    })

    if (!res.ok) throw new Error(`API ${res.status}`)
    const data = await res.json()

    // Persist session for message continuity
    if (data.sessionId && !sessionId) setSessionId(data.sessionId)

    return {
      text: data.reply || data.response || data.text || 'I could not generate a response.',
      confidence: data.confidence,
      model: data.model,
      toolsUsed: data.toolsUsed,
      sources: data.sources,
    }
  }, [sessionId])

  const handleSend = useCallback((text: string = input): void => {
    const msg = text.trim()
    if (!msg || isTyping) return
    setMessages(prev => [...prev, { sender: 'user', text: msg, timestamp: new Date() }])
    setInput('')
    setIsTyping(true)

    // Try real API first, fall back to local engine
    callChatAPI(msg)
      .then(({ text: reply, confidence, model, toolsUsed, sources }) => {
        setIsOnline(true)
        const meta: string[] = []
        if (model) meta.push(`Model: ${model}`)
        if (toolsUsed?.length) meta.push(`Tools: ${toolsUsed.join(', ')}`)
        if (sources?.length) meta.push(`Sources: ${sources.map(s => typeof s === 'string' ? s : s.title).join(', ')}`)
        const metaLine = meta.length ? `\n\n---\n_${meta.join(' | ')}_` : ''
        setMessages(prev => [...prev, { sender: 'bot', text: reply + metaLine, timestamp: new Date(), confidence }])
      })
      .catch((err) => {
        // Network failure or API error — use local engine so chat always works
        if (err.name !== 'AbortError') {
          setIsOnline(false)
          const local = generateChatResponse(msg)
          setMessages(prev => [...prev, { sender: 'bot', text: local.text, timestamp: new Date(), confidence: local.confidence }])
        }
      })
      .finally(() => setIsTyping(false))
  }, [input, isTyping, callChatAPI])

  /** Safe markdown-light renderer — no dangerouslySetInnerHTML */
  const renderText = (text: string): JSX.Element[] =>
    text.split('\n').map((line, i) => {
      // Split on **bold** markers and render spans
      const parts = line.split(/\*\*(.*?)\*\*/g)
      return (
        <p key={i} className={line.trim().startsWith('•') ? 'pl-2' : line === '' ? 'h-2' : ''}>
          {parts.map((part, j) =>
            j % 2 === 1 ? <strong key={j}>{part}</strong> : <span key={j}>{part}</span>
          )}
        </p>
      )
    })

  return (
    <div className={`fixed ${anchor === 'left' ? 'bottom-24 left-4' : 'bottom-4 right-4'} z-[90] w-full max-w-sm`} role="dialog" aria-label={t('chat.title', lang)}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col h-[520px] animate-slide-up">
        <div className="bg-aegis-700 text-white p-4 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-aegis-500 rounded-full flex items-center justify-center"><Bot className="w-5 h-5" /></div>
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                {t('chat.title', lang)}
                {isOnline ? <Wifi className="w-3 h-3 text-green-300" /> : <WifiOff className="w-3 h-3 text-yellow-300" />}
              </h3>
              <p className="text-xs text-aegis-200">{isOnline ? t('chat.subtitle', lang) : 'Offline mode — local responses'}</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-aegis-600 p-1.5 rounded-lg" aria-label={t('general.close', lang)}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50 dark:bg-gray-950">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${msg.sender === 'user' ? 'bg-aegis-600 text-white rounded-br-md' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-md'}`}>
                {renderText(msg.text)}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start"><div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 rounded-2xl rounded-bl-md">
              <div className="flex gap-1.5">{[0,150,300].map(d => <span key={d} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}</div>
            </div></div>
          )}
          <div ref={endRef} />
        </div>
        {messages.length <= 2 && (
          <div className="px-3 py-2 flex gap-1.5 flex-wrap border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            {getSuggestions(lang).slice(0, 3).map((s, i) => (
              <button key={i} onClick={() => handleSend(s)} className="text-xs bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300 px-2.5 py-1.5 rounded-full hover:bg-aegis-100 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> {s}
              </button>
            ))}
          </div>
        )}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-b-2xl flex-shrink-0">
          <div className="flex gap-2">
            <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && handleSend()} placeholder={t('chat.placeholder', lang)} className="input text-sm py-2.5" aria-label="Message" />
            <button onClick={() => handleSend()} className="btn-primary px-3 flex-shrink-0" disabled={!input.trim()} aria-label="Send"><Send className="w-4 h-4" /></button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">{t('chat.disclaimer', lang)}</p>
        </div>
      </div>
    </div>
  )
}
