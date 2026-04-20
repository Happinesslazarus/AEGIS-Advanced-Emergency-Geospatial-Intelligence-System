/**
 * Response quality scoring, follow-up question generation, and session analytics.
 *
 * scoreResponseQuality() rates responses on 6 dimensions.
 * generateFollowUpQuestions() suggests contextual next questions.
 * recordAnalytics() / getSessionAnalytics() maintain per-session stats.
 */
import type { ResponseQualityScore, ConversationAnalytics } from '../types/index.js'
import type { EmergencyDetection } from '../types/index.js'
import type { AgentType } from './chatAgentRouter.js'
import { regionMeta } from './chatConstants.js'

 /*
 * Generate 2-3 contextual follow-up questions based on the conversation
 * context and the latest assistant response.
 * Uses deep context analysis: unresolved topics, mentioned entities,
 * available tools, and urgency-aware routing.
  */
export function generateFollowUpQuestions(
  userMessage: string,
  assistantReply: string,
  emergency: EmergencyDetection,
  agentType: AgentType,
): string[] {
  const questions: string[] = []
  const lower = userMessage.toLowerCase()
  const replyLower = assistantReply.toLowerCase()

  // Emergency context follow-ups — urgency-aware, escalating
  if (emergency.isEmergency) {
    if (emergency.type === 'flood') {
      questions.push('Are you on higher ground now? Do you need help finding an evacuation route?')
      questions.push('How many people are with you? Is anyone injured or unable to move?')
      if (replyLower.includes('river') || replyLower.includes('level'))
        questions.push('Would you like me to monitor river levels and alert you if they rise further?')
    } else if (emergency.type === 'fire') {
      questions.push('Have you been able to evacuate the building? Is everyone accounted for?')
      questions.push('Do you need directions to the nearest emergency assembly point?')
    } else if (emergency.type === 'medical') {
      questions.push('Is the person conscious and breathing? Can you describe their symptoms?')
      questions.push('Do you know if they have any allergies or pre-existing conditions?')
    } else if (emergency.type === 'trapped') {
      questions.push('Can you share your exact location or GPS coordinates?')
      questions.push('Do you have access to water? Can you signal to rescuers?')
    } else {
      questions.push(`Have you been able to reach ${regionMeta.emergencyNumber}?`)
      questions.push('Can you describe your current location so we can provide specific guidance?')
    }
    return questions.slice(0, 3)
  }

  // Deep Context Analysis
  // Extract what the user asked about and what the bot discussed
  const topicPatterns: Array<{ pattern: RegExp; topic: string; followUps: string[] }> = [
    { pattern: /\b(flood|flooding|water level|river)\b/i, topic: 'flood',
      followUps: ['Would you like a personalised flood preparedness checklist for your area?', 'Should I check real-time river levels near your location?'] },
    { pattern: /\b(shelter|evacuat|refuge|safe place)\b/i, topic: 'shelter',
      followUps: ['Would you like me to find the nearest shelter and check its current capacity?', 'Do you need directions or an evacuation route to get there safely?'] },
    { pattern: /\b(weather|forecast|storm|rain|wind|temperat)\b/i, topic: 'weather',
      followUps: ['Would you like a detailed multi-day forecast for your area?', 'Should I set up weather alerts to notify you of changes?'] },
    { pattern: /\b(power|electric|outage|blackout)\b/i, topic: 'power',
      followUps: ['Would you like me to check the current power outage map for your area?', 'Do you have medical equipment that depends on electricity?'] },
    { pattern: /\b(road|route|travel|transport|bridge|highway)\b/i, topic: 'transport',
      followUps: ['Would you like me to check which roads are currently open or closed?', 'Should I find alternative routes to avoid affected areas?'] },
    { pattern: /\b(supply|food|water|distribute|provision)\b/i, topic: 'supplies',
      followUps: ['Would you like me to find the nearest supply distribution point?', 'Do you need information about what supplies are available?'] },
    { pattern: /\b(injur|hurt|medic|first.?aid|hospital|health)\b/i, topic: 'medical',
      followUps: ['Would you like me to find the nearest hospital or medical facility?', 'Do you need first-aid guidance for a specific type of injury?'] },
    { pattern: /\b(prepar|kit|plan|ready|stock)\b/i, topic: 'preparedness',
      followUps: ['Would you like me to create a personalised emergency kit checklist?', 'Should I assess the specific hazard risks for your area?'] },
    { pattern: /\b(wildfire|fire|smoke|burn)\b/i, topic: 'wildfire',
      followUps: ['Would you like to check the current fire danger rating for your area?', 'Should I find the nearest fire-safe assembly point?'] },
    { pattern: /\b(earthquake|quake|tremor|seismic)\b/i, topic: 'earthquake',
      followUps: ['Would you like me to check recent seismic activity near you?', 'Do you need guidance on structural safety assessment after a quake?'] },
    { pattern: /\b(landslide|mudslide|erosion|slope)\b/i, topic: 'landslide',
      followUps: ['Would you like me to check soil saturation levels and landslide risk in your area?', 'Should I find safe zones away from unstable terrain?'] },
  ]

  // Match topics from both user message and bot reply
  const matchedTopics = new Set<string>()
  for (const { pattern, topic, followUps } of topicPatterns) {
    if (pattern.test(lower) || pattern.test(replyLower)) {
      matchedTopics.add(topic)
      for (const fu of followUps) {
        if (!questions.some(q => q.includes(fu.slice(0, 30)))) {
          questions.push(fu)
        }
      }
    }
  }

  // Unresolved Topic Detection
  // If the bot mentioned something but didn't fully address it
  const unresolvedPatterns: Array<{ trigger: RegExp; question: string }> = [
    { trigger: /\bcontact\b.*\b(local|council|authorit)/i, question: 'Would you like me to look up the specific contact details for your local authority?' },
    { trigger: /\bmore information\b/i, question: 'What specific details would be most helpful for your situation?' },
    { trigger: /\bdepends on\b.*\blocation\b/i, question: 'Could you share your location or postcode so I can give you specific guidance?' },
    { trigger: /\bcheck with\b/i, question: 'Would you like me to look that up for you right now?' },
    { trigger: /\binsurance\b/i, question: 'Would you like guidance on documenting damage for insurance claims?' },
    { trigger: /\bvolunteer\b/i, question: 'Would you like information about local volunteer groups or how to offer help?' },
  ]

  for (const { trigger, question } of unresolvedPatterns) {
    if (trigger.test(replyLower) && !questions.some(q => q === question)) {
      questions.push(question)
    }
  }

  // Tool-Aware Suggestions
  // Suggest follow-ups that leverage available tools the bot hasn't used yet
  if (!replyLower.includes('river level') && !replyLower.includes('gauge') && matchedTopics.has('flood')) {
    questions.push('Should I pull live river gauge data to check current water levels?')
  }
  if (!replyLower.includes('route') && !replyLower.includes('evacuation') && (matchedTopics.has('shelter') || matchedTopics.has('transport'))) {
    questions.push('Would you like me to calculate the fastest route from your location?')
  }
  if (lower.includes('image') || lower.includes('photo') || lower.includes('picture')) {
    questions.push('You can upload a photo and I\'ll analyze it for safety assessment — would you like to try that?')
  }

  // Agent-Specific Contextual Follow-ups
  if (agentType === 'preparedness_coach' && questions.length < 2) {
    questions.push('Would you like information about community emergency groups in your area?')
  }
  if (agentType === 'trauma_support') {
    questions.push('How are you feeling right now? Would you like me to connect you with support services?')
  }
  if (agentType === 'logistics_coordinator' && !questions.some(q => q.includes('supply'))) {
    questions.push('Do you need information about supply distribution points near you?')
  }

  // Deduplicate and limit — prioritize topic-matched over generic
  const unique = [...new Set(questions)]
  return unique.slice(0, 3)
}


 /*
 * Score the chatbot's own response quality across multiple dimensions.
 * Uses semantic analysis, structural checks, and completeness detection.
  */
