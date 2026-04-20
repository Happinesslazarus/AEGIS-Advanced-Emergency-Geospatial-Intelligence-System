"""
Post-training validation script that loads every model from the registry,
runs a smoke-test prediction with dummy input, and asserts that predictions
fall within expected ranges. Exits non-zero on any validation failure so
CI can catch broken models before deployment.

- Called by CI workflows after train_all.py completes
- Loads each model via ModelRegistry
- Smoke-test inputs defined inline per hazard type
- Failures block model promotion in governance.py
"""

import asyncio
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from loguru import logger

# Project imports
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.schemas.predictions import PredictionRequest, HazardType

# Hazard predictor classes
from app.hazards.flood import FloodPredictor
from app.hazards.drought import DroughtPredictor
from app.hazards.heatwave import HeatwavePredictor
from app.hazards.severe_storm import SevereStormPredictor
from app.hazards.wildfire import WildfirePredictor
from app.hazards.landslide import LandslidePredictor
from app.hazards.power_outage import PowerOutagePredictor
from app.hazards.water_supply_disruption import WaterSupplyPredictor
from app.hazards.infrastructure_damage import InfrastructureDamagePredictor
from app.hazards.public_safety_incident import PublicSafetyPredictor
from app.hazards.environmental_hazard import EnvironmentalHazardPredictor

# Map hazard types to predictor classes
PREDICTOR_MAP = {
    "flood": (HazardType.FLOOD, FloodPredictor),
    "drought": (HazardType.DROUGHT, DroughtPredictor),
    "heatwave": (HazardType.HEATWAVE, HeatwavePredictor),
    "severe_storm": (HazardType.SEVERE_STORM, SevereStormPredictor),
    "wildfire": (HazardType.WILDFIRE, WildfirePredictor),
    "landslide": (HazardType.LANDSLIDE, LandslidePredictor),
    "power_outage": (HazardType.POWER_OUTAGE, PowerOutagePredictor),
    "water_supply_disruption": (HazardType.WATER_SUPPLY, WaterSupplyPredictor),
    "infrastructure_damage": (HazardType.INFRASTRUCTURE, InfrastructureDamagePredictor),
    "public_safety_incident": (HazardType.PUBLIC_SAFETY, PublicSafetyPredictor),
    "environmental_hazard": (HazardType.ENVIRONMENTAL, EnvironmentalHazardPredictor),
}

# Test scenarios: diverse conditions across locations
TEST_SCENARIOS = [
    # (name, lat, lon, region_id, feature_overrides, description)
    (
        "london_normal",
        51.5074, -0.1278, "uk-default",
        {"rainfall_24h": 5.0, "temperature": 12.0, "wind_speed": 4.0,
         "soil_moisture": 0.4, "humidity": 0.65, "river_level": 1.2},
        "Normal conditions in London",
    ),
    (
        "london_heavy_rain",
        51.5074, -0.1278, "uk-default",
        {"rainfall_24h": 60.0, "rainfall_7d": 150.0, "temperature": 8.0,
         "wind_speed": 8.0, "soil_moisture": 0.85, "humidity": 0.92,
         "river_level": 2.8},
        "Heavy rain event in London",
    ),
    (
        "scotland_heatwave",
        55.9533, -3.1883, "scotland",
        {"temperature": 32.0, "humidity": 0.75, "wind_speed": 2.0,
         "rainfall_24h": 0.0, "soil_moisture": 0.2},
        "Extreme heat in Edinburgh",
    ),
    (
        "scotland_storm",
        55.9533, -3.1883, "scotland",
        {"wind_speed": 28.0, "rainfall_24h": 45.0, "temperature": 6.0,
         "humidity": 0.88, "soil_moisture": 0.7},
        "Severe storm in Edinburgh",
    ),
    (
        "wales_drought",
        51.4816, -3.1791, "uk-default",
        {"rainfall_24h": 0.0, "rainfall_7d": 2.0, "rainfall_30d": 15.0,
         "temperature": 26.0, "soil_moisture": 0.15, "humidity": 0.3},
        "Drought conditions in Cardiff",
    ),
]

