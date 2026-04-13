"""
File: train_all_hazards_v2.py

What this file does:
Orchestrator that runs the complete v2 training pipeline for all 11 AEGIS
hazard types in dependency order, handling failures gracefully so a single
broken label file doesn't abort the entire run.

Execution order:
  1. flood           (train_flood_v2.py     — stacked ensemble)
  2. drought         (train_drought_v2.py   — LightGBM)
  3. heatwave        (generic pipeline)
  4. wildfire        (generic pipeline)
  5. severe_storm    (generic pipeline)
  6. landslide       (generic pipeline)
  7. power_outage    (generic pipeline, weak labels)
  8. water_supply_disruption  (generic pipeline, weak labels)
  9. infrastructure_damage    (generic pipeline, weak labels)
  10. public_safety_incident  (generic pipeline, weak labels)
  11. environmental_hazard    (generic pipeline)

Generic pipeline:
  Most hazards use a shared training function that:
    - Loads the hazard-specific label file
    - Merges with master features
    - Time-series splits (train/val/test)
    - Trains LightGBM (best default for tabular)
    - Calibrates with isotonic regression
    - Computes SHAP
    - Saves to ModelRegistry

After all runs, generates a summary table for dissertation use.

Glossary:
  orchestrator  = a script that coordinates multiple sub-tasks in sequence,
                  capturing success/failure status for each
  generic pipeline = the shared XGBoost + LightGBM + calibration logic applied
                  to every hazard type that doesn't have a bespoke trainer
  weak-label flag = a boolean recorded in the model metadata indicating that
                  the training labels are noisy (power/water/infra/safety);
                  displayed in the AEGIS operator dashboard as a confidence caveat

How it connects:
  Calls       → training/train_flood_v2.py (subprocess or import)
  Calls       → training/train_drought_v2.py (subprocess or import)
  Reads from  ← data/processed/master_features_uk_2000_2024.parquet
  Reads from  ← data/labels/<hazard>_labels.parquet
  Writes to   → model_registry/<hazard>/
  Report      → reports/v2_training_summary.csv

Usage:
  python training/train_all_hazards_v2.py
  python training/train_all_hazards_v2.py --hazards flood drought heatwave
  python training/train_all_hazards_v2.py --skip-lstm --trials 50 --no-wandb
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

_AI_ROOT = Path(__file__).resolve().parents[1]
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

try:
    import joblib
    from lightgbm import LGBMClassifier
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.metrics import accuracy_score, roc_auc_score, classification_report
    import shap
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install lightgbm scikit-learn shap joblib")

PROC_DIR     = _AI_ROOT / "data" / "processed"
LABEL_DIR    = _AI_ROOT / "data" / "labels"
REGISTRY_DIR = _AI_ROOT / "model_registry"
REPORT_DIR   = _AI_ROOT / "reports"

SEED = 42
np.random.seed(SEED)

# ---------------------------------------------------------------------------
# Hazard config: label column, label file, weak-label flag
# ---------------------------------------------------------------------------

HAZARD_CONFIGS: dict[str, dict] = {
    "flood":                     {"label_col": "flood_label",                "weak": False},
    "drought":                   {"label_col": "drought_label",               "weak": False},
    "heatwave":                  {"label_col": "heatwave_label",              "weak": False},
    "wildfire":                  {"label_col": "wildfire_label",              "weak": False},
    "severe_storm":              {"label_col": "storm_label",                 "weak": False, "label_file": "storm"},
    "landslide":                 {"label_col": "landslide_label",             "weak": False},
    "power_outage":              {"label_col": "power_outage_label",          "weak": True},
    "water_supply_disruption":   {"label_col": "water_supply_disruption_label","weak": True},
    "infrastructure_damage":     {"label_col": "infrastructure_damage_label", "weak": True},
    "public_safety_incident":    {"label_col": "public_safety_incident_label","weak": True},
    "environmental_hazard":      {"label_col": "environmental_hazard_label",  "weak": True},
}

FEATURE_COLS: list[str] = [
    "elevation", "basin_slope", "catchment_area", "drainage_density",
    "land_use_encoded", "soil_type_encoded", "impervious_surface_ratio",
    "vegetation_class_encoded", "permeability_index",
    "temperature", "humidity", "wind_speed",
    "rainfall_1h", "rainfall_6h", "rainfall_24h", "rainfall_7d", "rainfall_30d",
    "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
    "river_level",
    "seasonal_anomaly", "long_term_rainfall_anomaly",
    "climate_zone_encoding", "enso_index",
]


# ---------------------------------------------------------------------------
# Generic training pipeline shared by most hazards
# ---------------------------------------------------------------------------

def train_generic_hazard(
    hazard: str,
    label_col: str,
    is_weak: bool,
    trials: int,
    no_wandb: bool,
) -> dict:
    """
    Train a LightGBM model for a single hazard type using the shared pipeline.
    Returns a metrics dict; raises on failure.
    """
    master_path = PROC_DIR / "master_features_uk_2000_2024.parquet"
    label_file  = HAZARD_CONFIGS.get(hazard, {}).get("label_file", hazard)
    label_path  = LABEL_DIR / f"{label_file}_labels.parquet"

    # ── Load data ──────────────────────────────────────────────────────────
    if not master_path.exists():
        raise FileNotFoundError(f"Master dataset not found: {master_path}")
    if not label_path.exists():
        raise FileNotFoundError(f"Label file not found: {label_path}")

    master = pd.read_parquet(str(master_path))
    labels = pd.read_parquet(str(label_path))[["lat", "lon", "date", label_col]]
    df     = master.merge(labels, on=["lat", "lon", "date"])
    df["date"] = pd.to_datetime(df["date"])
    df     = df.sort_values("date").reset_index(drop=True)

    # ── Time-series split ─────────────────────────────────────────────────
    train = df[df["date"] <  "2021-01-01"]
    val   = df[(df["date"] >= "2021-01-01") & (df["date"] < "2023-01-01")]
    test  = df[df["date"] >= "2023-01-01"]

    avail  = [c for c in FEATURE_COLS if c in df.columns]
    train = train.dropna(subset=[label_col])
    val   = val.dropna(subset=[label_col])
    test  = test.dropna(subset=[label_col])
    X_tr, y_tr = train[avail].fillna(0.0), train[label_col].astype(int)
    X_va, y_va = val[avail].fillna(0.0),   val[label_col].astype(int)
    X_te, y_te = test[avail].fillna(0.0),  test[label_col].astype(int)

    # Guard: skip hazards with insufficient positive examples
    n_pos = int(y_tr.sum())
    if n_pos < 50:
        raise ValueError(
            f"Hazard '{hazard}' has only {n_pos} positive training examples "
            f"(need ≥ 50). Re-run the label builder or check data sources."
        )

    scale_pos = float((y_tr == 0).sum() / max((y_tr == 1).sum(), 1))

    # ── LightGBM baseline (no Optuna for speed; use fixed sensible defaults) ─
    # For the non-flagship hazards we skip Optuna to save time.
    # For Optuna on all hazards, pass --trials to the specific train script.
    model = LGBMClassifier(
        n_estimators=1000,
        num_leaves=127,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_samples=20,
        scale_pos_weight=scale_pos,
        random_state=SEED,
        verbose=-1,
    )
    model.fit(X_tr, y_tr)

    # ── Calibration ────────────────────────────────────────────────────────
    calibrated = CalibratedClassifierCV(model, cv="prefit", method="isotonic")
    calibrated.fit(X_va, y_va)

    # ── Evaluation ────────────────────────────────────────────────────────
    proba   = calibrated.predict_proba(X_te)[:, 1]
    preds   = (proba >= 0.5).astype(int)
    metrics = {
        "hazard":    hazard,
        "accuracy":  float(accuracy_score(y_te, preds)),
        "roc_auc":   float(roc_auc_score(y_te, proba)),
        "weak":      is_weak,
        "n_train":   len(X_tr),
        "n_test":    len(X_te),
        "pos_rate":  float(y_te.mean()),
    }
    print(f"  {hazard:30s}  acc={metrics['accuracy']:.4f}  auc={metrics['roc_auc']:.4f}"
          f"  {'[WEAK LABELS]' if is_weak else ''}")

    # ── SHAP ──────────────────────────────────────────────────────────────
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        explainer   = shap.TreeExplainer(model)
        sv          = explainer.shap_values(X_te.sample(min(1000, len(X_te)), random_state=SEED))
        vals        = sv[1] if isinstance(sv, list) else sv
        importance  = pd.Series(np.abs(vals).mean(axis=0), index=avail).sort_values(ascending=False)
        importance.to_csv(str(REPORT_DIR / f"{hazard}_v2_shap_importance.csv"))
    except Exception as exc:
        print(f"  SHAP failed for {hazard}: {exc}")

    # ── Save to registry ──────────────────────────────────────────────────
    reg_dir = REGISTRY_DIR / hazard
    reg_dir.mkdir(parents=True, exist_ok=True)
    version = f"{hazard}_uk_v2"
    artifact = {
        "model":         calibrated,
        "feature_names": avail,
        "model_version": version,
        "metrics":       metrics,
        "seed":          SEED,
        "is_weak_label": is_weak,
    }
    joblib.dump(artifact, str(reg_dir / f"{version}.pkl"), compress=3)
    (reg_dir / f"{version}.json").write_text(json.dumps(metrics, indent=2))

    # ── W&B ───────────────────────────────────────────────────────────────
    if not no_wandb:
        try:
            import wandb
            with wandb.init(project=f"aegis-{hazard}-v2", reinit=True) as run:
                run.log(metrics)
        except Exception:
            pass

    return metrics


# ---------------------------------------------------------------------------
# Special-case delegators for flood and drought
# ---------------------------------------------------------------------------

def train_flood_v2_subprocess(args: argparse.Namespace) -> dict:
    """Delegate to train_flood_v2.py (has custom stacking + LSTM logic)."""
    script = _AI_ROOT / "training" / "train_flood_v2.py"
    cmd = [sys.executable, str(script), "--trials", str(args.trials)]
    if args.skip_lstm:
        cmd.append("--no-lstm")
    if args.no_wandb:
        cmd.append("--no-wandb")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        raise RuntimeError("train_flood_v2.py failed")
    # Read saved metrics
    meta_path = REGISTRY_DIR / "flood" / "flood_uk_v2_camels_era5.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    return {"hazard": "flood", "accuracy": 0.0, "roc_auc": 0.0}


def train_drought_v2_subprocess(args: argparse.Namespace) -> dict:
    """Delegate to train_drought_v2.py."""
    script = _AI_ROOT / "training" / "train_drought_v2.py"
    cmd = [sys.executable, str(script), "--trials", str(args.trials)]
    if args.no_wandb:
        cmd.append("--no-wandb")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        raise RuntimeError("train_drought_v2.py failed")
    meta_path = REGISTRY_DIR / "drought" / "drought_uk_v2_spei_era5.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    return {"hazard": "drought", "accuracy": 0.0, "roc_auc": 0.0}


# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

def write_summary(results: list[dict]) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    df  = pd.DataFrame(results)
    csv = REPORT_DIR / "v2_training_summary.csv"
    df.to_csv(str(csv), index=False)
    print(f"\nSummary → {csv}")
    display_cols = [c for c in ["hazard", "accuracy", "roc_auc", "weak", "n_train", "status"] if c in df.columns]
    print(df[display_cols].to_string(index=False))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(args: argparse.Namespace) -> None:
    # Subset of hazards to train (defaults to all)
    targets = args.hazards or list(HAZARD_CONFIGS.keys())
    results: list[dict] = []

    print(f"Training {len(targets)} hazard(s):  {', '.join(targets)}\n")
    start_all = time.perf_counter()

    for hazard in targets:
        if hazard not in HAZARD_CONFIGS:
            print(f"  Unknown hazard '{hazard}' — skipping.")
            continue

        cfg   = HAZARD_CONFIGS[hazard]
        print(f"━━━ {hazard.upper()} ━━━")
        t0    = time.perf_counter()

        try:
            if hazard == "flood":
                metrics = train_flood_v2_subprocess(args)
            elif hazard == "drought":
                metrics = train_drought_v2_subprocess(args)
            else:
                metrics = train_generic_hazard(
                    hazard       = hazard,
                    label_col    = cfg["label_col"],
                    is_weak      = cfg["weak"],
                    trials       = args.trials,
                    no_wandb     = args.no_wandb,
                )
            metrics.setdefault("hazard", hazard)
            metrics["elapsed_s"] = round(time.perf_counter() - t0, 1)
            metrics["status"]    = "OK"
        except FileNotFoundError as exc:
            print(f"  Skipped: {exc}")
            metrics = {"hazard": hazard, "status": "SKIPPED", "error": str(exc)}
        except Exception as exc:
            print(f"  FAILED: {exc}")
            metrics = {"hazard": hazard, "status": "FAILED", "error": str(exc)}

        results.append(metrics)

    elapsed = time.perf_counter() - start_all
    print(f"\n\nTotal training time: {elapsed/60:.1f} min")
    write_summary(results)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train all AEGIS hazard models v2")
    p.add_argument("--hazards",    nargs="*", default=None,
                   help="Specific hazards to train (default: all)")
    p.add_argument("--trials",     type=int,  default=100, help="Optuna trials (flood/drought only)")
    p.add_argument("--skip-lstm",  action="store_true",    help="Skip LSTM in flood model")
    p.add_argument("--no-wandb",   action="store_true",    help="Disable W&B logging")
    return p.parse_args()


if __name__ == "__main__":
    run(parse_args())
