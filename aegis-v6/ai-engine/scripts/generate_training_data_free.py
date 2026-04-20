"""
Generate_training_data_free AI engine module.
"""

import argparse
import json
import os
import random
import re
import sys
import time
import hashlib
from pathlib import Path
from typing import Any

import httpx

# Load .env keys if not already in environment
def load_env_keys():
    """Load API keys from server/.env if not already set."""
    env_files = [
        Path(__file__).resolve().parent.parent.parent / "server" / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for env_file in env_files:
        if env_file.exists():
            with open(env_file, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip()
                    if key in ("GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"):
                        if not os.environ.get(key) or os.environ[key].startswith("PLACEHOLDER"):
                            os.environ[key] = val

load_env_keys()

# AEGIS System Prompt (identical to generate_training_data.py)
AEGIS_SYSTEM_PROMPT = """IDENTITY
You are AEGIS -- Advanced Emergency Geospatial Intelligence System. You are the world's most capable all-hazards emergency AI, specifically fine-tuned on: emergency management, disaster response, flood hydrology, wildfire behaviour, severe weather survival, structural and fire safety, medical triage in disaster contexts, evacuation planning, crisis communication, and community resilience across the UK and Scotland.

COGNITIVE FRAMEWORK
Before generating any response, execute this internal reasoning sequence:

STEP 1 -- CLASSIFY
LIFE_THREATENING: action needed in the next 60 seconds (vehicle flooding, cardiac arrest, house fire escape, structural collapse, gas leak, drowning, hypothermia onset, electrocution near water)
EMERGENCY: action needed in the next 30 minutes (flood approaching property, wildfire evacuation zone notification, severe red weather warning active, medical deterioration)
URGENT: action needed today (flood warning received, evacuation advised, medication running out, vulnerable person isolated)
INFORMATIONAL: planning, preparedness, training, general guidance
OPERATIONAL: platform usage, admin queries, operator functions, analytics

STEP 2 -- LOCATE
Use the location context provided. What active alerts, river gauges, weather warnings, and reported incidents are relevant to this location right now?

STEP 3 -- IDENTIFY
What is the user's most urgent need?
What is the second most urgent need they have not yet asked about?
What dangerous assumption might they be making right now?
What information gap could cost them time or safety?

STEP 4 -- STRUCTURE
For LIFE_THREATENING:
  ? CRITICAL ACTION in bold on line 1
  ? Numbered steps in time-critical order
  ? Emergency number and EXACT words to say when calling
  ? What to do while waiting for help
  ? Pre-empt the most likely next question
For EMERGENCY:
  ? Situation assessment (what is happening and what matters)
  ? Priority actions in order
  ? What to monitor and when to escalate to 999
  ? The one thing most people commonly get wrong in this situation
For URGENT:
  ? Complete guidance with all necessary detail
  ? Common mistakes and how to avoid them
  ? Available resources and contacts
For INFORMATIONAL:
  ? Comprehensive and structured
  ? Specific not vague: quantities, distances, times, numbers
  ? Sources to verify with

STEP 5 -- CALIBRATE
High distress, immediate danger: short sentences, direct, bold on critical action, under 150 words.
Active emergency, user calm: complete guidance, 150--300 words.
Planning/preparedness: comprehensive, 200--400 words, structured.
Never exceed 400 words. Never go below 80. Every sentence must earn its place.

RESPONSE PRINCIPLES
SPECIFICITY: "Move everything above 60cm off the ground floor" beats "protect your belongings."
SEQUENCE: The order of actions is as important as the actions. Number every list. Most time-critical first.
PREEMPT: Answer the most likely follow-up question without being asked.
ACKNOWLEDGE: In high-distress situations, one sentence of reality-grounded acknowledgement -- not hollow comfort. "The water is moving faster than it looks -- here is what you do." NOT "I understand this must be very scary."
NEVER MINIMISE: Do not say "no need to panic." Do not say "you're probably fine." Do not say "this is a routine situation" to someone whose home is flooding.
NEVER MAXIMISE: Do not catastrophise. No worst-case scenarios that serve no actionable purpose.
THE 999 RULE: Any response involving risk to human life includes 999. Always. Even if they have already called -- reinforce it.
HONEST LIMITS: You cannot see the situation. When the answer requires physical assessment you cannot make remotely, say so and direct to 999.
ACTIVE VOICE ALWAYS: "Move to the upper floor" not "the upper floor should be moved to."
NUMBERS ARE ANCHORS: "Six inches of fast-moving water can knock an adult off their feet. Two feet will float a car." Specific numbers are more memorable and actionable than vague warnings.
LANGUAGE MATCHING: Respond in the language the user writes in. If English is clearly not their first language, use simpler sentence structures without being condescending.

UK EMERGENCY KNOWLEDGE
Emergency numbers: 999 (immediate life risk -- Police, Fire, Ambulance, Coastguard), 111 (NHS non-emergency medical), 101 (non-emergency police)
Floodline (England/Wales/Scotland): 0345 988 1188
National Gas Emergency Service: 0800 111 999 (free, 24/7 -- leave the building FIRST, then call)
Samaritans: 116 123 (free, 24/7 -- mental health crisis, emotional distress)
Met Office Severe Weather Warnings: metoffice.gov.uk/weather/warnings-and-advice
SEPA Flood Warnings (Scotland): sepa.org.uk/environment/water/flooding
EA Flood Warnings (England): check-for-flooding.service.gov.uk

CRITICAL SAFETY FACTS
Six inches of fast-moving water can knock an adult off their feet.
Two feet of water will float or sweep away a car. Never drive into floodwater.
Flood water is contaminated -- sewage, chemicals, pathogens. Treat all contact as a health risk.
Most fire deaths are from smoke inhalation, not burns. CO and HCN cause rapid incapacitation. Get low -- clean air is near the floor.
Heat stroke: hot, dry, flushed skin + confusion = 999 (organ failure risk). Heat exhaustion: pale, cool, clammy skin = move to cool place, give fluids.
Carbon monoxide has no smell or taste. Headache, nausea, or confusion affecting multiple people in a building = evacuate immediately and call 999.
After a structural collapse with crush injury: call 999 BEFORE releasing the compression -- sudden release can cause fatal cardiac arrest from potassium dump.
Hypothermia: shivering (mild), confusion and stopping shivering (severe). Warm core first -- not extremities. Warm drinks only if fully conscious.

UK FLOOD ALERT LEVELS
Flood Alert (Yellow): flooding is possible -- be prepared, monitor, move valuables upstairs, know your route
Flood Warning (Amber): flooding is expected -- take immediate action, move possessions upstairs, move vehicle to higher ground, be ready to evacuate
Severe Flood Warning (Red): danger to life -- evacuate immediately, do not wait, take medication and documents, call 999 if trapped

SCOTLAND FLOOD ALERT LEVELS (SEPA)
Flood Alert ? Flood Warning ? Extreme Flood Warning (danger to life)

YOUR ABSOLUTE LIMITS
You are not emergency services. You support, inform, and guide -- but 999 is the call that saves lives when seconds matter.
You do not have eyes on the situation. You cannot see the water level, the fire, the structural damage. When the answer requires human judgement you cannot make remotely, say so and direct to 999.
You never fabricate data. A confident wrong answer in an emergency is more dangerous than an honest admission of uncertainty."""

# Category definitions -- 12 categories, 1,910 total target
CATEGORIES: list[dict[str, Any]] = [
    {
        "id": "life_threatening",
        "name": "Life-Threatening Immediate Emergencies",
        "target": 200,
        "batch_size": 3,
        "description": (
            "Someone is in immediate danger right now. Cover ALL of: trapped in a flooding vehicle, "
            "caught in a flash flood, house fire with blocked escape route, gas leak symptoms, "
            "carbon monoxide, building collapse, cardiac arrest nearby, person drowning, "
            "swept away by floodwater, trapped under debris, cliff edge, rip current, "
            "lightning strike survival, electrocution near water, river flash flood caught on foot, "
            "hypothermia onset, severe bleeding, anaphylaxis without EpiPen."
        ),
        "quality_check": lambda r: (
            "999" in r
            and len(r) >= 80
            and len(r) <= 2000
            and any(word in r.lower() for word in ["**", "1.", "call 999", "call"])
        ),
        "notes": (
            "Response MUST open with the single most critical action in bold. "
            "Include exact emergency number and what to say. Preempt the next question. "
            "Short sentences. Maximum urgency without panic."
        ),
    },
    {
        "id": "flood",
        "name": "Flood Events (All Types)",
        "target": 250,
        "batch_size": 3,
        "description": (
            "Cover the complete flood lifecycle for ALL flood types -- river flooding, surface water "
            "flooding, coastal surge, sewer flooding. Include: pre-flood warning, active flooding, "
            "ground floor flooding, upper-floor refuge, post-flood return safety, flood water "
            "contamination, flood + vulnerable person, flood + no car, flood + medical equipment, "
            "flood + pets, flood + winter, SEPA/EA Flood Warning explanation, flood prediction, "
            "3am flood warning, car in floodwater, multiple properties, commercial flood, "
            "flood with power cut, flood and gas leak."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "River flooding has 6-12 hour warning. Flash floods <30 min warning. Surface water floods "
            "anywhere. Flood water = sewage contaminated. 6 inches knocks adult down. 2 feet floats car. "
            "NEVER drive into floodwater."
        ),
    },
    {
        "id": "severe_weather",
        "name": "Severe Weather (All Types)",
        "target": 150,
        "batch_size": 3,
        "description": (
            "Cover ALL severe weather: Red wind warning, driving in white-out, lightning safety "
            "(30-30 rule), extreme heat (heat exhaustion vs heat stroke), extreme cold and hypothermia, "
            "ice driving, fog, hail, tornado (rare UK), storm preparation, Storm naming system, "
            "weather power cuts, coastal storm surge."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Heat exhaustion: pale, cool, clammy = cool place + fluids. Heat stroke: hot, dry, flushed + "
            "confusion = 999. 30-30 rule for lightning. Hypothermia: shivering?confusion?stop shivering. "
            "Warm core first."
        ),
    },
    {
        "id": "fire",
        "name": "Fire Safety and Response",
        "target": 150,
        "batch_size": 3,
        "description": (
            "Cover ALL fire scenarios: house fire escape blocked, smoke inhalation (CO/HCN), stay low, "
            "fire + mobility impairment, chimney fire, electrical fire (NEVER water), chip pan fire "
            "(NEVER water -- wet towel), wildfire approach/shelter, post-fire building entry, BBQ fire, "
            "garden fire, communal building fire, fire affecting sleeping occupants."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Most fire deaths from smoke not burns. CO/HCN from plastics. Get low. NEVER go back for "
            "possessions. NEVER open hot door -- back of hand test. Wildfire spreads uphill faster. "
            "Drive perpendicular to fire."
        ),
    },
    {
        "id": "medical_disaster",
        "name": "Medical Emergencies in Disaster Context",
        "target": 200,
        "batch_size": 3,
        "description": (
            "Medical emergencies DURING disasters: heart attack during evacuation, diabetic crisis in "
            "shelter, medication lost in flood, oxygen patient + power outage, dialysis + transport "
            "disruption, pregnant woman isolated by flood, child allergy in shelter, mental health "
            "crisis during displacement, PTSD episode, panic attack vs heart attack, crush injury "
            "(crush syndrome), wound management awaiting rescue, tourniquet, hypothermia rewarming, "
            "seizure during emergency, asthma in smoke, stroke during disaster, severe dehydration."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Always specify: what to do immediately, what NOT to do, when 999 vs manage locally, "
            "what to tell 999. Crush syndrome: call 999 BEFORE releasing compression. "
            "Panic vs heart attack: doubt = call 999."
        ),
    },
    {
        "id": "evacuation",
        "name": "Evacuation (All Scenarios)",
        "target": 150,
        "batch_size": 3,
        "description": (
            "Cover: ordered vs advised vs emergency evacuation, evacuation with pets, elderly who "
            "refuses to leave, mobility impairment + no vehicle, go bag contents, multiple routes, "
            "return after evacuation, shelter vs evacuate decision, evacuation centre arrival, "
            "medication management, vital documents, evacuating dementia patient, rural evacuation."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Ordered evacuation: no legal obligation to leave but no obligation to rescue if you stay. "
            "Mobility + no vehicle: call 999 and say 'mobility impairment, need evacuation assistance.' "
            "Go bag: 2L water/person, 3-day meds, ID copies, cash, warm clothes, power bank."
        ),
    },
    {
        "id": "vulnerable_populations",
        "name": "Vulnerable Populations",
        "target": 150,
        "batch_size": 3,
        "description": (
            "Someone who needs additional help: elderly alone during flood, child home alone, "
            "learning disability, dementia during evacuation, deaf/hard of hearing, blind person "
            "navigating emergency, mobility impairment in fire, mental illness in disaster, "
            "chronic illness + electricity dependent, refugee unfamiliar with UK systems, "
            "non-English speaker, tourist, pregnant woman, household with pets, remote property "
            "with no mobile signal."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Response must account for the SPECIFIC vulnerability, not generic + note. "
            "Deaf person: alarm solution IS the point. Non-English: simple structures. "
            "Vulnerable neighbour: guide them to help while getting professional support."
        ),
    },
    {
        "id": "preparedness",
        "name": "Emergency Preparedness and Planning",
        "target": 150,
        "batch_size": 3,
        "description": (
            "Emergency kit with specific quantities (3L/person/day, 72hr minimum, 7-day ideal), "
            "medication, document copies, emergency contact cards, family plan, vulnerable neighbour "
            "system, community resilience groups, business continuity, property flood protection "
            "(barriers, air bricks, sump pumps, sandbags), smoke/CO alarm placement, fire escape "
            "plan, winter driving kit, checking flood risk online."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Be SPECIFIC: not 'have enough water' but '3L per person per day, family of 4 = 12L/day, "
            "36L for 3-day kit, use 2L bottles.' No brand recommendations. Plan: write it, share it, "
            "practise it."
        ),
    },
    {
        "id": "post_disaster_recovery",
        "name": "Post-Disaster Recovery",
        "target": 130,
        "batch_size": 3,
        "description": (
            "Returning to flooded property (exact sequence), decontamination, salvageable vs not, "
            "documenting damage for insurance, making insurance claim, temporary accommodation rights, "
            "emergency financial assistance (Flood Recovery Grant, DWP), mental health after disaster "
            "(wave pattern), community recovery, returning to work after displacement, secondary "
            "hazards (mould timeline, structural movement), when to call structural engineer."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Return sequence: 1) Authority clearance, 2) Check outside, 3) Gas off at meter, "
            "4) No electrical switches until inspected, 5) Document before cleaning, 6) PPE. "
            "Mould: 24-48hrs, health hazard after 2 weeks. Asthma/immunocompromised must not enter."
        ),
    },
    {
        "id": "platform_navigation",
        "name": "AEGIS Platform Navigation",
        "target": 100,
        "batch_size": 3,
        "description": (
            "Questions about AEGIS: how to submit a hazard report, what AI confidence scores mean, "
            "setting up alert notifications, finding river levels, preparedness training, contacting "
            "emergency services through platform, safety check-in feature, how AI predictions work, "
            "sharing with elderly neighbour, offline mode, language change, accessibility features, "
            "privacy policy, reporting false alerts."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Warm, clear, practical. User may be asking during a stressful event. "
            "Never dismissive of platform questions -- often adjacent to real emergencies."
        ),
    },
    {
        "id": "operator_admin",
        "name": "Operator and Admin Queries",
        "target": 130,
        "batch_size": 3,
        "description": (
            "For admin chatbot -- professional coordinators and council staff: verifying citizen "
            "reports, escalating to emergency services, managing multiple incidents (priority matrix), "
            "writing public alerts (plain English), coordinating mutual aid, volunteer deployment "
            "checklist, analytics dashboard patterns, flood prediction for gauge/location, "
            "interpreting AI confidence scores, handling false reports, media enquiries, "
            "post-incident review data export."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Professional language. Assume competence. No need to explain basics. "
            "They need procedure clarity and decision frameworks. "
            "0.73 probability = 'crosses threshold for proactive action.'"
        ),
    },
    {
        "id": "edge_cases",
        "name": "Edge Cases and Adversarial Inputs",
        "target": 150,
        "batch_size": 3,
        "description": (
            "Non-standard inputs: fake emergency (treat as potentially real), out-of-scope (redirect), "
            "emotional crisis without physical danger (mental health first aid, Samaritans 116 123), "
            "angry user (de-escalation), information misuse potential, conflicting info, incomplete "
            "emergency info, refusal to call 999, intoxicated person in danger, resolved report, "
            "bereavement, child user, humorous/test input."
        ),
        "quality_check": lambda r: len(r) >= 80 and len(r) <= 2000,
        "notes": (
            "Most nuanced responses. Never dismissive, never robotic. Never catastrophise non-emergency. "
            "Mental health: validate, don't diagnose, signpost Samaritans (116 123, free, 24/7)."
        ),
    },
]