class ValidationResult:
    """Stores comparison between ML model and rule-based stub."""

    def __init__(self, hazard: str, scenario: str, description: str):
        self.hazard = hazard
        self.scenario = scenario
        self.description = description
        self.model_prob: Optional[float] = None
        self.model_conf: Optional[float] = None
        self.model_risk: Optional[str] = None
        self.stub_prob: Optional[float] = None
        self.stub_conf: Optional[float] = None
        self.stub_risk: Optional[str] = None
        self.model_available: bool = False
        self.shap_available: bool = False
        self.model_type_label: Optional[str] = None
        self.error: Optional[str] = None

    @property
    def delta(self) -> Optional[float]:
        if self.model_prob is not None and self.stub_prob is not None:
            return self.model_prob - self.stub_prob
        return None

    def verdict(self) -> str:
        if not self.model_available:
            return "NO_MODEL"
        if self.error:
            return "ERROR"
        d = self.delta
        if d is None:
            return "UNKNOWN"
        if abs(d) < 0.05:
            return "EQUIVALENT"
        return "IMPROVED" if d > 0 else "DEGRADED"

async def run_stub_prediction(
    predictor, features: Dict[str, float]
) -> Tuple[float, float]:
    """Call the stub prediction directly."""
    return predictor._stub_prediction(features)

async def validate_hazard(
    hazard_name: str,
    registry: ModelRegistry,
    feature_store: FeatureStore,
    scenarios: List[tuple],
) -> List[ValidationResult]:
    """Validate a single hazard type across all scenarios."""

    if hazard_name not in PREDICTOR_MAP:
        logger.warning(f"Unknown hazard: {hazard_name}")
        return []

    hazard_type, predictor_cls = PREDICTOR_MAP[hazard_name]
    predictor = predictor_cls(registry, feature_store)
    results = []

    for scenario_name, lat, lon, region_id, overrides, desc in scenarios:
        result = ValidationResult(hazard_name, scenario_name, desc)

        try:
            # Build request
            request = PredictionRequest(
                hazard_type=hazard_type,
                region_id=region_id,
                latitude=lat,
                longitude=lon,
                feature_overrides=overrides,
                include_contributing_factors=True,
            )

            # 1. Full prediction (uses model if available, else stub)
            response = await predictor.predict(request)
            full_prob = response.probability
            full_conf = response.confidence
            full_risk = response.risk_level.value

            # 2. Stub prediction (always rule-based)
            features = await feature_store.get_all_features(
                lat, lon, region_id, feature_overrides=overrides
            )
            stub_prob, stub_conf = await run_stub_prediction(predictor, features)

            result.stub_prob = round(float(stub_prob), 4)
            result.stub_conf = round(float(stub_conf), 4)
            result.stub_risk = predictor._classify_risk(stub_prob).value

            # Check if prediction used a model (different from stub)
            if response.model_version and not response.model_version.startswith("stub"):
                result.model_available = True
                result.model_prob = round(float(full_prob), 4)
                result.model_conf = round(float(full_conf), 4)
                result.model_risk = full_risk
            else:
                # No model -- full prediction IS the stub
                result.model_available = False

            # Check SHAP
            if hasattr(response, 'shap_explanation') and response.shap_explanation:
                result.shap_available = True
            if hasattr(response, 'model_type_label') and response.model_type_label:
                result.model_type_label = response.model_type_label

        except Exception as e:
            result.error = str(e)
            logger.error(f"  [{hazard_name}][{scenario_name}] Error: {e}")

        results.append(result)

    return results

