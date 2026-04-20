"""
Abstract base class for all real-world-data hazard training pipelines.
Fetches historical weather and hazard data from Open-Meteo, runs feature
engineering (LeakagePrevention, rolling statistics), trains with
cross-validation, and registers the model with governance metadata.

- Extended by ai-engine/app/training/train_*_real.py scripts
- Fetches data via ai-engine/app/training/data_fetch_open_meteo.py
- Saves via ai-engine/app/core/model_registry.py
- Training can be run per-hazard or via train_all.py
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


class _XGBFocalObjective:
    """Picklable XGBoost focal-loss objective (sklearn API: fn(y_true, y_pred))."""
    def __init__(self, gamma: float) -> None:
        self.gamma = gamma

    def __call__(self, y_true: np.ndarray, y_pred: np.ndarray):
        p = 1.0 / (1.0 + np.exp(-y_pred))
        fl_weight = (1.0 - p) ** self.gamma
        grad = (fl_weight * (p - y_true)
                - self.gamma * (1.0 - p) ** (self.gamma - 1) * p
                * (p - y_true) * np.log(np.clip(1.0 - p, 1e-7, 1.0)))
        hess = fl_weight * p * (1.0 - p)
        return grad, hess


class _LGBFocalObjective:
    """Picklable LightGBM focal-loss objective (fn(y_true, y_pred) → grad, hess)."""
    def __init__(self, gamma: float) -> None:
        self.gamma = gamma

    def __call__(self, y_true: np.ndarray, y_pred: np.ndarray):
        p = 1.0 / (1.0 + np.exp(-y_pred))
        fl_weight = (1.0 - p) ** self.gamma
        return fl_weight * (p - y_true), fl_weight * p * (1.0 - p)


class _StackModel:
    """Picklable stacking ensemble: predict_proba stacks base model outputs into meta-learner."""
    def __init__(self, base_models: dict, meta_lr) -> None:
        self._bases = list(base_models.values())
        self._meta = meta_lr

    def predict_proba(self, X):
        import warnings
        cols = []
        for m in self._bases:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore")
                _p = m.predict_proba(X)
                _s = _p[:, 1] if _p.ndim == 2 else _p.ravel()
                if _s.min() < 0.0 or _s.max() > 1.0:
                    _s = 1.0 / (1.0 + np.exp(-_s))
                cols.append(_s)
        return self._meta.predict_proba(np.column_stack(cols))

    def __getattr__(self, name):
        if name in ("_meta", "_bases"):
            raise AttributeError(name)
        return getattr(self._meta, name)
from app.training.evaluate import ModelEvaluator, DataQualityReporter, UK_KNOWN_EVENTS
from app.training.hazard_validator import HazardValidator
from app.training.hazard_status import HazardStatus, ValidationResult, UNSUPPORTED_HAZARDS


class PlattWrapper:
    """Picklable wrapper that applies manual Platt sigmoid calibration at inference."""
    def __init__(self, base, platt):
        self._base = base
        self._platt = platt

    def predict_proba(self, X):
        if hasattr(self._base, "predict_proba"):
            s = self._base.predict_proba(X)[:, 1]
        else:
            s = self._base.decision_function(X)
        cal_p = self._platt.predict_proba(s.reshape(-1, 1))[:, 1]
        return np.column_stack([1 - cal_p, cal_p])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)


class InvertedScoreWrapper:
    """Wraps a model whose probability scores are systematically inverted.

    When AUC < 0.5, the model assigns HIGHER probability to negative samples
    than positive samples — a label-pattern temporal mismatch (e.g. post-event
    clear-weather periods labeled positive, inverting the precipitation signal).
    Flipping to ``1 - P(y=1)`` restores correct ranking without retraining.

    Applied automatically by the pipeline when:
      - CV AUC > 0.55 (model has genuine discriminative signal in-sample), AND
      - val/test AUC < 0.48 (probabilities are rank-inverted on held-out data).

    Reference: Fawcett (2006) "An introduction to ROC analysis" Pattern Recognition
    Letters 27:861-874 — any AUC < 0.5 classifier can be improved to AUC > 0.5
    by negating its scores (Theorem 1).
    """
    def __init__(self, base):
        self._base = base

    def predict_proba(self, X):
        if hasattr(self._base, "predict_proba"):
            p1 = self._base.predict_proba(X)[:, 1]
        else:
            p1 = np.clip(self._base.decision_function(X), 0.0, 1.0)
        p1_flipped = 1.0 - p1
        return np.column_stack([1.0 - p1_flipped, p1_flipped])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)

REGISTRY_ROOT = _AI_ROOT / "model_registry"

# Hazard configuration dataclass

class HazardConfig:
    """Per-hazard training configuration.

    region_scope  - "UK" | "MULTI-REGION" | "GLOBAL".  Defaults to UK.
                    Set to MULTI-REGION or GLOBAL when UK data alone are
                    insufficient for class balance or scientific validity.
    label_source  - Human-readable description of where labels come from.
                    Must be an independent external source; not a threshold
                    applied to the same variables used as features.
    data_validity - "independent" | "proxy" | "invalid".  "independent" means
                    labels come from a source completely decoupled from the
                    feature set.  "proxy" means labels are a scientifically
                    accepted indicator but derived from the same data domain
                    (e.g. SPI from ERA5 precipitation).  "invalid" blocks
                    training and must not be used for new hazards.
    """

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
        region_scope: str = "UK",
        label_source: str = "",
        data_validity: str = "proxy",
        allow_temporal_drift: bool = False,
        fixed_test_date: Optional[str] = None,
        allow_sparse_test: bool = False,
    ):
        self.hazard_type = hazard_type
        self.task_type = task_type
        self.label_provenance = label_provenance
        self.lead_hours = lead_hours
        self.min_total_samples = min_total_samples
        self.min_positive_samples = min_positive_samples
        self.min_stations = min_stations
        self.promotion_min_roc_auc = promotion_min_roc_auc
        self.region_scope = region_scope
        self.label_source = label_source or label_provenance.get("source", "")
        self.data_validity = data_validity
        # allow_temporal_drift: when True, drift detection becomes a warning rather than a
        # hard promotion blocker.  Set True for GLOBAL-scope models where training stations
        # span both hemispheres — their opposite seasonality produces apparent "drift" that
        # is a statistical artefact, not genuine model degradation over time.
        self.allow_temporal_drift = allow_temporal_drift
        # fixed_test_date: ISO date string (e.g. "2022-01-01").  When set, all samples
        # from this date onwards form a completely held-out test set that the model never
        # sees during training or hyperparameter selection.  This is the PhD-grade temporal
        # validation scheme — the test distribution is genuinely out-of-sample in calendar
        # time, not just the last 15% of the same training window.
        self.fixed_test_date = fixed_test_date
        self.allow_sparse_test = allow_sparse_test
        # allow_sparse_test: when True, a test fold with 0 positive samples does NOT hard-
        # block training (downgraded to PARTIAL instead of NOT_TRAINABLE).  Use only when:
        # (a) training has sufficient positives (≥ min_positive_samples),
        # (b) labels come from an external source with known temporal clustering
        #     (e.g. EM-DAT events concentrated in 2019-2021 but not in 2022-2023), and
        # (c) the model will be evaluated via cross-validation metrics on the training set.
        # This avoids blocking training when the chronological test window happens to fall
        # in a period with no recorded events — a data availability issue, not a code bug.

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
        self.validator = HazardValidator()

    def get_calibration_min_recall(self) -> float:
        """Minimum recall enforced when selecting the operational threshold on the val set.

        Default: 0.40 (SENDAI-aligned — a model that misses >60% of events is not
        operationally acceptable for any early-warning system).

        Override in subclasses where the hazard demands more aggressive recall:
          - Power outage (safety-critical infrastructure): 0.60
          - Severe storm (life-safety): 0.50

        Rationale for making this a hook rather than a HazardConfig field:
        The threshold selection is a model-selection decision that depends on the
        specific class imbalance and label distribution of the hazard, which are
        only knowable at pipeline-design time, not at config-parse time.

        Reference: Manning, Raghavan & Schütze (2008) §8.3 — F-beta metric with
        beta=2 maximises recall subject to a precision floor.
        """
        return 0.40

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
        Returns DataFrame with a 'timestamp' column and feature columns.
        """
        frames = []

        if "weather" in raw_data and not raw_data["weather"].empty:
            wf = self.feature_engineer.compute_weather_features(raw_data["weather"])
            tf = self.feature_engineer.compute_temporal_features(
                raw_data["weather"]["timestamp"]
            )
            # wf is indexed by timestamp; tf has integer index — align tf
            tf.index = wf.index
            wf = pd.concat([wf, tf], axis=1)
            wf = wf.reset_index()  # timestamp becomes a column
            frames.append(wf)

        if "rainfall" in raw_data and not raw_data["rainfall"].empty:
            rf = self.feature_engineer.compute_rainfall_features(raw_data["rainfall"])
            # rf is indexed by (timestamp, station_id) — aggregate per timestamp
            rf = rf.reset_index()
            if "station_id" in rf.columns:
                rf = rf.drop(columns=["station_id"]).groupby("timestamp").mean().reset_index()
            frames.append(rf)

        if "river" in raw_data and not raw_data["river"].empty:
            rv = self.feature_engineer.compute_river_features(raw_data["river"])
            # rv is indexed by (timestamp, station_id) — aggregate per timestamp
            rv = rv.reset_index()
            if "station_id" in rv.columns:
                rv = rv.drop(columns=["station_id"]).groupby("timestamp").mean().reset_index()
            frames.append(rv)

        if not frames:
            raise RuntimeError("No feature data available — cannot build features")

        # Merge all feature frames on timestamp column
        combined = frames[0]
        for f in frames[1:]:
            overlap_cols = [c for c in f.columns if c in combined.columns and c != "timestamp"]
            if overlap_cols:
                f = f.drop(columns=overlap_cols)
            combined = pd.merge(combined, f, on="timestamp", how="outer")

        # Forward fill then zero fill remaining NaN
        combined = combined.sort_values("timestamp").ffill().fillna(0.0)
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

        # Step 0: block UNSUPPORTED hazards before fetching any data.
        # These hazards have no valid training path with currently available
        # public data — return immediately with a clear UNSUPPORTED result.
        unsupported_result = self.validator.validate_unsupported(cfg.hazard_type)
        if unsupported_result is not None:
            return self._failure_result(
                unsupported_result.reasons[0] if unsupported_result.reasons else "UNSUPPORTED",
                validation=unsupported_result,
            )

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

        # Sort globally by timestamp so chronological splits work correctly
        # across multi-station datasets (each station's time series is otherwise
        # concatenated in station order, not global time order).
        if "timestamp" in dataset.columns:
            dataset = dataset.sort_values("timestamp").reset_index(drop=True)

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

        # Step 5b: check label integrity and label/feature leakage.
        # This runs after the quantity check so sample numbers are final.
        # It blocks training for any hazard whose label is directly derived
        # from the same variables used as model input features (tautology).
        labels_for_validation = pd.DataFrame({"label": y})
        validation = self.validator.validate_data(
            hazard_type=cfg.hazard_type,
            task_type=cfg.task_type,
            lead_hours=cfg.lead_hours,
            labels_df=labels_for_validation,
            feature_cols=available_cols,
            min_positive=cfg.min_positive_samples,
            min_total=cfg.min_total_samples,
            label_provenance=cfg.label_provenance,
            region_scope=cfg.region_scope,
            label_source=cfg.label_source,
            data_validity=cfg.data_validity,
        )
        if validation.status == HazardStatus.NOT_TRAINABLE:
            return self._failure_result(
                "; ".join(validation.reasons),
                validation=validation,
            )
        if validation.status == HazardStatus.PARTIAL:
            for w in validation.warnings:
                logger.warning(f"  PARTIAL: {w}")

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

        # Step 6b: check that val and test folds each contain positive samples.
        # A test fold with 0 positives makes evaluation completely meaningless —
        # the model looks perfect on accuracy alone by always predicting 0.
        # This is a hard block because no valid ROC-AUC or F1 can be reported.
        validation = self.validator.validate_splits(
            validation, y_train, y_val, y_test,
            allow_sparse_test=getattr(cfg, "allow_sparse_test", False),
        )
        if validation.status == HazardStatus.NOT_TRAINABLE:
            return self._failure_result(
                "; ".join(validation.reasons),
                validation=validation,
            )
        if validation.status == HazardStatus.PARTIAL:
            for w in validation.warnings:
                logger.warning(f"  PARTIAL: {w}")
        logger.info("Step 7/8: Training candidate models...")
        best_model, search_results = self._train_candidates(
            X_train, y_train, X_val, y_val
        )
        logger.success(f"  Best model: {search_results['chosen_model']}")

        # Step 7a-b: Auto-flip detection — if CV AUC is good but val AUC is inverted,
        # wrap the model to flip scores before Platt calibration.
        # This handles temporal label-pattern mismatch (e.g. post-event clear-weather
        # periods labeled positive → model learns inverted rainfall-risk signal).
        chosen_cv_auc  = search_results.get("chosen_cv_auc") or 0.0
        chosen_val_auc = search_results.get("chosen_val_auc") or 0.5
        if chosen_cv_auc > 0.55 and chosen_val_auc < 0.48:
            logger.warning(
                f"  SCORE INVERSION DETECTED: CV AUC={chosen_cv_auc:.3f} vs val AUC="
                f"{chosen_val_auc:.3f}.  Wrapping model with InvertedScoreWrapper "
                f"(1 - P(y=1)).  Likely cause: temporal label-pattern mismatch."
            )
            best_model = InvertedScoreWrapper(best_model)
            search_results["score_inverted"] = True
            search_results["inversion_reason"] = (
                f"CV AUC={chosen_cv_auc:.3f} > 0.55 but val AUC={chosen_val_auc:.3f} < 0.48"
            )
        else:
            search_results["score_inverted"] = False

        # Step 7b: Platt (sigmoid) calibration + F2-optimal threshold on val set.
        # Calibration corrects predicted probabilities so P(y=1|score) is
        # reliable — important for threshold selection and downstream risk scoring.
        # Rules:
        #   - calibrate on val set ONLY (held-out; not seen during training)
        #   - use sigmoid/Platt (not isotonic) because isotonic overfits for
        #     rare-event hazards with few positive val samples (see Niculescu-
        #     Mizil & Caruana, 2005)
        #   - derive operational threshold via F2-score optimisation on val set
        #     with a minimum recall floor of 0.40 (UN SENDAI-aligned)
        calibrated_model, optimal_threshold, calibration_notes = (
            self._calibrate_model(best_model, X_val, y_val, X_train, y_train)
        )
        search_results["calibration"] = calibration_notes

        # 8. Evaluate — use calibrated model with optimal threshold on test set.
        # Pass best_model as base_model so SHAP uses the raw tree (not the
        # calibration wrapper which TreeExplainer cannot introspect).
        logger.info("Step 8/8: Full evaluation...")
        test_metrics = self.evaluator.full_evaluation(
            calibrated_model, X_test, y_test, available_cols,
            threshold=optimal_threshold,
            base_model=best_model,
        )

        # Temporal stability — use the exact test start index from the split,
        # not a hardcoded 85% boundary (which is wrong in fixed-date mode and
        # proportional mode with positive-count adjustments).
        ts_test = None
        if timestamps is not None:
            test_start = splits.get("test_start_idx", int(len(timestamps) * 0.85))
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
                available_cols, relevant_events,
                optimal_threshold=optimal_threshold,
            )

        elapsed = time.time() - t0

        # Promotion decision
        promotion = self._promotion_decision(test_metrics, stability, backtest, cfg)

        # Save artifacts
        version = datetime.utcnow().strftime("v%Y.%m.%d.%H%M%S")
        output_dir = REGISTRY_ROOT / f"{cfg.hazard_type}_{self.region_id}_{version}"
        output_dir.mkdir(parents=True, exist_ok=True)

        # model.pkl — save calibrated model as the primary artifact so
        # inference always uses well-calibrated probabilities.
        # raw_model.pkl preserved separately for diagnostic/comparison use.
        joblib.dump(calibrated_model, output_dir / "model.pkl")
        joblib.dump(best_model, output_dir / "raw_model.pkl")

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
            "region_scope": cfg.region_scope,
            "label_source": cfg.label_source,
            "data_validity": cfg.data_validity,
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
            # Calibration and operational threshold
            # optimal_threshold: use this (not 0.5) when converting probability
            # scores to binary alert decisions.  Derived via cost-based sweep
            # on val set (FN_WEIGHT=10: missing a real event costs 10x a false
            # alarm).  Always evaluate on test set — threshold NEVER sees test.
            "optimal_threshold": optimal_threshold,
            "calibration": calibration_notes,
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
        # Replace the previously hardcoded leakage_checks_passed=True with
        # the actual result from the validator so the report reflects reality.
        quality_report["leakage_checks_passed"] = validation.label_integrity == "clean"
        quality_report["label_integrity"] = validation.label_integrity
        quality_report["leakage_severity"] = validation.leakage_severity.value
        quality_report["tainted_columns"] = validation.tainted_columns
        quality_report["validation_reasons"] = validation.reasons
        quality_report["validation_warnings"] = validation.warnings
        with open(output_dir / "data_quality_report.json", "w") as f:
            json.dump(quality_report, f, indent=2, default=str)

        logger.success(f"Artifacts saved to {output_dir}")
        logger.info(f"Promotion status: {promotion['status']}")
        logger.info(f"ROC-AUC: {test_metrics.get('roc_auc', 'N/A')}")
        logger.info(f"F1 positive: {test_metrics.get('f1_positive_class', 'N/A')}")

        result = {
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
            # Attach the validation so train_all.py can include it in the session report
            "validation": validation,
            "validation_status": validation.status.value,
        }

        # Post-train hook — subclasses override to append additional evaluations
        # (e.g. geographic holdout) without re-implementing the full pipeline.
        hook_extras = self.post_train_hook(
            calibrated_model=calibrated_model,
            dataset=dataset,
            feature_cols=available_cols,
            output_dir=output_dir,
        )
        if hook_extras:
            result.update(hook_extras)

        return result

    def post_train_hook(
        self,
        calibrated_model: Any,
        dataset: "pd.DataFrame",
        feature_cols: list,
        output_dir: "Path",
    ) -> dict:
        """Optional subclass override for post-training evaluations.

        Called after model artifacts are saved.  Return a dict of extra keys
        to merge into the pipeline result, or an empty dict.
        """
        return {}

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
            # To forecast what happens at T + lead_hours from features at T,
            # shift the label timestamps backward by lead_hours before merging.
            # After the merge, features[T] will align with labels[T + lead_hours],
            # giving the model genuine predictive separation from the label.
            lab["timestamp"] = lab["timestamp"] - pd.Timedelta(hours=cfg.lead_hours)

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
        """Chronological train/val/test split.

        Two modes:

        Fixed-date mode (preferred, PhD-grade):
            When HazardConfig.fixed_test_date is set, the test fold covers all
            samples from that date onwards — a completely held-out future period
            never seen during training or hyperparameter selection.  Train/val
            is split 85/15 within the pre-test-date window.
            This is the strongest temporal validation scheme because the test
            distribution is genuinely out-of-sample in calendar time.

        Proportional mode (fallback):
            When fixed_test_date is not set, uses 70/15/15 proportional split.
            For sparse-event hazards the default 70/15/15 split can leave the
            val and/or test fold with zero positive samples, making evaluation
            and hyperparameter selection meaningless.
            Fix strategy (applied in order, strict chronological order preserved):
              1. Ensure test fold (last 15%) has ≥5% of all positives (min 1).
                 Slide val/test boundary backward if needed.
              2. Ensure val fold (next 15%) has ≥5% of all positives (min 1).
                 Slide train/val boundary backward if needed.
              Both adjustments only move boundaries; no rows are shuffled.
        """
        n = len(y)
        n_pos_total = int(y.sum())
        min_fold_pos = max(1, int(n_pos_total * 0.05)) if n_pos_total > 0 else 0

        # --- Fixed-date mode ---
        fixed_test_date = getattr(self.HAZARD_CONFIG, "fixed_test_date", None)
        if fixed_test_date is not None and timestamps is not None and len(timestamps) == n:
            cutoff = pd.Timestamp(fixed_test_date)
            test_mask = pd.to_datetime(timestamps.values) >= cutoff
            test_start_idx = int(test_mask.argmax()) if test_mask.any() else n

            if test_start_idx == 0:
                logger.warning(
                    "fixed_test_date={} is before all data; falling back to 70/15/15",
                    fixed_test_date,
                )
            elif (n - test_start_idx) < max(10, int(n * 0.05)):
                logger.warning(
                    "fixed_test_date={} leaves <5% data in test fold ({}); "
                    "falling back to 70/15/15",
                    fixed_test_date, n - test_start_idx,
                )
            else:
                # 85/15 split within the pre-test window for train/val
                pre_test_n = test_start_idx
                val_start_idx = int(pre_test_n * 0.85)

                n_test_pos = int(y[test_start_idx:].sum())
                n_val_pos  = int(y[val_start_idx:test_start_idx].sum())
                logger.info(
                    "Fixed-date split: train={} val={} test={} | "
                    "test_pos={} val_pos={} | test_cutoff={}",
                    val_start_idx, test_start_idx - val_start_idx,
                    n - test_start_idx, n_test_pos, n_val_pos, fixed_test_date,
                )

                if n_test_pos == 0:
                    logger.warning(
                        "Fixed test period [{}, end] has 0 positives — "
                        "falling back to 70/15/15 proportional split.",
                        fixed_test_date,
                    )
                else:
                    return {
                        "train": (X[:val_start_idx],            y[:val_start_idx]),
                        "val":   (X[val_start_idx:test_start_idx], y[val_start_idx:test_start_idx]),
                        "test":  (X[test_start_idx:],            y[test_start_idx:]),
                        "test_start_idx": test_start_idx,
                    }

        # --- Proportional mode (fallback / no fixed_test_date) ---
        train_end = int(n * 0.70)
        val_end   = int(n * 0.85)

        # Step 1 — ensure test fold has enough positives
        if min_fold_pos > 0 and int(y[val_end:].sum()) < min_fold_pos:
            adjusted = False
            for probe in range(val_end - 1, train_end, -1):
                if int(y[probe:].sum()) >= min_fold_pos:
                    logger.warning(
                        f"  Test fold had {int(y[val_end:].sum())} positives at default "
                        f"85% boundary. Adjusted to {probe/n*100:.1f}% "
                        f"→ {int(y[probe:].sum())} positives in test."
                    )
                    train_end = int(probe * 0.824)   # keep ~70% of adjusted boundary
                    val_end   = probe
                    adjusted  = True
                    break
            if not adjusted:
                logger.warning(
                    f"  Cannot find a test split with {min_fold_pos}+ positives. "
                    "Using default 70/15/15."
                )

        # Step 2 — ensure val fold has enough positives for hyperparameter tuning.
        # Slide train_end backward so more positives fall in [train_end:val_end].
        if min_fold_pos > 0 and int(y[train_end:val_end].sum()) < min_fold_pos:
            adjusted = False
            min_train_end = int(n * 0.30)   # never shrink train below 30%
            for probe in range(train_end - 1, min_train_end, -1):
                if int(y[probe:val_end].sum()) >= min_fold_pos:
                    logger.warning(
                        f"  Val fold had {int(y[train_end:val_end].sum())} positives. "
                        f"Adjusted train/val boundary to {probe/n*100:.1f}% "
                        f"→ {int(y[probe:val_end].sum())} positives in val."
                    )
                    train_end = probe
                    adjusted  = True
                    break
            if not adjusted:
                logger.warning(
                    f"  Cannot find a val split with {min_fold_pos}+ positives. "
                    "Hyperparameter selection may be unreliable."
                )

        return {
            "train": (X[:train_end], y[:train_end]),
            "val": (X[train_end:val_end], y[train_end:val_end]),
            "test": (X[val_end:], y[val_end:]),
            "test_start_idx": val_end,
        }

    def _train_candidates(
        self, X_train, y_train, X_val, y_val
    ) -> tuple[Any, dict]:
        """Train XGBoost, LightGBM, LogReg + stacking meta-learner.

        Scientific improvements over baseline:
          - Optuna TPE Bayesian hyperparameter search (Akiba et al., 2019) replacing
            RandomizedSearchCV uniform sampling.  Same trial budget, better regions.
          - Focal Loss objective (Lin et al., RetinaNet 2017) when imbalance > 50:1.
            FL(p) = -(1-p)^γ * log(p) down-weights easy negatives and forces the
            gradient signal onto hard boundary examples — directly addresses the
            precision collapse seen in heatwave/severe_storm/water_supply.
          - Stacking ensemble (Wolpert, 1992): logistic meta-learner trained on
            out-of-fold predicted probabilities from all base models.  Proven +1-3%
            AUC on tabular disaster prediction benchmarks.
          - PR-AUC as secondary selection metric alongside ROC-AUC for honest
            evaluation under extreme class imbalance (Davis & Goadrich, 2006).
        """
        import optuna
        import warnings as _warnings
        from sklearn.model_selection import TimeSeriesSplit, cross_val_predict
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import roc_auc_score, average_precision_score

        optuna.logging.set_verbosity(optuna.logging.WARNING)

        n_neg = (y_train == 0).sum()
        n_pos = max((y_train == 1).sum(), 1)
        scale_pos_weight = n_neg / n_pos
        # Use focal loss when imbalance is severe (>50:1) — Lin et al. 2017
        use_focal = scale_pos_weight > 50.0

        lead_h = getattr(self.HAZARD_CONFIG, "lead_hours", 6)
        cv_gap = max(lead_h, 24)
        tscv = TimeSeriesSplit(n_splits=5, gap=cv_gap)

        X_tr = np.ascontiguousarray(X_train, dtype=np.float32)
        X_v  = np.ascontiguousarray(X_val,   dtype=np.float32)
        y_tr = np.asarray(y_train).ravel()
        y_v  = np.asarray(y_val).ravel()

        candidates = {}

        # ── XGBoost — Optuna TPE search ──────────────────────────────────────
        try:
            import xgboost as xgb

            _xgb_device = "cpu"
            try:
                _probe = xgb.XGBClassifier(n_estimators=1, device="cuda", n_jobs=1)
                _probe.fit(X_tr[:50], y_tr[:50])
                _xgb_device = "cuda"
                logger.info("  XGBoost: CUDA GPU available — using GPU acceleration")
            except Exception:
                logger.info("  XGBoost: CUDA unavailable — falling back to CPU")

            def _xgb_objective(trial: optuna.Trial) -> float:
                params = dict(
                    n_estimators      = trial.suggest_int("n_estimators", 100, 600, step=100),
                    max_depth         = trial.suggest_int("max_depth", 3, 10),
                    learning_rate     = trial.suggest_float("learning_rate", 0.005, 0.2, log=True),
                    subsample         = trial.suggest_float("subsample", 0.6, 1.0),
                    colsample_bytree  = trial.suggest_float("colsample_bytree", 0.6, 1.0),
                    min_child_weight  = trial.suggest_int("min_child_weight", 1, 10),
                    reg_alpha         = trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True),
                    reg_lambda        = trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True),
                    gamma             = trial.suggest_float("gamma", 0.0, 2.0),
                    scale_pos_weight  = scale_pos_weight,
                    eval_metric       = "logloss",
                    random_state      = 42,
                    device            = _xgb_device,
                    n_jobs            = 1,
                )
                # Focal loss as custom objective when imbalance > 50:1
                if use_focal:
                    gamma_fl = trial.suggest_float("focal_gamma", 0.5, 3.0)
                    # XGBoost sklearn API calls obj(y_true, y_pred) — NOT obj(y_pred, dtrain)
                    def _focal_obj(y_true, y_pred):
                        p = 1.0 / (1.0 + np.exp(-y_pred))
                        fl_weight = (1.0 - p) ** gamma_fl
                        grad = fl_weight * (p - y_true) - gamma_fl * (1.0 - p) ** (gamma_fl - 1) * p * (p - y_true) * np.log(np.clip(1.0 - p, 1e-7, 1.0))
                        hess = fl_weight * p * (1.0 - p)
                        return grad, hess
                    params.pop("eval_metric", None)
                    m = xgb.XGBClassifier(**params)
                    m.set_params(objective=_focal_obj)
                else:
                    m = xgb.XGBClassifier(**params)
                aucs = []
                with _warnings.catch_warnings():
                    _warnings.filterwarnings("ignore")
                    for tr_idx, vl_idx in tscv.split(X_tr):
                        m.fit(X_tr[tr_idx], y_tr[tr_idx])
                        if len(np.unique(y_tr[vl_idx])) < 2:
                            aucs.append(0.5)
                        else:
                            proba = m.predict_proba(X_tr[vl_idx])
                            p = proba[:, 1] if proba.ndim == 2 else 1.0 / (1.0 + np.exp(-proba))
                            aucs.append(roc_auc_score(y_tr[vl_idx], p))
                return float(np.mean(aucs))

            xgb_study = optuna.create_study(direction="maximize",
                                            sampler=optuna.samplers.TPESampler(seed=42))
            with _warnings.catch_warnings():
                _warnings.filterwarnings("ignore")
                xgb_study.optimize(_xgb_objective, n_trials=40, show_progress_bar=False)

            best_xgb_p = xgb_study.best_params.copy()
            focal_gamma = best_xgb_p.pop("focal_gamma", None)
            best_xgb_p.update({"scale_pos_weight": scale_pos_weight, "eval_metric": "logloss",
                                "random_state": 42, "device": _xgb_device, "n_jobs": 1})
            xgb_best = xgb.XGBClassifier(**best_xgb_p)
            if use_focal and focal_gamma is not None:
                xgb_best.set_params(objective=_XGBFocalObjective(focal_gamma))
            with _warnings.catch_warnings():
                _warnings.filterwarnings("ignore")
                xgb_best.fit(X_tr, y_tr)
            xgb_val_auc = self._score_auc(xgb_best, X_v, y_v)
            if len(np.unique(y_v)) >= 2:
                _xgb_proba = xgb_best.predict_proba(X_v)
                _xgb_p1 = _xgb_proba[:, 1] if _xgb_proba.ndim == 2 else 1.0 / (1.0 + np.exp(-_xgb_proba))
                xgb_val_prauc = average_precision_score(y_v, _xgb_p1)
            else:
                xgb_val_prauc = 0.0
            candidates["xgboost"] = {
                "model": xgb_best,
                "val_auc": xgb_val_auc,
                "val_prauc": xgb_val_prauc,
                "cv_auc": xgb_study.best_value,
                "best_params": xgb_study.best_params,
            }
            logger.info(f"  XGBoost val AUC: {xgb_val_auc:.4f}  PR-AUC: {xgb_val_prauc:.4f}"
                        + (f"  [focal γ={focal_gamma:.2f}]" if use_focal and focal_gamma else ""))
        except Exception as e:
            logger.warning(f"  XGBoost training failed: {e}")

        # ── LightGBM — Optuna TPE search ─────────────────────────────────────
        try:
            import lightgbm as lgb

            _lgb_device = "cpu"
            try:
                _probe = lgb.LGBMClassifier(n_estimators=1, device="gpu", n_jobs=1, verbose=-1)
                _probe.fit(X_tr[:50], y_tr[:50])
                _lgb_device = "gpu"
                logger.info("  LightGBM: GPU available — using GPU acceleration")
            except Exception:
                logger.info("  LightGBM: GPU unavailable — falling back to CPU")

            def _lgb_objective(trial: optuna.Trial) -> float:
                params = dict(
                    n_estimators      = trial.suggest_int("n_estimators", 100, 600, step=100),
                    max_depth         = trial.suggest_int("max_depth", 3, 10),
                    learning_rate     = trial.suggest_float("learning_rate", 0.005, 0.2, log=True),
                    subsample         = trial.suggest_float("subsample", 0.6, 1.0),
                    colsample_bytree  = trial.suggest_float("colsample_bytree", 0.6, 1.0),
                    min_child_weight  = trial.suggest_int("min_child_weight", 1, 10),
                    min_split_gain    = trial.suggest_float("min_split_gain", 0.0, 0.5),
                    reg_alpha         = trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True),
                    reg_lambda        = trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True),
                    num_leaves        = trial.suggest_int("num_leaves", 20, 150),
                    # Always binary objective — LightGBM custom objectives break predict_proba.
                    # Use scale_pos_weight + is_unbalance for imbalance handling instead.
                    objective         = "binary",
                    scale_pos_weight  = scale_pos_weight,
                    random_state      = 42,
                    device            = _lgb_device,
                    n_jobs            = 1,
                    verbose           = -1,
                )
                m = lgb.LGBMClassifier(**params)
                aucs = []
                with _warnings.catch_warnings():
                    _warnings.filterwarnings("ignore")
                    for tr_idx, vl_idx in tscv.split(X_tr):
                        m.fit(X_tr[tr_idx], y_tr[tr_idx])
                        if len(np.unique(y_tr[vl_idx])) < 2:
                            aucs.append(0.5)
                        else:
                            _lp = m.predict_proba(X_tr[vl_idx])
                            p = _lp[:, 1] if _lp.ndim == 2 else 1.0 / (1.0 + np.exp(-_lp))
                            aucs.append(roc_auc_score(y_tr[vl_idx], p))
                return float(np.mean(aucs))

            lgb_study = optuna.create_study(direction="maximize",
                                            sampler=optuna.samplers.TPESampler(seed=42))
            with _warnings.catch_warnings():
                _warnings.filterwarnings("ignore")
                lgb_study.optimize(_lgb_objective, n_trials=40, show_progress_bar=False)

            best_lgb_p = lgb_study.best_params.copy()
            best_lgb_p.update({"objective": "binary", "scale_pos_weight": scale_pos_weight,
                                "random_state": 42, "device": _lgb_device, "n_jobs": 1, "verbose": -1})
            lgb_best = lgb.LGBMClassifier(**best_lgb_p)
            with _warnings.catch_warnings():
                _warnings.filterwarnings("ignore")
                lgb_best.fit(X_tr, y_tr)
            lgb_val_auc = self._score_auc(lgb_best, X_v, y_v)
            with _warnings.catch_warnings():
                _warnings.filterwarnings("ignore")
                if len(np.unique(y_v)) >= 2:
                    _lgb_proba = lgb_best.predict_proba(X_v)
                    _lgb_p1 = _lgb_proba[:, 1] if _lgb_proba.ndim == 2 else 1.0 / (1.0 + np.exp(-_lgb_proba))
                    lgb_val_prauc = average_precision_score(y_v, _lgb_p1)
                else:
                    lgb_val_prauc = 0.0
            candidates["lightgbm"] = {
                "model": lgb_best,
                "val_auc": lgb_val_auc,
                "val_prauc": lgb_val_prauc,
                "cv_auc": lgb_study.best_value,
                "best_params": lgb_study.best_params,
            }
            logger.info(f"  LightGBM val AUC: {lgb_val_auc:.4f}  PR-AUC: {lgb_val_prauc:.4f}"
                        + (f"  [scale_pos_weight={scale_pos_weight:.1f}]" if use_focal else ""))
        except Exception as e:
            logger.warning(f"  LightGBM training failed: {e}")

        # ── Logistic Regression — scaled baseline ─────────────────────────────
        try:
            from sklearn.preprocessing import StandardScaler
            from sklearn.pipeline import Pipeline
            from sklearn.model_selection import cross_val_score

            lr = Pipeline([
                ("scaler", StandardScaler()),
                ("lr", LogisticRegression(
                    max_iter=2000, solver="saga", C=0.1,
                    class_weight={0: 1.0, 1: scale_pos_weight}, random_state=42,
                )),
            ])
            with _warnings.catch_warnings():
                _warnings.filterwarnings("ignore")
                _lr_cv = cross_val_score(lr, X_tr, y_tr, cv=tscv,
                                         scoring="roc_auc", n_jobs=1, error_score=0.0)
            lr_cv_auc = float(_lr_cv.mean()) if len(_lr_cv) > 0 else None
            lr.fit(X_tr, y_tr)
            lr_val_auc = self._score_auc(lr, X_v, y_v)
            lr_val_prauc = average_precision_score(y_v, lr.predict_proba(X_v)[:, 1]) if len(np.unique(y_v)) >= 2 else 0.0
            candidates["logistic_regression"] = {
                "model": lr,
                "val_auc": lr_val_auc,
                "val_prauc": lr_val_prauc,
                "cv_auc": lr_cv_auc,
                "best_params": {"C": 0.1, "solver": "saga"},
            }
            logger.info(f"  LogReg val AUC: {lr_val_auc:.4f}  PR-AUC: {lr_val_prauc:.4f}")
        except Exception as e:
            logger.warning(f"  LogisticRegression failed: {e}")

        if not candidates:
            raise RuntimeError("All candidate models failed to train")

        # ── Stacking ensemble — Wolpert (1992) ────────────────────────────────
        # Meta-learner trained on out-of-fold predicted probabilities from all
        # base models.  OOF predictions prevent the meta-learner from seeing
        # training labels directly (no leakage).  Provides +1-3% AUC on tabular
        # hazard benchmarks by learning optimal model blending weights.
        try:
            if len(candidates) >= 2:
                oof_cols = {}
                # Use no-gap CV for stacking OOF — cross_val_predict requires
                # all samples covered; TimeSeriesSplit with gap leaves gaps uncovered
                tscv_oof = TimeSeriesSplit(n_splits=5)
                with _warnings.catch_warnings():
                    _warnings.filterwarnings("ignore")
                    for name, cand in candidates.items():
                        m = cand["model"]
                        try:
                            _oof = cross_val_predict(m, X_tr, y_tr, cv=tscv_oof,
                                                     method="predict_proba", n_jobs=1)
                            _oof_s = _oof[:, 1] if _oof.ndim == 2 else _oof.ravel()
                            if _oof_s.min() < 0.0 or _oof_s.max() > 1.0:
                                _oof_s = 1.0 / (1.0 + np.exp(-_oof_s))
                            oof_cols[name] = _oof_s
                        except Exception as _oof_err:
                            logger.warning(f"  Stacking OOF for {name} skipped ({type(_oof_err).__name__})")

                oof_X = np.column_stack(list(oof_cols.values()))
                meta = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
                meta.fit(oof_X, y_tr)

                # Val predictions for stacking
                val_cols = []
                for name, cand in candidates.items():
                    with _warnings.catch_warnings():
                        _warnings.filterwarnings("ignore")
                        _vp = cand["model"].predict_proba(X_v)
                        _vs = _vp[:, 1] if _vp.ndim == 2 else _vp.ravel()
                        if _vs.min() < 0.0 or _vs.max() > 1.0:
                            _vs = 1.0 / (1.0 + np.exp(-_vs))
                        val_cols.append(_vs)
                val_meta_X = np.column_stack(val_cols)
                stack_val_auc = self._score_auc(meta, val_meta_X, y_v)
                stack_cv_auc = float(np.mean([
                    roc_auc_score(y_tr[vl], meta.predict_proba(oof_X[vl])[:, 1])
                    if len(np.unique(y_tr[vl])) >= 2 else 0.5
                    for _, vl in tscv.split(X_tr)
                ]))
                stack_val_prauc = average_precision_score(y_v, meta.predict_proba(val_meta_X)[:, 1]) if len(np.unique(y_v)) >= 2 else 0.0

                # _StackModel is defined at module level (picklable)

                stack_model = _StackModel(
                    {k: v["model"] for k, v in candidates.items()}, meta
                )
                candidates["stacking"] = {
                    "model": stack_model,
                    "val_auc": stack_val_auc,
                    "val_prauc": stack_val_prauc,
                    "cv_auc": stack_cv_auc,
                    "best_params": {"meta": "LogisticRegression", "bases": list(candidates.keys())},
                }
                logger.info(f"  Stacking val AUC: {stack_val_auc:.4f}  PR-AUC: {stack_val_prauc:.4f}")
        except Exception as e:
            logger.warning(f"  Stacking ensemble failed (non-fatal): {e}")

        # ── Model selection: CV-AUC primary, val PR-AUC tiebreaker ───────────
        # PR-AUC (average precision) is more informative than ROC-AUC under
        # extreme class imbalance (Davis & Goadrich, 2006) — used as tiebreaker.
        def _model_score(k: str) -> tuple:
            cv = candidates[k].get("cv_auc")
            val = candidates[k]["val_auc"]
            prauc = candidates[k].get("val_prauc", 0.0)
            cv_valid = float(cv) if (cv is not None and cv > 0.0) else -1.0
            return (cv_valid, val, prauc)

        best_name = max(candidates, key=_model_score)
        best = candidates[best_name]
        _cv = best.get('cv_auc')
        _cv_str = f"{_cv:.4f}" if isinstance(_cv, float) else "N/A"
        logger.success(f"  Best model: {best_name} (cv_auc={_cv_str}, val_prauc={best.get('val_prauc',0.0):.4f})")

        search_results = {
            "chosen_model": best_name,
            "chosen_val_auc": best["val_auc"],
            "chosen_val_prauc": best.get("val_prauc", 0.0),
            "chosen_cv_auc": best.get("cv_auc"),
            "chosen_params": best["best_params"],
            "focal_loss_used": use_focal,
            "imbalance_ratio": f"{n_neg}:{n_pos}",
            "scale_pos_weight": scale_pos_weight,
            "candidates": {
                k: {"val_auc": v["val_auc"], "val_prauc": v.get("val_prauc", 0.0),
                    "cv_auc": v.get("cv_auc"), "params": v["best_params"]}
                for k, v in candidates.items()
            },
        }

        return best["model"], search_results

    def _calibrate_model(
        self,
        model: Any,
        X_val: np.ndarray,
        y_val: np.ndarray,
        X_train_fallback: "np.ndarray | None" = None,
        y_train_fallback: "np.ndarray | None" = None,
    ) -> tuple[Any, float, dict]:
        """Apply Platt (sigmoid) calibration and find the F2-optimal threshold.

        Calibration is performed on the val set (held-out from training).
        When val contains only one class (common for sparse hazards like power_outage
        where the fixed-date split produces an all-negative val period), calibration
        and threshold optimisation fall back to a subsample of the train set.
        The test set is NEVER used here.

        Why Platt/sigmoid over isotonic:
          Isotonic regression uses a non-parametric step function that can
          overfit when the number of positive validation samples is small
          (Niculescu-Mizil & Caruana, ICML 2005).  Sigmoid calibration fits
          only two parameters and is robust for rare-event hazards.

        Threshold selection — F2-score optimisation:
          Emergency hazard systems prioritise recall over precision: missing a
          real event (false negative) causes harm; a false alarm (false positive)
          costs responder effort but is recoverable.  We adopt the F-beta metric
          with beta=2 (recall weighted 4x precision) as the threshold objective,
          per Manning, Raghavan & Schütze (2008) §8.3 and the UN SENDAI framework
          recommendation for early-warning recall ≥ 0.60.

          Additionally, a minimum recall floor (MIN_RECALL=0.40) is enforced:
          a model that misses >60% of events is operationally unacceptable
          regardless of precision or AUC.

          Former cost-sweep approach (fn_weight=10) was systematically biased
          against catching positives for imbalance ratios > 10:1 — because
          cost(all-negative) = 10 * n_pos < cost(all-positive) = n_neg whenever
          n_neg / n_pos > 10, making the sweep always prefer predicting zero.
          This produced recall ≈ 0.01 for power_outage (200:1), severe_storm,
          and heatwave despite ROC-AUC > 0.90.  F2-optimisation is immune to
          this bias because it never assigns zero cost to a zero-recall solution.
        """
        from sklearn.calibration import CalibratedClassifierCV
        from sklearn.metrics import precision_recall_curve
        import numpy as np

        notes: dict = {
            "method": "platt_sigmoid_f2_threshold",
            "threshold_strategy": "f2_optimised_min_recall_0.40",
            "n_val_samples": int(len(y_val)),
            "n_val_positives": int(y_val.sum()),
        }

        X_arr = np.asarray(X_val)
        y_arr = np.asarray(y_val).ravel()

        # --- Single-class val fallback ---
        # When val has only one class (e.g. power_outage with a fixed-date split
        # that lands in an all-negative period), calibration and threshold optimisation
        # both become undefined on val.  Fall back to a stratified subsample of the
        # train set so we still get a meaningful threshold.
        val_has_two_classes = len(np.unique(y_arr)) >= 2
        if not val_has_two_classes and X_train_fallback is not None and y_train_fallback is not None:
            logger.warning(
                "  Val set is single-class (n_pos={}); falling back to train subsample "
                "for calibration + threshold optimisation.",
                int(np.asarray(y_val).sum()),
            )
            y_fb = np.asarray(y_train_fallback).ravel()
            X_fb = np.asarray(X_train_fallback)
            # Stratified subsample: cap at 80k to keep memory reasonable
            MAX_FB = 80_000
            if len(y_fb) > MAX_FB:
                rng = np.random.default_rng(42)
                pos_idx = np.where(y_fb == 1)[0]
                neg_idx = np.where(y_fb == 0)[0]
                n_pos = min(len(pos_idx), MAX_FB // 2)
                n_neg = min(len(neg_idx), MAX_FB - n_pos)
                idx = np.concatenate([
                    rng.choice(pos_idx, n_pos, replace=False),
                    rng.choice(neg_idx, n_neg, replace=False),
                ])
                X_fb, y_fb = X_fb[idx], y_fb[idx]
            X_arr, y_arr = X_fb, y_fb
            notes["calibration_fallback"] = "train_subsample"
            notes["n_val_samples"] = int(len(y_arr))
            notes["n_val_positives"] = int(y_arr.sum())

        # --- Calibration ---
        # Try sklearn CalibratedClassifierCV with cv="prefit" (sklearn < 1.6).
        # sklearn 1.6+ removed cv="prefit"; fall back to manual Platt sigmoid fit.
        calibrated = None
        try:
            cal = CalibratedClassifierCV(model, method="sigmoid", cv="prefit")
            cal.fit(X_arr, y_arr)
            calibrated = cal
            notes["calibration_applied"] = True
            notes["calibration_method"] = "CalibratedClassifierCV(cv='prefit')"
            logger.info("  Platt calibration applied on val set (sklearn prefit)")
        except Exception as e1:
            # Manual Platt calibration: fit logistic regression on raw model scores.
            # This is mathematically equivalent to Platt scaling and works across
            # all sklearn versions.
            try:
                from sklearn.linear_model import LogisticRegression as _LR

                if hasattr(model, "predict_proba"):
                    raw = model.predict_proba(X_arr)[:, 1]
                else:
                    raw = model.decision_function(X_arr)

                _platt = _LR(C=1e6, max_iter=1000, solver="lbfgs")
                _platt.fit(raw.reshape(-1, 1), y_arr)

                calibrated = PlattWrapper(model, _platt)
                notes["calibration_applied"] = True
                notes["calibration_method"] = "manual_platt_sigmoid"
                logger.info(
                    "  Manual Platt calibration applied on val set "
                    "(sklearn prefit workaround: {})", str(e1)[:80]
                )
            except Exception as e2:
                logger.warning(
                    f"  Calibration failed ({e1}; {e2}); using uncalibrated model"
                )
                calibrated = model
                notes["calibration_applied"] = False
                notes["calibration_method"] = "none"

        # --- Temperature Scaling — Guo et al. (NeurIPS 2017) ---
        # After Platt/sigmoid calibration, apply a single scalar temperature T
        # that rescales logits: p_cal = sigmoid(logit / T).
        # T > 1 softens overconfident predictions; T < 1 sharpens underconfident.
        # Single parameter = no overfitting risk.  Proven superior to Platt alone
        # on overconfident tree ensembles (Guo et al., 2017 Table 1).
        try:
            from scipy.optimize import minimize_scalar
            from sklearn.metrics import log_loss

            if hasattr(calibrated, "predict_proba") and len(np.unique(y_arr)) >= 2:
                raw_logits = calibrated.predict_proba(X_arr)[:, 1]
                raw_logits = np.clip(raw_logits, 1e-7, 1 - 1e-7)
                # Convert probabilities to logits
                logits = np.log(raw_logits / (1.0 - raw_logits))

                def _nll(T):
                    T = max(T, 0.01)
                    p = 1.0 / (1.0 + np.exp(-logits / T))
                    return log_loss(y_arr, p)

                res = minimize_scalar(_nll, bounds=(0.1, 10.0), method="bounded")
                T_opt = float(res.x)

                class _TempScaled:
                    """Wraps a calibrated model with temperature scaling."""
                    def __init__(self, base, T):
                        self._base = base
                        self.T = T
                    def predict_proba(self, X):
                        p = self._base.predict_proba(X)[:, 1]
                        p = np.clip(p, 1e-7, 1 - 1e-7)
                        logit = np.log(p / (1.0 - p))
                        p_scaled = 1.0 / (1.0 + np.exp(-logit / self.T))
                        return np.column_stack([1.0 - p_scaled, p_scaled])
                    def __getattr__(self, name):
                        return getattr(self._base, name)

                # Only adopt temperature scaling if it improves NLL
                nll_before = _nll(1.0)
                nll_after = _nll(T_opt)
                if nll_after < nll_before - 1e-4:
                    calibrated = _TempScaled(calibrated, T_opt)
                    notes["temperature_scaling_T"] = round(T_opt, 4)
                    notes["temperature_scaling_nll_improvement"] = round(nll_before - nll_after, 6)
                    logger.info(f"  Temperature scaling: T={T_opt:.4f} NLL {nll_before:.4f}→{nll_after:.4f}")
                else:
                    notes["temperature_scaling_T"] = 1.0
                    logger.info(f"  Temperature scaling: T={T_opt:.4f} — no NLL improvement, skipped")
        except Exception as _ts_exc:
            logger.debug(f"  Temperature scaling skipped: {_ts_exc}")

        # --- Validate calibration improves probability reliability (Brier score) ---
        # Brier score = mean squared error of predicted probabilities vs true labels.
        # Lower is better. If calibration degrades Brier, log a warning.
        try:
            from sklearn.metrics import brier_score_loss
            if len(np.unique(y_arr)) >= 2:
                if hasattr(model, "predict_proba"):
                    raw_probs_val = model.predict_proba(X_arr)[:, 1]
                else:
                    raw_probs_val = np.clip(model.decision_function(X_arr), 0.0, 1.0)
                brier_raw = brier_score_loss(y_arr, raw_probs_val)
                if hasattr(calibrated, "predict_proba"):
                    cal_probs_val = calibrated.predict_proba(X_arr)[:, 1]
                else:
                    cal_probs_val = raw_probs_val
                brier_cal = brier_score_loss(y_arr, cal_probs_val)
                notes["brier_raw_val"] = round(float(brier_raw), 6)
                notes["brier_calibrated_val"] = round(float(brier_cal), 6)
                notes["brier_improvement"] = round(float(brier_raw - brier_cal), 6)
                if brier_cal > brier_raw + 0.005:
                    logger.warning(
                        "  Calibration degraded Brier score on val set: "
                        f"raw={brier_raw:.4f} → calibrated={brier_cal:.4f}. "
                        "Falling back to uncalibrated model."
                    )
                    calibrated = model
                    notes["calibration_applied"] = False
                    notes["calibration_method"] = "reverted_brier_degraded"
                else:
                    logger.info(
                        f"  Brier score: raw={brier_raw:.4f} → calibrated={brier_cal:.4f} "
                        f"(improvement={brier_raw - brier_cal:+.4f})"
                    )
        except Exception as _brier_exc:
            logger.debug(f"  Brier validation skipped: {_brier_exc}")

        # --- F2-optimal threshold from val set PR curve ---
        # Two-pass strategy:
        #   Pass 1: Find threshold t* that maximises F2 on the val PR curve.
        #           F2 = (1 + 4) * P * R / (4P + R) — recall weighted 4x precision.
        #   Pass 2: Enforce MIN_RECALL floor.  If t* gives recall < MIN_RECALL,
        #           lower the threshold to the highest value that still meets the floor.
        #           This prevents settling at a high-precision/near-zero-recall point
        #           (operationally unacceptable for emergency systems).
        #
        # Both passes use calibrated-model probabilities so the threshold lives in
        # calibrated probability space — directly interpretable as P(hazard event).
        BETA = 2.0           # F-beta: recall weighted BETA² = 4x precision
        MIN_RECALL = self.get_calibration_min_recall()  # per-hazard recall floor (default 0.40)
        BETA2 = BETA ** 2

        optimal_threshold = 0.5  # fallback
        try:
            if hasattr(calibrated, "predict_proba"):
                val_probs = calibrated.predict_proba(X_arr)[:, 1]
            else:
                val_probs = model.predict_proba(X_arr)[:, 1]

            if len(np.unique(y_arr)) >= 2:
                precisions, recalls, thresholds = precision_recall_curve(y_arr, val_probs)

                # Pass 1: maximise F-beta across all PR-curve operating points.
                best_fbeta = -1.0
                best_t = float(thresholds[0]) if len(thresholds) > 0 else 0.5
                best_rec_at_t = 0.0

                for prec, rec, t in zip(precisions[:-1], recalls[:-1], thresholds):
                    denom = BETA2 * prec + rec
                    fbeta = (1.0 + BETA2) * prec * rec / denom if denom > 0.0 else 0.0
                    if fbeta > best_fbeta:
                        best_fbeta = fbeta
                        best_t = float(t)
                        best_rec_at_t = float(rec)

                optimal_threshold = best_t

                # Pass 2: enforce minimum recall floor.
                if best_rec_at_t < MIN_RECALL and len(thresholds) > 0:
                    # Walk from high-recall end (low threshold) and find the highest
                    # threshold that still achieves MIN_RECALL.
                    floor_t = optimal_threshold
                    for rec, t in zip(recalls[:-1], thresholds):
                        if rec >= MIN_RECALL:
                            floor_t = float(t)
                            break  # PR curve sorted descending recall → first hit is highest t
                    if floor_t < optimal_threshold:
                        logger.warning(
                            f"  F2-optimal t={optimal_threshold:.4f} gives recall="
                            f"{best_rec_at_t:.3f} < MIN_RECALL={MIN_RECALL}. "
                            f"Lowering threshold to {floor_t:.4f} to meet recall floor."
                        )
                        optimal_threshold = floor_t

                notes["optimal_threshold"] = optimal_threshold
                notes["best_fbeta_val"] = round(float(best_fbeta), 4)
                notes["threshold_method"] = (
                    f"f{int(BETA)}_optimised_min_recall_{MIN_RECALL}"
                )
                logger.info(
                    f"  Optimal threshold: {optimal_threshold:.4f} "
                    f"(F{int(BETA)}={best_fbeta:.4f}, beta={BETA}, "
                    f"min_recall_floor={MIN_RECALL})"
                )
            else:
                notes["optimal_threshold"] = 0.5
                notes["threshold_method"] = "fallback_single_class_val"
        except Exception as e:
            logger.warning(f"  Threshold optimisation failed ({e}); using 0.5")
            optimal_threshold = 0.5
            notes["optimal_threshold"] = 0.5
            notes["threshold_method"] = "fallback_error"

        return calibrated, optimal_threshold, notes

    def _score_auc(self, model, X, y) -> float:
        from sklearn.metrics import roc_auc_score
        try:
            if hasattr(model, "predict_proba"):
                _p = model.predict_proba(X)
                probs = _p[:, 1] if _p.ndim == 2 else 1.0 / (1.0 + np.exp(-_p))
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
        """Apply promotion gates (UN SENDAI-aligned standard).

        Gates (all must pass for 'promoted' status):
          1. ROC-AUC ≥ promotion_min_roc_auc (default 0.70) — discriminability.
          2. recall_positive ≥ 0.35 — a model that misses >65% of real events is
             operationally unacceptable for any early-warning system.
          3. No temporal performance drift (drift_detected=False), unless
             allow_temporal_drift=True (global multi-hemisphere models only).
          4. No missed major backtested events.

        Gate 2 (minimum recall) is set to 0.35 rather than 0.40 (the val-set
        floor) to allow for the natural train→test distribution shift: if the
        model achieves recall=0.40 on val and generalises to 0.35 on test, it
        is still operationally useful and should be promoted rather than blocked.
        """
        reasons = []
        status = "candidate"

        roc_auc = metrics.get("roc_auc", 0.0)
        if roc_auc < cfg.promotion_min_roc_auc:
            reasons.append(f"ROC-AUC {roc_auc:.4f} < {cfg.promotion_min_roc_auc}")
            status = "rejected"

        # Minimum positive-class recall gate.
        # Rationale: high ROC-AUC with near-zero recall indicates the model is
        # ranking samples correctly but the operational threshold is far too high —
        # the system would never trigger an alert.  This gate catches that failure
        # mode independently of threshold choice.
        PROMO_MIN_RECALL = 0.35
        recall_positive = metrics.get("recall_positive", metrics.get("recall_macro", 0.0))
        if recall_positive < PROMO_MIN_RECALL:
            reasons.append(
                f"recall_positive {recall_positive:.4f} < {PROMO_MIN_RECALL} "
                "(minimum operational recall for hazard early-warning)"
            )
            status = "rejected"

        if stability.get("drift_detected"):
            if cfg.allow_temporal_drift:
                # Global/multi-hemisphere models span both hemispheres; their opposite
                # drought/storm seasonality produces apparent quarter-to-quarter "drift"
                # that is a statistical artefact of geography, not genuine degradation.
                # Record as an informational note — do NOT add to reasons (which blocks
                # the `not reasons` promotion gate) and do NOT set status = "rejected".
                logger.warning(
                    "Temporal drift detected for {} but allow_temporal_drift=True "
                    "(region_scope={}); recording as warning, not blocking promotion.",
                    cfg.hazard_type, cfg.region_scope,
                )
            else:
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

    def _failure_result(
        self,
        reason: str,
        quality_report: dict = None,
        validation: ValidationResult = None,
    ) -> dict:
        """Return a structured failure summary when training cannot proceed.

        Always returns a complete dict — no crashes, no silent exits. The
        validation object carries the human-readable reason and recommended
        fix so that session_report.py can surface them in the summary table.
        """
        logger.error(f"Training aborted: {reason}")
        return {
            "status": "failed",
            "hazard_type": self.HAZARD_CONFIG.hazard_type,
            "region_id": self.region_id,
            "error": reason,
            "quality_report": quality_report,
            "validation": validation,
            "validation_status": (
                validation.status.value
                if validation is not None
                else HazardStatus.NOT_TRAINABLE.value
            ),
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
