/**
 * Core orchestration for the AEGIS chat service.
 *
 * Coordinates the full request pipeline: live context injection, RAG retrieval,
 * safety checks, agent routing, emergency detection, LLM completion, quality
 * scoring, analytics, and streaming.
 *
 * Public API:
 * - processChat()              — single-turn completion, returns JSON
 * - processChatStream()        — streaming completion via SSE
 * - getChatHistory()           — loads previous messages for a session
 * - listSessions()             — lists a user's chat sessions
 * - endChatSession()           — closes session, generates AI summary
 *
 * Routes:
 * - server/src/routes/chatRoutes.ts          — HTTP and SSE endpoints
 * - server/src/services/llmRouter.ts         — LLM provider selection
 * - server/src/services/personalizationEngine.ts — user memory and behaviour
 */
import pool from '../models/db.js'
import {
  chatCompletion,
  chatCompletionStream,
  classifyQuery,
  preloadModelForClassification,
} from './llmRouter.js'
import { classify } from './classifierRouter.js'
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types/index.js'
import crypto from 'crypto'
import { devLog } from '../utils/logger.js'
import { logger } from './logger.js'
import { logSecurityEvent } from './securityLogger.js'
import {
  loadCitizenMemories, extractAndSaveMemories, buildMemoryContext,
  loadBehaviorProfile, loadOperatorProfile, buildBehaviorContext,
  updateBehaviorProfile, updateOperatorProfile,
  loadRecentSummaries, buildSummaryContext, generateAndSaveSummary,
  loadEpisodicMemories, buildEpisodicContext, extractEpisodicEvents,
  generateSmartSuggestions, logSuggestionClick,
  type ChatMemory, type BehaviorProfile, type SmartSuggestion,
} from './personalizationEngine.js'
import {
  COMPACT_SYSTEM_PROMPT,
  CREATOR_PROFILE,
  COMPACT_ADMIN_ADDENDUM,
  MAX_TOKENS_PER_SESSION,
  SESSION_BUDGET_EXCEEDED_MESSAGE,
  regionMeta,
  llmCtx,
} from './chatConstants.js'
import { buildLiveContext } from './chatLiveContext.js'
import {
  AVAILABLE_TOOLS,
  ADMIN_TOOLS,
  executeToolCall,
  executeImageAnalysis,
  sessionImageMemory,
  buildImageMemoryContext,
  storeImageAnalysis,
  executeCompositeToolCalls,
} from './chatTools.js'
import { retrieveRAGContext } from './chatRag.js'
import { hashQuery, getCachedResponse, cacheResponse, getQueryEmbedding } from './chatCache.js'
import {
  sanitizeUserInput,
  detectPromptInjection,
  validateOutputSafety,
  redactPii,
  reinjectPii,
  getSessionTokenState,
  checkSafety,
  verifyResponseConsistency,
  generateLocalFallback,
  type PiiReplacement,
} from './chatSafety.js'
export { getChatSessionBudget } from './chatSafety.js'
import { AGENTS, AGENT_CONFIDENCE_THRESHOLD, routeToAgent } from './chatAgentRouter.js'
import type { AgentType, EmotionLabel } from './chatAgentRouter.js'
import { detectEmergency, buildEmergencyPreamble } from './chatEmergency.js'
import {
  inferDialogueState,
  buildDialogueStateContext,
  loadUserProfile,
  updateUserProfile,
  buildUserProfileContext,
  manageConversationMemory,
  detectTopicShift,
  type UserProfile,
  type ConversationMemory,
} from './chatDialogue.js'
import {
  generateFollowUpQuestions,
  scoreResponseQuality,
  recordAnalytics,
} from './chatQuality.js'
export { getSessionAnalytics } from './chatQuality.js'

 /*
 * Process a chat message through the full pipeline:
 * cache check ? emergency detection ? RAG retrieval ? conversation memory ?
 * LLM completion ? tool execution ? safety filter ? quality scoring ? persist
  */
