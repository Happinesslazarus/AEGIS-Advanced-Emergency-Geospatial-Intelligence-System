/**
 * Dialogue state tracking, long-term user memory, and conversation memory.
 *
 * Tracks slot values (location, hazard type, household size) across turns,
 * detects topic shifts, extracts named entities, and compresses long history
 * into rolling summaries to preserve context window budget.
 */
import pool from '../models/db.js'
import { logger } from './logger.js'
import { chatCompletion } from './llmRouter.js'
import type { EmergencyDetection } from '../types/index.js'
import type { AgentType } from './chatAgentRouter.js'

export interface DialogueSlot {
  name: string
  value: string | number | null
  confirmed: boolean
  source: 'user' | 'tool' | 'inferred'
}

export interface DialogueState {
  intent: string
  stage: 'greeting' | 'information_gathering' | 'action' | 'follow_up' | 'closing'
  slots: DialogueSlot[]
  turnCount: number
  unresolvedQuestions: string[]
  lastToolResults: string[]
  userSentiment: string
}

/**
 * Infer dialogue state from conversation history — tracks intent, slots, and stage
 * so the LLM has full conversational context without re-inferring each turn.
 */
export function inferDialogueState(
  history: Array<{ role: string; content: string }>,
  currentMessage: string,
  emergency: EmergencyDetection,
  emotion: string,
): DialogueState {
  const state: DialogueState = {
    intent: 'general_inquiry',
    stage: 'greeting',
    slots: [],
    turnCount: history.filter(m => m.role === 'user').length,
    unresolvedQuestions: [],
    lastToolResults: [],
    userSentiment: emotion || 'neutral',
  }

  const lower = currentMessage.toLowerCase()

  // Intent classification from message patterns
  const intentPatterns: Array<{ intent: string; patterns: RegExp[] }> = [
    { intent: 'emergency_report', patterns: [/\b(help|emergency|trapped|drowning|fire|collapse)\b/i, /\b(urgent|immediately|right now|sos)\b/i] },
    { intent: 'evacuation_request', patterns: [/\b(evacuate|evacuation|escape|get out|leave|route)\b/i] },
    { intent: 'shelter_search', patterns: [/\b(shelter|safe place|refuge|accommodation|stay)\b/i] },
    { intent: 'weather_inquiry', patterns: [/\b(weather|forecast|rain|wind|temperature|storm)\b/i] },
    { intent: 'flood_risk_check', patterns: [/\b(flood risk|water level|river level|flood zone)\b/i] },
    { intent: 'medical_help', patterns: [/\b(injured|hurt|bleeding|hospital|medical|first aid|ambulance)\b/i] },
    { intent: 'report_status', patterns: [/\b(my report|report status|submitted|update on)\b/i] },
    { intent: 'infrastructure_check', patterns: [/\b(road closed|bridge|power|water supply|electricity)\b/i] },
    { intent: 'preparedness', patterns: [/\b(prepare|kit|checklist|plan|ready|supplies)\b/i] },
    { intent: 'alert_inquiry', patterns: [/\b(alert|warning|notification|current situation)\b/i] },
  ]

  for (const { intent, patterns } of intentPatterns) {
    if (patterns.some(p => p.test(currentMessage))) {
      state.intent = intent
      break
    }
  }

  if (emergency.isEmergency) state.intent = 'emergency_report'

  // Extract slots from current message and history
  const entities = extractEntities(currentMessage)
  if (entities.locations.length > 0) {
    state.slots.push({ name: 'location', value: entities.locations[0], confirmed: false, source: 'user' })
  }
  if (entities.hazardTypes.length > 0) {
    state.slots.push({ name: 'hazard_type', value: entities.hazardTypes[0], confirmed: false, source: 'user' })
  }

  // Extract numeric slots (e.g., "5 people", "3 km")
  const numberPatterns: Array<{ name: string; pattern: RegExp }> = [
    { name: 'people_count', pattern: /(\d+)\s*(?:people|person|family members|of us)/i },
    { name: 'radius_km', pattern: /(\d+)\s*(?:km|kilometer|mile)/i },
  ]
  for (const { name, pattern } of numberPatterns) {
    const m = currentMessage.match(pattern)
    if (m) state.slots.push({ name, value: parseInt(m[1]), confirmed: false, source: 'user' })
  }

  // Determine conversation stage
  if (state.turnCount === 0) {
    state.stage = 'greeting'
  } else if (state.turnCount <= 2 && state.slots.length < 2) {
    state.stage = 'information_gathering'
  } else if (state.intent.includes('emergency') || state.intent.includes('evacuation')) {
    state.stage = 'action'
  } else if (state.turnCount > 4) {
    state.stage = 'follow_up'
  } else {
    state.stage = 'action'
  }

  // Identify unresolved questions from previous assistant messages
  for (const msg of history) {
    if (msg.role === 'assistant') {
      const questions = msg.content.match(/\?[^?]*$/gm)
      if (questions) state.unresolvedQuestions.push(...questions.map(q => q.trim()).slice(-2))
    }
  }
  state.unresolvedQuestions = state.unresolvedQuestions.slice(-3)

  return state
}

