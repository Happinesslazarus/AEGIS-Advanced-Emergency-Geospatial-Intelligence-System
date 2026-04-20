/**
 * Citizen personalisation engine -- provides cross-session memory for chat
 * interactions: loads past memories from citizen_chat_memory, extracts new
 * ones via pattern matching, and uses LLM completions to tailor messaging
 * to individual user profiles.
 *
 * - Called by chatService before and after each conversation turn
 * - Reads/writes the citizen_chat_memory table
 * - Uses llmRouter for LLM-powered response personalisation
 * */

import pool from '../models/db.js'
import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'
import { chatCompletion } from './llmRouter.js'


export interface ChatMemory {
  id: string
  memoryType: string
  content: string
  importance: number
  useCount: number
  lastUsedAt: Date
}

/**
 * Load all active memories for a citizen, ordered by importance and recency.
 * Returns the top 20 most relevant memories to inject into the system prompt.
 */
export async function loadCitizenMemories(citizenId: string): Promise<ChatMemory[]> {
  try {
    const { rows } = await pool.query(
      `SELECT id, memory_type, content, importance, use_count, last_used_at
       FROM citizen_chat_memory
       WHERE citizen_id = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY importance DESC, last_used_at DESC
       LIMIT 20`,
      [citizenId],
    )
    return rows.map((r: any) => ({
      id: r.id,
      memoryType: r.memory_type,
      content: r.content,
      importance: r.importance,
      useCount: r.use_count,
      lastUsedAt: r.last_used_at,
    }))
  } catch {
    return []
  }
}

/**
 * Extract and persist new memories from a conversation message.
 * Uses pattern matching to identify important facts worth remembering.
 */