# Generation prompt template
GENERATION_PROMPT_TEMPLATE = """\
You are generating training data for AEGIS, the world's most advanced all-hazards emergency AI for the UK.

CATEGORY: {category_name}
DESCRIPTION: {description}
SPECIAL NOTES: {notes}

The SYSTEM PROMPT that AEGIS uses is provided below. Each training example must include it.

-- -BEGIN SYSTEM PROMPT
{system_prompt}
-- -END SYSTEM PROMPT

Generate EXACTLY {batch_size} training examples. Each must be a JSON object with this structure:
{{
  "messages": [
    {{"role": "system", "content": "<the full AEGIS system prompt above>"}},
    {{"role": "user", "content": "<realistic user message>"}},
    {{"role": "assistant", "content": "<ideal AEGIS response>"}}
  ]
}}

Return a JSON array of {batch_size} objects. CRITICAL REQUIREMENTS:
1. User messages must be realistic -- real people type in panic, incomplete sentences, phone typing, spelling errors. VARY the register: some panicked, some calm planning.
2. Responses must be 80-400 words. Every sentence must earn its place.
3. Every response involving risk to life includes 999.
4. Responses must feel like a highly trained emergency professional -- not a chatbot.
5. VARY scenarios -- no two should be the same. Cover different sub-topics each batch.
6. Do NOT start responses with "I", "As an AI", "Great question", "Certainly", or filler.
7. Do NOT end responses with "Stay safe!", "I hope this helps!", or filler.
8. Bold the most critical action in LIFE_THREATENING scenarios using **.
9. Number action lists. Most time-critical first.
10. UK-specific: 999, NHS 111, SEPA, EA, Met Office. Not US numbers.

Avoid duplicating these already-generated scenarios:
{existing_scenarios}

Return ONLY valid JSON array. No markdown fences, no preamble, no explanation."""

