/**
 * Multi-layer safety pipeline for the AEGIS chat service.
 *
 * Covers: input sanitisation, prompt injection detection, PII redaction,
 * output content validation, self-consistency checking, session token budgets,
 * and local keyword fallback responses when LLMs are unavailable.
 */
import pool from '../models/db.js'
import { logger } from './logger.js'
import { MAX_TOKENS_PER_SESSION, llmCtx, regionMeta, region } from './chatConstants.js'

//NOTE: Suicide, self-harm, overdose are NOT blocked -- they route to trauma_support agent.
//Blocking crisis users is dangerous. We HELP them with hotlines and PFA instead.
export const UNSAFE_PATTERNS = [
  /\bhow to (make|build|create) (a )?(bomb|weapon|explosive|poison|drug)/i,
  /\billegal (drug|substance)/i,
  /\b(child\s*porn(ography)?|child\s*exploit(ation)?|csam)\b/i,
  /\b(human\s*trafficking|sex\s*slavery)\b/i,
  /\b(hack(ing)?|exploit|breach)\s+(into|the|a)\b/i,
]

//Crisis patterns that should ROUTE to trauma support, never block
export const CRISIS_HELP_PATTERNS = [
  /\b(suicid|kill\s*(my|him|her)self|want\s*to\s*die|end\s*(it|my\s*life)|don.?t\s*want\s*to\s*live)\b/i,
  /\b(self.?harm|cutting|overdose|hurt\s*myself)\b/i,
  /\b(abuse|domestic\s*violence|being\s*(hit|beaten|hurt))\b/i,
]

export const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s*prompt\s*:/i,
  /you\s+are\s+now/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /\bDAN\s+mode\b/i,
  /jailbreak/i,
  /override\s+(your|the)\s+(rules|instructions|prompt)/i,
  /\bact\s+as\s+(if|though)\s+you\s+(have\s+no|don.t\s+have)\s+(rules|restrictions)/i,
  /reveal\s+(your|the)\s+(system|hidden)\s+(prompt|instructions)/i,
  /\[system\]|\[INST\]|<\|im_start\|>|<<SYS>>|<\|system\|>/i,
]

export const PII_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'EMAIL', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { label: 'PHONE', regex: /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g },
  { label: 'NINO', regex: /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]?\b/gi },
  { label: 'POSTCODE', regex: /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi },
]

//Output validation patterns for local models -- catch hallucinations and fabricated data
export const OUTPUT_SAFETY_PATTERNS = [
  { pattern: /call\s+\d{3,4}(?!\s*(if|for|in|when|--|:))/gi, label: 'UNVERIFIED_PHONE', severity: 'warn' as const },
  { pattern: /according\s+to\s+(my|our)\s+(records|data|database)/i, label: 'FABRICATED_SOURCE', severity: 'flag' as const },
  { pattern: /\b(I\s+can\s+confirm|I\s+have\s+verified)\b/i, label: 'FALSE_CERTAINTY', severity: 'flag' as const },
  { pattern: /\bI('m|\s+am)\s+(a\s+)?(doctor|nurse|paramedic|lawyer|police)/i, label: 'ROLE_FABRICATION', severity: 'block' as const },
]

export function validateOutputSafety(output: string): { safe: boolean; flags: string[]; cleaned: string } {
  const flags: string[] = []
  let cleaned = output
  for (const { pattern, label, severity } of OUTPUT_SAFETY_PATTERNS) {
    if (pattern.test(output)) {
      flags.push(label)
      if (severity === 'block') {
        cleaned = cleaned.replace(pattern, '[REDACTED -- AI cannot claim professional roles]')
      }
      //Reset regex lastIndex for global patterns
      pattern.lastIndex = 0
    }
  }
  return { safe: flags.length === 0, flags, cleaned }
}

export function sanitizeUserInput(input: string): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, 2000)
}

export function detectPromptInjection(input: string): string[] {
  return INJECTION_PATTERNS.filter((pattern) => pattern.test(input)).map((pattern) => pattern.source)
}

export type PiiReplacement = { placeholder: string; original: string }

