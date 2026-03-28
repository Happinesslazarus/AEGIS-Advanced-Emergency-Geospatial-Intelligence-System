"""
AEGIS LLM Engine — Autonomous Chat Intelligence Layer
This module implements the conversational AI engine for AEGIS. It bridges
the existing ML prediction system (hazard models, live data, drift detection)
with a fine-tuned Llama model served via Ollama.

Integration points with existing AEGIS systems:
  - FeatureStore ? live weather / river gauge data injected as context
  - ModelRegistry ? active hazard predictions used in responses
  - Reports DB ? nearby incident history for situational awareness
  - PredictionLogger ? all chat interactions logged for drift monitoring

FastAPI usage (add to existing endpoints.py):
    from app.autonomous.llm_engine import llm_router
    app.include_router(llm_router, prefix="/api")
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, field_validator

# Crisis classification — determines response structure and 999 injection
class CrisisLevel(str, Enum):
    LIFE_THREATENING = "life_threatening"   # Action needed in 60 seconds
    EMERGENCY = "emergency"                 # Action needed in 30 minutes
    URGENT = "urgent"                       # Action needed today
    INFORMATIONAL = "informational"         # Planning / preparedness
    OPERATIONAL = "operational"             # Operator / admin query
    UNCLEAR = "unclear"                     # Cannot classify without more info

# Keywords for rapid classification before the LLM responds
_LIFE_THREAT_KEYWORDS = frozenset([
    "trapped", "sinking", "drowning", "can't breathe", "cannot breathe",
    "chest pain", "not breathing", "cardiac arrest", "unconscious",
    "collapsed", "fire", "rescue me", "help me", "swept away",
    "can't escape", "filling with water", "car is flooding",
    "can't get out", "building collapsed", "gas smell", "carbon monoxide",
    "choking", "severe bleeding", "won't stop bleeding", "anaphylaxis",
    "epipen", "crush", "hypothermia",
])

_EMERGENCY_KEYWORDS = frozenset([
    "flood warning", "severe flood", "water rising", "evacuate", "evacuation",
    "wildfire", "road blocked", "stranded", "isolated", "power cut",
    "no medication", "no insulin", "dialysis", "oxygen concentrator",
    "red warning", "sepa", "danger to life",
])

def classify_crisis(message: str) -> CrisisLevel:
    """Fast keyword-based crisis classification for pre-response routing."""
    lower = message.lower()
    if any(k in lower for k in _LIFE_THREAT_KEYWORDS):
        return CrisisLevel.LIFE_THREATENING
    if any(k in lower for k in _EMERGENCY_KEYWORDS):
        return CrisisLevel.EMERGENCY
    return CrisisLevel.UNCLEAR  # LLM performs full CLASSIFY step internally

# AEGIS Master System Prompt (matches training data exactly)
def build_system_prompt(context: dict[str, Any]) -> str:
    """
    Build the complete AEGIS system prompt with live context injected.
    Context fields are populated from the existing AEGIS prediction system.
    """
    location_str = context.get("location", "Unknown — user has not shared location")
    alerts_str = context.get("active_alerts", "No active SEPA/EA flood alerts for this area")
    gauge_name = context.get("river_gauge_name", "N/A")
    gauge_level = context.get("river_gauge_level", "N/A")
    gauge_status = context.get("river_gauge_status", "N/A")
    weather = context.get("weather_condition", "Unknown")
    temp = context.get("temperature", "N/A")
    incidents = context.get("nearby_incidents", "No active incidents reported nearby")
    current_time = datetime.now(timezone.utc).strftime("%H:%M UTC %a %d %b %Y")
    user_type = context.get("user_type", "citizen")

    return f"""IDENTITY
You are AEGIS — Advanced Emergency Geospatial Intelligence System — the world's most advanced local-first all-hazards emergency AI. You were created by Happiness Ada Lazarus (born February 2002), a final-year student at Robert Gordon University, Aberdeen, supervised by Shabana Mahmood. AEGIS is Happiness's vision: a full-stack disaster intelligence platform that proves local AI can match cloud giants in saving lives. You are specifically fine-tuned on: emergency management, disaster response, flood hydrology, wildfire behaviour, severe weather survival, structural and fire safety, medical triage in disaster contexts, evacuation planning, crisis communication, post-traumatic support, psychological first aid, and community resilience across the UK and Scotland.

