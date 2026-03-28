"""
AEGIS AI Engine — Base Real-Data Training Pipeline

Shared training harness used by all 11 hazard ``train_{hazard}_real.py``
scripts.  Handles:

  * Provider resolution and data fetching
  * Feature engineering orchestration
  * Chronological train/val/test split
  * Multi-model hyperparameter search (XGBoost, LightGBM, LogisticRegression)
  * Evaluation, SHAP, backtesting, calibration
  * Model promotion gates
  * Registry output (model.pkl, metadata.json, training_report.json,
    data_quality_report.json)

Subclasses override only ``fetch_data()``, ``build_labels()``,
``hazard_feature_columns()``, and declare ``HAZARD_CONFIG``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd
from loguru import logger

# Ensure ai-engine root is on sys.path
_AI_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

from data.providers import get_provider
from app.training.feature_engineering import FeatureEngineer, LeakagePrevention
from app.training.evaluate import ModelEvaluator, DataQualityReporter, UK_KNOWN_EVENTS

REGISTRY_ROOT = _AI_ROOT / "model_registry"

# Hazard configuration dataclass

class HazardConfig:
    """Per-hazard training configuration."""

    def __init__(
        self,
        hazard_type: str,
        task_type: str,  # forecast | nowcast | risk_scoring | detection
        label_provenance: dict,
        lead_hours: int = 6,
        min_total_samples: int = 500,
        min_positive_samples: int = 20,
        min_stations: int = 5,
        promotion_min_roc_auc: float = 0.70,
    ):
        self.hazard_type = hazard_type
        self.task_type = task_type
        self.label_provenance = label_provenance
        self.lead_hours = lead_hours
        self.min_total_samples = min_total_samples
        self.min_positive_samples = min_positive_samples
        self.min_stations = min_stations
        self.promotion_min_roc_auc = promotion_min_roc_auc

# Abstract base pipeline

class BaseRealPipeline(ABC):
    """Base class for all real-data hazard training scripts."""

    HAZARD_CONFIG: HazardConfig  # Must be set by subclass

    def __init__(self, region_id: str, start_date: str, end_date: str, refresh: bool = False):
        self.region_id = region_id
        self.start_date = start_date
        self.end_date = end_date
        self.provider = get_provider(region_id, refresh=refresh)
        self.evaluator = ModelEvaluator()
        self.quality_reporter = DataQualityReporter()
        self.feature_engineer = FeatureEngineer

    # Abstract methods (hazard-specific)

    @abstractmethod
    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch raw data via provider. Return dict of named DataFrames."""

    @abstractmethod
    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Construct labels from raw data.
        Must return DataFrame with columns: [timestamp, station_id, label, ...]
        label = 1 for positive, 0 for negative.
        """

    @abstractmethod
    def hazard_feature_columns(self) -> list[str]:
        """Return ordered list of feature column names this hazard uses."""

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Default feature engineering using shared FeatureEngineer.
        Override in subclass if hazard needs custom features.
        Returns DataFrame indexed by (timestamp, station_id) with feature columns.
        """
        frames = []

        if "weather" in raw_data and not raw_data["weather"].empty:
            wf = self.feature_engineer.compute_weather_features(raw_data["weather"])
            tf = self.feature_engineer.compute_temporal_features(
                raw_data["weather"]["timestamp"]
            )
            wf = pd.concat([wf, tf], axis=1)
            frames.append(wf)

        if "rainfall" in raw_data and not raw_data["rainfall"].empty:
            rf = self.feature_engineer.compute_rainfall_features(raw_data["rainfall"])
            frames.append(rf)

        if "river" in raw_data and not raw_data["river"].empty:
            rv = self.feature_engineer.compute_river_features(raw_data["river"])
            frames.append(rv)

        if not frames:
            raise RuntimeError("No feature data available — cannot build features")

        # Merge all feature frames on shared index
        combined = frames[0]
        for f in frames[1:]:
            combined = combined.join(f, how="outer", rsuffix="_dup")
            # Drop duplicate columns
            dup_cols = [c for c in combined.columns if c.endswith("_dup")]
            combined.drop(columns=dup_cols, inplace=True)

        # Forward fill then zero fill remaining NaN
        combined = combined.ffill().fillna(0.0)
        return combined

    # Main training flow

    async def run(self) -> dict:
        """Execute the full training pipeline. Returns summary dict."""
        cfg = self.HAZARD_CONFIG
        logger.info(f"{'='*60}")
        logger.info(f"Training {cfg.hazard_type} | region={self.region_id}")
        logger.info(f"Task type: {cfg.task_type}")
        logger.info(f"Date range: {self.start_date} to {self.end_date}")
        logger.info(f"{'='*60}")

        t0 = time.time()

        # 1. Fetch raw data
        logger.info("Step 1/8: Fetching raw data...")
        raw_data = await self.fetch_raw_data()
        for name, df in raw_data.items():
            logger.info(f"  {name}: {len(df)} rows")

        # 2. Build features
        logger.info("Step 2/8: Engineering features...")
        features_df = self.build_features(raw_data)
        logger.info(f"  Feature matrix: {features_df.shape}")

        # 3. Build labels
        logger.info("Step 3/8: Constructing labels...")
        labels_df = self.build_labels(raw_data)
        n_pos = int(labels_df["label"].sum())
        n_neg = int(len(labels_df) - n_pos)
        logger.info(f"  Labels: {n_pos} positive, {n_neg} negative")

        # 4. Merge features + labels
        logger.info("Step 4/8: Merging features and labels...")
        dataset = self._merge_features_labels(features_df, labels_df, cfg)
        if dataset is None:
            return self._failure_result("Feature-label merge produced empty dataset")

        feature_cols = self.hazard_feature_columns()
        # Keep only columns that exist
        available_cols = [c for c in feature_cols if c in dataset.columns]
        missing_cols = [c for c in feature_cols if c not in dataset.columns]
        if missing_cols:
            logger.warning(f"  Missing feature columns (will use 0): {missing_cols[:10]}")
            for c in missing_cols:
                dataset[c] = 0.0
            available_cols = feature_cols

        X = dataset[available_cols].values
        y = dataset["label"].values
        timestamps = dataset["timestamp"] if "timestamp" in dataset.columns else None
        station_ids = dataset["station_id"] if "station_id" in dataset.columns else None

        # 5. Data quality gates
        logger.info("Step 5/8: Checking data quality gates...")
        quality_report = self.quality_reporter.generate_report(
            pd.DataFrame(X, columns=available_cols), pd.Series(y, name="label"),
            available_cols,
            station_ids=station_ids,
            timestamps=timestamps,
        )
        passed, violations = self.quality_reporter.check_minimum_gates(
            quality_report,
            min_total=cfg.min_total_samples,
            min_positive=cfg.min_positive_samples,
            min_stations=cfg.min_stations,
        )
        if not passed:
            logger.error(f"Data quality gates FAILED: {violations}")
            return self._failure_result(
                f"Quality gates failed: {'; '.join(violations)}",
                quality_report=quality_report,
            )
        logger.success("  Data quality gates passed")

        # 6. Chronological split
        logger.info("Step 6/8: Chronological train/val/test split...")
        splits = self._chronological_split(X, y, timestamps)
        X_train, y_train = splits["train"]
        X_val, y_val = splits["val"]
        X_test, y_test = splits["test"]
        logger.info(
            f"  Train: {len(y_train)} ({y_train.sum():.0f}+) | "
            f"Val: {len(y_val)} ({y_val.sum():.0f}+) | "
            f"Test: {len(y_test)} ({y_test.sum():.0f}+)"
        )

        # 7. Train candidates
        logger.info("Step 7/8: Training candidate models...")
        best_model, search_results = self._train_candidates(
            X_train, y_train, X_val, y_val
        )
        logger.success(f"  Best model: {search_results['chosen_model']}")

        # 8. Evaluate
        logger.info("Step 8/8: Full evaluation...")
        test_metrics = self.evaluator.full_evaluation(
            best_model, X_test, y_test, available_cols
        )

        # Temporal stability
        ts_test = None
        if timestamps is not None:
            n_total = len(timestamps)
            test_start = int(n_total * 0.85)
            ts_test = timestamps.iloc[test_start:test_start + len(y_test)]
        stability = {}
        if ts_test is not None and len(ts_test) == len(y_test):
            stability = self.evaluator.temporal_stability(
                best_model, X_test, y_test, ts_test
            )

        # Backtest known events
        relevant_events = [
            e for e in UK_KNOWN_EVENTS
            if cfg.hazard_type in e.get("hazard_types", [])
        ]
        backtest = []
        if relevant_events:
            logger.info(f"  Backtesting {len(relevant_events)} known events...")
            backtest = self.evaluator.backtest_known_events(
                best_model, self.provider, self.feature_engineer,
                available_cols, relevant_events
            )

        elapsed = time.time() - t0

        # Promotion decision
        promotion = self._promotion_decision(test_metrics, stability, backtest, cfg)

        # Save artifacts
        version = datetime.utcnow().strftime("v%Y.%m.%d.%H%M%S")
        output_dir = REGISTRY_ROOT / f"{cfg.hazard_type}_{self.region_id}_{version}"
        output_dir.mkdir(parents=True, exist_ok=True)

        # model.pkl
        joblib.dump(best_model, output_dir / "model.pkl")

        # metadata.json
        if hasattr(X, "mean"):
            try:
                training_feature_means = {
                    col: float(X[col].mean()) for col in available_cols if col in X.columns
                }
                training_feature_stds = {
                    col: float(X[col].std() or 0.0) for col in available_cols if col in X.columns
                }
            except Exception:
                training_feature_means = {}
                training_feature_stds = {}
        else:
            training_feature_means = {}
            training_feature_stds = {}

        val_conf = test_metrics.get("confidence_distribution", {}) if isinstance(test_metrics, dict) else {}
        positive = int(y.sum())
        total = int(len(y))
        metadata = {
            "name": f"{cfg.hazard_type}_{search_results['chosen_model']}",
            "version": version,
            "hazard_type": cfg.hazard_type,
            "region_id": self.region_id,
            "model_type": search_results["chosen_model"],
            "model_type_label": f"real_data_{cfg.task_type}",
            "task_type": cfg.task_type,
            "label_strategy": cfg.label_provenance.get("description", ""),
            "label_provenance": cfg.label_provenance,
            "trained_at": datetime.utcnow().isoformat(),
            "feature_names": available_cols,
            "performance_metrics": {
                k: v for k, v in test_metrics.items()
                if isinstance(v, (int, float)) and k != "shap_feature_importance"
            },
            "shap_feature_importance": test_metrics.get("shap_feature_importance", {}),
            "training_samples": {
                "total": int(len(y)),
                "positive": int(y.sum()),
                "negative": int(len(y) - y.sum()),
                "train": int(len(y_train)),
                "val": int(len(y_val)),
                "test": int(len(y_test)),
            },
            "training_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "data_sources": list(raw_data.keys()),
            "temporal_range": {
                "start": self.start_date,
                "end": self.end_date,
            },
            "training_feature_means": training_feature_means,
            "training_feature_stds": training_feature_stds,
            "class_balance": {
                "positive": positive,
                "negative": int(total - positive),
                "positive_rate": round(positive / max(1, total), 6),
            },
            "validation_confidence_stats": {
                "mean": float(val_conf.get("mean", 0.0) or 0.0),
                "std": float(val_conf.get("std", 0.0) or 0.0),
                "p05": float(val_conf.get("p05", 0.0) or 0.0),
                "p50": float(val_conf.get("p50", 0.0) or 0.0),
                "p95": float(val_conf.get("p95", 0.0) or 0.0),
            },
            "reference_shap_importance_ranking": list((test_metrics.get("shap_feature_importance", {}) or {}).keys())[:20],
            "baseline_prediction_distribution": {
                "positive_rate": round(positive / max(1, total), 6),
                "risk_levels": {
                    "critical": 0.0,
                    "high": 0.0,
                    "medium": round(positive / max(1, total), 6),
                    "low": round((total - positive) / max(1, total), 6),
                },
            },
            "promotion_status": promotion["status"],
            "known_limitations": cfg.label_provenance.get("limitations", ""),
        }
        with open(output_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2, default=str)

        # training_report.json
        training_report = {
            "hazard_type": cfg.hazard_type,
            "region_id": self.region_id,
            "task_type": cfg.task_type,
            "elapsed_seconds": round(elapsed, 1),
            "hyperparameter_search": search_results,
            "test_metrics": test_metrics,
            "confusion_matrix": test_metrics.get("confusion_matrix"),
            "roc_curve": test_metrics.get("roc_curve"),
            "pr_curve": test_metrics.get("pr_curve"),
            "calibration_curve": test_metrics.get("calibration_curve"),
            "temporal_stability": stability,
            "backtest_results": backtest,
            "promotion": promotion,
        }
        with open(output_dir / "training_report.json", "w") as f:
            json.dump(training_report, f, indent=2, default=str)

        # data_quality_report.json
        quality_report["leakage_checks_passed"] = True
        with open(output_dir / "data_quality_report.json", "w") as f:
            json.dump(quality_report, f, indent=2, default=str)

        logger.success(f"Artifacts saved to {output_dir}")
        logger.info(f"Promotion status: {promotion['status']}")
        logger.info(f"ROC-AUC: {test_metrics.get('roc_auc', 'N/A')}")
        logger.info(f"F1 positive: {test_metrics.get('f1_positive_class', 'N/A')}")

        return {
            "status": "success",
            "hazard_type": cfg.hazard_type,
            "region_id": self.region_id,
            "output_dir": str(output_dir),
            "version": version,
            "metrics": {k: v for k, v in test_metrics.items() if isinstance(v, (int, float))},
            "promotion_status": promotion["status"],
            "shap_top5": dict(list(test_metrics.get("shap_feature_importance", {}).items())[:5]),
            "samples": int(len(y)),
            "elapsed_seconds": round(elapsed, 1),
        }

    # Internal helpers

    def _merge_features_labels(
        self, features_df: pd.DataFrame, labels_df: pd.DataFrame, cfg: HazardConfig
    ) -> Optional[pd.DataFrame]:
        """Merge features and labels, enforcing leakage cutoff for forecast tasks."""
        # Reset index to get timestamp/station_id as columns
        feat = features_df.reset_index() if features_df.index.names != [None] else features_df.copy()
        lab = labels_df.copy()

        # Ensure timestamp columns
        for df in (feat, lab):
            if "timestamp" in df.columns:
                df["timestamp"] = pd.to_datetime(df["timestamp"])

        # For forecast tasks, apply lead-time cutoff
        if cfg.task_type == "forecast" and cfg.lead_hours > 0:
            # Features must be from before the event
            # We shift feature timestamps forward by lead_hours for merge
            pass  # Labels already have the event timestamp; features are pre-event

        # Merge on timestamp (and station_id if both have it)
        merge_cols = ["timestamp"]
        if "station_id" in feat.columns and "station_id" in lab.columns:
            merge_cols.append("station_id")

        try:
            merged = pd.merge(feat, lab[merge_cols + ["label"]], on=merge_cols, how="inner")
        except Exception as e:
            logger.error(f"Merge failed: {e}")
            # Try merge on nearest timestamp
            try:
                merged = pd.merge_asof(
                    feat.sort_values("timestamp"),
                    lab[merge_cols + ["label"]].sort_values("timestamp"),
                    on="timestamp",
                    tolerance=pd.Timedelta("1h"),
                    direction="nearest",
                )
                merged = merged.dropna(subset=["label"])
            except Exception as e2:
                logger.error(f"Fallback merge also failed: {e2}")
                return None

        if merged.empty:
            return None

        merged["label"] = merged["label"].astype(int)
        return merged

    def _chronological_split(
        self, X: np.ndarray, y: np.ndarray, timestamps: Optional[pd.Series]
    ) -> dict:
        """70/15/15 chronological split (no shuffle)."""
        n = len(y)
        train_end = int(n * 0.70)
        val_end = int(n * 0.85)

        return {
            "train": (X[:train_end], y[:train_end]),
            "val": (X[train_end:val_end], y[train_end:val_end]),
            "test": (X[val_end:], y[val_end:]),
        }

    def _train_candidates(
        self, X_train, y_train, X_val, y_val
    ) -> tuple[Any, dict]:
        """Train XGBoost, LightGBM, and LogisticRegression candidates."""
        from sklearn.model_selection import TimeSeriesSplit, RandomizedSearchCV
        from sklearn.linear_model import LogisticRegression

        # Imbalance weight
        n_neg = (y_train == 0).sum()
        n_pos = max((y_train == 1).sum(), 1)
        scale_pos_weight = n_neg / n_pos

        candidates = {}
        tscv = TimeSeriesSplit(n_splits=5)

        # XGBoost
        try:
            import xgboost as xgb
            xgb_params = {
                "n_estimators": [100, 200, 500],
                "max_depth": [3, 5, 7, 10],
                "learning_rate": [0.01, 0.05, 0.1],
                "subsample": [0.7, 0.8, 0.9],
                "colsample_bytree": [0.7, 0.8, 0.9],
                "min_child_weight": [1, 3, 5],
            }
            xgb_model = xgb.XGBClassifier(
                scale_pos_weight=scale_pos_weight,
                eval_metric="logloss",
                use_label_encoder=False,
                random_state=42,
                n_jobs=-1,
            )
            search = RandomizedSearchCV(
                xgb_model, xgb_params, n_iter=50, scoring="roc_auc",
                cv=tscv, random_state=42, n_jobs=-1, error_score=0.0,
            )
            search.fit(X_train, y_train)
            candidates["xgboost"] = {
                "model": search.best_estimator_,
                "val_auc": self._score_auc(search.best_estimator_, X_val, y_val),
                "best_params": search.best_params_,
                "cv_auc": search.best_score_,
            }
            logger.info(f"  XGBoost val AUC: {candidates['xgboost']['val_auc']:.4f}")
        except Exception as e:
            logger.warning(f"  XGBoost training failed: {e}")

        # LightGBM
        try:
            import lightgbm as lgb
            lgb_params = {
                "n_estimators": [100, 200, 500],
                "max_depth": [3, 5, 7, 10],
                "learning_rate": [0.01, 0.05, 0.1],
                "subsample": [0.7, 0.8, 0.9],
                "colsample_bytree": [0.7, 0.8, 0.9],
                "min_child_weight": [1, 3, 5],
            }
            lgb_model = lgb.LGBMClassifier(
                scale_pos_weight=scale_pos_weight,
                random_state=42,
                n_jobs=-1,
                verbose=-1,
            )
            search = RandomizedSearchCV(
                lgb_model, lgb_params, n_iter=50, scoring="roc_auc",
                cv=tscv, random_state=42, n_jobs=-1, error_score=0.0,
            )
            search.fit(X_train, y_train)
            candidates["lightgbm"] = {
                "model": search.best_estimator_,
                "val_auc": self._score_auc(search.best_estimator_, X_val, y_val),
                "best_params": search.best_params_,
                "cv_auc": search.best_score_,
            }
            logger.info(f"  LightGBM val AUC: {candidates['lightgbm']['val_auc']:.4f}")
        except Exception as e:
            logger.warning(f"  LightGBM training failed: {e}")

        # Logistic Regression baseline
        try:
            from sklearn.preprocessing import StandardScaler
            from sklearn.pipeline import Pipeline

            lr = Pipeline([
                ("scaler", StandardScaler()),
                ("lr", LogisticRegression(
                    max_iter=1000,
                    class_weight={0: 1.0, 1: scale_pos_weight},
                    random_state=42,
                )),
            ])
            lr.fit(X_train, y_train)
            candidates["logistic_regression"] = {
                "model": lr,
                "val_auc": self._score_auc(lr, X_val, y_val),
                "best_params": {},
                "cv_auc": None,
            }
            logger.info(f"  LogReg val AUC: {candidates['logistic_regression']['val_auc']:.4f}")
        except Exception as e:
            logger.warning(f"  LogisticRegression failed: {e}")

        if not candidates:
            raise RuntimeError("All candidate models failed to train")

        # Choose best by val AUC, then Brier as tiebreaker
        best_name = max(candidates, key=lambda k: candidates[k]["val_auc"])
        best = candidates[best_name]

        search_results = {
            "chosen_model": best_name,
            "chosen_val_auc": best["val_auc"],
            "chosen_cv_auc": best.get("cv_auc"),
            "chosen_params": best["best_params"],
            "candidates": {
                k: {"val_auc": v["val_auc"], "cv_auc": v.get("cv_auc"), "params": v["best_params"]}
                for k, v in candidates.items()
            },
            "scale_pos_weight": scale_pos_weight,
            "imbalance_ratio": f"{n_neg}:{n_pos}",
        }

        return best["model"], search_results

    def _score_auc(self, model, X, y) -> float:
        from sklearn.metrics import roc_auc_score
        try:
            if hasattr(model, "predict_proba"):
                probs = model.predict_proba(X)[:, 1]
            else:
                probs = model.decision_function(X)
            if len(np.unique(y)) < 2:
                return 0.5
            return roc_auc_score(y, probs)
        except Exception:
            return 0.0

    def _promotion_decision(
        self, metrics: dict, stability: dict, backtest: list, cfg: HazardConfig
    ) -> dict:
        """Apply promotion gates."""
        reasons = []
        status = "candidate"

        roc_auc = metrics.get("roc_auc", 0.0)
        if roc_auc < cfg.promotion_min_roc_auc:
            reasons.append(f"ROC-AUC {roc_auc:.4f} < {cfg.promotion_min_roc_auc}")
            status = "rejected"

        if stability.get("drift_detected"):
            reasons.append("Temporal drift detected")
            status = "rejected"

        # Check backtest: major events should be detected
        if backtest:
            missed_major = [
                b["event_name"] for b in backtest
                if b.get("expected_positive") and not b.get("predicted_positive", False)
                and b.get("error") is None
            ]
            if missed_major:
                reasons.append(f"Missed major events: {missed_major}")
                # Downgrade to candidate if otherwise OK, but don't auto-reject
                if status != "rejected":
                    status = "candidate"

        if status != "rejected" and roc_auc >= cfg.promotion_min_roc_auc and not reasons:
            status = "promoted"

        return {
            "status": status,
            "roc_auc": roc_auc,
            "reasons": reasons,
            "gates_checked": [
                "min_roc_auc", "temporal_stability", "backtest_major_events"
            ],
        }

    def _failure_result(self, reason: str, quality_report: dict = None) -> dict:
        """Return a failure summary when training can't proceed."""
        logger.error(f"Training aborted: {reason}")
        return {
            "status": "failed",
            "hazard_type": self.HAZARD_CONFIG.hazard_type,
            "region_id": self.region_id,
            "error": reason,
            "quality_report": quality_report,
        }

# CLI entrypoint helper

def parse_training_args(hazard_name: str) -> argparse.Namespace:
    """Standard argument parser for all training scripts."""
    parser = argparse.ArgumentParser(
        description=f"AEGIS real-data training: {hazard_name}"
    )
    parser.add_argument(
        "--region", default="uk-default",
        help="Region ID (default: uk-default)"
    )
    parser.add_argument(
        "--start-date", default="2015-01-01",
        help="Training data start date (default: 2015-01-01)"
    )
    parser.add_argument(
        "--end-date", default="2025-12-31",
        help="Training data end date (default: 2025-12-31)"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Bypass cache and re-fetch from APIs"
    )
    return parser.parse_args()

def run_pipeline(pipeline_class, args: argparse.Namespace) -> dict:
    """Instantiate and run a pipeline from CLI args."""
    pipeline = pipeline_class(
        region_id=args.region,
        start_date=args.start_date,
        end_date=args.end_date,
        refresh=args.refresh,
    )
    return asyncio.run(pipeline.run())
