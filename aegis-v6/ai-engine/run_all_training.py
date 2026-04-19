"""
Full retrain - all 11 AEGIS hazard models.

Fixes applied (2026-04-18):
  1. Model selection: CV-AUC (5-fold TimeSeriesSplit) prioritised over single-
     fold val-AUC.  Root cause of flood AUC<0.5 (logistic regression was
     chosen over LightGBM cv_auc=0.663 due to noisy single-fold selection).
  2. LogReg cross-validation: logistic regression now scored with the same
     TimeSeriesSplit as tree ensembles - equal footing in candidate selection.
  3. F2-score threshold optimisation replaces cost-sweep (fn_weight=10).
     F2 weights recall 4x precision; minimum recall floor=0.40 enforced.
     Root cause of power_outage/severe_storm/heatwave recall≈0.01 (cost-sweep
     with fn_weight=10 prefers predicting all-negative for imbalance>10:1).
  4. Promotion gate: recall_positive ≥ 0.35 added (UN SENDAI-aligned).

Run: python run_all_training.py [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ALL_HAZARDS = [
    "flood",
    "drought",
    "heatwave",
    "wildfire",
    "landslide",
    "severe_storm",
    "power_outage",
    "water_supply_disruption",
    "infrastructure_damage",
    "public_safety_incident",
    "environmental_hazard",
]

LOG_DIR = Path(__file__).parent / "logs"
REGISTRY_DIR = Path(__file__).parent / "model_registry"


def run_hazard(hazard: str, start: str, end: str, log_dir: Path) -> dict:
    log_path = log_dir / f"train_{hazard}.log"
    cmd = [
        sys.executable, "-m", f"app.training.train_{hazard}_real",
        "--start-date", start,
        "--end-date", end,
    ]
    print(f"\n{'='*60}", flush=True)
    print(f"[{hazard.upper()}] Starting  ({start} to {end})", flush=True)
    print(f"  Log: {log_path}", flush=True)
    t0 = time.time()

    with open(log_path, "w") as lf:
        proc = subprocess.run(
            cmd,
            stdout=lf,
            stderr=subprocess.STDOUT,
            cwd=str(Path(__file__).parent),
            timeout=None,
        )

    elapsed = time.time() - t0
    ok = proc.returncode == 0
    status = "OK" if ok else f"FAIL(rc={proc.returncode})"
    print(f"[{hazard.upper()}] {status} in {elapsed/60:.1f}min", flush=True)

    # Try to extract metrics from the latest training_report.json
    metrics = {}
    try:
        dirs = sorted(
            [d for d in REGISTRY_DIR.iterdir()
             if d.is_dir() and d.name.startswith(f"{hazard}_")],
            key=lambda d: d.stat().st_mtime,
        )
        if dirs:
            rpt = dirs[-1] / "training_report.json"
            if rpt.exists():
                with open(rpt) as f:
                    data = json.load(f)
                m = data.get("test_metrics", {})
                metrics = {
                    "roc_auc": round(m.get("roc_auc", 0), 4),
                    "f1_positive": round(m.get("f1_positive_class", 0), 4),
                    "recall_positive": round(m.get("recall_positive", 0), 4),
                    "precision_positive": round(m.get("precision_positive", 0), 4),
                    "promotion": data.get("promotion", {}).get("status", "?"),
                    "version": data.get("hyperparameter_search", {}).get("chosen_model", "?"),
                }
                print(
                    f"  AUC={metrics['roc_auc']:.4f}  "
                    f"Recall+={metrics['recall_positive']:.4f}  "
                    f"F1+={metrics['f1_positive']:.4f}  "
                    f"Prec+={metrics['precision_positive']:.4f}  "
                    f"to {metrics['promotion'].upper()}",
                    flush=True,
                )
    except Exception as exc:
        print(f"  (could not parse metrics: {exc})", flush=True)

    return {
        "hazard": hazard,
        "status": status,
        "elapsed_min": round(elapsed / 60, 1),
        "returncode": proc.returncode,
        "metrics": metrics,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrain all 11 AEGIS hazard models")
    parser.add_argument("--start-date", default="2015-01-01")
    parser.add_argument("--end-date", default="2025-12-31")
    parser.add_argument(
        "--hazards", nargs="+", default=ALL_HAZARDS,
        help="Subset of hazards to train (default: all 11)"
    )
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    print("AEGIS Full Retrain - all fixes applied", flush=True)
    print(f"Date range: {args.start_date} to {args.end_date}", flush=True)
    print(f"Hazards: {args.hazards}", flush=True)

    session_t0 = time.time()
    results = []
    for hazard in args.hazards:
        r = run_hazard(hazard, args.start_date, args.end_date, LOG_DIR)
        results.append(r)

    # Summary table
    total_min = (time.time() - session_t0) / 60
    print(f"\n{'='*60}", flush=True)
    print(f"SESSION SUMMARY  (total: {total_min:.0f}min)", flush=True)
    print(f"{'='*60}", flush=True)
    header = f"{'Hazard':<30} {'Status':<12} {'AUC':>6} {'Recall+':>8} {'F1+':>7} {'Promo':>10}"
    print(header, flush=True)
    print("-" * len(header), flush=True)
    for r in results:
        m = r.get("metrics", {})
        print(
            f"{r['hazard']:<30} {r['status']:<12} "
            f"{m.get('roc_auc', 0):>6.4f} "
            f"{m.get('recall_positive', 0):>8.4f} "
            f"{m.get('f1_positive', 0):>7.4f} "
            f"{m.get('promotion', '?'):>10}",
            flush=True,
        )

    # Write session JSON
    session = {
        "generated_at": datetime.utcnow().isoformat(),
        "date_range": {"start": args.start_date, "end": args.end_date},
        "elapsed_minutes": round(total_min, 1),
        "fixes_applied": [
            "cv_auc_model_selection",
            "logreg_cross_validation",
            "f2_threshold_optimisation",
            "min_recall_promotion_gate",
        ],
        "results": results,
        "summary": {
            "total": len(results),
            "ok": sum(1 for r in results if r["status"] == "OK"),
            "failed": sum(1 for r in results if r["status"] != "OK"),
            "promoted": sum(1 for r in results if r.get("metrics", {}).get("promotion") == "promoted"),
        },
    }
    out_path = Path(__file__).parent / "training_summary.json"
    with open(out_path, "w") as f:
        json.dump(session, f, indent=2)
    print(f"\nSession summary written to {out_path}", flush=True)


if __name__ == "__main__":
    main()
