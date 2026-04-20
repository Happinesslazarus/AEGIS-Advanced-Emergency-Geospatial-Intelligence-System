/**
 * Floating chat widget that lets citizens ask emergency-related questions
 * and receive AI-generated answers in real time. Features:
 * 1. Streaming mode: SSE via /api/chat/stream -- tokens arrive incrementally
 * 2. react-markdown rendering: full GFM markdown (bold, lists, code, tables)
 * 3. Stop / Copy / Thumbs-up / Thumbs-down / Regenerate actions per message
 * 4. Follow-up question chips from API response
 * 5. Metadata shown as subtle chips below message (not injected into text)
 * 6. Translation: auto-translates bot replies into the user's active language
 * 7. Offline fallback: generateChatResponse() when streaming unreachable
 *
 * - Streams from /api/chat/stream (chatRoutes.ts) via fetch+ReadableStream
 * - Falls back to POST /api/chat if streaming unsupported
 * - Uses translateText() (translateService.ts) to localise bot replies
 * - Falls back to chatbotEngine.generateChatResponse() when offline
 * - Rendered by CitizenPage.tsx; controlled via onClose prop
 */

import { useState, useRef, useEffect, useCallback, KeyboardEvent, memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Send, X, Bot, Sparkles, Wifi, WifiOff,
  Square, Copy, ThumbsUp, ThumbsDown, RefreshCw, Check,
  Mic, MicOff, Image, Brain, Wrench, ChevronDown, ChevronUp,
  FileText, AlertTriangle, Shield, Zap, Globe,
  Volume2, VolumeX, Download, Clock, Hash, RotateCcw, ArrowDown,
  Maximize2, Minimize2, MessageSquare, Command, History, LogIn, Trash2,
} from 'lucide-react'
import { generateChatResponse, getSuggestions } from '../../utils/chatbotEngine'
import { t, setLanguage } from '../../utils/i18n'
import type { ChatMessage } from '../../types'
import { useLanguage } from '../../hooks/useLanguage'
import { translateText } from '../../utils/translateService'

const API = ''

//Slash commands
const SLASH_COMMANDS: Record<string, { description: string; message: string }> = {
  '/alerts': { description: 'Show active alerts', message: 'Show me all currently active alerts and warnings in my area.' },
  '/sitrep': { description: 'Generate situation report', message: 'Generate a full situation report (SITREP) with current alerts, predictions, river levels, and threat assessment.' },
  '/weather': { description: 'Current weather', message: 'What are the current weather conditions and any weather warnings?' },
  '/evacuate': { description: 'Find evacuation routes', message: 'Help me find evacuation routes and nearby shelters from my current location.' },
  '/flood': { description: 'Flood risk assessment', message: 'Assess the current flood risk -- river levels, rain forecast, and affected areas.' },
  '/shelters': { description: 'Nearby shelters', message: 'Find nearby emergency shelters with availability and capacity information.' },
  '/predict': { description: 'AI predictions', message: 'Show me the latest AI hazard predictions with probability and confidence levels.' },
  '/help': { description: 'List all commands', message: 'What are all the special commands I can use and what features does AEGIS have?' },
}

//Admin-only slash commands -- merged in when adminMode=true
const ADMIN_SLASH_COMMANDS: Record<string, { description: string; message: string }> = {
  '/broadcast': { description: 'Draft emergency broadcast', message: 'Help me draft an emergency broadcast alert. What key information do I need to include and what is the correct format?' },
  '/deploy': { description: 'Resource deployment status', message: 'Show current resource deployment status across all active incidents and recommend optimal allocation.' },
  '/incident': { description: 'Create incident report', message: 'Help me create a comprehensive incident report. Walk me through the required fields and assessment criteria.' },
  '/metrics': { description: 'System performance metrics', message: 'Show system performance metrics including model accuracy, API latency, alert delivery rates, and operational health.' },
  '/operators': { description: 'Operator activity log', message: 'Show current operator activity, recent admin actions, and any outstanding tasks requiring attention.' },
  '/audit': { description: 'Audit trail summary', message: 'Summarise recent audit trail entries, flagging any anomalies or unusual patterns in operator behaviour.' },
}

interface Props {
  onClose: () => void
  lang?: string
  anchor?: 'left' | 'right'
  adminMode?: boolean
  /** JWT for the signed-in user (citizen or admin). When provided the chat API
   *  receives an Authorization header so optionalAuth() returns the real user,
   *  enabling personalized responses, server-side session persistence, and
   *  admin-mode prompts on the backend. */
  authToken?: string | null
  /** Display name of the signed-in user -- shown in the personalised welcome. */
  citizenName?: string
  /** Number of active alerts in the user's region -- shown in the welcome. */
  alertCount?: number
}

interface MessageMeta {
  model?: string
  confidence?: number
  toolsUsed?: string[]
  sources?: Array<{ title: string; relevance: number } | string>
  followUpQuestions?: string[]
  isPersonalized?: boolean
  isEmergency?: boolean
  emergencyType?: string
  smartSuggestions?: Array<{ text: string; category?: string }>
}

//Thinking / tool call step tracking
interface ThinkingStep {
  id: string
  type: 'thinking' | 'tool_start' | 'tool_complete'
  label: string
  toolName?: string
  timestamp: number
}

interface ChatbotMessage extends ChatMessage {
  id: string
  meta?: MessageMeta
  feedback?: 'up' | 'down'
  streaming?: boolean
  thinkingSteps?: ThinkingStep[]
  hasArtifact?: boolean
}

function createMessageId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

//Markdown renderer
const MarkdownContent = memo(({ text }: { text: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
      ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
      li: ({ children }) => <li className="leading-snug">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      code: ({ children, className }) => {
        const isBlock = className?.startsWith('language-')
        return isBlock ? (
          <code className="block bg-gray-100 dark:bg-gray-950 rounded p-2 text-xs font-mono overflow-x-auto my-1">
            {children}
          </code>
        ) : (
          <code className="bg-gray-100 dark:bg-gray-950 rounded px-1 text-xs font-mono">{children}</code>
        )
      },
      pre: ({ children }) => <pre className="my-1">{children}</pre>,
      hr: () => <hr className="my-2 border-gray-200 dark:border-gray-700" />,
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-aegis-600 dark:text-aegis-400">
          {children}
        </a>
      ),
      table: ({ children }) => (
        <div className="overflow-x-auto my-1">
          <table className="text-xs border-collapse w-full">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 bg-gray-50 dark:bg-gray-800 font-semibold text-left">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border border-gray-300 dark:border-gray-600 px-2 py-1">{children}</td>
      ),
    }}
  >
    {text}
  </ReactMarkdown>
))
MarkdownContent.displayName = 'MarkdownContent'

//Thinking chain (visible reasoning)
const TOOL_LABELS: Record<string, string> = {
  get_active_alerts: 'Checking active alerts',
  get_weather: 'Fetching weather data',
  find_shelters: 'Finding nearby shelters',
  get_flood_risk: 'Assessing flood risk',
  search_wikipedia: 'Searching knowledge base',
  get_flood_alerts: 'Checking flood warnings',
  get_weather_warnings: 'Getting weather warnings',
  geocode_location: 'Locating coordinates',
  get_evacuation_routes: 'Planning evacuation routes',
  get_nearby_hospitals: 'Finding medical facilities',
  get_incident_clusters: 'Analyzing incident patterns',
  get_report_status: 'Checking report status',
  check_infrastructure_status: 'Checking infrastructure',
  get_historical_comparison: 'Comparing with history',
  web_search: 'Searching the web',
  analyze_image: 'Analyzing your image',
  get_incident_summary: 'Generating incident summary',
  get_resource_status: 'Checking resource deployment',
  get_citizen_sentiment: 'Analyzing community sentiment',
  generate_sitrep: 'Generating situation report',
  get_ai_predictions: 'Fetching AI predictions',
  get_performance_metrics: 'Loading system metrics',
  get_operator_activity: 'Reviewing operator activity',
}