# LLM Provider Abstraction
class LLMProvider:
    """Base class for free LLM API providers."""
    name: str = "base"
    rpm: int = 10  # requests per minute
    last_call: float = 0.0

    def wait_for_rate_limit(self):
        """Wait if needed to respect rate limit."""
        min_interval = 60.0 / self.rpm
        elapsed = time.time() - self.last_call
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed + random.random() * 0.3)
        self.last_call = time.time()

    def generate(self, prompt: str, client: httpx.Client) -> str:
        raise NotImplementedError

class GeminiProvider(LLMProvider):
    name = "gemini"
    rpm = 8  # very conservative -- 15 RPM free tier but aggressive 429s

    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate(self, prompt: str, client: httpx.Client) -> str:
        self.wait_for_rate_limit()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={self.api_key}"
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.8,
                "maxOutputTokens": 8192,
            },
        }
        resp = client.post(url, json=body, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]

class GroqProvider(LLMProvider):
    name = "groq"
    rpm = 15  # conservative -- free tier is 30 RPM but has token/min caps

    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate(self, prompt: str, client: httpx.Client) -> str:
        self.wait_for_rate_limit()
        url = "https://api.groq.com/openai/v1/chat/completions"
        body = {
            "model": "llama-3.1-8b-instant",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.8,
            "max_tokens": 8192,
        }
        resp = client.post(
            url, json=body, timeout=120,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

class OpenRouterProvider(LLMProvider):
    name = "openrouter"
    rpm = 15

    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate(self, prompt: str, client: httpx.Client) -> str:
        self.wait_for_rate_limit()
        url = "https://openrouter.ai/api/v1/chat/completions"
        body = {
            "model": "qwen/qwen3-coder:free",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.8,
            "max_tokens": 8192,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://aegis-emergency.app",
            "X-Title": "AEGIS Emergency AI Training",
        }
        resp = client.post(url, json=body, timeout=120, headers=headers)
        if resp.status_code == 404:
            for fallback in ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-3n-e4b-it:free", "qwen/qwen3-4b:free"]:
                body["model"] = fallback
                resp = client.post(url, json=body, timeout=120, headers=headers)
                if resp.status_code != 404:
                    break
        resp.raise_for_status()
        data = resp.json()
        # Some models use thinking tags -- strip them
        content = data["choices"][0]["message"]["content"]
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        return content

class OllamaProvider(LLMProvider):
    """Local Ollama -- no rate limits, unlimited throughput.
    Uses format:'json' for reliable output. Generates 1 example at a time
    but wraps it in an array for compatibility.
    """
    name = "ollama"
    rpm = 999  # no rate limit
    _use_json_mode = True

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model

    def generate(self, prompt: str, client: httpx.Client) -> str:
        """Generate using Ollama with structured JSON mode."""
        url = "http://localhost:11434/api/chat"

        # Extract category/description from the prompt for a focused single-example prompt
        import re as _re
        cat_match = _re.search(r'CATEGORY:\s*(.+)', prompt)
        desc_match = _re.search(r'DESCRIPTION:\s*(.+)', prompt)
        notes_match = _re.search(r'SPECIAL NOTES:\s*(.+)', prompt)
        cat = cat_match.group(1) if cat_match else "Emergency Scenario"
        desc = desc_match.group(1) if desc_match else ""
        notes = notes_match.group(1) if notes_match else ""

        single_prompt = f"""Generate ONE training example for an emergency AI chatbot.

Category: {cat}
Scenarios to cover: {desc[:300]}
Quality notes: {notes[:200]}

Return a JSON object with EXACTLY this structure (all 3 messages required):
{{
  "messages": [
    {{"role": "system", "content": "You are AEGIS emergency AI."}},
    {{"role": "user", "content": "A realistic emergency question from a UK citizen. Write as someone would actually type during an emergency - sometimes panicked, sometimes calm."}},
    {{"role": "assistant", "content": "The ideal emergency response. 100-300 words. UK-specific (999 not 911). Include numbered action steps. Start with the most critical action. Include 999 when life is at risk. Never start with filler like 'Great question' or 'I understand'."}}
  ]
}}

The JSON object MUST have exactly 3 messages: system, user, and assistant. The assistant content must be a complete emergency response of 100-300 words."""

        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": single_prompt}],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.85, "num_predict": 2048},
        }
        resp = client.post(url, json=body, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "")

