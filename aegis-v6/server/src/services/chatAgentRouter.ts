/**
 * Specialist agent routing for the AEGIS chat service.
 *
 * Maps emotion taxonomy and intent signals to one of five specialist agent
 * profiles: crisis_responder, trauma_support, preparedness_coach,
 * medical_advisor, or logistics_coordinator.
 */
import { classify } from './classifierRouter.js'
import { llmCtx, regionMeta } from './chatConstants.js'

export type EmotionLabel = 'fear' | 'panic' | 'anger' | 'grief' | 'confusion' | 'calm' | 'hopeful' | 'neutral'

export type AgentType = 'crisis_responder' | 'trauma_support' | 'preparedness_coach' | 'medical_advisor' | 'logistics_coordinator'

export interface AgentProfile {
  name: string
  systemAddendum: string
  temperature: number
}

// Emotion urgency weights — higher = more urgent, more likely to trigger crisis routing
export const EMOTION_URGENCY_WEIGHTS: Record<EmotionLabel, number> = {
  panic: 1.0,
  fear: 0.85,
  anger: 0.6,
  grief: 0.7,
  confusion: 0.5,
  neutral: 0.2,
  calm: 0.1,
  hopeful: 0.1,
}

export const AGENTS: Record<AgentType, AgentProfile> = {
  crisis_responder: {
    name: 'CrisisResponder',
    systemAddendum: `\n\nYou are now in CRISIS MODE. The citizen appears to be in an active emergency.
- Prioritise IMMEDIATE SAFETY actions
- Give step-by-step evacuation guidance
- Provide exact emergency numbers
- Keep responses SHORT and CLEAR — they may be reading on a phone in bad conditions
- Ask: Are you in immediate danger? Is anyone injured? Can you move to higher ground?`,
    temperature: 0.3,
  },
  trauma_support: {
    name: 'TraumaSupport',
    systemAddendum: `\n\nThe citizen appears to be distressed or in emotional/psychological crisis. You are now an expert-level crisis counsellor providing Psychological First Aid (PFA) combined with evidence-based therapeutic techniques.

YOUR ROLE: You are a warm, deeply empathetic, professionally-trained trauma counsellor. You are NOT a chatbot giving generic responses — you are a human-like presence offering genuine emotional support. Speak like a compassionate therapist who truly cares about this person.

===== CRISIS SAFETY — ALWAYS FIRST =====
If the person expresses ANY suicidal ideation, self-harm intent, or immediate danger:
1. FIRST LINE must be crisis resources:
   - Samaritans: 116 123 (free, 24/7, UK & Ireland)
   - Crisis Text Line: Text SHOUT to 85258 (free, 24/7, UK)
   - NHS Urgent Mental Health: 111, option 2
   - Childline: 0800 1111 (under 18s)
   - National Domestic Abuse Helpline: 0808 2000 247
   - PAPYRUS (young people): 0800 068 4141
   - Alcoholics Anonymous: 0800 917 7650
   - FRANK (drugs): 0300 123 6600
   - Breathing Space (Scotland): 0800 83 85 87
   - ${llmCtx.crisisResources.map(r => r.name + ': ' + r.number).join('\n   - ')}
2. Validate them: "Thank you for telling me. That took courage."
3. NEVER dismiss, minimise, or ignore what they said
4. Do NOT just list hotlines and leave — stay present, ask "Can you tell me more about what you're feeling right now?"

===== CORE PFA PRINCIPLES — LOOK, LISTEN, LINK =====
- LOOK: Notice emotional cues in their words — short messages may mean shutdown, ALL CAPS may mean overwhelm, repetition may mean panic loops
- LISTEN: Let them lead. Never rush. Mirror their language. If they say "I'm falling apart" → "It sounds like everything feels like it's falling apart right now."
- LINK: Gently connect to professional help — never as a dismissal ("you should see a therapist") but as empowerment ("would it feel okay to talk to someone who specialises in this?")

===== EVIDENCE-BASED THERAPEUTIC TECHNIQUES (use as appropriate) =====

**1. Grounding (for panic, dissociation, flashbacks):**
- 5-4-3-2-1 Technique: "Can you try this with me? Name 5 things you can see... 4 things you can touch... 3 things you can hear... 2 things you can smell... 1 thing you can taste."
- Body scan: "Place both feet flat on the ground. Feel the pressure. Wiggle your toes. You are here, right now, in this moment."
- Cold water: "If you can, run cold water over your wrists or hold an ice cube. It activates your body's reset system."

**2. Breathing (for anxiety, panic attacks, hyperventilation):**
- Box breathing: "Breathe in for 4 counts... hold for 4... out for 4... hold for 4. Let's do it together."
- 4-7-8 Technique: "In through your nose for 4 counts... hold gently for 7... slowly out through your mouth for 8."
- Physiological sigh: "Two quick inhales through your nose, then one long exhale through your mouth. This is the fastest way your body knows to calm down."

**3. Cognitive Reframing (for hopelessness, guilt, catastrophising):**
- "What evidence do you have for that thought? And what evidence is there against it?"
- "If your best friend told you they felt this way, what would you say to them?"
- "This feeling is real, AND it is temporary. Both things can be true."

**4. Validation & Normalisation:**
- "What you're feeling makes complete sense given what you've been through."
- "There is no 'right' way to respond to trauma. Your reaction is normal."
- "Crying isn't weakness — it's your body's way of processing overwhelming emotions."
- "You are not broken. You are having a normal reaction to an abnormal situation."

**5. Safety Planning (for suicidal ideation):**
- "What's one thing, even tiny, that has kept you going until now?"
- "Is there one person you trust who you could reach out to today?"
- "Can we make a plan together? When the dark thoughts come, what's one thing you could do first?"
- "Would you be willing to remove or lock away anything that could be harmful, just for tonight?"

**6. Container Technique (for overwhelming emotions):**
- "Imagine a strong container — a safe, a lockbox, whatever feels right. Put the overwhelming feelings in there for now. You're not ignoring them — you're choosing when to open it, ideally with a professional."

**7. Radical Acceptance (for grief, loss, unchangeable situations):**
- "Sometimes the most courageous thing is accepting what we cannot change, while choosing how we respond."
- "Grief has no timeline. There is no 'moving on' — there is only moving forward, carrying the love with you."

===== TRAUMA-SPECIFIC GUIDANCE =====

**PTSD/Flashbacks:** "What you're experiencing — the flashbacks, the hypervigilance, the feeling of being back there — these are signs your brain is trying to protect you. EMDR and trauma-focused CBT are highly effective. You don't have to live like this."

**Grief/Bereavement:** "There's no stage model you have to follow. Some days will be okay and then a song or a smell will bring it all back. That's not regression — that's love. The grief is the love with nowhere to go."

**Domestic Violence/Abuse:** "What's happening to you is not your fault. You deserve to feel safe. The National Domestic Abuse Helpline (0808 2000 247) is free, confidential, and available 24/7. They can help you plan your next steps safely."

**Child/Young Person:** "You are so brave for reaching out. What you're going through is not normal and it's not your fault. Childline (0800 1111) is free and won't show on your phone bill. You can also chat online at childline.org.uk"

**Addiction/Substance Abuse:** "Addiction is not a moral failure — it's a health condition. Recovery is possible. FRANK (0300 123 6600) offers free, confidential advice. Every step toward help is a step toward freedom."

**Eating Disorders:** "Your relationship with food and your body is complex, and you deserve compassionate support. Beat Eating Disorders helpline: 0808 801 0677. Recovery is real and you are worthy of it."

**Self-Harm:** "Self-harm often serves a purpose — it might be the only way you've found to cope with overwhelming pain. Let's find safer ways together. When the urge comes: hold ice, snap a rubber band, draw red lines on your skin instead. And please reach out to Samaritans (116 123)."

===== RESPONSE STYLE =====
- Write like a human who deeply cares, not a textbook
- Use short, warm sentences. Leave space between ideas
- Match their emotional register — if they're raw, be gentle; if they're angry, validate the anger
- Use their name if they've given it
- Ask open questions: "How are you feeling right now?" not "Are you okay?"
- End every response with an invitation to continue: "I'm here. Take your time." or "Would you like to tell me more?"
- NEVER use: "I understand" (you don't), "stay strong" (dismissive), "everything will be fine" (invalidating), "at least..." (minimising), "you should..." (prescriptive), "calm down" (dismissive)
- INSTEAD use: "That sounds incredibly painful." "You don't have to carry this alone." "What you're feeling matters." "Recovery is not linear, and asking for help is a sign of extraordinary strength."

===== CLOSING EVERY RESPONSE =====
Always end with BOTH:
1. A specific, actionable next step (a number to call, a technique to try, a question to reflect on)
2. An emotional anchor: "You reached out today. That tells me something important about you — you haven't given up. And I'm glad you're here."`,
    temperature: 0.7,
  },
  preparedness_coach: {
    name: 'PreparednessCoach',
    systemAddendum: `\n\nThe citizen is asking about emergency preparedness and planning.
- Provide detailed, actionable preparation checklists
- Reference regional resources (${llmCtx.floodAuthority}, ${llmCtx.weatherAuthority})
- Include practical items: emergency kit contents, evacuation routes, communication plans
- Be thorough but avoid overwhelming — break into manageable steps
- Suggest local government resources and community groups`,
    temperature: 0.6,
  },
  medical_advisor: {
    name: 'MedicalAdvisor',
    systemAddendum: `\n\nThe citizen has a medical or health-related query during a disaster scenario.
- Provide general first-aid guidance only — you are NOT a doctor
- ALWAYS recommend calling ${regionMeta.emergencyNumber} for serious injuries
- Cover triage basics: bleeding control, CPR guidance, burns, fractures
- Advise on medication preservation during power outages
- Mention nearby hospitals/medical facilities if tool data is available
- For mental health: refer to crisis resources: ${llmCtx.crisisResources.map(r => `${r.name} (${r.number})`).join(', ')}
- NEVER diagnose conditions or recommend specific medications`,
    temperature: 0.4,
  },
  logistics_coordinator: {
    name: 'LogisticsCoordinator',
    systemAddendum: `\n\nThe citizen needs help with logistics, supplies, routes, or resources.
- Help locate shelters, supply distribution points, and evacuation routes
- Provide information on road closures and safe travel corridors
- Advise on emergency supply lists and where to obtain them
- Coordinate understanding of resource availability (water, food, fuel, medical supplies)
- Reference the AEGIS map for real-time shelter/route data
- Suggest using the get_evacuation_routes and find_shelters tools for specific locations`,
    temperature: 0.5,
  },
}

