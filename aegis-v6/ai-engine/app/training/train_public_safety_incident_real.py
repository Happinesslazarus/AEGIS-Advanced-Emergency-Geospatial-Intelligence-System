"""
Public safety incident risk-prediction training pipeline.

Config and label logic live in hazard_registry.py
(HAZARD_REGISTRY["public_safety_incident"]).
This module exists so train_all.py can import PublicSafetyIncidentRealPipeline
by the conventional name, and to allow standalone execution:

    python -m app.training.train_public_safety_incident_real --fast

Label sources (Stats19 + NHTSA FARS), feature columns, and HazardConfig are
documented in app/training/hazard_registry.py.
"""

from __future__ import annotations

from loguru import logger

from app.training.base_real_pipeline import parse_training_args, run_pipeline
from app.training.hazard_registry import make_pipeline

PublicSafetyIncidentRealPipeline = make_pipeline("public_safety_incident")


def main() -> None:
    args = parse_training_args("public_safety_incident")
    result = run_pipeline(PublicSafetyIncidentRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Public safety incident training complete: {result['version']}")
    else:
        logger.error(f"Public safety incident training failed: {result.get('error', 'unknown')}")


if __name__ == "__main__":
    main()
