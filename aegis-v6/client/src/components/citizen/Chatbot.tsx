import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react'
import { Send, X, Bot, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { generateChatResponse, getSuggestions } from '../../utils/chatbotEngine'
import { t } from '../../utils/i18n'
import type { ChatMessage } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'
import { translateText } from '../../utils/translateService'

const API = ''

interface Props {
  onClose: () => void
  lang?: string
  anchor?: 'left' | 'right'
  adminMode?: boolean
}

interface ChatbotMessage extends ChatMessage {
  id: string
}

function createMessageId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function Chatbot({ onClose, lang: explicitLang, anchor = 'right' }: Props): JSX.Element {
  const detectedLanguage = useLanguage()
  const activeLanguage = explicitLang || detectedLanguage || 'en'
  const [messages, setMessages] = useState<ChatbotMessage[]>(() => [
    { id: createMessageId(), sender: 'bot', text: t('chat.welcomeMessage', activeLanguage), timestamp: new Date() },
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0]?.sender !== 'bot') return prev
      const welcome = t('chat.welcomeMessage', activeLanguage)
      if (prev[0].text === welcome) return prev
      return [{ ...prev[0], text: welcome }]
    })
  }, [activeLanguage])

  useEffect(() => () => {
    abortRef.current?.abort()
  }, [])

  const callChatAPI = useCallback(
    async (
      msg: string,
    ): Promise<{
      text: string
      confidence?: number
      model?: string
      toolsUsed?: string[]
      sources?: Array<{ title: string; relevance: number }> | string[]
    }> => {
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

      if (data.sessionId && !sessionId) setSessionId(data.sessionId)

      return {
        text: data.reply || data.response || data.text || t('chat.noResponse', activeLanguage),
        confidence: data.confidence,
        model: data.model,
        toolsUsed: data.toolsUsed,
        sources: data.sources,
      }
    },
    [sessionId, activeLanguage],
  )

  const appendBotMessage = useCallback(
    async (text: string, confidence?: number): Promise<void> => {
      let displayText = text

      if (activeLanguage !== 'en') {
        try {
          const result = await translateText(text, 'auto', activeLanguage)
          if (result.available && result.translatedText && result.translatedText !== text) {
            displayText = result.translatedText
          }
        } catch {
          // Keep the original reply if translation fails.
        }
      }

      setMessages((prev) => [
        ...prev,
        { id: createMessageId(), sender: 'bot', text: displayText, timestamp: new Date(), confidence },
      ])
    },
    [activeLanguage],
  )

  const handleSend = useCallback(
    (text: string = input): void => {
      const msg = text.trim()
      if (!msg || isTyping) return

      setMessages((prev) => [...prev, { id: createMessageId(), sender: 'user', text: msg, timestamp: new Date() }])
      setInput('')
      setIsTyping(true)

      callChatAPI(msg)
        .then(async ({ text: reply, confidence, model, toolsUsed, sources }) => {
          setIsOnline(true)
          const meta: string[] = []
          if (model) meta.push(`Model: ${model}`)
          if (toolsUsed?.length) meta.push(`Tools: ${toolsUsed.join(', ')}`)
          if (sources?.length) meta.push(`Sources: ${sources.map((source) => typeof source === 'string' ? source : source.title).join(', ')}`)
          const metaLine = meta.length ? `\n\n---\n_${meta.join(' | ')}_` : ''
          await appendBotMessage(reply + metaLine, confidence)
        })
        .catch(async (err: { name?: string }) => {
          if (err.name !== 'AbortError') {
            setIsOnline(false)
            const local = generateChatResponse(msg)
            await appendBotMessage(local.text, local.confidence)
          }
        })
        .finally(() => setIsTyping(false))
    },
    [input, isTyping, callChatAPI, appendBotMessage],
  )

  const renderText = (text: string): JSX.Element[] =>
    text.split('\n').map((line, index) => {
      const parts = line.split(/\*\*(.*?)\*\*/g)
      return (
        <p key={index} className={line.trim().startsWith('•') ? 'pl-2' : line === '' ? 'h-2' : ''}>
          {parts.map((part, partIndex) =>
            partIndex % 2 === 1 ? <strong key={partIndex}>{part}</strong> : <span key={partIndex}>{part}</span>,
          )}
        </p>
      )
    })

  return (
    <div
      className={`fixed ${anchor === 'left' ? 'bottom-24 left-4' : 'bottom-4 right-4'} z-[90] w-full max-w-sm`}
      role="dialog"
      aria-label={t('chat.title', activeLanguage)}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col h-[520px] animate-slide-up">
        <div className="bg-aegis-700 text-white p-4 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-aegis-500 rounded-full flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                {t('chat.title', activeLanguage)}
                {isOnline ? <Wifi className="w-3 h-3 text-green-300" /> : <WifiOff className="w-3 h-3 text-yellow-300" />}
              </h3>
              <p className="text-xs text-aegis-200">
                {isOnline ? t('chat.subtitle', activeLanguage) : t('chat.offlineMode', activeLanguage)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-aegis-600 p-1.5 rounded-lg"
            aria-label={t('general.close', activeLanguage)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50 dark:bg-gray-950">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div
                className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-aegis-600 text-white rounded-br-md'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-md'
                }`}
              >
                {renderText(msg.text)}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 rounded-2xl rounded-bl-md">
                <div className="flex gap-1.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {messages.length <= 2 && (
          <div className="px-3 py-2 flex gap-1.5 flex-wrap border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            {getSuggestions(activeLanguage).slice(0, 3).map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSend(suggestion)}
                className="text-xs bg-aegis-50 dark:bg-aegis-950/30 text-aegis-700 dark:text-aegis-300 px-2.5 py-1.5 rounded-full hover:bg-aegis-100 flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" /> {suggestion}
              </button>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-b-2xl flex-shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && handleSend()}
              placeholder={t('chat.placeholder', activeLanguage)}
              className="input text-sm py-2.5"
              aria-label={t('chat.messageLabel', activeLanguage)}
            />
            <button
              onClick={() => handleSend()}
              className="btn-primary px-3 flex-shrink-0"
              disabled={!input.trim()}
              aria-label={t('chat.sendLabel', activeLanguage)}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-1.5 text-center">{t('chat.disclaimer', activeLanguage)}</p>
        </div>
      </div>
    </div>
  )
}




