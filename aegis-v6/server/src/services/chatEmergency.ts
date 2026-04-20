/**
 * Emergency detection and escalation for the AEGIS chat service.
 *
 * detectEmergency() scores a message for urgency and type.
 * buildEmergencyPreamble() shapes the system prompt prefix when an emergency is detected.
 */
import type { EmergencyDetection } from '../types/index.js'
import { regionMeta, llmCtx } from './chatConstants.js'

 /*
 * Detect if a message describes an active emergency.
 * Returns structured data for upstream handling: type, severity, suggested actions.
  */
export function detectEmergency(message: string): EmergencyDetection {
  //Strip image attachment markers -- analyze only human-written text for emergency keywords
  const cleanedMessage = message.replace(/\[The citizen attached an image:[^\]]*\]\s*/gi, '').trim()
  const lower = cleanedMessage.toLowerCase()

  //If the message is ONLY an image attachment with no other text, it's not an emergency text
  if (!cleanedMessage || /^(please\s+)?(analy[sz]e|look at|check|examine|what'?s?\s+(this|in)|describe)\s+(this\s+)?(photo|image|picture|pic|img)/i.test(cleanedMessage)) {
    return { isEmergency: false, suggestedActions: [] }
  }

  //Intent detection: bypass emergency if user is asking the bot to process text
  //Matches patterns like "summarize this", "rewrite the following", "translate this article"
  const textProcessingIntent = /^(summarise|summarize|rewrite|rephrase|paraphrase|translate|proofread|edit|condense|shorten|simplify|explain|analyze|analyse|review|correct|improve|format|outline|bullet\s*point)\b/i.test(lower.trim())
    || /\b(summarise|summarize|rewrite|rephrase|paraphrase|translate|proofread)\s+(this|these|the\s+following|the\s+above|my|that|it)\b/i.test(lower)
    || /\b(can you|could you|please|pls)\s+(summarise|summarize|rewrite|rephrase|paraphrase|translate|proofread|edit|improve|shorten|simplify|condense)\b/i.test(lower)
    || /\b(make\s+(this|it)\s+(more|better|shorter|clearer|simpler|formal|professional))\b/i.test(lower)
    || /\b(turn\s+(this|it)\s+into|convert\s+(this|it)\s+(to|into))\b/i.test(lower)

  if (textProcessingIntent) {
    return { isEmergency: false, suggestedActions: [] }
  }

  const emergencyPatterns: Array<{
    type: EmergencyDetection['type']
    keywords: string[]
    severity: EmergencyDetection['severity']
    actions: string[]
  }> = [
    {
      type: 'medical',
      keywords: ['heart attack', 'not breathing', 'unconscious', 'severe bleeding', 'chest pain',
        'stroke', 'seizure', 'choking', 'allergic reaction', 'overdose', 'can\'t breathe'],
      severity: 'critical',
      actions: [
        `Call ${regionMeta.emergencyNumber} IMMEDIATELY`,
        'Do not move the person unless they are in immediate danger',
        'Begin CPR if they are not breathing and you are trained',
        'Keep the person warm and comfortable',
        'Stay on the line with emergency services',
      ],
    },
    {
      type: 'trapped',
      keywords: ['trapped', 'stuck', 'can\'t get out', 'pinned', 'collapsed on me',
        'buried', 'building collapsed', 'rubble', 'can\'t move'],
      severity: 'critical',
      actions: [
        `Call ${regionMeta.emergencyNumber} IMMEDIATELY`,
        'Make noise regularly so rescuers can locate you (tap on pipes or walls)',
        'Conserve your phone battery -- text if call quality is poor',
        'Cover your mouth with cloth to avoid inhaling dust',
        'Do NOT light matches or use lighters if gas may be present',
        'Stay calm and try to remain still to avoid further collapse',
      ],
    },
    {
      type: 'fire',
      keywords: ['on fire', 'house fire', 'building fire', 'smoke filling', 'flames',
        'fire spreading', 'can\'t escape fire', 'burning'],
      severity: 'critical',
      actions: [
        `Call ${regionMeta.emergencyNumber} IMMEDIATELY`,
        'GET OUT of the building NOW -- do not collect belongings',
        'Crawl low under smoke -- cleaner air is near the floor',
        'Feel doors before opening -- if hot, use another route',
        'Close doors behind you to slow the fire',
        'Meet at your pre-arranged assembly point',
        'Do NOT go back inside for any reason',
      ],
    },
    {
      type: 'flood',
      keywords: ['water rising', 'flooding now', 'flood water', 'house flooding',
        'river burst', 'water coming in', 'drowning', 'swept away', 'flash flood'],
      severity: 'critical',
      actions: [
        `Call ${regionMeta.emergencyNumber} if in immediate danger`,
        'Move to higher ground IMMEDIATELY',
        'Do NOT walk or drive through flood water',
        'Turn off electricity and gas if safe to do so',
        'If trapped upstairs, signal from a window',
        'Avoid contact with flood water -- it may be contaminated',
      ],
    },
    {
      type: 'violence',
      keywords: ['attack', 'shooting', 'stabbing', 'active shooter', 'violent',
        'weapon', 'assault', 'hostage', 'bomb threat', 'explosion'],
      severity: 'critical',
      actions: [
        `Call ${regionMeta.emergencyNumber} IMMEDIATELY`,
        'RUN if you can safely escape -- leave belongings behind',
        'HIDE if you cannot run -- lock/barricade doors, silence your phone',
        'TELL -- when safe, call emergency services with your location and what you saw',
        'Do NOT confront the attacker',
        'Help others escape if safe to do so',
      ],
    },
  ]

  //Check for emergency patterns
  for (const pattern of emergencyPatterns) {
    const matchCount = pattern.keywords.filter(k => lower.includes(k)).length
    if (matchCount >= 1) {
      //Severity escalation: 2+ keywords = critical, 1 = high
      const severity = matchCount >= 2 ? 'critical' : 'high'
      return {
        isEmergency: true,
        type: pattern.type,
        severity,
        suggestedActions: pattern.actions,
      }
    }
  }

  //General emergency signal detection (catch-all)
  const generalEmergencyKeywords = ['help me', 'please help', 'sos', 'i\'m going to die',
    'life threatening', 'dying', 'save me', 'rescue me']
  const generalMatch = generalEmergencyKeywords.filter(k => lower.includes(k)).length
  if (generalMatch >= 1) {
    return {
      isEmergency: true,
      type: 'unknown',
      severity: generalMatch >= 2 ? 'critical' : 'medium',
      suggestedActions: [
        `Call ${regionMeta.emergencyNumber} for immediate help`,
        'Describe your location as precisely as possible',
        'Stay on the line with emergency services',
        'If you can, share your GPS coordinates',
      ],
    }
  }

  return { isEmergency: false, suggestedActions: [] }
}

 /*
 * Build an emergency preamble to prepend to the LLM response when
 * an active emergency is detected.
  */
export function buildEmergencyPreamble(emergency: EmergencyDetection): string {
  if (!emergency.isEmergency) return ''

  const typeLabel = emergency.type ? emergency.type.toUpperCase() : 'EMERGENCY'
  const severityEmoji = emergency.severity === 'critical' ? '??' : '??'

  let preamble = `${severityEmoji} **${typeLabel} EMERGENCY DETECTED** ${severityEmoji}\n\n`
  preamble += `**Immediate actions:**\n`
  for (const action of emergency.suggestedActions) {
    preamble += `-- ${action}\n`
  }
  preamble += '\n---\n\n'

  return preamble
}

