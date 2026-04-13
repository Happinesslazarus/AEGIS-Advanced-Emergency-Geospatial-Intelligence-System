"""
File: cross_region_test.py

What this file does:
Validates that the AEGIS flood model's features are geographically
transferable — that a model trained on one UK region can make useful
predictions in a completely held-out region it has never seen.

This matters because:
  • SEPA (Scotland) and EA (England+Wales) use different spatial densities
  • Scottish catchments have shorter, steeper hydrographs than English ones
  • A model that fails cross-region transfer is over-fit to terrain specifics,
    not learning the underlying rainfall-runoff physics

Test design:
  Region A  English Lowlands   lat < 53.5°N   (Thames, Severn, Great Ouse)
  Region B  Northern England   53.5°N ≤ lat < 55.5°N  (Tyne, Eden, Ribble)
  Region C  Scotland           lat ≥ 55.5°N   (Tay, Clyde, Dee)

  Cross-region trains (3 × 2 = 6 runs):
    Train A → Test B, Test C
    Train B → Test A, Test C
    Train C → Test A, Test B
  Plus 3 with-held-out baselines:
    Train A∪B → Test C   (Scotland generalisation)
    Train A∪C → Test B   (Northern England generalisation)
    Train B∪C → Test A   (Lowlands generalisation)

Outputs:
  reports/cross_region_results.csv    — all 9 runs
  reports/cross_region_heatmap.pdf    — source→target AUC heatmap

How it connects:
  Reads from  ← data/processed/master_features_uk_2000_2024.parquet
              ← data/labels/flood_labels.parquet
  Writes to   → reports/

Usage:
  python scripts/evaluation/cross_region_test.py
  python scripts/evaluation/cross_region_test.py --estimators 200
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
    from sklearn.metrics import (
        roc_auc_score, accuracy_score,
        precision_score, recall_score, f1_score,
    )
except ImportError:
    sys.exit("Missing: scikit-learn\nRun: pip install scikit-learn")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install matplotlib seaborn")

_AI_ROOT   = Path(__file__).resolve().parents[2]
DATA_DIR   = _AI_ROOT / "data"
REPORT_DIR = _AI_ROOT / "reports"
SEED       = 42

FEATURE_COLS = [
    "rainfall_1h",              "rainfall_6h",             "rainfall_7d",              "rainfall_30d",
    "soil_moisture",            "evapotranspiration",       "river_level",
    "elevation",                "basin_slope",             "land_use_encoded",          "soil_type_encoded",
    "temperature",              "humidity",                "wind_speed",
    "vegetation_index_ndvi",
    "seasonal_anomaly",         "long_term_rainfall_anomaly", "enso_index",             "climate_zone_encoding",
    "catchment_area",           "drainage_density",        "impervious_surface_ratio",
    "vegetation_class_encoded", "permeability_index",      "rainfall_24h",
]

REGIONS = {
    "English Lowlands":  lambda lat: lat <  53.5,
    "Northern England":  lambda lat: (lat >= 53.5) & (lat < 55.5),
    "Scotland":          lambda lat: lat >= 55.5,
}

# Combined-source experiments for wider training sets
COMBINED_EXPERIMENTS = [
    {"train": ["English Lowlands", "Northern England"], "test": "Scotland"},
    {"train": ["English Lowlands", "Scotland"],         "test": "Northern England"},
    {"train": ["Northern England",  "Scotland"],        "test": "English Lowlands"},
]


def load_data(master_path: Path, labels_path: Path) -> pd.DataFrame:
    """Merge master features with flood labels."""
    feats  = pd.read_parquet(str(master_path))
    labels = pd.read_parquet(str(labels_path))[["lat", "lon", "date", "flood_label"]]
    df     = feats.merge(labels, on=["lat", "lon", "date"], how="inner")
    df     = df.dropna(subset=["flood_label"])
    df     = df.sort_values("date")
    print(f"  Combined rows: {len(df):,}  "
          f"positive={df['flood_label'].mean()*100:.1f}%")
    return df


def assign_region(df: pd.DataFrame) -> pd.DataFrame:
    """Add a 'region' column based on latitude."""
    df = df.copy()
    df["region"] = "Unknown"
    for name, mask_fn in REGIONS.items():
        df.loc[mask_fn(df["lat"]), "region"] = name
    return df


def train_and_eval(
    train_df: pd.DataFrame,
    test_df:  pd.DataFrame,
    n_estimators: int,
) -> dict:
    """Train LightGBM on train_df, evaluate on test_df."""
    avail  = [c for c in FEATURE_COLS if c in train_df.columns]
    X_tr   = train_df[avail].fillna(0).values
    y_tr   = train_df["flood_label"].astype(int).values
    X_te   = test_df[avail].fillna(0).values
    y_te   = test_df["flood_label"].astype(int).values

    if y_te.sum() == 0:
        return {"roc_auc": np.nan, "accuracy": np.nan,
                "precision": np.nan, "recall": np.nan, "f1": np.nan,
                "n_train": len(X_tr), "n_test": len(X_te)}

    pos_frac = y_tr.mean()
    scale_pw = (1.0 - pos_frac) / max(pos_frac, 1e-6)

    model = LGBMClassifier(
        n_estimators=n_estimators,
        learning_rate=0.05,
        max_depth=6,
        scale_pos_weight=scale_pw,
        random_state=SEED,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(X_tr, y_tr)
    probs = model.predict_proba(X_te)[:, 1]
    preds = (probs >= 0.5).astype(int)

    return {
        "roc_auc":   round(float(roc_auc_score(y_te, probs)), 4),
        "accuracy":  round(float(accuracy_score(y_te, preds)), 4),
        "precision": round(float(precision_score(y_te, preds, zero_division=0)), 4),
        "recall":    round(float(recall_score(y_te, preds, zero_division=0)), 4),
        "f1":        round(float(f1_score(y_te, preds, zero_division=0)), 4),
        "n_train":   int(len(X_tr)),
        "n_test":    int(len(X_te)),
    }


def plot_heatmap(auc_matrix: pd.DataFrame, out_path: Path) -> None:
    """Source→target AUC heatmap; diagonal = in-distribution performance."""
    fig, ax = plt.subplots(figsize=(8, 6))
    mask    = auc_matrix.isna()
    sns.heatmap(
        auc_matrix.astype(float),
        annot=True, fmt=".3f",
        mask=mask,
        cmap="RdYlGn",
        vmin=0.5, vmax=1.0,
        linewidths=0.5,
        ax=ax,
    )
    ax.set_title("Cross-Region ROC-AUC: Train Region → Test Region", fontsize=11)
    ax.set_xlabel("Test Region")
    ax.set_ylabel("Train Region")
    plt.tight_layout()
    plt.savefig(str(out_path), dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Heatmap → {out_path}")


def main(args: argparse.Namespace) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    master_path = DATA_DIR / "processed" / "master_features_uk_2000_2024.parquet"
    labels_path = DATA_DIR / "labels" / "flood_labels.parquet"

    if not master_path.exists():
        sys.exit("Master dataset not found.  Run build_master_dataset.py first.")
    if not labels_path.exists():
        sys.exit("Flood labels not found.  Run build_flood_labels.py first.")

    print("[1/4] Loading data …")
    df = load_data(master_path, labels_path)
    df = assign_region(df)
    region_names = list(REGIONS.keys())

    for rname in region_names:
        n = (df["region"] == rname).sum()
        print(f"  {rname}: {n:,} rows")

    print("[2/4] Single-region cross-validation …")
    rows = []
    # 3×3 matrix: train on A, test on B
    auc_grid = pd.DataFrame(index=region_names, columns=region_names, dtype=object)

    for train_region in region_names:
        for test_region in region_names:
            train_df = df[df["region"] == train_region]
            test_df  = df[df["region"] == test_region]
            label    = ("In-distribution" if train_region == test_region
                        else f"{train_region} → {test_region}")
            metrics  = train_and_eval(train_df, test_df, args.estimators)
            auc_grid.loc[train_region, test_region] = metrics["roc_auc"]
            rows.append({
                "experiment":   label,
                "train_region": train_region,
                "test_region":  test_region,
                **metrics,
            })
            sym = "" if train_region == test_region else "↗"
            print(f"  {sym} {label}: AUC={metrics['roc_auc']}")

    print("[3/4] Combined-source generalisation experiments …")
    for exp in COMBINED_EXPERIMENTS:
        train_df = df[df["region"].isin(exp["train"])]
        test_df  = df[df["region"] == exp["test"]]
        label    = f"{' + '.join(exp['train'])} → {exp['test']}"
        metrics  = train_and_eval(train_df, test_df, args.estimators)
        rows.append({
            "experiment":   label,
            "train_region": " + ".join(exp["train"]),
            "test_region":  exp["test"],
            **metrics,
        })
        print(f"  ↗ {label}: AUC={metrics['roc_auc']}")

    print("[4/4] Writing outputs …")
    results = pd.DataFrame(rows)
    results.to_csv(str(REPORT_DIR / "cross_region_results.csv"), index=False)
    print(f"  CSV → {REPORT_DIR / 'cross_region_results.csv'}")

    auc_float = auc_grid.apply(pd.to_numeric, errors="coerce")
    plot_heatmap(auc_float, REPORT_DIR / "cross_region_heatmap.pdf")

    # Summary statistics
    cross_aucs = [r["roc_auc"] for r in rows
                  if r["train_region"] != r.get("test_region", "") and
                  isinstance(r["roc_auc"], float)]
    if cross_aucs:
        print(f"\n  Cross-region AUC range: "
              f"{min(cross_aucs):.3f} – {max(cross_aucs):.3f}  "
              f"(mean={np.mean(cross_aucs):.3f})")
        print("  ✓ Region adapter pattern validated"
              if min(cross_aucs) >= 0.75 else
              "  ⚠ AUC < 0.75 for some region pairs — consider per-region fine-tuning")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--estimators", type=int, default=300,
                   help="LightGBM estimators per run (default: 300)")
    return p.parse_args()


if __name__ == "__main__":
    main(parse_args())