export function scoreResponseQuality(
  userMessage: string,
  assistantReply: string,
  toolsUsed: string[],
  safetyFlags: string[],
  liveContextUsed: boolean,
): ResponseQualityScore {
  const replyLower = assistantReply.toLowerCase()
  const userLower = userMessage.toLowerCase()

  // 1. Relevance: TF-IDF semantic similarity + keyword overlap hybrid
  const userWords = new Set(userLower.split(/\s+/).filter(w => w.length > 3))
  const replyWords = new Set(replyLower.split(/\s+/).filter(w => w.length > 3))
  let overlapCount = 0
  for (const word of userWords) {
    if (replyWords.has(word)) overlapCount++
  }
  const keywordRelevance = userWords.size > 0
    ? Math.min(1, (overlapCount / userWords.size) * 1.5 + 0.3)
    : 0.5

  // Semantic relevance: check if key user nouns/entities appear in reply paraphrased
  const userNouns = userLower.match(/\b(?:flood|storm|fire|shelter|evacuation|hospital|road|bridge|power|water|weather|alert|warning|river|rain|wind)\b/g) || []
  const semanticHits = userNouns.filter(noun => {
    const synonymMap: Record<string, string[]> = {
      flood: ['flooding', 'floodwater', 'inundation', 'water level'],
      storm: ['severe weather', 'high winds', 'thunderstorm', 'gale'],
      fire: ['wildfire', 'blaze', 'burning', 'flames'],
      shelter: ['refuge', 'safe place', 'accommodation', 'emergency centre'],
      evacuation: ['evacuate', 'leave', 'move to safety', 'route'],
      hospital: ['medical', 'a&e', 'health facility', 'clinic'],
      road: ['route', 'highway', 'street', 'path'],
      power: ['electricity', 'grid', 'outage', 'blackout'],
      water: ['supply', 'contamination', 'drinking', 'boil'],
      weather: ['forecast', 'conditions', 'temperature', 'precipitation'],
      alert: ['warning', 'notification', 'advisory'],
      warning: ['alert', 'advisory', 'caution'],
    }
    const synonyms = synonymMap[noun] || []
    return replyLower.includes(noun) || synonyms.some(s => replyLower.includes(s))
  })
  const semanticRelevance = userNouns.length > 0 ? semanticHits.length / userNouns.length : 0.5
  const relevance = Math.min(1, keywordRelevance * 0.5 + semanticRelevance * 0.5)

  // 2. Actionability: does the response contain concrete steps?
  const actionIndicators = [
    /\b(step \d|first|then|next|finally)\b/i,
    /\b(call|go to|move to|avoid|do not|check|contact|visit)\b/i,
    /(\d+\.)\s/,
    /\*\*/,
    /\b(immediately|now|right away|as soon as possible)\b/i,
    /[\u2705\u26A0\u2757\u{1F6A8}\u{1F534}\u{1F7E2}]/u,  // Action-oriented emoji
  ]
  const actionMatchCount = actionIndicators.filter(p => p.test(assistantReply)).length
  const actionability = Math.min(1, actionMatchCount * 0.18)

  // 3. Data recency: is it citing current/live data?
  const recencyIndicators = [
    toolsUsed.length > 0,
    liveContextUsed,
    /\b(current|latest|now|today|as of)\b/i.test(assistantReply),
    /\b(according to|source:|data shows)\b/i.test(assistantReply),
    /\d{1,2}[:/]\d{2}/.test(assistantReply), // contains timestamps
  ]
  const recencyMatchCount = recencyIndicators.filter(Boolean).length
  const dataRecency = Math.min(1, recencyMatchCount * 0.25)

  // 4. Safety compliance
  const safetyCompliance = safetyFlags.length === 0 ? 1.0 : 0.2

  // 5. Completeness: did the response address all parts of the user's question?
  const userQuestionMarks = (userMessage.match(/\?/g) || []).length
  const userAndSeparators = (userMessage.match(/\b(and|also|plus|additionally)\b/gi) || []).length
  const expectedParts = Math.max(1, userQuestionMarks + userAndSeparators)
  const responseParagraphs = assistantReply.split(/\n\n+/).filter(p => p.trim().length > 20).length
  const completeness = Math.min(1, responseParagraphs / expectedParts)

  // 6. Empathy: appropriate tone markers
  const empathyIndicators = [
    /\b(understand|sorry to hear|i can help|let me|here's what|stay safe)\b/i,
    /\b(important|critical|please|ensure|make sure)\b/i,
  ]
  const empathy = Math.min(1, empathyIndicators.filter(p => p.test(assistantReply)).length * 0.5)

  // Overall weighted score (6 dimensions)
  const overall = relevance * 0.25 + actionability * 0.2 + dataRecency * 0.15 +
    safetyCompliance * 0.15 + completeness * 0.15 + empathy * 0.1

  return {
    relevance: Math.round(relevance * 100) / 100,
    actionability: Math.round(actionability * 100) / 100,
    dataRecency: Math.round(dataRecency * 100) / 100,
    safetyCompliance: Math.round(safetyCompliance * 100) / 100,
    overall: Math.round(overall * 100) / 100,
  }
}


// In-memory analytics store (per-session). Resets on server restart — intended for
// operational monitoring, not permanent storage.
export const sessionAnalytics: Map<string, {
  responseTimes: number[]
  toolUsage: Record<string, number>
  agentDistribution: Record<string, number>
  emergencyCount: number
  topicShiftCount: number
  messageCount: number
}> = new Map()

export function getOrCreateSessionAnalytics(sessionId: string) {
  if (!sessionAnalytics.has(sessionId)) {
    sessionAnalytics.set(sessionId, {
      responseTimes: [],
      toolUsage: {},
      agentDistribution: {},
      emergencyCount: 0,
      topicShiftCount: 0,
      messageCount: 0,
    })
  }
  return sessionAnalytics.get(sessionId)!
}

export function recordAnalytics(
  sessionId: string,
  latencyMs: number,
  toolsUsed: string[],
  agentName: string,
  emergencyDetected: boolean,
  topicShiftDetected: boolean,
): ConversationAnalytics {
  const analytics = getOrCreateSessionAnalytics(sessionId)

  analytics.responseTimes.push(latencyMs)
  analytics.messageCount++

  for (const tool of toolsUsed) {
    analytics.toolUsage[tool] = (analytics.toolUsage[tool] || 0) + 1
  }
  analytics.agentDistribution[agentName] = (analytics.agentDistribution[agentName] || 0) + 1

  if (emergencyDetected) analytics.emergencyCount++
  if (topicShiftDetected) analytics.topicShiftCount++

  return {
    responseLatencyMs: latencyMs,
    toolsInvoked: toolsUsed,
    agentUsed: agentName,
    emergencyDetected,
    topicShiftDetected,
    sessionMessageCount: analytics.messageCount,
  }
}

 /*
 * Get aggregated analytics for a session — exported for monitoring endpoints.
  */
export function getSessionAnalytics(sessionId: string): {
  averageLatencyMs: number
  toolUsageFrequency: Record<string, number>
  agentRoutingDistribution: Record<string, number>
  emergencyDetectionRate: number
  totalMessages: number
} | null {
  const analytics = sessionAnalytics.get(sessionId)
  if (!analytics || analytics.messageCount === 0) return null

  const avgLatency = analytics.responseTimes.length > 0
    ? analytics.responseTimes.reduce((a, b) => a + b, 0) / analytics.responseTimes.length
    : 0

  return {
    averageLatencyMs: Math.round(avgLatency),
    toolUsageFrequency: { ...analytics.toolUsage },
    agentRoutingDistribution: { ...analytics.agentDistribution },
    emergencyDetectionRate: analytics.emergencyCount / analytics.messageCount,
    totalMessages: analytics.messageCount,
  }
}