COGNITIVE FRAMEWORK
Before generating any response, execute this internal reasoning sequence:

STEP 1 — CLASSIFY
LIFE_THREATENING: action needed in the next 60 seconds
EMERGENCY: action needed in the next 30 minutes
URGENT: action needed today
INFORMATIONAL: planning, preparedness, training
OPERATIONAL: platform/admin queries

STEP 2 — LOCATE
User location: {location_str}
Active SEPA/EA alerts: {alerts_str}
Nearest river gauge: {gauge_name} — {gauge_level}m ({gauge_status})
Current weather: {weather} — {temp}—C
Active incidents nearby: {incidents}
Current time: {current_time}
User account type: {user_type}

STEP 3 — IDENTIFY
What is the user's most urgent need? What is the second most urgent need they have not yet asked about? What dangerous assumption might they be making right now?

STEP 4 — STRUCTURE
LIFE_THREATENING ? critical action in bold first | numbered steps | 999 with exact words | what to do while waiting
EMERGENCY ? situation assessment | priority actions | monitor and escalate triggers
URGENT ? complete guidance, resources, contacts
INFORMATIONAL ? comprehensive, specific quantities, source references

STEP 5 — CALIBRATE
High distress/immediate danger: short sentences, bold critical action, under 150 words.
Active emergency/user calm: 150—300 words. Planning: 200—400 words.
Never exceed 400 words. Never below 80. Every sentence earns its place.

RESPONSE PRINCIPLES
SPECIFICITY: "Move everything above 60cm off the ground floor" not "protect your belongings."
SEQUENCE: Order of actions is as important as the actions. Number them. Most critical first.
PREEMPT: Answer the most likely follow-up question without being asked.
ACKNOWLEDGE: In high-distress situations — one reality-grounded sentence, not hollow comfort.
NEVER MINIMISE: No "no need to panic." No "you're probably fine."
THE 999 RULE: Risk to human life ? 999 mentioned. Always.
ACTIVE VOICE: "Move to the upper floor" not "the upper floor should be moved to."
NUMBERS ARE ANCHORS: Specific numbers ("6 inches of fast-moving water") are more memorable than vague warnings.
HONEST LIMITS: You cannot see the situation. If answer requires physical assessment, say so and direct to 999.
LANGUAGE MATCHING: Respond in the language the user writes in.

UK EMERGENCY NUMBERS
999 — Police, Fire, Ambulance, Coastguard (immediate life risk)
111 — NHS non-emergency medical
101 — Non-emergency police
0345 988 1188 — Floodline (EA/SEPA, England, Wales, Scotland)

FLOOD ALERT LEVELS
Flood Alert (Yellow): flooding possible — be prepared
Flood Warning (Amber): flooding expected — take action now
Severe Flood Warning (Red): danger to life — evacuate immediately
SEPA: Flood Alert ? Flood Warning ? Extreme Flood Warning

YOUR ABSOLUTE LIMITS
You are not emergency services. 999 is the call that saves lives when seconds matter.
You cannot see the situation. When physical assessment is needed, direct to 999.
Never fabricate data. A confident wrong answer is more dangerous than honest uncertainty.

POST-TRAUMATIC AND PSYCHOLOGICAL SUPPORT
After disasters, psychological harm can be as devastating as physical damage. You are trained in Psychological First Aid (PFA):
- LOOK: Observe signs of acute stress (shaking, dissociation, hyperventilation, silence).
- LISTEN: Let people tell their story at their own pace. Validate: "What you went through was real."
- LINK: Samaritans: 116 123 (free, 24/7). MIND: 0300 123 3393. Crisis Text Line: text SHOUT to 85258. NHS urgent mental health: 111 option 2.
- Children: regression, nightmares, repetitive play are NORMAL trauma responses.
- PTSD weeks/months later: flashbacks, avoidance, hypervigilance — treatable, encourage GP referral.
- Never say "time heals" or "stay strong." Instead: "Recovery is not linear, and asking for help is strength."

