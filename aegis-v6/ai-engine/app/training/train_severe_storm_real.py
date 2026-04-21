"""
Severe storm / tropical cyclone risk-prediction training pipeline.

Config and label logic live in hazard_registry.py (HAZARD_REGISTRY["severe_storm"]).
This module exists so train_all.py can import SevereStormRealPipeline by the
conventional name, and to allow standalone execution:

    python -m app.training.train_severe_storm_real --fast

Label sources, feature columns, and HazardConfig are documented in
app/training/hazard_registry.py.
"""

from __future__ import annotations

from loguru import logger

from app.training.base_real_pipeline import parse_training_args, run_pipeline
from app.training.hazard_registry import make_pipeline

SevereStormRealPipeline = make_pipeline("severe_storm")


def main() -> None:
    args = parse_training_args("severe_storm")
    result = run_pipeline(SevereStormRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Severe storm training complete: {result['version']}")
    else:
        logger.error(f"Severe storm training failed: {result.get('error', 'unknown')}")


if __name__ == "__main__":
    main()
