"""
File: build_heatwave_labels.py

What this file does:
Computes binary heatwave labels directly from the ERA5-Land temperature
column in the master feature dataset — no external download needed.

Definition used (UK Met Office standard):
  A heatwave occurs when the maximum daily temperature exceeds the
  region-specific threshold for 3 or more consecutive days.

UK county-level thresholds (°C):
  South England (lat < 52.0)    → 28°C
  Midlands/North England        → 25°C
  Wales                         → 25°C
  Scotland                      → 22°C

Glossary:
  rolling window    = a sliding computation applied to a sorted time-series;
                      here a 3-day minimum of daily T-max tells us if the
                      temperature has been sustained for 3 days
  T-max             = maximum daily air temperature; ERA5-Land reports
                      temperature_2m at daily resolution (we treat it as
                      representative of the daily maximum)
  region threshold  = the Met Office's county-specific temperature value
                      above which daytime heat is considered dangerous

How it connects:
  Input  ← data/processed/master_features_uk_2000_2024.parquet
              (must contain 'temperature' and 'date' columns)
  Output → data/labels/heatwave_labels.parquet
  Used by← ai-engine/training/train_all_hazards_v2.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy  as np
    import pandas as pd
    from tqdm import tqdm
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install pandas numpy tqdm pyarrow")

_AI_ROOT   = Path(__file__).resolve().parents[2]
_PROC_DIR  = _AI_ROOT / "data" / "processed"
_LABEL_DIR = _AI_ROOT / "data" / "labels"


def get_threshold(lat: float) -> float:
    """Return the Met Office heatwave threshold (°C) for a given latitude."""
    if lat < 52.0:
        return 28.0   # South England
    if lat < 55.0:
        return 25.0   # Midlands / North England / Wales
    return 22.0       # Scotland


def build_heatwave_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/3] Loading master features …")
    master = pd.read_parquet(str(args.master))
    print(f"  {len(master):,} rows")

    if "temperature" not in master.columns:
        sys.exit("Master dataset missing 'temperature' column.")

    print("[2/3] Computing heatwave labels per spatial cell …")
    master = master.sort_values(["lat", "lon", "date"]).copy()
    master["_threshold"] = master["lat"].apply(get_threshold)

    labels = pd.Series(0, index=master.index, dtype=int)

    # Group by spatial cell and compute rolling 3-day minimum temperature.
    # If the 3-day minimum exceeds the threshold, all 3 days are labelled 1.
    for (lat_val, lon_val), cell_df in tqdm(
        master.groupby(["lat", "lon"]),
        desc="Cells",
        unit="cell"
    ):
        threshold = get_threshold(lat_val)
        temps     = cell_df["temperature"]

        # rolling(3).min() gives the minimum temperature over the preceding 3 days.
        # When the minimum is above the threshold, all days in that window are hot.
        rolling_min = temps.rolling(3, min_periods=3).min()
        heatwave_flag = (rolling_min > threshold).astype(int)

        # Mark all 3 days of the window, not just the third day
        # by forward-extending the flag back across the window
        # (a 3-day shift of the rolling flag covers the run)
        extended = heatwave_flag.copy()
        for lag in [1, 2]:
            extended = extended | heatwave_flag.shift(-lag, fill_value=0)

        labels.loc[cell_df.index] = extended.astype(int).values

    print("[3/3] Saving …")
    out = master[["lat", "lon", "date"]].copy()
    out["heatwave_label"] = labels

    out_path = args.output or (_LABEL_DIR / "heatwave_labels.parquet")
    out.to_parquet(str(out_path), index=False, compression="snappy")
    pos_rate = labels.mean() * 100
    print(f"\n  Saved → {out_path}")
    print(f"  Positive rate: {pos_rate:.2f}%")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path, default=_PROC_DIR / "master_features_uk_2000_2024.parquet")
    p.add_argument("--output", type=Path, default=None)
    return p.parse_args()


if __name__ == "__main__":
    build_heatwave_labels(parse_args())