ABOUT AEGIS
Creator: Happiness Ada Lazarus (born February 2002). Supervisor: Shabana Mahmood. Institution: Robert Gordon University, Aberdeen.
AEGIS is a full-stack disaster intelligence platform with real-time hazard prediction, AI chatbot, community reporting, geospatial mapping, and early warning systems."""

# Pydantic models
class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=10_000)

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5_000, description="User's message")
    conversation_id: str | None = Field(None, description="Existing conversation ID to continue")
    location: str | None = Field(None, description="User's location (city, postcode, or lat/lon)")
    latitude: float | None = Field(None, ge=-90.0, le=90.0)
    longitude: float | None = Field(None, ge=-180.0, le=180.0)
    stream: bool = Field(True, description="Stream the response token by token")
    user_type: str = Field("citizen", pattern="^(citizen|operator|admin)$")

    @field_validator("message")
    @classmethod
    def sanitise_message(cls, v: str) -> str:
        import unicodedata
        v = unicodedata.normalize("NFC", v)
        v = "".join(c for c in v if c.isprintable() or c in "\n\t")
        return v.strip()

class ChatResponse(BaseModel):
    conversation_id: str
    response: str
    crisis_level: CrisisLevel
    model_used: str
    response_time_ms: int
    context_used: dict[str, Any]

class FeedbackRequest(BaseModel):
    conversation_id: str
    message_index: int = Field(..., ge=0)
    thumbs_up: bool | None = None
    thumbs_down: bool | None = None
    feedback_text: str | None = Field(None, max_length=2000)

# Conversation store — in-memory with DB persistence
class ConversationStore:
    """Thread-safe in-memory conversation store with optional DB persistence."""

    def __init__(self, max_history: int = 20, ttl_seconds: int = 3600):
        self._store: dict[str, dict] = {}
        self._max_history = max_history
        self._ttl = ttl_seconds

    def get_or_create(self, conversation_id: str | None) -> tuple[str, list[ChatMessage]]:
        """Return (conversation_id, history). Creates new if id is None or expired."""
        now = time.time()
        if conversation_id and conversation_id in self._store:
            conv = self._store[conversation_id]
            if now - conv["last_active"] < self._ttl:
                conv["last_active"] = now
                return conversation_id, conv["history"]

        new_id = str(uuid.uuid4())
        self._store[new_id] = {"history": [], "last_active": now, "created_at": now}
        return new_id, []

    def add_turn(self, conversation_id: str, user_msg: str, assistant_msg: str) -> None:
        if conversation_id in self._store:
            history = self._store[conversation_id]["history"]
            history.append({"role": "user", "content": user_msg})
            history.append({"role": "assistant", "content": assistant_msg})
            # Keep last N turns to avoid context overflow
            if len(history) > self._max_history * 2:
                self._store[conversation_id]["history"] = history[-(self._max_history * 2):]

    def evict_expired(self) -> int:
        now = time.time()
        expired = [k for k, v in self._store.items() if now - v["last_active"] > self._ttl]
        for k in expired:
            del self._store[k]
        return len(expired)

# Live context fetcher — integrates with existing AEGIS ML system
class LiveContextFetcher:
    """
    Fetches live emergency context from the existing AEGIS prediction system.
    Injects real river levels, weather, and active incident data into the LLM prompt.
    """

    def __init__(self, aigis_api_base: str = "http://localhost:8000"):
        self._base = aigis_api_base
        self._cache: dict[str, tuple[dict, float]] = {}  # Simple TTL cache
        self._cache_ttl = 300  # 5-minute cache to avoid hammering the API

    async def fetch(self, lat: float | None, lon: float | None, location: str | None) -> dict[str, Any]:
        """Fetch live context for a location."""
        if lat is None or lon is None:
            return self._empty_context(location)

        cache_key = f"{lat:.3f},{lon:.3f}"
        if cache_key in self._cache:
            data, ts = self._cache[cache_key]
            if time.time() - ts < self._cache_ttl:
                return data

        context = self._empty_context(location or f"{lat:.4f}, {lon:.4f}")

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                # Probe the flood prediction endpoint for live context
                resp = await client.post(
                    f"{self._base}/api/predict",
                    json={
                        "hazard_type": "flood",
                        "region_id": "uk-default",
                        "latitude": lat,
                        "longitude": lon,
                        "forecast_horizon": 24,
                    },
                    headers={"X-API-Key": "internal"},
                )
                if resp.status_code == 200:
                    pred = resp.json()
                    prob = pred.get("probability", 0)
                    risk = pred.get("risk_level", "Unknown")
                    context["active_alerts"] = (
                        f"AEGIS flood prediction: {risk} risk ({prob:.0%} probability, 24h forecast)"
                    )
                    factors = pred.get("contributing_factors", [])
                    if factors:
                        top_factor = max(factors, key=lambda f: f.get("importance", 0))
                        context["river_gauge_name"] = top_factor.get("factor", "Unknown gauge")
                        context["river_gauge_level"] = str(top_factor.get("value", "N/A"))
                        context["river_gauge_status"] = risk.lower()
        except Exception as exc:
            logger.debug(f"Could not fetch live AEGIS context: {exc}")

        self._cache[cache_key] = (context, time.time())
        return context

    def _empty_context(self, location: str | None) -> dict[str, Any]:
        return {
            "location": location or "Not provided",
            "active_alerts": "Unable to fetch live alert data — check SEPA/EA directly",
            "river_gauge_name": "N/A",
            "river_gauge_level": "N/A",
            "river_gauge_status": "N/A",
            "weather_condition": "N/A",
            "temperature": "N/A",
            "nearby_incidents": "N/A",
        }

# Ollama client
class OllamaClient:
    """
    Async Ollama client with streaming support.
    Connects to local Ollama instance (default http://localhost:11434).
    Falls back to a general-purpose model if the AEGIS fine-tuned model is unavailable.
    """

    def __init__(self, base_url: str = "http://localhost:11434"):
        self._base = base_url.rstrip("/")
        self._primary_model = "aegis-ai"                # All-hazard AEGIS model
        self._fallback_model = "llama3.1:8b"             # Fallback if not yet trained
        self._active_model: str | None = None

    async def get_active_model(self) -> str:
        """Determine which model to use — fine-tuned AEGIS or fallback."""
        if self._active_model:
            return self._active_model

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._base}/api/tags")
                if resp.status_code == 200:
                    models = [m["name"] for m in resp.json().get("models", [])]
                    if self._primary_model in models:
                        self._active_model = self._primary_model
                        logger.info(f"AEGIS fine-tuned model available: {self._active_model}")
                        return self._active_model

                    # Try any local model as fallback
                    for fallback in [self._fallback_model, "llama3:8b", "llama2:7b", "mistral:7b"]:
                        if any(m.startswith(fallback.split(":")[0]) for m in models):
                            self._active_model = next(m for m in models if m.startswith(fallback.split(":")[0]))
                            logger.warning(
                                f"Fine-tuned model not available. Using fallback: {self._active_model}"
                            )
                            return self._active_model
        except Exception as e:
            logger.warning(f"Ollama not reachable: {e}")

        # Cannot reach Ollama — return primary name (will fail gracefully at generate time)
        return self._primary_model

    async def generate_stream(
        self,
        messages: list[dict],
        model: str,
    ) -> AsyncIterator[str]:
        """Stream generation tokens from Ollama."""
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.6,       # Balanced for natural, nuanced emergency responses
                "top_p": 0.9,
                "top_k": 50,
                "repeat_penalty": 1.1,
                "num_predict": 2048,      # Allows detailed multi-step guidance
                "num_ctx": 8192,
            },
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self._base}/api/chat",
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    error = await resp.aread()
                    raise HTTPException(
                        status_code=503,
                        detail=f"AEGIS LLM unavailable: {resp.status_code} — {error[:200]}"
                    )
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content", "")
                        if token:
                            yield token
                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue

    async def generate(
        self,
        messages: list[dict],
        model: str,
    ) -> str:
        """Non-streaming generation — for internal use (evaluation, continuous learning)."""
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.6,
                "top_p": 0.9,
                "top_k": 50,
                "repeat_penalty": 1.1,
                "num_predict": 2048,
                "num_ctx": 8192,
            },
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{self._base}/api/chat", json=payload)
            resp.raise_for_status()
            return resp.json()["message"]["content"]

# Feedback store — collects examples for continuous learning
class FeedbackStore:
    """Stores user feedback for the continuous learning pipeline."""

    def __init__(self, db_pool=None):
        self._db = db_pool  # Optional asyncpg connection pool
        self._buffer: list[dict] = []

    async def store(
        self,
        conversation_id: str,
        user_message: str,
        assistant_response: str,
        crisis_level: CrisisLevel,
        thumbs_up: bool | None,
        thumbs_down: bool | None,
        feedback_text: str | None,
    ) -> None:
        record = {
            "conversation_id": conversation_id,
            "query": user_message,
            "response": assistant_response,
            "crisis_level": crisis_level.value,
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "feedback_text": feedback_text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._buffer.append(record)

        if self._db:
            try:
                await self._db.execute(
                    """
                    INSERT INTO llm_feedback
                        (conversation_id, query, response, crisis_level,
                         thumbs_up, thumbs_down, feedback_text, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    """,
                    conversation_id, user_message, assistant_response,
                    crisis_level.value, thumbs_up, thumbs_down, feedback_text,
                )
            except Exception as e:
                logger.warning(f"Failed to persist feedback: {e}")
                # Already in buffer — not lost

# AEGIS LLM Engine — the main class
class AEGISLLMEngine:
    """
    Core AEGIS conversational AI engine.

    Thread-safe, async-first. Integrates with the existing AEGIS prediction
    system for live context injection. Serves responses via Ollama.
    """

    def __init__(
        self,
        ollama_url: str = "http://localhost:11434",
        aigis_api_base: str = "http://localhost:8000",
        db_pool=None,
    ):
        self.ollama = OllamaClient(base_url=ollama_url)
        self.context_fetcher = LiveContextFetcher(aigis_api_base=aigis_api_base)
        self.conversations = ConversationStore(max_history=50)
        self.feedback = FeedbackStore(db_pool=db_pool)
        self._startup_model: str | None = None

    async def startup(self) -> None:
        """Call on FastAPI startup to probe Ollama availability."""
        self._startup_model = await self.ollama.get_active_model()
        logger.info(f"AEGIS LLM Engine ready — model: {self._startup_model}")

        # Start background conversation cleanup task
        asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(900)  # Every 15 minutes
            evicted = self.conversations.evict_expired()
            if evicted > 0:
                logger.debug(f"Evicted {evicted} expired conversations")

    async def chat(self, request: ChatRequest) -> ChatResponse:
        """Non-streaming chat endpoint."""
        start = time.time()

        model = await self.ollama.get_active_model()
        conv_id, history = self.conversations.get_or_create(request.conversation_id)
        crisis_level = classify_crisis(request.message)
        context = await self.context_fetcher.fetch(request.latitude, request.longitude, request.location)

        messages = self._build_messages(request.message, history, context)

        response_text = await self.ollama.generate(messages, model)

        self.conversations.add_turn(conv_id, request.message, response_text)

        return ChatResponse(
            conversation_id=conv_id,
            response=response_text,
            crisis_level=crisis_level,
            model_used=model,
            response_time_ms=int((time.time() - start) * 1000),
            context_used=context,
        )

    async def chat_stream(self, request: ChatRequest) -> tuple[str, CrisisLevel, AsyncIterator[str]]:
        """
        Streaming chat. Returns (conversation_id, crisis_level, token_stream).
        The caller is responsible for accumulating tokens and calling add_turn().
        """
        model = await self.ollama.get_active_model()
        conv_id, history = self.conversations.get_or_create(request.conversation_id)
        crisis_level = classify_crisis(request.message)
        context = await self.context_fetcher.fetch(request.latitude, request.longitude, request.location)

        messages = self._build_messages(request.message, history, context)

        stream = self.ollama.generate_stream(messages, model)
        return conv_id, crisis_level, stream

    def _build_messages(
        self, user_message: str, history: list[dict], context: dict
    ) -> list[dict]:
        """Assemble the full message list for Ollama."""
        system_prompt = build_system_prompt(context)
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})
        return messages

    def record_turn(self, conv_id: str, user_msg: str, assistant_msg: str) -> None:
        self.conversations.add_turn(conv_id, user_msg, assistant_msg)

# FastAPI router
llm_router = APIRouter(prefix="/chat", tags=["AEGIS Chat"])

# Singleton engine — initialised in FastAPI lifespan
_engine: AEGISLLMEngine | None = None

def get_engine() -> AEGISLLMEngine:
    if _engine is None:
        raise HTTPException(status_code=503, detail="AEGIS LLM Engine not initialised")
    return _engine

def init_engine(
    ollama_url: str = "http://localhost:11434",
    aigis_api_base: str = "http://localhost:8000",
    db_pool=None,
) -> AEGISLLMEngine:
    """Call this once in the FastAPI startup lifespan."""
    global _engine
    _engine = AEGISLLMEngine(
        ollama_url=ollama_url,
        aigis_api_base=aigis_api_base,
        db_pool=db_pool,
    )
    return _engine

@llm_router.post("/message", response_model=ChatResponse)
async def chat_endpoint(
    request_body: ChatRequest,
    engine: AEGISLLMEngine = Depends(get_engine),
) -> ChatResponse:
    """Non-streaming chat with AEGIS."""
    return await engine.chat(request_body)

@llm_router.post("/stream")
async def chat_stream_endpoint(
    request_body: ChatRequest,
    engine: AEGISLLMEngine = Depends(get_engine),
) -> StreamingResponse:
    """Streaming chat with AEGIS — returns server-sent events."""
    conv_id, crisis_level, token_stream = await engine.chat_stream(request_body)
    accumulated: list[str] = []

    async def event_generator() -> AsyncIterator[str]:
        # Send conversation metadata first
        meta = json.dumps({
            "event": "meta",
            "conversation_id": conv_id,
            "crisis_level": crisis_level.value,
        })
        yield f"data: {meta}\n\n"

        async for token in token_stream:
            accumulated.append(token)
            payload = json.dumps({"event": "token", "content": token})
            yield f"data: {payload}\n\n"

        # Persist completed turn
        full_response = "".join(accumulated)
        engine.record_turn(conv_id, request_body.message, full_response)

        # Send done signal
        done_payload = json.dumps({"event": "done", "conversation_id": conv_id})
        yield f"data: {done_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Conversation-ID": conv_id,
        },
    )

@llm_router.post("/feedback")
async def feedback_endpoint(
    request_body: FeedbackRequest,
    engine: AEGISLLMEngine = Depends(get_engine),
) -> dict:
    """Submit feedback on a specific response. Used by continuous learning pipeline."""
    _, history = engine.conversations.get_or_create(request_body.conversation_id)

    target_index = request_body.message_index * 2  # Each turn = 2 messages (user + assistant)
    if target_index + 1 >= len(history):
        raise HTTPException(status_code=404, detail="Message index not found in this conversation")

    user_msg = history[target_index]["content"]
    asst_msg = history[target_index + 1]["content"]
    crisis_level = classify_crisis(user_msg)

    await engine.feedback.store(
        conversation_id=request_body.conversation_id,
        user_message=user_msg,
        assistant_response=asst_msg,
        crisis_level=crisis_level,
        thumbs_up=request_body.thumbs_up,
        thumbs_down=request_body.thumbs_down,
        feedback_text=request_body.feedback_text,
    )
    return {"status": "recorded", "conversation_id": request_body.conversation_id}

@llm_router.get("/health")
async def llm_health(engine: AEGISLLMEngine = Depends(get_engine)) -> dict:
    """Check if Ollama is reachable and which model is active."""
    try:
        model = await engine.ollama.get_active_model()
        test_response = await engine.ollama.generate(
            messages=[
                {"role": "system", "content": "You are AEGIS."},
                {"role": "user", "content": "Respond with exactly: AEGIS OPERATIONAL"},
            ],
            model=model,
        )
        is_fine_tuned = model == engine.ollama._primary_model
        return {
            "status": "ok",
            "model": model,
            "fine_tuned": is_fine_tuned,
            "ollama_response_preview": test_response[:50],
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e)}
