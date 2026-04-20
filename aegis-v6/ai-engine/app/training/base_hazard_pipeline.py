"""
Abstract base class for all synthetic-data hazard training pipelines.
Defines the train() interface, handles train/validation split, model
persistence via ModelRegistry, and evaluation metric logging. Each
train_HAZARD.py subclass overrides _build_features() and _build_model().

- Extended by ai-engine/app/training/train_*.py (synthetic data trainers)
- Complemented by base_real_pipeline.py for real-world data trainers
- Saves models via ai-engine/app/core/model_registry.py
- Training triggered by ai-engine/app/training/train_all.py
"""

from __future__ import annotations

import abc
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from loguru import logger
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    average_precision_score,
    brier_score_loss,
)
from sklearn.model_selection import train_test_split

try:
    import xgboost as xgb
    XGBOOST_AVAILABLE = True
except ImportError:
    xgb = None
    XGBOOST_AVAILABLE = False

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    shap = None
    SHAP_AVAILABLE = False

from .region_config import TrainingRegion, get_training_region

class BaseHazardPipeline(abc.ABC):
    """Abstract base for every hazard-specific training pipeline."""

    # Subclass MUST override these

    HAZARD_NAME: str = ""
    MODEL_TYPE_LABEL: str = "weakly_supervised"  # supervised | weakly_supervised | heuristic_model | experimental
    FEATURES: List[str] = []
    DATA_SOURCES: List[str] = ["open-meteo"]
    LABEL_STRATEGY: str = ""
    KNOWN_LIMITATIONS: str = ""

    # Defaults

    REGISTRY_ROOT = Path(__file__).resolve().parents[2] / "model_registry"
    TEST_SIZE = 0.20
    RANDOM_SEED = 42

    def __init__(self, region_id: str = "global"):
        self.region = get_training_region(region_id)
        self.model = None
        self.X_train: Optional[pd.DataFrame] = None
        self.X_val: Optional[pd.DataFrame] = None
        self.y_train: Optional[pd.Series] = None
        self.y_val: Optional[pd.Series] = None
        self.metrics: Dict[str, float] = {}
        self.shap_values: Optional[np.ndarray] = None
        self.feature_importance: Optional[Dict[str, float]] = None

    # Abstract hooks

    @abc.abstractmethod
    def ingest_data(self) -> pd.DataFrame:
        """Fetch raw data for the region.  Must return a DataFrame."""
        ...

    @abc.abstractmethod
    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        """Build feature matrix. Must include all columns listed in FEATURES."""
        ...

    @abc.abstractmethod
    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """
        Return a binary label Series aligned with df's index.
        MUST document the labelling strategy in LABEL_STRATEGY.
        """
        ...

    # Concrete pipeline steps

    def split_data(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Stratified train/val split."""
        self.X_train, self.X_val, self.y_train, self.y_val = train_test_split(
            X, y,
            test_size=self.TEST_SIZE,
            random_state=self.RANDOM_SEED,
            stratify=y if y.nunique() > 1 else None,
        )
        logger.info(
            f"Split: train={len(self.X_train)}, val={len(self.X_val)}, "
            f"pos_rate_train={self.y_train.mean():.3f}, "
            f"pos_rate_val={self.y_val.mean():.3f}"
        )

    def train_model(self, params: Optional[Dict[str, Any]] = None) -> Any:
        """Train XGBoost binary classifier (default)."""
        if not XGBOOST_AVAILABLE:
            raise RuntimeError("xgboost is required but not installed")

        default_params = {
            "objective": "binary:logistic",
            "eval_metric": "logloss",
            "max_depth": 6,
            "learning_rate": 0.1,
            "n_estimators": 200,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "min_child_weight": 3,
            "random_state": self.RANDOM_SEED,
            "use_label_encoder": False,
        }
        if params:
            default_params.update(params)

        n_estimators = default_params.pop("n_estimators", 200)
        self.model = xgb.XGBClassifier(n_estimators=n_estimators, **default_params)
        self.model.fit(
            self.X_train, self.y_train,
            eval_set=[(self.X_val, self.y_val)],
            verbose=False,
        )
        logger.info(f"XGBoost trained ({n_estimators} rounds)")
        return self.model

    def evaluate(self) -> Dict[str, float]:
        """Evaluate on validation set, compare vs rule-based baseline."""
        y_pred = self.model.predict(self.X_val)
        y_prob = self.model.predict_proba(self.X_val)[:, 1]

        unique_classes = np.unique(self.y_val)
        single_class = len(unique_classes) < 2

        self.metrics = {
            "accuracy": float(accuracy_score(self.y_val, y_pred)),
            "precision": float(precision_score(self.y_val, y_pred, zero_division=0)),
            "recall": float(recall_score(self.y_val, y_pred, zero_division=0)),
            "f1_score": float(f1_score(self.y_val, y_pred, zero_division=0)),
            "brier_score": float(brier_score_loss(self.y_val, y_prob)),
        }

        if not single_class:
            try:
                self.metrics["roc_auc"] = float(roc_auc_score(self.y_val, y_prob))
            except Exception:
                self.metrics["roc_auc"] = 0.5
            try:
                self.metrics["pr_auc"] = float(average_precision_score(self.y_val, y_prob))
            except Exception:
                self.metrics["pr_auc"] = 0.0
        else:
            self.metrics["roc_auc"] = 0.5
            self.metrics["pr_auc"] = float(self.y_val.mean())

        # Rule-based baseline: always predict majority class
        majority = int(self.y_val.mode().iloc[0])
        baseline_pred = np.full(len(self.y_val), majority)
        self.metrics["baseline_accuracy"] = float(accuracy_score(self.y_val, baseline_pred))
        self.metrics["baseline_f1"] = float(
            f1_score(self.y_val, baseline_pred, zero_division=0)
        )
        self.metrics["improvement_over_baseline_f1"] = round(
            self.metrics["f1_score"] - self.metrics["baseline_f1"], 4
        )

        logger.info(f"Metrics: {json.dumps({k: round(v, 4) for k, v in self.metrics.items()})}")
        return self.metrics

    def compute_shap(self) -> Optional[Dict[str, float]]:
        """Compute SHAP feature importance (global mean |SHAP|)."""
        if not SHAP_AVAILABLE or self.model is None:
            logger.warning("SHAP skipped (not available or no model)")
            return None

        try:
            explainer = shap.TreeExplainer(self.model)
            self.shap_values = explainer.shap_values(self.X_val)
            mean_abs = np.abs(self.shap_values).mean(axis=0)
            feature_names = list(self.X_val.columns)
            self.feature_importance = {
                feature_names[i]: round(float(mean_abs[i]), 6)
                for i in range(len(feature_names))
            }
            # Sort by importance
            self.feature_importance = dict(
                sorted(self.feature_importance.items(), key=lambda x: -x[1])
            )
            logger.info(f"SHAP top-3: {list(self.feature_importance.items())[:3]}")
            return self.feature_importance
        except Exception as exc:
            logger.warning(f"SHAP computation failed: {exc}")
            return None

    def save_model(self) -> Path:
        """Save model.pkl + metadata.json to model_registry/<hazard>/v1/."""
        version = f"v1_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        model_dir = self.REGISTRY_ROOT / self.HAZARD_NAME / "v1"
        model_dir.mkdir(parents=True, exist_ok=True)

        model_path = model_dir / "model.pkl"
        joblib.dump(self.model, model_path)

        metadata = {
            "hazard": self.HAZARD_NAME,
            "version": "v1",
            "version_tag": version,
            "model_type": self.MODEL_TYPE_LABEL,
            "algorithm": "xgboost",
            "features": self.FEATURES,
            "data_sources": self.DATA_SOURCES,
            "label_strategy": self.LABEL_STRATEGY,
            "date_range": f"{self.region.default_start} to {self.region.default_end}",
            "region": self.region.region_id,
            "metrics": self.metrics,
            "shap_feature_importance": self.feature_importance,
            "limitations": self.KNOWN_LIMITATIONS,
            "fallback": "rule_based",
            "trained_at": datetime.utcnow().isoformat(),
            "train_samples": len(self.X_train) if self.X_train is not None else 0,
            "val_samples": len(self.X_val) if self.X_val is not None else 0,
        }
        meta_path = model_dir / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, default=str)

        # Also write a registry-compatible version for ModelRegistry auto-discovery
        compat_dir = (
            self.REGISTRY_ROOT
            / f"{self.HAZARD_NAME}_{self.region.region_id}_v1"
        )
        compat_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, compat_dir / "model.pkl")

        compat_meta = {
            "name": f"{self.HAZARD_NAME}_xgboost",
            "version": "v1",
            "hazard_type": self.HAZARD_NAME,
            "region_id": self.region.region_id,
            "model_type": "xgboost",
            "trained_at": datetime.utcnow().isoformat(),
            "performance_metrics": self.metrics,
            "feature_names": self.FEATURES,
            # Extra transparency fields
            "model_type_label": self.MODEL_TYPE_LABEL,
            "label_strategy": self.LABEL_STRATEGY,
            "data_sources": self.DATA_SOURCES,
            "limitations": self.KNOWN_LIMITATIONS,
            "shap_feature_importance": self.feature_importance,
            "training_feature_means": {
                f: float(self.X_train[f].mean()) if f in self.X_train.columns else 0.0
                for f in self.FEATURES
            } if self.X_train is not None else {},
            "training_feature_stds": {
                f: float(self.X_train[f].std() or 0.0) if f in self.X_train.columns else 0.0
                for f in self.FEATURES
            } if self.X_train is not None else {},
            "class_balance": {
                "positive": int(self.y_train.sum()) if self.y_train is not None else 0,
                "negative": int(len(self.y_train) - self.y_train.sum()) if self.y_train is not None else 0,
                "positive_rate": float(self.y_train.mean()) if self.y_train is not None else 0.0,
            },
            "validation_confidence_stats": {
                "mean": float(self.metrics.get("confidence_mean", 0.0) or 0.0),
                "std": float(self.metrics.get("confidence_std", 0.0) or 0.0),
                "p05": float(self.metrics.get("confidence_p05", 0.0) or 0.0),
                "p50": float(self.metrics.get("confidence_p50", 0.0) or 0.0),
                "p95": float(self.metrics.get("confidence_p95", 0.0) or 0.0),
            },
            "reference_shap_importance_ranking": list((self.feature_importance or {}).keys())[:20],
            "baseline_prediction_distribution": {
                "positive_rate": float(self.y_train.mean()) if self.y_train is not None else 0.0,
            },
            "temporal_range": {
                "start": self.region.default_start,
                "end": self.region.default_end,
            },
        }
        with open(compat_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(compat_meta, f, indent=2, default=str)

        logger.success(f"Model saved: {model_dir}  +  {compat_dir}")
        return model_dir

    # Full pipeline runner

    def run(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the full pipeline: ingest -> features -> labels -> split -> train -> eval -> SHAP -> save."""
        logger.info(f"{'='*60}")
        logger.info(f"Training: {self.HAZARD_NAME}  region={self.region.region_id}")
        logger.info(f"Model type: {self.MODEL_TYPE_LABEL}")
        logger.info(f"Label strategy: {self.LABEL_STRATEGY}")
        logger.info(f"{'='*60}")

        # 1. Ingest
        raw = self.ingest_data()
        logger.info(f"Ingested {len(raw)} rows")

        # 2. Features
        features = self.engineer_features(raw)
        missing = set(self.FEATURES) - set(features.columns)
        if missing:
            raise ValueError(f"Missing features after engineering: {missing}")

        X = features[self.FEATURES].copy()

        # 3. Labels
        y = self.generate_labels(features)
        assert len(X) == len(y), "Feature/label length mismatch"

        # Drop NaNs
        mask = X.notna().all(axis=1) & y.notna()
        X, y = X[mask], y[mask]
        logger.info(f"After dropping NaNs: {len(X)} samples, pos_rate={y.mean():.3f}")

        if len(X) < 20:
            logger.warning(f"Very small dataset ({len(X)} samples) -- results unreliable")

        # 4. Split
        self.split_data(X, y)

        # 5. Train
        self.train_model(params)

        # 6. Evaluate
        self.evaluate()

        # 7. SHAP
        self.compute_shap()

        # 8. Save
        model_dir = self.save_model()

        return {
            "hazard": self.HAZARD_NAME,
            "region": self.region.region_id,
            "model_type": self.MODEL_TYPE_LABEL,
            "metrics": self.metrics,
            "shap_top5": dict(list((self.feature_importance or {}).items())[:5]),
            "model_dir": str(model_dir),
            "samples": len(X),
        }