export async function extractAndSaveMemories(
  citizenId: string,
  message: string,
  sessionId: string,
): Promise<void> {
  const memories = extractMemoriesFromText(message)
  if (memories.length === 0) return

  for (const mem of memories) {
    try {
      //Check for duplicates - don't store the same memory twice
      const { rows: existing } = await pool.query(
        `SELECT id FROM citizen_chat_memory
         WHERE citizen_id = $1 AND memory_type = $2
           AND content ILIKE $3 AND is_active = true
         LIMIT 1`,
        [citizenId, mem.type, `%${mem.content.slice(0, 50)}%`],
      )
      if (existing.length > 0) {
        //Bump use count and update timestamp on existing memory
        await pool.query(
          `UPDATE citizen_chat_memory
           SET use_count = use_count + 1, last_used_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [existing[0].id],
        )
        continue
      }

      await pool.query(
        `INSERT INTO citizen_chat_memory (citizen_id, memory_type, content, importance, source_session)
         VALUES ($1, $2, $3, $4, $5)`,
        [citizenId, mem.type, mem.content, mem.importance, sessionId],
      )
    } catch (err) {
      logger.warn({ err }, '[Personalization] Failed to save memory')
    }
  }
}

interface ExtractedMemory {
  type: string
  content: string
  importance: number
}

function extractMemoriesFromText(text: string): ExtractedMemory[] {
  const memories: ExtractedMemory[] = []
  const lower = text.toLowerCase()

  //Location mentions - "I live in X", "I'm in X", "my home is in X"
  const locationPatterns = [
    /(?:i\s+live\s+(?:in|at|near|on)\s+)([A-Z][a-zA-Z\s,]+)/i,
    /(?:my\s+(?:home|house|flat|address)\s+is\s+(?:in|at|on)\s+)([A-Z][a-zA-Z\s,]+)/i,
    /(?:i(?:'m|\s+am)\s+(?:in|at|near)\s+)([A-Z][a-zA-Z\s,]+)/i,
    /(?:i\s+work\s+(?:in|at|near)\s+)([A-Z][a-zA-Z\s,]+)/i,
  ]
  for (const pattern of locationPatterns) {
    const match = text.match(pattern)
    if (match) {
      const loc = match[1].trim().replace(/[.,!?]+$/, '')
      if (loc.length >= 3 && loc.length <= 100) {
        memories.push({ type: 'location', content: `User location: ${loc}`, importance: 7 })
      }
    }
  }

  //Vulnerability mentions
  const vulnerabilityPatterns: Array<{ pattern: RegExp; content: string; importance: number }> = [
    { pattern: /elderl[y]|aged?\s+parent|grandmother|grandfather|grandparent/i, content: 'Has elderly family member(s) requiring care', importance: 8 },
    { pattern: /wheelchair|mobility|disab[il]|can'?t\s+walk|walking\s+frame/i, content: 'Mobility impairment in household', importance: 9 },
    { pattern: /insulin|diabet[ic]|dialysis|oxygen\s+(?:tank|concentrator)|medical\s+equip/i, content: 'Depends on medical equipment/medication', importance: 10 },
    { pattern: /(?:my\s+)?(?:baby|infant|toddler|newborn|young\s+child|children)/i, content: 'Has young children in household', importance: 8 },
    { pattern: /(?:my\s+)?(?:dog|cat|pet|horse|livestock|animal)/i, content: 'Has pets/animals', importance: 5 },
    { pattern: /live[s]?\s+alone|on\s+my\s+own|by\s+myself/i, content: 'Lives alone', importance: 7 },
    { pattern: /pregnant|expecting\s+(?:a\s+)?baby/i, content: 'Pregnant household member', importance: 9 },
    { pattern: /deaf|hearing\s+impair|blind|visual(?:ly)?\s+impair|sight/i, content: 'Sensory impairment in household', importance: 8 },
    { pattern: /mental\s+health|anxiety|depression|ptsd|autism|adhd/i, content: 'Mental health consideration in household', importance: 6 },
  ]
  for (const { pattern, content, importance } of vulnerabilityPatterns) {
    if (pattern.test(text)) {
      memories.push({ type: 'vulnerability', content, importance })
    }
  }

  //Family/household info
  const familyPatterns = [
    { pattern: /(?:i\s+have\s+)(\d+)\s+(?:children|kids|family\s+members)/i, extract: (m: RegExpMatchArray) => `Household has ${m[1]} children/family members` },
    { pattern: /(?:my\s+(?:partner|wife|husband|spouse)\s+)(?:is\s+called\s+|named?\s+)?([A-Z][a-z]+)/i, extract: (m: RegExpMatchArray) => `Partner's name: ${m[1]}` },
  ]
  for (const { pattern, extract } of familyPatterns) {
    const match = text.match(pattern)
    if (match) {
      memories.push({ type: 'fact', content: extract(match), importance: 5 })
    }
  }

  //Flood zone / property info
  if (/flood\s+(?:zone|risk|area|prone)|flooded\s+before|previous\s+flood/i.test(lower)) {
    memories.push({ type: 'context', content: 'Property has flood history or is in flood-risk area', importance: 8 })
  }

  //Communication preferences
  if (/(?:keep\s+it\s+)(?:short|brief|simple)|(?:i\s+prefer\s+)(?:short|brief|bullet)/i.test(lower)) {
    memories.push({ type: 'preference', content: 'Prefers brief, concise responses', importance: 4 })
  }
  if (/(?:more\s+detail|explain\s+more|thorough|in.depth)/i.test(lower)) {
    memories.push({ type: 'preference', content: 'Prefers detailed, thorough responses', importance: 4 })
  }

  return memories
}

/**
 * Build a rich memory context string to inject into the system prompt.
 */
export function buildMemoryContext(memories: ChatMemory[]): string {
  if (memories.length === 0) return ''

  const grouped: Record<string, string[]> = {}
  for (const mem of memories) {
    if (!grouped[mem.memoryType]) grouped[mem.memoryType] = []
    grouped[mem.memoryType].push(mem.content)
  }

  const sections: string[] = []

  if (grouped.vulnerability) {
    sections.push(`?? VULNERABILITIES: ${grouped.vulnerability.join('; ')}`)
  }
  if (grouped.location) {
    sections.push(`?? Known locations: ${grouped.location.join('; ')}`)
  }
  if (grouped.medical) {
    sections.push(`?? Medical: ${grouped.medical.join('; ')}`)
  }
  if (grouped.context) {
    sections.push(`?? Context: ${grouped.context.join('; ')}`)
  }
  if (grouped.preference) {
    sections.push(`?? Preferences: ${grouped.preference.join('; ')}`)
  }
  if (grouped.fact) {
    sections.push(`?? Known facts: ${grouped.fact.join('; ')}`)
  }
  if (grouped.pet) {
    sections.push(`?? Pets: ${grouped.pet.join('; ')}`)
  }
  if (grouped.emergency_contact) {
    sections.push(`?? Emergency contacts: ${grouped.emergency_contact.join('; ')}`)
  }

  return `\n\n[CITIZEN MEMORY - PERSISTENT CROSS-SESSION KNOWLEDGE]\n${sections.join('\n')}\nUse this memory to provide personalized, context-aware responses. Reference their known locations and vulnerabilities proactively when relevant. If they mention something you already know, acknowledge it naturally ("As you mentioned before..." or "Since you live near...").`
}


export interface BehaviorProfile {
  preferredDetailLevel: string
  preferredTone: string
  preferredLanguage: string
  responseFormatPref: string
  riskLevel: string
  knownVulnerabilities: string[]
  totalSessions: number
  totalMessages: number
  primaryTopics: string[]
  topicFrequency: Record<string, number>
  knownLocations: Array<{ name: string; lat?: number; lng?: number; type?: string }>
  proactiveAlerts: boolean
}

export async function loadBehaviorProfile(citizenId: string): Promise<BehaviorProfile | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM citizen_behavior_profile WHERE citizen_id = $1`,
      [citizenId],
    )
    if (rows.length === 0) return null
    const r = rows[0]
    return {
      preferredDetailLevel: r.preferred_detail_level,
      preferredTone: r.preferred_tone,
      preferredLanguage: r.preferred_language,
      responseFormatPref: r.response_format_pref,
      riskLevel: r.risk_level,
      knownVulnerabilities: r.known_vulnerabilities || [],
      totalSessions: r.total_sessions,
      totalMessages: r.total_messages,
      primaryTopics: r.primary_topics || [],
      topicFrequency: r.topic_frequency || {},
      knownLocations: r.known_locations || [],
      proactiveAlerts: r.proactive_alerts,
    }
  } catch {
    return null
  }
}

export async function loadOperatorProfile(operatorId: string): Promise<any | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM operator_behavior_profile WHERE operator_id = $1`,
      [operatorId],
    )
    if (rows.length === 0) return null
    return rows[0]
  } catch {
    return null
  }
}

/**
 * Build a behavior-aware context string that adapts the AI's communication style.
 */
