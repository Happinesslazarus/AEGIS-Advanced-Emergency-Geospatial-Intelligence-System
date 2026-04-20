/**
 * Tests for the client-side chatbot engine -- a keyword/pattern matching NLP
 * (Natural Language Processing) engine that maps user messages to known intents
 * and returns pre-written safety advice. Because the engine runs entirely in the
 * browser (no server round-trip), it works offline during disasters when network
 * connectivity may be intermittent.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = makes an assertion about a value
 *   generateChatResponse()  = main function: takes a user message string and returns
 *                             {text, intent, confidence} -- the best matching response
 *   getSuggestions()        = returns an array of suggested quick-reply buttons in the
 *                             given language (ISO 639-1 language code)
 *   intent                  = the topic category the engine assigned to the message
 *                             (e.g. 'flood', 'quake', 'greet', 'unknown')
 *   confidence              = a 0-1 number expressing how certain the engine is that
 *                             the message belongs to the assigned intent
 *                             (1.0 = perfectly sure, 0 = no idea)
 *   text                    = the pre-written safety advice response string
 *   NLP                     = Natural Language Processing -- understanding human text
 *   keyword matching        = simple NLP approach: scan the message for known words
 *                             and map them to intents (faster and more reliable offline
 *                             than a neural model, but less flexible)
 *   greet intent            = triggered by 'hello', 'hi', 'help me', or multilingual
 *                             equivalents ('hola', 'bonjour', etc.)
 *   flood intent            = triggered by 'flood', 'water rising', 'inundación', etc.
 *   quake intent            = triggered by 'earthquake', 'tremor', 'shaking', 'séisme'
 *   fire intent             = triggered by 'fire', 'wildfire', 'blaze', 'smoke'
 *   storm intent            = triggered by 'hurricane', 'tornado', 'cyclone', 'typhoon'
 *   tsunami intent          = triggered by 'tsunami', 'tidal wave'
 *   evac intent             = triggered by 'evacuate', 'leave now', 'escape route'
 *   aid intent              = triggered by 'first aid', 'CPR', 'injured'
 *   contacts intent         = triggered by 'emergency number', 'call 999', 'phone'
 *   anxiety intent          = triggered by 'scared', 'anxious', 'panic', 'worried'
 *   trauma intent           = triggered by 'nightmare', 'flashback', 'PTSD'
 *   grief intent            = triggered by 'lost my home', 'lost everything'
 *   mental intent           = triggered by 'mental health', 'depression', 'support'
 *   child_support intent    = triggered by 'my child is scared', 'kids frightened'
 *   unknown intent          = fallback when no keyword matches; confidence < 0.2
 *   vuln intent             = vulnerable populations -- children, elderly, disabled
 *   pets intent             = pet safety during evacuation
 *   heatwave intent         = extreme heat safety advice
 *   water intent            = wading in floodwater safety (distinct from 'flood' intent)
 *   drive intent            = driving through floodwater safety
 *   power intent            = power outage advice (calls 105 replacement number)
 *   supplies intent         = emergency kit / go-bag contents
 *   sandbag intent          = flood barrier / sandbag placement advice
 *   shelter intent          = where to find emergency accommodation
 *   after intent            = post-disaster recovery and clean-up advice
 *   status intent           = current alerts / situation updates
 *   thanks intent           = friendly response to expressions of gratitude
 *   ISO 639-1 language code = two-letter language identifier (en, es, fr, ar, zh, hi...)
 *   toBeGreaterThan()       = asserts value is strictly larger than the argument
 *   toBeLessThan()          = asserts value is strictly smaller than the argument
 *   toContain()             = asserts a string/array includes the given substring/item
 *   toHaveProperty()        = asserts an object has a property with (optionally) a given value
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect } from 'vitest'
import { generateChatResponse, getSuggestions } from '../utils/chatbotEngine'

//generateChatResponse -- intent detection and response generation
describe('generateChatResponse', () => {
  //Greeting intents -- opening messages / help requests
  describe('greeting intents', () => {
    test('detects hello greeting', () => {
      // 'hello' is the most basic trigger; response should introduce AEGIS
      const response = generateChatResponse('hello')
      expect(response.intent).toBe('greet')
      expect(response.text).toContain('AEGIS Emergency AI Assistant')
      expect(response.confidence).toBeGreaterThan(0.5) // strong match
    })

    test('detects hi greeting', () => {
      //Multi-word input containing 'hi' must still resolve to the greet intent
      const response = generateChatResponse('hi there')
      expect(response.intent).toBe('greet')
    })

    test('detects help request', () => {
      // 'help me' is a common opening phrase; maps to greet (not an emergency)
      const response = generateChatResponse('help me')
      expect(response.intent).toBe('greet')
    })
  })

  //Disaster intents -- natural-hazard event-specific advice
  describe('disaster intents', () => {
    test('detects flood queries', () => {
      //Full question with 'flood' keyword; safety advice must contain 'Flood Safety'
      const response = generateChatResponse('what should I do in a flood')
      expect(response.intent).toBe('flood')
      expect(response.text).toContain('Flood Safety')
      expect(response.confidence).toBeGreaterThan(0.6)
    })

    test('detects water rising', () => {
      //Indirect flood description without the word 'flood' must still be detected
      const response = generateChatResponse('water rising in my house')
      expect(response.intent).toBe('flood')
    })

    test('detects earthquake queries', () => {
      //Classic DROP, COVER, HOLD ON advice must appear for earthquake intent
      const response = generateChatResponse('earthquake')
      expect(response.intent).toBe('quake')
      expect(response.text).toContain('DROP, COVER, HOLD ON')
    })

    test('detects tremor', () => {
      // 'shaking' is a synonym for earthquake that must resolve to quake intent
      const response = generateChatResponse('I felt shaking')
      expect(response.intent).toBe('quake')
    })

    test('detects fire queries', () => {
      const response = generateChatResponse('there is a fire')
      expect(response.intent).toBe('fire')
      expect(response.text).toContain('Fire Safety')
    })

    test('detects wildfire', () => {
      const response = generateChatResponse('wildfire approaching')
      expect(response.intent).toBe('fire')
    })

    test('detects storm queries', () => {
      // 'hurricane' must map to general storm safety advice
      const response = generateChatResponse('hurricane coming')
      expect(response.intent).toBe('storm')
      expect(response.text).toContain('Storm')
    })

    test('detects tornado', () => {
      const response = generateChatResponse('tornado warning')
      expect(response.intent).toBe('storm')
    })

    test('detects tsunami', () => {
      //Tsunami advice must urgently mention getting to high ground
      const response = generateChatResponse('tsunami warning')
      expect(response.intent).toBe('tsunami')
      expect(response.text).toContain('HIGH GROUND')
    })

    test('detects volcano', () => {
      const response = generateChatResponse('volcanic eruption')
      expect(response.intent).toBe('volcano')
    })

    test('detects landslide', () => {
      const response = generateChatResponse('landslide risk')
      expect(response.intent).toBe('landslide')
    })
  })

  //Emergency intents -- evacuation, first aid, contacts, reporting
  describe('emergency intents', () => {
    test('detects evacuation queries', () => {
      const response = generateChatResponse('how to evacuate')
      expect(response.intent).toBe('evac')
      expect(response.text).toContain('Evacuation')
    })

    test('detects first aid queries', () => {
      const response = generateChatResponse('first aid for bleeding')
      expect(response.intent).toBe('aid')
      expect(response.text).toContain('First Aid')
    })

    test('detects emergency contacts queries', () => {
      //Must include the UK emergency number 999
      const response = generateChatResponse('emergency number')
      expect(response.intent).toBe('contacts')
      expect(response.text).toContain('999')
    })

    test('detects report queries', () => {
      const response = generateChatResponse('how do I report')
      expect(response.intent).toBe('report')
      expect(response.text).toContain('How to Report')
    })
  })

  //Safety intents -- specific hazard-behaviour questions
  describe('safety intents', () => {
    test('detects flood water safety', () => {
      //When the message contains both 'flood' and 'water', 'flood' takes priority
      const response = generateChatResponse('walking through flood water')
      expect(response.intent).toBe('flood')
    })

    test('detects walking through water query', () => {
      //Without 'flood', the 'water' intent triggers the "NEVER enter floodwater" advice
      const response = generateChatResponse('is it safe to wade through water')
      expect(response.intent).toBe('water')
      expect(response.text).toContain('NEVER enter')
    })

    test('detects driving in floods', () => {
      const response = generateChatResponse('driving through flood')
      expect(response.intent).toBe('drive')
    })

    test('detects sandbag queries', () => {
      const response = generateChatResponse('how to use sandbags')
      expect(response.intent).toBe('sandbag')
    })

    test('detects power outage', () => {
      // '105' is the UK power outage report number from the advice text
      const response = generateChatResponse('power outage')
      expect(response.intent).toBe('power')
      expect(response.text).toContain('105')
    })

    test('detects shelter queries', () => {
      const response = generateChatResponse('where to find shelter')
      expect(response.intent).toBe('shelter')
    })

    test('detects supplies queries', () => {
      const response = generateChatResponse('emergency supplies list')
      expect(response.intent).toBe('supplies')
    })
  })

  //Vulnerable populations -- children, elderly, pets
  describe('vulnerable populations', () => {
    test('detects children queries', () => {
      const response = generateChatResponse('protecting my children')
      expect(response.intent).toBe('vuln')
    })

    test('detects elderly queries', () => {
      const response = generateChatResponse('elderly neighbour')
      expect(response.intent).toBe('vuln')
    })

    test('detects pet queries', () => {
      //Pet safety during evacuation is its own intent (distinct from general vuln)
      const response = generateChatResponse('evacuating with my dog')
      expect(response.intent).toBe('pets')
      expect(response.text).toContain('Pet Safety')
    })
  })

  //Mental health intents -- emotional support and crisis resources
  describe('mental health intents', () => {
    test('detects anxiety', () => {
      //Response must acknowledge feelings AND provide the Samaritans helpline number
      const response = generateChatResponse('I feel scared and anxious')
      expect(response.intent).toBe('anxiety')
      expect(response.text).toContain("It's okay to feel scared")
      expect(response.text).toContain('Samaritans') // UK mental health crisis line
    })

    test('detects panic via anxiety keywords', () => {
      // 'panicky' contains 'panic' which maps to the 'anxiety' intent
      const response = generateChatResponse("I'm feeling panicky")
      expect(response.intent).toBe('anxiety')
    })

    test('detects trauma via nightmares', () => {
      // 'nightmares' is a PTSD (Post-Traumatic Stress Disorder) symptom keyword
      const response = generateChatResponse('I have nightmares about it')
      expect(response.intent).toBe('trauma')
      expect(response.text).toContain('What you') // response starts with "What you're feeling"
    })

    test('detects grief', () => {
      //Losing one's home is a major grief trigger after a disaster
      const response = generateChatResponse('I lost my home')
      expect(response.intent).toBe('grief')
    })

    test('detects mental health', () => {
      const response = generateChatResponse('I need mental health support')
      expect(response.intent).toBe('mental')
    })

    test('detects child trauma', () => {
      //Children's distress needs age-appropriate advice in a separate intent
      const response = generateChatResponse('my child is scared')
      expect(response.intent).toBe('child_support')
      expect(response.text).toContain('Helping a scared child')
    })
  })

  //Climate-related intents -- heatwave, drought
  describe('climate-related intents', () => {
    test('detects heatwave', () => {
      const response = generateChatResponse('heatwave safety')
      expect(response.intent).toBe('heatwave')
      expect(response.text).toContain('Extreme Heat')
    })

    test('detects extreme heat', () => {
      // 'too hot outside' contains no direct keyword but the engine matches 'hot'
      const response = generateChatResponse('too hot outside')
      expect(response.intent).toBe('heatwave')
    })

    test('detects drought', () => {
      const response = generateChatResponse('drought conditions')
      expect(response.intent).toBe('drought')
      expect(response.text).toContain('Water Scarcity')
    })
  })

  //Other intents -- thanks, status, after-disaster recovery
  describe('other intents', () => {
    test('detects thanks', () => {
      const response = generateChatResponse('thank you')
      expect(response.intent).toBe('thanks')
      expect(response.text).toContain("You're welcome")
    })

    test('detects status queries', () => {
      const response = generateChatResponse('current situation')
      expect(response.intent).toBe('status')
    })

    test('detects after disaster queries', () => {
      //Post-flood clean-up advice is a common need during recovery phase
      const response = generateChatResponse('cleanup after flood')
      expect(response.intent).toBe('after')
    })
  })

  //Unknown intents -- graceful fallback for unrecognised input
  describe('unknown intents', () => {
    test('handles unknown queries gracefully', () => {
 //No matching keyword -> unknown intent with near-zero confidence
      const response = generateChatResponse('xyzabc random gibberish')
      expect(response.intent).toBe('unknown')
      expect(response.text).toContain('I can help with') // generic helper message
      expect(response.confidence).toBeLessThan(0.2)
    })

    test('handles empty input', () => {
      //Empty string must not crash; returns unknown intent
      const response = generateChatResponse('')
      expect(response.intent).toBe('unknown')
    })
  })

  //Multilingual support -- core keywords detected in multiple languages
  describe('multilingual support', () => {
    test('detects Spanish greeting', () => {
      // 'hola' = Spanish for 'hello'
      const response = generateChatResponse('hola')
      expect(response.intent).toBe('greet')
    })

    test('detects French greeting', () => {
      // 'bonjour' = French for 'hello'
      const response = generateChatResponse('bonjour')
      expect(response.intent).toBe('greet')
    })

    test('detects Spanish flood term', () => {
      // 'inundación' = Spanish for 'flood'
      const response = generateChatResponse('inundación')
      expect(response.intent).toBe('flood')
    })

    test('detects French earthquake term', () => {
      // 'séisme' = French for 'earthquake'
      const response = generateChatResponse('séisme')
      expect(response.intent).toBe('quake')
    })
  })

  //Confidence scoring -- relative certainty of the matched intent
  describe('confidence scoring', () => {
    test('higher confidence for specific matches', () => {
 // 'flooding in my area' has multiple flood keywords -> higher confidence
      //than 'random text' which matches nothing
      const floodResponse = generateChatResponse('flooding in my area')
      const unknownResponse = generateChatResponse('random text')
      
      expect(floodResponse.confidence).toBeGreaterThan(unknownResponse.confidence)
    })

    test('unknown intent has low confidence', () => {
      const response = generateChatResponse('xyz123')
      expect(response.confidence).toBeLessThan(0.2)
    })

    test('known intent has reasonable confidence', () => {
      //A direct keyword match like 'earthquake' must have confidence ≥ 0.6
      const response = generateChatResponse('earthquake')
      expect(response.confidence).toBeGreaterThanOrEqual(0.6)
    })
  })

  //Response structure -- shape of the returned object
  describe('response structure', () => {
    test('returns expected shape', () => {
      //All three fields must always be present and of the correct types
      const response = generateChatResponse('hello')
      
      expect(response).toHaveProperty('text')
      expect(response).toHaveProperty('intent')
      expect(response).toHaveProperty('confidence')
      
      expect(typeof response.text).toBe('string')
      expect(typeof response.intent).toBe('string')
      expect(typeof response.confidence).toBe('number')
    })

    test('response text is not empty', () => {
      //Every intent must produce at least some response text
      const response = generateChatResponse('flood')
      expect(response.text.length).toBeGreaterThan(0)
    })

    test('confidence is within valid range', () => {
      //Confidence must always be between 0 (impossible) and 1 (certain)
      const response = generateChatResponse('earthquake')
      expect(response.confidence).toBeGreaterThanOrEqual(0)
      expect(response.confidence).toBeLessThanOrEqual(1)
    })
  })
})

//getSuggestions -- quick-reply button labels per language
describe('getSuggestions', () => {
  test('returns English suggestions by default', () => {
 //No language arg -> falls back to English
    const suggestions = getSuggestions()
    expect(Array.isArray(suggestions)).toBe(true)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions).toContain('What do I do in a flood?')
  })

  test('returns English suggestions for en', () => {
    //Explicit 'en' code
    const suggestions = getSuggestions('en')
    expect(suggestions).toContain('What do I do in a flood?')
    expect(suggestions).toContain('Emergency contacts')
  })

  test('returns Spanish suggestions', () => {
    // 'es' = Spanish (ISO 639-1)
    const suggestions = getSuggestions('es')
    expect(suggestions).toContain('¿Qué hago en una inundación?')
  })

  test('returns French suggestions', () => {
    // 'fr' = French
    const suggestions = getSuggestions('fr')
    expect(suggestions).toContain("Que faire en cas d'inondation?")
  })

  test('returns Arabic suggestions', () => {
    // 'ar' = Arabic (RTL language -- Right To Left script)
    const suggestions = getSuggestions('ar')
    expect(suggestions).toContain('ماذا أفعل في الفيضان؟')
  })

  test('returns Chinese suggestions', () => {
    // 'zh' = Mandarin Chinese
    const suggestions = getSuggestions('zh')
    expect(suggestions).toContain('洪水中该怎么办？')
  })

  test('returns Hindi suggestions', () => {
    // 'hi' = Hindi (India)
    const suggestions = getSuggestions('hi')
    expect(suggestions).toContain('बाढ़ में क्या करें?')
  })

  test('returns German suggestions', () => {
    // 'de' = German
    const suggestions = getSuggestions('de')
    expect(suggestions).toContain('Was tun bei einer Überschwemmung?')
  })

  test('returns Portuguese suggestions', () => {
    // 'pt' = Portuguese
    const suggestions = getSuggestions('pt')
    expect(suggestions).toContain('O que fazer em uma inundação?')
  })

  test('returns Swahili suggestions', () => {
    // 'sw' = Swahili (East Africa)
    const suggestions = getSuggestions('sw')
    expect(suggestions).toContain('Nifanye nini wakati wa mafuriko?')
  })

  test('falls back to English for unknown language', () => {
    // 'xx' is not a real language code; should gracefully fall back to English
    const suggestions = getSuggestions('xx')
    expect(suggestions).toEqual(getSuggestions('en'))
  })

  test('returns array of strings', () => {
    //Every suggestion must be a non-empty string (no null entries)
    const suggestions = getSuggestions('en')
    suggestions.forEach(s => {
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    })
  })
})
