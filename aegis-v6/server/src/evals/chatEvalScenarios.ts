/**
 * Chat eval scenarios (AI quality evaluation definitions).
 *
 * - Used by scripts/runChatEvals.ts to run automated chat quality tests
 * - Tests cover anonymous, citizen, and operator auth modes
 * - Checks verify content relevance, safety (no leaked reasoning), and personalization * */

//Which auth level the test scenario runs under
export type ChatEvalAuthMode = 'anonymous' | 'citizen' | 'operator'

export interface ChatEvalTurn {
  message: string
}

type Primitive = string | number | boolean | null

interface BaseCheck {
  description: string
}

export interface IncludesAnyCheck extends BaseCheck {
  type: 'includesAny'
  target: 'reply'
  values: string[]
}

export interface ExcludesAllCheck extends BaseCheck {
  type: 'excludesAll'
  target: 'reply'
  values: string[]
}

export interface FieldEqualsCheck extends BaseCheck {
  type: 'fieldEquals'
  path: string
  expected: Primitive
}

export interface MinLengthCheck extends BaseCheck {
  type: 'minLength'
  target: 'reply'
  min: number
}

export type ChatEvalCheck =
  | IncludesAnyCheck
  | ExcludesAllCheck
  | FieldEqualsCheck
  | MinLengthCheck

export interface ChatEvalScenario {
  id: string
  title: string
  auth: ChatEvalAuthMode
  turns: ChatEvalTurn[]
  checks: ChatEvalCheck[]
}

export const DEFAULT_LOCAL_PROVIDER = 'ollama-primary'

export const chatEvalScenarios: ChatEvalScenario[] = [
  {
    id: 'anon-flood-emergency',
    title: 'Anonymous flood emergency triage',
    auth: 'anonymous',
    turns: [
      {
        message: 'Flood water is rising around my car and the road ahead is covered. What should I do right now?',
      },
    ],
    checks: [
      {
        type: 'excludesAll',
        target: 'reply',
        description: 'Does not leak internal reasoning markers',
        values: ['<think>', '</think>'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions emergency escalation or urgent flood action',
        values: ['999', 'higher ground', 'do not drive', "don't drive", 'leave the vehicle if safe'],
      },
      {
        type: 'fieldEquals',
        path: 'isPersonalized',
        description: 'Anonymous chat should not be marked personalized',
        expected: false,
      },
      {
        type: 'minLength',
        target: 'reply',
        description: 'Provides a substantive operational answer',
        min: 80,
      },
    ],
  },
  {
    id: 'anon-rewrite-task',
    title: 'Anonymous rewrite should not be treated as an emergency',
    auth: 'anonymous',
    turns: [
      {
        message: 'Rewrite this clearly and calmly: road closed because flood water is on it avoid the area',
      },
    ],
    checks: [
      {
        type: 'excludesAll',
        target: 'reply',
        description: 'Does not leak internal reasoning markers',
        values: ['<think>', '</think>'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Produces a rewritten notice with the core content intact',
        values: ['road', 'floodwater', 'avoid the area'],
      },
      {
        type: 'excludesAll',
        target: 'reply',
        description: 'Does not over-escalate a rewrite request',
        values: ['call 999', 'call 112', 'immediate danger'],
      },
    ],
  },
  {
    id: 'anon-flood-kit',
    title: 'Anonymous preparedness answer covers the essentials',
    auth: 'anonymous',
    turns: [
      {
        message: 'What should go in a flood emergency kit for a family of four?',
      },
    ],
    checks: [
      {
        type: 'excludesAll',
        target: 'reply',
        description: 'Does not leak internal reasoning markers',
        values: ['<think>', '</think>'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions water or hydration supplies',
        values: ['water', 'bottled water', 'drinking water'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions light source supplies',
        values: ['torch', 'flashlight', 'battery-powered light'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions medicines or first aid',
        values: ['medication', 'medicines', 'first aid'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions important documents',
        values: ['documents', 'identification', 'insurance'],
      },
    ],
  },
  {
    id: 'citizen-context-heatwave',
    title: 'Signed-in citizen context survives across turns',
    auth: 'citizen',
    turns: [
      {
        message: 'For this chat, remember that I am caring for my elderly mother and we both need a concise checklist.',
      },
      {
        message: 'There is a heatwave tomorrow. Give me a short plan for us.',
      },
    ],
    checks: [
      {
        type: 'excludesAll',
        target: 'reply',
        description: 'Does not leak internal reasoning markers',
        values: ['<think>', '</think>'],
      },
      {
        type: 'fieldEquals',
        path: 'isPersonalized',
        description: 'Signed-in citizen flow should be marked personalized',
        expected: true,
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Adapts guidance to an older or vulnerable person',
        values: ['elderly', 'older', 'vulnerable'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions hydration',
        values: ['water', 'hydrate', 'hydration'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Mentions cooling or shade',
        values: ['shade', 'cool', 'cooling'],
      },
    ],
  },
  {
    id: 'operator-brief',
    title: 'Operator brief is structured and action-oriented',
    auth: 'operator',
    turns: [
      {
        message: 'Prepare an operational brief for river flooding in Aberdeen, power outages in Torry, and shelter pressure across the city. Keep it actionable.',
      },
    ],
    checks: [
      {
        type: 'excludesAll',
        target: 'reply',
        description: 'Does not leak internal reasoning markers',
        values: ['<think>', '</think>'],
      },
      {
        type: 'fieldEquals',
        path: 'isPersonalized',
        description: 'Operator flow should be marked personalized',
        expected: true,
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Includes a current-state style section',
        values: ['current state', 'current situation', 'current status', 'situation'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Includes recommendations',
        values: ['recommendation', 'recommended actions', 'next actions', 'key priorities', 'tactical actions', 'action plan'],
      },
      {
        type: 'includesAny',
        target: 'reply',
        description: 'Includes risk framing',
        values: ['risk', 'key risks', 'operational risk'],
      },
    ],
  },
]