export function buildBehaviorContext(profile: BehaviorProfile | null): string {
  if (!profile) return ''

  const instructions: string[] = []

  //Detail level calibration
  if (profile.preferredDetailLevel === 'brief') {
    instructions.push('This user prefers BRIEF responses. Keep answers under 150 words. Use bullet points. Skip preamble.')
  } else if (profile.preferredDetailLevel === 'detailed') {
    instructions.push('This user prefers DETAILED responses. Provide comprehensive explanations with context and examples.')
  } else if (profile.preferredDetailLevel === 'expert') {
    instructions.push('This user has EXPERT-LEVEL understanding. Use technical terminology. Include raw data and statistics.')
  }

  //Tone calibration
  if (profile.preferredTone === 'empathetic') {
    instructions.push('Adopt a warm, supportive tone. Acknowledge feelings. Use empathetic language.')
  } else if (profile.preferredTone === 'direct') {
    instructions.push('Be direct and concise. Skip pleasantries. Lead with facts and actions.')
  } else if (profile.preferredTone === 'technical') {
    instructions.push('Use professional emergency management terminology. Include coordinates and data references.')
  }

  //Format preference
  if (profile.responseFormatPref === 'bullets') {
    instructions.push('Format responses primarily with bullet points and short lines.')
  } else if (profile.responseFormatPref === 'numbered') {
    instructions.push('Format responses with numbered steps when providing instructions.')
  }

  //Risk-aware context
  if (profile.riskLevel === 'elevated' || profile.riskLevel === 'high' || profile.riskLevel === 'critical') {
    instructions.push(`?? This user is in a ${profile.riskLevel.toUpperCase()} risk area. Prioritize safety information and proactive warnings.`)
  }

  //Vulnerability-aware guidance
  if (profile.knownVulnerabilities.length > 0) {
    instructions.push(`Known vulnerabilities: ${profile.knownVulnerabilities.join(', ')}. Tailor evacuation and safety advice accordingly.`)
  }

  //Engagement level
  if (profile.totalSessions > 20) {
    instructions.push(`Power user (${profile.totalSessions} sessions, ${profile.totalMessages} messages). Skip basic explanations they already know.`)
  } else if (profile.totalSessions > 5) {
    instructions.push(`Returning user (${profile.totalSessions} sessions). They know the AEGIS platform basics.`)
  }

  //Primary interests
  if (profile.primaryTopics.length > 0) {
    instructions.push(`Primary interests: ${profile.primaryTopics.slice(0, 5).join(', ')}. Proactively relate answers to these domains.`)
  }

  //Known locations for proactive context
  if (profile.knownLocations.length > 0) {
    const locs = profile.knownLocations.map(l => `${l.name}${l.type ? ` (${l.type})` : ''}`).join(', ')
    instructions.push(`Known locations: ${locs}. Reference these when discussing local conditions.`)
  }

  if (instructions.length === 0) return ''

  return `\n\n[ADAPTIVE PERSONALIZATION - LEARNED BEHAVIOR PROFILE]\n${instructions.join('\n')}\nApply these personalization settings naturally. Do not mention them explicitly to the user.`
}

/**
 * Update the behavior profile after a conversation, learning from the interaction.
 */
export async function updateBehaviorProfile(
  citizenId: string,
  sessionStats: {
    messageCount: number
    topics: string[]
    locations: Array<{ name: string; lat?: number; lng?: number }>
    detectedLanguage: string
    sentiment: string
  },
): Promise<void> {
  try {
    //Upsert behavior profile
    await pool.query(
      `INSERT INTO citizen_behavior_profile (citizen_id, total_sessions, total_messages, primary_topics, preferred_language)
       VALUES ($1, 1, $2, $3, $4)
       ON CONFLICT (citizen_id) DO UPDATE SET
         total_sessions = citizen_behavior_profile.total_sessions + 1,
         total_messages = citizen_behavior_profile.total_messages + $2,
         primary_topics = (
           SELECT ARRAY(SELECT DISTINCT unnest(citizen_behavior_profile.primary_topics || $3) LIMIT 20)
         ),
         preferred_language = CASE
           WHEN $4 != 'en' THEN $4
           ELSE citizen_behavior_profile.preferred_language
         END,
         topic_frequency = (
           SELECT jsonb_object_agg(key, COALESCE((citizen_behavior_profile.topic_frequency->>key)::int, 0) + 1)
           FROM unnest($3) AS key
         ) || citizen_behavior_profile.topic_frequency,
         avg_messages_per_session = (citizen_behavior_profile.total_messages + $2)::numeric / (citizen_behavior_profile.total_sessions + 1),
         updated_at = NOW()`,
      [citizenId, sessionStats.messageCount, sessionStats.topics, sessionStats.detectedLanguage],
    )

    //Update known locations if new ones found
    if (sessionStats.locations.length > 0) {
      await pool.query(
        `UPDATE citizen_behavior_profile
         SET known_locations = (
           SELECT jsonb_agg(DISTINCT loc)
           FROM (
             SELECT jsonb_array_elements(known_locations) AS loc
             UNION ALL
             SELECT jsonb_array_elements($2::jsonb)
           ) sub
         )
         WHERE citizen_id = $1`,
        [citizenId, JSON.stringify(sessionStats.locations)],
      )
    }
  } catch (err) {
    logger.warn({ err }, '[Personalization] Failed to update behavior profile')
  }
}

/**
 * Update the operator behavior profile after a conversation.
 */