export function buildDialogueStateContext(state: DialogueState): string {
  const slotInfo = state.slots.length > 0
    ? state.slots.map(s => `${s.name}=${s.value}${s.confirmed ? ' ?' : ' (unconfirmed)'}`).join(', ')
    : 'none extracted yet'

  return `\n\n[DIALOGUE STATE] Intent: ${state.intent} | Stage: ${state.stage} | Turn: ${state.turnCount + 1} | Sentiment: ${state.userSentiment}\nSlots: ${slotInfo}${state.unresolvedQuestions.length > 0 ? `\nPending questions from your last response: ${state.unresolvedQuestions.join(' ')}` : ''}\nIMPORTANT: If key information is missing (location, hazard type, number of people), ask for it. Do NOT assume. Confirm critical details before taking action.`
}


export interface UserProfile {
  frequentTopics: string[]
  knownLocations: string[]
  preferredLanguage: string
  vulnerabilityFlags: string[]
  interactionCount: number
}

export async function loadUserProfile(citizenId: string | undefined): Promise<UserProfile | null> {
  if (!citizenId) return null
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(preferences->>'frequent_topics', '[]') AS frequent_topics,
         COALESCE(preferences->>'known_locations', '[]') AS known_locations,
         COALESCE(preferences->>'preferred_language', 'en') AS preferred_language,
         COALESCE(preferences->>'vulnerability_flags', '[]') AS vulnerability_flags,
         COALESCE(preferences->>'interaction_count', '0') AS interaction_count
       FROM citizens WHERE id = $1`,
      [citizenId],
    )
    if (rows.length === 0) return null
    const r = rows[0]
    return {
      frequentTopics: JSON.parse(r.frequent_topics),
      knownLocations: JSON.parse(r.known_locations),
      preferredLanguage: r.preferred_language,
      vulnerabilityFlags: JSON.parse(r.vulnerability_flags),
      interactionCount: parseInt(r.interaction_count) || 0,
    }
  } catch {
    return null
  }
}

export async function updateUserProfile(
  citizenId: string | undefined,
  entities: { locations: string[]; hazardTypes: string[] },
  detectedLanguage: string,
): Promise<void> {
  if (!citizenId) return
  try {
    // Merge new topics/locations into existing profile via JSONB operations
    await pool.query(
      `UPDATE citizens SET preferences = jsonb_set(
         jsonb_set(
           jsonb_set(
             COALESCE(preferences, '{}'::jsonb),
             '{interaction_count}',
             to_jsonb(COALESCE((preferences->>'interaction_count')::int, 0) + 1)
           ),
           '{known_locations}',
           (SELECT jsonb_agg(DISTINCT v) FROM (
             SELECT jsonb_array_elements_text(COALESCE(preferences->'known_locations', '[]'::jsonb)) AS v
             UNION SELECT unnest($2::text[]) AS v
           ) sub WHERE v IS NOT NULL)
         ),
         '{frequent_topics}',
         (SELECT jsonb_agg(DISTINCT v) FROM (
           SELECT jsonb_array_elements_text(COALESCE(preferences->'frequent_topics', '[]'::jsonb)) AS v
           UNION SELECT unnest($3::text[]) AS v
         ) sub WHERE v IS NOT NULL)
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [citizenId, entities.locations, entities.hazardTypes],
    )
  } catch {
    // Non-critical — profile update failure should not break chat
  }
}

export function buildUserProfileContext(profile: UserProfile | null): string {
  if (!profile || profile.interactionCount === 0) return ''
  const parts: string[] = []
  if (profile.knownLocations.length > 0) {
    parts.push(`Known locations: ${profile.knownLocations.slice(-5).join(', ')}`)
  }
  if (profile.frequentTopics.length > 0) {
    parts.push(`Frequent topics: ${profile.frequentTopics.slice(-5).join(', ')}`)
  }
  if (profile.vulnerabilityFlags.length > 0) {
    parts.push(`Vulnerability: ${profile.vulnerabilityFlags.join(', ')}`)
  }
  if (parts.length === 0) return ''
  return `\n\n[RETURNING USER — interaction #${profile.interactionCount + 1}] ${parts.join(' | ')}\nUse this context to personalize your response. Reference their known locations when relevant.`
}


export interface ConversationMemory {
  summary: string
  topics: string[]
  entities: { locations: string[]; people: string[]; hazardTypes: string[] }
  messageCount: number
}

 /*
 * Extract entities (locations, people, hazard types) from a message.
  */