class ProviderPool:
    """Smart provider pool -- prefers healthy providers, cooldown on failures."""

    def __init__(self):
        self.providers: list[LLMProvider] = []
        self._cooldowns: dict[str, float] = {}  # provider name ? cooldown-until timestamp

        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        groq_key = os.environ.get("GROQ_API_KEY", "")
        openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

        # Check for local Ollama first -- unlimited throughput
        ollama_model = os.environ.get("OLLAMA_GEN_MODEL", "gemma3:4b")
        try:
            r = httpx.get("http://localhost:11434/api/tags", timeout=3)
            models = [m["name"] for m in r.json().get("models", [])]
            if ollama_model in models or any(ollama_model.split(":")[0] in m for m in models):
                self.providers.append(OllamaProvider(ollama_model))
                print(f"  Local Ollama: {ollama_model} (unlimited)")
        except Exception:
            pass

        # Cloud providers as supplements
        if groq_key and not groq_key.startswith("PLACEHOLDER"):
            self.providers.append(GroqProvider(groq_key))
        if gemini_key and not gemini_key.startswith("PLACEHOLDER"):
            self.providers.append(GeminiProvider(gemini_key))
        if openrouter_key and not openrouter_key.startswith("PLACEHOLDER"):
            self.providers.append(OpenRouterProvider(openrouter_key))

    @property
    def available(self) -> int:
        return len(self.providers)

    def mark_failed(self, provider_name: str, cooldown_secs: float = 30):
        """Put a provider on cooldown after a failure."""
        self._cooldowns[provider_name] = time.time() + cooldown_secs

    def next(self) -> LLMProvider:
        """Get next available provider, preferring ones not on cooldown."""
        now = time.time()
        # Try providers not on cooldown first
        for p in self.providers:
            cd = self._cooldowns.get(p.name, 0)
            if now >= cd:
                return p
        # All on cooldown -- use the one with shortest remaining cooldown
        best = min(self.providers, key=lambda p: self._cooldowns.get(p.name, 0))
        wait = self._cooldowns.get(best.name, 0) - now
        if wait > 0:
            time.sleep(wait)
        return best

    def all_names(self) -> list[str]:
        return [p.name for p in self.providers]

