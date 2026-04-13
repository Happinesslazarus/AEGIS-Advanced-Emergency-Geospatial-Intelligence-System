"""
File: shap_explainer.py

What this file does:
Generates SHAP (SHapley Additive exPlanations) feature importance values
for any hazard prediction. Explains which weather or geographical features
drove the model to its risk score so responders can understand and trust
the prediction. Falls back gracefully if the shap package is unavailable.

How it connects:
- Called by all hazard predictors in ai-engine/app/hazards/
- SHAP values returned as part of PredictionResponse.shap_features
- shap package optionally installed (see ai-engine/requirements.txt)
- Explanation text surfaced in the Admin AI panel (client AdminPage.tsx)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from loguru import logger

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    shap = None
    SHAP_AVAILABLE = False
    logger.warning("SHAP not installed — explainability limited to metadata-based importance")

# Module-level cache: {id(model): TreeExplainer}
_explainer_cache: Dict[int, Any] = {}

def get_explainer(model: Any) -> Any:
    """Return a cached TreeExplainer for the given model."""
    if not SHAP_AVAILABLE:
        return None
    mid = id(model)
    if mid not in _explainer_cache:
        try:
            _explainer_cache[mid] = shap.TreeExplainer(model)
        except Exception as exc:
            logger.warning(f"Cannot create SHAP explainer: {exc}")
            return None
    return _explainer_cache[mid]

def explain_prediction(
    model: Any,
    feature_values: np.ndarray,
    feature_names: List[str],
    top_k: int = 5,
) -> Optional[Dict[str, Any]]:
    """
    Compute SHAP values for a single prediction and return a structured
    explanation dict suitable for the PredictionResponse.

    Args:
        model: Trained tree-based model (XGBoost, LightGBM, RandomForest)
        feature_values: 1-D or 2-D array (single sample)
        feature_names: Ordered list of feature names matching feature_values
        top_k: Number of top contributing features to return

    Returns:
        {
            "shap_values": {feature: shap_value, ...},   # all features
            "top_contributors": [                          # top-k sorted by |value|
                {"feature": ..., "shap_value": ..., "feature_value": ...},
                ...
            ],
            "base_value": float,
        }
        or None if SHAP is unavailable.
    """
    explainer = get_explainer(model)
    if explainer is None:
        return None

    try:
        fv = np.asarray(feature_values)
        if fv.ndim == 1:
            fv = fv.reshape(1, -1)

        sv = explainer.shap_values(fv, check_additivity=False)
        # shap >= 0.44 returns ndarray of shape (n_samples, n_features, n_classes)
        # older versions return a list [neg_class_arr, pos_class_arr]
        if isinstance(sv, np.ndarray) and sv.ndim == 3:
            sv = sv[0, :, 1]  # sample 0, all features, positive class
        elif isinstance(sv, list):
            sv = sv[1].flatten()  # positive class (old format)
        else:
            sv = sv.flatten()

        ev = explainer.expected_value
        if isinstance(ev, (list, np.ndarray)):
            ev_arr = np.asarray(ev).flatten()
            base_value = float(ev_arr[1]) if len(ev_arr) > 1 else float(ev_arr[0])
        else:
            base_value = float(ev)

        # Build full dict
        shap_dict = {
            feature_names[i]: round(float(sv[i]), 6)
            for i in range(min(len(feature_names), len(sv)))
        }

        # Top-k by absolute SHAP value
        sorted_idx = np.argsort(-np.abs(sv))[:top_k]
        top_contributors = [
            {
                "feature": feature_names[i] if i < len(feature_names) else f"feature_{i}",
                "shap_value": round(float(sv[i]), 6),
                "feature_value": round(float(fv[0, i]), 4) if i < fv.shape[1] else None,
            }
            for i in sorted_idx
        ]

        return {
            "shap_values": shap_dict,
            "top_contributors": top_contributors,
            "base_value": round(base_value, 6),
        }
    except Exception as exc:
        logger.warning(f"SHAP explanation failed: {exc}")
        return None

def get_metadata_importance(metadata: Any) -> Optional[Dict[str, float]]:
    """
    Fallback: return the pre-computed SHAP feature importance
    stored in model metadata (from training time).
    """
    if metadata is None:
        return None

    # Support both dict and object attribute access
    if hasattr(metadata, "performance_metrics"):
        metrics = metadata.performance_metrics
    elif isinstance(metadata, dict):
        metrics = metadata.get("performance_metrics", metadata)
    else:
        return None

    # Check for stored SHAP importance
    importance = None
    if isinstance(metrics, dict):
        importance = metrics.get("shap_feature_importance")
    if importance is None and hasattr(metadata, "__dict__"):
        importance = getattr(metadata, "shap_feature_importance", None)

    return importance