export function extractEntities(text: string): { locations: string[]; people: string[]; hazardTypes: string[] } {
  const locations: string[] = []
  const people: string[] = []
  const hazardTypes: string[] = []

  // Hazard type detection
  const hazardPatterns: Array<{ type: string; pattern: RegExp }> = [
    { type: 'flood', pattern: /\b(flood|flooding|floodwater)\b/i },
    { type: 'fire', pattern: /\b(fire|wildfire|blaze)\b/i },
    { type: 'storm', pattern: /\b(storm|hurricane|tornado|cyclone|typhoon)\b/i },
    { type: 'earthquake', pattern: /\b(earthquake|quake|tremor|seismic)\b/i },
    { type: 'landslide', pattern: /\b(landslide|mudslide|mudflow)\b/i },
    { type: 'heatwave', pattern: /\b(heatwave|heat wave|extreme heat)\b/i },
    { type: 'drought', pattern: /\b(drought)\b/i },
    { type: 'power_outage', pattern: /\b(power outage|blackout|power cut)\b/i },
    { type: 'water_supply', pattern: /\b(water supply|water contamination|boil notice)\b/i },
    { type: 'environmental_hazard', pattern: /\b(chemical spill|pollution|toxic|hazardous material)\b/i },
  ]

  for (const { type, pattern } of hazardPatterns) {
    if (pattern.test(text)) hazardTypes.push(type)
  }

  // Location extraction — capitalised multi-word phrases that look like place names
  const locationPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Road|Street|Avenue|Lane|Bridge|River|Park|Hill|Valley|Bay|Harbour|Port|Town|City|Village))?)\b/g
  let locMatch: RegExpExecArray | null
  while ((locMatch = locationPattern.exec(text)) !== null) {
    const candidate = locMatch[1]
    // Filter out common non-location capitalized words
    const nonLocations = new Set(['I', 'The', 'You', 'We', 'They', 'He', 'She', 'It', 'My', 'Your',
      'AEGIS', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
      'October', 'November', 'December', 'Please', 'Thank', 'Hello', 'Help'])
    if (!nonLocations.has(candidate) && candidate.length > 2) {
      locations.push(candidate)
    }
  }

  return { locations: [...new Set(locations)], people: [...new Set(people)], hazardTypes: [...new Set(hazardTypes)] }
}

 /*
 * Detect if the current message represents a topic shift from the conversation history.
  */
export function detectTopicShift(currentMessage: string, previousTopics: string[]): boolean {
  if (previousTopics.length === 0) return false

  const currentEntities = extractEntities(currentMessage)
  const currentTopicSignals = [
    ...currentEntities.hazardTypes,
    ...currentEntities.locations,
  ]

  if (currentTopicSignals.length === 0) return false

  // If none of the current topic signals were in previous topics, it is a shift
  const overlap = currentTopicSignals.filter(t => previousTopics.includes(t.toLowerCase()))
  return overlap.length === 0 && currentTopicSignals.length > 0
}

 /*
 * Summarize older conversation messages to keep the context window manageable.
 * When the conversation exceeds 10 messages, we compress older messages into
 * a summary and only keep the recent ones as full text.
  */
export async function manageConversationMemory(
  history: Array<{ role: string; content: string }>,
): Promise<{ compressedHistory: Array<{ role: string; content: string }>; memory: ConversationMemory }> {
  const RECENT_WINDOW = 10
  const allTopics: string[] = []
  const allEntities = { locations: new Set<string>(), people: new Set<string>(), hazardTypes: new Set<string>() }

  // Extract entities and topics from all messages
  for (const msg of history) {
    const entities = extractEntities(msg.content)
    entities.locations.forEach(l => allEntities.locations.add(l))
    entities.people.forEach(p => allEntities.people.add(p))
    entities.hazardTypes.forEach(h => allEntities.hazardTypes.add(h))
    allTopics.push(...entities.hazardTypes, ...entities.locations.map(l => l.toLowerCase()))
  }

  const memory: ConversationMemory = {
    summary: '',
    topics: [...new Set(allTopics)],
    entities: {
      locations: [...allEntities.locations],
      people: [...allEntities.people],
      hazardTypes: [...allEntities.hazardTypes],
    },
    messageCount: history.length,
  }

  // If history is short enough, return as-is
  if (history.length <= RECENT_WINDOW) {
    return { compressedHistory: history, memory }
  }

  // Split into older messages (to summarize) and recent messages (to keep)
  const olderMessages = history.slice(0, history.length - RECENT_WINDOW)
  const recentMessages = history.slice(history.length - RECENT_WINDOW)

  // Build a text summary of older messages using LLM
  try {
    const olderText = olderMessages.map(m => `${m.role}: ${m.content}`).join('\n')
    const summaryResponse = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: 'You are a conversation summarizer. Summarize the following conversation history in 2-3 sentences, preserving key facts, locations, hazard types, and any emergency context. Be concise but retain all safety-critical information.',
        },
        { role: 'user', content: olderText },
      ],
      maxTokens: 256,
      temperature: 0.3,
    })
    memory.summary = summaryResponse.content
  } catch {
    // LLM unavailable for summarization — use basic text compression
    memory.summary = olderMessages
      .filter(m => m.role === 'user')
      .map(m => m.content.slice(0, 80))
      .join(' | ')
      .slice(0, 300)
  }

  // Build compressed history: summary as a system message + recent messages
  const compressedHistory: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content: `[CONVERSATION SUMMARY — ${olderMessages.length} earlier messages]\n${memory.summary}\n[Key entities: locations=${memory.entities.locations.join(', ') || 'none'}, hazards=${memory.entities.hazardTypes.join(', ') || 'none'}]`,
    },
    ...recentMessages,
  ]

  return { compressedHistory, memory }
}

