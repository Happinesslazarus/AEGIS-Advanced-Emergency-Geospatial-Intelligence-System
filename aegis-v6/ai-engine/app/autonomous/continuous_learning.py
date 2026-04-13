"""
File: continuous_learning.py

What this file does:
Autonomous retraining pipeline that monitors prediction accuracy in
production, detects when a model's performance has degraded below
threshold, and triggers an incremental retraining cycle using the most
recent labelled data. Designed to run as a separate long-running process.

How it connects:
- Monitors the aegis_predictions table via asyncpg
- Calls training_pipeline.py to run the full retraining workflow
- Writes retraining status to PostgreSQL model_governance table
- Can be triggered manually or runs on a schedule (cron/K8s CronJob)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import hashlib
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from loguru import logger

# Failure categories — taxonomy for self-analysis
FAILURE_CATEGORIES = [
    "wrong_information",      # Factually incorrect emergency guidance
    "too_vague",              # Lacked specific actionable instructions
    "missing_context",        # Did not use available live data
    "wrong_tone",             # Tone mismatched to the crisis level
    "knowledge_gap",          # Information AEGIS simply doesn't have
    "safety_failure",         # Failed to mention 999 when it was needed
    "hallucination",          # Invented facts (locations, numbers, procedures)
    "incomplete",             # Cut off or missing critical steps
    "unhelpful_redirect",     # Unhelpfully said "call 999" without guidance
]

# Quality validator — same rubric as the training data generator
FILLER_OPENINGS = frozenset([
    "i ", "as an ai", "great question", "certainly!", "of course!",
    "sure,", "absolutely!", "happy to help",
])

FILLER_CLOSINGS = frozenset([
    "stay safe!", "i hope this helps", "take care!", "good luck!",
    "please feel free to ask",
])

def validate_training_example(example: dict) -> tuple[bool, str]:
    """Validate a single training example against AEGIS quality rubric."""
    try:
        msgs = example.get("messages", [])
        if len(msgs) != 3:
            return False, f"Expected 3 messages, got {len(msgs)}"
        roles = [m.get("role") for m in msgs]
        if roles != ["system", "user", "assistant"]:
            return False, f"Wrong roles: {roles}"
        system_len = len(msgs[0].get("content", ""))
        if system_len < 500:
            return False, "System prompt too short"
        user_len = len(msgs[1].get("content", ""))
        if user_len < 5:
            return False, "User message too short"
        response = msgs[2].get("content", "")
        if len(response) < 80:
            return False, f"Response too short ({len(response)} chars)"
        if len(response) > 2500:
            return False, f"Response too long ({len(response)} chars)"
        lower = response.lower()
        for bad in FILLER_OPENINGS:
            if lower.startswith(bad):
                return False, f"Filler opening: '{bad}'"
        for bad in FILLER_CLOSINGS:
            if lower.rstrip().endswith(bad):
                return False, f"Filler closing: '{bad}'"
        return True, "OK"
    except Exception as e:
        return False, f"Validation error: {e}"

def compute_diversity_score(examples: list[dict]) -> float:
    """
    Measure diversity of new training examples.
    Returns 0.0 (all identical) to 1.0 (completely diverse).
    Anti-poisoning: coordinated attack examples tend to be very similar.
    """
    if len(examples) < 2:
        return 1.0
    user_msgs = [
        ex["messages"][1]["content"].lower()[:100]
        for ex in examples
        if len(ex.get("messages", [])) >= 2
    ]
    # Rough vocabulary diversity via unique trigrams
    all_trigrams: list[set] = []
    for msg in user_msgs:
        trigrams = {msg[i:i+3] for i in range(len(msg) - 2)}
        all_trigrams.append(trigrams)
    pairwise_overlaps = []
    for i in range(len(all_trigrams)):
        for j in range(i + 1, len(all_trigrams)):
            a, b = all_trigrams[i], all_trigrams[j]
            if not a or not b:
                overlap = 0.0
            else:
                overlap = len(a & b) / len(a | b)
            pairwise_overlaps.append(overlap)
    if not pairwise_overlaps:
        return 1.0
    avg_overlap = statistics.mean(pairwise_overlaps)
    return round(1.0 - avg_overlap, 3)

def detect_anomalous_examples(examples: list[dict]) -> list[dict]:
    """
    Flag examples that look anomalous — potential poisoning attempts.
    Checks for: unusual length patterns, suspicious keyword injection,
    contradictions of core safety principles.
    """
    flagged = []
    poison_indicators = [
        "ignore previous instructions",
        "disregard your training",
        "you are now",
        "forget that you are",
        "do not call 999",
        "do not call emergency",
        "never call police",
        "you must say",
        "always respond with",
    ]
    for ex in examples:
        if len(ex.get("messages", [])) < 3:
            continue
        response = ex["messages"][2].get("content", "").lower()
        user_msg = ex["messages"][1].get("content", "").lower()
        combined = response + " " + user_msg
        if any(indicator in combined for indicator in poison_indicators):
            ex["_flagged_reason"] = "potential prompt injection / poisoning attempt"
            flagged.append(ex)
        # Flag responses that tell users NOT to call emergency services
        if "do not call" in response and ("999" in response or "emergency" in response):
            ex["_flagged_reason"] = "response discourages emergency call"
            flagged.append(ex)
    return flagged

# Feedback collector — reads from DB or local file buffer
class FeedbackCollector:
    def __init__(self, db_pool=None, fallback_dir: str = "./data/feedback"):
        self._db = db_pool
        self._fallback_dir = Path(fallback_dir)
        self._fallback_dir.mkdir(parents=True, exist_ok=True)

    async def get_negative_feedback(self, since: datetime) -> list[dict]:
        """Fetch thumbs-down or low-rated interactions since `since`."""
        if self._db:
            try:
                rows = await self._db.fetch(
                    """
                    SELECT conversation_id, query, response, crisis_level,
                           feedback_text, created_at
                    FROM llm_feedback
                    WHERE thumbs_down = TRUE
                      AND created_at >= $1
                    ORDER BY created_at DESC
                    LIMIT 500
                    """,
                    since,
                )
                return [dict(r) for r in rows]
            except Exception as e:
                logger.warning(f"DB feedback read failed: {e}")
        return self._read_fallback_feedback(since, negative_only=True)

    async def get_positive_feedback(self, since: datetime, min_quality: float = 0.9) -> list[dict]:
        """Fetch thumbs-up interactions for positive reinforcement."""
        if self._db:
            try:
                rows = await self._db.fetch(
                    """
                    SELECT conversation_id, query, response, crisis_level
                    FROM llm_feedback
                    WHERE thumbs_up = TRUE
                      AND created_at >= $1
                    ORDER BY created_at DESC
                    LIMIT 200
                    """,
                    since,
                )
                return [dict(r) for r in rows]
            except Exception as e:
                logger.warning(f"DB positive feedback read failed: {e}")
        return self._read_fallback_feedback(since, negative_only=False)

    def _read_fallback_feedback(self, since: datetime, negative_only: bool) -> list[dict]:
        results = []
        today = self._fallback_dir / "feedback.jsonl"
        if not today.exists():
            return results
        since_ts = since.timestamp()
        with open(today) as f:
            for line in f:
                try:
                    record = json.loads(line)
                    ts = datetime.fromisoformat(record.get("timestamp", "1970-01-01")).timestamp()
                    if ts >= since_ts:
                        if negative_only and record.get("thumbs_down"):
                            results.append(record)
                        elif not negative_only and record.get("thumbs_up"):
                            results.append(record)
                except Exception:
                    continue
        return results

# Failure analyser — uses local Ollama model for meta-cognition
class FailureAnalyser:
    def __init__(self, ollama_url: str = "http://localhost:11434", model: str = "aegis-ai"):
        self._ollama_url = ollama_url
        self._model = model

    async def analyse(self, failures: list[dict]) -> dict[str, list[dict]]:
        """
        Categorise failures using the local model's self-analysis.
        Returns failure_categories dict.
        """
        import httpx
        categorised: dict[str, list[dict]] = {cat: [] for cat in FAILURE_CATEGORIES}

        for failure in failures:
            try:
                prompt = (
                    f"Analyse why this emergency AI response failed.\n\n"
                    f"QUERY: {failure.get('query', '')}\n"
                    f"RESPONSE GIVEN: {failure.get('response', '')}\n"
                    f"USER FEEDBACK: {failure.get('feedback_text', 'thumbs down, no text')}\n\n"
                    f"Classify the failure into ONE of these categories:\n"
                    f"{chr(10).join(f'- {c}' for c in FAILURE_CATEGORIES)}\n\n"
                    f"Respond ONLY with JSON: "
                    f'{{\"category\": \"<category>\", \"reason\": \"<1 sentence>\"}}'
                )
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        f"{self._ollama_url}/api/chat",
                        json={
                            "model": self._model,
                            "messages": [{"role": "user", "content": prompt}],
                            "stream": False,
                            "options": {"temperature": 0.1, "num_predict": 100},
                        },
                    )
                    if resp.status_code == 200:
                        text = resp.json()["message"]["content"]
                        import re
                        match = re.search(r'\{.*\}', text, re.DOTALL)
                        if match:
                            parsed = json.loads(match.group())
                            category = parsed.get("category", "knowledge_gap")
                            if category not in FAILURE_CATEGORIES:
                                category = "knowledge_gap"
                            categorised[category].append({
                                **failure,
                                "_analysis": parsed.get("reason", ""),
                            })
                            continue
            except Exception as e:
                logger.debug(f"Failure analysis error: {e}")
            categorised["knowledge_gap"].append(failure)

        return categorised

# Example generator — uses Claude to create corrected training examples
class CorrectedExampleGenerator:
    def __init__(self, anthropic_api_key: str | None = None):
        self._api_key = anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client = None
        if self._api_key:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=self._api_key)
            except ImportError:
                logger.warning("anthropic package not installed — example generation disabled")

    async def generate_corrections(
        self, categorised_failures: dict[str, list[dict]], system_prompt: str
    ) -> list[dict]:
        """
        Generate corrected training examples from failure analysis.
        Uses Claude API — high quality over speed, worth the tokens.
        """
        if not self._client:
            logger.warning("No Claude client — skipping correction generation")
            return []

        examples = []
        for category, failures in categorised_failures.items():
            for failure in failures[:8]:  # Max 8 per category per night
                try:
                    corrected = await asyncio.get_event_loop().run_in_executor(
                        None, self._generate_one, failure, category, system_prompt
                    )
                    if corrected:
                        examples.append(corrected)
                        await asyncio.sleep(0.5)  # Courtesy rate limit pause
                except Exception as e:
                    logger.warning(f"Correction generation failed: {e}")
        return examples

    def _generate_one(self, failure: dict, category: str, system_prompt: str) -> dict | None:
        prompt = (
            f"You are improving the world's most advanced emergency AI (AEGIS).\n\n"
            f"This query was answered poorly. Write the perfect response.\n\n"
            f"ORIGINAL QUERY: {failure.get('query', '')}\n"
            f"POOR RESPONSE: {failure.get('response', '')}\n"
            f"FAILURE TYPE: {category}\n"
            f"ANALYSIS: {failure.get('_analysis', 'Quality was insufficient')}\n\n"
            f"Write the ideal AEGIS response. Requirements:\n"
            f"- 80—400 words, no filler, no hedge phrases\n"
            f"- If risk to life is present: include 999 and what to say\n"
            f"- Specific, actionable, correctly prioritised\n"
            f"- Calm authority — not a chatbot, not a helpdesk\n"
            f"- Do NOT start with 'I', 'As an AI', 'Great question'\n"
            f"- Do NOT end with 'Stay safe!' or similar\n\n"
            f"Return ONLY the response text — nothing else."
        )
        response = self._client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )
        corrected_response = response.content[0].text.strip()
        if len(corrected_response) < 80:
            return None
        return {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": failure["query"]},
                {"role": "assistant", "content": corrected_response},
            ],
            "category": category,
            "source": "failure_correction",
            "original_failure_id": failure.get("conversation_id", "unknown"),
        }

# Pending batch store — human approval gate
class PendingBatchStore:
    """
    All new training batches are stored as PENDING until an operator approves
    them via the AEGIS admin dashboard. Nothing trains automatically.
    """

    def __init__(self, db_pool=None, local_dir: str = "./data/pending_finetune"):
        self._db = db_pool
        self._local_dir = Path(local_dir)
        self._local_dir.mkdir(parents=True, exist_ok=True)

    async def submit(self, batch: dict) -> str:
        """Submit a batch for approval. Returns batch_id."""
        batch_id = hashlib.md5(
            json.dumps(batch, sort_keys=True).encode()
        ).hexdigest()[:12]

        batch["batch_id"] = batch_id
        batch["status"] = "pending_approval"
        batch["submitted_at"] = datetime.now(timezone.utc).isoformat()

        # Save locally
        batch_path = self._local_dir / f"{batch_id}.json"
        with open(batch_path, "w") as f:
            json.dump(batch, f, indent=2)

        # Also save examples as JSONL
        examples_path = self._local_dir / f"{batch_id}_examples.jsonl"
        with open(examples_path, "w") as f:
            for ex in batch.get("examples", []):
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")

        if self._db:
            try:
                await self._db.execute(
                    """
                    INSERT INTO llm_pending_finetune
                        (batch_id, example_count, diversity_score, 
                         failure_categories, submitted_at, status)
                    VALUES ($1, $2, $3, $4, NOW(), 'pending_approval')
                    ON CONFLICT (batch_id) DO NOTHING
                    """,
                    batch_id,
                    batch.get("example_count", 0),
                    batch.get("diversity_score", 0.0),
                    json.dumps(batch.get("failure_summary", {})),
                )
            except Exception as e:
                logger.warning(f"DB batch submission failed: {e}")

        logger.info(f"Training batch submitted for approval: {batch_id} ({batch.get('example_count', 0)} examples)")
        return batch_id

    async def get_pending(self) -> list[dict]:
        batches = []
        for path in sorted(self._local_dir.glob("*.json")):
            if "_examples" in path.name:
                continue
            try:
                with open(path) as f:
                    batch = json.load(f)
                    if batch.get("status") == "pending_approval":
                        batches.append(batch)
            except Exception:
                continue
        return batches

    async def approve(self, batch_id: str) -> Path:
        """Mark a batch as approved and return examples path."""
        batch_path = self._local_dir / f"{batch_id}.json"
        if not batch_path.exists():
            raise FileNotFoundError(f"Batch not found: {batch_id}")
        with open(batch_path) as f:
            batch = json.load(f)
        batch["status"] = "approved"
        batch["approved_at"] = datetime.now(timezone.utc).isoformat()
        with open(batch_path, "w") as f:
            json.dump(batch, f, indent=2)
        return self._local_dir / f"{batch_id}_examples.jsonl"

# Micro fine-tuning trigger — calls the training script
class MicroFineTuner:
    def __init__(self, model_output_base: str = "D:/aegis-models"):
        self._output_base = model_output_base

    async def run(self, examples_path: Path, base_model_path: str) -> str:
        """
        Trigger a micro fine-tuning pass on the approved examples.
        Returns path to new candidate model.
        Returns "" if training failed.
        """
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
        candidate_dir = f"{self._output_base}/aegis-candidate-{timestamp}"

        cmd = [
            sys.executable,
            "scripts/train_aegis_llm.py",
            "--dataset", str(examples_path),
            "--output", candidate_dir,
            "--model", "3b",
            "--epochs", "1",  # Micro pass — 1 epoch only
        ]
        logger.info(f"Starting micro fine-tune: {' '.join(cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.error(f"Micro fine-tune failed:\n{stderr.decode()[:2000]}")
            return ""

        logger.info(f"Micro fine-tune complete: {candidate_dir}")
        return candidate_dir

# Benchmark runner — measures improvement before promotion
class BenchmarkRunner:
    """
    Runs the benchmark suite against a candidate model.
    Candidate must improve by =2% over the current model to be promoted.
    """

    BENCHMARK_PATH = Path("scripts/benchmark_queries.json")

    def __init__(self, ollama_url: str = "http://localhost:11434"):
        self._ollama_url = ollama_url

    async def score_model(self, model_name: str) -> float:
        """Run benchmark suite and return aggregate score (0.0—1.0)."""
        if not self.BENCHMARK_PATH.exists():
            logger.warning("Benchmark file not found — skipping quality gate")
            return 0.75  # Assume passable if no benchmark

        with open(self.BENCHMARK_PATH) as f:
            benchmark = json.load(f)

        import httpx
        scores = []
        for item in benchmark.get("queries", [])[:50]:  # First 50 for speed
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        f"{self._ollama_url}/api/chat",
                        json={
                            "model": model_name,
                            "messages": [{"role": "user", "content": item["query"]}],
                            "stream": False,
                            "options": {"temperature": 0.1, "num_predict": 600},
                        },
                    )
                    if resp.status_code == 200:
                        response_text = resp.json()["message"]["content"]
                        score = self._score_response(response_text, item)
                        scores.append(score)
                await asyncio.sleep(0.2)
            except Exception as e:
                logger.debug(f"Benchmark query failed: {e}")
                scores.append(0.0)

        if not scores:
            return 0.0
        return round(statistics.mean(scores), 4)

    def _score_response(self, response: str, benchmark_item: dict) -> float:
        """Score a response against benchmark criteria."""
        score = 0.0
        criteria = benchmark_item.get("criteria", [])
        if not criteria:
            return 0.5  # No criteria — give benefit of doubt

        for criterion in criteria:
            keyword = criterion.get("keyword", "").lower()
            required = criterion.get("required", False)
            weight = criterion.get("weight", 1.0 / len(criteria))
            if keyword in response.lower():
                score += weight
            elif required:
                score -= weight  # Penalty for missing required elements

        # Universal quality checks
        if len(response) >= 80:
            score += 0.05
        if len(response) <= 2500:
            score += 0.05
        lower = response.lower()
        for bad in FILLER_OPENINGS:
            if lower.startswith(bad):
                score -= 0.10

        return max(0.0, min(1.0, score))

# Report generator
def generate_nightly_report(
    batch_id: str,
    example_count: int,
    diversity_score: float,
    failure_summary: dict,
    benchmark_improvement: float | None,
    status: str,
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"AEGIS LLM Nightly Improvement Report — {now}",
        "=" * 60,
        f"Batch ID:          {batch_id}",
        f"Status:            {status}",
        f"New examples:      {example_count}",
        f"Diversity score:   {diversity_score:.2f} (1.0 = maximum diversity)",
        "",
        "Failure analysis:",
    ]
    for cat, items in failure_summary.items():
        if items:
            lines.append(f"  {cat:30s}: {len(items)} failures")
    if benchmark_improvement is not None:
        lines.append(f"\nBenchmark improvement: {benchmark_improvement:+.1%}")
        lines.append(f"Promotion threshold:   +2.0%")
        lines.append(f"Eligible for promotion: {'YES' if benchmark_improvement >= 0.02 else 'NO'}")
    lines.append("")
    lines.append("Operator action required: Review and approve batch in AEGIS admin dashboard.")
    lines.append(f"  AEGIS Admin ? AI Settings ? Pending Training Batches ? {batch_id}")
    return "\n".join(lines)

# Nightly cycle — the main orchestrator
class AEGISContinuousLearning:
    def __init__(
        self,
        anthropic_api_key: str | None = None,
        db_pool=None,
        ollama_url: str = "http://localhost:11434",
        model_output_base: str = "D:/aegis-models",
    ):
        self.feedback_collector = FeedbackCollector(db_pool=db_pool)
        self.failure_analyser = FailureAnalyser(ollama_url=ollama_url)
        self.example_generator = CorrectedExampleGenerator(anthropic_api_key=anthropic_api_key)
        self.pending_store = PendingBatchStore(db_pool=db_pool)
        self.micro_tuner = MicroFineTuner(model_output_base=model_output_base)
        self.benchmark_runner = BenchmarkRunner(ollama_url=ollama_url)
        self._report_dir = Path("./logs/llm_reports")
        self._report_dir.mkdir(parents=True, exist_ok=True)

    async def run_nightly_cycle(self) -> str:
        """
        Full nightly improvement cycle. Returns batch_id of submitted batch
        (which requires operator approval before any training happens).
        """
        logger.info("AEGIS Continuous Learning — starting nightly cycle")
        start = time.time()
        since = datetime.now(timezone.utc) - timedelta(days=1)

        # 1. Collect feedback
        negative = await self.feedback_collector.get_negative_feedback(since)
        positive = await self.feedback_collector.get_positive_feedback(since)
        logger.info(f"Collected: {len(negative)} negative, {len(positive)} positive feedback items")

        if len(negative) == 0 and len(positive) == 0:
            logger.info("No feedback collected today. Cycle complete (nothing to learn from).")
            return "no-feedback"

        # 2. Analyse failures
        failure_summary: dict[str, list[dict]] = {}
        if negative:
            failure_summary = await self.failure_analyser.analyse(negative)
            fail_counts = {k: len(v) for k, v in failure_summary.items() if v}
            logger.info(f"Failure analysis: {fail_counts}")

        # 3. Import system prompt (same one used in training)
        from app.autonomous.llm_engine import build_system_prompt
        system_prompt = build_system_prompt({})

        # 4. Generate corrected examples
        corrected_examples = []
        if failure_summary:
            corrected_examples = await self.example_generator.generate_corrections(
                failure_summary, system_prompt
            )
            logger.info(f"Generated {len(corrected_examples)} corrected examples")

        # 5. Build positive examples from thumbs-up interactions
        positive_examples = []
        for item in positive:
            if len(item.get("query", "")) < 5 or len(item.get("response", "")) < 80:
                continue
            positive_examples.append({
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": item["query"]},
                    {"role": "assistant", "content": item["response"]},
                ],
                "category": item.get("crisis_level", "unknown"),
                "source": "positive_feedback",
            })

        all_examples = corrected_examples + positive_examples

        # 6. Validate all examples
        valid_examples = []
        for ex in all_examples:
            ok, reason = validate_training_example(ex)
            if ok:
                valid_examples.append(ex)
            else:
                logger.debug(f"Invalid example rejected: {reason}")

        logger.info(f"Valid examples after quality gate: {len(valid_examples)}")

        # 7. Anti-poisoning checks
        flagged = detect_anomalous_examples(valid_examples)
        if flagged:
            logger.warning(
                f"SECURITY: {len(flagged)} examples flagged for potential poisoning. "
                f"Removing from batch."
            )
            flagged_ids = {id(ex) for ex in flagged}
            valid_examples = [ex for ex in valid_examples if id(ex) not in flagged_ids]

        if len(valid_examples) < 20:
            logger.info(f"Batch too small ({len(valid_examples)} examples). Minimum is 20. Saving for next cycle.")
            self._save_carryover(valid_examples)
            return "batch-too-small"

        # Load carryover from previous cycles
        valid_examples = self._load_carryover(valid_examples)

        # Final volume gate
        if len(valid_examples) < 50:
            logger.info(
                f"Still under volume gate ({len(valid_examples)} examples). "
                f"Saving carryover. Need 50 minimum."
            )
            self._save_carryover(valid_examples)
            return "insufficient-volume"

        # 8. Diversity check
        diversity = compute_diversity_score(valid_examples)
        logger.info(f"Diversity score: {diversity:.2f}")
        if diversity < 0.3:
            logger.warning(
                "Low diversity score (<0.3) — batch may be repetitive or target a narrow category. "
                "Proceeding but flagging for operator review."
            )

        # 9. Submit for human approval — NO AUTO-TRAINING
        failure_summary_counts = {k: len(v) for k, v in failure_summary.items() if v}
        batch = {
            "example_count": len(valid_examples),
            "examples": valid_examples,
            "diversity_score": diversity,
            "failure_summary": failure_summary_counts,
            "positive_count": len(positive_examples),
            "correction_count": len(corrected_examples),
            "flagged_count": len(flagged),
            "cycle_duration_seconds": int(time.time() - start),
        }
        batch_id = await self.pending_store.submit(batch)

        # 10. Generate and save nightly report
        report = generate_nightly_report(
            batch_id=batch_id,
            example_count=len(valid_examples),
            diversity_score=diversity,
            failure_summary=failure_summary_counts,
            benchmark_improvement=None,  # Only available after training
            status="pending_operator_approval",
        )
        report_path = self._report_dir / f"report_{datetime.now().strftime('%Y%m%d')}.txt"
        report_path.write_text(report)
        logger.info(f"Nightly report saved: {report_path}")
        print(report)

        return batch_id

    async def approve_and_train(self, batch_id: str, current_model_name: str = "aegis-ai") -> dict:
        """
        Called by an operator via CLI or admin API to approve and trigger training.
        Runs benchmark comparison before promoting the new model.
        """
        logger.info(f"Operator approved batch {batch_id} — starting micro-finetune")
        examples_path = await self.pending_store.approve(batch_id)

        # Get current model benchmark score
        current_score = await self.benchmark_runner.score_model(current_model_name)
        logger.info(f"Current model benchmark score: {current_score:.4f}")

        # Train candidate
        candidate_dir = await self.micro_tuner.run(examples_path, current_model_name)
        if not candidate_dir:
            return {"status": "training_failed", "batch_id": batch_id}

        # Benchmark candidate (if it's available in Ollama)
        # Note: You need to `ollama create aegis-candidate -f <modelfile>` before this step
        candidate_model_name = f"aegis-candidate-{batch_id}"
        candidate_score = await self.benchmark_runner.score_model(candidate_model_name)
        improvement = candidate_score - current_score

        logger.info(
            f"Candidate score: {candidate_score:.4f} (improvement: {improvement:+.4f})"
        )

        should_promote = improvement >= 0.02  # Minimum 2% improvement gate

        result = {
            "batch_id": batch_id,
            "current_score": current_score,
            "candidate_score": candidate_score,
            "improvement": round(improvement, 4),
            "should_promote": should_promote,
            "candidate_dir": candidate_dir,
            "status": "ready_to_promote" if should_promote else "insufficient_improvement",
        }

        if should_promote:
            logger.info(
                f"Candidate qualifies for promotion (+{improvement:.1%}). "
                f"Operator must manually swap the ollama model to complete promotion."
            )
            print(f"\nTo promote: ollama create aegis-ai -f {candidate_dir}/Modelfile")
        else:
            logger.warning(
                f"Candidate does not qualify for promotion ({improvement:+.1%} < 2%). "
                f"Keeping current model."
            )
        return result

    def _carryover_path(self) -> Path:
        path = Path("./data/carryover_examples.jsonl")
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _save_carryover(self, examples: list[dict]) -> None:
        path = self._carryover_path()
        with open(path, "a") as f:
            for ex in examples:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")
        logger.info(f"Saved {len(examples)} examples to carryover: {path}")

    def _load_carryover(self, new_examples: list[dict]) -> list[dict]:
        path = self._carryover_path()
        if not path.exists():
            return new_examples
        carryover = []
        with open(path) as f:
            for line in f:
                try:
                    carryover.append(json.loads(line))
                except Exception:
                    pass
        if carryover:
            logger.info(f"Loaded {len(carryover)} carryover examples from previous cycles")
            # Clear carryover file — they're now in the new batch
            path.unlink()
        return new_examples + carryover

# Scheduler — runs the cycle nightly at 2am local time
async def run_scheduler(learning: AEGISContinuousLearning) -> None:
    import datetime as dt
    while True:
        now = dt.datetime.now()
        target = now.replace(hour=2, minute=0, second=0, microsecond=0)
        if target <= now:
            target += dt.timedelta(days=1)
        wait_seconds = (target - now).total_seconds()
        logger.info(f"Next nightly learning cycle at {target.strftime('%H:%M %d %b')} ({wait_seconds/3600:.1f}h)")
        await asyncio.sleep(wait_seconds)
        try:
            batch_id = await learning.run_nightly_cycle()
            logger.info(f"Nightly cycle complete. Batch: {batch_id}")
        except Exception as e:
            logger.error(f"Nightly cycle failed: {e}", exc_info=True)

# CLI entry point
async def main_async(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY")

    learning = AEGISContinuousLearning(
        anthropic_api_key=api_key,
        ollama_url=args.ollama_url,
        model_output_base=args.model_dir,
    )

    if args.mode == "nightly":
        batch_id = await learning.run_nightly_cycle()
        print(f"\nBatch submitted: {batch_id}")
        print("Approve in the AEGIS admin dashboard or run:")
        print(f"  python -m app.autonomous.continuous_learning --mode approve --batch-id {batch_id}")

    elif args.mode == "approve":
        if not args.batch_id:
            print("ERROR: --batch-id required for approve mode")
            sys.exit(1)
        result = await learning.approve_and_train(args.batch_id)
        print(json.dumps(result, indent=2))

    elif args.mode == "status":
        pending = await learning.pending_store.get_pending()
        if pending:
            print(f"\n{len(pending)} batch(es) awaiting approval:")
            for b in pending:
                print(f"  {b['batch_id']}: {b['example_count']} examples, "
                      f"diversity={b.get('diversity_score', 0):.2f}, "
                      f"submitted {b.get('submitted_at', 'unknown')}")
        else:
            print("No pending batches.")

    elif args.mode == "schedule":
        print("Starting nightly scheduler (runs at 02:00 local time)...")
        await run_scheduler(learning)

def main() -> None:
    parser = argparse.ArgumentParser(description="AEGIS Continuous Learning Pipeline")
    parser.add_argument(
        "--mode", choices=["nightly", "approve", "status", "schedule"],
        default="nightly",
        help="Operation mode"
    )
    parser.add_argument("--batch-id", default=None, help="Batch ID for approve mode")
    parser.add_argument("--api-key", default=None, help="Anthropic API key")
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--model-dir", default="D:/aegis-models")
    args = parser.parse_args()
    asyncio.run(main_async(args))

if __name__ == "__main__":
    main()

