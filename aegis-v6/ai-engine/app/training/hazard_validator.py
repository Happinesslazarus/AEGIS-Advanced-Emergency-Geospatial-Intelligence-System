"""
Core validation logic for all 11 hazard training pipelines.

Runs before (and just after) the chronological split to decide whether a
hazard is safe to train, should be trained with warnings, or must be skipped.
Returning a clear ValidationResult is the contract — no silent passes and no
silent failures.

Used by base_real_pipeline.py inside every pipeline's run() method so that
validation happens regardless of whether a hazard is run directly or via
train_all.py.

Validation flow
---------------
1. validate_data()    — pre-split checks: UNSUPPORTED guard, label existence,
                        class balance, leakage severity, label provenance
2. validate_splits()  — post-split checks: degenerate folds (0 positives in
                        val or test set), minimum samples per fold

Any method that populates reasons also logs at ERROR level.
Any method that populates warnings also logs at WARNING level.
A clean TRAINABLE result is logged at SUCCESS level.
No exceptions are raised — all problems surface via ValidationResult.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

from app.training.hazard_status import (
    HazardStatus,
    LeakageSeverity,
    ValidationResult,
    HAZARD_LEAKAGE_ANNOTATIONS,
    UNSUPPORTED_HAZARDS,
)


class HazardValidator:
    """Validates a hazard's data, labels, and splits before any model is trained.

    Usage inside a pipeline:

        validator = HazardValidator()

        # Step 0 — before anything, block UNSUPPORTED hazards immediately
        result = validator.validate_unsupported(hazard_type)
        if result is not None:
            return pipeline.failure_result(result)

        # Step 1 — before the split, check data integrity
        result = validator.validate_data(
            hazard_type=cfg.hazard_type,
            task_type=cfg.task_type,
            lead_hours=cfg.lead_hours,
            labels_df=labels_df,
            feature_cols=available_cols,
            min_positive=cfg.min_positive_samples,
            min_total=cfg.min_total_samples,
            label_provenance=cfg.label_provenance,
            region_scope=cfg.region_scope,
            label_source=cfg.label_source,
            data_validity=cfg.data_validity,
        )
        if result.status == HazardStatus.NOT_TRAINABLE:
            return pipeline.failure_result(result)

        # Step 2 — after the split, check for degenerate folds
        result = validator.validate_splits(result, y_train, y_val, y_test)
        if result.status == HazardStatus.NOT_TRAINABLE:
            return pipeline.failure_result(result)
    """

    def validate_unsupported(self, hazard_type: str) -> Optional[ValidationResult]:
        """Return a pre-populated UNSUPPORTED result if this hazard is in the
        formal unsupported set, otherwise return None.

        Called at the very start of run() before any data is fetched so that
        unsupported hazards fail fast with a clear explanation.
        """
        if hazard_type not in UNSUPPORTED_HAZARDS:
            return None

        annotation = HAZARD_LEAKAGE_ANNOTATIONS.get(hazard_type, {})
        result = ValidationResult(
            hazard=hazard_type,
            status=HazardStatus.UNSUPPORTED,
            label_integrity="invalid",
            leakage_severity=annotation.get("severity", LeakageSeverity.SEVERE),
            tainted_columns=annotation.get("tainted_columns", []),
            region_scope=annotation.get("region_scope", "UNKNOWN"),
            label_source=annotation.get("label_source", "NONE"),
            data_validity=annotation.get("data_validity", "invalid"),
            required_dataset=annotation.get("required_dataset", ""),
            dissertation_suitability=annotation.get("dissertation_suitability", "unsupported"),
            recommended_fix=annotation.get("recommended_fix", ""),
        )
        result.reasons.append(
            f"{hazard_type} is formally UNSUPPORTED: no scientifically valid "
            f"training path exists with currently available public data. "
            f"See 'required_dataset' for what would enable this hazard."
        )
        result.reasons.append(annotation.get("note", ""))

        logger.error(
            f"[{hazard_type.upper()} validation] UNSUPPORTED — "
            f"{result.reasons[0]}"
        )
        if result.required_dataset:
            logger.warning(
                f"[{hazard_type.upper()} validation] Required dataset: "
                f"{result.required_dataset[:200]}"
            )

        return result

    def validate_data(
        self,
        hazard_type: str,
        task_type: str,
        lead_hours: int,
        labels_df: pd.DataFrame,
        feature_cols: list[str],
        min_positive: int,
        min_total: int,
        label_provenance: dict,
        region_scope: str = "UNKNOWN",
        label_source: str = "UNKNOWN",
        data_validity: str = "UNKNOWN",
    ) -> ValidationResult:
        """Pre-split validation.  Checks labels, class balance, and leakage.

        The region_scope, label_source, and data_validity fields are passed
        through from HazardConfig and stored on the result so they appear in
        every session report row.
        """
        annotation = HAZARD_LEAKAGE_ANNOTATIONS.get(hazard_type, {})

        result = ValidationResult(
            hazard=hazard_type,
            status=HazardStatus.TRAINABLE,
            region_scope=region_scope,
            label_source=label_source,
            data_validity=data_validity,
            dissertation_suitability=annotation.get("dissertation_suitability", ""),
            required_dataset=annotation.get("required_dataset", ""),
        )

        # Check 1: labels must exist
        if labels_df is None or labels_df.empty:
            result.status = HazardStatus.NOT_TRAINABLE
            result.reasons.append("No labels were produced by build_labels().")
            result.recommended_fix = (
                "Check that the data provider returned non-empty DataFrames "
                "for the sources required by this hazard."
            )
            return result

        if "label" not in labels_df.columns:
            result.status = HazardStatus.NOT_TRAINABLE
            result.reasons.append(
                "labels_df has no 'label' column.  build_labels() must return "
                "a DataFrame with at minimum columns [timestamp, station_id, label]."
            )
            return result

        n_total = len(labels_df)
        n_positive = int(labels_df["label"].sum())
        n_negative = n_total - n_positive
        positive_rate = n_positive / max(n_total, 1)

        result.sample_stats = {
            "total": n_total,
            "positive": n_positive,
            "negative": n_negative,
            "positive_rate": round(positive_rate, 6),
        }

        # Check 2: minimum sample thresholds
        if n_total < min_total:
            result.status = HazardStatus.NOT_TRAINABLE
            result.reasons.append(
                f"Insufficient total samples: {n_total} < {min_total} required."
            )

        if n_positive < min_positive:
            result.status = HazardStatus.NOT_TRAINABLE
            result.reasons.append(
                f"Insufficient positive samples: {n_positive} < {min_positive} required."
            )

        # Check 3: label provenance — flag if a fallback path was used
        provenance_category = label_provenance.get("category", "")

        if hazard_type == "flood" and provenance_category == "precipitation_proxy":
            result.status = HazardStatus.NOT_TRAINABLE
            result.reasons.append(
                "Flood labels are a precipitation proxy — the fallback path was "
                "triggered because SEPA/EA river data was unavailable.  Training "
                "on this label creates a tautology (rainfall_24h simultaneously "
                "defines the label and appears as a feature)."
            )
            result.recommended_fix = (
                "Wait until SEPA and Environment Agency APIs are reachable, then "
                "retrain using the primary event-record label path."
            )

        if hazard_type == "environmental_hazard" and provenance_category == "weather_proxy_fallback":
            result.status = HazardStatus.NOT_TRAINABLE
            result.label_integrity = "tautology"
            result.reasons.append(
                "Environmental hazard labels are a weather-proxy fallback "
                "(wind < 2 m/s AND precip < 0.1 mm/h) — OpenAQ real AQ data "
                "was unavailable.  wind_speed_10m and rainfall_1h appear in both "
                "the label criterion and the feature set, creating a trivial "
                "tautology.  The model would learn the threshold, not atmospheric physics."
            )
            result.recommended_fix = (
                "Ensure internet access and retry so build_labels() can obtain "
                "real OpenAQ DEFRA AURN measurements.  "
                "Manual cache: from app.training.data_fetch_openaq import "
                "build_openaq_label_df; build_openaq_label_df(cache=True)"
            )

        # Check 4: data_validity — reject if explicitly 'invalid'
        if data_validity == "invalid":
            result.status = HazardStatus.NOT_TRAINABLE
            result.label_integrity = "tautology"
            result.reasons.append(
                f"data_validity='{data_validity}' — labels are not independent "
                f"of the feature set.  Training would produce misleading metrics."
            )
            result.recommended_fix = annotation.get("recommended_fix", "")

        # Check 5: leakage severity
        severity = annotation.get("severity", LeakageSeverity.NONE)
        tainted = annotation.get("tainted_columns", [])

        # Only count tainted columns that are actually in the current feature set
        active_tainted = [c for c in tainted if c in feature_cols]

        result.leakage_severity = severity
        result.tainted_columns = active_tainted

        if severity == LeakageSeverity.SEVERE:
            result.status = HazardStatus.NOT_TRAINABLE
            result.label_integrity = "tautology"
            result.reasons.append(
                f"Severe label leakage detected.  Columns in both label definition "
                f"and feature set: {active_tainted}.  The model would reconstruct a "
                f"threshold rule rather than learn a generalizable relationship."
            )
            result.recommended_fix = annotation.get("recommended_fix", "")

        elif severity == LeakageSeverity.HIGH:
            # For risk_scoring and nowcast, lead_hours is 0 — no temporal separation.
            if task_type in ("risk_scoring", "nowcast"):
                result.status = HazardStatus.NOT_TRAINABLE
                result.label_integrity = "tautology"
                result.reasons.append(
                    f"High label leakage with no temporal separation "
                    f"(task_type='{task_type}', effective lead_hours=0).  "
                    f"Tainted columns: {active_tainted}.  "
                    f"The model would reach inflated AUC by reconstructing the "
                    f"label conditions from the feature values."
                )
                result.recommended_fix = annotation.get("recommended_fix", "")
            else:
                # Forecast with lead_hours > 0 gives partial temporal separation.
                if result.status == HazardStatus.TRAINABLE:
                    result.status = HazardStatus.PARTIAL
                result.label_integrity = "partial_tautology"
                result.warnings.append(
                    f"High label leakage (severity=HIGH).  Tainted columns: "
                    f"{active_tainted}.  The {lead_hours}h forecast horizon provides "
                    f"partial temporal separation, but metrics will be inflated.  "
                    f"Do not report these results without prominent caveats."
                )
                result.recommended_fix = annotation.get("recommended_fix", "")

        elif severity == LeakageSeverity.MODERATE:
            if result.status == HazardStatus.TRAINABLE:
                result.status = HazardStatus.PARTIAL
            result.label_integrity = "partial_tautology"
            result.warnings.append(
                f"Moderate label correlation detected.  Tainted columns: "
                f"{active_tainted}.  Some genuine temporal separation exists "
                f"(see annotation notes), but published metrics must acknowledge "
                f"this limitation."
            )
            result.recommended_fix = annotation.get("recommended_fix", "")

        elif severity == LeakageSeverity.LOW:
            # LOW severity: residual indirect correlation, acceptable for PARTIAL.
            if result.status == HazardStatus.TRAINABLE:
                # Check if there are any active tainted columns to warrant PARTIAL
                if active_tainted:
                    result.status = HazardStatus.PARTIAL
                    result.label_integrity = "partial_tautology"
                    result.warnings.append(
                        f"Low-severity residual correlation between features and "
                        f"label definition.  Columns with indirect overlap: "
                        f"{active_tainted}.  Forecast horizon ({lead_hours}h) "
                        f"provides temporal separation.  Results are publishable "
                        f"with appropriate caveats."
                    )
                else:
                    result.label_integrity = "clean"
            else:
                result.label_integrity = "partial_tautology"

        else:  # NONE
            result.label_integrity = "clean"

        # Check 6: region scope sanity
        if region_scope == "UK" and n_positive < 50:
            result.warnings.append(
                f"UK-only scope with only {n_positive} positive samples.  "
                f"Consider multi-region training to improve class balance."
            )

        # Log the annotation note if present
        if annotation.get("note"):
            result.warnings.append(f"Leakage note: {annotation['note']}")

        self._log_result(result)
        return result

    def validate_splits(
        self,
        result: ValidationResult,
        y_train: np.ndarray,
        y_val: np.ndarray,
        y_test: np.ndarray,
        allow_sparse_test: bool = False,
    ) -> ValidationResult:
        """Post-split validation.  Checks for degenerate folds.

        Mutates and returns the passed ValidationResult, preserving any
        reasons / warnings already recorded.
        """
        n_train_pos = int(y_train.sum())
        n_val_pos = int(y_val.sum())
        n_test_pos = int(y_test.sum())

        result.sample_stats.update({
            "train_samples": len(y_train),
            "train_positive": n_train_pos,
            "val_samples": len(y_val),
            "val_positive": n_val_pos,
            "test_samples": len(y_test),
            "test_positive": n_test_pos,
        })

        if n_train_pos == 0:
            result.status = HazardStatus.NOT_TRAINABLE
            result.reasons.append(
                f"Degenerate training set: {n_train_pos} positive samples in "
                f"train fold.  The model cannot learn the positive class at all."
            )

        if n_val_pos == 0:
            # A degenerate val set prevents proper hyperparameter selection but
            # does not block training if test is OK — downgrade to PARTIAL.
            if result.status == HazardStatus.TRAINABLE:
                result.status = HazardStatus.PARTIAL
            result.warnings.append(
                f"Degenerate validation fold: 0 positive samples.  "
                f"Hyperparameter selection will be unreliable.  This usually "
                f"happens when all positive examples fall in the first 70% of "
                f"the chronological timeline (e.g. all heatwaves in summer 2023, "
                f"none in the winter 2024 validation window).  Consider "
                f"seasonal-stratified splitting for this hazard."
            )

        if n_test_pos == 0:
            if allow_sparse_test:
                # Temporal clustering of labels (e.g. EM-DAT fallback with events
                # concentrated in early years) — downgrade to PARTIAL, don't block.
                # Metrics will be CV-based on training data only.
                if result.status == HazardStatus.TRAINABLE:
                    result.status = HazardStatus.PARTIAL
                result.warnings.append(
                    f"Degenerate test set: 0 positive samples in test fold.  "
                    f"allow_sparse_test=True — training continues as PARTIAL.  "
                    f"Reported AUC is from cross-validation on training data, "
                    f"not from a held-out test set.  This is expected when label "
                    f"events are temporally clustered (e.g. EM-DAT fallback with "
                    f"events only in 2019-2021 and test window in 2022-2023)."
                )
            else:
                # A degenerate test set makes evaluation meaningless — hard block.
                result.status = HazardStatus.NOT_TRAINABLE
                result.reasons.append(
                    f"Degenerate test set: 0 positive samples in the test fold.  "
                    f"ROC-AUC is undefined, and any reported metrics would be "
                    f"misleading (a model that always predicts 0 looks perfect).  "
                    f"This is a chronological distribution problem — the positive "
                    f"class events do not occur in the most recent 15% of the "
                    f"date range.  Use a longer date range or seasonal-stratified "
                    f"splitting for this hazard."
                )

        self._log_result(result, phase="splits")
        return result

    def _log_result(self, result: ValidationResult, phase: str = "data") -> None:
        """Write the validation result to the log at the appropriate level."""
        label = f"[{result.hazard.upper()} validation/{phase}]"

        if result.status == HazardStatus.NOT_TRAINABLE:
            for reason in result.reasons:
                logger.error(f"{label} NOT_TRAINABLE — {reason}")
            if result.recommended_fix:
                logger.warning(f"{label} Recommended fix: {result.recommended_fix}")

        elif result.status == HazardStatus.PARTIAL:
            for warning in result.warnings:
                logger.warning(f"{label} PARTIAL — {warning}")

        elif result.status == HazardStatus.UNSUPPORTED:
            for reason in result.reasons:
                logger.error(f"{label} UNSUPPORTED — {reason}")

        else:
            logger.success(
                f"{label} TRAINABLE — "
                f"label_integrity={result.label_integrity}, "
                f"leakage={result.leakage_severity.value}, "
                f"region={result.region_scope}"
            )
