"""
AEGIS AI Engine — Train-All Orchestrator

Runs all 11 hazard training scripts in sequence, continues on individual
failure, and produces a comprehensive training_summary.json.

Usage:
    python -m app.training.train_all --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
    python -m app.training.train_all --region uk-default --fast
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

_AI_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

# All 11 hazard training pipelines in execution order
TRAINING_PIPELINES = [
    ("flood", "app.training.train_flood_real", "FloodRealPipeline"),
    ("drought", "app.training.train_drought_real", "DroughtRealPipeline"),
    ("heatwave", "app.training.train_heatwave_real", "HeatwaveRealPipeline"),
    ("severe_storm", "app.training.train_severe_storm_real", "SevereStormRealPipeline"),
    ("wildfire", "app.training.train_wildfire_real", "WildfireRealPipeline"),
    ("landslide", "app.training.train_landslide_real", "LandslideRealPipeline"),
    ("power_outage", "app.training.train_power_outage_real", "PowerOutageRealPipeline"),
    ("water_supply_disruption", "app.training.train_water_supply_disruption_real", "WaterSupplyDisruptionRealPipeline"),
    ("infrastructure_damage", "app.training.train_infrastructure_damage_real", "InfrastructureDamageRealPipeline"),
    ("public_safety_incident", "app.training.train_public_safety_incident_real", "PublicSafetyIncidentRealPipeline"),
    ("environmental_hazard", "app.training.train_environmental_hazard_real", "EnvironmentalHazardRealPipeline"),
]

async def train_one_hazard(
    hazard: str,
    module_path: str,
    class_name: str,
    region: str,
    start_date: str,
    end_date: str,
    refresh: bool,
) -> dict[str, Any]:
    """Train a single hazard. Returns result dict."""
    import importlib

    result: dict[str, Any] = {
        "hazard": hazard,
        "region": region,
        "status": "unknown",
        "version": None,
        "metrics": {},
        "promotion_status": None,
        "error": None,
    }

    try:
        logger.info(f"\n{'='*60}")
        logger.info(f"  TRAINING: {hazard} / {region}")
        logger.info(f"{'='*60}")

        mod = importlib.import_module(module_path)
        pipeline_cls = getattr(mod, class_name)
        pipeline = pipeline_cls(
            region_id=region,
            start_date=start_date,
            end_date=end_date,
            refresh=refresh,
        )
        pipeline_result = await pipeline.run()

        result["status"] = pipeline_result.get("status", "unknown")
        result["version"] = pipeline_result.get("version")
        result["metrics"] = pipeline_result.get("metrics", {})
        result["promotion_status"] = pipeline_result.get("promotion_status")
        result["shap_top5"] = pipeline_result.get("shap_top5", {})
        result["samples"] = pipeline_result.get("samples", 0)
        result["elapsed_seconds"] = pipeline_result.get("elapsed_seconds", 0)

        if result["status"] == "success":
            logger.success(f"  {hazard}: SUCCESS (version={result['version']})")
        else:
            logger.warning(f"  {hazard}: {result['status']} — {pipeline_result.get('error', '')}")
            result["error"] = pipeline_result.get("error")

    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)
        logger.error(f"  {hazard}: EXCEPTION — {exc}")
        traceback.print_exc()

    return result

def run_e2e_verification(region: str) -> dict:
    """Run the existing E2E verification script."""
    logger.info("\n" + "=" * 60)
    logger.info("  RUNNING E2E VERIFICATION")
    logger.info("=" * 60)

    try:
        result = subprocess.run(
            [sys.executable, "run_e2e_verify.py", "--regions", "uk", "--no-train"],
            capture_output=True, text=True, cwd=str(_AI_ROOT), timeout=300,
        )
        logger.info(result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout)
        if result.returncode != 0:
            logger.warning(f"E2E stderr: {result.stderr[-500:]}")
        return {"passed": result.returncode == 0, "output": result.stdout[-3000:]}
    except Exception as e:
        logger.error(f"E2E verification failed: {e}")
        return {"passed": False, "error": str(e)}

async def async_main(args: argparse.Namespace) -> None:
    started = datetime.utcnow()
    logger.info("AEGIS Hazard ML Platform — Train All (Real Data)")
    logger.info(f"Region: {args.region} | Dates: {args.start_date} to {args.end_date}")
    logger.info(f"Refresh cache: {args.refresh}")

    results: list[dict] = []

    for hazard, module, cls_name in TRAINING_PIPELINES:
        r = await train_one_hazard(
            hazard, module, cls_name,
            region=args.region,
            start_date=args.start_date,
            end_date=args.end_date,
            refresh=args.refresh,
        )
        results.append(r)

    # E2E verification
    e2e = run_e2e_verification(args.region)

    # Summary
    elapsed = (datetime.utcnow() - started).total_seconds()
    successes = [r for r in results if r["status"] == "success"]
    failures = [r for r in results if r["status"] != "success"]

    summary = {
        "generated_at": datetime.utcnow().isoformat(),
        "region": args.region,
        "date_range": {"start": args.start_date, "end": args.end_date},
        "elapsed_seconds": round(elapsed, 1),
        "results": results,
        "summary": {
            "total": len(results),
            "success": len(successes),
            "failed": len(failures),
            "promoted": sum(1 for r in results if r.get("promotion_status") == "promoted"),
            "candidate": sum(1 for r in results if r.get("promotion_status") == "candidate"),
            "rejected": sum(1 for r in results if r.get("promotion_status") == "rejected"),
        },
        "e2e_verification": e2e,
    }

    # Print summary table
    logger.info("\n" + "=" * 72)
    logger.info("  TRAINING SUMMARY")
    logger.info("=" * 72)
    logger.info(f"{'Hazard':35s}  {'Status':10s}  {'Promotion':12s}  {'ROC-AUC':8s}")
    logger.info("-" * 72)
    for r in results:
        auc = r.get("metrics", {}).get("roc_auc", "N/A")
        auc_str = f"{auc:.4f}" if isinstance(auc, float) else str(auc)
        logger.info(
            f"{r['hazard']:35s}  {r['status']:10s}  "
            f"{r.get('promotion_status', 'N/A'):12s}  {auc_str:8s}"
        )
    logger.info("-" * 72)
    logger.info(
        f"Total: {len(successes)} success / {len(failures)} failed | "
        f"E2E: {'PASS' if e2e.get('passed') else 'FAIL'}"
    )

    # Save summary
    out = _AI_ROOT / "training_summary.json"
    with open(out, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    logger.info(f"\nSummary saved to {out}")

def main():
    parser = argparse.ArgumentParser(description="AEGIS Train-All Orchestrator")
    parser.add_argument("--region", default="uk-default", help="Region ID")
    parser.add_argument("--start-date", default="2015-01-01", help="Start date")
    parser.add_argument("--end-date", default="2025-12-31", help="End date")
    parser.add_argument("--refresh", action="store_true", help="Bypass cache")
    parser.add_argument("--fast", action="store_true", help="Short date window")
    args = parser.parse_args()

    if args.fast:
        args.start_date = "2023-01-01"
        args.end_date = "2024-12-31"

    asyncio.run(async_main(args))

if __name__ == "__main__":
    main()