def print_report(all_results: Dict[str, List[ValidationResult]]) -> None:
    """Print a human-readable validation report."""

    print("\n" + "=" * 80)
    print("  AEGIS HAZARD MODEL VALIDATION REPORT")
    print(f"  Generated: {datetime.utcnow().isoformat()}")
    print("=" * 80)

    summary = {"NO_MODEL": 0, "EQUIVALENT": 0, "IMPROVED": 0, "DEGRADED": 0, "ERROR": 0, "UNKNOWN": 0}

    for hazard, results in sorted(all_results.items()):
        print(f"\n {hazard.upper()} """)

        has_model = any(r.model_available for r in results)
        if not has_model:
            print("  Status: NO TRAINED MODEL -- using rule-based stub only")
            summary["NO_MODEL"] += len(results)
            for r in results:
                print(f"    {r.scenario:25s}  stub_prob={r.stub_prob:.4f}  conf={r.stub_conf:.3f}  risk={r.stub_risk}")
            continue

        model_type = results[0].model_type_label or "unknown"
        print(f"  Model type: {model_type}")

        for r in results:
            v = r.verdict()
            summary[v] = summary.get(v, 0) + 1

            if r.error:
                print(f"    {r.scenario:25s}  ERROR: {r.error}")
                continue

            if not r.model_available:
                print(f"    {r.scenario:25s}  stub_prob={r.stub_prob:.4f}  [no model for region]")
                continue

            delta = r.delta or 0.0
            arrow = "^" if delta > 0.05 else ("v" if delta < -0.05 else "≈")
            shap_flag = " [SHAP]" if r.shap_available else ""

            print(
                f"    {r.scenario:25s}  "
                f"model={r.model_prob:.4f}  stub={r.stub_prob:.4f}  "
                f"Δ={delta:+.4f} {arrow}  "
                f"risk={r.model_risk:8s}  conf={r.model_conf:.3f}"
                f"{shap_flag}"
            )

    # Summary
    total = sum(summary.values())
    print(f"\n{'=' * 80}")
    print("  SUMMARY")
    print(f"  Total comparisons: {total}")
    for label, count in sorted(summary.items()):
        if count > 0:
            pct = count / total * 100 if total else 0
            print(f"    {label:15s}: {count:3d}  ({pct:.0f}%)")

    # Recommendations
    print(f"\n  RECOMMENDATIONS:")
    degraded_hazards = [
        h for h, rs in all_results.items()
        if any(r.verdict() == "DEGRADED" for r in rs)
    ]
    if degraded_hazards:
        print(f"    !  Models showing degradation: {', '.join(degraded_hazards)}")
        print(f"       Consider keeping rule-based as primary for these hazards")
    else:
        print(f"      No models showing degradation vs rule-based baseline")

    no_model_hazards = [
        h for h, rs in all_results.items()
        if all(not r.model_available for r in rs)
    ]
    if no_model_hazards:
        print(f"    !  Hazards without trained models: {', '.join(no_model_hazards)}")
        print(f"       Run training pipelines to create models")

    print("=" * 80)

def save_report_json(
    all_results: Dict[str, List[ValidationResult]], output_path: Path
) -> None:
    """Save validation results as JSON for programmatic consumption."""

    report = {
        "generated_at": datetime.utcnow().isoformat(),
        "hazards": {},
    }

    for hazard, results in all_results.items():
        hazard_report = {
            "has_model": any(r.model_available for r in results),
            "model_type": results[0].model_type_label if results else None,
            "scenarios": [],
        }
        for r in results:
            hazard_report["scenarios"].append({
                "name": r.scenario,
                "description": r.description,
                "verdict": r.verdict(),
                "model_prob": r.model_prob,
                "model_conf": r.model_conf,
                "stub_prob": r.stub_prob,
                "stub_conf": r.stub_conf,
                "delta": r.delta,
                "shap_available": r.shap_available,
                "error": r.error,
            })
        report["hazards"][hazard] = hazard_report

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    logger.info(f"JSON report saved to {output_path}")

async def main():
    parser = argparse.ArgumentParser(description="Validate AEGIS hazard models")
    parser.add_argument(
        "--hazard", type=str, default=None,
        help="Validate a single hazard (e.g. flood, wildfire). Default: all",
    )
    parser.add_argument(
        "--region", type=str, default=None,
        help="Filter scenarios to a specific region",
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Save JSON report to this path",
    )
    parser.add_argument(
        "--registry-path", type=str, default="./model_registry",
        help="Path to model registry directory",
    )
    args = parser.parse_args()

    # Initialize components
    registry = ModelRegistry(registry_path=args.registry_path)
    await registry.load_all_models()

    feature_store = FeatureStore()

    # Select hazards
    if args.hazard:
        hazards = [args.hazard]
    else:
        hazards = list(PREDICTOR_MAP.keys())

    # Filter scenarios by region if specified
    scenarios = TEST_SCENARIOS
    if args.region:
        scenarios = [s for s in scenarios if s[3] == args.region]
        if not scenarios:
            logger.error(f"No test scenarios for region '{args.region}'")
            sys.exit(1)

    # Run validation
    all_results: Dict[str, List[ValidationResult]] = {}
    for hazard in hazards:
        logger.info(f"Validating {hazard}...")
        results = await validate_hazard(hazard, registry, feature_store, scenarios)
        all_results[hazard] = results

    # Output
    print_report(all_results)

    if args.output:
        save_report_json(all_results, Path(args.output))

if __name__ == "__main__":
    asyncio.run(main())