# Validation (same as original)
def validate_example(example: dict, category: dict) -> tuple[bool, str]:
    """Validate a single training example against quality gates."""
    try:
        msgs = example.get("messages", [])
        if len(msgs) != 3:
            return False, f"Expected 3 messages, got {len(msgs)}"

        roles = [m.get("role") for m in msgs]
        if roles != ["system", "user", "assistant"]:
            return False, f"Wrong role order: {roles}"

        user_msg = msgs[1].get("content", "")
        if len(user_msg) < 5:
            return False, "User message too short"

        response = msgs[2].get("content", "")
        if len(response) < 80:
            return False, f"Response too short: {len(response)} chars"
        if len(response) > 2500:
            return False, f"Response too long: {len(response)} chars"

        # Category-specific quality check
        if not category["quality_check"](response):
            return False, "Failed category-specific quality check"

        # Filler openings
        bad_openings = ["i ", "as an ai", "great question", "certainly!", "of course!", "sure,", "absolutely!"]
        response_lower = response.lower()
        for bad in bad_openings:
            if response_lower.startswith(bad):
                return False, f"Starts with filler: '{bad}'"

        # Filler closings
        bad_closings = ["stay safe!", "i hope this helps", "take care!", "good luck!"]
        for bad in bad_closings:
            if response_lower.rstrip().endswith(bad):
                return False, f"Ends with filler: '{bad}'"

        return True, "OK"
    except Exception as e:
        return False, f"Validation error: {e}"

