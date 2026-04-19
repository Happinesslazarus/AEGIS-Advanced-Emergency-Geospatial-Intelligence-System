#!/usr/bin/env python3
"""
retrain_all_phd.py
------------------
Retrain all 11 hazard models with PhD-standard configuration:
  - fixed_test_date="2022-01-01"  (2022-2023 is a completely unseen future holdout)
  - causal rainfall_anomaly_monthly (no full-dataset leakage)
  - bootstrap AUC 95% CI
  - Brier Skill Score + recall@FPR metrics
  - Manual Platt calibration (sklearn 1.6 compatible)

Runs each hazard sequentially to avoid memory contention.
Promotes winners via auto_promote_calibrated.py at the end.
"""

import subprocess
import sys
import time
from pathlib import Path

AI_ENGINE = Path(__file__).parent

HAZARDS = [
    "flood",
    "severe_storm",
    "heatwave",
    "wildfire",
    "power_outage",
    "drought",
    "landslide",
    "infrastructure_damage",
    "environmental_hazard",
    "public_safety_incident",
    "water_supply_disruption",
]

START = "2016-01-01"
END   = "2023-05-31"
REGION = "uk-default"

results = {}

for hazard in HAZARDS:
    module = f"app.training.train_{hazard}_real"
    print(f"\n{'='*60}")
    print(f"  Training: {hazard}")
    print(f"  Test set: {START} .. 2021-12-31 | Fixed holdout: 2022-01-01 .. {END}")
    print(f"{'='*60}")
    t0 = time.time()
    cmd = [
        sys.executable, "-m", module,
        "--region", REGION,
        "--start-date", START,
        "--end-date", END,
    ]
    proc = subprocess.run(cmd, cwd=AI_ENGINE, capture_output=False)
    elapsed = round(time.time() - t0, 1)
    status = "OK" if proc.returncode == 0 else f"FAILED (exit {proc.returncode})"
    results[hazard] = {"status": status, "elapsed_s": elapsed}
    print(f"\n  {hazard}: {status}  ({elapsed}s)")

print(f"\n{'='*60}")
print("All hazards trained. Running auto_promote_calibrated.py...")
print(f"{'='*60}\n")
subprocess.run(
    [sys.executable, str(AI_ENGINE / "auto_promote_calibrated.py")],
    cwd=AI_ENGINE,
)

print(f"\n{'='*60}")
print("SUMMARY")
print(f"{'='*60}")
for hazard, r in results.items():
    print(f"  {hazard:<40} {r['status']}  ({r['elapsed_s']}s)")