export function redactPii(text: string, existing: PiiReplacement[] = []): { text: string; replacements: PiiReplacement[] } {
  let out = text
  const replacements = [...existing]
  const replacementMap = new Map<string, string>(replacements.map((r) => [r.original, r.placeholder]))

  for (const { label, regex } of PII_PATTERNS) {
    out = out.replace(regex, (match) => {
      const current = replacementMap.get(match)
      if (current) return current
      const placeholder = `[${label}_${replacements.length + 1}]`
      replacements.push({ placeholder, original: match })
      replacementMap.set(match, placeholder)
      return placeholder
    })
  }

  return { text: out, replacements }
}

export function reinjectPii(text: string, replacements: PiiReplacement[]): string {
  let out = text
  for (const item of replacements) {
    out = out.split(item.placeholder).join(item.original)
  }
  return out
}

export async function getSessionTokenState(sessionId: string): Promise<{ used: number; remaining: number; limit: number; exceeded: boolean }> {
  const { rows } = await pool.query(`SELECT total_tokens FROM chat_sessions WHERE id = $1`, [sessionId])
  const used = Number(rows[0]?.total_tokens || 0)
  const remaining = Math.max(0, MAX_TOKENS_PER_SESSION - used)
  return {
    used,
    remaining,
    limit: MAX_TOKENS_PER_SESSION,
    exceeded: used >= MAX_TOKENS_PER_SESSION,
  }
}

export async function getChatSessionBudget(sessionId: string): Promise<{ budgetUsed: number; budgetRemaining: number; budgetLimit: number }> {
  const state = await getSessionTokenState(sessionId)
  return {
    budgetUsed: state.used,
    budgetRemaining: state.remaining,
    budgetLimit: state.limit,
  }
}

export function checkSafety(text: string): string[] {
  const flags: string[] = []
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      flags.push(pattern.source)
    }
  }
  return flags
}

//Self-Consistency Verification
//Checks the LLM response for internal contradictions, numerical inconsistencies,
//and mismatches with tool data. Returns a confidence adjustment and any fixes.
export interface ConsistencyResult {
  isConsistent: boolean
  confidenceAdjustment: number  // -0.3 to 0, negative means less confident
  issues: string[]
  correctedReply?: string
}

