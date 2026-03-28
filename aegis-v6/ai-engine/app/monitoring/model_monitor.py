"""
AEGIS AI ENGINE - Model monitor
Computes rolling monitoring snapshots and drift for deployed hazard models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import json
import os

import asyncpg
import numpy as np
from loguru import logger

from app.core.config import settings
from app.core.model_registry import ModelRegistry
from app.monitoring.drift import (
    drift_alert_level,
    ks_statistic,
    normalized_rank_shift,
    population_stability_index,
    weighted_drift_score,
    z_score_shift,
)

@dataclass
class MonitorSnapshot:
    hazard_type: str
    region_id: str
    model_version: str
    snapshot_time: str
    sample_count: int
    avg_confidence: float
    prediction_positive_rate: float
    confidence_std: float
    top_feature_means: Dict[str, float]
    top_feature_stds: Dict[str, float]
    drift_score: float
    alert_level: str

class ModelMonitor:
    """Monitoring engine backed by ai_predictions table."""

    def __init__(self, model_registry: ModelRegistry, db_url: Optional[str] = None):
        self.model_registry = model_registry
        self.db_url = db_url or os.getenv("DATABASE_URL") or settings.DATABASE_URL

    async def _connect(self):
        return await asyncpg.connect(self.db_url)

    async def _load_recent_predictions(
        self,
        hazard_type: str,
        region_id: str,
        model_version: str,
        hours: int = 24,
        limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        conn = await self._connect()
        try:
            try:
                rows = await conn.fetch(
                    """
                    SELECT
                      probability,
                      confidence,
                      risk_level,
                      contributing_factors,
                      input_features,
                      prediction_response,
                      generated_at
                    FROM ai_predictions
                    WHERE hazard_type = $1
                      AND region_id = $2
                      AND model_version = $3
                      AND generated_at >= $4
                    ORDER BY generated_at DESC
                    LIMIT $5
                    """,
                    hazard_type,
                    region_id,
                    model_version,
                    cutoff,
                    limit,
                )
            except Exception:
                rows = await conn.fetch(
                    """
                    SELECT
                      probability,
                      confidence,
                      risk_level,
                      contributing_factors,
                      prediction_response,
                      generated_at
                    FROM ai_predictions
                    WHERE hazard_type = $1
                      AND region_id = $2
                      AND model_version = $3
                      AND generated_at >= $4
                    ORDER BY generated_at DESC
                    LIMIT $5
                    """,
                    hazard_type,
                    region_id,
                    model_version,
                    cutoff,
                    limit,
                )
            data: List[Dict[str, Any]] = []
            for row in rows:
                prediction_response = row["prediction_response"] or {}
                if isinstance(prediction_response, str):
                    try:
                        prediction_response = json.loads(prediction_response)
                    except Exception:
                        prediction_response = {}

                input_features = row.get("input_features") or prediction_response.get("input_features") or {}
                if isinstance(input_features, str):
                    try:
                        input_features = json.loads(input_features)
                    except Exception:
                        input_features = {}

                factors = row["contributing_factors"] or prediction_response.get("contributing_factors") or []
                if isinstance(factors, str):
                    try:
                        factors = json.loads(factors)
                    except Exception:
                        factors = []

                data.append(
                    {
                        "probability": float(row["probability"] or 0.0),
                        "confidence": float(row["confidence"] or 0.0),
                        "risk_level": row["risk_level"],
                        "input_features": input_features,
                        "contributing_factors": factors,
                    }
                )
            return data
        finally:
            await conn.close()

    def _feature_series(self, rows: List[Dict[str, Any]]) -> Dict[str, List[float]]:
        series: Dict[str, List[float]] = {}
        for row in rows:
            feats = row.get("input_features") or {}
            if not isinstance(feats, dict):
                continue
            for key, value in feats.items():
                if isinstance(value, (int, float)):
                    series.setdefault(key, []).append(float(value))
        return series

    @staticmethod
    def _confidence_stats(rows: List[Dict[str, Any]]) -> Dict[str, float]:
        confidences = [float(r.get("confidence", 0.0)) for r in rows]
        if not confidences:
            return {"avg": 0.0, "std": 0.0}
        return {
            "avg": float(np.mean(confidences)),
            "std": float(np.std(confidences)),
        }

    @staticmethod
    def _positive_rate(rows: List[Dict[str, Any]]) -> float:
        if not rows:
            return 0.0
        positives = sum(1 for r in rows if float(r.get("probability", 0.0)) >= 0.5)
        return positives / len(rows)

    @staticmethod
    def _current_shap_top(rows: List[Dict[str, Any]], top_k: int = 5) -> List[str]:
        scores: Dict[str, float] = {}
        for row in rows:
            for item in row.get("contributing_factors") or []:
                if isinstance(item, dict):
                    name = str(item.get("factor") or item.get("name") or "").strip()
                    imp = float(item.get("importance") or 0.0)
                    if name:
                        scores[name] = scores.get(name, 0.0) + abs(imp)
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        return [k for k, _ in ranked[:top_k]]

    def _baseline_from_metadata(self, hazard_type: str, region_id: str, version: str) -> Dict[str, Any]:
        key = self.model_registry._get_model_key(hazard_type, region_id, version)
        meta = self.model_registry.models.get(key)
        if not meta:
            return {}
        return {
            "feature_means": meta.extra_metadata.get("training_feature_means", {}) or {},
            "feature_stds": meta.extra_metadata.get("training_feature_stds", {}) or {},
            "class_balance": meta.extra_metadata.get("class_balance", {}) or {},
            "validation_confidence_stats": meta.extra_metadata.get("validation_confidence_stats", {}) or {},
            "shap_ranking": meta.extra_metadata.get("reference_shap_importance_ranking", []) or [],
            "baseline_prediction_distribution": meta.extra_metadata.get("baseline_prediction_distribution", {}) or {},
        }

    def compute_snapshot(
        self,
        hazard_type: str,
        region_id: str,
        model_version: str,
        rows: List[Dict[str, Any]],
    ) -> MonitorSnapshot:
        baseline = self._baseline_from_metadata(hazard_type, region_id, model_version)
        sample_count = len(rows)

        conf = self._confidence_stats(rows)
        avg_conf = conf["avg"]
        conf_std = conf["std"]
        pos_rate = self._positive_rate(rows)

        feature_series = self._feature_series(rows)
        top_features = sorted(feature_series.items(), key=lambda kv: len(kv[1]), reverse=True)[:8]

        top_means: Dict[str, float] = {}
        top_stds: Dict[str, float] = {}
        feature_drift_parts: Dict[str, float] = {}

        baseline_means: Dict[str, float] = baseline.get("feature_means", {})
        baseline_stds: Dict[str, float] = baseline.get("feature_stds", {})

        for name, values in top_features:
            if not values:
                continue
            cur_mean = float(np.mean(values))
            cur_std = float(np.std(values))
            top_means[name] = round(cur_mean, 6)
            top_stds[name] = round(cur_std, 6)

            b_mean = float(baseline_means.get(name, cur_mean))
            b_std = float(baseline_stds.get(name, max(cur_std, 1e-6)))

            psi = population_stability_index([b_mean - b_std, b_mean, b_mean + b_std], values)
            ks = ks_statistic([b_mean - b_std, b_mean, b_mean + b_std], values)
            z_shift = z_score_shift(b_mean, b_std, cur_mean)
            feature_drift_parts[name] = min(1.0, 0.45 * min(1.0, psi) + 0.35 * ks + 0.20 * min(1.0, z_shift / 4.0))

        feature_drift = float(np.mean(list(feature_drift_parts.values()))) if feature_drift_parts else 0.0

        baseline_conf = baseline.get("validation_confidence_stats", {})
        base_conf_mean = float(baseline_conf.get("mean", avg_conf))
        conf_collapse = max(0.0, min(1.0, (base_conf_mean - avg_conf) / max(0.1, base_conf_mean)))

        baseline_pred = baseline.get("baseline_prediction_distribution", {})
        base_pos_rate = float(baseline_pred.get("positive_rate", pos_rate))
        positive_shift = min(1.0, abs(base_pos_rate - pos_rate) / 0.5)

        base_shap_rank = [str(x) for x in baseline.get("shap_ranking", []) if x]
        current_shap_rank = self._current_shap_top(rows, top_k=5)
        shap_shift = normalized_rank_shift(base_shap_rank, current_shap_rank, top_k=5)

        score = weighted_drift_score(
            {
                "feature_drift": (feature_drift, 0.45),
                "confidence_collapse": (conf_collapse, 0.25),
                "positive_shift": (positive_shift, 0.20),
                "shap_shift": (shap_shift, 0.10),
            }
        )
        alert = drift_alert_level(score)

        return MonitorSnapshot(
            hazard_type=hazard_type,
            region_id=region_id,
            model_version=model_version,
            snapshot_time=datetime.utcnow().isoformat(),
            sample_count=sample_count,
            avg_confidence=round(avg_conf, 6),
            prediction_positive_rate=round(pos_rate, 6),
            confidence_std=round(conf_std, 6),
            top_feature_means=top_means,
            top_feature_stds=top_stds,
            drift_score=round(float(score), 6),
            alert_level=alert,
        )

    async def run_for_model(
        self,
        hazard_type: str,
        region_id: str,
        version: str,
        hours: int = 24,
    ) -> Dict[str, Any]:
        rows = await self._load_recent_predictions(hazard_type, region_id, version, hours=hours)
        snapshot = self.compute_snapshot(hazard_type, region_id, version, rows)

        health = "healthy"
        if snapshot.alert_level == "INFO":
            health = "watch"
        elif snapshot.alert_level == "WARNING":
            health = "degraded"
        elif snapshot.alert_level == "CRITICAL":
            health = "rollback_recommended"

        recommended = None
        if health in {"degraded", "rollback_recommended"}:
            recommended = self.model_registry.recommend_rollback_target(hazard_type, region_id)

        self.model_registry.mark_model_health(
            hazard_type=hazard_type,
            region_id=region_id,
            version=version,
            health_status=health,
            drift_score=snapshot.drift_score,
            recommended_rollback_version=recommended,
            reason=f"monitor:{snapshot.alert_level.lower()}",
        )

        if snapshot.alert_level == "CRITICAL":
            logger.warning(
                "MODEL_HEALTH_ALERT "
                f"hazard={hazard_type} region={region_id} version={version} "
                f"drift_score={snapshot.drift_score} alert={snapshot.alert_level} "
                f"rollback_candidate={recommended}"
            )

        return {
            "snapshot": snapshot.__dict__,
            "health_status": health,
            "recommended_rollback_version": recommended,
        }

    async def run_for_all_current_models(self, hours: int = 24) -> Dict[str, Any]:
        results: List[Dict[str, Any]] = []
        combos = {(m.hazard_type, m.region_id) for m in self.model_registry.models.values()}
        for hazard_type, region_id in sorted(combos):
            current_key = self.model_registry.get_current_model_key(hazard_type, region_id)
            if not current_key:
                continue
            version = self.model_registry.models[current_key].version
            try:
                results.append(
                    {
                        "hazard_type": hazard_type,
                        "region_id": region_id,
                        **(await self.run_for_model(hazard_type, region_id, version, hours=hours)),
                    }
                )
            except Exception as exc:
                logger.error(f"Monitoring run failed for {hazard_type}/{region_id}: {exc}")
                results.append(
                    {
                        "hazard_type": hazard_type,
                        "region_id": region_id,
                        "error": str(exc),
                    }
                )

        return {
            "checked": len(results),
            "critical": sum(1 for r in results if (r.get("snapshot") or {}).get("alert_level") == "CRITICAL"),
            "results": results,
            "checked_at": datetime.utcnow().isoformat(),
        }