export async function processChat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  const startTime = Date.now()
  const sanitizedMessage = sanitizeUserInput(req.message)
  const injectionFlags = detectPromptInjection(sanitizedMessage)
  if (injectionFlags.length > 0) {
    await logSecurityEvent({
      userId: req.citizenId || req.operatorId,
      userType: req.citizenId ? 'citizen' : req.operatorId ? 'operator' : undefined,
      eventType: 'suspicious_activity',
      metadata: { reason: 'prompt_injection_blocked', patterns: injectionFlags, inputPreview: sanitizedMessage.slice(0, 200) },
    })

    return {
      sessionId: req.sessionId || '',
      reply: 'I cannot help with instruction override attempts. I can help with emergency preparedness, local alerts, and safety planning instead.',
      model: 'policy-block',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: ['prompt_injection_blocked'],
      budgetUsed: 0,
      budgetLimit: MAX_TOKENS_PER_SESSION,
      budgetRemaining: MAX_TOKENS_PER_SESSION,
    }
  }

  // Emergency detection — run early so we can influence the entire response
  const emergency = detectEmergency(sanitizedMessage)

  const queryHash = hashQuery(sanitizedMessage)

  // Check cache first (skip cache for emergencies — always provide live data)
  if (!emergency.isEmergency) {
    // Layer 1: Exact hash match
    const cached = await getCachedResponse(queryHash)
    if (cached) {
      return {
        sessionId: req.sessionId || '',
        reply: cached,
        model: 'cache',
        tokensUsed: 0,
        toolsUsed: [],
        sources: [],
        safetyFlags: [],
        budgetUsed: 0,
        budgetLimit: MAX_TOKENS_PER_SESSION,
        budgetRemaining: MAX_TOKENS_PER_SESSION,
      }
    }

    // Layer 2: Semantic similarity cache — find cached responses with similar meaning
    try {
      const { rows: similar } = await pool.query(
        `SELECT query_hash, response_text,
                1 - (embedding_vector <=> $1::vector) as similarity
         FROM response_cache
         WHERE embedding_vector IS NOT NULL
           AND expires_at > now()
           AND 1 - (embedding_vector <=> $1::vector) > 0.92
         ORDER BY similarity DESC LIMIT 1`,
        [await getQueryEmbedding(sanitizedMessage)],
      )
      if (similar.length > 0) {
        // Bump hit count on the matched cache entry
        pool.query(`UPDATE response_cache SET hit_count = hit_count + 1 WHERE query_hash = $1`, [similar[0].query_hash]).catch(() => {})
        devLog(`[Chat] Semantic cache hit (similarity: ${similar[0].similarity.toFixed(3)})`)
        return {
          sessionId: req.sessionId || '',
          reply: similar[0].response_text,
          model: 'semantic-cache',
          tokensUsed: 0,
          toolsUsed: [],
          sources: [],
          safetyFlags: [],
          budgetUsed: 0,
          budgetLimit: MAX_TOKENS_PER_SESSION,
          budgetRemaining: MAX_TOKENS_PER_SESSION,
        }
      }
    } catch {
      // Semantic cache is best-effort — proceed if embedding fails
    }
  }

  // Get or create session
  let sessionId = req.sessionId
  if (sessionId) {
    // Check if session exists; if not, create it with the provided ID
    const existing = await pool.query(`SELECT id FROM chat_sessions WHERE id = $1`, [sessionId])
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO chat_sessions (id, citizen_id, operator_id, title, model_used)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [sessionId, req.citizenId || null, req.operatorId || null, sanitizedMessage.slice(0, 100)],
      )
    }
  } else {
    const result = await pool.query(
      `INSERT INTO chat_sessions (citizen_id, operator_id, title, model_used)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [req.citizenId || null, req.operatorId || null, sanitizedMessage.slice(0, 100)],
    )
    sessionId = result.rows[0].id
  }

  const sessionTokenState = await getSessionTokenState(sessionId!)
  if (sessionTokenState.exceeded) {
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
       VALUES ($1, 'assistant', $2, 'token-budget-limit', 0, 0)`,
      [sessionId, SESSION_BUDGET_EXCEEDED_MESSAGE],
    )

    return {
      sessionId: sessionId!,
      reply: SESSION_BUDGET_EXCEEDED_MESSAGE,
      model: 'token-budget-limit',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: ['session_budget_exceeded'],
      budgetUsed: sessionTokenState.used,
      budgetLimit: sessionTokenState.limit,
      budgetRemaining: 0,
    }
  }

  // Persist user message
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
    [sessionId, sanitizedMessage],
  )

  // Skip RAG for document-analysis messages — the document itself is the context;
  // searching the emergency knowledge base with lecture/PDF text only adds noise.
  const isDocumentUpload = sanitizedMessage.includes('[DOCUMENT UPLOAD')
  const ragContext = isDocumentUpload ? '' : await retrieveRAGContext(sanitizedMessage)

  // Build live situational context from DB
  const liveContext = await buildLiveContext()

  // Auto-execute image analysis when citizen attaches a photo
  // Instead of relying on the LLM to decide to call the tool, we proactively
  // run vision analysis and inject the result so the LLM always has it.
  let imageAnalysisContext = ''
  let rawVisionHeader = ''  // Prepended to reply so structured data is always present
  const imageMarkerMatch = sanitizedMessage.match(/\[The citizen attached an image:\s*([^\]—]+)/)
  if (imageMarkerMatch) {
    const imageUrl = imageMarkerMatch[1].trim()
    const userText = sanitizedMessage.replace(/\[The citizen attached an image:[^\]]*\]\s*/i, '').trim()
    try {
      devLog(`[Chat] Auto-analyzing uploaded image: ${imageUrl}`)
      const sid = sessionId || ''
      const analysisResult = await executeImageAnalysis(imageUrl, userText || undefined, sid || undefined)
      if (analysisResult === '__VISION_UNAVAILABLE__') {
        imageAnalysisContext = `\n\n[IMAGE UPLOAD RECEIVED — VISION ANALYSIS UNAVAILABLE]\nThe citizen uploaded a photo (${imageUrl}) but our vision AI could not analyze it at this time. DO NOT pretend to analyze the image. DO NOT make up what the image shows. Instead, tell the citizen: "I received your image but my visual analysis system is temporarily unavailable. Please describe what you see in the photo and I will provide safety guidance based on your description." Then ask specific questions about what they see.`
      } else {
        // Extract the structured header line (?? **Image Analysis** ...) to prepend to reply
        const headerMatch = analysisResult.match(/^(.{0,4}\*\*Image Analysis\*\*.*?\n\*\*Detected:\*\*.*?\n)/)
        if (headerMatch) {
          rawVisionHeader = headerMatch[1] + '\n'
        }

        // Build image memory comparison if multiple images in session
        const lastEntry = sid ? sessionImageMemory.get(sid) : undefined
        const lastAnalysis = lastEntry?.[lastEntry.length - 1]?.analysis
        const imageMemoryCtx = (sid && lastAnalysis) ? buildImageMemoryContext(sid, lastAnalysis) : ''

        imageAnalysisContext = `\n\n[IMAGE ANALYSIS COMPLETED — VISION AI RESULTS]\nThe citizen uploaded a photo and it has been analyzed by our vision AI. Here are the ACTUAL findings from the vision model:\n\n${analysisResult}\n\nIMPORTANT: Base your response primarily on this image analysis. The analysis above was performed by a real vision model that can SEE the image. Trust these findings and provide safety guidance based on what the vision model detected. Address the citizen's specific question about the image.${imageMemoryCtx}`
      }
      devLog(`[Chat] Image auto-analysis complete (${analysisResult.length} chars)`)
    } catch (err: any) {
      devLog(`[Chat] Image auto-analysis failed: ${err.message}`)
      imageAnalysisContext = '\n\n[IMAGE ANALYSIS]: The vision system was unable to analyze the uploaded image. Ask the citizen to describe what they see so you can provide guidance.'
    }
  }

  // Language: detect ACTUAL message language, not browser locale.
  let detectedLanguage = 'en'
  let languageInstruction = ''
  try {
    const langResult = await classify({ text: sanitizedMessage, task: 'language' })
    if (langResult.label && langResult.score > 0.85 && langResult.label !== 'en') {
      detectedLanguage = langResult.label
      languageInstruction = `\n\n=== LANGUAGE RULE === You MUST respond in language code "${langResult.label}". The user is writing in that language. ===`
    } else {
      languageInstruction = '\n\n=== LANGUAGE RULE === You MUST respond ONLY in English. Do NOT use German, French, Spanish, or any other language. Every single word of your response must be in English. This is a hard requirement. ==='
    }
  } catch {
    // Language detection failure — default to English
    languageInstruction = '\n\n=== LANGUAGE RULE === You MUST respond ONLY in English. Do NOT use German, French, Spanish, or any other language. Every single word of your response must be in English. This is a hard requirement. ==='
  }

  // Route to specialist agent based on emotion/intent
  const routing = await routeToAgent(sanitizedMessage)
  const agent = AGENTS[routing.agent]

  // Load conversation history (last 20 messages)
  const { rows: history } = await pool.query(
    `SELECT role, content FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT 20`,
    [sessionId],
  )

  let piiReplacements: PiiReplacement[] = []
  const redactedHistory = history.map((h: any) => {
    const redacted = redactPii(h.content || '', piiReplacements)
    piiReplacements = redacted.replacements
    return {
      role: h.role as 'user' | 'assistant',
      content: redacted.text,
    }
  })

  // Conversation memory management — compress older messages if needed
  const { compressedHistory, memory } = await manageConversationMemory(redactedHistory)

  // Detect topic shifts
  const topicShiftDetected = detectTopicShift(sanitizedMessage, memory.topics)

  // Infer dialogue state for context continuity
  const dialogueState = inferDialogueState(redactedHistory, sanitizedMessage, emergency, routing.emotion)
  const dialogueStateContext = buildDialogueStateContext(dialogueState)

  // Load user long-term memory for returning users
  const userProfile = await loadUserProfile(req.citizenId)
  const userProfileContext = buildUserProfileContext(userProfile)

  // ADVANCED PERSONALIZATION — Cross-session memory, behavior profiles,
  // conversation summaries, and smart suggestions for signed-in users.
  // Anonymous citizens get baseline responses; signed-in users get the
  // full intelligence experience.

  // —P1: Cross-session memory — persistent facts remembered across chats
  let memoryContext = ''
  let episodicContext = ''
  if (req.citizenId) {
    const memories = await loadCitizenMemories(req.citizenId)
    memoryContext = buildMemoryContext(memories)
    // Episodic memory — specific past incidents this citizen experienced
    const episodes = await loadEpisodicMemories(req.citizenId)
    episodicContext = buildEpisodicContext(episodes)
    // Fire-and-forget: extract new memories + episodes from this message
    extractAndSaveMemories(req.citizenId, sanitizedMessage, sessionId!).catch(() => {})
    extractEpisodicEvents(req.citizenId, sanitizedMessage, '').catch(() => {})
  }

  // —P2: Behavioral profiling — adapt communication style to learned preferences
  let behaviorContext = ''
  if (req.citizenId) {
    const behaviorProfile = await loadBehaviorProfile(req.citizenId)
    behaviorContext = buildBehaviorContext(behaviorProfile)
  }

  // —P3: Operator profiling — enhanced admin intelligence
  let operatorContext = ''
  if (req.operatorId) {
    const opProfile = await loadOperatorProfile(req.operatorId)
    if (opProfile) {
      const opParts: string[] = []
      if (opProfile.specialization?.length > 0) {
        opParts.push(`Operator specialization: ${opProfile.specialization.join(', ')}`)
      }
      if (opProfile.preferred_report_format) {
        opParts.push(`Preferred report format: ${opProfile.preferred_report_format}`)
      }
      if (opProfile.preferred_data_depth) {
        opParts.push(`Preferred data depth: ${opProfile.preferred_data_depth}`)
      }
      if (opProfile.active_operations?.length > 0) {
        opParts.push(`Currently tracking operations: ${opProfile.active_operations.join(', ')}`)
      }
      if (opParts.length > 0) {
        operatorContext = `\n\n[OPERATOR PROFILE]\n${opParts.join('\n')}\nAdapt response format and depth to this operator's preferences.`
      }
    }
  }

  // —P4: Cross-session conversation summaries — continuity across chats
  let summaryContext = ''
  if (req.citizenId) {
    const recentSummaries = await loadRecentSummaries(req.citizenId)
    summaryContext = buildSummaryContext(recentSummaries)
  } else if (req.operatorId) {
    // Operators also benefit from cross-shift continuity
    const recentSummaries = await loadRecentSummaries(req.operatorId)
    summaryContext = buildSummaryContext(recentSummaries)
  }

  // Build emergency context for the prompt
  const emergencyInstruction = emergency.isEmergency
    ? `\n\n?? EMERGENCY DETECTED: The user appears to be in a ${emergency.type || 'unknown'} emergency (severity: ${emergency.severity}). Prioritize immediate safety guidance. Lead with the most critical actions.`
    : ''

  // Build entity context for continuity
  const entityContext = (memory.entities.locations.length > 0 || memory.entities.hazardTypes.length > 0)
    ? `\n\nConversation context — previously mentioned: locations=[${memory.entities.locations.join(', ')}], hazards=[${memory.entities.hazardTypes.join(', ')}]. Maintain continuity with these references.`
    : ''

  // Admin mode — append operator system prompt and tools
  const adminAddendum = req.adminMode ? COMPACT_ADMIN_ADDENDUM : ''
  const tools = req.adminMode ? [...AVAILABLE_TOOLS, ...ADMIN_TOOLS] : AVAILABLE_TOOLS

  // For document uploads: override the system with a focused analysis instruction
  // and suppress live emergency context so the AI doesn't blend AEGIS dashboard
  // data into a lecture/document summary.
  const documentOverride = isDocumentUpload
    ? `\n\n[DOCUMENT ANALYSIS MODE]\nThe user has uploaded a document for analysis. Your ENTIRE response must be a structured summary/analysis of that document's content. Do NOT reference AEGIS alerts, live conditions, weather, flood data, or emergency dashboards — those are irrelevant to this request. Treat this exactly like ChatGPT or Claude would: read the document and explain what it says.`
    : ''
  const effectiveLiveContext = isDocumentUpload ? '' : liveContext

  // Build messages array with full personalization stack:
  // System prompt + Creator Profile + Agent + Admin + Language + Emergency + Entity + Dialogue +
  // User Profile + Cross-Session Memory + Episodic Memory + Behavior Profile +
  // Operator Profile + Session Summaries + Live Context + RAG
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: languageInstruction + '\n\n' + COMPACT_SYSTEM_PROMPT + '\n\n' + CREATOR_PROFILE + agent.systemAddendum + adminAddendum + emergencyInstruction + entityContext + dialogueStateContext + userProfileContext + memoryContext + episodicContext + behaviorContext + operatorContext + summaryContext + imageAnalysisContext + effectiveLiveContext + ragContext + documentOverride + '\n\n' + languageInstruction },
    ...compressedHistory.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
  ]

  // Append language instruction to the LAST user message for non-streaming path
  if (detectedLanguage === 'en') {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        messages[i] = { ...messages[i], content: messages[i].content + '\n\n[Respond in English only]' }
        break
      }
    }
  }

  // Classify query for intelligent model selection
  const queryClassification = classifyQuery(sanitizedMessage)

  // Fire-and-forget: preload the optimal model while we build the request
  preloadModelForClassification(queryClassification).catch(() => {})

  // Document uploads need a large context window — route to Gemini (1M tokens free)
  // rather than Ollama which cannot fit the system prompt + document content.
  const docPreferredProvider = isDocumentUpload ? 'gemini' : undefined

  // Call LLM — LOCAL-FIRST via Ollama, cloud APIs as fallback. Propagate error if all providers fail.
  let response: { content: string; model: string; tokensUsed: number; latencyMs: number }
  try {
    response = await chatCompletion({
      messages,
      maxTokens: 2048,
      temperature: agent.temperature,
      classification: queryClassification,
      preferredProvider: docPreferredProvider,
    } as any)
  } catch (llmErr: any) {
    // Propagate a clear, actionable error — do NOT silently fall back to heuristic
    logger.error({ err: llmErr }, '[Chat] LLM ERROR')

    const errorReply =
      `?? **Temporarily Unavailable**\n\n` +
      `I'm having trouble connecting to my AI engine right now. This is usually temporary.\n\n` +
      `**What you can do:**\n` +
      `- Wait a moment and try again\n` +
      `- For emergencies, call **${regionMeta.emergencyNumber}** immediately\n` +
      `- For non-emergency health advice, call **111**\n` +
      `- For emotional support, call **116 123** (Samaritans, 24/7)\n\n` +
      `_The system will automatically retry with the next available AI provider._`

    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
       VALUES ($1, 'assistant', $2, 'error-no-llm', 0, 0)`,
      [sessionId, errorReply],
    )

    return {
      sessionId: sessionId!,
      reply: errorReply,
      model: 'error-no-llm',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: ['llm_unavailable'],
    }
  }

  const toolsUsed: string[] = []
  let finalReply = response.content

  // MULTI-HOP TOOL CALLING — up to 3 reasoning loops
  // Each iteration: parse tool calls ? execute ? feed results back to
  // the LLM for synthesis and possible further tool calls.
  const MAX_TOOL_HOPS = 3
  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const toolCallPattern = /\[TOOL_CALL: (\w+)\((.*?)\)\]/g
    const toolCalls: Array<{ fullMatch: string; name: string; args: Record<string, unknown> }> = []
    let match: RegExpExecArray | null
    while ((match = toolCallPattern.exec(finalReply)) !== null) {
      try {
        const args = JSON.parse(match[2] || '{}')
        toolCalls.push({ fullMatch: match[0], name: match[1], args })
      } catch {
        toolCalls.push({ fullMatch: match[0], name: match[1], args: {} })
      }
    }

    if (toolCalls.length === 0) break  // No more tools — done

    // Execute tool calls
    const toolResults: string[] = []
    if (toolCalls.length > 1) {
      const composite = await executeCompositeToolCalls(
        toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
      )
      for (let i = 0; i < toolCalls.length; i++) {
        const result = composite.results[i]?.result || '[Tool unavailable]'
        toolResults.push(`[${toolCalls[i].name}]: ${result}`)
        toolsUsed.push(toolCalls[i].name)
      }
    } else {
      const result = await executeToolCall(toolCalls[0].name, toolCalls[0].args)
      toolResults.push(`[${toolCalls[0].name}]: ${result}`)
      toolsUsed.push(toolCalls[0].name)
    }

    // Build a synthesis prompt with tool results and re-call the LLM
    const toolResultsBlock = toolResults.join('\n\n')
    messages.push({ role: 'assistant', content: finalReply })
    messages.push({
      role: 'user',
      content:
        `The following tool results are now available:\n\n${toolResultsBlock}\n\n` +
        `Using the above data, provide a comprehensive answer to the user's question. ` +
        `If you need additional information, you may call more tools using the [TOOL_CALL: name(args)] format. ` +
        `Otherwise, respond directly with a helpful, data-driven answer.`,
    })

    try {
      const hopResponse = await chatCompletion({
        messages,
        maxTokens: 2048,
        temperature: agent.temperature,
      })
      finalReply = hopResponse.content
      response = hopResponse  // Update for token tracking
    } catch (err: any) {
      logger.error({ err, hop: hop + 1 }, '[Chat] Multi-hop LLM call failed')
      // Fall back to simple replacement on the last good reply
      for (let i = 0; i < toolCalls.length; i++) {
        const result = toolResults[i]?.replace(/^\[[^\]]+\]: /, '') || '[Tool unavailable]'
        finalReply = finalReply.replace(toolCalls[i].fullMatch, result)
      }
      break
    }
  }

  // Prepend emergency preamble if emergency was detected
  if (emergency.isEmergency) {
    finalReply = buildEmergencyPreamble(emergency) + finalReply
  }

  // Prepend raw vision header so structured detection data is always in the reply
  if (rawVisionHeader) {
    finalReply = rawVisionHeader + finalReply
  }

  // Safety check
  finalReply = reinjectPii(finalReply, piiReplacements)

  // Output validation — catch local model hallucinations
  const outputValidation = validateOutputSafety(finalReply)
  if (!outputValidation.safe) {
    logger.warn({ flags: outputValidation.flags }, '[Chat] Output safety flags triggered')
    finalReply = outputValidation.cleaned
  }

  const safetyFlags = checkSafety(finalReply)
  if (safetyFlags.length > 0) {
    const crisisLines = llmCtx.crisisResources.map(r => `?? ${r.number} (${r.name})`).join('\n')
    finalReply = 'I understand you may be in distress. Please contact emergency services immediately:\n' +
      `?? ${regionMeta.emergencyNumber} (Emergency)\n` +
      crisisLines + '\n\n' +
      'You are not alone. Help is available.'
  }

  // Self-Consistency Verification
  // Check response for contradictions, numerical errors, and tool data mismatches
  let consistencyConfidenceAdj = 0
  if (safetyFlags.length === 0) {
    // Collect any tool output strings that were injected into the conversation
    const allToolOutputs = toolsUsed.length > 0
      ? messages.filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('tool results are now available')).map(m => m.content as string)
      : []
    const consistency = verifyResponseConsistency(finalReply, allToolOutputs, sanitizedMessage)
    if (!consistency.isConsistent) {
      devLog(`[Chat] Consistency issues: ${consistency.issues.join(', ')} (adj: ${consistency.confidenceAdjustment})`)
      consistencyConfidenceAdj = consistency.confidenceAdjustment
      if (consistency.correctedReply) {
        finalReply = consistency.correctedReply
      }
    }
  }

  // Generate follow-up questions
  const followUpQuestions = generateFollowUpQuestions(sanitizedMessage, finalReply, emergency, routing.agent)

  // Score response quality
  const qualityScore = scoreResponseQuality(
    sanitizedMessage,
    finalReply,
    toolsUsed,
    safetyFlags,
    liveContext.length > 0,
  )

  // Record analytics
  const latencyMs = Date.now() - startTime
  const analytics = recordAnalytics(
    sessionId!,
    latencyMs,
    toolsUsed,
    agent.name,
    emergency.isEmergency,
    topicShiftDetected,
  )

  // Persist assistant message
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
     VALUES ($1, 'assistant', $2, $3, $4, $5)`,
    [sessionId, finalReply, response.model, response.tokensUsed, response.latencyMs],
  )

  // Update session stats
  await pool.query(
    `UPDATE chat_sessions
     SET total_tokens = total_tokens + $1, model_used = $2, updated_at = now()
     WHERE id = $3`,
    [response.tokensUsed, response.model, sessionId],
  )

  // Update user long-term memory (non-blocking)
  updateUserProfile(req.citizenId, memory.entities, detectedLanguage).catch(() => {})

  // ADVANCED PERSONALIZATION — Post-response learning (non-blocking)

  // —P5: Update behavior profile — learn from this interaction
  if (req.citizenId) {
    updateBehaviorProfile(req.citizenId, {
      messageCount: 1,
      topics: memory.entities.hazardTypes,
      locations: memory.entities.locations.map(l => ({ name: l })),
      detectedLanguage,
      sentiment: routing.emotion,
    }).catch(() => {})
  }

  // —P6: Update operator profile
  if (req.operatorId) {
    updateOperatorProfile(req.operatorId, toolsUsed).catch(() => {})
  }

  // —P7: Auto-summarize conversations that are getting long (>15 messages)
  const messageCount = history.length
  if (messageCount >= 15 && messageCount % 10 === 0 && (req.citizenId || req.operatorId)) {
    generateAndSaveSummary(sessionId!, req.citizenId, req.operatorId).catch(() => {})
  }

  // —P8: Generate smart suggestions personalized to this user
  let smartSuggestions: SmartSuggestion[] = []
  if (req.citizenId || req.operatorId) {
    const memories = req.citizenId ? await loadCitizenMemories(req.citizenId) : []
    const profile = req.citizenId ? await loadBehaviorProfile(req.citizenId) : null
    smartSuggestions = generateSmartSuggestions({
      isAuthenticated: !!req.citizenId,
      memories,
      profile,
      lastBotMessage: finalReply,
      isEmergency: emergency.isEmergency,
      adminMode: req.adminMode,
    })
  }

  // Cache the response (only if no tools were used, no safety flags, and not an emergency)
  if (toolsUsed.length === 0 && safetyFlags.length === 0 && !emergency.isEmergency) {
    await cacheResponse(queryHash, req.message, finalReply, response.model)
  }

  // Extract source citations from RAG context
  const sources: Array<{ title: string; relevance: number }> = []
  if (ragContext) {
    const sourcePattern = /\[([^\]]+)\] ([^:]+):/g
    let sourceMatch: RegExpExecArray | null
    while ((sourceMatch = sourcePattern.exec(ragContext)) !== null) {
      sources.push({ title: `${sourceMatch[2]} (${sourceMatch[1]})`, relevance: 0.8 })
    }
  }

  return {
    sessionId: sessionId!,
    reply: finalReply,
    model: response.model,
    tokensUsed: response.tokensUsed,
    toolsUsed,
    sources,
    safetyFlags,
    confidence: Math.max(0.1, (routing.confidence || 0.7) + consistencyConfidenceAdj),
    agent: agent.name,
    emotion: routing.emotion,
    budgetUsed: sessionTokenState.used + response.tokensUsed,
    budgetLimit: sessionTokenState.limit,
    budgetRemaining: Math.max(0, sessionTokenState.remaining - response.tokensUsed),
    followUpQuestions,
    emergency,
    qualityScore,
    analytics,
    smartSuggestions,
    isPersonalized: !!(req.citizenId || req.operatorId),
  }
}

export interface ChatStreamHandlers {
  onToken: (token: string) => Promise<void> | void
  onReplace?: (text: string) => Promise<void> | void
  onToolCall?: (toolName: string, status: 'start' | 'complete', result?: string) => Promise<void> | void
  onThinking?: (phase: string) => Promise<void> | void
}

export async function processChatStream(
  req: ChatCompletionRequest,
  handlers: ChatStreamHandlers,
): Promise<ChatCompletionResponse> {
  const startTime = Date.now()
  const sanitizedMessage = sanitizeUserInput(req.message)
  const injectionFlags = detectPromptInjection(sanitizedMessage)

  if (injectionFlags.length > 0) {
    await logSecurityEvent({
      userId: req.citizenId || req.operatorId,
      userType: req.citizenId ? 'citizen' : req.operatorId ? 'operator' : undefined,
      eventType: 'suspicious_activity',
      metadata: { reason: 'prompt_injection_blocked', patterns: injectionFlags, inputPreview: sanitizedMessage.slice(0, 200) },
    })

    const blocked = 'I cannot help with instruction override attempts. I can help with emergency preparedness, local alerts, and safety planning instead.'
    await handlers.onToken(blocked)
    return {
      sessionId: req.sessionId || '',
      reply: blocked,
      model: 'policy-block',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: ['prompt_injection_blocked'],
      budgetUsed: 0,
      budgetLimit: MAX_TOKENS_PER_SESSION,
      budgetRemaining: MAX_TOKENS_PER_SESSION,
    }
  }

  // Emergency detection
  const emergency = detectEmergency(sanitizedMessage)

  let sessionId = req.sessionId
  if (sessionId) {
    const existing = await pool.query(`SELECT id FROM chat_sessions WHERE id = $1`, [sessionId])
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO chat_sessions (id, citizen_id, operator_id, title, model_used)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [sessionId, req.citizenId || null, req.operatorId || null, sanitizedMessage.slice(0, 100)],
      )
    }
  } else {
    const result = await pool.query(
      `INSERT INTO chat_sessions (citizen_id, operator_id, title, model_used)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [req.citizenId || null, req.operatorId || null, sanitizedMessage.slice(0, 100)],
    )
    sessionId = result.rows[0].id
  }

  const sessionTokenState = await getSessionTokenState(sessionId!)
  if (sessionTokenState.exceeded) {
    await handlers.onToken(SESSION_BUDGET_EXCEEDED_MESSAGE)
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
       VALUES ($1, 'assistant', $2, 'token-budget-limit', 0, 0)`,
      [sessionId, SESSION_BUDGET_EXCEEDED_MESSAGE],
    )

    return {
      sessionId: sessionId!,
      reply: SESSION_BUDGET_EXCEEDED_MESSAGE,
      model: 'token-budget-limit',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: ['session_budget_exceeded'],
      budgetUsed: sessionTokenState.used,
      budgetLimit: sessionTokenState.limit,
      budgetRemaining: 0,
    }
  }

  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
    [sessionId, sanitizedMessage],
  )

  // PARALLEL WAVE 1: Independent data-fetching operations (was sequential — saves ~200-400ms)
  const isDocumentUpload = sanitizedMessage.includes('[DOCUMENT UPLOAD')
  const [ragContext, liveContext, routingResult, langClassResult, historyResult] = await Promise.all([
    isDocumentUpload ? Promise.resolve('') : retrieveRAGContext(sanitizedMessage),
    buildLiveContext(),
    routeToAgent(sanitizedMessage),
    // Language classification (only if client didn't send explicit language)
    !req.language
      ? classify({ text: sanitizedMessage, task: 'language' }).catch(() => null)
      : Promise.resolve(null),
    pool.query(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT 20`,
      [sessionId],
    ),
  ])

  // Auto-execute image analysis when citizen attaches a photo
  let imageAnalysisContext = ''
  let imageAnalysisSucceeded = false
  const imageMarkerMatchStream = sanitizedMessage.match(/\[The citizen attached an image:\s*([^\]—]+)/)
  if (imageMarkerMatchStream) {
    const imageUrl = imageMarkerMatchStream[1].trim()
    const userText = sanitizedMessage.replace(/\[The citizen attached an image:[^\]]*\]\s*/i, '').trim()
    // Stream a progress indicator so the user sees something while vision processes
    await handlers.onToken('?? **ANALYZING YOUR IMAGE...**\n\n')
    try {
      devLog(`[ChatStream] Auto-analyzing uploaded image: ${imageUrl}`)
      const sid = sessionId || ''
      const analysisResult = await executeImageAnalysis(imageUrl, userText || undefined, sid || undefined)
      if (analysisResult === '__VISION_UNAVAILABLE__') {
        devLog(`[ChatStream] Vision unavailable — will instruct LLM not to fake analysis`)
        imageAnalysisContext = `\n\n[IMAGE UPLOAD RECEIVED — VISION ANALYSIS UNAVAILABLE]\nThe citizen uploaded a photo (${imageUrl}) but our vision AI could not analyze it at this time. DO NOT pretend to analyze the image. DO NOT make up what the image shows. Instead, tell the citizen: "I received your image but my visual analysis system is temporarily unavailable. Please describe what you see in the photo and I will provide safety guidance based on your description." Then ask specific questions about what they see.`
      } else {
        imageAnalysisSucceeded = true
        // Build image memory comparison if multiple images in session
        const lastEntry = sid ? sessionImageMemory.get(sid) : undefined
        const lastAnalysis = lastEntry?.[lastEntry.length - 1]?.analysis
        const imageMemoryCtx = (sid && lastAnalysis) ? buildImageMemoryContext(sid, lastAnalysis) : ''

        imageAnalysisContext = `\n\n[IMAGE ANALYSIS COMPLETED — VISION AI RESULTS]\nThe citizen uploaded a photo and it has been analyzed by our vision AI. Here are the ACTUAL findings from the vision model:\n\n${analysisResult}\n\nIMPORTANT: Base your response primarily on this image analysis. The analysis above was performed by a real vision model that can SEE the image. Trust these findings and provide safety guidance based on what the vision model detected. Address the citizen's specific question about the image.${imageMemoryCtx}`
        devLog(`[ChatStream] Image auto-analysis complete (${analysisResult.length} chars)`)
      }
    } catch (err: any) {
      devLog(`[ChatStream] Image auto-analysis failed: ${err.message}`)
      imageAnalysisContext = `\n\n[IMAGE UPLOAD RECEIVED — VISION ANALYSIS FAILED]\nThe citizen uploaded a photo but analysis failed with error: ${err.message}. DO NOT pretend to analyze the image. Ask the citizen to describe what they see.`
    }
  }

  // Language: use classifier to detect ACTUAL message language, not browser locale.
  // The client sends req.language from the browser's navigator.language, but
  // we must respond in the language the user is WRITING in, not their UI locale.
  let detectedLanguage = 'en'
  let languageInstruction = ''
  const messageIsNonEnglish = langClassResult && langClassResult.label && langClassResult.score > 0.85 && langClassResult.label !== 'en'
  if (messageIsNonEnglish) {
    detectedLanguage = langClassResult.label
    languageInstruction = `\n\n=== LANGUAGE RULE === You MUST respond in language code "${langClassResult.label}". The user is writing in that language. ===`
  } else {
    // Message is English or uncertain — always respond in English.
    languageInstruction = '\n\n=== LANGUAGE RULE === You MUST respond ONLY in English. Do NOT use German, French, Spanish, or any other language. Every single word of your response must be in English. This is a hard requirement. ==='
  }

  const routing = routingResult
  const agent = AGENTS[routing.agent]

  const history = historyResult.rows

  let piiReplacements: PiiReplacement[] = []
  const redactedHistory = history.map((h: any) => {
    const redacted = redactPii(h.content || '', piiReplacements)
    piiReplacements = redacted.replacements
    return {
      role: h.role as 'user' | 'assistant',
      content: redacted.text,
    }
  })

  // Conversation memory management
  const { compressedHistory, memory } = await manageConversationMemory(redactedHistory)
  const topicShiftDetected = detectTopicShift(sanitizedMessage, memory.topics)

  // Emergency and entity context for the prompt
  const emergencyInstruction = emergency.isEmergency
    ? `\n\n?? EMERGENCY DETECTED: The user appears to be in a ${emergency.type || 'unknown'} emergency (severity: ${emergency.severity}). Prioritize immediate safety guidance.`
    : ''

  const entityContext = (memory.entities.locations.length > 0 || memory.entities.hazardTypes.length > 0)
    ? `\n\nConversation context — previously mentioned: locations=[${memory.entities.locations.join(', ')}], hazards=[${memory.entities.hazardTypes.join(', ')}]. Maintain continuity with these references.`
    : ''

  // ADVANCED PERSONALIZATION — Stream variant

  // Load user profile for basic personalization
  // PARALLEL WAVE 2: All profile/memory loads (was 5 sequential awaits — saves ~100-200ms)
  const [userProfile, citizenMemories, citizenEpisodes, behaviorProfile, opProfile, recentSummaries] = await Promise.all([
    loadUserProfile(req.citizenId),
    req.citizenId ? loadCitizenMemories(req.citizenId) : Promise.resolve(null),
    req.citizenId ? loadEpisodicMemories(req.citizenId) : Promise.resolve(null),
    req.citizenId ? loadBehaviorProfile(req.citizenId) : Promise.resolve(null),
    req.operatorId ? loadOperatorProfile(req.operatorId) : Promise.resolve(null),
    (req.citizenId || req.operatorId) ? loadRecentSummaries((req.citizenId || req.operatorId)!) : Promise.resolve(null),
  ])

  const userProfileContext = buildUserProfileContext(userProfile)

  let memoryContext = ''
  let episodicContext = ''
  if (req.citizenId) {
    if (citizenMemories) memoryContext = buildMemoryContext(citizenMemories)
    if (citizenEpisodes) episodicContext = buildEpisodicContext(citizenEpisodes)
    extractAndSaveMemories(req.citizenId, sanitizedMessage, sessionId!).catch(() => {})
    extractEpisodicEvents(req.citizenId, sanitizedMessage, '').catch(() => {})
  }

  let behaviorContext = ''
  if (req.citizenId && behaviorProfile) {
    behaviorContext = buildBehaviorContext(behaviorProfile)
  }

  let operatorContext = ''
  if (req.operatorId && opProfile) {
    const opParts: string[] = []
    if (opProfile.specialization?.length > 0) opParts.push(`Specialization: ${opProfile.specialization.join(', ')}`)
    if (opProfile.preferred_report_format) opParts.push(`Report format: ${opProfile.preferred_report_format}`)
    if (opParts.length > 0) operatorContext = `\n\n[OPERATOR PROFILE]\n${opParts.join('\n')}`
  }

  let summaryContext = ''
  if (recentSummaries) {
    summaryContext = buildSummaryContext(recentSummaries)
  }

  // Dialogue state for context continuity
  const dialogueState = inferDialogueState(redactedHistory, sanitizedMessage, emergency, routing.emotion)
  const dialogueStateContext = buildDialogueStateContext(dialogueState)

  // Admin mode — append operator system prompt
  const adminAddendum = req.adminMode ? COMPACT_ADMIN_ADDENDUM : ''

  const documentOverrideStream = isDocumentUpload
    ? `\n\n[DOCUMENT ANALYSIS MODE]\nThe user has uploaded a document for analysis. Your ENTIRE response must be a structured summary/analysis of that document's content. Do NOT reference AEGIS alerts, live conditions, weather, flood data, or emergency dashboards — those are irrelevant to this request. Treat this exactly like ChatGPT or Claude would: read the document and explain what it says.`
    : ''
  const effectiveLiveContextStream = isDocumentUpload ? '' : liveContext

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: languageInstruction + '\n\n' + COMPACT_SYSTEM_PROMPT + '\n\n' + CREATOR_PROFILE + agent.systemAddendum + adminAddendum + emergencyInstruction + entityContext + dialogueStateContext + userProfileContext + memoryContext + episodicContext + behaviorContext + operatorContext + summaryContext + imageAnalysisContext + effectiveLiveContextStream + ragContext + documentOverrideStream + '\n\n' + languageInstruction },
    ...compressedHistory.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
  ]

  // Append language instruction to the LAST user message so the model sees it
  // right before generating — models weight the most recent messages most heavily.
  if (detectedLanguage === 'en') {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        messages[i] = { ...messages[i], content: messages[i].content + '\n\n[Respond in English only]' }
        break
      }
    }
  }

  // Stream emergency preamble first if detected
  if (emergency.isEmergency) {
    const preamble = buildEmergencyPreamble(emergency)
    await handlers.onToken(preamble)
  }

  // Classify query for intelligent model selection
  const queryClassification = classifyQuery(sanitizedMessage)

  // Fire-and-forget: preload the optimal model while we build the request
  preloadModelForClassification(queryClassification).catch(() => {})

  // Document uploads need a large context window — route to Gemini (1M tokens free)
  const docPreferredProviderStream = isDocumentUpload ? 'gemini' : req.preferredProvider

  let rawReply = ''
  let response: { content: string; model: string; tokensUsed: number; latencyMs: number }
  let moderateBlocked = false

  try {
    response = await chatCompletionStream(
      { messages, maxTokens: 2048, temperature: agent.temperature, classification: queryClassification, preferredProvider: docPreferredProviderStream } as any,
      {
        onToken: async (token) => {
          const preview = rawReply + token
          const flags = checkSafety(preview)
          if (flags.length > 0) {
            moderateBlocked = true
            throw new Error('OUTPUT_MODERATION_BLOCK')
          }
          rawReply = preview
          await handlers.onToken(token)
        },
      },
    )
  } catch (err: any) {
    if (err.message === 'OUTPUT_MODERATION_BLOCK') {
      const safe = 'I cannot provide that response. I can help with emergency preparedness, evacuation planning, and official safety guidance.'
      if (handlers.onReplace) await handlers.onReplace(safe)
      rawReply = safe
      response = {
        content: safe,
        model: 'moderation-fallback',
        tokensUsed: 0,
        latencyMs: 0,
      }
    } else {
      const errorReply =
        `?? **Temporarily Unavailable**\n\n` +
        `I'm having trouble connecting to my AI engine right now. This is usually temporary.\n\n` +
        `**What you can do:**\n` +
        `- Wait a moment and try again\n` +
        `- For emergencies, call **${regionMeta.emergencyNumber}** immediately\n` +
        `- For non-emergency health advice, call **111**\n` +
        `- For emotional support, call **116 123** (Samaritans, 24/7)\n\n` +
        `_The system will automatically retry with the next available AI provider._`

      if (handlers.onReplace) await handlers.onReplace(errorReply)
      else await handlers.onToken(errorReply)

      response = {
        content: errorReply,
        model: 'error-no-llm',
        tokensUsed: 0,
        latencyMs: 0,
      }
      rawReply = errorReply
    }
  }

  // Prepend emergency preamble to the stored reply
  if (emergency.isEmergency) {
    rawReply = buildEmergencyPreamble(emergency) + rawReply
  }

  // MULTI-HOP TOOL CALLING (STREAMING) — up to 3 reasoning loops
  // After initial stream, parse any tool calls, execute, re-call LLM
  // with tool results, and stream the synthesis back.
  const streamToolsUsed: string[] = []
  const MAX_STREAM_HOPS = 3
  for (let hop = 0; hop < MAX_STREAM_HOPS; hop++) {
    const toolCallPattern = /\[TOOL_CALL: (\w+)\((.*?)\)\]/g
    const toolCalls: Array<{ fullMatch: string; name: string; args: Record<string, unknown> }> = []
    let match: RegExpExecArray | null
    while ((match = toolCallPattern.exec(rawReply)) !== null) {
      try {
        const args = JSON.parse(match[2] || '{}')
        toolCalls.push({ fullMatch: match[0], name: match[1], args })
      } catch {
        toolCalls.push({ fullMatch: match[0], name: match[1], args: {} })
      }
    }

    if (toolCalls.length === 0) break

    // Notify client that tools are being executed
    if (handlers.onThinking) await handlers.onThinking('Executing tools...')

    // Execute all tool calls
    const toolResults: string[] = []
    if (toolCalls.length > 1) {
      for (const tc of toolCalls) {
        if (handlers.onToolCall) await handlers.onToolCall(tc.name, 'start')
      }
      const composite = await executeCompositeToolCalls(
        toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
      )
      for (let i = 0; i < toolCalls.length; i++) {
        const result = composite.results[i]?.result || '[Tool unavailable]'
        toolResults.push(`[${toolCalls[i].name}]: ${result}`)
        streamToolsUsed.push(toolCalls[i].name)
        if (handlers.onToolCall) await handlers.onToolCall(toolCalls[i].name, 'complete')
      }
    } else {
      if (handlers.onToolCall) await handlers.onToolCall(toolCalls[0].name, 'start')
      const result = await executeToolCall(toolCalls[0].name, toolCalls[0].args)
      toolResults.push(`[${toolCalls[0].name}]: ${result}`)
      streamToolsUsed.push(toolCalls[0].name)
      if (handlers.onToolCall) await handlers.onToolCall(toolCalls[0].name, 'complete')
    }

    // Notify client that synthesis is starting
    if (handlers.onThinking) await handlers.onThinking('Synthesizing response...')

    // Re-call LLM with tool results — stream the synthesis to the client
    const toolResultsBlock = toolResults.join('\n\n')
    messages.push({ role: 'assistant', content: rawReply })
    messages.push({
      role: 'user',
      content:
        `The following tool results are now available:\n\n${toolResultsBlock}\n\n` +
        `Using the above data, provide a comprehensive answer to the user's question. ` +
        `If you need additional information, you may call more tools. Otherwise, respond directly.`,
    })

    try {
      // Replace the streamed content with the synthesized answer
      if (handlers.onReplace) await handlers.onReplace('')
      rawReply = ''

      const hopResponse = await chatCompletionStream(
        { messages, maxTokens: 2048, temperature: agent.temperature },
        {
          onToken: async (token) => {
            rawReply += token
            await handlers.onToken(token)
          },
        },
      )
      response = hopResponse
    } catch (err: any) {
      logger.error({ err, hop: hop + 1 }, '[Chat] Streaming multi-hop failed')
      // Fall back to raw tool results inlined
      for (const tc of toolCalls) {
        const resultStr = toolResults.find(r => r.startsWith(`[${tc.name}]:`))?.replace(/^\[[^\]]+\]: /, '') || ''
        rawReply = rawReply.replace(tc.fullMatch, resultStr)
      }
      if (handlers.onReplace) await handlers.onReplace(rawReply)
      break
    }
  }

  let finalReply = reinjectPii(rawReply, piiReplacements)

  // Output validation — catch local model hallucinations
  const outputValidation = validateOutputSafety(finalReply)
  if (!outputValidation.safe) {
    logger.warn({ flags: outputValidation.flags }, '[Chat Stream] Output safety flags triggered')
    finalReply = outputValidation.cleaned
    if (handlers.onReplace) await handlers.onReplace(finalReply)
  }

  const safetyFlags = moderateBlocked ? ['output_moderation_blocked'] : checkSafety(finalReply)
  if (safetyFlags.length > 0 && !moderateBlocked) {
    const crisisLines = llmCtx.crisisResources.map(r => `?? ${r.number} (${r.name})`).join('\n')
    finalReply = 'I understand you may be in distress. Please contact emergency services immediately:\n' +
      `?? ${regionMeta.emergencyNumber} (Emergency)\n` +
      crisisLines + '\n\n' +
      'You are not alone. Help is available.'
    if (handlers.onReplace) await handlers.onReplace(finalReply)
  }

  // Self-consistency verification
  let consistencyConfidenceAdj = 0
  if (safetyFlags.length === 0) {
    const toolOutputs: string[] = []
    for (const m of messages) {
      if (m.role === 'user' && m.content.startsWith('The following tool results are now available:')) {
        toolOutputs.push(m.content)
      }
    }
    const consistencyResult = verifyResponseConsistency(finalReply, toolOutputs, sanitizedMessage)
    if (!consistencyResult.isConsistent) {
      logger.warn({ issues: consistencyResult.issues }, '[Chat Stream] Consistency issues detected')
      if (consistencyResult.correctedReply) {
        finalReply = consistencyResult.correctedReply
        if (handlers.onReplace) await handlers.onReplace(finalReply)
      }
      consistencyConfidenceAdj = consistencyResult.confidenceAdjustment
    }
  }

  // Follow-up questions and quality scoring
  const followUpQuestions = generateFollowUpQuestions(sanitizedMessage, finalReply, emergency, routing.agent)
  const qualityScore = scoreResponseQuality(sanitizedMessage, finalReply, streamToolsUsed, safetyFlags, liveContext.length > 0)

  const latencyMs = Date.now() - startTime
  const analytics = recordAnalytics(
    sessionId!,
    latencyMs,
    streamToolsUsed,
    agent.name,
    emergency.isEmergency,
    topicShiftDetected,
  )

  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
     VALUES ($1, 'assistant', $2, $3, $4, $5)`,
    [sessionId, finalReply, response.model, response.tokensUsed, response.latencyMs],
  )

  await pool.query(
    `UPDATE chat_sessions
     SET total_tokens = total_tokens + $1, model_used = $2, updated_at = now()
     WHERE id = $3`,
    [response.tokensUsed, response.model, sessionId],
  )

  // ADVANCED PERSONALIZATION — Post-stream learning (non-blocking)

  // Update user profile (legacy)
  updateUserProfile(req.citizenId, memory.entities, detectedLanguage).catch(() => {})

  // Update behavior profile
  if (req.citizenId) {
    updateBehaviorProfile(req.citizenId, {
      messageCount: 1,
      topics: memory.entities.hazardTypes,
      locations: memory.entities.locations.map(l => ({ name: l })),
      detectedLanguage,
      sentiment: routing.emotion,
    }).catch(() => {})
  }

  // Update operator profile
  if (req.operatorId) {
    updateOperatorProfile(req.operatorId, streamToolsUsed).catch(() => {})
  }

  // Auto-summarize long conversations
  const streamMessageCount = history.length
  if (streamMessageCount >= 15 && streamMessageCount % 10 === 0 && (req.citizenId || req.operatorId)) {
    generateAndSaveSummary(sessionId!, req.citizenId, req.operatorId).catch(() => {})
  }

  // Generate smart suggestions
  let smartSuggestions: SmartSuggestion[] = []
  if (req.citizenId || req.operatorId) {
    const memories = req.citizenId ? await loadCitizenMemories(req.citizenId) : []
    const profile = req.citizenId ? await loadBehaviorProfile(req.citizenId) : null
    smartSuggestions = generateSmartSuggestions({
      isAuthenticated: !!req.citizenId,
      memories,
      profile,
      lastBotMessage: finalReply,
      isEmergency: emergency.isEmergency,
      adminMode: req.adminMode,
    })
  }

  const sources: Array<{ title: string; relevance: number }> = []
  if (ragContext) {
    const sourcePattern = /\[([^\]]+)\] ([^:]+):/g
    let sourceMatch: RegExpExecArray | null
    while ((sourceMatch = sourcePattern.exec(ragContext)) !== null) {
      sources.push({ title: `${sourceMatch[2]} (${sourceMatch[1]})`, relevance: 0.8 })
    }
  }

  return {
    sessionId: sessionId!,
    reply: finalReply,
    model: response.model,
    tokensUsed: response.tokensUsed,
    toolsUsed: streamToolsUsed,
    sources,
    safetyFlags,
    confidence: Math.max(0.1, (routing.confidence || 0.7) + consistencyConfidenceAdj),
    agent: agent.name,
    emotion: routing.emotion,
    budgetUsed: sessionTokenState.used + response.tokensUsed,
    budgetLimit: sessionTokenState.limit,
    budgetRemaining: Math.max(0, sessionTokenState.remaining - response.tokensUsed),
    language: detectedLanguage,
    followUpQuestions,
    emergency,
    qualityScore,
    analytics,
    smartSuggestions,
    isPersonalized: !!(req.citizenId || req.operatorId),
  }
}

 /*
 * Get chat history for a session.
 * SECURITY: Call verifySessionOwnership first!
  */
export async function getChatHistory(sessionId: string): Promise<Array<{ role: string; content: string; createdAt: string }>> {
  const { rows } = await pool.query(
    `SELECT role, content, created_at FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  )
  return rows.map((r: any) => ({
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }))
}

 /*
 * Verify that a user owns a chat session.
 * Returns true if the user owns the session, false otherwise.
  */
