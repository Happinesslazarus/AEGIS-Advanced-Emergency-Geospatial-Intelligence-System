"""
Convenience script that runs all 11 hazard training pipelines in sequence.
Useful for a clean re-training pass after new data arrives or model drift
is detected.  All 11 hazards are now TRAINABLE with scientifically independent
label sources (LeakageSeverity.NONE for 10/11; LOW for landslide).
UNSUPPORTED_HAZARDS = frozenset() — no hazards are blocked.

- Imports and calls each train_*_real.py pipeline class
- Can be invoked directly: python app/training/train_all.py
- Also called by ai-engine/run_training_all.py at the project root

First-time setup (downloads all freely available training data):
    cd aegis-v6/ai-engine
    python setup_data.py

Then run training:
    python app/training/train_all.py --start-date 2015-01-01 --end-date 2025-12-31

Quick test run (2 years):
    python app/training/train_all.py --fast
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path as _Path

# Load .env so FIRMS_MAP_KEY, ECMWF_API_KEY, etc. are available to all pipelines
_env_file = _Path(__file__).resolve().parents[2] / ".env"
try:
    from dotenv import load_dotenv
    load_dotenv(_env_file, override=False)
except ImportError:
    pass  # python-dotenv optional; caller can export vars manually

# GPU memory management: use GPU but cap at 5GB to leave room for Windows DWM
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
try:
    import tensorflow as tf
    gpus = tf.config.experimental.list_physical_devices('GPU')
    for gpu in gpus:
        tf.config.experimental.set_memory_growth(gpu, True)
        tf.config.set_logical_device_configuration(gpu, [
            tf.config.LogicalDeviceConfiguration(memory_limit=5120)
        ])
except Exception:
    pass
from pathlib import Path
from typing import Any

from loguru import logger
from app.training.session_report import TrainingSessionReport
from app.training.hazard_status import HazardStatus

_AI_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

# Write a persistent log file so watch_training.py can follow live progress
_LOG_DIR = _AI_ROOT / "logs"
_LOG_DIR.mkdir(exist_ok=True)
_LOG_FILE = _LOG_DIR / f"training_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.log"
logger.add(_LOG_FILE, level="DEBUG", format="{time} | {level:<8} | {name}:{function}:{line} - {message}")

# All 11 hazard training pipelines in execution order
TRAINING_PIPELINES = [
    ("flood", "app.training.train_flood_real", "FloodRealPipeline"),
    ("drought", "app.training.train_drought_real", "DroughtRealPipeline"),
    ("heatwave", "app.training.train_heatwave_real", "HeatwaveRealPipeline"),
    ("severe_storm", "app.training.train_severe_storm_real", "SevereStormRealPipeline"),
    ("wildfire", "app.training.train_wildfire_real", "WildfireRealPipeline"),
    ("landslide", "app.training.train_landslide_real", "LandslideRealPipeline"),
    # All 4 previously UNSUPPORTED hazards are now enabled with independent
    # label sources — UK/EIA outages, GRDC discharge, EM-DAT, Stats19/FARS.
    ("power_outage",            "app.training.train_power_outage_real",            "PowerOutageRealPipeline"),
    ("water_supply_disruption", "app.training.train_water_supply_disruption_real", "WaterSupplyDisruptionRealPipeline"),
    ("infrastructure_damage",   "app.training.train_infrastructure_damage_real",   "InfrastructureDamageRealPipeline"),
    ("public_safety_incident",  "app.training.train_public_safety_incident_real",  "PublicSafetyIncidentRealPipeline"),
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
        # Forward the ValidationResult so session_report can include leakage
        # severity, label integrity, and recommended fixes for every hazard.
        result["validation"] = pipeline_result.get("validation")
        result["validation_status"] = pipeline_result.get(
            "validation_status",
            HazardStatus.NOT_TRAINABLE.value,
        )

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
    logger.info(f"GPU: {'enabled (5GB cap)' if os.environ.get('CUDA_VISIBLE_DEVICES') != '-1' else 'disabled'}")

    # Session report collects per-hazard outcomes and writes the final
    # JSON + CSV that you can paste directly into a dissertation appendix.
    session_report = TrainingSessionReport(
        region=args.region,
        start_date=args.start_date,
        end_date=args.end_date,
    )

    try:
        from tqdm import tqdm
        has_tqdm = True
    except ImportError:
        has_tqdm = False

    results: list[dict] = []
    total = len(TRAINING_PIPELINES)

    # --resume: skip hazards that already have a model_registry entry whose
    # version tag matches the requested date range (format: vYYYY.MM.DD.HHMMSS).
    # Determines "already done this run" by checking for any directory under
    # model_registry/{hazard}_{region}_v* that was created today or later.
    # This makes crash-recovery safe: re-run with --resume and it picks up
    # from where it left off without wasting API calls or GPU time.
    _model_registry = _AI_ROOT / "model_registry"
    def _already_trained(hazard: str) -> str | None:
        """Return version string only if a successful artifact exists for this hazard
        trained with the same start/end date range as this run.
        Checks metadata.json['temporal_range'] so fast-run artifacts are never confused
        with full-run artifacts even when trained on the same calendar day."""
        if not args.resume:
            return None
        prefix = f"{hazard}_{args.region}_v"
        if not _model_registry.exists():
            return None
        candidates = sorted(_model_registry.glob(f"{prefix}*"), reverse=True)
        for c in candidates:
            meta_path = c / "metadata.json"
            if not meta_path.exists():
                continue
            try:
                import json as _json
                meta = _json.loads(meta_path.read_text())
                tr = meta.get("temporal_range", {})
                if tr.get("start") == args.start_date and tr.get("end") == args.end_date:
                    logger.info(f"  RESUME: {hazard} already succeeded ({c.name}) — skipping")
                    return c.name.split("_v", 1)[1]
            except Exception:
                continue
        return None

    cooldown_needed = False  # only cool down between actual training runs
    if has_tqdm:
        pbar = tqdm(TRAINING_PIPELINES, desc="Training all hazards", unit="model", ncols=100, colour="green")
    else:
        pbar = TRAINING_PIPELINES

    for i, (hazard, module, cls_name) in enumerate(pbar):
        if has_tqdm:
            pbar.set_description(f"[{i+1}/{total}] Training {hazard}")

        existing_version = _already_trained(hazard)
        if existing_version:
            logger.info(f"  SKIP {hazard}: already trained this run (version={existing_version})")
            results.append({
                "hazard": hazard, "region": args.region, "status": "skipped",
                "version": existing_version, "metrics": {}, "promotion_status": "skipped",
                "error": None, "validation_status": "SKIPPED",
            })
            session_report.add_result(results[-1])
            continue

        # Inter-hazard cooldown — Open-Meteo free tier rate-limits to ~10 req/min.
        # Each hazard fetches weather for 20-28 global locations in 2-3 API calls.
        # A 5-minute pause between hazards allows the rate-limit window to reset
        # fully before the next batch of requests begins.
        if cooldown_needed:
            logger.info(f"  Cooling down 300s before {hazard} (Open-Meteo rate limit protection)...")
            await asyncio.sleep(300)

        r = await train_one_hazard(
            hazard, module, cls_name,
            region=args.region,
            start_date=args.start_date,
            end_date=args.end_date,
            refresh=args.refresh,
        )
        cooldown_needed = True
        results.append(r)
        # Register with session report regardless of outcome — every hazard
        # must appear in the final table with a clear status and reason.
        session_report.add_result(r)

    # E2E verification
    e2e = run_e2e_verification(args.region)

    elapsed = (datetime.utcnow() - started).total_seconds()

    # Print the full per-hazard summary table (includes validation status,
    # label integrity, metrics, and recommended fixes for blocked hazards).
    session_report.print_summary()

    # Save JSON + CSV reports to ai-engine/reports/
    session_report.save()

    # Also emit the compact counts to the same log stream for CI visibility
    successes = [r for r in results if r["status"] == "success"]
    failures = [r for r in results if r["status"] != "success"]
    logger.info(
        f"Completed in {elapsed:.0f}s — "
        f"{len(successes)} trained / {len(failures)} skipped or failed | "
        f"E2E: {'PASS' if e2e.get('passed') else 'FAIL'}"
    )

    # Save legacy summary JSON (keeps compatibility with existing CI scripts)
    summary = {
        "generated_at": datetime.utcnow().isoformat(),
        "region": args.region,
        "date_range": {"start": args.start_date, "end": args.end_date},
        "elapsed_seconds": round(elapsed, 1),
        "results": [
            {k: v for k, v in r.items() if k != "validation"}
            for r in results
        ],
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
    out = _AI_ROOT / "training_summary.json"
    with open(out, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    logger.info(f"Legacy summary saved to {out}")

def main():
    parser = argparse.ArgumentParser(description="AEGIS Train-All Orchestrator")
    parser.add_argument("--region", default="uk-default", help="Region ID")
    parser.add_argument("--start-date", default="2015-01-01", help="Start date")
    parser.add_argument("--end-date", default="2025-12-31", help="End date")
    parser.add_argument("--refresh", action="store_true", help="Bypass cache")
    parser.add_argument("--fast", action="store_true", help="Short date window")
    parser.add_argument("--resume", action="store_true",
                        help="Skip hazards already trained today — safe crash recovery")
    args = parser.parse_args()

    if args.fast:
        args.start_date = "2023-01-01"
        args.end_date = "2024-12-31"

    asyncio.run(async_main(args))

if __name__ == "__main__":
    main()