def deduplicate_check(example: dict, seen_hashes: set) -> bool:
    """Return True if example is new (not duplicate)."""
    user_msg = example["messages"][1]["content"].lower().strip()
    fingerprint = hashlib.md5(user_msg[:60].encode()).hexdigest()
    if fingerprint in seen_hashes:
        return False
    seen_hashes.add(fingerprint)
    return True

# Batch generation via free APIs
def generate_batch(
    pool: ProviderPool,
    http_client: httpx.Client,
    category: dict,
    existing_scenarios: list[str],
    retries: int = 5,
) -> tuple[list[dict], str]:
    """Generate a batch of training examples via free API providers."""
    # Heavily truncate system prompt in generation request to save tokens
    # The FULL prompt gets injected into each example after generation
    truncated_prompt = (
        "You are AEGIS -- Advanced Emergency Geospatial Intelligence System. UK all-hazards emergency AI. "
        "5-step framework: CLASSIFY urgency ? LOCATE ? IDENTIFY needs ? STRUCTURE response ? CALIBRATE tone. "
        "Response principles: SPECIFICITY over generality, SEQUENCE (numbered lists), PREEMPT follow-ups, "
        "ACKNOWLEDGE distress without hollow comfort, NEVER MINIMISE/MAXIMISE, 999 RULE (always mention 999 "
        "for life risk), HONEST LIMITS, ACTIVE VOICE, NUMBERS ARE ANCHORS. "
        "UK numbers: 999 emergency, 111 NHS, 0345 988 1188 Floodline, 0800 111 999 Gas. "
        "Flood levels: Alert (prepare) ? Warning (act now) ? Severe Warning (danger to life, evacuate). "
        "80-400 words. Never filler. Never start with 'I' or 'Great question'."
    )

    prompt = GENERATION_PROMPT_TEMPLATE.format(
        category_name=category["name"],
        description=category["description"],
        notes=category["notes"],
        system_prompt=truncated_prompt,
        batch_size=category["batch_size"],
        existing_scenarios=(
            "\n".join(f"- {s}" for s in existing_scenarios[-15:])
            if existing_scenarios
            else "(none yet)"
        ),
    )

    # Single attempt with one provider -- the main loop handles retries
    provider = pool.next()
    try:
        raw = provider.generate(prompt, http_client)

        # Strip markdown fences and thinking tags
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
        raw = re.sub(r"\n?\s*```$", "", raw)
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
        raw = raw.strip()

        # Find JSON -- array or single object
        start_arr = raw.find("[")
        start_obj = raw.find("{")
        if start_arr >= 0 and (start_arr < start_obj or start_obj < 0):
            end = raw.rfind("]")
            if end > start_arr:
                raw = raw[start_arr:end + 1]
        elif start_obj >= 0:
            end = raw.rfind("}")
            if end > start_obj:
                raw = raw[start_obj:end + 1]

        # Try parsing; if control chars break it, clean up and retry
        try:
            examples = json.loads(raw)
        except json.JSONDecodeError:
            raw = raw.replace('\r\n', '\\n').replace('\r', '\\n').replace('\t', '\\t')
            raw = re.sub(r'(?<=[^,\[\{])\n(?=[^,\]\}])', '\\n', raw)
            examples = json.loads(raw)

        if not isinstance(examples, list):
            examples = [examples]

        # Inject full system prompt
        for ex in examples:
            if "messages" in ex and len(ex["messages"]) >= 1:
                ex["messages"][0]["content"] = AEGIS_SYSTEM_PROMPT

        return examples, provider.name

    except json.JSONDecodeError as e:
        print(f"  [{provider.name}] JSON err", end="", flush=True)
        pool.mark_failed(provider.name, 5)
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status == 429:
            pool.mark_failed(provider.name, 15)
        else:
            print(f"  [{provider.name}] HTTP {status}", end="", flush=True)
            pool.mark_failed(provider.name, 30)
    except httpx.TimeoutException:
        pool.mark_failed(provider.name, 5)
    except Exception as e:
        print(f"  [{provider.name}] err:{str(e)[:40]}", end="", flush=True)
        pool.mark_failed(provider.name, 10)

    return [], provider.name

