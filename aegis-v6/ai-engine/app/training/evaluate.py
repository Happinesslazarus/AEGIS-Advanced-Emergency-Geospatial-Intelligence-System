"""
Comprehensive Model Evaluation for AEGIS Hazard Models.

Provides:
- ModelEvaluator: full evaluation suite, backtesting against known UK events,
  temporal stability analysis, and comparison against rule-based stubs.
- DataQualityReporter: data quality report generation and minimum-gate checks.

Used by all 11 hazard training scripts (flood, severe_storm, heatwave, wildfire,
landslide, power_outage, water_supply, infrastructure_damage, public_safety,
environmental_hazard, drought).
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd
from loguru import logger
from sklearn.calibration import calibration_curve
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    classification_report,
    confusion_matrix,
    f1_score,
    log_loss,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)

try:
    import shap

    SHAP_AVAILABLE = True
except ImportError:
    shap = None
    SHAP_AVAILABLE = False
    logger.warning("SHAP not installed -- SHAP feature importance will be skipped")

# Scottish / UK known events for backtesting

UK_KNOWN_EVENTS: list[dict] = [
    {
        "name": "Storm Arwen",
        "date": "2021-11-26",
        "lat": 55.95,
        "lon": -3.19,
        "hazard_types": ["severe_storm", "power_outage", "infrastructure_damage"],
        "expected_positive": True,
    },
    {
        "name": "Aberdeen Floods 2016",
        "date": "2016-01-07",
        "lat": 57.15,
        "lon": -2.09,
        "hazard_types": ["flood"],
        "expected_positive": True,
    },
    {
        "name": "Beast from the East",
        "date": "2018-02-28",
        "lat": 55.95,
        "lon": -3.19,
        "hazard_types": [
            "severe_storm",
            "infrastructure_damage",
            "power_outage",
            "public_safety_incident",
            "water_supply_disruption",
        ],
        "expected_positive": True,
    },
    {
        "name": "Scotland Heatwave 2022",
        "date": "2022-07-19",
        "lat": 55.95,
        "lon": -3.19,
        "hazard_types": ["heatwave", "wildfire", "environmental_hazard"],
        "expected_positive": True,
    },
    {
        "name": "Storm Babet 2023",
        "date": "2023-10-19",
        "lat": 56.46,
        "lon": -2.97,
        "hazard_types": ["severe_storm", "flood", "landslide", "power_outage"],
        "expected_positive": True,
    },
    {
        "name": "Calm Summer Day",
        "date": "2023-06-15",
        "lat": 55.95,
        "lon": -3.19,
        "hazard_types": ["flood", "severe_storm", "landslide"],
        "expected_positive": False,
    },
    {
        "name": "Mild Autumn Day",
        "date": "2022-10-10",
        "lat": 56.46,
        "lon": -2.97,
        "hazard_types": ["heatwave", "wildfire", "drought"],
        "expected_positive": False,
    },
]

# ModelEvaluator

class ModelEvaluator:
    """Comprehensive model evaluation for AEGIS hazard models.

    Encapsulates the full evaluation lifecycle:
    1. Classification metrics (accuracy, precision, recall, F1, AUC, Brier, log-loss)
    2. ROC / PR / calibration curves
    3. SHAP-based feature importance
    4. Backtesting against known Scottish/UK historical events
    5. Temporal stability analysis (quarterly drift detection)
    6. Head-to-head comparison against rule-based stubs
    """

    # 1. Full evaluation suite

    def full_evaluation(
        self,
        model: Any,
        X_test: pd.DataFrame | np.ndarray,
        y_test: pd.Series | np.ndarray,
        feature_names: list[str],
    ) -> dict:
        """Run the complete evaluation suite on a fitted model.

        Parameters
        model : sklearn-compatible estimator
            Must expose ``predict`` and ``predict_proba``.
        X_test : array-like of shape (n_samples, n_features)
            Test feature matrix.
        y_test : array-like of shape (n_samples,)
            True binary labels.
        feature_names : list[str]
            Feature column names (used for SHAP importance keys).

        Returns
        dict
            Keys:
            - accuracy, precision_macro, recall_macro, f1_macro
            - precision_positive, recall_positive, f1_positive_class
            - roc_auc, brier_score, log_loss
            - confusion_matrix (nested list)
            - classification_report (dict)
            - roc_curve: {fpr, tpr, thresholds}
            - pr_curve: {precision, recall, thresholds}
            - calibration_curve: {fraction_of_positives, mean_predicted_value}
            - shap_feature_importance: {feature: mean_abs_shap, ...} (top 20)
        """
        logger.info("Running full evaluation suite on {} test samples", len(y_test))

        X_arr = np.asarray(X_test)
        y_arr = np.asarray(y_test).ravel()

        y_pred = model.predict(X_arr)
        y_prob = self._get_positive_probs(model, X_arr)

        unique = np.unique(y_arr)
        single_class = len(unique) < 2

        results: dict[str, Any] = {}

        # scalar metrics
        results["accuracy"] = float(accuracy_score(y_arr, y_pred))
        results["precision_macro"] = float(
            precision_score(y_arr, y_pred, average="macro", zero_division=0)
        )
        results["recall_macro"] = float(
            recall_score(y_arr, y_pred, average="macro", zero_division=0)
        )
        results["f1_macro"] = float(
            f1_score(y_arr, y_pred, average="macro", zero_division=0)
        )
        results["precision_positive"] = float(
            precision_score(y_arr, y_pred, average="binary", zero_division=0)
        )
        results["recall_positive"] = float(
            recall_score(y_arr, y_pred, average="binary", zero_division=0)
        )
        results["f1_positive_class"] = float(
            f1_score(y_arr, y_pred, average="binary", zero_division=0)
        )

        # ROC AUC
        if single_class:
            results["roc_auc"] = 0.5
        else:
            try:
                results["roc_auc"] = float(roc_auc_score(y_arr, y_prob))
            except Exception as exc:
                logger.warning("ROC AUC computation failed: {}", exc)
                results["roc_auc"] = 0.0

        # Brier score
        results["brier_score"] = float(brier_score_loss(y_arr, y_prob))

        # Log loss
        y_prob_clipped = np.clip(y_prob, 1e-15, 1 - 1e-15)
        if single_class:
            results["log_loss"] = float(
                np.mean(
                    -np.log(np.where(y_arr == 1, y_prob_clipped, 1 - y_prob_clipped))
                )
            )
        else:
            results["log_loss"] = float(log_loss(y_arr, y_prob_clipped))

        # confusion matrix & classification report
        results["confusion_matrix"] = confusion_matrix(y_arr, y_pred).tolist()
        results["classification_report"] = classification_report(
            y_arr, y_pred, output_dict=True, zero_division=0
        )

        # curves
        results["roc_curve"] = self._safe_roc_curve(y_arr, y_prob, single_class)
        results["pr_curve"] = self._safe_pr_curve(y_arr, y_prob, single_class)
        results["calibration_curve"] = self._safe_calibration_curve(y_arr, y_prob)

        # SHAP feature importance (graceful fallback)
        results["shap_feature_importance"] = self._compute_shap_importance(
            model, X_arr, feature_names
        )

        logger.success(
            "Full evaluation complete: accuracy={:.4f}, f1_macro={:.4f}, roc_auc={:.4f}",
            results["accuracy"],
            results["f1_macro"],
            results["roc_auc"],
        )
        return results

    # 2. Backtest known events

    def backtest_known_events(
        self,
        model: Any,
        provider: Any,
        feature_engineer: Any,
        feature_names: list[str],
        known_events: list[dict],
    ) -> list[dict]:
        """Backtest model against known historical events.

        For each event, the *provider* fetches weather data around the event
        date/location and the *feature_engineer* builds the feature vector.
        The model then predicts whether the event would be flagged.

        Parameters
        model : sklearn-compatible estimator
            Fitted model with ``predict_proba``.
        provider :
            Object with a ``fetch_open_meteo_history(lat, lon, start, end)``
            or ``__call__(lat, lon, start, end)`` method returning a DataFrame.
        feature_engineer :
            Class or instance exposing ``compute_weather_features(df)`` (the
            ``FeatureEngineer`` from ``feature_engineering.py``).
        feature_names : list[str]
            Ordered feature names the model was trained on.
        known_events : list[dict]
            Each dict must have: name, date, lat, lon, hazard_types,
            expected_positive.

        Returns
        list[dict]
            Per-event results with keys: event_name, date,
            predicted_probability, predicted_positive, expected_positive,
            correct, error.
        """
        logger.info("Backtesting against {} known events", len(known_events))

        results: list[dict] = []
        for event in known_events:
            entry: dict[str, Any] = {
                "event_name": event["name"],
                "date": event["date"],
                "expected_positive": event["expected_positive"],
                "predicted_probability": None,
                "predicted_positive": None,
                "correct": None,
                "error": None,
            }
            try:
                # Build a 7-day window centred on the event for context
                event_date = pd.Timestamp(event["date"])
                start_date = (event_date - pd.Timedelta(days=3)).strftime("%Y-%m-%d")
                end_date = (event_date + pd.Timedelta(days=3)).strftime("%Y-%m-%d")

                # Fetch weather data via provider
                raw_df = self._fetch_event_data(
                    provider, event["lat"], event["lon"], start_date, end_date
                )

                if raw_df is None or raw_df.empty:
                    entry["error"] = "No data returned by provider"
                    results.append(entry)
                    continue

                # Engineer features
                features_df = self._engineer_event_features(
                    feature_engineer, raw_df
                )

                if features_df is None or features_df.empty:
                    entry["error"] = "Feature engineering returned empty result"
                    results.append(entry)
                    continue

                # Select the row closest to the event date
                event_features = self._select_event_row(
                    features_df, feature_names, event_date
                )

                if event_features is None:
                    entry["error"] = "Could not select feature row for event date"
                    results.append(entry)
                    continue

                # Predict
                prob = self._get_positive_probs(model, event_features)[0]
                predicted_positive = bool(prob >= 0.5)

                entry["predicted_probability"] = round(float(prob), 6)
                entry["predicted_positive"] = predicted_positive
                entry["correct"] = predicted_positive == event["expected_positive"]

            except Exception as exc:
                entry["error"] = str(exc)
                logger.warning(
                    "Backtest failed for '{}': {}", event["name"], exc
                )

            results.append(entry)

        n_correct = sum(1 for r in results if r["correct"] is True)
        n_total = len(results)
        n_errors = sum(1 for r in results if r["error"] is not None)
        logger.info(
            "Backtest complete: {}/{} correct, {} errors",
            n_correct,
            n_total - n_errors,
            n_errors,
        )
        return results

    # 3. Temporal stability analysis

    def temporal_stability(
        self,
        model: Any,
        X_test: pd.DataFrame | np.ndarray,
        y_test: pd.Series | np.ndarray,
        timestamps: pd.Series,
    ) -> dict:
        """Evaluate metric stability over time by quarter.

        Parameters
        model : sklearn-compatible estimator
            Fitted model with ``predict_proba``.
        X_test : array-like
            Test features.
        y_test : array-like
            True labels.
        timestamps : pd.Series
            Datetime series aligned with X_test/y_test rows.

        Returns
        dict
            Keys:
            - quarterly_metrics: {quarter_label: {roc_auc, f1, brier_score,
              n_samples, n_positive}}
            - drift_detected: bool (True if any quarter AUC < 80% of best)
            - overall_trend: "stable" | "improving" | "degrading"
        """
        logger.info("Running temporal stability analysis")

        X_arr = np.asarray(X_test)
        y_arr = np.asarray(y_test).ravel()
        ts = pd.to_datetime(timestamps).values

        # Assign quarters
        quarters = pd.PeriodIndex(ts, freq="Q")

        quarterly_metrics: dict[str, dict] = {}

        for quarter in sorted(quarters.unique()):
            mask = quarters == quarter
            n_samples = int(mask.sum())
            if n_samples < 5:
                logger.debug(
                    "Skipping quarter {} with only {} samples", quarter, n_samples
                )
                continue

            X_q = X_arr[mask]
            y_q = y_arr[mask]
            n_positive = int(y_q.sum())

            y_prob_q = self._get_positive_probs(model, X_q)
            y_pred_q = (y_prob_q >= 0.5).astype(int)

            q_metrics: dict[str, Any] = {
                "n_samples": n_samples,
                "n_positive": n_positive,
            }

            # ROC AUC
            if len(np.unique(y_q)) < 2:
                q_metrics["roc_auc"] = 0.5
            else:
                try:
                    q_metrics["roc_auc"] = float(roc_auc_score(y_q, y_prob_q))
                except Exception:
                    q_metrics["roc_auc"] = 0.5

            # F1
            q_metrics["f1"] = float(
                f1_score(y_q, y_pred_q, zero_division=0)
            )

            # Brier score
            q_metrics["brier_score"] = float(brier_score_loss(y_q, y_prob_q))

            quarterly_metrics[str(quarter)] = q_metrics

        # Drift detection
        auc_values = [m["roc_auc"] for m in quarterly_metrics.values()]
        drift_detected = False
        overall_trend = "stable"

        if len(auc_values) >= 2:
            best_auc = max(auc_values)
            if best_auc > 0:
                drift_detected = any(a < 0.8 * best_auc for a in auc_values)

            # Trend: compare first half average to second half average
            midpoint = len(auc_values) // 2
            if midpoint > 0:
                first_half_mean = float(np.mean(auc_values[:midpoint]))
                second_half_mean = float(np.mean(auc_values[midpoint:]))
                delta = second_half_mean - first_half_mean
                if delta > 0.02:
                    overall_trend = "improving"
                elif delta < -0.02:
                    overall_trend = "degrading"

        result = {
            "quarterly_metrics": quarterly_metrics,
            "drift_detected": drift_detected,
            "overall_trend": overall_trend,
        }

        logger.info(
            "Temporal stability: {} quarters analysed, drift_detected={}, trend={}",
            len(quarterly_metrics),
            drift_detected,
            overall_trend,
        )
        return result

    # 4. Compare vs stub

    def compare_vs_stub(
        self,
        model_probs: np.ndarray,
        stub_probs: np.ndarray,
        y_true: np.ndarray,
        threshold: float = 0.5,
    ) -> dict:
        """Compare ML model predictions against rule-based stub predictions.

        Parameters
        model_probs : np.ndarray
            Predicted probabilities from the ML model.
        stub_probs : np.ndarray
            Predicted probabilities from the rule-based stub.
        y_true : np.ndarray
            True binary labels.
        threshold : float
            Classification threshold (default 0.5).

        Returns
        dict
            Keys: model_roc_auc, stub_roc_auc, model_f1, stub_f1,
            model_brier, stub_brier, improved_count, equivalent_count,
            degraded_count, overall_verdict, delta_auc, delta_f1, delta_brier.
        """
        logger.info("Comparing ML model vs rule-based stub on {} samples", len(y_true))

        y_arr = np.asarray(y_true).ravel()
        m_probs = np.asarray(model_probs).ravel()
        s_probs = np.asarray(stub_probs).ravel()

        m_pred = (m_probs >= threshold).astype(int)
        s_pred = (s_probs >= threshold).astype(int)

        unique = np.unique(y_arr)
        single_class = len(unique) < 2

        # ROC AUC
        if single_class:
            model_auc = 0.5
            stub_auc = 0.5
        else:
            try:
                model_auc = float(roc_auc_score(y_arr, m_probs))
            except Exception:
                model_auc = 0.0
            try:
                stub_auc = float(roc_auc_score(y_arr, s_probs))
            except Exception:
                stub_auc = 0.0

        # F1
        model_f1 = float(f1_score(y_arr, m_pred, zero_division=0))
        stub_f1 = float(f1_score(y_arr, s_pred, zero_division=0))

        # Brier score (lower is better)
        model_brier = float(brier_score_loss(y_arr, m_probs))
        stub_brier = float(brier_score_loss(y_arr, s_probs))

        # Per-sample comparison: who got it right?
        m_correct = m_pred == y_arr
        s_correct = s_pred == y_arr

        improved_count = int(np.sum(m_correct & ~s_correct))
        degraded_count = int(np.sum(~m_correct & s_correct))
        equivalent_count = int(np.sum(m_correct == s_correct))

        # Deltas (positive = model is better)
        delta_auc = round(model_auc - stub_auc, 6)
        delta_f1 = round(model_f1 - stub_f1, 6)
        # For Brier, lower is better, so delta is inverted
        delta_brier = round(stub_brier - model_brier, 6)

        # Verdict based on AUC and F1 deltas
        if delta_auc > 0.01 or delta_f1 > 0.01:
            verdict = "IMPROVED"
        elif delta_auc < -0.01 or delta_f1 < -0.01:
            verdict = "DEGRADED"
        else:
            verdict = "EQUIVALENT"

        result = {
            "model_roc_auc": round(model_auc, 6),
            "stub_roc_auc": round(stub_auc, 6),
            "model_f1": round(model_f1, 6),
            "stub_f1": round(stub_f1, 6),
            "model_brier": round(model_brier, 6),
            "stub_brier": round(stub_brier, 6),
            "improved_count": improved_count,
            "equivalent_count": equivalent_count,
            "degraded_count": degraded_count,
            "overall_verdict": verdict,
            "delta_auc": delta_auc,
            "delta_f1": delta_f1,
            "delta_brier": delta_brier,
        }

        logger.info(
            "Stub comparison: verdict={}, delta_auc={:+.4f}, delta_f1={:+.4f}",
            verdict,
            delta_auc,
            delta_f1,
        )
        return result

    # Private helpers

    @staticmethod
    def _get_positive_probs(model: Any, X: np.ndarray) -> np.ndarray:
        """Extract P(positive) from a model, handling both binary and multi-class."""
        try:
            proba = model.predict_proba(X)
            if proba.ndim == 2 and proba.shape[1] >= 2:
                return proba[:, 1]
            return proba.ravel()
        except AttributeError:
            # Fallback: use decision_function or predict
            try:
                scores = model.decision_function(X)
                # Sigmoid to get probabilities
                return 1.0 / (1.0 + np.exp(-scores))
            except AttributeError:
                logger.warning(
                    "Model has neither predict_proba nor decision_function; "
                    "using raw predict output as probabilities"
                )
                return np.asarray(model.predict(X), dtype=float)

    @staticmethod
    def _safe_roc_curve(
        y_true: np.ndarray, y_prob: np.ndarray, single_class: bool
    ) -> dict:
        """Compute ROC curve with graceful fallback."""
        if single_class:
            return {"fpr": [0.0, 1.0], "tpr": [0.0, 1.0], "thresholds": [1.0, 0.0]}
        try:
            fpr, tpr, thresholds = roc_curve(y_true, y_prob)
            return {
                "fpr": fpr.tolist(),
                "tpr": tpr.tolist(),
                "thresholds": thresholds.tolist(),
            }
        except Exception as exc:
            logger.warning("ROC curve computation failed: {}", exc)
            return {"fpr": [], "tpr": [], "thresholds": []}

    @staticmethod
    def _safe_pr_curve(
        y_true: np.ndarray, y_prob: np.ndarray, single_class: bool
    ) -> dict:
        """Compute precision-recall curve with graceful fallback."""
        if single_class:
            pos_rate = float(np.mean(y_true))
            return {
                "precision": [pos_rate],
                "recall": [1.0],
                "thresholds": [0.0],
            }
        try:
            precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
            return {
                "precision": precision.tolist(),
                "recall": recall.tolist(),
                "thresholds": thresholds.tolist(),
            }
        except Exception as exc:
            logger.warning("PR curve computation failed: {}", exc)
            return {"precision": [], "recall": [], "thresholds": []}

    @staticmethod
    def _safe_calibration_curve(
        y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10
    ) -> dict:
        """Compute calibration curve with graceful fallback."""
        try:
            fraction_pos, mean_pred = calibration_curve(
                y_true, y_prob, n_bins=n_bins, strategy="uniform"
            )
            return {
                "fraction_of_positives": fraction_pos.tolist(),
                "mean_predicted_value": mean_pred.tolist(),
            }
        except Exception as exc:
            logger.warning("Calibration curve computation failed: {}", exc)
            return {"fraction_of_positives": [], "mean_predicted_value": []}

    @staticmethod
    def _compute_shap_importance(
        model: Any, X: np.ndarray, feature_names: list[str], top_k: int = 20
    ) -> dict[str, float]:
        """Compute SHAP feature importance, returning top-k features.

        Falls back to model ``feature_importances_`` if SHAP is unavailable,
        and returns an empty dict if neither is available.
        """
        if not SHAP_AVAILABLE:
            logger.info("SHAP unavailable; falling back to model feature_importances_")
            return ModelEvaluator._fallback_feature_importance(
                model, feature_names, top_k
            )

        try:
            # Subsample for performance
            max_samples = min(500, len(X))
            if len(X) > max_samples:
                rng = np.random.RandomState(42)
                idx = rng.choice(len(X), size=max_samples, replace=False)
                X_sample = X[idx]
            else:
                X_sample = X

            explainer = shap.TreeExplainer(model)
            shap_values = explainer.shap_values(X_sample)

            # Handle multi-output (e.g. XGBoost returns list for binary)
            if isinstance(shap_values, list):
                shap_values = shap_values[1] if len(shap_values) == 2 else shap_values[0]

            mean_abs = np.abs(shap_values).mean(axis=0)

            # Build dict and sort
            importance = {
                feature_names[i]: round(float(mean_abs[i]), 6)
                for i in range(min(len(feature_names), len(mean_abs)))
            }
            importance = dict(
                sorted(importance.items(), key=lambda x: -x[1])[:top_k]
            )

            logger.info(
                "SHAP importance computed for {} features (top {})",
                len(feature_names),
                top_k,
            )
            return importance

        except Exception as exc:
            logger.warning("SHAP computation failed ({}); using fallback", exc)
            return ModelEvaluator._fallback_feature_importance(
                model, feature_names, top_k
            )

    @staticmethod
    def _fallback_feature_importance(
        model: Any, feature_names: list[str], top_k: int = 20
    ) -> dict[str, float]:
        """Extract feature importance from model attributes as a fallback."""
        try:
            importances = model.feature_importances_
            importance = {
                feature_names[i]: round(float(importances[i]), 6)
                for i in range(min(len(feature_names), len(importances)))
            }
            return dict(sorted(importance.items(), key=lambda x: -x[1])[:top_k])
        except (AttributeError, Exception) as exc:
            logger.debug("Fallback feature importance also failed: {}", exc)
            return {}

    @staticmethod
    def _fetch_event_data(
        provider: Any,
        lat: float,
        lon: float,
        start_date: str,
        end_date: str,
    ) -> Optional[pd.DataFrame]:
        """Attempt to fetch data from the provider using several calling conventions."""
        # Try common provider interfaces
        for method_name in (
            "fetch_open_meteo_history",
            "fetch_history",
            "fetch",
        ):
            method = getattr(provider, method_name, None)
            if callable(method):
                try:
                    return method(
                        latitude=lat,
                        longitude=lon,
                        start_date=start_date,
                        end_date=end_date,
                    )
                except TypeError:
                    # Try positional args
                    try:
                        return method(lat, lon, start_date, end_date)
                    except Exception:
                        continue
                except Exception:
                    continue

        # Try calling the provider directly
        if callable(provider):
            try:
                return provider(lat, lon, start_date, end_date)
            except Exception as exc:
                logger.warning("Direct provider call failed: {}", exc)

        logger.warning("Could not fetch event data -- no compatible provider method")
        return None

    @staticmethod
    def _engineer_event_features(
        feature_engineer: Any, raw_df: pd.DataFrame
    ) -> Optional[pd.DataFrame]:
        """Attempt to run feature engineering via several calling conventions."""
        # Try class-method style (FeatureEngineer.compute_weather_features)
        for method_name in (
            "compute_weather_features",
            "engineer_features",
            "transform",
        ):
            method = getattr(feature_engineer, method_name, None)
            if callable(method):
                try:
                    return method(raw_df)
                except Exception as exc:
                    logger.debug("Feature engineer method '{}' failed: {}", method_name, exc)
                    continue

        # Try calling it directly
        if callable(feature_engineer):
            try:
                return feature_engineer(raw_df)
            except Exception as exc:
                logger.warning("Direct feature engineer call failed: {}", exc)

        return None

    @staticmethod
    def _select_event_row(
        features_df: pd.DataFrame,
        feature_names: list[str],
        event_date: pd.Timestamp,
    ) -> Optional[np.ndarray]:
        """Select the feature row nearest to the event date and subset to model features."""
        try:
            df = features_df.copy()

            # Ensure datetime index
            if not isinstance(df.index, pd.DatetimeIndex):
                if "timestamp" in df.columns:
                    df = df.set_index("timestamp")
                    df.index = pd.to_datetime(df.index)
                else:
                    df.index = pd.to_datetime(df.index)

            # Find nearest row
            idx = df.index.get_indexer([event_date], method="nearest")[0]
            if idx < 0:
                return None

            row = df.iloc[idx]

            # Subset to expected features, filling missing with 0
            values = []
            for feat in feature_names:
                values.append(float(row.get(feat, 0.0)))

            return np.array(values).reshape(1, -1)

        except Exception as exc:
            logger.debug("Row selection failed: {}", exc)
            return None

# DataQualityReporter

class DataQualityReporter:
    """Generate ``data_quality_report.json`` for a training dataset.

    Assesses sample counts, class balance, missingness, temporal coverage,
    and station diversity.  Also provides minimum-gate checks that training
    pipelines can use to decide whether to proceed or abort.
    """

    def generate_report(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        feature_names: list[str],
        station_ids: Optional[pd.Series] = None,
        timestamps: Optional[pd.Series] = None,
    ) -> dict:
        """Generate a comprehensive data-quality report.

        Parameters
        X : pd.DataFrame
            Feature matrix.
        y : pd.Series
            Binary labels.
        feature_names : list[str]
            Feature column names to assess.
        station_ids : pd.Series, optional
            Station identifiers per row (for spatial diversity metrics).
        timestamps : pd.Series, optional
            Timestamps per row (for temporal coverage).

        Returns
        dict
            Keys: total_samples, positive_samples, negative_samples,
            positive_ratio, station_count, stations_with_positives,
            temporal_range, missingness_per_feature,
            high_missingness_features, dropped_features,
            leakage_checks_passed.
        """
        logger.info("Generating data quality report for {} samples", len(X))

        y_arr = np.asarray(y).ravel()
        total = len(y_arr)
        n_positive = int(y_arr.sum())
        n_negative = total - n_positive

        report: dict[str, Any] = {
            "total_samples": total,
            "positive_samples": n_positive,
            "negative_samples": n_negative,
            "positive_ratio": round(n_positive / total, 6) if total > 0 else 0.0,
        }

        # Station diversity
        if station_ids is not None:
            station_series = pd.Series(np.asarray(station_ids))
            report["station_count"] = int(station_series.nunique())

            # Stations that have at least one positive sample
            positive_mask = y_arr == 1
            if positive_mask.any():
                report["stations_with_positives"] = int(
                    station_series[positive_mask].nunique()
                )
            else:
                report["stations_with_positives"] = 0
        else:
            report["station_count"] = None
            report["stations_with_positives"] = None

        # Temporal range
        if timestamps is not None:
            ts = pd.to_datetime(timestamps)
            report["temporal_range"] = {
                "start": str(ts.min()),
                "end": str(ts.max()),
            }
        else:
            report["temporal_range"] = {"start": None, "end": None}

        # Missingness per feature
        missingness: dict[str, float] = {}
        for feat in feature_names:
            if feat in X.columns:
                n_missing = int(X[feat].isna().sum())
                missingness[feat] = round(n_missing / total, 6) if total > 0 else 0.0
            else:
                missingness[feat] = 1.0  # entirely missing column

        report["missingness_per_feature"] = missingness

        # High missingness features (> 40%)
        report["high_missingness_features"] = [
            feat for feat, frac in missingness.items() if frac > 0.4
        ]

        # Placeholder for caller to populate
        report["dropped_features"] = []

        # Leakage checks (basic: ensure no constant-correlation with label)
        report["leakage_checks_passed"] = self._check_leakage(X, y, feature_names)

        logger.info(
            "Data quality: {} samples, {:.1%} positive, {} high-missingness features",
            total,
            report["positive_ratio"],
            len(report["high_missingness_features"]),
        )
        return report

    def check_minimum_gates(
        self,
        report: dict,
        min_total: int = 500,
        min_positive: int = 20,
        min_stations: int = 5,
        max_missingness: float = 0.4,
    ) -> tuple[bool, list[str]]:
        """Check if the data quality report meets minimum gates.

        Parameters
        report : dict
            Output from ``generate_report``.
        min_total : int
            Minimum total samples required (default 500).
        min_positive : int
            Minimum positive samples required (default 20).
        min_stations : int
            Minimum station count required (default 5).
        max_missingness : float
            Maximum allowed missingness fraction for any feature (default 0.4).

        Returns
        tuple[bool, list[str]]
            ``(passed, violations)`` where *violations* is a list of
            human-readable descriptions of failed gates.
        """
        violations: list[str] = []

        # Total samples
        if report["total_samples"] < min_total:
            violations.append(
                f"Insufficient samples: {report['total_samples']} < {min_total}"
            )

        # Positive samples
        if report["positive_samples"] < min_positive:
            violations.append(
                f"Insufficient positive samples: {report['positive_samples']} < {min_positive}"
            )

        # Station count (only check if station data was provided)
        if report.get("station_count") is not None:
            if report["station_count"] < min_stations:
                violations.append(
                    f"Insufficient stations: {report['station_count']} < {min_stations}"
                )

        # Per-feature missingness
        missingness = report.get("missingness_per_feature", {})
        for feat, frac in missingness.items():
            if frac > max_missingness:
                violations.append(
                    f"High missingness for '{feat}': {frac:.1%} > {max_missingness:.1%}"
                )

        passed = len(violations) == 0

        if passed:
            logger.success("All minimum data-quality gates passed")
        else:
            logger.warning(
                "Data quality gates FAILED ({} violations): {}",
                len(violations),
                "; ".join(violations),
            )

        return passed, violations

    # Private helpers

    @staticmethod
    def _check_leakage(
        X: pd.DataFrame, y: pd.Series, feature_names: list[str]
    ) -> bool:
        """Basic leakage check: flag features with suspiciously high correlation to label.

        A feature with |correlation| > 0.98 with the label is likely a data-leak
        (e.g. the label itself sneaked into the feature set).

        Returns True if no leakage detected.
        """
        y_arr = np.asarray(y, dtype=float).ravel()

        if np.std(y_arr) == 0:
            # Cannot compute correlation with constant label
            return True

        for feat in feature_names:
            if feat not in X.columns:
                continue
            col = X[feat].values.astype(float)
            # Skip if feature is constant
            if np.std(col) == 0:
                continue
            try:
                corr = float(np.corrcoef(col, y_arr)[0, 1])
                if abs(corr) > 0.98:
                    logger.error(
                        "LEAKAGE SUSPECTED: feature '{}' has correlation {:.4f} with label",
                        feat,
                        corr,
                    )
                    return False
            except Exception:
                continue

        return True
