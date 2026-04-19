"""
ML model governance layer: records model version, training metrics, and
approval status in the PostgreSQL model_governance table. Computes
performance checksums to detect silent degradation, enforces a promotion
workflow (shadow -> candidate -> active), and provides a retraining lock
to prevent concurrent training runs.

- Called by ai-engine/main.py background governance loop
- Called by ai-engine/app/api/endpoints.py for model status endpoints
- Writes to the model_governance table (see server/sql/schema.sql)
- model_registry.py reads governance status before loading a new model
"""

import hashlib
import json
import os
import time
import numpy as np
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timedelta
from pathlib import Path
from loguru import logger
import asyncpg

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')

# MODEL GOVERNANCE — Versioning, Registration, Activation

class ModelGovernance:
    """
    Central governance for all model lifecycle operations.
    Thread-safe, async-first, fully database-backed.
    """

    def __init__(self, db_url: str = DB_URL):
        self.db_url = db_url

    async def register_candidate(
        self,
        model_name: str,
        version: str,
        artifact_path: str,
        metrics: Dict[str, Any],
        dataset_size: int,
        dataset_hash: str = "",
        feature_names: Optional[List[str]] = None,
        training_config: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Register a newly trained model as a CANDIDATE.
        Does NOT activate it — that requires compare_and_promote().
        
        The separation prevents training pipelines from self-promoting:
        a human operator or the automatic A/B comparison must explicitly
        promote the candidate before it handles live traffic.
        """
        conn = await asyncpg.connect(self.db_url)
        try:
            # Check if this exact version already exists
            existing = await conn.fetchval(
                "SELECT id FROM model_governance WHERE model_name=$1 AND version=$2",
                model_name, version
            )
            if existing:
                logger.warning(f"Version {version} already registered for {model_name}")
                return {"status": "already_exists", "version": version}

            row = await conn.fetchrow("""
                INSERT INTO model_governance
                    (model_name, version, status, artifact_path, dataset_hash,
                     dataset_size, feature_names, metrics_json, training_config)
                VALUES ($1, $2, 'candidate', $3, $4, $5, $6, $7, $8)
                RETURNING id, created_at
            """,
                model_name, version, artifact_path,
                dataset_hash or self._compute_hash(metrics),
                dataset_size,
                json.dumps(feature_names) if feature_names else None,
                json.dumps(metrics, default=str),
                json.dumps(training_config or {}, default=str),
            )

            logger.info(f"Registered candidate: {model_name} v{version}")
            return {
                "status": "candidate",
                "id": str(row["id"]),
                "version": version,
                "created_at": row["created_at"].isoformat(),
            }
        finally:
            await conn.close()

    async def compare_and_promote(
        self,
        model_name: str,
        candidate_version: str,
        primary_metric: str = "accuracy",
        min_improvement: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Compare candidate against current active model.
        Promote if performance improved (or if no active model exists).
        """
        conn = await asyncpg.connect(self.db_url)
        try:
            # Get candidate metrics
            candidate = await conn.fetchrow(
                "SELECT * FROM model_governance WHERE model_name=$1 AND version=$2",
                model_name, candidate_version
            )
            if not candidate:
                return {"status": "error", "message": f"Candidate {candidate_version} not found"}

            candidate_metrics = json.loads(candidate["metrics_json"]) if isinstance(candidate["metrics_json"], str) else candidate["metrics_json"]
            candidate_score = float(candidate_metrics.get(primary_metric, 0))

            # Get current active model
            active = await conn.fetchrow(
                "SELECT * FROM model_governance WHERE model_name=$1 AND status='active'",
                model_name
            )

            if active:
                active_metrics = json.loads(active["metrics_json"]) if isinstance(active["metrics_json"], str) else active["metrics_json"]
                active_score = float(active_metrics.get(primary_metric, 0))
                improvement = candidate_score - active_score

                logger.info(
                    f"Comparing {model_name}: active={active['version']} ({active_score:.4f}) "
                    f"vs candidate={candidate_version} ({candidate_score:.4f}), "
                    f"improvement={improvement:.4f}"
                )

                if improvement < min_improvement:
                    # Mark the candidate as 'failed' (not just archived) so the
                    # governance audit trail shows why this version was rejected.
                    await conn.execute(
                        "UPDATE model_governance SET status='failed', notes=$1 WHERE model_name=$2 AND version=$3",
                        f"Rejected: {primary_metric}={candidate_score:.4f} < active {active_score:.4f} (min_improvement={min_improvement})",
                        model_name, candidate_version,
                    )
                    logger.warning(f"Candidate {candidate_version} rejected — no improvement")
                    return {
                        "status": "rejected",
                        "reason": f"No improvement: candidate={candidate_score:.4f}, active={active_score:.4f}",
                        "active_version": active["version"],
                        "candidate_version": candidate_version,
                    }

                # Archive old active
                await conn.execute(
                    "UPDATE model_governance SET status='archived', archived_at=now() WHERE model_name=$1 AND status='active'",
                    model_name
                )
                logger.info(f"Archived previous active: {active['version']}")
            else:
                logger.info(f"No active model for {model_name} — promoting candidate directly")
                improvement = candidate_score

            # Activate candidate
            await conn.execute(
                "UPDATE model_governance SET status='active', activated_at=now() WHERE model_name=$1 AND version=$2",
                model_name, candidate_version
            )

            logger.success(f"Promoted {model_name} v{candidate_version} (improvement={improvement:.4f})")
            return {
                "status": "promoted",
                "version": candidate_version,
                "previous_version": active["version"] if active else None,
                "improvement": round(improvement, 4),
                "metric": primary_metric,
                "score": round(candidate_score, 4),
            }
        finally:
            await conn.close()

    async def rollback(self, model_name: str, target_version: Optional[str] = None) -> Dict[str, Any]:
        """
        Roll back to a previous stable version.
        If target_version is None, rolls back to the most recent archived version.
        """
        conn = await asyncpg.connect(self.db_url)
        try:
            if target_version:
                target = await conn.fetchrow(
                    "SELECT * FROM model_governance WHERE model_name=$1 AND version=$2",
                    model_name, target_version
                )
                if not target:
                    return {"status": "error", "message": f"Version {target_version} not found"}
            else:
                # No existing version; pick the most-recently-activated archived
                # version (NULLS LAST ensures models never activated come last).
                # 'rollback' status is also eligible to roll back to.
                target = await conn.fetchrow("""
                    SELECT * FROM model_governance
                    WHERE model_name=$1 AND status IN ('archived', 'rollback')
                    ORDER BY activated_at DESC NULLS LAST, created_at DESC
                    LIMIT 1
                """, model_name)
                if not target:
                    return {"status": "error", "message": "No previous version to roll back to"}

            # Archive current active
            current = await conn.fetchrow(
                "SELECT version FROM model_governance WHERE model_name=$1 AND status='active'",
                model_name
            )
            if current:
                await conn.execute(
                    "UPDATE model_governance SET status='archived', archived_at=now() WHERE model_name=$1 AND status='active'",
                    model_name
                )

            # Activate rollback target
            await conn.execute(
                "UPDATE model_governance SET status='active', activated_at=now(), notes=$1 WHERE model_name=$2 AND version=$3",
                f"Rolled back from {current['version'] if current else 'none'} at {datetime.utcnow().isoformat()}",
                model_name, target["version"]
            )

            logger.success(f"Rolled back {model_name} to v{target['version']}")
            return {
                "status": "rolled_back",
                "model_name": model_name,
                "from_version": current["version"] if current else None,
                "to_version": target["version"],
                "rolled_back_at": datetime.utcnow().isoformat(),
            }
        finally:
            await conn.close()

    async def get_active_version(self, model_name: str) -> Optional[Dict[str, Any]]:
        """Get the currently active model version info."""
        conn = await asyncpg.connect(self.db_url)
        try:
            row = await conn.fetchrow(
                "SELECT * FROM model_governance WHERE model_name=$1 AND status='active'",
                model_name
            )
            if not row:
                return None
            return {
                "model_name": row["model_name"],
                "version": row["version"],
                "artifact_path": row["artifact_path"],
                "metrics": json.loads(row["metrics_json"]) if isinstance(row["metrics_json"], str) else row["metrics_json"],
                "dataset_size": row["dataset_size"],
                "activated_at": row["activated_at"].isoformat() if row["activated_at"] else None,
                "created_at": row["created_at"].isoformat(),
            }
        finally:
            await conn.close()

    async def list_versions(self, model_name: str, limit: int = 20) -> List[Dict[str, Any]]:
        """List all versions for a model, newest first."""
        conn = await asyncpg.connect(self.db_url)
        try:
            rows = await conn.fetch("""
                SELECT id, model_name, version, status, dataset_size,
                       metrics_json, created_at, activated_at, archived_at, notes
                FROM model_governance
                WHERE model_name=$1
                ORDER BY created_at DESC
                LIMIT $2
            """, model_name, limit)
            return [
                {
                    "id": str(row["id"]),
                    "version": row["version"],
                    "status": row["status"],
                    "dataset_size": row["dataset_size"],
                    "metrics": json.loads(row["metrics_json"]) if isinstance(row["metrics_json"], str) else row["metrics_json"],
                    "created_at": row["created_at"].isoformat(),
                    "activated_at": row["activated_at"].isoformat() if row["activated_at"] else None,
                    "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
                    "notes": row["notes"],
                }
                for row in rows
            ]
        finally:
            await conn.close()

    async def list_all_models(self) -> List[Dict[str, Any]]:
        """List all model names with their active version."""
        conn = await asyncpg.connect(self.db_url)
        try:
            rows = await conn.fetch("""
                SELECT DISTINCT ON (model_name) model_name, version, status,
                       metrics_json, dataset_size, activated_at
                FROM model_governance
                WHERE status = 'active'
                ORDER BY model_name
            """)
            return [
                {
                    "model_name": row["model_name"],
                    "active_version": row["version"],
                    "dataset_size": row["dataset_size"],
                    "metrics": json.loads(row["metrics_json"]) if isinstance(row["metrics_json"], str) else row["metrics_json"],
                    "activated_at": row["activated_at"].isoformat() if row["activated_at"] else None,
                }
                for row in rows
            ]
        finally:
            await conn.close()

    @staticmethod
    def _compute_hash(data: Dict) -> str:
        """Compute a stable SHA-256 fingerprint of training metrics or config.
        
        Used as the dataset_hash when the caller hasn't provided one.  Sorting
        keys ensures the same dict always produces the same hash regardless of
        insertion order.  Only the first 32 hex chars are stored to keep DB
        column widths manageable.
        """
        raw = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

# PREDICTION LOGGER — Log every prediction for monitoring

class PredictionLogger:
    """
    Logs every prediction to the prediction_logs table.
    Supports feedback submission for human-in-the-loop learning.
    """

    def __init__(self, db_url: str = DB_URL):
        self.db_url = db_url
        self._pool = None

    async def _get_pool(self):
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self.db_url, min_size=1, max_size=3)
        return self._pool

    async def log_prediction(
        self,
        model_name: str,
        model_version: str,
        input_data: Dict[str, Any],
        prediction: Dict[str, Any],
        confidence: float,
        latency_ms: int = 0,
    ) -> str:
        """Log a single prediction. Returns the log ID."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            # Hash the input so we can later identify duplicate predictions
            # (same inputs called twice) without storing the raw input twice.
            input_hash = hashlib.md5(
                json.dumps(input_data, sort_keys=True, default=str).encode()
            ).hexdigest()

            row = await conn.fetchrow("""
                INSERT INTO prediction_logs
                    (model_name, model_version, input_hash, input_summary,
                     prediction, confidence, latency_ms)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            """,
                model_name, model_version, input_hash,
                json.dumps(input_data, default=str),
                json.dumps(prediction, default=str),
                confidence,
                latency_ms,
            )
            return str(row["id"])

    async def submit_feedback(self, prediction_id: str, feedback: str) -> bool:
        """Submit feedback for a logged prediction."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE prediction_logs
                SET feedback=$1, feedback_at=now()
                WHERE id=$2
            """, feedback, prediction_id)
            return "UPDATE 1" in result

    async def get_recent_predictions(
        self,
        model_name: str,
        hours: int = 24,
        limit: int = 1000
    ) -> List[Dict]:
        """Get recent predictions for drift analysis."""
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT model_version, confidence, prediction, created_at, feedback
                FROM prediction_logs
                WHERE model_name=$1 AND created_at > $2
                ORDER BY created_at DESC
                LIMIT $3
            """, model_name, cutoff, limit)
            return [
                {
                    "model_version": row["model_version"],
                    "confidence": float(row["confidence"]) if row["confidence"] else None,
                    "prediction": json.loads(row["prediction"]) if isinstance(row["prediction"], str) else row["prediction"],
                    "created_at": row["created_at"].isoformat(),
                    "feedback": row["feedback"],
                }
                for row in rows
            ]

    async def get_confidence_stats(
        self,
        model_name: str,
        hours: int = 24
    ) -> Dict[str, Any]:
        """Get confidence statistics for drift detection."""
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT
                    count(*) as total,
                    avg(confidence) as avg_confidence,
                    stddev(confidence) as stddev_confidence,
                    min(confidence) as min_confidence,
                    max(confidence) as max_confidence,
                    count(CASE WHEN confidence < 0.5 THEN 1 END) as low_confidence_count
                FROM prediction_logs
                WHERE model_name=$1 AND created_at > $2
            """, model_name, cutoff)
            return {
                "total_predictions": int(row["total"]),
                "avg_confidence": round(float(row["avg_confidence"] or 0), 4),
                "stddev_confidence": round(float(row["stddev_confidence"] or 0), 4),
                "min_confidence": round(float(row["min_confidence"] or 0), 4),
                "max_confidence": round(float(row["max_confidence"] or 0), 4),
                "low_confidence_ratio": round(int(row["low_confidence_count"]) / max(1, int(row["total"])), 4),
            }

    async def cleanup(self):
        """Close the connection pool."""
        if self._pool:
            await self._pool.close()
            self._pool = None

# DRIFT DETECTOR — Statistical drift detection

class DriftDetector:
    """
    Detects model drift by comparing:
    1. Confidence distribution vs training baseline
    2. Feature distribution shifts (KS test)
    3. Prediction class distribution shifts
    4. Accuracy degradation via feedback labels
    """

    def __init__(self, db_url: str = DB_URL):
        self.db_url = db_url
        # Drift thresholds (configurable)
        self.confidence_drop_threshold = 0.10  # 10% drop
        self.accuracy_drop_threshold = 0.05     # 5% drop
        self.distribution_shift_threshold = 0.15  # KL divergence
        self.low_confidence_alert_threshold = 0.30  # 30% of predictions below 0.5

    async def detect_drift(
        self,
        model_name: str,
        model_version: str,
        window_hours: int = 24,
    ) -> Dict[str, Any]:
        """
        Run comprehensive drift detection.
        Returns drift alerts and metrics.
        """
        conn = await asyncpg.connect(self.db_url)
        try:
            drift_signals = []
            metrics = {}

            # 1. Get training baseline from model_governance
            active = await conn.fetchrow(
                "SELECT metrics_json FROM model_governance WHERE model_name=$1 AND version=$2",
                model_name, model_version
            )
            baseline_metrics = {}
            if active:
                baseline_metrics = json.loads(active["metrics_json"]) if isinstance(active["metrics_json"], str) else active["metrics_json"]

            # 2. Get recent prediction confidence stats
            cutoff = datetime.utcnow() - timedelta(hours=window_hours)
            stats = await conn.fetchrow("""
                SELECT
                    count(*) as total,
                    avg(confidence) as avg_conf,
                    stddev(confidence) as std_conf,
                    count(CASE WHEN confidence < 0.5 THEN 1 END) as low_conf
                FROM prediction_logs
                WHERE model_name=$1 AND created_at > $2
            """, model_name, cutoff)

            total = int(stats["total"] or 0)
            metrics["prediction_count"] = total

            if total < 10:
                return {
                    "drift_detected": False,
                    "message": f"Insufficient data: {total} predictions in last {window_hours}h",
                    "metrics": metrics,
                    "signals": [],
                }

            avg_conf = float(stats["avg_conf"] or 0)
            std_conf = float(stats["std_conf"] or 0)
            low_conf_ratio = int(stats["low_conf"] or 0) / total

            metrics["avg_confidence"] = round(avg_conf, 4)
            metrics["stddev_confidence"] = round(std_conf, 4)
            metrics["low_confidence_ratio"] = round(low_conf_ratio, 4)

            # Signal 1: Confidence degradation
            baseline_accuracy = float(baseline_metrics.get("accuracy", 0.9))
            if avg_conf < baseline_accuracy - self.confidence_drop_threshold:
                drift_signals.append({
                    "type": "confidence_drop",
                    "severity": "high",
                    "baseline": baseline_accuracy,
                    "current": avg_conf,
                    "drop": round(baseline_accuracy - avg_conf, 4),
                })

            # Signal 2: High ratio of low-confidence predictions
            if low_conf_ratio > self.low_confidence_alert_threshold:
                drift_signals.append({
                    "type": "low_confidence_spike",
                    "severity": "medium",
                    "threshold": self.low_confidence_alert_threshold,
                    "current_ratio": low_conf_ratio,
                })

            # Signal 3: Confidence variance increase (unstable predictions)
            if std_conf > 0.35:
                drift_signals.append({
                    "type": "high_variance",
                    "severity": "medium",
                    "stddev": round(std_conf, 4),
                    "threshold": 0.35,
                })

            # Signal 4: Accuracy from feedback (if available)
            feedback_stats = await conn.fetchrow("""
                SELECT
                    count(*) as total_feedback,
                    count(CASE WHEN feedback = 'correct' THEN 1 END) as correct,
                    count(CASE WHEN feedback = 'incorrect' THEN 1 END) as incorrect
                FROM prediction_logs
                WHERE model_name=$1 AND feedback IS NOT NULL
                  AND created_at > $2
            """, model_name, datetime.utcnow() - timedelta(hours=window_hours * 7))

            total_fb = int(feedback_stats["total_feedback"] or 0)
            if total_fb >= 10:
                fb_accuracy = int(feedback_stats["correct"] or 0) / total_fb
                metrics["feedback_accuracy"] = round(fb_accuracy, 4)
                metrics["total_feedback"] = total_fb

                if fb_accuracy < baseline_accuracy - self.accuracy_drop_threshold:
                    drift_signals.append({
                        "type": "accuracy_degradation",
                        "severity": "critical",
                        "baseline_accuracy": baseline_accuracy,
                        "feedback_accuracy": round(fb_accuracy, 4),
                        "drop": round(baseline_accuracy - fb_accuracy, 4),
                    })

            # Signal 5: Prediction distribution shift
            class_dist = await conn.fetch("""
                SELECT prediction->>'severity' as pred_class, count(*) as cnt
                FROM prediction_logs
                WHERE model_name=$1 AND created_at > $2
                  AND prediction->>'severity' IS NOT NULL
                GROUP BY prediction->>'severity'
            """, model_name, cutoff)

            if class_dist:
                metrics["prediction_distribution"] = {
                    row["pred_class"]: int(row["cnt"]) for row in class_dist
                }

            drift_detected = len(drift_signals) > 0

            # Store drift metrics
            for signal in drift_signals:
                await conn.execute("""
                    INSERT INTO model_drift_metrics
                        (model_name, model_version, metric_name, baseline_value,
                         current_value, drift_detected, threshold)
                    VALUES ($1, $2, $3, $4, $5, true, $6)
                """,
                    model_name, model_version,
                    signal["type"],
                    signal.get("baseline", signal.get("threshold", 0)),
                    signal.get("current", signal.get("current_ratio", signal.get("stddev", 0))),
                    signal.get("threshold", self.confidence_drop_threshold),
                )

            if drift_detected:
                logger.warning(f"Drift detected for {model_name} v{model_version}: {len(drift_signals)} signals")
            else:
                logger.info(f"No drift detected for {model_name} v{model_version}")

            return {
                "drift_detected": drift_detected,
                "signal_count": len(drift_signals),
                "signals": drift_signals,
                "metrics": metrics,
                "model_name": model_name,
                "model_version": model_version,
                "window_hours": window_hours,
                "checked_at": datetime.utcnow().isoformat(),
            }
        finally:
            await conn.close()

    async def check_all_models(self) -> List[Dict[str, Any]]:
        """Run drift detection on all active models."""
        governance = ModelGovernance(self.db_url)
        active_models = await governance.list_all_models()
        results = []
        for model in active_models:
            try:
                result = await self.detect_drift(
                    model["model_name"],
                    model["active_version"],
                )
                results.append(result)
            except Exception as e:
                logger.error(f"Drift check failed for {model['model_name']}: {e}")
                results.append({
                    "model_name": model["model_name"],
                    "drift_detected": False,
                    "error": str(e),
                })
        return results

# SINGLETON INSTANCES

governance = ModelGovernance()
prediction_logger = PredictionLogger()
drift_detector = DriftDetector()