export async function updateOperatorProfile(
  operatorId: string,
  queryTypes: string[],
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO operator_behavior_profile (operator_id, total_sessions)
       VALUES ($1, 1)
       ON CONFLICT (operator_id) DO UPDATE SET
         total_sessions = operator_behavior_profile.total_sessions + 1,
         frequent_queries = (
           SELECT jsonb_object_agg(key, COALESCE((operator_behavior_profile.frequent_queries->>key)::int, 0) + 1)
           FROM unnest($2::text[]) AS key
         ) || operator_behavior_profile.frequent_queries,
         updated_at = NOW()`,
      [operatorId, queryTypes],
    )
  } catch (err) {
    logger.warn({ err }, '[Personalization] Failed to update operator profile')
  }
}


/**
 * Load the latest conversation summaries for a citizen to provide
 * cross-session context. Returns the 3 most recent summaries.
 */
export async function loadRecentSummaries(citizenId: string): Promise<Array<{
  summary: string
  keyTopics: string[]
  sentiment: string
  unresolvedQuestions: string[]
  actionItems: string[]
  createdAt: Date
}>> {
  try {
    const { rows } = await pool.query(
      `SELECT summary, key_topics, sentiment, unresolved_questions, action_items, created_at
       FROM conversation_summaries
       WHERE citizen_id = $1
       ORDER BY created_at DESC
       LIMIT 3`,
      [citizenId],
    )
    return rows.map((r: any) => ({
      summary: r.summary,
      keyTopics: r.key_topics || [],
      sentiment: r.sentiment,
      unresolvedQuestions: r.unresolved_questions || [],
      actionItems: r.action_items || [],
      createdAt: r.created_at,
    }))
  } catch {
    return []
  }
}

/**
 * Build a context block from previous conversation summaries.
 */
export function buildSummaryContext(summaries: Array<{
  summary: string
  keyTopics: string[]
  sentiment: string
  unresolvedQuestions: string[]
  actionItems: string[]
  createdAt: Date
}>): string {
  if (summaries.length === 0) return ''

  const blocks: string[] = []
  for (const s of summaries) {
    const timeAgo = getRelativeTimeString(s.createdAt)
    let block = `[${timeAgo}] ${s.summary}`
    if (s.unresolvedQuestions.length > 0) {
      block += `\n  Unresolved: ${s.unresolvedQuestions.join('; ')}`
    }
    if (s.actionItems.length > 0) {
      block += `\n  Action items: ${s.actionItems.join('; ')}`
    }
    blocks.push(block)
  }

  return `\n\n[PREVIOUS CONVERSATION CONTEXT - CROSS-SESSION CONTINUITY]\n${blocks.join('\n')}\nReference previous conversations naturally when relevant. If they had unresolved questions, proactively address them. If action items were pending, ask for updates.`
}

function getRelativeTimeString(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}

/**
 * Generate and store a conversation summary when a session ends or gets long.
 * Uses a 3-tier approach:
 *   1. LLM-based semantic summarization (preferred - compressed & contextual)
 *   2. Hierarchical compression for long conversations (groups messages by phase)
 *   3. Extractive fallback if LLM is unavailable
 * Also synthesizes cross-session patterns when prior summaries exist.
 */
export async function generateAndSaveSummary(
  sessionId: string,
  citizenId: string | undefined,
  operatorId: string | undefined,
): Promise<void> {
  if (!citizenId && !operatorId) return

  try {
    //Get all messages from the session
    const { rows: messages } = await pool.query(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    )

    if (messages.length < 3) return // Skip very short conversations

    //Extract key information
    const userMessages = messages.filter((m: any) => m.role === 'user').map((m: any) => m.content)
    const botMessages = messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.content)

    const allText = messages.map((m: any) => m.content).join(' ')
    const topics = extractTopicsFromText(allText)
    const entities = extractEntitiesFromText(allText)

    //Detect unresolved questions (questions in last bot message)
    const lastBot = botMessages[botMessages.length - 1] || ''
    const unresolvedQuestions = extractQuestions(lastBot)

    //Detect action items
    const actionItems = extractActionItems(botMessages.join(' '))

    //Detect sentiment
    const sentiment = detectOverallSentiment(userMessages)

    //Tier 1: LLM-based semantic summarization
    let summary = ''
    let usedLLM = false

    try {
      //Build a condensed transcript (trim each message to avoid huge prompts)
      const maxTranscriptTokens = 2000
      let transcript = ''
      let charBudget = maxTranscriptTokens * 4 // rough chars-to-tokens
      for (const m of messages) {
        const line = `${(m as any).role === 'user' ? 'User' : 'AEGIS'}: ${(m as any).content.slice(0, 300)}\n`
        if (transcript.length + line.length > charBudget) break
        transcript += line
      }

      //For long conversations, use hierarchical compression: split into phases
      let summarizationPrompt: string
      if (messages.length > 20) {
        //Split into 3 phases: opening, middle, closing
        const third = Math.floor(messages.length / 3)
        const phases = [
          messages.slice(0, third),
          messages.slice(third, third * 2),
          messages.slice(third * 2),
        ]
        const phaseDescriptions = phases.map((phase, i) => {
          const phaseMessages = phase.map((m: any) =>
            `${m.role === 'user' ? 'User' : 'AEGIS'}: ${m.content.slice(0, 150)}`,
          ).join('\n')
          return `Phase ${i + 1} (${['Opening', 'Middle', 'Closing'][i]}):\n${phaseMessages}`
        }).join('\n\n')

        summarizationPrompt =
          `Summarize this disaster-response conversation in 2-4 sentences. ` +
          `The conversation has ${messages.length} messages across 3 phases.\n\n` +
          `${phaseDescriptions}\n\n` +
          `Provide a structured summary covering: (1) what the user needed, ` +
          `(2) key information provided, (3) any unresolved concerns, ` +
          `(4) the user's emotional state. Be concise and factual.`
      } else {
        summarizationPrompt =
          `Summarize this disaster-response conversation in 1-3 sentences:\n\n` +
          `${transcript}\n\n` +
          `Cover: what the user asked about, key advice given, and any unresolved questions. Be concise.`
      }

      //Check for prior summaries - enable cross-session synthesis
      let crossSessionContext = ''
      if (citizenId) {
        const { rows: priorSummaries } = await pool.query(
          `SELECT summary FROM conversation_summaries
           WHERE citizen_id = $1 AND session_id != $2
           ORDER BY created_at DESC LIMIT 3`,
          [citizenId, sessionId],
        )
        if (priorSummaries.length > 0) {
          crossSessionContext =
            `\n\nThe user has had ${priorSummaries.length} prior conversation(s). ` +
            `Previous session summaries:\n` +
            priorSummaries.map((s: any, i: number) => `${i + 1}. ${s.summary}`).join('\n') +
            `\n\nNote any recurring themes or evolving concerns across sessions.`
        }
      }

      const llmResponse = await chatCompletion({
        messages: [
          { role: 'system', content: 'You are a concise summarizer for an emergency management chatbot. Output only the summary text, nothing else.' },
          { role: 'user', content: summarizationPrompt + crossSessionContext },
        ],
        maxTokens: 300,
        temperature: 0.3,
      })

      if (llmResponse.content && llmResponse.content.length > 20) {
        summary = llmResponse.content.trim()
        usedLLM = true
      }
    } catch (err) {
      logger.debug({ err }, '[Personalization] LLM summarization unavailable, using extractive fallback')
    }

    //Tier 3: Extractive fallback
    if (!summary) {
      const summaryParts: string[] = []
      if (userMessages.length > 0) {
        summaryParts.push(`User asked about: ${userMessages.slice(0, 3).map(m => m.slice(0, 80)).join('; ')}`)
      }
      if (topics.length > 0) {
        summaryParts.push(`Topics covered: ${topics.join(', ')}`)
      }
      summary = summaryParts.join('. ')
    }

    await pool.query(
      `INSERT INTO conversation_summaries
       (session_id, citizen_id, operator_id, summary, key_topics, key_entities,
        sentiment, unresolved_questions, action_items, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId,
        citizenId || null,
        operatorId || null,
        summary,
        topics,
        JSON.stringify(entities),
        sentiment,
        unresolvedQuestions,
        actionItems,
        messages.length,
      ],
    )

    //Mark session as summarized
    await pool.query(
      `UPDATE chat_sessions SET is_summarized = true, session_summary = $2 WHERE id = $1`,
      [sessionId, summary],
    )

    devLog(`[Personalization] Saved ${usedLLM ? 'LLM-based' : 'extractive'} summary for session ${sessionId}`)
  } catch (err) {
    logger.warn({ err }, '[Personalization] Failed to generate summary')
  }
}

function extractTopicsFromText(text: string): string[] {
  const topics: string[] = []
  const topicPatterns: Array<{ topic: string; pattern: RegExp }> = [
    { topic: 'flood', pattern: /\b(flood|flooding|river|water\s+level)\b/i },
    { topic: 'fire', pattern: /\b(fire|wildfire|blaze|burning)\b/i },
    { topic: 'storm', pattern: /\b(storm|wind|hurricane|tornado|lightning)\b/i },
    { topic: 'earthquake', pattern: /\b(earthquake|quake|tremor|seismic)\b/i },
    { topic: 'shelter', pattern: /\b(shelter|refuge|safe\s+place|evacuat)\b/i },
    { topic: 'medical', pattern: /\b(medical|injury|first\s+aid|hospital|ambulance)\b/i },
    { topic: 'mental_health', pattern: /\b(anxious|scared|trauma|stress|mental\s+health|grief)\b/i },
    { topic: 'preparedness', pattern: /\b(prepare|emergency\s+kit|plan|checklist)\b/i },
    { topic: 'weather', pattern: /\b(weather|forecast|temperature|rain)\b/i },
    { topic: 'power_outage', pattern: /\b(power|electricity|blackout|outage)\b/i },
    { topic: 'missing_person', pattern: /\b(missing|lost\s+person|wandered|search)\b/i },
    { topic: 'infrastructure', pattern: /\b(road|bridge|closed|blocked|damage)\b/i },
    { topic: 'supplies', pattern: /\b(food|water|supplies|provisions|resources)\b/i },
    { topic: 'chemical', pattern: /\b(chemical|spill|toxic|hazardous|pollution)\b/i },
  ]
  for (const { topic, pattern } of topicPatterns) {
    if (pattern.test(text)) topics.push(topic)
  }
  return [...new Set(topics)]
}

function extractEntitiesFromText(text: string): Record<string, string[]> {
  const entities: Record<string, string[]> = { locations: [], hazards: [], actions_taken: [] }

  //Locations
  const locationPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Road|Street|River|Bridge|Park|Hill|Valley))?)\b/g
  let match: RegExpExecArray | null
  const nonLocations = new Set(['The', 'You', 'We', 'They', 'AEGIS', 'Monday', 'Tuesday', 'Wednesday',
    'Thursday', 'Friday', 'Saturday', 'Sunday', 'Please', 'Thank', 'Hello', 'Help', 'Would', 'Could',
    'Should', 'Yes', 'No', 'Here', 'There', 'This', 'That', 'Now', 'When', 'What', 'Why', 'How'])
  while ((match = locationPattern.exec(text)) !== null) {
    if (!nonLocations.has(match[1]) && match[1].length > 2 && match[1].length < 50) {
      entities.locations.push(match[1])
    }
  }
  entities.locations = [...new Set(entities.locations)].slice(0, 10)

  return entities
}

function extractQuestions(text: string): string[] {
  const questions: string[] = []
  const sentences = text.split(/[.!?\n]+/)
  for (const s of sentences) {
    const trimmed = s.trim()
    if (trimmed.endsWith('?') || /^(?:would you|can you|do you|have you|are you|is there|what|where|when|how)/i.test(trimmed)) {
      if (trimmed.length >= 10 && trimmed.length <= 200) {
        questions.push(trimmed)
      }
    }
  }
  return questions.slice(0, 3)
}

function extractActionItems(text: string): string[] {
  const items: string[] = []
  const patterns = [
    /(?:you\s+should|make\s+sure\s+to|remember\s+to|don't\s+forget\s+to)\s+(.{10,80})/gi,
    /(?:call|contact|phone)\s+(.{5,50})/gi,
    /(?:check|monitor|watch)\s+(?:for\s+)?(.{5,50})/gi,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      items.push(match[1].trim().replace(/[.!?,]+$/, ''))
    }
  }
  return [...new Set(items)].slice(0, 5)
}

function detectOverallSentiment(messages: string[]): string {
  const allText = messages.join(' ').toLowerCase()
  const distressWords = ['scared', 'afraid', 'terrified', 'panic', 'help', 'emergency', 'trapped', 'danger', 'dying']
  const concernWords = ['worried', 'concerned', 'anxious', 'nervous', 'unsure']
  const positiveWords = ['thank', 'great', 'helpful', 'appreciate', 'better', 'safe']

  const distressCount = distressWords.filter(w => allText.includes(w)).length
  const concernCount = concernWords.filter(w => allText.includes(w)).length
  const positiveCount = positiveWords.filter(w => allText.includes(w)).length

  if (distressCount >= 2) return 'distressed'
  if (distressCount >= 1) return 'critical'
  if (concernCount >= 2) return 'concerned'
  if (positiveCount >= 2) return 'positive'
  return 'neutral'
}


export interface SmartSuggestion {
  text: string
  category: 'quick_action' | 'follow_up' | 'proactive' | 'topic_suggestion'
  icon?: string  // lucide icon name
  priority: number
}

/**
 * Generate personalized smart suggestions based on user context,
 * current situation, conversation history, and last bot response.
 * Uses dynamic context parsing to generate relevant follow-ups.
 */
export function generateSmartSuggestions(opts: {
  isAuthenticated: boolean
  memories: ChatMemory[]
  profile: BehaviorProfile | null
  lastBotMessage?: string
  currentAlerts?: number
  isEmergency?: boolean
  adminMode?: boolean
}): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = []

  if (opts.adminMode) {
    return generateAdminSuggestions(opts)
  }

  //Emergency-specific suggestions - immediate action oriented
  if (opts.isEmergency) {
    suggestions.push(
      { text: 'Share my location for help', category: 'quick_action', icon: 'MapPin', priority: 10 },
      { text: 'Find nearest shelter', category: 'quick_action', icon: 'Shield', priority: 9 },
      { text: 'Show evacuation routes', category: 'quick_action', icon: 'Map', priority: 8 },
    )
    return suggestions.slice(0, 4)
  }

  //Dynamic Context Parsing from Last Bot Message
  //Extract topics, entities, and actionable items from what the bot just said
  const botMsg = (opts.lastBotMessage || '').toLowerCase()
  const contextSuggestions: SmartSuggestion[] = []

  //Detect what the bot talked about and offer natural next steps
  const contextPatterns: Array<{ pattern: RegExp; suggestions: SmartSuggestion[] }> = [
    { pattern: /\b(flood|water level|river|gauge)\b/,
      suggestions: [
        { text: 'Show live river levels near me', category: 'follow_up', icon: 'Activity', priority: 8 },
        { text: 'Am I in a flood risk zone?', category: 'follow_up', icon: 'MapPin', priority: 7 },
      ] },
    { pattern: /\b(shelter|evacuation centre|refuge)\b/,
      suggestions: [
        { text: 'Navigate to nearest shelter', category: 'follow_up', icon: 'Navigation', priority: 8 },
        { text: 'What should I bring to a shelter?', category: 'follow_up', icon: 'Package', priority: 6 },
      ] },
    { pattern: /\b(weather|forecast|storm|rain|warning)\b/,
      suggestions: [
        { text: 'Show hourly forecast breakdown', category: 'follow_up', icon: 'Clock', priority: 7 },
        { text: 'Will conditions improve tomorrow?', category: 'follow_up', icon: 'TrendingUp', priority: 6 },
      ] },
    { pattern: /\b(road|route|closed|traffic|bridge)\b/,
      suggestions: [
        { text: 'Find alternative routes', category: 'follow_up', icon: 'Navigation', priority: 8 },
        { text: 'Which roads are open right now?', category: 'follow_up', icon: 'Map', priority: 7 },
      ] },
    { pattern: /\b(power|outage|electric|blackout)\b/,
      suggestions: [
        { text: 'When will power be restored?', category: 'follow_up', icon: 'Zap', priority: 8 },
        { text: 'Where can I charge my phone?', category: 'follow_up', icon: 'Battery', priority: 6 },
      ] },
    { pattern: /\b(prepar|emergency kit|supplies|stock)\b/,
      suggestions: [
        { text: 'Create my emergency kit checklist', category: 'follow_up', icon: 'CheckSquare', priority: 7 },
        { text: 'What hazards affect my area?', category: 'follow_up', icon: 'AlertTriangle', priority: 6 },
      ] },
    { pattern: /\b(injur|first.?aid|medic|hospital)\b/,
      suggestions: [
        { text: 'Find nearest hospital', category: 'follow_up', icon: 'Plus', priority: 9 },
        { text: 'Show first aid steps', category: 'follow_up', icon: 'Heart', priority: 7 },
      ] },
    { pattern: /\b(wildfire|fire|smoke|burn)\b/,
      suggestions: [
        { text: 'Check air quality index', category: 'follow_up', icon: 'Wind', priority: 8 },
        { text: 'Show fire evacuation routes', category: 'follow_up', icon: 'Navigation', priority: 9 },
      ] },
    { pattern: /\b(earthquake|quake|aftershock)\b/,
      suggestions: [
        { text: 'Is my building safe to re-enter?', category: 'follow_up', icon: 'Home', priority: 8 },
        { text: 'Check for aftershock warnings', category: 'follow_up', icon: 'Activity', priority: 7 },
      ] },
    { pattern: /\b(insurance|damage|claim|report)\b/,
      suggestions: [
        { text: 'How to document damage for claims', category: 'follow_up', icon: 'Camera', priority: 7 },
        { text: 'Report property damage', category: 'follow_up', icon: 'FileText', priority: 6 },
      ] },
  ]

  for (const { pattern, suggestions: ctxSugg } of contextPatterns) {
    if (pattern.test(botMsg)) {
      for (const s of ctxSugg) {
        if (!contextSuggestions.some(cs => cs.text === s.text)) {
          contextSuggestions.push(s)
        }
      }
    }
  }

  //Add context-based suggestions first (they're most relevant)
  suggestions.push(...contextSuggestions)

  //Proactive suggestions based on active alerts
  if (opts.currentAlerts && opts.currentAlerts > 0) {
    suggestions.push({
      text: `Check ${opts.currentAlerts} active alert${opts.currentAlerts > 1 ? 's' : ''} in my area`,
      category: 'proactive',
      icon: 'AlertTriangle',
      priority: 8,
    })
  }

  //Personalized suggestions based on profile
  if (opts.profile) {
    if (opts.profile.knownLocations.length > 0) {
      const loc = opts.profile.knownLocations[0]
      if (!suggestions.some(s => s.text.includes(loc.name))) {
        suggestions.push({
          text: `Check conditions near ${loc.name}`,
          category: 'proactive',
          icon: 'MapPin',
          priority: 7,
        })
      }
    }

    if (opts.profile.primaryTopics.includes('flood') && !suggestions.some(s => s.text.includes('river'))) {
      suggestions.push({ text: 'Check river levels near me', category: 'topic_suggestion', icon: 'Waves', priority: 6 })
    }
    if (opts.profile.primaryTopics.includes('weather') && !suggestions.some(s => s.text.includes('forecast'))) {
      suggestions.push({ text: 'Get today\'s weather forecast', category: 'topic_suggestion', icon: 'Cloud', priority: 5 })
    }

    if (opts.profile.knownVulnerabilities.includes('medical_equipment')) {
      suggestions.push({ text: 'Check power outage status', category: 'proactive', icon: 'Zap', priority: 7 })
    }
  }

  //Memory-based suggestions
  if (opts.memories.length > 0) {
    const hasFloodMemory = opts.memories.some(m => m.content.toLowerCase().includes('flood'))
    if (hasFloodMemory && !suggestions.some(s => s.text.includes('flood'))) {
      suggestions.push({ text: 'Update on flood risk for my area', category: 'proactive', icon: 'Droplets', priority: 6 })
    }
  }

  //Default suggestions for authenticated users - only if we don't have enough context-driven ones
  if (opts.isAuthenticated && suggestions.length < 3) {
    suggestions.push(
      { text: 'What alerts are active near me?', category: 'quick_action', icon: 'Bell', priority: 4 },
      { text: 'How do I prepare an emergency kit?', category: 'topic_suggestion', icon: 'Package', priority: 3 },
      { text: 'Upload a photo for safety analysis', category: 'quick_action', icon: 'Camera', priority: 3 },
    )
  }

  //Default suggestions for anonymous users
  if (!opts.isAuthenticated && suggestions.length < 3) {
    suggestions.push(
      { text: 'What should I do in a flood?', category: 'topic_suggestion', icon: 'Droplets', priority: 3 },
      { text: 'Emergency contacts', category: 'quick_action', icon: 'Phone', priority: 3 },
      { text: 'Check weather warnings', category: 'quick_action', icon: 'Cloud', priority: 3 },
    )
  }

  //Deduplicate by text, sort by priority, return top 4
  const seen = new Set<string>()
  return suggestions
    .filter(s => { if (seen.has(s.text)) return false; seen.add(s.text); return true })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4)
}

function generateAdminSuggestions(opts: any): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = [
    { text: 'Generate situation report', category: 'quick_action', icon: 'FileText', priority: 9 },
    { text: 'Show all active incidents', category: 'quick_action', icon: 'AlertTriangle', priority: 8 },
    { text: 'Resource deployment status', category: 'quick_action', icon: 'Users', priority: 7 },
    { text: 'Citizen sentiment analysis', category: 'quick_action', icon: 'BarChart', priority: 6 },
    { text: 'Incident trend analysis (24h)', category: 'topic_suggestion', icon: 'TrendingUp', priority: 5 },
    { text: 'Predict resource needs for next 6h', category: 'proactive', icon: 'Brain', priority: 5 },
  ]
  return suggestions.slice(0, 5)
}


export async function logSuggestionClick(
  sessionId: string | undefined,
  citizenId: string | undefined,
  suggestionText: string,
  category: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO chat_suggestion_clicks (session_id, citizen_id, suggestion_text, category)
       VALUES ($1, $2, $3, $4)`,
      [sessionId || null, citizenId || null, suggestionText, category],
    )
  } catch {
    //Best-effort logging
  }
}