// Confidence threshold — below this, default to preparedness_coach
export const AGENT_CONFIDENCE_THRESHOLD = 0.45

 /*
 * Map raw sentiment classification labels to our emotion taxonomy.
 * The classifier may return labels like "positive", "negative", "LABEL_0", etc.
  */
export function mapToEmotionTaxonomy(rawLabel: string, rawScore: number, messageText: string): { emotion: EmotionLabel; confidence: number } {
  const lower = messageText.toLowerCase()

  // Keyword-based emotion refinement (overrides classifier when strong signal)
  const emotionKeywordMap: Array<{ emotion: EmotionLabel; keywords: string[]; minMatches: number }> = [
    { emotion: 'panic', keywords: ['panic', 'panicking', 'freaking out', 'oh god', 'oh no', 'help help', 'please help'], minMatches: 1 },
    { emotion: 'fear', keywords: ['scared', 'terrified', 'frightened', 'afraid', 'fear', 'alarmed', 'anxious', 'worry', 'worried'], minMatches: 1 },
    { emotion: 'anger', keywords: ['angry', 'furious', 'outraged', 'unacceptable', 'ridiculous', 'useless', 'incompetent', 'why hasn\'t'], minMatches: 1 },
    { emotion: 'grief', keywords: ['lost everything', 'gone', 'destroyed', 'dead', 'died', 'mourning', 'devastated', 'heartbroken'], minMatches: 1 },
    { emotion: 'confusion', keywords: ['confused', 'don\'t understand', 'what do i do', 'not sure', 'which way', 'where should', 'how do i'], minMatches: 1 },
    { emotion: 'hopeful', keywords: ['hope', 'hopeful', 'getting better', 'improving', 'thank', 'grateful', 'recovering'], minMatches: 1 },
    { emotion: 'calm', keywords: ['just wondering', 'curious', 'information', 'could you tell', 'i\'d like to know'], minMatches: 1 },
  ]

  // Check keyword signals
  for (const { emotion, keywords, minMatches } of emotionKeywordMap) {
    const matchCount = keywords.filter(k => lower.includes(k)).length
    if (matchCount >= minMatches) {
      return { emotion, confidence: Math.min(0.95, 0.6 + matchCount * 0.1) }
    }
  }

  // Fall back to classifier mapping
  const normalizedLabel = rawLabel.toLowerCase()
  if (['negative', 'label_0', 'neg'].includes(normalizedLabel)) {
    // Negative sentiment — disambiguate via message length and exclamation marks
    const exclamations = (messageText.match(/!/g) || []).length
    const allCaps = messageText.replace(/[^A-Z]/g, '').length / Math.max(messageText.replace(/[^a-zA-Z]/g, '').length, 1)
    if (exclamations >= 2 || allCaps > 0.5) return { emotion: 'panic', confidence: rawScore * 0.8 }
    if (rawScore > 0.8) return { emotion: 'fear', confidence: rawScore * 0.7 }
    return { emotion: 'fear', confidence: rawScore * 0.6 }
  }
  if (['positive', 'label_1', 'pos'].includes(normalizedLabel)) {
    return { emotion: 'calm', confidence: rawScore * 0.7 }
  }

  return { emotion: 'neutral', confidence: 0.5 }
}

 /*
 * Route a message to the appropriate specialist agent based on
 * emotion taxonomy, intent keywords, and multi-signal fusion.
  */
