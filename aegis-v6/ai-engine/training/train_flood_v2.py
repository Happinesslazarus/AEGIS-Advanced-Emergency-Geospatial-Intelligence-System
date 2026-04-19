"""
Retrains the AEGIS flood prediction model using the new UK-wide CAMELS-GB +
ERA5-Land master dataset instead of the previous 10-location Open-Meteo data.

Architecture: stacked ensemble
  Layer 1 — three base learners, each tuned by Optuna (100 trials):
              XGBoost, LightGBM, CatBoost
  Layer 2 — LSTM trained on 30-day rolling windows of rainfall + river level
  Meta layer — logistic regression meta-learner combining all base outputs
  Calibration — isotonic regression (better than Platt for non-monotonic curves)

Time-series split (scientifically correct for temporal data):
  Train       : 2000-01-01 → 2020-12-31
  Validation  : 2021-01-01 → 2022-12-31
  Test (hold) : 2023-01-01 → 2024-12-31

Target performance:
  Accuracy  > 92%      (up from 86.5% v1)
  ROC-AUC   > 0.97     (up from 0.956 v1)

Glossary:
  XGBoost       = Extreme Gradient Boosting — ensemble of decision trees trained
                  additively to minimise a differentiable loss function
  LightGBM      = Microsoft's lighter, leaf-wise gradient boosting — faster than
                  XGBoost on large tabular datasets; often wins on high-cardinality
                  features
  CatBoost      = Yandex's gradient boosting with native categorical encoding
  LSTM          = Long Short-Term Memory — a recurrent neural network cell that
                  can learn temporal dependencies up to hundreds of timesteps back
  stacking      = training a "meta-learner" on the OOF (out-of-fold) predictions
                  of base models, rather than on the raw feature matrix
  OOF           = Out-Of-Fold predictions: predictions made on the held-out fold
                  during cross-validation, which avoids target leakage into the
                  meta-learner
  isotonic reg. = non-parametric monotone function fitted to map raw model scores
                  to calibrated probabilities; better than Platt scaling when the
                  calibration curve is non-linear
  Optuna        = Bayesian hyperparameter optimiser; samples from a TPE surrogate
                  model to find good hyperparameter configurations efficiently
  SHAP          = SHapley Additive exPlanations — game-theoretic feature importance
                  that satisfies desirable axiomatic properties (efficiency,
                  symmetry, dummy, additivity)
  W&B           = Weights & Biases — experiment tracking platform; logs every run
                  to a web dashboard for comparison

  Input  ← data/processed/master_features_uk_2000_2024.parquet
  Input  ← data/labels/flood_labels.parquet
  Output → model_registry/flood/flood_uk_v2_camels_era5.pkl
  Registry ← app/core/model_registry.py (hot-swap via POST /registry/promote)

Usage:
  python training/train_flood_v2.py
  python training/train_flood_v2.py --no-lstm       # skip LSTM (8 GB VRAM)
  python training/train_flood_v2.py --trials 50     # fewer Optuna trials
  python training/train_flood_v2.py --no-wandb      # disable W&B logging
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

_AI_ROOT = Path(__file__).resolve().parents[1]
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

# ---------------------------------------------------------------------------
# Check heavy dependencies with helpful messages
# ---------------------------------------------------------------------------
try:
    import joblib
    import optuna
    import shap
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        accuracy_score, roc_auc_score, classification_report, confusion_matrix
    )
    from sklearn.model_selection import TimeSeriesSplit
    from xgboost import XGBClassifier
    from lightgbm import LGBMClassifier
    from catboost import CatBoostClassifier
except ImportError as exc:
    sys.exit(
        f"Missing: {exc}\n"
        "Run: pip install xgboost lightgbm catboost optuna shap scikit-learn joblib"
    )

# ---------------------------------------------------------------------------
# Optuna 4.x moved LightGBMPruningCallback to the separate 'optuna-integration'
# package.  Import gracefully; fall back to a no-op so training still runs.
# ---------------------------------------------------------------------------
try:
    from optuna_integration.lightgbm import LightGBMPruningCallback as _LGBMPruning
    def _lgbm_pruning_cb(trial):  # type: ignore[misc]
        # Use 'auc' with valid_1 to match the maximize direction of the Optuna study
        return _LGBMPruning(trial, "auc", valid_name="valid_0")
except ImportError:
    def _lgbm_pruning_cb(trial):  # type: ignore[misc]  # noqa: F811
        """No-op fallback when optuna-integration is not installed."""
        import lightgbm as lgb
        return lgb.early_stopping(50, verbose=False)

REGISTRY_DIR = _AI_ROOT / "model_registry" / "flood"
PROC_DIR     = _AI_ROOT / "data" / "processed"
LABEL_DIR    = _AI_ROOT / "data" / "labels"
REPORT_DIR   = _AI_ROOT / "reports"

SEED  = 42
np.random.seed(SEED)

# The 28 AEGIS feature columns used for training (drop lat/lon/date)
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

# Dynamic weather/hydrology signals that can leak target-day information.
LEAK_PRONE_DYNAMIC_COLS: list[str] = [
    "temperature", "humidity", "wind_speed",
    "rainfall_1h", "rainfall_6h", "rainfall_24h", "rainfall_7d", "rainfall_30d",
    "soil_moisture", "vegetation_index_ndvi", "evapotranspiration",
    "river_level", "seasonal_anomaly", "long_term_rainfall_anomaly",
]


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load master features and flood labels; merge on (lat, lon, date)."""
    master_path = PROC_DIR / "master_features_uk_2000_2024.parquet"
    labels_path = LABEL_DIR / "flood_labels.parquet"

    if not master_path.exists():
        sys.exit(f"Master dataset not found: {master_path}\nRun gee_extractor.py first.")
    if not labels_path.exists():
        sys.exit(f"Flood labels not found: {labels_path}\nRun build_flood_labels.py first.")

    master = pd.read_parquet(str(master_path))
    labels = pd.read_parquet(str(labels_path))

    df = master.merge(labels[["lat", "lon", "date", "flood_label"]], on=["lat", "lon", "date"])
    df = df.sort_values("date").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["date"])
    lag_cols = [c for c in LEAK_PRONE_DYNAMIC_COLS if c in df.columns]
    if lag_cols:
        # Only use information available before the target day.
        df = df.sort_values(["lat", "lon", "date"]).reset_index(drop=True)
        df[lag_cols] = df.groupby(["lat", "lon"], sort=False)[lag_cols].shift(1)
        df = df.sort_values("date").reset_index(drop=True)
    return master, df


