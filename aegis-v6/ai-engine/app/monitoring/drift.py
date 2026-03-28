"""
AEGIS AI ENGINE - Drift utilities
Statistical helpers for feature and prediction drift scoring.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Tuple
import math

import numpy as np

def _safe_array(values: Iterable[float]) -> np.ndarray:
    arr = np.array([v for v in values if v is not None], dtype=float)
    if arr.size == 0:
        return np.array([], dtype=float)
    return arr[np.isfinite(arr)]

def population_stability_index(
    baseline_values: Iterable[float],
    current_values: Iterable[float],
    bins: int = 10,
) -> float:
    """Compute PSI between baseline and current numeric distributions."""
    baseline = _safe_array(baseline_values)
    current = _safe_array(current_values)
    if baseline.size < 2 or current.size < 2:
        return 0.0

    lo = float(min(baseline.min(), current.min()))
    hi = float(max(baseline.max(), current.max()))
    if lo == hi:
        return 0.0

    edges = np.linspace(lo, hi, bins + 1)
    b_hist, _ = np.histogram(baseline, bins=edges)
    c_hist, _ = np.histogram(current, bins=edges)

    b_ratio = np.clip(b_hist / max(1, baseline.size), 1e-6, 1.0)
    c_ratio = np.clip(c_hist / max(1, current.size), 1e-6, 1.0)

    psi = np.sum((c_ratio - b_ratio) * np.log(c_ratio / b_ratio))
    return float(max(0.0, psi))

def ks_statistic(baseline_values: Iterable[float], current_values: Iterable[float]) -> float:
    """Two-sample KS statistic (without p-value)."""
    baseline = np.sort(_safe_array(baseline_values))
    current = np.sort(_safe_array(current_values))
    if baseline.size < 2 or current.size < 2:
        return 0.0

    all_values = np.sort(np.concatenate([baseline, current]))
    b_cdf = np.searchsorted(baseline, all_values, side="right") / baseline.size
    c_cdf = np.searchsorted(current, all_values, side="right") / current.size
    return float(np.max(np.abs(b_cdf - c_cdf)))

def z_score_shift(
    baseline_mean: float,
    baseline_std: float,
    current_mean: float,
) -> float:
    """Absolute z-score shift of current mean vs baseline."""
    std = abs(float(baseline_std or 0.0))
    if std < 1e-9:
        return 0.0
    return float(abs((float(current_mean) - float(baseline_mean)) / std))

def normalized_rank_shift(
    baseline_rank: List[str],
    current_rank: List[str],
    top_k: int = 5,
) -> float:
    """Rank drift in top feature ordering, normalized to [0,1]."""
    if not baseline_rank or not current_rank:
        return 0.0

    b = baseline_rank[:top_k]
    c = current_rank[:top_k]
    universe = list(dict.fromkeys(b + c))
    if len(universe) <= 1:
        return 0.0

    b_pos = {name: idx for idx, name in enumerate(b)}
    c_pos = {name: idx for idx, name in enumerate(c)}
    fallback = top_k + 1

    total = 0.0
    max_total = 0.0
    for name in universe:
        bi = b_pos.get(name, fallback)
        ci = c_pos.get(name, fallback)
        total += abs(bi - ci)
        max_total += fallback

    if max_total <= 0:
        return 0.0
    return float(min(1.0, total / max_total))

def weighted_drift_score(components: Dict[str, Tuple[float, float]]) -> float:
    """Combine named (value, weight) components into normalized [0,1] score."""
    if not components:
        return 0.0

    numerator = 0.0
    denominator = 0.0
    for value, weight in components.values():
        w = max(0.0, float(weight))
        v = max(0.0, min(1.0, float(value)))
        numerator += v * w
        denominator += w

    if denominator <= 0:
        return 0.0
    return float(max(0.0, min(1.0, numerator / denominator)))

def drift_alert_level(score: float) -> str:
    """Map drift score to INFO/WARNING/CRITICAL."""
    s = float(score)
    if s >= 0.70:
        return "CRITICAL"
    if s >= 0.40:
        return "WARNING"
    if s >= 0.20:
        return "INFO"
    return "HEALTHY"
