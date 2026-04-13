"""
File: build_drought_labels.py

What this file does:
Assigns binary drought labels to the master feature dataset using the Global
SPEI (Standardised Precipitation-Evapotranspiration Index) dataset.

SPEI values are dimensionless z-scores: negative = drier than normal,
positive = wetter than normal.  The standard WMO threshold for moderate
drought is SPEI-3 < -1.0 (i.e. the 3-month accumulated moisture deficit is
more than 1 standard deviation below the historical mean).

Labels:
  drought_label = 1   if SPEI-3 ≤ -1.0  (moderate to extreme drought)
  drought_label = 0   otherwise

Glossary:
  SPEI-3     = Standardised Precipitation-Evapotranspiration Index
               accumulated over 3 months; negative = dry, positive = wet
  WMO        = World Meteorological Organisation — defines the drought thresholds
  z-score    = a value expressed as standard deviations from the mean of a
               reference distribution; SPEI is calibrated to the standard
               normal distribution (mean=0, std=1)
  0.5° grid  = the SPEI dataset resolution: one pixel = 0.5 × 0.5 degrees
               (roughly 55 km × 35 km at UK latitudes)
  linear interpolation = filling values between two known grid points by
               assuming a straight-line change — used here to match SPEI's
               monthly resolution to the daily master dataset

How it connects:
  Input  ← data/processed/master_features_uk_2000_2024.parquet
  Input  ← data/raw/labels/spei03.nc  (download instructions below)
  Output → data/labels/drought_labels.parquet
  Used by← ai-engine/training/train_drought_v2.py

Download:
  SPEI Global Drought Monitor (free, no account needed):
  https://spei.csic.es/database.html
  → Download "SPEI-03" NetCDF file → save as data/raw/labels/spei03.nc
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy as np
    import pandas as pd
    from tqdm import tqdm
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install pandas numpy tqdm pyarrow")

_AI_ROOT   = Path(__file__).resolve().parents[2]
_RAW_LDIR  = _AI_ROOT / "data" / "raw" / "labels"
_PROC_DIR  = _AI_ROOT / "data" / "processed"
_LABEL_DIR = _AI_ROOT / "data" / "labels"

# SPEI threshold: values below this are labelled as drought
DROUGHT_THRESHOLD = -1.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_spei_netcdf(nc_path: Path) -> pd.DataFrame:
    """
    Load the SPEI-3 NetCDF file and flatten into a tidy DataFrame with
    columns: lat, lon, year, month, spei3

    The SPEI NetCDF stores data as a 3-D array (time × lat × lon).  We use
    xarray to handle the CF-compliant time axis and variable names.
    """
    try:
        import xarray as xr
    except ImportError:
        sys.exit("Missing xarray. Run: pip install xarray netCDF4")

    ds   = xr.open_dataset(str(nc_path))
    var  = "spei"  # standard variable name in the SPEI Global Drought Monitor

    # Flatten to tidy rows
    df   = ds[var].to_dataframe().reset_index()
    df   = df.rename(columns={"latitude": "lat", "longitude": "lon"})

    # Extract year and month from the time coordinate
    df["year"]  = pd.to_datetime(df["time"]).dt.year
    df["month"] = pd.to_datetime(df["time"]).dt.month
    df = df.drop(columns=["time"], errors="ignore")
    df = df.dropna(subset=[var])
    df = df.rename(columns={var: "spei3"})
    return df


def nearest_spei_value(
    spei_df: pd.DataFrame,
    lat: float,
    lon: float,
    year: int,
    month: int,
) -> float:
    """
    Return the SPEI-3 value for the grid cell nearest to (lat, lon) in the
    given year-month.  SPEI has 0.5° resolution, so nearest-cell lookup
    introduces at most ~0.25° error (~28 km at UK latitudes — acceptable).
    """
    # Round to nearest 0.5° grid centre
    lat_r = round(lat * 2) / 2
    lon_r = round(lon * 2) / 2

    row = spei_df[
        (spei_df["lat"]   == lat_r) &
        (spei_df["lon"]   == lon_r) &
        (spei_df["year"]  == year)  &
        (spei_df["month"] == month)
    ]
    if row.empty:
        return np.nan
    return float(row["spei3"].iloc[0])


# ---------------------------------------------------------------------------
# Main labelling
# ---------------------------------------------------------------------------

def build_drought_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/4] Loading master features …")
    master = pd.read_parquet(str(args.master))
    master["date_dt"] = pd.to_datetime(master["date"])
    master["year"]    = master["date_dt"].dt.year
    master["month"]   = master["date_dt"].dt.month
    print(f"  {len(master):,} rows")

    spei_path = args.spei or (_RAW_LDIR / "spei03.nc")

    if not spei_path.exists():
        if not args.allow_heuristic_fallback:
            sys.exit(
                f"\nSPEI file not found at: {spei_path}\n"
                "Leak-safe mode is enabled, so synthetic drought labels are disabled.\n"
                "Download SPEI-03 from https://spei.csic.es/database.html and save as\n"
                "data/raw/labels/spei03.nc, or re-run with --allow-heuristic-fallback."
            )

        print(
            f"\n  SPEI file not found at {spei_path}.\n"
            "  WARNING: using heuristic fallback labels (for debugging only)."
        )
        # Fallback heuristic: hot-dry months using in-dataset meteorology.
        if "rainfall_30d" in master.columns and "temperature" in master.columns:
            rain_q15 = master.groupby("month")["rainfall_30d"].transform(
                lambda x: x.quantile(0.15)
            )
            temp_q85 = master.groupby("month")["temperature"].transform(
                lambda x: x.quantile(0.85)
            )
            drought_label = (
                (master["rainfall_30d"] <= rain_q15) &
                (master["temperature"]  >= temp_q85)
            ).astype(int)
        else:
            drought_label = pd.Series(0, index=master.index)
    else:
        print("[2/4] Loading SPEI NetCDF …")
        spei_df = load_spei_netcdf(spei_path)
        print(f"  SPEI records: {len(spei_df):,}")

        print("[3/4] Joining SPEI to master rows (nearest-cell monthly lookup) …")
        # Build a monthly lookup dict for fast access: (lat_r, lon_r, year, month) → spei3
        spei_df["lat_r"] = (spei_df["lat"] * 2).round() / 2
        spei_df["lon_r"] = (spei_df["lon"] * 2).round() / 2
        spei_idx = spei_df.set_index(["lat_r", "lon_r", "year", "month"])["spei3"].to_dict()

        lat_r = (master["lat"] * 2).round() / 2
        lon_r = (master["lon"] * 2).round() / 2

        spei_col = pd.Series(np.nan, index=master.index)
        for i, (lr, lor, yr, mo) in enumerate(
            tqdm(
                zip(lat_r, lon_r, master["year"], master["month"]),
                total=len(master),
                desc="SPEI join"
            )
        ):
            spei_col.iat[i] = spei_idx.get((lr, lor, yr, mo), np.nan)

        drought_label = (spei_col <= DROUGHT_THRESHOLD).astype(int)

    print("[4/4] Saving labels …")
    out = master[["lat", "lon", "date"]].copy()
    out["drought_label"] = drought_label

    out_path = args.output or (_LABEL_DIR / "drought_labels.parquet")
    out.to_parquet(str(out_path), index=False, compression="snappy")

    pos_rate = drought_label.mean() * 100
    print(f"\n  Saved → {out_path}")
    print(f"  Positive rate: {pos_rate:.2f}%  (expect 10-15% with real SPEI)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path, default=_PROC_DIR / "master_features_uk_2000_2024.parquet")
    p.add_argument("--spei",   type=Path, default=None, help="Path to spei03.nc")
    p.add_argument("--output", type=Path, default=None)
    p.add_argument(
        "--allow-heuristic-fallback",
        action="store_true",
        help="Allow synthetic fallback labels when SPEI file is missing (not for final evaluation).",
    )
    return p.parse_args()


if __name__ == "__main__":
    build_drought_labels(parse_args())
