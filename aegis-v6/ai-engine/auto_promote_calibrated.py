#!/usr/bin/env python3
"""
auto_promote_calibrated.py
Run this after calibration re-trains complete.
Finds the newest artifact for each hazard that has optimal_threshold,
then updates promotions.json if AUC >= threshold.
"""
import json, os, sys
from pathlib import Path
from datetime import datetime

BASE = Path(__file__).parent
REGISTRY = BASE / "model_registry"
PROMOTIONS_FILE = REGISTRY / "promotions.json"

# All hazards we want calibrated versions for
HAZARDS = [
    ("flood",                    "uk-default"),
    ("landslide",                "uk-default"),
    ("infrastructure_damage",    "uk-default"),
    ("environmental_hazard",     "uk-default"),
    ("drought",                  "uk-default"),
    ("heatwave",                 "uk-default"),
    ("wildfire",                 "uk-default"),
    ("power_outage",             "uk-default"),
    ("severe_storm",             "uk-default"),
    ("public_safety_incident",   "uk-default"),
    ("water_supply_disruption",  "uk-default"),
]

MIN_AUC = 0.60

with open(PROMOTIONS_FILE) as f:
    promotions = json.load(f)

print(f"=== Auto-promote calibrated models — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")

updated = 0
for hazard, region in HAZARDS:
    prefix = f"{hazard}_{region}_v"
    candidates = sorted(
        [d for d in REGISTRY.iterdir() if d.is_dir() and d.name.startswith(prefix)],
        key=lambda d: d.name, reverse=True  # newest first
    )

    found = False
    for artifact_dir in candidates:
        meta_path = artifact_dir / "metadata.json"
        if not meta_path.exists():
            continue
        with open(meta_path) as f:
            meta = json.load(f)

        thr = meta.get("optimal_threshold")
        if thr is None:
            continue  # no calibration — skip this artifact

        auc = meta.get("performance_metrics", {}).get("roc_auc", 0) or 0
        version = meta["version"]
        key = f"{hazard}_{region}"

        if auc >= MIN_AUC:
            old = promotions.get(key, "NONE")
            if old == version:
                print(f"  UNCHANGED  {key}: {version}  AUC={auc:.4f}  thr={thr:.4f}")
            else:
                promotions[key] = version
                updated += 1
                print(f"  PROMOTED   {key}: {old} -> {version}  AUC={auc:.4f}  thr={thr:.4f}")
            found = True
            break
        else:
            print(f"  TOO LOW    {key}: {version}  AUC={auc:.4f} < {MIN_AUC}")
            found = True
            break

    if not found:
        key = f"{hazard}_{region}"
        current = promotions.get(key, "NONE")
        print(f"  NO CALIB   {key}: keeping {current} (no calibrated artifact yet)")

print()
if updated:
    with open(PROMOTIONS_FILE, "w") as f:
        json.dump(promotions, f, indent=2)
    print(f"promotions.json updated — {updated} new version(s) promoted.")
else:
    print("Nothing changed.")

# Print final state
print("\n=== Current promotions.json ===")
for k, v in promotions.items():
    print(f"  {k}: {v}")