export async function verifySessionOwnership(
  sessionId: string,
  userId: string,
  userType: 'citizen' | 'operator'
): Promise<boolean> {
  const field = userType === 'citizen' ? 'citizen_id' : 'operator_id'
  const { rows } = await pool.query(
    `SELECT 1 FROM chat_sessions WHERE id = $1 AND ${field} = $2`,
    [sessionId, userId]
  )
  return rows.length > 0
}

 /*
 * List chat sessions for a citizen or operator.
  */
export async function listSessions(
  userId: string, userType: 'citizen' | 'operator',
): Promise<Array<{ id: string; title: string; status: string; createdAt: string }>> {
  const field = userType === 'citizen' ? 'citizen_id' : 'operator_id'
  const { rows } = await pool.query(
    `SELECT id, title, status, created_at
     FROM chat_sessions
     WHERE ${field} = $1
     ORDER BY updated_at DESC
     LIMIT 50`,
    [userId],
  )
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title || 'Untitled',
    status: r.status,
    createdAt: r.created_at,
  }))
}

 /*
 * End a chat session and generate a summary for cross-session continuity.
 * Called when the user explicitly closes the chat or after inactivity.
  */
export async function endChatSession(
  sessionId: string,
  citizenId?: string,
  operatorId?: string,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE chat_sessions SET status = 'completed', ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [sessionId],
    )
    // Generate and persist summary for future session context
    await generateAndSaveSummary(sessionId, citizenId, operatorId)
  } catch (err) {
    logger.warn({ err }, '[Chat] Failed to end session cleanly')
  }
}

// Re-export personalization utilities for route handlers
export { logSuggestionClick, generateSmartSuggestions } from './personalizationEngine.js'