export interface EpisodicMemory {
  id: string
  eventType: string  // 'flood_report', 'evacuation', 'shelter_visit', 'damage_report', etc.
  summary: string
  location?: string
  severity?: string
  occurredAt: Date
  outcome?: string
  relatedAlertId?: string
}

/**
 * Save an episodic memory - a specific incident the citizen experienced.
 * These are higher-level than chat memories: "Last March you reported flooding on your street"
 */
export async function saveEpisodicMemory(
  citizenId: string,
  episode: Omit<EpisodicMemory, 'id'>,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO citizen_episodic_memory
       (citizen_id, event_type, summary, location, severity, occurred_at, outcome, related_alert_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [citizenId, episode.eventType, episode.summary, episode.location || null,
       episode.severity || null, episode.occurredAt, episode.outcome || null,
       episode.relatedAlertId || null],
    )
  } catch (err) {
    devLog(`[Episodic] Failed to save episode: ${(err as Error).message}`)
  }
}

/**
 * Load episodic memories for a citizen - past incidents they personally experienced.
 * Returns the 15 most recent/important episodes for context injection.
 */
export async function loadEpisodicMemories(citizenId: string): Promise<EpisodicMemory[]> {
  try {
    const { rows } = await pool.query(
      `SELECT id, event_type, summary, location, severity, occurred_at, outcome, related_alert_id
       FROM citizen_episodic_memory
       WHERE citizen_id = $1
       ORDER BY occurred_at DESC
       LIMIT 15`,
      [citizenId],
    )
    return rows.map((r: any) => ({
      id: r.id,
      eventType: r.event_type,
      summary: r.summary,
      location: r.location,
      severity: r.severity,
      occurredAt: r.occurred_at,
      outcome: r.outcome,
      relatedAlertId: r.related_alert_id,
    }))
  } catch {
    return []
  }
}