# Checkpoint helpers
def load_checkpoint(checkpoint_path: Path) -> dict:
    if checkpoint_path.exists():
        with open(checkpoint_path) as f:
            return json.load(f)
    return {cat["id"]: 0 for cat in CATEGORIES}

def save_checkpoint(checkpoint_path: Path, counts: dict) -> None:
    with open(checkpoint_path, "w") as f:
        json.dump(counts, f, indent=2)

def count_existing(output_path: Path) -> tuple[dict, set, list[str]]:
    """Count existing examples per category and collect seen hashes."""
    counts = {cat["id"]: 0 for cat in CATEGORIES}
    seen_hashes: set = set()
    recent_user_msgs: list[str] = []

    if not output_path.exists():
        return counts, seen_hashes, recent_user_msgs

    with open(output_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ex = json.loads(line)
                cat_id = ex.get("category", "unknown")
                if cat_id in counts:
                    counts[cat_id] += 1
                user_msg = ex["messages"][1]["content"]
                fingerprint = hashlib.md5(user_msg[:60].lower().encode()).hexdigest()
                seen_hashes.add(fingerprint)
                recent_user_msgs.append(user_msg[:80])
            except Exception:
                continue

    return counts, seen_hashes, recent_user_msgs[-100:]

# Main
def main() -> None:
    parser = argparse.ArgumentParser(description="Generate AEGIS fine-tuning dataset (FREE APIs)")
    parser.add_argument("--output", default="./data/aegis_training_data.jsonl", help="Output JSONL path")
    parser.add_argument("--resume", action="store_true", help="Resume from existing progress")
    parser.add_argument("--category", default=None, help="Only generate for one category ID")
    parser.add_argument("--dry-run", action="store_true", help="Print first prompt without calling API")
    args = parser.parse_args()

    pool = ProviderPool()
    if not args.dry_run and pool.available == 0:
        print("ERROR: No free API keys found. Set GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY")
        print("  Keys can be in environment or in ../server/.env")
        sys.exit(1)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_path.with_suffix(".checkpoint.json")

    total_target = sum(c["target"] for c in CATEGORIES)

    print(f"\n{'='*60}")
    print(f"AEGIS Training Data Generator -- FREE API Edition")
    print(f"{'='*60}")
    print(f"Output: {output_path}")
    print(f"Target: {total_target:,} examples across {len(CATEGORIES)} categories")
    print(f"Providers: {', '.join(pool.all_names())} ({pool.available} active)")
    print(f"Combined rate: ~{sum(p.rpm for p in pool.providers)} req/min")

    # Count existing data
    existing_counts, seen_hashes, recent_user_msgs = count_existing(output_path)
    total_existing = sum(existing_counts.values())
    print(f"Existing: {total_existing:,} / {total_target:,}")

    if args.dry_run:
        cat = CATEGORIES[0]
        prompt = GENERATION_PROMPT_TEMPLATE.format(
            category_name=cat["name"],
            description=cat["description"],
            notes=cat["notes"],
            system_prompt="[AEGIS SYSTEM PROMPT - truncated for dry run]",
            batch_size=cat["batch_size"],
            existing_scenarios="(none)",
        )
        print(f"\n--- DRY RUN: First generation prompt ({len(prompt)} chars) ---")
        print(prompt[:2000])
        return

    http_client = httpx.Client()
    categories_to_run = [c for c in CATEGORIES if args.category is None or c["id"] == args.category]

    provider_stats: dict[str, int] = {}
    start_time = time.time()

    try:
        with open(output_path, "a", encoding="utf-8") as out_file:
            for category in categories_to_run:
                cat_id = category["id"]
                current_count = existing_counts.get(cat_id, 0)
                target = category["target"]

                if current_count >= target:
                    print(f"\n[{cat_id}] Already complete: {current_count}/{target}")
                    continue

                print(f"\n[{cat_id}] Generating {target - current_count} more ({current_count}/{target} done)")

                cat_user_msgs: list[str] = []
                accepted = 0
                rejected = 0
                consecutive_failures = 0

                while current_count < target:
                    remaining = target - current_count
                    elapsed = time.time() - start_time
                    rate = (sum(existing_counts.values()) - total_existing) / max(elapsed / 60, 0.01)
                    print(
                        f"  [{cat_id}] need {remaining} more | "
                        f"{accepted} ok / {rejected} bad | "
                        f"{rate:.0f} ex/min",
                        end=" ... ",
                        flush=True,
                    )

                    examples, provider_name = generate_batch(pool, http_client, category, cat_user_msgs)
                    provider_stats[provider_name] = provider_stats.get(provider_name, 0) + 1

                    if not examples:
                        consecutive_failures += 1
                        # Progressive backoff: wait longer as failures stack
                        wait = min(8 + consecutive_failures * 5, 45)
                        print(f"-- (wait {wait}s)", end="", flush=True)
                        if consecutive_failures >= 20:
                            print(f"\n  WARNING: {consecutive_failures} consecutive failures. Moving to next category.")
                            break
                        time.sleep(wait)
                        continue

                    consecutive_failures = 0
                    batch_accepted = 0

                    for ex in examples:
                        valid, reason = validate_example(ex, category)
                        if not valid:
                            rejected += 1
                            if rejected <= 3 or rejected % 20 == 0:
                                print(f"\n    REJECT: {reason}", end="", flush=True)
                            continue

                        if not deduplicate_check(ex, seen_hashes):
                            rejected += 1
                            continue

                        ex["category"] = cat_id
                        out_file.write(json.dumps(ex, ensure_ascii=False) + "\n")
                        cat_user_msgs.append(ex["messages"][1]["content"][:80])
                        current_count += 1
                        accepted += 1
                        batch_accepted += 1

                    out_file.flush()
                    print(f"[{provider_name}] +{batch_accepted}/{len(examples)}")

                    # Bail if rejection rate is catastrophic
                    if rejected > target * 4 and accepted < target * 0.1:
                        print(f"  WARNING: Extremely high rejection rate. Stopping category.")
                        break

                existing_counts[cat_id] = current_count
                save_checkpoint(checkpoint_path, existing_counts)
                total = sum(existing_counts.values())
                print(f"  [{cat_id}] Done: {current_count}/{target} | Total: {total:,}")

    except KeyboardInterrupt:
        print("\n\nInterrupted! Progress saved via checkpoint.")
        save_checkpoint(checkpoint_path, existing_counts)
    finally:
        http_client.close()

    # Final summary
    final_total = sum(existing_counts.values())
    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"GENERATION COMPLETE")
    print(f"{'='*60}")
    print(f"Total examples: {final_total:,} / {total_target:,}")
    print(f"Time: {elapsed/60:.1f} minutes")
    print(f"Output: {output_path}")
    print(f"\nProvider usage:")
    for name, count in sorted(provider_stats.items()):
        print(f"  {name:15s}: {count} API calls")
    print(f"\nCategory breakdown:")
    for cat in CATEGORIES:
        count = existing_counts.get(cat["id"], 0)
        pct = count * 30 // max(cat["target"], 1)
        bar = "--" * pct + "--" * (30 - pct)
        print(f"  {cat['id']:30s} {bar} {count:4d}/{cat['target']}")
    print(f"\nNext step: python scripts/train_aegis_llm.py --dataset {output_path}")

if __name__ == "__main__":
    main()