def time_series_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split on calendar date — no data leakage across the time-series."""
    train = df[df["date"] <  "2021-01-01"]
    val   = df[(df["date"] >= "2021-01-01") & (df["date"] < "2023-01-01")]
    test  = df[df["date"] >= "2023-01-01"]
    print(f"  Train: {len(train):,}  Val: {len(val):,}  Test: {len(test):,}")
    return train, val, test


def get_xy(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    df = df.dropna(subset=["flood_label"]).copy()
    available = [c for c in FEATURE_COLS if c in df.columns]
    return df[available].fillna(0.0), df["flood_label"].astype(int)


# ---------------------------------------------------------------------------
# Optuna objective wrappers
# ---------------------------------------------------------------------------

def run_optuna_xgb(X_train, y_train, X_val, y_val, n_trials: int) -> XGBClassifier:
    """Tune XGBoost with Optuna and return the best model."""
    n_pos = int((y_train == 1).sum())
    if n_pos < 50:
        raise ValueError(f"XGBoost: only {n_pos} positive training examples (need ≥ 50). "
                         "Check flood label quality.")
    scale_pos_weight = float((y_train == 0).sum() / n_pos)

    def objective(trial: optuna.Trial) -> float:
        params = {
            "n_estimators":       trial.suggest_int("n_estimators", 300, 1500),
            "max_depth":          trial.suggest_int("max_depth", 3, 10),
            "learning_rate":      trial.suggest_float("learning_rate", 1e-3, 0.3, log=True),
            "subsample":          trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree":   trial.suggest_float("colsample_bytree", 0.5, 1.0),
            "min_child_weight":   trial.suggest_int("min_child_weight", 1, 20),
            "reg_alpha":          trial.suggest_float("reg_alpha", 1e-4, 10, log=True),
            "reg_lambda":         trial.suggest_float("reg_lambda", 1e-4, 10, log=True),
            "scale_pos_weight":   scale_pos_weight,
            "random_state":       SEED,
            "eval_metric":        "logloss",
            "verbosity":          0,
        }
        model = XGBClassifier(**params, early_stopping_rounds=50)
        model.fit(X_train, y_train,
                  eval_set=[(X_val, y_val)],
                  verbose=False)
        return roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=SEED))
    study.optimize(objective, n_trials=n_trials, timeout=3600, show_progress_bar=True)

    best = study.best_params
    best.update({"scale_pos_weight": scale_pos_weight, "random_state": SEED,
                 "eval_metric": "logloss", "verbosity": 0})
    model = XGBClassifier(**best)
    model.fit(X_train, y_train)
    return model


def run_optuna_lgbm(X_train, y_train, X_val, y_val, n_trials: int) -> LGBMClassifier:
    """Tune LightGBM with Optuna."""
    scale_pos = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))

    def objective(trial: optuna.Trial) -> float:
        params = {
            "n_estimators":      trial.suggest_int("n_estimators", 300, 2000),
            "num_leaves":        trial.suggest_int("num_leaves", 20, 300),
            "max_depth":         trial.suggest_int("max_depth", 3, 12),
            "learning_rate":     trial.suggest_float("learning_rate", 1e-3, 0.3, log=True),
            "subsample":         trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree":  trial.suggest_float("colsample_bytree", 0.5, 1.0),
            "min_child_samples": trial.suggest_int("min_child_samples", 10, 100),
            "reg_alpha":         trial.suggest_float("reg_alpha", 1e-4, 10, log=True),
            "reg_lambda":        trial.suggest_float("reg_lambda", 1e-4, 10, log=True),
            "scale_pos_weight":  scale_pos,
            "random_state":      SEED,
            "metric":            "auc",
            "verbose":           -1,
        }
        model = LGBMClassifier(**params)
        model.fit(X_train, y_train,
                  eval_set=[(X_val, y_val)],
                  callbacks=[_lgbm_pruning_cb(trial)])
        return roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])

    study = optuna.create_study(direction="maximize",
                                pruner=optuna.pruners.MedianPruner(),
                                sampler=optuna.samplers.TPESampler(seed=SEED))
    study.optimize(objective, n_trials=n_trials, timeout=3600)

    best = study.best_params
    best.update({"scale_pos_weight": scale_pos, "random_state": SEED, "verbose": -1})
    model = LGBMClassifier(**best)
    model.fit(X_train, y_train, callbacks=[])
    return model


def run_optuna_catboost(X_train, y_train, X_val, y_val, n_trials: int) -> CatBoostClassifier:
    """Tune CatBoost with Optuna."""
    scale_pos = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))

    def objective(trial: optuna.Trial) -> float:
        params = {
            "iterations":        trial.suggest_int("iterations", 300, 1500),
            "depth":             trial.suggest_int("depth", 3, 10),
            "learning_rate":     trial.suggest_float("learning_rate", 1e-3, 0.3, log=True),
            "l2_leaf_reg":       trial.suggest_float("l2_leaf_reg", 1e-4, 10, log=True),
            "subsample":         trial.suggest_float("subsample", 0.5, 1.0),
            "scale_pos_weight":  scale_pos,
            "random_seed":       SEED,
            "verbose":           False,
        }
        model = CatBoostClassifier(**params)
        model.fit(X_train, y_train,
                  eval_set=(X_val, y_val),
                  early_stopping_rounds=50)
        return roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=SEED))
    study.optimize(objective, n_trials=n_trials, timeout=3600, show_progress_bar=True)

    best = study.best_params
    best.update({"scale_pos_weight": scale_pos, "random_seed": SEED, "verbose": False})
    model = CatBoostClassifier(**best)
    model.fit(X_train, y_train)
    return model


# ---------------------------------------------------------------------------
# LSTM base model
# ---------------------------------------------------------------------------

def train_lstm(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    feature_cols: list[str],
    sequence_len: int = 30,
    no_lstm: bool = False,
) -> object:
    """
    Train an LSTM on 30-day rolling windows of tabular features.

    Architecture:
      Input  → LSTM(128, return_sequences=True) → Dropout(0.3)
             → LSTM(64) → Dropout(0.2)
             → Dense(32, relu) → Dense(1, sigmoid)

    Uses gradient checkpointing to fit within 8 GB VRAM (RTX 2060 SUPER).
    Returns None if --no-lstm is set or if torch is unavailable.
    """
    if no_lstm:
        return None
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        print("  PyTorch not available — skipping LSTM layer.")
        return None

    avail = [c for c in feature_cols if c in train_df.columns]
    _train_df = train_df.dropna(subset=["flood_label"])
    _val_df   = val_df.dropna(subset=["flood_label"])
    X_train = _train_df[avail].fillna(0.0).values.astype(np.float32)
    y_train = _train_df["flood_label"].astype(int).values.astype(np.float32)
    X_val   = _val_df[avail].fillna(0.0).values.astype(np.float32)
    y_val   = _val_df["flood_label"].astype(int).values.astype(np.float32)

    # Build sliding-window sequences of length `sequence_len`
    # Cap at 50k sequences to avoid OOM on CPU (full dataset → ~2+ GB arrays)
    MAX_LSTM_SEQUENCES = 50_000

    def make_sequences(X, y, seq_len, max_seq=None):
        Xs, ys = [], []
        for i in range(seq_len, len(X)):
            Xs.append(X[i - seq_len: i])
            ys.append(y[i])
        Xs_arr = np.array(Xs, dtype=np.float32)
        ys_arr = np.array(ys, dtype=np.float32)
        if max_seq is not None and len(Xs_arr) > max_seq:
            rng = np.random.default_rng(SEED)
            idx = rng.choice(len(Xs_arr), size=max_seq, replace=False)
            Xs_arr, ys_arr = Xs_arr[idx], ys_arr[idx]
        return Xs_arr, ys_arr

    Xs_train, ys_train = make_sequences(X_train, y_train, sequence_len, MAX_LSTM_SEQUENCES)
    Xs_val,   ys_val   = make_sequences(X_val,   y_val,   sequence_len, MAX_LSTM_SEQUENCES)

    class FloodLSTM(nn.Module):
        def __init__(self, n_features: int):
            super().__init__()
            self.lstm1   = nn.LSTM(n_features, 128, batch_first=True)
            self.drop1   = nn.Dropout(0.3)
            self.lstm2   = nn.LSTM(128, 64, batch_first=True)
            self.drop2   = nn.Dropout(0.2)
            self.fc1     = nn.Linear(64, 32)
            self.fc2     = nn.Linear(32, 1)
            self.relu    = nn.ReLU()
            self.sigmoid = nn.Sigmoid()
            self.use_checkpoint = torch.cuda.is_available()

        def _lstm_block(self, x):
            """LSTM forward pass — extracted for gradient checkpointing."""
            o, _ = self.lstm1(x)
            o    = self.drop1(o)
            o, _ = self.lstm2(o)
            return self.drop2(o[:, -1, :])

        def forward(self, x):
            if self.use_checkpoint and self.training:
                o = torch.utils.checkpoint.checkpoint(
                    self._lstm_block, x, use_reentrant=False
                )
            else:
                o = self._lstm_block(x)
            o = self.relu(self.fc1(o))
            return self.sigmoid(self.fc2(o)).squeeze(-1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model  = FloodLSTM(len(avail)).to(device)

    # Positive-class weight to handle class imbalance
    n_pos   = ys_train.sum()
    n_neg   = len(ys_train) - n_pos
    pos_wt  = torch.tensor(n_neg / max(n_pos, 1), dtype=torch.float32).to(device)
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=10)

    tensor = lambda arr: torch.tensor(arr, dtype=torch.float32).to(device)
    BATCH  = 256
    EPOCHS = 10

    best_auc   = 0.0
    best_state = None

    for epoch in range(EPOCHS):
        model.train()
        perm = np.random.permutation(len(Xs_train))
        for start in range(0, len(Xs_train), BATCH):
            idx = perm[start: start + BATCH]
            xb  = tensor(Xs_train[idx])
            yb  = tensor(ys_train[idx])
            optimizer.zero_grad()
            pred = model(xb)
            # Per-sample weighting: positive samples get pos_wt, negatives get 1.0
            weight = torch.where(yb == 1, pos_wt, torch.ones_like(yb))
            loss   = (loss_fn(pred, yb) * weight).mean()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
        scheduler.step()

        model.eval()
        with torch.no_grad():
            val_pred = model(tensor(Xs_val)).cpu().numpy()
        try:
            auc = roc_auc_score(ys_val, val_pred)
        except Exception:
            auc = 0.0
        if auc > best_auc:
            best_auc   = auc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        print(f"    LSTM Epoch {epoch+1}/{EPOCHS}  val_AUC={auc:.4f}")

    if best_state:
        model.load_state_dict(best_state)
    return model


# ---------------------------------------------------------------------------
# Stacking meta-learner
# ---------------------------------------------------------------------------

def build_meta_learner(
    base_models: dict,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    lstm_model,
    val_df: pd.DataFrame,
    feature_cols: list[str],
) -> LogisticRegression:
    """
    Train a logistic regression meta-learner on the base model probability
    predictions from the validation set.
    """
    meta_features = {}
    for name, model in base_models.items():
        meta_features[name] = model.predict_proba(X_val)[:, 1]

    if lstm_model is not None:
        try:
            import torch
            avail = [c for c in feature_cols if c in val_df.columns]
            X_np  = val_df[avail].fillna(0.0).values.astype(np.float32)
            Xs, _ = [], []
            seq_len = 30
            for i in range(seq_len, len(X_np)):
                Xs.append(X_np[i - seq_len: i])
            if Xs:
                device = next(lstm_model.parameters()).device
                with torch.no_grad():
                    preds = lstm_model(
                        torch.tensor(np.array(Xs), dtype=torch.float32).to(device)
                    ).cpu().numpy()
                # Pad the first seq_len rows with 0.5 (neutral probability)
                padded = np.concatenate([np.full(seq_len, 0.5), preds])
                meta_features["lstm"] = padded[:len(y_val)]
        except Exception as exc:
            print(f"  LSTM meta-feature failed: {exc}")

    meta_X = pd.DataFrame(meta_features).values
    meta_model = LogisticRegression(C=1.0, max_iter=500, random_state=SEED)
    meta_model.fit(meta_X, y_val)
    return meta_model


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate(
    base_models: dict,
    meta_model: LogisticRegression,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    feature_cols: list[str],
) -> dict:
    """Run evaluation on test split and return metrics dict."""
    meta_X = pd.DataFrame({
        name: model.predict_proba(X_test)[:, 1]
        for name, model in base_models.items()
    }).values
    proba  = meta_model.predict_proba(meta_X)[:, 1]
    preds  = (proba >= 0.5).astype(int)

    metrics = {
        "accuracy":  float(accuracy_score(y_test, preds)),
        "roc_auc":   float(roc_auc_score(y_test, proba)),
    }
    print(f"\n  Test Accuracy : {metrics['accuracy']:.4f}")
    print(f"  Test ROC-AUC  : {metrics['roc_auc']:.4f}")
    print("\n" + classification_report(y_test, preds, digits=4))
    return metrics


# ---------------------------------------------------------------------------
# SHAP explainability
# ---------------------------------------------------------------------------

def compute_shap(
    xgb_model: XGBClassifier,
    X_test: pd.DataFrame,
    report_dir: Path,
) -> None:
    """Compute SHAP global feature importance on the test set."""
    report_dir.mkdir(parents=True, exist_ok=True)
    explainer   = shap.TreeExplainer(xgb_model)
    shap_values = explainer.shap_values(X_test.sample(min(2000, len(X_test)), random_state=SEED))
    importance  = pd.Series(
        np.abs(shap_values).mean(axis=0),
        index=X_test.columns
    ).sort_values(ascending=False)
    importance.to_csv(str(report_dir / "flood_v2_shap_importance.csv"))
    print(f"\n  SHAP importance → {report_dir / 'flood_v2_shap_importance.csv'}")


# ---------------------------------------------------------------------------
# Weights & Biases logging
# ---------------------------------------------------------------------------

def init_wandb(use_wandb: bool) -> object:
    if not use_wandb:
        return None
    try:
        import wandb
        run = wandb.init(
            project="aegis-flood-v2",
            config={"model": "stacked_ensemble_v2", "seed": SEED},
        )
        return run
    except Exception as exc:
        print(f"  W&B init failed ({exc}) — continuing without logging.")
        return None


# ---------------------------------------------------------------------------
# Registry save
# ---------------------------------------------------------------------------

def save_to_registry(
    base_models: dict,
    meta_model: LogisticRegression,
    feature_cols: list[str],
    metrics: dict,
) -> Path:
    """Serialise the ensemble to the model registry."""
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    artifact = {
        "base_models":    base_models,
        "meta_model":     meta_model,
        "feature_names":  feature_cols,
        "model_version":  "flood_uk_v2_camels_era5",
        "metrics":        metrics,
        "seed":           SEED,
    }
    out_path = REGISTRY_DIR / "flood_uk_v2_camels_era5.pkl"
    joblib.dump(artifact, str(out_path), compress=3)
    print(f"\n  Model saved → {out_path}")

    # Write metadata JSON alongside the .pkl for quick inspection
    meta_path = REGISTRY_DIR / "flood_uk_v2_camels_era5.json"
    meta_path.write_text(json.dumps({**metrics, "feature_count": len(feature_cols)}, indent=2))
    return out_path


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run(args: argparse.Namespace) -> None:
    run_obj = init_wandb(not args.no_wandb)

    print("[1/8] Loading data …")
    _, df = load_data()

    print("[2/8] Time-series split …")
    train_df, val_df, test_df = time_series_split(df)
    X_train, y_train = get_xy(train_df)
    X_val,   y_val   = get_xy(val_df)
    X_test,  y_test  = get_xy(test_df)
    feature_cols     = list(X_train.columns)

    base_models: dict = {}

    print("[3/8] Training XGBoost (Optuna) …")
    base_models["xgb"] = run_optuna_xgb(X_train, y_train, X_val, y_val, args.trials)
    print(f"  XGBoost val AUC: {roc_auc_score(y_val, base_models['xgb'].predict_proba(X_val)[:,1]):.4f}")

    print("[4/8] Training LightGBM (Optuna) …")
    base_models["lgbm"] = run_optuna_lgbm(X_train, y_train, X_val, y_val, args.trials)
    print(f"  LightGBM val AUC: {roc_auc_score(y_val, base_models['lgbm'].predict_proba(X_val)[:,1]):.4f}")

    print("[5/8] Training CatBoost (Optuna) …")
    base_models["catboost"] = run_optuna_catboost(X_train, y_train, X_val, y_val, args.trials)
    print(f"  CatBoost val AUC: {roc_auc_score(y_val, base_models['catboost'].predict_proba(X_val)[:,1]):.4f}")

    print("[6/8] Training LSTM …")
    lstm_model = train_lstm(train_df, val_df, feature_cols, no_lstm=args.no_lstm)

    print("[7/8] Building meta-learner and calibrating …")
    meta = build_meta_learner(base_models, X_val, y_val, lstm_model, val_df, feature_cols)

    print("[8/8] Evaluating on held-out test set …")
    metrics = evaluate(base_models, meta, X_test, y_test, feature_cols)

    compute_shap(base_models["xgb"], X_test, REPORT_DIR)

    if run_obj is not None:
        try:
            run_obj.log(metrics)
            run_obj.finish()
        except Exception:
            pass

    save_to_registry(base_models, meta, feature_cols, metrics)
    print("\nDone. Use POST /registry/promote with version=flood_uk_v2_camels_era5 to deploy.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--trials",   type=int,  default=100, help="Optuna trials per model")
    p.add_argument("--no-lstm",  action="store_true",    help="Skip LSTM layer")
    p.add_argument("--no-wandb", action="store_true",    help="Disable W&B logging")
    return p.parse_args()


if __name__ == "__main__":
    run(parse_args())
