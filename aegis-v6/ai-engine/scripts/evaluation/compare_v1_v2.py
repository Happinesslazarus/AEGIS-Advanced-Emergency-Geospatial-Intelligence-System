"""
File: compare_v1_v2.py

What this file does:
Generates the before/after comparison table and visualisations required for
the dissertation evaluation chapter.  Loads v1 model metadata from the
existing ModelRegistry and v2 results from the new JSON metadata files, then
produces a publication-ready Markdown + CSV table and a bar chart.

Output files:
  reports/model_comparison_v1_v2.csv    — machine-readable comparison table
  reports/model_comparison_v1_v2.md     — dissertation-ready Markdown table
  reports/model_comparison_v1_v2.pdf    — bar chart (saved as PDF for appendix)

Glossary:
  ModelRegistry  = AEGIS's versioned model store in model_registry/
  v1 artifacts   = the .json metadata files produced by the existing training
                   scripts (train_*_real.py) alongside each .pkl model
  v2 artifacts   = the .json files produced by training/train_flood_v2.py etc.
  ROC-AUC        = Receiver Operating Characteristic Area Under Curve —
                   the probability that the model ranks a random positive
                   higher than a random negative; 0.5 = random, 1.0 = perfect
  calibration    = how close predicted probabilities are to true empirical rates;
                   a well-calibrated model that says "70% flood probability"
                   should be right about 70% of the time

How it connects:
  Reads from ← model_registry/<hazard>/*.json  (v1 and v2 metadata)
  Writes to  → reports/  (CSV, Markdown, PDF)

Usage:
  python scripts/evaluation/compare_v1_v2.py
  python scripts/evaluation/compare_v1_v2.py --output-dir reports/paper/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")  # headless — no GUI required for server environments
    import matplotlib.pyplot as plt
    import numpy as np
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install pandas matplotlib numpy")

_AI_ROOT    = Path(__file__).resolve().parents[2]
REGISTRY    = _AI_ROOT / "model_registry"
REPORT_DIR  = _AI_ROOT / "reports"

# Hazard display names for the table
DISPLAY_NAMES = {
    "flood":                    "Flood",
    "drought":                  "Drought",
    "heatwave":                 "Heatwave",
    "wildfire":                 "Wildfire",
    "severe_storm":             "Severe Storm",
    "landslide":                "Landslide",
    "power_outage":             "Power Outage",
    "water_supply_disruption":  "Water Supply",
    "infrastructure_damage":    "Infrastructure",
    "public_safety_incident":   "Public Safety",
    "environmental_hazard":     "Environmental",
}

# Hard-coded v1 results from the dissertation (current production models)
# Update these if you re-run v1 training
V1_BASELINE: dict[str, dict] = {
    "flood":                    {"accuracy": 0.865, "roc_auc": 0.956, "samples": 1923},
    "drought":                  {"accuracy": 0.725, "roc_auc": 0.786, "samples": 1923},
    "heatwave":                 {"accuracy": 0.958, "roc_auc": 0.978, "samples": 1923},
    "wildfire":                 {"accuracy": 0.812, "roc_auc": 0.891, "samples": 1923},
    "severe_storm":             {"accuracy": 0.844, "roc_auc": 0.921, "samples": 1923},
    "landslide":                {"accuracy": 0.791, "roc_auc": 0.853, "samples": 1923},
    "power_outage":             {"accuracy": 0.731, "roc_auc": 0.768, "samples": 1923},
    "water_supply_disruption":  {"accuracy": 0.714, "roc_auc": 0.752, "samples": 1923},
    "infrastructure_damage":    {"accuracy": 0.724, "roc_auc": 0.761, "samples": 1923},
    "public_safety_incident":   {"accuracy": 0.698, "roc_auc": 0.733, "samples": 1923},
    "environmental_hazard":     {"accuracy": 0.742, "roc_auc": 0.783, "samples": 1923},
}


def load_v2_results() -> dict[str, dict]:
    """Scan model_registry for v2 JSON metadata files."""
    v2: dict[str, dict] = {}
    for hazard in DISPLAY_NAMES:
        # Try flood v2 name first, then generic naming
        candidates = [
            REGISTRY / hazard / f"{hazard}_uk_v2_camels_era5.json",  # flood
            REGISTRY / hazard / f"{hazard}_uk_v2_spei_era5.json",    # drought
            REGISTRY / hazard / f"{hazard}_uk_v2.json",              # generic
        ]
        for c in candidates:
            if c.exists():
                try:
                    v2[hazard] = json.loads(c.read_text())
                except Exception:
                    pass
                break
    return v2


def build_comparison_table(v2_results: dict[str, dict]) -> pd.DataFrame:
    """Merge v1 baseline and v2 results into a single comparison DataFrame."""
    rows = []
    for hazard, display in DISPLAY_NAMES.items():
        v1 = V1_BASELINE.get(hazard, {})
        v2 = v2_results.get(hazard, {})
        n_train_v2 = v2.get("n_train", "—")
        if isinstance(n_train_v2, float):
            n_train_v2 = int(n_train_v2)

        rows.append({
            "Hazard":              display,
            "Acc v1":              f"{v1.get('accuracy', 0)*100:.1f}%",
            "Acc v2":              f"{v2.get('accuracy', 0)*100:.1f}%" if v2 else "—",
            "Acc Δ":               (f"+{(v2.get('accuracy',0)-v1.get('accuracy',0))*100:.1f}%"
                                    if v2 else "—"),
            "AUC v1":              f"{v1.get('roc_auc', 0):.3f}",
            "AUC v2":              f"{v2.get('roc_auc', 0):.3f}" if v2 else "—",
            "AUC Δ":               (f"+{(v2.get('roc_auc',0)-v1.get('roc_auc',0)):.3f}"
                                    if v2 else "—"),
            "Samples v1→v2":       f"{v1.get('samples','—')} → {n_train_v2:,}" if v2 else "—",
            "Weak Labels":         "Yes" if v2.get("weak", False) else "No",
        })
    return pd.DataFrame(rows)


def write_markdown(df: pd.DataFrame, out_path: Path) -> None:
    """Write a GitHub-flavoured Markdown table suitable for dissertation appendix."""
    lines = ["# AEGIS Model Performance: v1 vs v2\n",
             "| " + " | ".join(df.columns) + " |",
             "| " + " | ".join(["---"] * len(df.columns)) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(str(v) for v in row.values) + " |")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  Markdown → {out_path}")


def write_chart(df: pd.DataFrame, out_path: Path) -> None:
    """Bar chart comparing ROC-AUC v1 vs v2 across all hazards."""
    hazards  = df["Hazard"].tolist()
    auc_v1   = [float(v.replace("+","")) for v in df["AUC v1"]]
    auc_v2_raw = [
        float(v) if v not in ("—", "") else np.nan
        for v in df["AUC v2"]
    ]

    x    = np.arange(len(hazards))
    w    = 0.35
    fig, ax = plt.subplots(figsize=(14, 6))
    ax.bar(x - w/2, auc_v1,   w, label="v1 (Open-Meteo, 1,923 samples)", color="#4E79A7")
    ax.bar(x + w/2, auc_v2_raw, w, label="v2 (GEE, 27M samples)",          color="#F28E2B",
           alpha=0.9)
    ax.set_xticks(x)
    ax.set_xticklabels(hazards, rotation=30, ha="right", fontsize=9)
    ax.set_ylabel("ROC-AUC")
    ax.set_ylim(0.6, 1.02)
    ax.axhline(0.9, color="grey", linestyle="--", linewidth=0.8, label="AUC = 0.90 target")
    ax.legend()
    ax.set_title("AEGIS Multi-Hazard ROC-AUC: v1 vs v2", fontsize=12)
    plt.tight_layout()
    plt.savefig(str(out_path), dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Chart (PDF) → {out_path}")


def main(args: argparse.Namespace) -> None:
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[1/4] Loading v2 results from registry …")
    v2_results = load_v2_results()
    print(f"  Found v2 results for: {list(v2_results.keys())}")

    print("[2/4] Building comparison table …")
    df = build_comparison_table(v2_results)

    print("[3/4] Writing CSV and Markdown …")
    df.to_csv(str(out_dir / "model_comparison_v1_v2.csv"), index=False)
    write_markdown(df, out_dir / "model_comparison_v1_v2.md")

    print("[4/4] Rendering chart …")
    write_chart(df, out_dir / "model_comparison_v1_v2.pdf")

    print("\n" + df.to_string(index=False))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--output-dir", default=str(REPORT_DIR))
    return p.parse_args()


if __name__ == "__main__":
    main(parse_args())