export async function routeToAgent(message: string): Promise<{ agent: AgentType; confidence: number; emotion: EmotionLabel }> {
  let emotion: EmotionLabel = 'neutral'
  let emotionConfidence = 0

  // Strip image attachment markers — route based on citizen's actual text
  const cleanedMessage = message.replace(/\[The citizen attached an image:[^\]]*\]\s*/gi, '').trim()

  // Image analysis requests ? route to preparedness_coach (general capable agent)
  if (!cleanedMessage || /^(please\s+)?(analy[sz]e|look at|check|examine|what'?s?\s+(this|in)|describe)\s+(this\s+)?(photo|image|picture|pic|img)/i.test(cleanedMessage) || /\bimage\b.*\b(analy|assess|evaluat)/i.test(cleanedMessage)) {
    return { agent: 'preparedness_coach', confidence: 0.8, emotion: 'neutral' }
  }

  // Intent detection: text-processing requests use general agent
  const lower0 = cleanedMessage.toLowerCase().trim()
  const isTextProcessing = /^(summarise|summarize|rewrite|rephrase|paraphrase|translate|proofread|edit|condense|shorten|simplify|explain|analyze|analyse|review|correct|improve|format|outline|bullet\s*point)\b/i.test(lower0)
    || /\b(summarise|summarize|rewrite|rephrase|paraphrase|translate|proofread)\s+(this|these|the\s+following|the\s+above|my|that|it)\b/i.test(lower0)
    || /\b(can you|could you|please|pls)\s+(summarise|summarize|rewrite|rephrase|paraphrase|translate|proofread|edit|improve|shorten|simplify|condense)\b/i.test(lower0)
    || /\b(make\s+(this|it)\s+(more|better|shorter|clearer|simpler|formal|professional))\b/i.test(lower0)
  if (isTextProcessing) {
    return { agent: 'preparedness_coach', confidence: 0.6, emotion: 'neutral' }
  }

  // Signal 1: HuggingFace emotion/sentiment classification
  try {
    const emotionResult = await classify({
      text: message,
      task: 'sentiment',
    })
    const mapped = mapToEmotionTaxonomy(
      emotionResult.label?.toLowerCase() || 'neutral',
      emotionResult.score || 0,
      message,
    )
    emotion = mapped.emotion
    emotionConfidence = mapped.confidence
  } catch {
    // Emotion classification unavailable — use keyword fallback only
    const mapped = mapToEmotionTaxonomy('neutral', 0, message)
    emotion = mapped.emotion
    emotionConfidence = mapped.confidence
  }

  const lower = cleanedMessage.toLowerCase()
  const emotionWeight = EMOTION_URGENCY_WEIGHTS[emotion] || 0.2

  // Signal 2: Message characteristics
  const messageLength = cleanedMessage.length
  const exclamationCount = (cleanedMessage.match(/!/g) || []).length
  const questionCount = (cleanedMessage.match(/\?/g) || []).length
  const capsRatio = cleanedMessage.replace(/[^A-Z]/g, '').length / Math.max(cleanedMessage.replace(/[^a-zA-Z]/g, '').length, 1)
  const urgencyCues = exclamationCount * 0.1 + (capsRatio > 0.5 ? 0.3 : 0) + (messageLength > 200 ? 0.1 : 0)

  // Signal 3: Keyword scoring per agent type
  const crisisKeywords = ['help me', 'trapped', 'drowning', 'water rising', 'can\'t move',
    'emergency', 'danger', 'dying', 'dieing', 'dyin', 'save', 'rescue', 'flooding now', 'stuck', 'injured',
    'please help', 'sos', 'life threatening', 'can\'t breathe', 'collapsed']
  const crisisScore = crisisKeywords.filter(k => lower.includes(k)).length

  const traumaKeywords = ['scared', 'terrified', 'panic', 'anxiety', 'lost everything',
    'can\'t sleep', 'nightmare', 'worried', 'stress', 'afraid', 'upset', 'cry', 'crying',
    'trauma', 'ptsd', 'depressed', 'hopeless', 'alone', 'overwhelming',
    // Mental health & crisis (including misspellings people type in distress)
    'suicide', 'suicidal', 'kill myself', 'want to die', 'wanna die', 'gonna die',
    'end it all', 'self harm', 'self-harm', 'feel like dying', 'feel like dieing',
    'hurt myself', 'hurting myself', 'harm myself', 'end my life',
    'cutting', 'overdose', 'don\'t want to live', 'no reason to live', 'better off dead',
    'dying', 'dieing', 'dyin', 'ready to die', 'tired of living', 'what\'s the point',
    'can\'t do this anymore', 'don\'t care anymore', 'no point in living',
    // Therapy & psychology
    'therapist', 'therapy', 'counseling', 'counsellor', 'psychologist', 'mental health',
    'mental illness', 'breakdown', 'breaking down', 'falling apart', 'can\'t cope',
    'can\'t take it', 'can\'t go on', 'give up', 'giving up', 'no hope',
    // Grief & loss
    'grief', 'grieving', 'bereavement', 'lost someone', 'died', 'death', 'funeral',
    'miss them', 'missing them', 'gone forever', 'widow', 'orphan',
    // Abuse & violence
    'abuse', 'abused', 'abusive', 'domestic violence', 'being hit', 'being beaten',
    'molested', 'assault', 'assaulted', 'rape', 'raped', 'trafficking',
    // Eating & body
    'eating disorder', 'anorexia', 'bulimia', 'starving myself', 'body image',
    // Addiction
    'addiction', 'addicted', 'alcoholic', 'substance abuse', 'drug problem', 'relapse',
    // Emotional distress
    'worthless', 'empty', 'numb', 'dissociate', 'dissociating', 'flashback', 'flashbacks',
    'hyperventilat', 'panic attack', 'anxiety attack', 'can\'t breathe', 'heart racing',
    'insomnia', 'not sleeping', 'nightmares', 'intrusive thoughts', 'voices',
    'paranoid', 'paranoia', 'psychosis', 'hallucinating', 'delusion',
    'lonely', 'isolated', 'nobody cares', 'no one cares', 'unwanted', 'rejected',
    'ashamed', 'shame', 'guilt', 'guilty', 'blame myself', 'hate myself', 'self loathing']
  const traumaScore = traumaKeywords.filter(k => lower.includes(k)).length

  const prepKeywords = ['prepare', 'plan', 'kit', 'checklist', 'before flood',
    'what should i', 'how to prepare', 'insurance', 'sandbag', 'flood barrier', 'prevent']
  const prepScore = prepKeywords.filter(k => lower.includes(k)).length

  const medicalKeywords = ['injury', 'injured', 'bleeding', 'broken', 'fracture', 'burn',
    'medicine', 'medication', 'hospital', 'doctor', 'first aid', 'cpr', 'unconscious',
    'wound', 'infection', 'asthma', 'diabetic', 'allergic', 'chest pain', 'breathing difficulty',
    'health', 'medical', 'ambulance', 'paramedic']
  const medicalScore = medicalKeywords.filter(k => lower.includes(k)).length

  const logisticsKeywords = ['supply', 'supplies', 'food', 'water', 'route', 'road',
    'transport', 'evacuation route', 'get to', 'how to reach', 'delivery', 'resource',
    'fuel', 'generator', 'blanket', 'clothing', 'donation', 'volunteer',
    'distribution', 'pickup', 'drop off', 'logistics']
  const logisticsScore = logisticsKeywords.filter(k => lower.includes(k)).length

  // Multi-signal fusion: combine keyword scores with emotion weight and urgency cues
  // Immediate override: suicidal/self-harm keywords ALWAYS route to trauma_support
  const criticalMentalHealth = ['suicide', 'suicidal', 'kill myself', 'want to die', 'wanna die',
    'gonna die', 'end it all', 'feel like dying', 'feel like dieing', 'dieing', 'dying',
    'self harm', 'self-harm', 'hurt myself', 'harm myself', 'end my life',
    'cutting', 'overdose', 'don\'t want to live', 'better off dead',
    'no reason to live', 'tired of living', 'can\'t do this anymore',
    'rape', 'raped', 'molested', 'domestic violence', 'being beaten']
  const hasCriticalMH = criticalMentalHealth.some(k => lower.includes(k))

  const scores: Record<AgentType, number> = {
    crisis_responder: crisisScore * 0.35 + emotionWeight * 0.3 + urgencyCues * 0.2 + (emotion === 'panic' ? 0.3 : 0),
    trauma_support: traumaScore * 0.35 + (emotion === 'grief' || emotion === 'fear' ? 0.25 : 0) + emotionWeight * 0.15 + (hasCriticalMH ? 2.0 : 0),
    medical_advisor: medicalScore * 0.4 + (lower.includes('hurt') ? 0.15 : 0),
    logistics_coordinator: logisticsScore * 0.4 + (questionCount > 1 ? 0.1 : 0),
    preparedness_coach: prepScore * 0.35 + (emotion === 'calm' || emotion === 'hopeful' ? 0.15 : 0),
  }

  // Find the top-scoring agent
  let bestAgent: AgentType = 'preparedness_coach'
  let bestScore = 0
  for (const [agentKey, score] of Object.entries(scores) as Array<[AgentType, number]>) {
    if (score > bestScore) {
      bestScore = score
      bestAgent = agentKey
    }
  }

  // Apply confidence threshold — if score is too low, fall back to preparedness_coach
  const confidence = Math.min(0.95, bestScore)
  if (confidence < AGENT_CONFIDENCE_THRESHOLD) {
    return { agent: 'preparedness_coach', confidence: 0.4, emotion }
  }

  return { agent: bestAgent, confidence, emotion }
}

