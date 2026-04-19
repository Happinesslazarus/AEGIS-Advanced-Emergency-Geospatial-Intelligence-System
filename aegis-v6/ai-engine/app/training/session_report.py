"""
Aggregates the results of a full training session (all 11 hazards) and writes
a clean summary to disk in two formats:

  - JSON: full detail (all reasons, warnings, metrics, sample stats)
  - CSV:  one row per hazard, suitable for a dissertation appendix table

Also prints a scannable summary table to the logger at the end of training so
the outcome is visible without opening any files.

Used by train_all.py at the end of async_main().
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from app.training.hazard_status import HazardStatus, ValidationResult


# Path to the shared reports directory relative to the ai-engine root
_AI_ROOT = Path(__file__).resolve().parent.parent.parent
REPORTS_DIR = _AI_ROOT / "reports"

# Column order used for the CSV report.
# The first block is scientific metadata (what the hazard is and why it is valid).
# The second block is training outcome (what happened when we ran the pipeline).
# The third block is dissertation guidance.
CSV_COLUMNS = [
    # Scientific metadata
    "hazard_name",
    "region_scope",
    "label_source",
    "data_validity",
    # Validation outcome
    "status",
    "label_integrity",
    "leakage_severity",
    # Sample statistics
    "n_total",
    "n_positive",
    "positive_rate",
    "n_test_positive",
    # Model metrics (only populated for TRAINABLE / PARTIAL)
    "roc_auc",
    "f1_positive",
    "recall_positive",
    "precision_positive",
    "promotion_status",
    # Explanation
    "primary_reason",
    "recommended_fix",
    "required_dataset",
    # Dissertation guidance
    "dissertation_suitability",
]


class TrainingSessionReport:
    """Collects per-hazard outcomes and writes the final session report.

    Typical use in train_all.py:

        report = TrainingSessionReport(region="uk-default")
        ...
        report.add_result(pipeline_result)
        ...
        report.save()
        report.print_summary()
    """

    def __init__(self, region: str, start_date: str = "", end_date: str = ""):
        self.region = region
        self.start_date = start_date
        self.end_date = end_date
        self.started_at = datetime.now(timezone.utc)
        self._entries: list[dict] = []

    def add_result(self, pipeline_result: dict) -> None:
        """Record the outcome of one hazard pipeline run.

        pipeline_result is the dict returned by train_one_hazard() in
        train_all.py, augmented with a 'validation' key that holds the
        ValidationResult produced inside base_real_pipeline.run().
        """
        validation: ValidationResult | None = pipeline_result.get("validation")
        metrics = pipeline_result.get("metrics", {})

        entry = {
            "hazard_name": pipeline_result.get("hazard", "unknown"),
            # Scientific metadata
            "region_scope": validation.region_scope if validation else "UNKNOWN",
            "label_source": validation.label_source if validation else "UNKNOWN",
            "data_validity": validation.data_validity if validation else "UNKNOWN",
            # Validation outcome
            "status": pipeline_result.get("validation_status", "unknown"),
            "label_integrity": validation.label_integrity if validation else "unknown",
            "leakage_severity": (
                validation.leakage_severity.value if validation else "unknown"
            ),
            # Sample stats from the ValidationResult
            "n_total": (getattr(validation, "sample_stats", None) or {}).get("total", 0),
            "n_positive": (getattr(validation, "sample_stats", None) or {}).get("positive", 0),
            "positive_rate": (getattr(validation, "sample_stats", None) or {}).get("positive_rate", 0.0),
            "n_test_positive": (getattr(validation, "sample_stats", None) or {}).get("test_positive", 0),
            # Model metrics (only present for TRAINABLE / PARTIAL)
            "roc_auc": metrics.get("roc_auc", None),
            "f1_positive": metrics.get("f1_positive_class", None),
            "recall_positive": metrics.get("recall_positive", None),
            "precision_positive": metrics.get("precision_positive", None),
            "promotion_status": pipeline_result.get("promotion_status", None),
            # Human-readable explanation
            "primary_reason": (
                validation.reasons[0] if validation and validation.reasons else ""
            ),
            "recommended_fix": (
                validation.recommended_fix if validation else ""
            ),
            "required_dataset": (
                validation.required_dataset if validation else ""
            ),
            # Dissertation guidance
            "dissertation_suitability": (
                validation.dissertation_suitability if validation else ""
            ),
            # Full detail for JSON only
            "all_reasons": (validation.reasons if validation else []),
            "warnings": (validation.warnings if validation else []),
            "tainted_columns": (validation.tainted_columns if validation else []),
            "version": pipeline_result.get("version"),
            "elapsed_seconds": pipeline_result.get("elapsed_seconds"),
            "error": pipeline_result.get("error"),
        }
        self._entries.append(entry)

    def save(self) -> tuple[Path, Path]:
        """Write session report to reports/ and return (json_path, csv_path)."""
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)

        timestamp = self.started_at.strftime("%Y-%m-%d_%H%M%S")
        json_path = REPORTS_DIR / f"training_session_{timestamp}.json"
        csv_path = REPORTS_DIR / f"training_session_{timestamp}.csv"

        # JSON — full detail
        payload = {
            "generated_at": self.started_at.isoformat(),
            "region": self.region,
            "date_range": {"start": self.start_date, "end": self.end_date},
            "summary": self._summary_counts(),
            "hazard_portfolio": self._portfolio_summary(),
            "hazards": self._entries,
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)

        # CSV — one row per hazard, suitable for a dissertation table
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=CSV_COLUMNS,
                extrasaction="ignore",  # ignore JSON-only fields
            )
            writer.writeheader()
            for entry in self._entries:
                # Format floats for readability
                row = dict(entry)
                for col in ("roc_auc", "f1_positive", "recall_positive",
                            "precision_positive", "positive_rate"):
                    if row.get(col) is not None:
                        row[col] = f"{row[col]:.4f}"
                writer.writerow(row)

        logger.info(f"Session report saved: {json_path.name}")
        logger.info(f"CSV summary saved:    {csv_path.name}")
        return json_path, csv_path

    def print_summary(self) -> None:
        """Print a scannable summary table to the logger."""
        counts = self._summary_counts()

        col_w = 30

        logger.info("")
        logger.info("AEGIS HAZARD TRAINING SESSION SUMMARY")
        logger.info("=" * 110)
        logger.info(
            f"{'Hazard':<{col_w}}  {'Status':<14}  {'Scope':<14}  "
            f"{'Validity':<12}  {'ROC-AUC':>8}  {'F1+':>6}  {'N+':>7}  {'Suitability':<12}"
        )
        logger.info("-" * 110)

        for e in self._entries:
            status = e.get("status", "")
            auc = e.get("roc_auc")
            f1 = e.get("f1_positive")
            n_pos = e.get("n_positive", 0)

            auc_str = f"{auc:.4f}" if isinstance(auc, float) else "—"
            f1_str = f"{f1:.3f}" if isinstance(f1, float) else "—"
            scope = e.get("region_scope", "")[:13]
            validity = e.get("data_validity", "")[:11]
            suitability = e.get("dissertation_suitability", "")[:11]

            logger.info(
                f"{e['hazard_name']:<{col_w}}  {status:<14}  {scope:<14}  "
                f"{validity:<12}  {auc_str:>8}  {f1_str:>6}  {n_pos:>7}  {suitability:<12}"
            )

        logger.info("=" * 110)
        logger.info(
            f"TRAINABLE: {counts['trainable']}  "
            f"PARTIAL: {counts['partial']}  "
            f"NOT_TRAINABLE: {counts['not_trainable']}  "
            f"UNSUPPORTED: {counts['unsupported']}  "
            f"ERROR: {counts['error']}"
        )
        logger.info("")

        # Log required fixes for NOT_TRAINABLE hazards
        not_trainable = [
            e for e in self._entries
            if e.get("status") in (HazardStatus.NOT_TRAINABLE.value, "not_trainable", "error")
        ]
        if not_trainable:
            logger.info("REQUIRED FIXES TO ENABLE NOT_TRAINABLE HAZARDS")
            logger.info("-" * 110)
            for e in not_trainable:
                fix = e.get("recommended_fix") or e.get("primary_reason", "See logs.")
                logger.warning(f"  {e['hazard_name']}: {fix[:120]}")
            logger.info("")

        # Log required datasets for UNSUPPORTED hazards
        unsupported = [
            e for e in self._entries
            if e.get("status") == HazardStatus.UNSUPPORTED.value
        ]
        if unsupported:
            logger.info("UNSUPPORTED HAZARDS — REQUIRED DATASETS TO ENABLE")
            logger.info("-" * 110)
            for e in unsupported:
                req = e.get("required_dataset") or "See hazard_status.py"
                logger.warning(f"  {e['hazard_name']}: {req[:160]}")
            logger.info("")

    def _summary_counts(self) -> dict:
        known = {
            HazardStatus.TRAINABLE.value,
            HazardStatus.PARTIAL.value,
            HazardStatus.NOT_TRAINABLE.value,
            HazardStatus.UNSUPPORTED.value,
        }
        trainable = sum(1 for e in self._entries if e.get("status") == HazardStatus.TRAINABLE.value)
        partial = sum(1 for e in self._entries if e.get("status") == HazardStatus.PARTIAL.value)
        not_trainable = sum(1 for e in self._entries if e.get("status") == HazardStatus.NOT_TRAINABLE.value)
        unsupported = sum(1 for e in self._entries if e.get("status") == HazardStatus.UNSUPPORTED.value)
        error = sum(1 for e in self._entries if e.get("status") not in known)
        return {
            "trainable": trainable,
            "partial": partial,
            "not_trainable": not_trainable,
            "unsupported": unsupported,
            "error": error,
            "total": len(self._entries),
        }

    def _portfolio_summary(self) -> dict:
        """Return a compact per-hazard portfolio summary for the JSON report.

        This block is the machine-readable equivalent of the console table.
        It groups hazards by dissertation_suitability so reviewers can quickly
        identify the valid subset.
        """
        strong = []
        acceptable = []
        unsupported_list = []
        blocked = []

        for e in self._entries:
            s = e.get("dissertation_suitability", "")
            record = {
                "hazard": e["hazard_name"],
                "status": e.get("status"),
                "region_scope": e.get("region_scope"),
                "data_validity": e.get("data_validity"),
                "roc_auc": e.get("roc_auc"),
                "label_source_summary": (e.get("label_source") or "")[:80],
            }
            if s == "strong":
                strong.append(record)
            elif s == "acceptable":
                acceptable.append(record)
            elif s == "unsupported":
                unsupported_list.append(record)
            else:
                blocked.append(record)

        return {
            "strong": strong,
            "acceptable": acceptable,
            "unsupported": unsupported_list,
            "blocked_or_error": blocked,
        }
