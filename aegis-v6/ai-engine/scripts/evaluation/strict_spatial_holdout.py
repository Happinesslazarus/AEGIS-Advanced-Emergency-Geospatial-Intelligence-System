"""
Strict spatial holdout evaluation for leakage-resistant model validation.

What this script does:
1. Loads master features + hazard labels
2. Enforces region holdout (train regions -> test region)
3. Enforces temporal holdout (train < 2023-01-01, test >= 2023-01-01)
4. Optionally lags dynamic features by one timestep per location
5. Trains a LightGBM baseline and reports robust metrics

Default split:
  Train regions: English Lowlands + Northern England
  Test region:   Scotland

Usage:
  python scripts/evaluation/strict_spatial_holdout.py --hazard flood
  python scripts/evaluation/strict_spatial_holdout.py --hazard drought --allow-missing-spei
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError as exc:
    sys.exit(f"Missing: {exc}\\nRun: pip install pandas")

try:
    from lightgbm import LGBMClassifier
except ImportError:
    sys.exit("Missing: lightgbm\\nRun: pip install lightgbm")

try:
    from sklearn.metrics import (
        roc_auc_score,
        average_precision_score,
        accuracy_score,
        precision_score,
        recall_score,
        f1_score,
    )
except ImportError:
    sys.exit("Missing: scikit-learn\\nRun: pip install scikit-learn")


_AI_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = _AI_ROOT / "data"
REPORT_DIR = _AI_ROOT / "reports"
SEED = 42


REGIONS = {
    "English Lowlands": lambda lat: lat < 53.5,
    "Northern England": lambda lat: (lat >= 53.5) & (lat < 55.5),
    "Scotland": lambda lat: lat >= 55.5,
}


HAZARD_CONFIG = {
    "flood": {
        "label_col": "flood_label",
        "label_file": "flood_labels.parquet",
        "features": [
            "rainfall_1h", "rainfall_6h", "rainfall_24h", "rainfall_7d", "rainfall_30d",
            "soil_moisture", "evapotranspiration", "river_level",
            "temperature", "humidity", "wind_speed", "vegetation_index_ndvi",
            "seasonal_anomaly", "long_term_rainfall_anomaly",
            "elevation", "basin_slope", "catchment_area", "drainage_density",
            "land_use_encoded", "soil_type_encoded", "impervious_surface_ratio",
            "vegetation_class_encoded", "permeability_index",
            "climate_zone_encoding", "enso_index",
        ],
        "leak_prone_dynamic": [
            "temperature", "humidity", "wind_speed",
            "rainfall_1h", "rainfall_6h", "rainfall_24h", "rainfall_7d", "rainfall_30d",
            "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
            "river_level", "seasonal_anomaly", "long_term_rainfall_anomaly",
        ],
    },
    "drought": {
        "label_col": "drought_label",
        "label_file": "drought_labels.parquet",
        "features": [
            "rainfall_7d", "rainfall_30d", "long_term_rainfall_anomaly",
            "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
            "temperature", "seasonal_anomaly", "humidity",
            "elevation", "climate_zone_encoding", "enso_index",
            "land_use_encoded", "basin_slope",
        ],
        "leak_prone_dynamic": [
            "rainfall_7d", "rainfall_30d", "long_term_rainfall_anomaly",
            "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
            "temperature", "seasonal_anomaly", "humidity", "enso_index",
        ],
    },
}


def assign_region(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["region"] = "Unknown"
    for name, mask_fn in REGIONS.items():
        df.loc[mask_fn(df["lat"]), "region"] = name
    return df


def detect_flood_proxy_only(labels: pd.DataFrame) -> bool:
    required = ["label_polygon", "label_dartmouth", "label_camels", "flood_label"]
    if any(c not in labels.columns for c in required):
        return False
    total_pos = int((labels["flood_label"] == 1).sum())
    ext_pos = int(((labels["label_polygon"] == 1) | (labels["label_dartmouth"] == 1) | (labels["label_camels"] == 1)).sum())
    return total_pos > 0 and ext_pos == 0


def load_merged(hazard: str, allow_proxy_labels: bool, allow_missing_spei: bool) -> pd.DataFrame:
    cfg = HAZARD_CONFIG[hazard]
    master_path = DATA_DIR / "processed" / "master_features_uk_2000_2024.parquet"
    labels_path = DATA_DIR / "labels" / cfg["label_file"]

    if not master_path.exists():
        sys.exit(f"Master dataset not found: {master_path}")
    if not labels_path.exists():
        sys.exit(f"Label file not found: {labels_path}")

    master = pd.read_parquet(str(master_path))
    labels = pd.read_parquet(str(labels_path))

    if hazard == "flood":
        if detect_flood_proxy_only(labels) and not allow_proxy_labels:
            sys.exit(
                "Flood labels appear proxy-only (no external positives). "
                "Rebuild with real external labels, or run with --allow-proxy-labels for debug-only evaluation."
            )

    if hazard == "drought":
        spei_path = DATA_DIR / "raw" / "labels" / "spei03.nc"
        if not spei_path.exists() and not allow_missing_spei:
            sys.exit(
                f"SPEI file missing: {spei_path}. "
                "For leak-safe drought evaluation, provide SPEI first. "
                "Use --allow-missing-spei only for debug runs."
            )

    keep_cols = ["lat", "lon", "date", cfg["label_col"]]
    df = master.merge(labels[keep_cols], on=["lat", "lon", "date"], how="inner")
    df["date"] = pd.to_datetime(df["date"])
    df = df.dropna(subset=[cfg["label_col"]]).copy()
    return df


def apply_past_only_lag(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    lag_cols = [c for c in cols if c in df.columns]
    if not lag_cols:
        return df
    out = df.sort_values(["lat", "lon", "date"]).reset_index(drop=True)
    out[lag_cols] = out.groupby(["lat", "lon"], sort=False)[lag_cols].shift(1)
    return out.sort_values("date").reset_index(drop=True)


def parse_regions(text: str) -> list[str]:
    vals = [v.strip() for v in text.split(",") if v.strip()]
    unknown = [v for v in vals if v not in REGIONS]
    if unknown:
        sys.exit(f"Unknown regions: {unknown}. Valid: {list(REGIONS.keys())}")
    return vals


def main(args: argparse.Namespace) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    cfg = HAZARD_CONFIG[args.hazard]

    print("[1/5] Loading and validating data ...")
    df = load_merged(args.hazard, args.allow_proxy_labels, args.allow_missing_spei)
    df = assign_region(df)

    if args.lag_dynamic:
        df = apply_past_only_lag(df, cfg["leak_prone_dynamic"])

    feature_cols = [c for c in cfg["features"] if c in df.columns]
    if not feature_cols:
        sys.exit("No configured features found in merged dataset.")

    train_regions = parse_regions(args.train_regions)
    test_region = args.test_region
    if test_region not in REGIONS:
        sys.exit(f"Unknown test region: {test_region}")

    print("[2/5] Building strict spatial+temporal split ...")
    train_cutoff = pd.Timestamp(args.train_end)
    test_start = pd.Timestamp(args.test_start)

    train_df = df[(df["region"].isin(train_regions)) & (df["date"] < train_cutoff)]
    test_df = df[(df["region"] == test_region) & (df["date"] >= test_start)]

    # Prevent location overlap by construction and verify anyway
    train_locs = set(zip(train_df["lat"].round(6), train_df["lon"].round(6)))
    test_locs = set(zip(test_df["lat"].round(6), test_df["lon"].round(6)))
    overlap = len(train_locs.intersection(test_locs))

    y_train = train_df[cfg["label_col"]].astype(int)
    y_test = test_df[cfg["label_col"]].astype(int)

    print(f"  Train rows: {len(train_df):,}  positives={y_train.mean()*100:.2f}%")
    print(f"  Test rows:  {len(test_df):,}  positives={y_test.mean()*100:.2f}%")
    print(f"  Unique locations overlap: {overlap:,}")

    if len(train_df) == 0 or len(test_df) == 0:
        sys.exit("Empty train/test split. Adjust region or date boundaries.")
    if y_train.nunique() < 2:
        sys.exit("Training split has only one class; cannot train classifier.")
    if y_test.nunique() < 2:
        sys.exit("Test split has only one class; cannot compute AUC/PR-AUC.")
    if overlap > 0:
        sys.exit("Spatial overlap detected between train/test locations. Split is not strict.")

    print("[3/5] Training LightGBM baseline ...")
    X_train = train_df[feature_cols].fillna(0.0)
    X_test = test_df[feature_cols].fillna(0.0)

    pos_frac = y_train.mean()
    scale_pw = (1.0 - pos_frac) / max(pos_frac, 1e-6)

    model = LGBMClassifier(
        n_estimators=args.estimators,
        learning_rate=0.05,
        max_depth=6,
        scale_pos_weight=scale_pw,
        random_state=SEED,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(X_train, y_train)

    print("[4/5] Evaluating holdout metrics ...")
    proba = model.predict_proba(X_test)[:, 1]
    preds = (proba >= 0.5).astype(int)

    metrics = {
        "hazard": args.hazard,
        "train_regions": train_regions,
        "test_region": test_region,
        "train_end": args.train_end,
        "test_start": args.test_start,
        "lag_dynamic": bool(args.lag_dynamic),
        "n_features": len(feature_cols),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "train_positive_rate": float(y_train.mean()),
        "test_positive_rate": float(y_test.mean()),
        "location_overlap": int(overlap),
        "roc_auc": float(roc_auc_score(y_test, proba)),
        "pr_auc": float(average_precision_score(y_test, proba)),
        "accuracy": float(accuracy_score(y_test, preds)),
        "precision": float(precision_score(y_test, preds, zero_division=0)),
        "recall": float(recall_score(y_test, preds, zero_division=0)),
        "f1": float(f1_score(y_test, preds, zero_division=0)),
    }

    print(f"  ROC-AUC: {metrics['roc_auc']:.4f}")
    print(f"  PR-AUC : {metrics['pr_auc']:.4f}")
    print(f"  F1     : {metrics['f1']:.4f}")

    print("[5/5] Writing outputs ...")
    prefix = args.output_prefix
    out_json = REPORT_DIR / f"{prefix}_{args.hazard}.json"
    out_csv = REPORT_DIR / f"{prefix}_{args.hazard}.csv"

    out_json.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    pd.DataFrame([metrics]).to_csv(str(out_csv), index=False)

    print(f"  JSON -> {out_json}")
    print(f"  CSV  -> {out_csv}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--hazard", choices=list(HAZARD_CONFIG.keys()), default="flood")
    p.add_argument("--train-regions", default="English Lowlands,Northern England")
    p.add_argument("--test-region", default="Scotland")
    p.add_argument("--train-end", default="2023-01-01")
    p.add_argument("--test-start", default="2023-01-01")
    p.add_argument("--estimators", type=int, default=300)
    p.add_argument("--output-prefix", default="strict_spatial_holdout")
    p.add_argument("--lag-dynamic", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--allow-proxy-labels", action="store_true")
    p.add_argument("--allow-missing-spei", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    main(parse_args())