/**
 * Build episodic memory context for system prompt injection.
 */
export function buildEpisodicContext(episodes: EpisodicMemory[]): string {
  if (episodes.length === 0) return ''

  const lines = episodes.map(ep => {
    const date = new Date(ep.occurredAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const loc = ep.location ? ` near ${ep.location}` : ''
    const outcome = ep.outcome ? ` - Outcome: ${ep.outcome}` : ''
    return `- ${date}: ${ep.summary}${loc} (${ep.severity || 'unknown'} severity)${outcome}`
  })

  return `\n\n[EPISODIC MEMORY - PAST INCIDENTS THIS CITIZEN EXPERIENCED]
${lines.join('\n')}
Use this history proactively: if current conditions match a past incident, reference it naturally ("Similar conditions to the ${episodes[0]?.eventType || 'incident'} you experienced previously - here's what's different this time..."). This builds trust and shows genuine awareness.`
}

/**
 * Extract potential episodes from the conversation automatically.
 * Called after each chat response to detect incident-related statements.
 */
export async function extractEpisodicEvents(
  citizenId: string,
  message: string,
  botReply: string,
  sessionContext?: { activeAlerts?: any[]; location?: string },
): Promise<void> {
  const lowerMsg = message.toLowerCase()

  //Patterns that indicate the citizen is experiencing/reporting a real incident
  const episodePatterns: Array<{ pattern: RegExp; type: string; severity: string }> = [
    { pattern: /(?:my (?:home|house|street|road|garden|basement|flat) is (?:flooding|flooded|underwater))/i, type: 'flood_personal', severity: 'high' },
    { pattern: /(?:water (?:is )?coming (?:in|into|through))/i, type: 'flood_personal', severity: 'high' },
    { pattern: /(?:had to|we) evacuate/i, type: 'evacuation', severity: 'critical' },
    { pattern: /(?:went to|staying at|checked into) (?:a |the )?(?:shelter|evacuation (?:centre|center))/i, type: 'shelter_visit', severity: 'high' },
    { pattern: /(?:lost|damaged|destroyed) (?:my |our )?(?:home|house|car|property|belongings)/i, type: 'property_damage', severity: 'high' },
    { pattern: /(?:power|electricity) (?:is |has been |went )?(?:out|off|down|cut)/i, type: 'power_outage', severity: 'medium' },
    { pattern: /(?:fire|wildfire|bushfire) (?:near|close|approaching|threatening)/i, type: 'wildfire_threat', severity: 'critical' },
    { pattern: /(?:earthquake|tremor|shaking) (?:just )?(?:happened|felt|hit)/i, type: 'earthquake', severity: 'high' },
    { pattern: /(?:storm|tornado|hurricane|cyclone) (?:hit|came|struck|damage)/i, type: 'severe_storm', severity: 'high' },
    { pattern: /(?:landslide|mudslide|rockslide) (?:on|near|behind|blocked)/i, type: 'landslide', severity: 'high' },
    { pattern: /(?:tree|pole|wall) (?:fell|collapsed|came down|blocking)/i, type: 'structural_damage', severity: 'medium' },
    { pattern: /(?:road|bridge) (?:is )?(?:closed|blocked|impassable|washed)/i, type: 'infrastructure', severity: 'medium' },
    { pattern: /(?:water (?:supply|main) )?(?:burst|contaminated|no water|brown water)/i, type: 'water_supply', severity: 'medium' },
    { pattern: /(?:gas leak|smell(?:ing)? gas|chemical spill)/i, type: 'hazmat', severity: 'critical' },
  ]

  for (const { pattern, type, severity } of episodePatterns) {
    if (pattern.test(lowerMsg)) {
      const summary = message.length > 200 ? message.slice(0, 200) + '...' : message
      await saveEpisodicMemory(citizenId, {
        eventType: type,
        summary,
        location: sessionContext?.location || undefined,
        severity,
        occurredAt: new Date(),
        outcome: undefined,
        relatedAlertId: sessionContext?.activeAlerts?.[0]?.id,
      })
      devLog(`[Episodic] Saved episode: ${type} (${severity}) for citizen ${citizenId.slice(0, 8)}`)
      break // One episode per message to avoid duplicates
    }
  }
}