export function verifyResponseConsistency(
  reply: string,
  toolResults: string[],
  userMessage: string,
): ConsistencyResult {
  const issues: string[] = []
  let confidenceAdjustment = 0
  let correctedReply = reply

  //1. Internal Contradiction Detection
  //Check for contradictory statements within the same response
  const contradictionPairs: Array<[RegExp, RegExp, string]> = [
    [/\b(safe|no danger|low risk)\b/i, /\b(dangerous|high risk|critical|life.?threatening|evacuate immediately)\b/i, 'safety assessment'],
    [/\b(rising|increasing|getting worse)\b/i, /\b(falling|decreasing|improving|receding)\b/i, 'trend direction'],
    [/\b(open|available|accessible)\b/i, /\b(closed|unavailable|inaccessible|blocked)\b/i, 'availability status'],
    [/\b(no flood|not flooding)\b/i, /\b(flood warning|flooding expected|flood alert)\b/i, 'flood status'],
    [/\b(clear weather|no rain)\b/i, /\b(heavy rain|storm warning|severe weather)\b/i, 'weather status'],
  ]

  //Split reply into sentences for comparison
  const sentences = reply.split(/[.!?\n]+/).filter(s => s.trim().length > 10)
  for (const [patternA, patternB, category] of contradictionPairs) {
    const sentencesA = sentences.filter(s => patternA.test(s))
    const sentencesB = sentences.filter(s => patternB.test(s))
    if (sentencesA.length > 0 && sentencesB.length > 0) {
      //Check if they're describing different things (e.g., "roads are closed but shelters are open")
      //vs genuine contradictions about the same subject
      const aSubjects = sentencesA.map(s => s.slice(0, 40).toLowerCase())
      const bSubjects = sentencesB.map(s => s.slice(0, 40).toLowerCase())
      const sameSubject = aSubjects.some(a => bSubjects.some(b => {
        //Simple word overlap check
        const aWords = new Set(a.split(/\s+/))
        const bWords = new Set(b.split(/\s+/))
        let overlap = 0
        for (const w of aWords) if (bWords.has(w) && w.length > 3) overlap++
        return overlap >= 2
      }))
      if (sameSubject) {
        issues.push(`Potential contradiction in ${category}`)
        confidenceAdjustment -= 0.1
      }
    }
  }

  //2. Numerical Consistency
  //Extract numbers and check for impossible values
  const numberPatterns: Array<{ pattern: RegExp; validate: (n: number) => boolean; label: string }> = [
    { pattern: /(\d+\.?\d*)\s*(?:metres?|meters?|m)\s*(?:deep|depth|high|water)/i, validate: n => n >= 0 && n <= 30, label: 'water depth' },
    { pattern: /(\d+\.?\d*)\s*--[CF]/i, validate: n => n >= -60 && n <= 60, label: 'temperature' },
    { pattern: /(\d+\.?\d*)\s*(?:km\/h|mph|knots)/i, validate: n => n >= 0 && n <= 400, label: 'wind speed' },
    { pattern: /(\d+)\s*%\s*(?:chance|probability|risk|confidence)/i, validate: n => n >= 0 && n <= 100, label: 'percentage' },
  ]

  for (const { pattern, validate, label } of numberPatterns) {
    const match = reply.match(pattern)
    if (match) {
      const num = parseFloat(match[1])
      if (!validate(num)) {
        issues.push(`Implausible ${label}: ${match[0]}`)
        confidenceAdjustment -= 0.15
      }
    }
  }

  //3. Tool Data Cross-Reference
  //If tools returned specific data, check the reply doesn't misquote it
  if (toolResults.length > 0) {
    for (const toolResult of toolResults) {
      //Extract key numbers from tool results
      const toolNumbers = [...toolResult.matchAll(/(\d+\.?\d+)\s*(m|metres?|mm|cm|--[CF]|%)/g)]
      for (const tn of toolNumbers) {
        const toolValue = tn[1]
        const unit = tn[2]
        //Check if the reply mentions a significantly different number for the same unit
        const replyPattern = new RegExp(`(\\d+\\.?\\d*)\\s*${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi')
        const replyMatches = [...reply.matchAll(replyPattern)]
        for (const rm of replyMatches) {
          const replyValue = parseFloat(rm[1])
          const origValue = parseFloat(toolValue)
          if (origValue > 0 && Math.abs(replyValue - origValue) / origValue > 0.5) {
            issues.push(`Reply says ${rm[0]} but tool data shows ${tn[0]}`)
            confidenceAdjustment -= 0.1
            //Auto-correct obvious misquotes
            correctedReply = correctedReply.replace(rm[0], tn[0])
          }
        }
      }
    }
  }

  //4. Hallucination Indicators
  //Detect signs of confident but fabricated information
  const hallucPatterns = [
    /\b(as of|according to)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
    /\bphone\s*:\s*\+?\d{10,15}\b/i, // fabricated phone numbers (not from tools)
  ]
  if (toolResults.length === 0) {
    //Only check for hallucination if no tools provided the data
    for (const hp of hallucPatterns) {
      if (hp.test(reply)) {
        issues.push('Possible hallucinated specific data (no tool confirmation)')
        confidenceAdjustment -= 0.05
      }
    }
  }

  //Cap adjustment
  confidenceAdjustment = Math.max(-0.3, confidenceAdjustment)

  return {
    isConsistent: issues.length === 0,
    confidenceAdjustment,
    issues,
    correctedReply: correctedReply !== reply ? correctedReply : undefined,
  }
}


export const LOCAL_RESPONSES: Array<{ patterns: RegExp[]; response: string }> = [
  {
    patterns: [/flood/i, /water\s*level/i, /river\s*(level|rise|burst)/i],
    response: `**Flood Safety Guidance:**\n\n-- Move to higher ground immediately if water is rising\n-- Do NOT walk or drive through flood water -- 15cm can knock you over, 60cm can float a car\n-- Call **${region.emergencyNumber}** if in immediate danger\n-- Turn off gas, electricity, and water at the mains if safe\n-- Move valuables and medicines upstairs\n-- Check your local flood warnings authority for current alerts\n\n_This is an automated safety response. If Ollama is running, the full AI assistant will provide personalised guidance._`,
  },
  {
    patterns: [/earthquake|quake|tremor|seismic/i],
    response: `**Earthquake Safety:**\n\n-- **DROP, COVER, HOLD ON** -- get under sturdy furniture\n-- Stay away from windows, mirrors, and heavy objects\n-- If outdoors, move to an open area away from buildings\n-- After shaking stops: check for injuries, expect aftershocks\n-- Do NOT use elevators\n-- Call **${region.emergencyNumber}** if injured or trapped`,
  },
  {
    patterns: [/fire|wildfire|blaze|smoke/i],
    response: `**Fire Safety:**\n\n-- Get out, stay out, call **${region.emergencyNumber}**\n-- Crawl low under smoke -- cleaner air is near the floor\n-- Feel doors before opening -- if hot, use another route\n-- Close doors behind you to slow the fire\n-- Never go back inside a burning building\n-- Meet at your pre-arranged assembly point`,
  },
  {
    patterns: [/storm|wind|hurricane|tornado|lightning|thunder/i],
    response: `**Storm Safety:**\n\n-- Stay indoors away from windows\n-- Unplug electrical appliances\n-- Avoid using landline phones during lightning\n-- If outdoors: avoid trees, metal fences, and high ground\n-- Check your local meteorological authority for weather warnings\n-- Secure loose outdoor items (bins, furniture, trampolines)`,
  },
  {
    patterns: [/shelter|evacuat|refuge|safe\s*place/i],
    response: `**Emergency Shelters:**\n\nI can help you find nearby shelters. Use the AEGIS map to see shelter locations marked with ?? icons.\n\nGeneral guidance:\n-- Follow official evacuation routes\n-- Bring medications, ID, phone charger, warm clothing\n-- Register at the shelter so rescuers know you're safe\n-- If you need immediate shelter, call **${region.emergencyNumber}**`,
  },
  {
    patterns: [/first\s*aid|injur|bleed|cpr|unconscious/i],
    response: `**First Aid Basics (call ${region.emergencyNumber} for serious injuries):**\n\n-- **Bleeding:** Apply firm pressure with a clean cloth\n-- **Burns:** Cool under running water for 20 minutes\n-- **Unconscious/breathing:** Place in recovery position\n-- **Not breathing:** Start CPR (30 compressions, 2 breaths)\n-- **Do NOT** move someone with suspected spinal injury\n\n_This is general guidance, not medical advice._`,
  },
  {
    patterns: [/report|submit|incident/i],
    response: `**Submitting a Report:**\n\n1. Go to the AEGIS dashboard\n2. Click "Submit Report" or the + button\n3. Describe the emergency -- include location and severity\n4. Attach photos if safe to do so\n5. Your report will be automatically classified by AI and routed to responders\n\nReports are processed in real time and appear on the live map.`,
  },
  {
    patterns: [/help|hello|hi|hey|what can you/i],
    response: `Hello! I'm the AEGIS Emergency Assistant. I can help with:\n\n-- ?? **Flood safety** and river warnings\n-- ?? **Fire safety** guidance\n-- ?? **Storm preparedness**\n-- ?? **Emergency shelters** near you\n-- ?? **First aid** basics\n-- ?? **Report submission** help\n-- ?? **Earthquake** and other hazard guidance\n\nWhat do you need help with?`,
  },
]

export function generateLocalFallback(message: string): string {
  const lower = message.toLowerCase()
  for (const entry of LOCAL_RESPONSES) {
    if (entry.patterns.some(p => p.test(lower))) {
      return entry.response
    }
  }
  return `I understand your concern. Here's what you can do:\n\n-- For **life-threatening emergencies**, call **${regionMeta.emergencyNumber}** immediately\n-- Check the **AEGIS map** for real-time alerts and shelter locations\n-- Use the **report system** to notify emergency services of incidents\n-- ${llmCtx.officialSourceAdvice}\n\nI'm currently running in offline mode with limited capabilities. If Ollama is available locally, restart it for full AI-powered assistance. Otherwise, the system administrator can configure cloud LLM API keys as a fallback.`
}