const ThinkingChain = memo(({ steps, streamStartTime }: { steps: ThinkingStep[]; streamStartTime?: number }) => {
  if (steps.length === 0) return null
  const baseTime = streamStartTime || steps[0]?.timestamp || Date.now()
  return (
    <div className="mb-3 space-y-1.5">
      {steps.map((step, idx) => {
        //Elapsed time since stream started or since the matching tool_start
        let elapsed = ''
        if (step.type === 'tool_complete') {
          const startStep = steps.find(s => s.toolName === step.toolName && s.type === 'tool_start')
          if (startStep) elapsed = `${((step.timestamp - startStep.timestamp) / 1000).toFixed(1)}s`
        } else if (step.type === 'thinking') {
          elapsed = `${((step.timestamp - baseTime) / 1000).toFixed(1)}s`
        }
        return (
          <div
            key={step.id}
            className={`flex items-center gap-2 text-[11px] px-3 py-2 rounded-xl transition-all duration-300 shadow-sm ${
              step.type === 'tool_start'
                ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                : step.type === 'tool_complete'
                  ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
            }`}
          >
            {step.type === 'thinking' && <Brain className="w-3 h-3 animate-pulse flex-shrink-0" />}
            {step.type === 'tool_start' && <Wrench className="w-3 h-3 animate-spin flex-shrink-0" />}
            {step.type === 'tool_complete' && <Check className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate">{step.label}</span>
            {elapsed && (
              <span className="ml-auto text-[9px] opacity-70 flex items-center gap-0.5 flex-shrink-0">
                <Clock className="w-2.5 h-2.5" /> {elapsed}
              </span>
            )}
            {step.type === 'tool_start' && (
              <span className="ml-auto flex gap-0.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="w-1 h-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
})
ThinkingChain.displayName = 'ThinkingChain'

//Artifact detection + panel
const ARTIFACT_PATTERNS = [
  { pattern: /# SITUATION REPORT|## Active Incidents|METHANE/i, type: 'sitrep', label: 'Situation Report', icon: FileText },
  { pattern: /## Evacuation Routes|Route to .+\n\s+Driving:/i, type: 'evacuation', label: 'Evacuation Plan', icon: Shield },
  { pattern: /\*\*Incident Summary\b/i, type: 'incidents', label: 'Incident Summary', icon: AlertTriangle },
  { pattern: /\*\*System Performance Metrics/i, type: 'metrics', label: 'System Metrics', icon: Zap },
  { pattern: /\*\*Resource Status:/i, type: 'resources', label: 'Resource Status', icon: Shield },
  { pattern: /```mermaid/i, type: 'diagram', label: 'Interactive Diagram', icon: Zap },
  { pattern: /\*\*AI Predictions?\*\*|Prediction Summary/i, type: 'predictions', label: 'AI Predictions', icon: Brain },
  { pattern: /Threat Level:\s*(Critical|High|Moderate|Low)/i, type: 'threat', label: 'Threat Assessment', icon: AlertTriangle },
]

function detectArtifact(text: string): { type: string; label: string; icon: typeof FileText } | null {
  for (const { pattern, type, label, icon } of ARTIFACT_PATTERNS) {
    if (pattern.test(text)) return { type, label, icon }
  }
  return null
}

//Mermaid diagram renderer (lazy CDN load)
const MermaidRenderer = memo(({ code }: { code: string }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        //Lazy-load mermaid from CDN
        if (!(window as any).mermaid) {
          const script = document.createElement('script')
          script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
          script.async = true
          await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load mermaid'))
            document.head.appendChild(script)
          })
          ;(window as any).mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
        }
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const { svg: renderedSvg } = await (window as any).mermaid.render(id, code.trim())
        if (!cancelled) setSvg(renderedSvg)
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Diagram render failed')
      }
    })()
    return () => { cancelled = true }
  }, [code])

  if (error) return <div className="text-xs text-red-500 p-2">Diagram error: {error}</div>
  if (!svg) return <div className="text-xs text-gray-400 p-2 animate-pulse">Rendering diagram...</div>
  return <div ref={containerRef} className="overflow-x-auto py-2" dangerouslySetInnerHTML={{ __html: svg }} />
})
MermaidRenderer.displayName = 'MermaidRenderer'

//Extracts mermaid code blocks from markdown text
function extractMermaidBlocks(text: string): string[] {
  const blocks: string[] = []
  const regex = /```mermaid\n([\s\S]*?)```/gi
  let match
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

const ArtifactPanel = memo(({ text, artifact }: { text: string; artifact: { type: string; label: string; icon: typeof FileText } }) => {
  const [expanded, setExpanded] = useState(false)
  const Icon = artifact.icon
  const mermaidBlocks = useMemo(() => artifact.type === 'diagram' ? extractMermaidBlocks(text) : [], [text, artifact.type])

  return (
    <div className="mt-3 border border-blue-200/60 dark:border-blue-800/40 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 text-blue-700 dark:text-blue-300 text-xs font-medium hover:from-blue-100 hover:to-indigo-100 dark:hover:from-blue-950/50 dark:hover:to-indigo-950/50 transition-all"
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{artifact.label}</span>
        <span className="ml-auto text-[10px] text-blue-400">
          {expanded ? 'Collapse' : 'Expand full document'}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="p-3 bg-white dark:bg-gray-900 max-h-80 overflow-y-auto text-sm prose prose-sm dark:prose-invert prose-headings:text-sm">
          {mermaidBlocks.length > 0 ? (
            <>
              {mermaidBlocks.map((block, i) => <MermaidRenderer key={i} code={block} />)}
              <MarkdownContent text={text.replace(/```mermaid[\s\S]*?```/gi, '')} />
            </>
          ) : (
            <MarkdownContent text={text} />
          )}
        </div>
      )}
    </div>
  )
})
ArtifactPanel.displayName = 'ArtifactPanel'

//Metadata chips
const MetaChips = memo(({ meta }: { meta: MessageMeta }) => {
  const chips: Array<{ text: string; color?: string }> = []
  if (meta.model) chips.push({ text: meta.model })
  if (meta.confidence !== undefined) {
    const pct = Math.round(meta.confidence * 100)
    chips.push({ text: `${pct}% conf`, color: pct >= 80 ? 'text-green-600 dark:text-green-400' : pct >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400' })
  }
  if (meta.toolsUsed?.length) chips.push({ text: `${meta.toolsUsed.length} tools used` })
  if (meta.sources?.length) {
    const names = meta.sources.slice(0, 2).map((s) => (typeof s === 'string' ? s : s.title))
    chips.push({ text: `src: ${names.join(', ')}` })
  }
  if (meta.isPersonalized) chips.push({ text: '✦ personalized', color: 'text-purple-600 dark:text-purple-400' })
 if (meta.isEmergency) chips.push({ text: `! ${meta.emergencyType || 'emergency'}`, color: 'text-red-600 dark:text-red-400' })
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {chips.map((chip, i) => (
        <span
          key={i}
          className={`text-[9px] bg-gray-100/80 dark:bg-gray-800/60 px-2 py-0.5 rounded-md leading-none backdrop-blur-sm ${chip.color || 'text-gray-500 dark:text-gray-400'}`}
        >
          {chip.text}
        </span>
      ))}
    </div>
  )
})
MetaChips.displayName = 'MetaChips'

//Message actions bar (with TTS)
const MessageActions = memo(({
  msgId,
  text,
  feedback,
  onFeedback,
  onRegenerate,
  isLast,
}: {
  msgId: string
  text: string
  feedback?: 'up' | 'down'
  onFeedback: (id: string, vote: 'up' | 'down') => void
  onRegenerate: () => void
  isLast: boolean
}) => {
  const [copied, setCopied] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const toggleSpeak = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }
    if (!window.speechSynthesis || !text.trim()) return
    //Strip all markdown formatting for clean TTS output.
    //Order matters: code blocks first (prevent asterisk-in-code false matches),
    //then bold/italic, tables, links, headings, horizontal rules, and stray symbols.
    const plainText = text
      .replace(/```[\s\S]*?```/g, '')          // fenced code blocks
      .replace(/`[^`]*`/g, '')                 // inline code
      .replace(/#{1,6}\s+/g, '')               // headings
      .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1') // bold/italic (*** ** *)
      .replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1')   // underscore bold/italic
      .replace(/~~([^~]+)~~/g, '$1')           // strikethrough
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -- keep label
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')    // images -- remove entirely
      .replace(/^\s*[|>*\-+]\s+/gm, '')        // table/blockquote/list leaders
      .replace(/\|/g, ' ')                     // remaining table pipes
      .replace(/[---]{2,}/g, ',')               // em/en dashes to pauses
      .replace(/\n{2,}/g, '. ')               // paragraph breaks to sentence pauses
      .replace(/\n/g, ' ')                     // remaining newlines
      .replace(/\s{2,}/g, ' ')                 // collapse multiple spaces
      .trim()
    const utterance = new SpeechSynthesisUtterance(plainText)
    utterance.rate = 1.05
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utterance)
    setIsSpeaking(true)
  }

  return (
    <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-all duration-200">
      <button
        onClick={copy}
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/60 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        title="Copy"
      >
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </button>
      <button
        onClick={toggleSpeak}
        className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${isSpeaking ? 'text-aegis-600 dark:text-aegis-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
        title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
      >
        {isSpeaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
      </button>
      <button
        onClick={() => onFeedback(msgId, 'up')}
        className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${feedback === 'up' ? 'text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
        title="Helpful"
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        onClick={() => onFeedback(msgId, 'down')}
        className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${feedback === 'down' ? 'text-red-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
        title="Not helpful"
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
      {isLast && (
        <button
          onClick={onRegenerate}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="Regenerate"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
    </div>
  )
})
MessageActions.displayName = 'MessageActions'

//Animated header orbs (decorative floating particles)
const HeaderOrbs = memo(() => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/[0.04] rounded-full blur-xl animate-float" />
    <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-white/[0.03] rounded-full blur-2xl animate-float" style={{ animationDelay: '1.5s', animationDuration: '4s' }} />
    <div className="absolute top-1/2 right-1/3 w-16 h-16 bg-white/[0.05] rounded-full blur-lg animate-float" style={{ animationDelay: '0.8s', animationDuration: '3.5s' }} />
  </div>
))
HeaderOrbs.displayName = 'HeaderOrbs'

//Typing waveform (replaces basic dot bounce)
const TypingWaveform = memo(() => (
  <span className="inline-flex items-center gap-[3px] h-4 px-1">
    {[0, 1, 2, 3, 4].map((i) => (
      <span
        key={i}
        className="w-[3px] rounded-full bg-aegis-400 dark:bg-aegis-500"
        style={{
          animation: 'waveform 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.1}s`,
          height: '60%',
        }}
      />
    ))}
  </span>
))
TypingWaveform.displayName = 'TypingWaveform'

//Message timestamp (hover reveal)
const MessageTimestamp = memo(({ date }: { date: Date }) => {
  const d = new Date(date)
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <span className="text-[9px] text-gray-400/0 group-hover/msg:text-gray-400/80 dark:group-hover/msg:text-gray-500/80 transition-all duration-300 select-none tabular-nums">
      {timeStr}
    </span>
  )
})
MessageTimestamp.displayName = 'MessageTimestamp'

//Main component
export default function Chatbot({ onClose, lang: explicitLang, anchor = 'right', adminMode = false, authToken, citizenName, alertCount }: Props): JSX.Element {
  const detectedLanguage = useLanguage()
  const activeLanguage = explicitLang || detectedLanguage || 'en'

  //Language selector state
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const langMenuRef = useRef<HTMLDivElement>(null)
  const LANGUAGES = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' },
    { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
    { code: 'ar', label: 'العربية', flag: '🇸🇦' },
    { code: 'zh', label: '中文', flag: '🇨🇳' },
    { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
    { code: 'pt', label: 'Português', flag: '🇵🇹' },
    { code: 'pl', label: 'Polski', flag: '🇵🇱' },
    { code: 'ur', label: 'اردو', flag: '🇵🇰' },
  ]

  //Close language menu when clicking outside
  useEffect(() => {
    if (!langMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) setLangMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [langMenuOpen])

  const handleLanguageChange = useCallback((code: string) => {
    setLanguage(code)
    localStorage.setItem('aegis_lang_chosen', code)
    setLangMenuOpen(false)
  }, [])

  //Only translate bot responses if the user EXPLICITLY chose a language
  //via the language selector (not from browser auto-detection via navigator.language).
  //aegis_lang_chosen is ONLY set when user clicks a language in a selector.
  const userExplicitlyChoseLang = Boolean(
    explicitLang
    || (typeof window !== 'undefined' && localStorage.getItem('aegis_lang_chosen'))
  )
  const shouldTranslateResponses = userExplicitlyChoseLang && activeLanguage !== 'en'

  //Expand / collapse state
  const [isExpanded, setIsExpanded] = useState(false)
  const toggleExpand = useCallback(() => setIsExpanded((v) => !v), [])

  //Input focus glow state
  const [inputFocused, setInputFocused] = useState(false)

  //Merge admin commands when in admin mode
  const allSlashCommands = useMemo(
    () => adminMode ? { ...SLASH_COMMANDS, ...ADMIN_SLASH_COMMANDS } : SLASH_COMMANDS,
    [adminMode],
  )

  //Isolate localStorage key by user role so anonymous, citizen, and admin
  //sessions never bleed into each other (prevents stale history cross-contamination).
  const chatStorageKey = adminMode
    ? 'aegis-chat-session-admin'
    : authToken
      ? 'aegis-chat-session-citizen'
      : 'aegis-chat-session-anon'

  //Build a context-aware welcome message shown to new users.
  const buildWelcomeMessage = (): string => {
    if (adminMode) {
      return `**AEGIS Command Mode** -- Operator${citizenName ? `: ${citizenName}` : ''}\n\nAll admin tools are active. Use \`/broadcast\`, \`/deploy\`, \`/incident\`, \`/metrics\`, \`/operators\`, or \`/audit\` -- or ask anything in natural language. Full system data access enabled.`
    }
    if (citizenName) {
      const alertLine = alertCount && alertCount > 0
 ? `\n\n!️ There ${alertCount === 1 ? 'is' : 'are'} **${alertCount} active alert${alertCount === 1 ? '' : 's'}** in your region.`
        : '\n\n✅ No active alerts in your region right now.'
      return `Welcome back, **${citizenName}**! 👋 Your conversation history is saved to your account.${alertLine}\n\nHow can I help you today?`
    }
    return t('chat.welcomeMessage', activeLanguage)
  }

  const [messages, setMessages] = useState<ChatbotMessage[]>(() => {
    try {
      const saved = localStorage.getItem(chatStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.msgs?.length > 0) {
          return (parsed.msgs as ChatbotMessage[]).map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp as unknown as string),
            streaming: false,
          }))
        }
      }
    } catch { /* ignore */ }
    return [{ id: createMessageId(), sender: 'bot', text: buildWelcomeMessage(), timestamp: new Date() }]
  })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(chatStorageKey)
      if (saved) return (JSON.parse(saved) as { sid?: string }).sid ?? null
    } catch { /* ignore */ }
    return null
  })
  const [isOnline, setIsOnline] = useState(true)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [isAtBottom, setIsAtBottom] = useState(true)

  //Phase 2: Voice input state
  const [isListening, setIsListening] = useState(false)
  const [voicePendingText, setVoicePendingText] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  const hasSpeechApi = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  //Phase 2: Image upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastUserMsgRef = useRef<string>('')

  //Auto-scroll only when already at the bottom
  useEffect(() => {
    if (isAtBottom) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isAtBottom])

  useEffect(() => { inputRef.current?.focus() }, [])

  //Auto-grow textarea when input changes
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  //Persist last 30 non-streaming messages to localStorage (role-scoped key)
  useEffect(() => {
    try {
      const toSave = messages.filter((m) => !m.streaming).slice(-30)
      localStorage.setItem(chatStorageKey, JSON.stringify({ msgs: toSave, sid: sessionId }))
    } catch { /* storage full or private mode */ }
  }, [messages, sessionId, chatStorageKey])

  //Detect whether the user has scrolled away from the bottom
  const handleScrollContainer = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }, [])

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0]?.sender !== 'bot') return prev
      const welcome = buildWelcomeMessage()
      if (prev[0].text === welcome) return prev
      return [{ ...prev[0], text: welcome }]
    })
  }, [activeLanguage])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  //Proactive agent: listen for critical alerts via localStorage event
  //The main app (SocketContext) sets 'aegis-latest-alert' when a critical alert arrives.
  //This lets the chatbot push a proactive message even without direct socket access.
  useEffect(() => {
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key !== 'aegis-latest-alert' || !e.newValue) return
      try {
        const alert = JSON.parse(e.newValue)
        if (alert.severity === 'Critical' || alert.severity === 'Warning') {
          const proactiveMsg: ChatbotMessage = {
            id: createMessageId(),
            sender: 'bot',
 text: `!️ **New ${alert.severity} Alert**: ${alert.title || 'Emergency alert issued'}\n\n${alert.description || ''}\n\n${alert.location_text ? `📍 **Location**: ${alert.location_text}` : ''}\n\nType a question for more details or use \`/alerts\` to see all active alerts.`,
            timestamp: new Date(),
            meta: { isEmergency: true, emergencyType: alert.severity },
          }
          setMessages(prev => [...prev, proactiveMsg])
        }
      } catch { /* ignore malformed events */ }
    }
    window.addEventListener('storage', handleStorageEvent)
    return () => window.removeEventListener('storage', handleStorageEvent)
  }, [])

  //Voice input (Web Speech API -- zero cost)
  const toggleVoice = useCallback(() => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop()
      setIsListening(false)
      return
    }
    if (!hasSpeechApi) return

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = activeLanguage === 'en' ? 'en-GB' : activeLanguage

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('')
      setInput(transcript)
    }

    recognition.onend = () => {
      setIsListening(false)
      //Show confirmation chip instead of auto-sending (prevents accidental sends)
      setInput((current) => {
        if (current.trim()) setVoicePendingText(current.trim())
        return current
      })
    }

    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [isListening, hasSpeechApi, activeLanguage])

  //Image upload
  const handleImageUpload = useCallback(async (file: File) => {
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await fetch(`${API}/api/chat/upload-image`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      //Send as message with image marker the server recognizes
      const imageMsg = `[The citizen attached an image: ${data.imageUrl}] Please analyze this image.`
      handleSend(imageMsg)
    } catch {
      setMessages((prev) => [...prev, {
        id: createMessageId(), sender: 'bot', text: 'Failed to upload image. Please try again.',
        timestamp: new Date(),
      }])
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  //Document upload (PDF, CSV, TXT)
  const docInputRef = useRef<HTMLInputElement>(null)
  const handleDocUpload = useCallback(async (file: File) => {
    setIsUploading(true)
    const isPdf = file.name.toLowerCase().endsWith('.pdf')

    //For PDFs, show a progress message -- OCR can take 10-60s for image-based files
    let ocrMsgId: string | null = null
    if (isPdf) {
      ocrMsgId = createMessageId()
      setMessages((prev) => [...prev, {
        id: ocrMsgId!, sender: 'bot',
        text: `📄 Reading **${file.name}**... trying text extraction, then OCR if needed. This may take up to a minute for scanned documents.`,
        timestamp: new Date(),
      }])
    }

    try {
      const formData = new FormData()
      formData.append('file', file)
      //Give OCR enough time -- 10 pages × ~6s/page = ~60s, plus buffer
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 180_000)
      const res = await fetch(`${API}/api/chat/upload-file`, {
        method: 'POST', body: formData, signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const extracted = (data.extractedText || '').trim()

      //Remove the "reading..." progress message now that we have a result
      if (ocrMsgId) {
        setMessages((prev) => prev.filter((m) => m.id !== ocrMsgId))
      }

      //Detect when all extraction methods (including OCR) failed
      const isUnreadable = extracted.startsWith('[This PDF appears to be')
        || extracted.startsWith('[PDF text extraction failed')
        || extracted.startsWith('[Excel file uploaded')
        || (() => {
          if (!extracted || extracted.length < 50) return false
          const readable = (extracted.match(/[a-zA-Z0-9\s.,;:!?'"()\-]/g) || []).length
          return (readable / extracted.length) < 0.5
        })()

      if (isUnreadable) {
        const sizeKB = (data.size / 1024).toFixed(1)
        const cleanMsg = extracted.startsWith('[')
          ? extracted.replace(/^\[|\]$/g, '')
          : `This file couldn't be read as text. It may be image-based, scanned, or contain only graphics.\n\n**What you can do:**\n- Describe what the document contains so I can help\n- Take a screenshot and use the image upload button (📷) instead`
        setMessages((prev) => [...prev, {
          id: createMessageId(), sender: 'bot',
          text: `📄 **${data.filename}** (${sizeKB}KB)\n\n${cleanMsg}`,
          timestamp: new Date(),
        }])
        return
      }

      const docMsg = `[DOCUMENT UPLOAD -- NOT an emergency report. Analyze and summarize the content below.]\n\nFile: ${data.filename} (${(data.size / 1024).toFixed(1)}KB, ${data.charCount} characters)`
      const fileContent = `Extracted content:\n${extracted.slice(0, 40000) || '[No text extracted]'}\n\nPlease analyze this document and summarize the key information.`
      handleSend(docMsg, fileContent)
    } catch (err: any) {
      if (ocrMsgId) {
        setMessages((prev) => prev.filter((m) => m.id !== ocrMsgId))
      }
      const isTimeout = err?.name === 'AbortError'
      setMessages((prev) => [...prev, {
        id: createMessageId(), sender: 'bot',
        text: isTimeout
          ? 'Document processing timed out -- the file may be very large. Try a shorter document or paste the key text directly.'
          : 'Failed to upload document. Supported: PDF, CSV, TXT, JSON, Markdown.',
        timestamp: new Date(),
      }])
    } finally {
      setIsUploading(false)
      if (docInputRef.current) docInputRef.current.value = ''
    }
  }, [])

  //Stop streaming
  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  //Feedback
  const handleFeedback = useCallback(async (msgId: string, vote: 'up' | 'down') => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, feedback: vote } : m)),
    )
    try {
      await fetch(`${API}/api/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId, rating: vote, sessionId }),
      })
    } catch { /* best-effort */ }
  }, [sessionId])

  //Stream a message to the bot
  const streamMessage = useCallback(async (msg: string, fileContent?: string): Promise<void> => {
    abortRef.current = new AbortController()
    const body: Record<string, unknown> = { message: msg, language: userExplicitlyChoseLang ? activeLanguage : undefined }
    if (sessionId) body.sessionId = sessionId
    if (fileContent) body.fileContent = fileContent

    const botId = createMessageId()
    setMessages((prev) => [
      ...prev,
      { id: botId, sender: 'bot', text: '', timestamp: new Date(), streaming: true },
    ])

    try {
      //Send Authorization header when a token is available so the backend
      //optionalAuth() correctly identifies the user (citizen or admin).
      //Without this header the backend always treats the caller as anonymous,
      //preventing personalization, server-side session persistence, and
      //admin-mode prompts.
      const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authToken) chatHeaders['Authorization'] = `Bearer ${authToken}`

      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      setIsOnline(true)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''
      let doneMeta: MessageMeta = {}

      let currentEventType = ''

      const flushBuffer = () => {
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim()
            continue
          }
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))

            //Thinking event
            if (currentEventType === 'thinking' || 'phase' in payload) {
              const step: ThinkingStep = {
                id: `think-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: 'thinking',
                label: payload.phase || 'Reasoning...',
                timestamp: Date.now(),
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, thinkingSteps: [...(m.thinkingSteps || []), step] }
                    : m,
                ),
              )
              currentEventType = ''
              continue
            }

            //Tool call event
            if (currentEventType === 'tool_call' || ('name' in payload && 'status' in payload)) {
              const isComplete = payload.status === 'complete'
              const step: ThinkingStep = {
                id: `tool-${payload.name}-${payload.status}-${Date.now()}`,
                type: isComplete ? 'tool_complete' : 'tool_start',
                label: TOOL_LABELS[payload.name] || payload.name,
                toolName: payload.name,
                timestamp: Date.now(),
              }
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== botId) return m
                  const steps = [...(m.thinkingSteps || [])]
                  if (isComplete) {
                    const startIdx = steps.findIndex(
                      (s) => s.toolName === payload.name && s.type === 'tool_start',
                    )
                    if (startIdx !== -1) steps[startIdx] = step
                    else steps.push(step)
                  } else {
                    steps.push(step)
                  }
                  return { ...m, thinkingSteps: steps }
                }),
              )
              currentEventType = ''
              continue
            }

            //Token event
            if ('token' in payload) {
              accumulated += payload.token
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId ? { ...m, text: accumulated } : m,
                ),
              )
            } else if ('text' in payload && !('model' in payload)) {
              //replace event -- full replacement (not the done event which also has 'text' sometimes)
              accumulated = payload.text
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId ? { ...m, text: accumulated } : m,
                ),
              )
            } else if ('model' in payload || 'confidence' in payload || 'followUpQuestions' in payload || 'tokensUsed' in payload) {
              //done event -- has model, confidence, sessionId, followUpQuestions etc.
              doneMeta = {
                model: payload.model,
                confidence: payload.confidence,
                toolsUsed: payload.toolsUsed,
                sources: payload.sources,
                followUpQuestions: payload.followUpQuestions,
                isPersonalized: payload.isPersonalized,
                isEmergency: payload.isEmergency,
                emergencyType: payload.emergencyType,
                smartSuggestions: payload.smartSuggestions,
              }
              if (payload.sessionId && !sessionId) setSessionId(payload.sessionId)
              if (payload.followUpQuestions?.length) {
                setFollowUps(payload.followUpQuestions.slice(0, 3))
              }
            } else if ('sessionId' in payload) {
              //standalone sessionId (e.g. from start event)
              if (!sessionId) setSessionId(payload.sessionId)
            }

            currentEventType = ''
          } catch { /* partial JSON line -- skip */ }
        }
      }

      //eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        flushBuffer()
      }
      //flush remainder
      buffer += '\n'
      flushBuffer()

      //Translate the final accumulated text only if user explicitly chose a non-English language
      let displayText = accumulated
      if (shouldTranslateResponses && accumulated.trim()) {
        try {
          const result = await translateText(accumulated, 'auto', activeLanguage)
          if (result.available && result.translatedText && result.translatedText !== accumulated) {
            displayText = result.translatedText
          }
        } catch { /* keep original */ }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: displayText || accumulated, streaming: false, meta: doneMeta }
            : m,
        ),
      )
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        //Stop button pressed -- mark message as complete (partial text stays)
        setMessages((prev) =>
          prev.map((m) => (m.id === botId ? { ...m, streaming: false } : m)),
        )
        return
      }
      //Network failure -- offline fallback
      setIsOnline(false)
      const local = generateChatResponse(msg)
      let displayText = local.text
      if (shouldTranslateResponses && local.text?.trim()) {
        try {
          const result = await translateText(local.text, 'auto', activeLanguage)
          if (result.available && result.translatedText) displayText = result.translatedText
        } catch { /* keep original */ }
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: displayText, streaming: false, meta: { confidence: local.confidence } }
            : m,
        ),
      )
    }
  }, [sessionId, activeLanguage])

  //Send (with slash command support)
  const handleSend = useCallback(
    (text: string = input, fileContent?: string): void => {
      const msg = text.trim()
      if (!msg || isStreaming) return

      //Slash command expansion -- replace /command with full message
      const slashMatch = msg.match(/^(\/\w+)(.*)/)
      let actualMessage = msg
      let displayMessage = msg
      if (slashMatch) {
        const cmd = slashMatch[1].toLowerCase()
        const args = slashMatch[2].trim()
        const slashDef = allSlashCommands[cmd]
        if (slashDef) {
          actualMessage = args ? `${slashDef.message} ${args}` : slashDef.message
          displayMessage = `${cmd} ${args}`.trim()
        }
      }

      lastUserMsgRef.current = actualMessage
      setIsAtBottom(true)
      setFollowUps([])
      setSlashSuggestions([])
      setMessages((prev) => [
        ...prev,
        { id: createMessageId(), sender: 'user', text: displayMessage, timestamp: new Date() },
      ])
      setInput('')
      setIsStreaming(true)

      streamMessage(actualMessage, fileContent).finally(() => setIsStreaming(false))
    },
    [input, isStreaming, streamMessage],
  )

  //Export conversation as markdown
  const handleExport = useCallback(() => {
    const lines = messages.map((m) => {
      const time = new Date(m.timestamp).toLocaleString('en-GB')
      const role = m.sender === 'user' ? `**${citizenName || 'You'}**` : '**AEGIS**'
      return `### ${role} -- ${time}\n\n${m.text}\n`
    })
    const identityLine = citizenName
      ? `_User: ${citizenName}${adminMode ? ' (Admin/Operator)' : ''}_\n`
      : '_User: Anonymous_\n'
    const sessionLine = sessionId ? `_Session ID: ${sessionId}_\n` : ''
    const header = `# AEGIS Conversation Export\n_Exported: ${new Date().toLocaleString('en-GB')}_\n${identityLine}${sessionLine}\n---\n`
    const md = `${header}\n${lines.join('\n---\n\n')}`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aegis-chat-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages, citizenName, adminMode, sessionId])

  //New chat / clear session
  const handleNewChat = useCallback(() => {
    setMessages([{ id: createMessageId(), sender: 'bot', text: buildWelcomeMessage(), timestamp: new Date() }])
    setSessionId(null)
    setFollowUps([])
    setInput('')
    setIsAtBottom(true)
    try { localStorage.removeItem(chatStorageKey) } catch { /* ignore */ }
  }, [activeLanguage, chatStorageKey])

  //Slash command autocomplete
  const [slashSuggestions, setSlashSuggestions] = useState<string[]>([])
  const [slashFocusIdx, setSlashFocusIdx] = useState(-1)

  const handleInputChange = useCallback((val: string) => {
    setInput(val)
    setSlashFocusIdx(-1)
    if (val.startsWith('/')) {
      const partial = val.toLowerCase()
      const matches = Object.keys(allSlashCommands).filter(cmd => cmd.startsWith(partial))
      setSlashSuggestions(matches.slice(0, 6))
    } else {
      setSlashSuggestions([])
    }
  }, [allSlashCommands])

  //Regenerate
  const handleRegenerate = useCallback(() => {
    if (!lastUserMsgRef.current || isStreaming) return
    //Remove last bot message, resend
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.sender === 'bot')
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      return prev.slice(0, realIdx)
    })
    setFollowUps([])
    setIsStreaming(true)
    streamMessage(lastUserMsgRef.current).finally(() => setIsStreaming(false))
  }, [isStreaming, streamMessage])

  const lastBotIdx = [...messages].reverse().findIndex((m) => m.sender === 'bot' && !m.streaming)
  const lastBotRealIdx = lastBotIdx === -1 ? -1 : messages.length - 1 - lastBotIdx

  //Suggestions: first 2 turns OR after each bot reply (follow-up questions)
  const showSuggestions = (messages.length <= 2 && followUps.length === 0) || followUps.length > 0
  const suggestionChips = followUps.length > 0
    ? followUps
    : getSuggestions(activeLanguage).slice(0, 3)

  //Sign-in nudge: shown to anonymous users after 3 user messages so they
  //know they can get personalized responses and session history by signing in.
  const userMsgCount = messages.filter(m => m.sender === 'user').length
  const showSignInNudge = !authToken && !adminMode && userMsgCount >= 3

  //Session history panel (signed-in only)
  const [showHistory, setShowHistory] = useState(false)
  const [pastSessions, setPastSessions] = useState<Array<{ id: string; preview: string; created_at: string }>>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadSessionHistory = useCallback(async () => {
    if (!authToken) return
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API}/api/chat/sessions`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      })
      if (res.ok) {
        const data = await res.json()
        setPastSessions(Array.isArray(data.sessions) ? data.sessions : [])
      }
    } catch { /* best-effort */ }
    finally { setHistoryLoading(false) }
  }, [authToken])

  const handleToggleHistory = useCallback(() => {
    if (!showHistory && pastSessions.length === 0) loadSessionHistory()
    setShowHistory(v => !v)
  }, [showHistory, pastSessions.length, loadSessionHistory])

  return (
    <div
      className={`fixed ${anchor === 'left' ? 'bottom-6 left-4' : 'bottom-4 right-4'} z-[90] transition-all duration-500 ease-spring ${
        isExpanded
          ? 'w-[720px] max-w-[calc(100vw-2rem)] h-[calc(100vh-2rem)]'
          : 'w-[440px] max-w-[calc(100vw-2rem)]'
      }`}
      role="dialog"
      aria-label={t('chat.title', activeLanguage)}
    >
      {/* Ambient glow behind the card */}
      <div className={`absolute -inset-1 bg-gradient-to-br from-aegis-500/20 via-transparent to-aegis-600/20 rounded-[28px] blur-xl opacity-60 pointer-events-none transition-opacity duration-500 ${inputFocused ? 'opacity-100' : 'opacity-40'}`} />

      <div className={`relative bg-white dark:bg-gray-900 rounded-3xl shadow-[0_25px_60px_-12px_rgba(0,0,0,0.25)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)] border border-gray-200/60 dark:border-gray-700/40 flex flex-col animate-slide-up overflow-hidden ring-1 ring-black/[0.03] dark:ring-white/[0.05] transition-all duration-500 ease-spring ${
        isExpanded ? 'h-full' : 'h-[680px]'
      }`}>

        {/* Header */}
        <div className="relative bg-gradient-to-r from-aegis-800 via-aegis-600 to-aegis-800 text-white px-5 py-4 flex items-center justify-between flex-shrink-0 overflow-hidden">
          {/* Shimmer overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent animate-shimmer pointer-events-none" />
          {/* Animated orbs */}
          <HeaderOrbs />
          <div className="flex items-center gap-3 relative z-10">
            <div className="relative group/avatar">
              <div className="w-11 h-11 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center ring-2 ring-white/20 shadow-lg shadow-black/10 transition-transform duration-300 group-hover/avatar:scale-110 group-hover/avatar:rotate-3">
                <Bot className="w-6 h-6 text-white drop-shadow" />
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[2.5px] border-aegis-700 shadow-sm transition-colors duration-300 ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`}>
                {isOnline && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping-slow opacity-75" />}
              </span>
            </div>
            <div>
              <h3 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                {t('chat.title', activeLanguage)}
                {adminMode && <span className="text-[9px] bg-amber-400/90 text-amber-950 px-2 py-0.5 rounded-full uppercase tracking-wider font-extrabold shadow-sm animate-pop">Admin</span>}
              </h3>
              <p className="text-[11px] text-white/60 font-medium mt-0.5">
                {isStreaming
                  ? <span className="flex items-center gap-1.5"><TypingWaveform /><span>{t('chat.typing', activeLanguage) || 'Analyzing...'}</span></span>
                  : isOnline
                    ? <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-emerald-300 animate-pulse" />{t('chat.subtitle', activeLanguage)}</span>
                    : <span className="flex items-center gap-1"><WifiOff className="w-3 h-3" />{t('chat.offlineMode', activeLanguage)}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 relative z-10">
            {/* Session history -- signed-in users only */}
            {authToken && !adminMode && (
              <button
                onClick={handleToggleHistory}
                className={`p-2 rounded-xl hover:bg-white/10 active:bg-white/20 transition-all hover:scale-105 ${showHistory ? 'bg-white/15' : ''}`}
                aria-label="Chat history"
                title="Your previous conversations"
              >
                <History className="w-4 h-4" />
              </button>
            )}
            {/* Language selector */}
            <div ref={langMenuRef} className="relative">
              <button
                onClick={() => setLangMenuOpen(v => !v)}
                className="p-2 rounded-xl hover:bg-white/10 active:bg-white/20 transition-all hover:scale-105 flex items-center gap-1"
                aria-label="Change language"
                title="Change language"
              >
                <Globe className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase opacity-80">{activeLanguage}</span>
              </button>
              {langMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-1 z-50 animate-slide-up max-h-64 overflow-y-auto">
                  {LANGUAGES.map(l => (
                    <button
                      key={l.code}
                      onClick={() => handleLanguageChange(l.code)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 hover:bg-aegis-50 dark:hover:bg-gray-700 transition-colors ${
                        activeLanguage === l.code ? 'bg-aegis-50 dark:bg-gray-700 font-semibold text-aegis-700 dark:text-aegis-300' : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <span className="text-base">{l.flag}</span>
                      <span>{l.label}</span>
                      {activeLanguage === l.code && <Check className="w-3.5 h-3.5 ml-auto text-aegis-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {messages.length > 1 && (
              <>
                <button
                  onClick={handleNewChat}
                  className="p-2 rounded-xl hover:bg-white/10 active:bg-white/20 transition-all hover:scale-105"
                  aria-label="New chat"
                  title="Start a new conversation"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleExport}
                  className="p-2 rounded-xl hover:bg-white/10 active:bg-white/20 transition-all hover:scale-105"
                  aria-label="Export conversation"
                  title="Export conversation as markdown"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    //GDPR clear: wipe all local chat data for this user scope
                    handleNewChat()
                    ;(['aegis-chat-session-anon', 'aegis-chat-session-citizen', 'aegis-chat-session-admin'] as const).forEach(k => {
                      try { localStorage.removeItem(k) } catch { /* ignore */ }
                    })
                  }}
                  className="p-2 rounded-xl hover:bg-red-500/20 active:bg-red-500/30 transition-all hover:scale-105 text-white/70 hover:text-red-300"
                  aria-label="Clear all conversation data"
                  title="Clear all chat data (GDPR)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {/* Expand / collapse toggle */}
            <button
              onClick={toggleExpand}
              className="p-2 rounded-xl hover:bg-white/10 active:bg-white/20 transition-all hover:scale-105"
              aria-label={isExpanded ? 'Collapse chat' : 'Expand chat'}
              title={isExpanded ? 'Collapse to compact' : 'Expand to full size'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-white/10 active:bg-white/20 transition-all hover:scale-105"
              aria-label={t('general.close', activeLanguage)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Session history panel -- signed-in users */}
        {showHistory && authToken && (
          <div className="border-b border-gray-200/50 dark:border-gray-700/30 bg-gray-50/80 dark:bg-gray-800/40 max-h-52 overflow-y-auto flex-shrink-0">
            <div className="px-4 py-2.5 flex items-center justify-between sticky top-0 bg-gray-50/90 dark:bg-gray-800/60 backdrop-blur-sm border-b border-gray-200/30 dark:border-gray-700/20">
              <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                <History className="w-3 h-3" /> Previous conversations
              </span>
              {historyLoading && <span className="text-[10px] text-gray-400 animate-pulse">Loading...</span>}
            </div>
            {!historyLoading && pastSessions.length === 0 && (
              <p className="text-[11px] text-gray-400 px-4 py-3">No previous sessions found.</p>
            )}
            {pastSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSessionId(s.id)
                  setShowHistory(false)
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-aegis-50 dark:hover:bg-aegis-950/20 transition-colors border-b border-gray-100/50 dark:border-gray-700/20 last:border-0"
              >
                <p className="text-[12px] text-gray-700 dark:text-gray-300 truncate">{s.preview || 'Conversation'}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScrollContainer}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative scroll-smooth bg-gradient-to-b from-aegis-50/30 via-gray-50 to-gray-100/50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950"
        >
          {/* Subtle grid pattern overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }} />

          {messages.map((msg, idx) => (
            <div
              key={msg.id}
              className={`group/msg flex items-end gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} ${msg.sender === 'user' ? 'animate-slide-fade-left' : 'animate-slide-fade-right'}`}
              style={{ animationDelay: `${Math.min(idx * 30, 150)}ms` }}
            >
              {msg.sender === 'bot' && (
                <div className="flex-shrink-0 mb-1">
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-md ring-1 ring-aegis-500/20 transition-transform duration-200 group-hover/msg:scale-110">
                    {msg.streaming
                      ? <Brain className="w-3.5 h-3.5 text-white animate-pulse" />
                      : <Bot className="w-3.5 h-3.5 text-white" />
                    }
                  </div>
                </div>
              )}
              <div className={`max-w-[80%] ${msg.sender === 'bot' ? 'group' : ''}`}>
                <div
                  className={`px-4 py-3 text-[13px] leading-relaxed transition-all duration-200 ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-br from-aegis-500 to-aegis-600 text-white rounded-2xl rounded-br-md shadow-md shadow-aegis-500/20 hover:shadow-lg hover:shadow-aegis-500/30'
                      : 'bg-white dark:bg-gray-800/90 border border-gray-100 dark:border-gray-700/50 text-gray-800 dark:text-gray-200 rounded-2xl rounded-bl-md shadow-sm hover:shadow-md'
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <p>{msg.text}</p>
                  ) : (
                    <>
                      {/* Visible reasoning chain -- thinking + tool calls */}
                      {msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
                        <ThinkingChain steps={msg.thinkingSteps} streamStartTime={msg.thinkingSteps[0]?.timestamp} />
                      )}

                      <MarkdownContent text={msg.text} />

                      {msg.streaming && !msg.text && (
                        <div className="flex items-center gap-2 py-1">
                          <TypingWaveform />
                          <span className="text-[11px] text-gray-400 animate-pulse">Thinking...</span>
                        </div>
                      )}
                      {msg.streaming && msg.text && (
                        <span className="inline-block ml-0.5 w-[2px] h-4 bg-aegis-500 animate-pulse align-middle rounded-full" />
                      )}

                      {/* Artifact panel for structured outputs */}
                      {!msg.streaming && msg.text && (() => {
                        const artifact = detectArtifact(msg.text)
                        return artifact ? <ArtifactPanel text={msg.text} artifact={artifact} /> : null
                      })()}
                    </>
                  )}
                </div>

                {/* Timestamp (hover reveal) */}
                <div className={`flex items-center gap-2 mt-1 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <MessageTimestamp date={msg.timestamp} />
                </div>

                {/* Bot message extras */}
                {msg.sender === 'bot' && !msg.streaming && (
                  <>
                    {msg.meta && Object.keys(msg.meta).some((k) => k !== 'followUpQuestions' && msg.meta?.[k as keyof MessageMeta]) && (
                      <MetaChips meta={msg.meta} />
                    )}
                    <MessageActions
                      msgId={msg.id}
                      text={msg.text}
                      feedback={msg.feedback}
                      onFeedback={handleFeedback}
                      onRegenerate={handleRegenerate}
                      isLast={idx === lastBotRealIdx}
                    />
                  </>
                )}
              </div>
            </div>
          ))}

          <div ref={endRef} />

          {/* Scroll-to-bottom button */}
          {!isAtBottom && (
            <button
              onClick={() => { setIsAtBottom(true); endRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
              className="sticky bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[11px] bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 text-white px-4 py-2 rounded-full shadow-lg shadow-aegis-500/25 transition-all animate-pop backdrop-blur-sm"
              aria-label="Scroll to latest"
            >
              <ArrowDown className="w-3 h-3" /> Latest
            </button>
          )}
        </div>

        {/* Sign-in nudge -- anonymous users after 3 exchanges */}
        {showSignInNudge && !isStreaming && (
          <div className="px-4 py-2.5 border-t border-amber-100/80 dark:border-amber-900/30 bg-gradient-to-r from-amber-50/60 via-amber-50/30 to-white dark:from-amber-950/20 dark:via-transparent dark:to-gray-900 flex items-center gap-3">
            <LogIn className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Save your conversation</p>
              <p className="text-[10px] text-amber-600/70 dark:text-amber-500/70 truncate">Sign in to get personalised responses and cloud history</p>
            </div>
            <a
              href="/citizen/auth"
              className="text-[11px] font-bold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 shadow-sm"
            >
              Sign in
            </a>
          </div>
        )}

        {/* Suggestion / follow-up chips */}
        {showSuggestions && !isStreaming && (
          <div className="px-4 py-2.5 flex gap-2 flex-wrap border-t border-gray-100/80 dark:border-gray-800/50 bg-gradient-to-r from-white via-aegis-50/20 to-white dark:from-gray-900 dark:via-aegis-950/10 dark:to-gray-900">
            {suggestionChips.map((chip, index) => (
              <button
                key={index}
                onClick={() => handleSend(chip)}
                className="group/chip text-xs bg-white dark:bg-gray-800 text-aegis-700 dark:text-aegis-300 px-3 py-2 rounded-xl hover:bg-aegis-50 dark:hover:bg-aegis-950/40 flex items-center gap-1.5 border border-aegis-200/50 dark:border-aegis-800/40 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <Sparkles className="w-3 h-3 text-aegis-500 group-hover/chip:animate-wiggle" /> {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className={`p-4 border-t border-gray-200/50 dark:border-gray-700/30 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-b-3xl flex-shrink-0 transition-all duration-300 ${inputFocused ? 'border-t-aegis-300/40 dark:border-t-aegis-700/40' : ''}`}>
          {/* Slash command autocomplete dropdown */}
          {slashSuggestions.length > 0 && (
            <div className="mb-2 bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/50 rounded-xl shadow-lg overflow-hidden animate-slide-up" role="listbox" aria-label="Slash command suggestions">
              {slashSuggestions.map((cmd, idx) => (
                <button
                  key={cmd}
                  role="option"
                  aria-selected={idx === slashFocusIdx}
                  onClick={() => { setInput(cmd + ' '); setSlashSuggestions([]); setSlashFocusIdx(-1) }}
                  className={`w-full text-left px-4 py-2.5 text-xs flex items-center gap-2.5 transition-all active:scale-[0.99] ${
                    idx === slashFocusIdx
                      ? 'bg-aegis-100 dark:bg-aegis-900/50 ring-inset ring-1 ring-aegis-400/40'
                      : 'hover:bg-aegis-50 dark:hover:bg-aegis-950/30'
                  }`}
                >
                  <Command className="w-3 h-3 text-aegis-500 flex-shrink-0" />
                  <span className="font-mono text-aegis-600 dark:text-aegis-400">{cmd}</span>
                  <span className="text-gray-400 dark:text-gray-500 truncate">{allSlashCommands[cmd]?.description}</span>
                  {idx === slashFocusIdx && <span className="ml-auto text-[10px] text-aegis-400 dark:text-aegis-500 flex-shrink-0">↵ select</span>}
                </button>
              ))}
              <div className="px-4 py-1.5 text-[10px] text-gray-400 dark:text-gray-600 border-t border-gray-100 dark:border-gray-700/40 flex gap-3">
 <span>^v navigate</span><span>↵ or Tab select</span><span>Esc dismiss</span>
              </div>
            </div>
          )}
          {/* Voice confirmation chip */}
          {voicePendingText && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 rounded-xl animate-slide-up text-xs">
              <Mic className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
              <span className="flex-1 truncate text-gray-700 dark:text-gray-300">"{voicePendingText}"</span>
              <button
                onClick={() => { handleSend(voicePendingText); setVoicePendingText(null) }}
                className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
              >Send</button>
              <button
                onClick={() => { setInput(''); setVoicePendingText(null) }}
                className="px-2 py-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg transition-colors"
              >x</button>
            </div>
          )}
          {/* Hidden file input for image upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImageUpload(file)
            }}
          />
          {/* Hidden file input for document upload */}
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.csv,.txt,.md,.json,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleDocUpload(file)
            }}
          />
          <div className="flex gap-1.5 items-end">
            {/* Tool buttons row */}
            <div className="flex flex-col gap-1">
              {/* Voice input button */}
              {hasSpeechApi && (
                <button
                  onClick={toggleVoice}
                  className={`p-2 rounded-xl flex-shrink-0 transition-all duration-200 ${
                    isListening
                      ? 'bg-red-100 dark:bg-red-950/40 text-red-500 dark:text-red-400 ring-2 ring-red-300/40 shadow-sm'
                      : 'text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400 hover:bg-aegis-50 dark:hover:bg-aegis-950/30'
                  }`}
                  aria-label={isListening ? 'Stop listening' : 'Voice input'}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  {isListening ? <MicOff className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
            </div>

            {/* Textarea with ambient glow */}
            <div className="flex-1 min-w-0 relative">
              {inputFocused && (
                <div className="absolute -inset-0.5 bg-gradient-to-r from-aegis-400/20 via-aegis-500/20 to-aegis-400/20 rounded-xl blur-sm pointer-events-none animate-pulse" />
              )}
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (slashSuggestions.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSlashFocusIdx(i => Math.min(i + 1, slashSuggestions.length - 1))
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSlashFocusIdx(i => Math.max(i - 1, 0))
                      return
                    }
                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && slashFocusIdx >= 0)) {
                      e.preventDefault()
                      const pick = slashFocusIdx >= 0 ? slashSuggestions[slashFocusIdx] : slashSuggestions[0]
                      setInput(pick + ' ')
                      setSlashSuggestions([])
                      setSlashFocusIdx(-1)
                      return
                    }
                    if (e.key === 'Escape') {
                      setSlashSuggestions([])
                      setSlashFocusIdx(-1)
                      e.preventDefault()
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={isListening ? '🎙 Listening...' : isExpanded ? 'Ask AEGIS anything... (Shift+Enter for new line)' : 'Ask AEGIS anything...'}
                className="relative input text-[13px] py-3 w-full min-h-[44px] max-h-[120px] resize-none leading-snug rounded-xl bg-gray-50/80 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/40 focus:ring-2 focus:ring-aegis-500/20 focus:border-aegis-400/50 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
                style={{ overflow: 'hidden' }}
                aria-label={t('chat.messageLabel', activeLanguage)}
                disabled={isStreaming || isListening}
              />
            </div>

            {/* Right-side action buttons */}
            <div className="flex flex-col gap-1">
              {/* Attachment buttons */}
              <div className="flex gap-0.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-xl flex-shrink-0 text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400 hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-all"
                  aria-label="Upload image"
                  title="Upload image for analysis"
                  disabled={isUploading || isStreaming}
                >
                  <Image className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => docInputRef.current?.click()}
                  className="p-2 rounded-xl flex-shrink-0 text-gray-400 hover:text-aegis-600 dark:hover:text-aegis-400 hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-all"
                  aria-label="Upload document"
                  title="Upload PDF, CSV, or text file"
                  disabled={isUploading || isStreaming}
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Send / Stop */}
              {isStreaming ? (
                <button
                  onClick={handleStop}
                  className="p-2.5 flex-shrink-0 bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/50 text-red-500 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-950/50 shadow-sm transition-all animate-pulse"
                  aria-label="Stop generation"
                >
                  <Square className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  className="p-2.5 flex-shrink-0 bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 text-white rounded-xl shadow-md shadow-aegis-500/25 hover:shadow-lg hover:shadow-aegis-500/30 disabled:opacity-40 disabled:shadow-none transition-all active:scale-90"
                  disabled={!input.trim()}
                  aria-label={t('chat.sendLabel', activeLanguage)}
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {/* Footer bar */}
          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-gray-400/70 dark:text-gray-500/70 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" />
              <span>{messages.filter(m => m.sender === 'user').length} messages</span>
            </p>
            <p className="text-[10px] text-gray-400/70 dark:text-gray-500/70 flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-md text-[9px] font-mono border border-gray-200/40 dark:border-gray-700/40">/</kbd>
              <span className="text-gray-300 dark:text-gray-700">-</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-md text-[9px] font-mono border border-gray-200/40 dark:border-gray-700/40">Shift+↵</kbd>
              <span className="text-gray-300 dark:text-gray-700">-</span>
              <span>{t('chat.disclaimer', activeLanguage)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
