"""
File: ablation_study.py

What this file does:
Performs a systematic ablation study on the flood model — progressively
adds feature groups to a LightGBM classifier and measures the ROC-AUC
improvement at each stage.  The result is a publication-quality plot ideal
for a dissertation appendix ("how much does each feature class contribute?").

Feature groups (added cumulatively):
  Stage 1  Rainfall only       precipitation_1h, precipitation_6h, rain_7d, rain_30d
  Stage 2  + Soil moisture     soil_moisture_0_7, soil_moisture_28_100, runoff
  Stage 3  + Catchment static  elevation, slope, land_cover, soil_type
  Stage 4  + Climate macro     temperature, humidity, wind_speed, wind_gust,
                                sea_level_pressure, cape, ndvi, evapotranspiration,
                                seasonal_anomaly, rainfall_lt_anomaly, enso_index,
                                koppen_zone

Outputs:
  reports/flood_ablation.csv   — AUC + precision/recall per stage
  reports/flood_ablation.pdf   — step chart for dissertation figure

Glossary:
  ablation study  = removing/adding components of a system one-by-one to
                    measure each component's individual contribution to
                    overall performance
  LightGBM        = Light Gradient Boosting Machine — fast tree ensemble
  TimeSeriesSplit = cross-validation that never leaks future data into the
                    training fold; each fold's test set is always later than
                    its training set
  SHAP            = Shapley Additive exPlanations — measures how much each
                    feature shifted the model's prediction away from the average

How it connects:
  Reads from  ← data/processed/master_features_uk_2000_2024.parquet
              ← data/labels/flood_labels.parquet
  Writes to   → reports/flood_ablation.csv
              → reports/flood_ablation.pdf

Usage:
  python scripts/evaluation/ablation_study.py
  python scripts/evaluation/ablation_study.py --folds 10 --trials 50
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy  as np
    import pandas as pd
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install numpy pandas")

try:
    from lightgbm import LGBMClassifier
except ImportError:
    sys.exit("Missing: lightgbm\nRun: pip install lightgbm")

try:
    from sklearn.model_selection import TimeSeriesSplit
    from sklearn.metrics          import roc_auc_score, precision_score, recall_score
except ImportError:
    sys.exit("Missing: scikit-learn\nRun: pip install scikit-learn")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    sys.exit("Missing: matplotlib\nRun: pip install matplotlib")

_AI_ROOT   = Path(__file__).resolve().parents[2]
DATA_DIR   = _AI_ROOT / "data"
REPORT_DIR = _AI_ROOT / "reports"
SEED       = 42

FEATURE_STAGES: list[dict] = [
    {
        "name":     "Rainfall only",
        "features": [
            "rainfall_1h", "rainfall_6h",
            "rainfall_7d", "rainfall_30d",
        ],
    },
    {
        "name":     "+ Soil moisture",
        "features": [
            "rainfall_1h",        "rainfall_6h",
            "rainfall_7d",        "rainfall_30d",
            "soil_moisture",      "evapotranspiration", "river_level",
        ],
    },
    {
        "name":     "+ Catchment static",
        "features": [
            "rainfall_1h",        "rainfall_6h",
            "rainfall_7d",        "rainfall_30d",
            "soil_moisture",      "evapotranspiration", "river_level",
            "elevation",          "basin_slope",
            "land_use_encoded",   "soil_type_encoded",
        ],
    },
    {
        "name":     "+ Climate macro",
        "features": [
            "rainfall_1h",        "rainfall_6h",
            "rainfall_7d",        "rainfall_30d",
            "soil_moisture",      "evapotranspiration", "river_level",
            "elevation",          "basin_slope",
            "land_use_encoded",   "soil_type_encoded",
            "temperature",        "humidity",
            "wind_speed",
            "vegetation_index_ndvi",
            "seasonal_anomaly",   "long_term_rainfall_anomaly",
            "enso_index",         "climate_zone_encoding",
        ],
    },
    {
        "name":     "+ v2 GEE features",
        "features": [
            "rainfall_1h",              "rainfall_6h",
            "rainfall_7d",              "rainfall_30d",
            "soil_moisture",            "evapotranspiration", "river_level",
            "elevation",                "basin_slope",
            "land_use_encoded",         "soil_type_encoded",
            "temperature",              "humidity",
            "wind_speed",
            "vegetation_index_ndvi",
            "seasonal_anomaly",         "long_term_rainfall_anomaly",
            "enso_index",               "climate_zone_encoding",
            "catchment_area",           "drainage_density",
            "impervious_surface_ratio", "vegetation_class_encoded",
            "permeability_index",       "rainfall_24h",
        ],
    },
]


def load_data(master_path: Path, flood_labels_path: Path) -> pd.DataFrame:
    """Load master features, merge with flood labels, drop rows without label."""
    features = pd.read_parquet(str(master_path))
    labels   = pd.read_parquet(str(flood_labels_path))[["lat", "lon", "date", "flood_label"]]
    # Merge on lat+lon+date so every row has a label
    merged   = features.merge(labels, on=["lat", "lon", "date"], how="inner")
    merged   = merged.dropna(subset=["flood_label"])
    merged   = merged.sort_values("date")
    print(f"  Merged dataset: {len(merged):,} rows, "
          f"{merged['flood_label'].mean()*100:.1f}% positive")
    return merged


def evaluate_stage(
    df: pd.DataFrame,
    feature_cols: list[str],
    n_splits: int,
) -> dict[str, float]:
    """
    Run LightGBM with the given feature subset using TimeSeriesSplit CV.
    Returns mean ROC-AUC, precision, and recall across folds.
    """
    # Restrict to features that actually exist in the dataset
    avail = [c for c in feature_cols if c in df.columns]
    X = df[avail].fillna(0).values
    y = df["flood_label"].astype(int).values

    pos_frac = y.mean()
    scale_pw = (1.0 - pos_frac) / pos_frac if pos_frac > 0 else 1.0

    tscv   = TimeSeriesSplit(n_splits=n_splits)
    aucs, precs, recs = [], [], []

    for fold, (tr_idx, va_idx) in enumerate(tscv.split(X), 1):
        X_tr, y_tr = X[tr_idx], y[tr_idx]
        X_va, y_va = X[va_idx], y[va_idx]
        if y_va.sum() == 0:      # skip folds with no positives
            continue

        model = LGBMClassifier(
            n_estimators=300,
            learning_rate=0.05,
            max_depth=6,
            scale_pos_weight=scale_pw,
            random_state=SEED,
            n_jobs=-1,
            verbose=-1,
        )
        model.fit(X_tr, y_tr, eval_set=[(X_va, y_va)],
                  callbacks=[])
        probs = model.predict_proba(X_va)[:, 1]
        preds = (probs >= 0.5).astype(int)

        aucs.append(roc_auc_score(y_va, probs))
        precs.append(precision_score(y_va, preds, zero_division=0))
        recs.append(recall_score(y_va, preds, zero_division=0))

    return {
        "auc_mean":       float(np.mean(aucs))  if aucs else 0.0,
        "auc_std":        float(np.std(aucs))   if aucs else 0.0,
        "precision_mean": float(np.mean(precs)) if precs else 0.0,
        "recall_mean":    float(np.mean(recs))  if recs else 0.0,
        "n_features_used": len(avail),
    }


def plot_results(summary: pd.DataFrame, out_path: Path) -> None:
    """Step chart showing AUC improvement as feature groups are added."""
    x       = range(len(summary))
    labels  = summary["stage"].tolist()
    aucs    = summary["auc_mean"].tolist()
    stds    = summary["auc_std"].tolist()

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(x, aucs, marker="o", linewidth=2, color="#4E79A7", markersize=8)
    ax.fill_between(
        x,
        [a - s for a, s in zip(aucs, stds)],
        [a + s for a, s in zip(aucs, stds)],
        alpha=0.2, color="#4E79A7", label="±1 std (5-fold CV)",
    )
    for i, (auc, std) in enumerate(zip(aucs, stds)):
        ax.annotate(f"{auc:.3f}", xy=(i, auc), xytext=(0, 10),
                    textcoords="offset points", ha="center", fontsize=9)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("ROC-AUC (5-fold TimeSeriesSplit)")
    ax.set_ylim(0.5, 1.0)
    ax.axhline(0.90, color="grey", linestyle="--", linewidth=0.8, label="AUC = 0.90 target")
    ax.set_title("Flood Model Ablation Study: Feature Group Contribution", fontsize=12)
    ax.legend()
    plt.tight_layout()
    plt.savefig(str(out_path), dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Chart (PDF) → {out_path}")


def main(args: argparse.Namespace) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    master_path = DATA_DIR / "processed" / "master_features_uk_2000_2024.parquet"
    labels_path = DATA_DIR / "labels" / "flood_labels.parquet"

    if not master_path.exists():
        sys.exit(f"Master dataset not found: {master_path}\n"
                 "Run: python scripts/features/build_master_dataset.py")
    if not labels_path.exists():
        sys.exit(f"Flood labels not found: {labels_path}\n"
                 "Run: python scripts/labels/build_flood_labels.py")

    print("[1/3] Loading data …")
    df = load_data(master_path, labels_path)

    print("[2/3] Running ablation stages …")
    rows = []
    for stage_def in FEATURE_STAGES:
        print(f"  Stage: {stage_def['name']}  "
              f"({len(stage_def['features'])} features)")
        metrics = evaluate_stage(df, stage_def["features"], n_splits=args.folds)
        rows.append({"stage": stage_def["name"], **metrics})
        print(f"    AUC = {metrics['auc_mean']:.4f} ± {metrics['auc_std']:.4f}  "
              f"(precision={metrics['precision_mean']:.3f}, "
              f"recall={metrics['recall_mean']:.3f}, "
              f"n_features_used={metrics['n_features_used']})")

    summary = pd.DataFrame(rows)

    print("[3/3] Writing outputs …")
    summary.to_csv(str(REPORT_DIR / "flood_ablation.csv"), index=False)
    print(f"  CSV → {REPORT_DIR / 'flood_ablation.csv'}")
    plot_results(summary, REPORT_DIR / "flood_ablation.pdf")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--folds",  type=int, default=5,
                   help="Number of TimeSeriesSplit folds (default: 5)")
    return p.parse_args()


if __name__ == "__main__":
    main(parse_args())
