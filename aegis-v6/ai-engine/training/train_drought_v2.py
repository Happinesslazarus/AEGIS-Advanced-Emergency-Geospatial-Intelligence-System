"""
File: train_drought_v2.py

What this file does:
Retrains the AEGIS drought prediction model using SPEI-3 labels from the
Global SPEI dataset and ERA5-Land features from the master dataset.

The current drought model scores only 72.5% accuracy / 0.786 ROC-AUC.
This is almost entirely a data quality problem: the v1 model trained on
1,923 reports from 10 locations.  With 27M rows and clean SPEI labels,
the target is > 85% accuracy / 0.90+ ROC-AUC.

Why LightGBM wins for drought:
  - Drought features (rainfall_30d, soil_moisture, NDVI) have many near-zero
    values with a long right tail — LightGBM leaf-wise growth handles this
    better than XGBoost's level-wise approach
  - Faster than XGBoost on this feature distribution
  - SHAP values work identically

Glossary:
  leaf-wise growth  = LightGBM's strategy: always split the leaf with the
                      highest loss reduction (vs XGBoost's level-wise which
                      grows all leaves at the same depth simultaneously)
  5-fold time-series CV = TimeSeriesSplit with 5 folds, each fold's training
                      window ending before its validation window — prevents
                      temporal data leakage while still using all the data

How it connects:
  Input  ← data/processed/master_features_uk_2000_2024.parquet
  Input  ← data/labels/drought_labels.parquet
  Output → model_registry/drought/drought_uk_v2_spei_era5.pkl
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_AI_ROOT = Path(__file__).resolve().parents[1]
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

try:
    import joblib
    import optuna
    import shap
    from lightgbm import LGBMClassifier
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.metrics import accuracy_score, roc_auc_score, classification_report
    from sklearn.model_selection import TimeSeriesSplit
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install lightgbm optuna shap scikit-learn joblib")

REGISTRY_DIR = _AI_ROOT / "model_registry" / "drought"
PROC_DIR     = _AI_ROOT / "data" / "processed"
LABEL_DIR    = _AI_ROOT / "data" / "labels"
REPORT_DIR   = _AI_ROOT / "reports"

SEED = 42
np.random.seed(SEED)


class CalibratedModel:
    """Module-level wrapper: applies isotonic calibration after LightGBM predict_proba.
    Must be at module level so joblib can pickle it correctly.
    """
    def __init__(self, base, iso):
        self._base = base
        self._iso  = iso

    def predict_proba(self, X):
        raw = self._base.predict_proba(X)[:, 1]
        cal = self._iso.predict(raw)
        return np.column_stack([1 - cal, cal])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)

    def __getattr__(self, name):
        return getattr(self._base, name)

# Features most predictive for drought (subset of the 28-feature schema)
DROUGHT_FEATURES: list[str] = [
    "rainfall_7d", "rainfall_30d", "long_term_rainfall_anomaly",
    "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
    "temperature", "seasonal_anomaly", "humidity",
    "elevation", "climate_zone_encoding", "enso_index",
    "land_use_encoded", "basin_slope",
]

LEAK_PRONE_DYNAMIC_COLS: list[str] = [
    "rainfall_7d", "rainfall_30d", "long_term_rainfall_anomaly",
    "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
    "temperature", "seasonal_anomaly", "humidity", "enso_index",
]


def load_data() -> pd.DataFrame:
    master_path = PROC_DIR / "master_features_uk_2000_2024.parquet"
    labels_path = LABEL_DIR / "drought_labels.parquet"
    if not master_path.exists():
        sys.exit(f"Master dataset not found: {master_path}")
    if not labels_path.exists():
        sys.exit(f"Drought labels not found: {labels_path}")
    master = pd.read_parquet(str(master_path))
    labels = pd.read_parquet(str(labels_path))[["lat", "lon", "date", "drought_label"]]
    df = master.merge(labels, on=["lat", "lon", "date"])
    df["date"] = pd.to_datetime(df["date"])
    lag_cols = [c for c in LEAK_PRONE_DYNAMIC_COLS if c in df.columns]
    if lag_cols:
        # Enforce past-only predictors per location to reduce temporal leakage.
        df = df.sort_values(["lat", "lon", "date"]).reset_index(drop=True)
        df[lag_cols] = df.groupby(["lat", "lon"], sort=False)[lag_cols].shift(1)
    return df.sort_values("date").reset_index(drop=True)


def get_xy(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    df = df.dropna(subset=["drought_label"]).copy()
    avail = [c for c in DROUGHT_FEATURES if c in df.columns]
    return df[avail].fillna(0.0), df["drought_label"].astype(int)


def run_optuna_lgbm(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    n_trials: int,
) -> LGBMClassifier:
    """Tune LightGBM for drought; uses 5-fold time-series CV inside each trial."""
    scale_pos = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))
    tscv = TimeSeriesSplit(n_splits=5)

    def objective(trial: optuna.Trial) -> float:
        params = {
            "n_estimators":      trial.suggest_int("n_estimators", 300, 3000),
            "num_leaves":        trial.suggest_int("num_leaves", 31, 512),
            "max_depth":         trial.suggest_int("max_depth", 3, 15),
            "learning_rate":     trial.suggest_float("learning_rate", 1e-3, 0.2, log=True),
            "subsample":         trial.suggest_float("subsample", 0.4, 1.0),
            "colsample_bytree":  trial.suggest_float("colsample_bytree", 0.4, 1.0),
            "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
            "reg_alpha":         trial.suggest_float("reg_alpha", 1e-5, 10, log=True),
            "reg_lambda":        trial.suggest_float("reg_lambda", 1e-5, 10, log=True),
            "scale_pos_weight":  scale_pos,
            "random_state":      SEED,
            "verbose":           -1,
        }
        fold_aucs = []
        X_full = pd.concat([X_train, X_val])
        y_full = pd.concat([y_train, y_val])
        for tr_idx, va_idx in tscv.split(X_full):
            m = LGBMClassifier(**params)
            m.fit(X_full.iloc[tr_idx], y_full.iloc[tr_idx])
            fold_aucs.append(roc_auc_score(y_full.iloc[va_idx],

                                            m.predict_proba(X_full.iloc[va_idx])[:, 1]))
        return float(np.mean(fold_aucs))

    study = optuna.create_study(direction="maximize",
                                pruner=optuna.pruners.MedianPruner(),
                                sampler=optuna.samplers.TPESampler(seed=SEED))
    study.optimize(objective, n_trials=n_trials, timeout=3600)

    best = study.best_params
    best.update({"scale_pos_weight": scale_pos, "random_state": SEED, "verbose": -1})

    # Final model: train on train+val for best test generalisation
    X_all = pd.concat([X_train, X_val])
    y_all = pd.concat([y_train, y_val])
    model = LGBMClassifier(**best)
    model.fit(X_all, y_all)
    return model


def evaluate(model: LGBMClassifier, X_test: pd.DataFrame, y_test: pd.Series) -> dict:
    proba  = model.predict_proba(X_test)[:, 1]
    preds  = (proba >= 0.5).astype(int)
    metrics = {
        "accuracy": float(accuracy_score(y_test, preds)),
        "roc_auc":  float(roc_auc_score(y_test, proba)),
    }
    print(f"\n  Test Accuracy : {metrics['accuracy']:.4f}")
    print(f"  Test ROC-AUC  : {metrics['roc_auc']:.4f}")
    print("\n" + classification_report(y_test, preds, digits=4))
    return metrics


def compute_shap(model: LGBMClassifier, X_test: pd.DataFrame, report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    explainer   = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_test.sample(min(2000, len(X_test)), random_state=SEED))
    vals        = shap_values[1] if isinstance(shap_values, list) else shap_values
    importance  = pd.Series(
        np.abs(vals).mean(axis=0), index=X_test.columns
    ).sort_values(ascending=False)
    importance.to_csv(str(report_dir / "drought_v2_shap_importance.csv"))
    print(f"  SHAP importance → {report_dir / 'drought_v2_shap_importance.csv'}")


def save_to_registry(model: LGBMClassifier, feature_cols: list[str], metrics: dict) -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    artifact = {
        "model":          model,
        "feature_names":  feature_cols,
        "model_version":  "drought_uk_v2_spei_era5",
        "metrics":        metrics,
        "seed":           SEED,
    }
    out_path  = REGISTRY_DIR / "drought_uk_v2_spei_era5.pkl"
    meta_path = REGISTRY_DIR / "drought_uk_v2_spei_era5.json"
    joblib.dump(artifact, str(out_path), compress=3)
    meta_path.write_text(json.dumps({**metrics, "feature_count": len(feature_cols)}, indent=2))
    print(f"\n  Model saved → {out_path}")


def run(args: argparse.Namespace) -> None:
    try:
        import wandb
        wb_run = wandb.init(project="aegis-drought-v2") if not args.no_wandb else None
    except Exception:
        wb_run = None

    print("[1/5] Loading data …")
    df = load_data()
    train = df[df["date"] < "2021-01-01"]
    val   = df[(df["date"] >= "2021-01-01") & (df["date"] < "2023-01-01")]
    test  = df[df["date"] >= "2023-01-01"]
    X_train, y_train = get_xy(train)
    X_val,   y_val   = get_xy(val)
    X_test,  y_test  = get_xy(test)

    print("[2/5] Tuning LightGBM with Optuna …")
    model = run_optuna_lgbm(X_train, y_train, X_val, y_val, args.trials)

    print("[3/5] Calibrating …")
    # sklearn 1.6+ removed cv='prefit'; calibrate manually with isotonic regression
    from sklearn.isotonic import IsotonicRegression as _Iso
    _iso = _Iso(out_of_bounds="clip")
    _val_proba = model.predict_proba(X_val)[:, 1]
    _iso.fit(_val_proba, y_val)
    calibrated = CalibratedModel(model, _iso)

    print("[4/5] Evaluating on test set …")
    metrics = evaluate(calibrated, X_test, y_test)
    compute_shap(model, X_test, REPORT_DIR)

    if wb_run is not None:
        try:
            wb_run.log(metrics)
            wb_run.finish()
        except Exception:
            pass

    print("[5/5] Saving to registry …")
    save_to_registry(calibrated, list(X_train.columns), metrics)
    print("\nDone. Use POST /registry/promote with version=drought_uk_v2_spei_era5 to deploy.")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--trials",   type=int, default=100)
    p.add_argument("--no-wandb", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    run(parse_args())
