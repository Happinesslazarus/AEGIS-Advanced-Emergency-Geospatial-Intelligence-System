"""
File: build_wildfire_labels.py

What this file does:
Labels each master-dataset row as wildfire-positive if NASA FIRMS (Fire
Information for Resource Management System) detected an active fire within
5 km of that row's location in the 7 days following the row's date.

Glossary:
  FIRMS         = NASA Fire Information for Resource Management System;
                  continuously processes MODIS Terra/Aqua (1 km) and VIIRS
                  S-NPP (375 m) satellite detections of active fires
  FRP           = Fire Radiative Power (MW) — pixel-level energy emitted by
                  a fire; higher values indicate larger/more intense burns
  confidence    = FIRMS per-pixel quality flag: nominal/high = reliable
                  detection; low = possible false positive (artefact from
                  sun glint or hot bare ground)
  5 km radius   = maximum distance between a sample point and a fire pixel
                  for the point to be labelled positive; chosen to match
                  the spatial resolution of the lowest-confidence FIRMS data
  7-day horizon = a wildfire risk label looks 7 days *forward* — we want the
                  model to predict ignition risk before it happens, not just
                  detect ongoing fires

Download:
  FIRMS UK data (MODIS + VIIRS, 2000-2024, CSV):
    https://firms.modaps.eosdis.nasa.gov/download/
    → Select "South/Southeast Asia" → change to Europe/UK bbox
    → Instrument: MODIS_NRT + VIIRS_SNPP_NRT
    → Date range: 2000-01-01 to 2024-12-31
    → Format: CSV
  Save as: data/raw/labels/firms_uk.csv

How it connects:
  Input  ← data/processed/master_features_uk_2000_2024.parquet
  Input  ← data/raw/labels/firms_uk.csv
  Output → data/labels/wildfire_labels.parquet
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
_RAW_LDIR  = _AI_ROOT / "data" / "raw" / "labels"
_PROC_DIR  = _AI_ROOT / "data" / "processed"
_LABEL_DIR = _AI_ROOT / "data" / "labels"

FIRE_RADIUS_KM  = 5       # label positive within 5 km of a fire pixel
HORIZON_DAYS    = 7       # look 7 days forward for fire occurrence


# ---------------------------------------------------------------------------
# Haversine helper (vectorised)
# ---------------------------------------------------------------------------

def haversine_km(lat1: pd.Series, lon1: pd.Series, lat2: float, lon2: float) -> pd.Series:
    """Return great-circle distance in km between (lat1, lon1) and (lat2, lon2)."""
    R = 6371.0
    dlat = np.radians(lat1 - lat2)
    dlon = np.radians(lon1 - lon2)
    a = (np.sin(dlat / 2) ** 2
         + np.cos(np.radians(lat2))
         * np.cos(np.radians(lat1))
         * np.sin(dlon / 2) ** 2)
    return R * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_wildfire_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/4] Loading master features …")
    master = pd.read_parquet(str(args.master))
    master["date_dt"] = pd.to_datetime(master["date"])
    print(f"  {len(master):,} rows")

    firms_path = args.firms or (_RAW_LDIR / "firms_uk.csv")
    if not firms_path.exists():
        print(
            f"\n  FIRMS file not found at {firms_path}.\n"
            "  Download from https://firms.modaps.eosdis.nasa.gov/download/\n"
            "  Generating zero-label placeholder — re-run after download.\n"
        )
        master["wildfire_label"] = 0
        out = master[["lat", "lon", "date", "wildfire_label"]]
        out_path = args.output or (_LABEL_DIR / "wildfire_labels.parquet")
        out.to_parquet(str(out_path), index=False, compression="snappy")
        return

    print("[2/4] Loading FIRMS fire detections …")
    firms = pd.read_csv(str(firms_path))

    # Normalise column names (MODIS and VIIRS use slightly different headers)
    firms.columns = firms.columns.str.lower()
    lat_col  = next(c for c in firms.columns if "latitude"  in c or c == "lat")
    lon_col  = next(c for c in firms.columns if "longitude" in c or c == "lon")
    date_col = next(c for c in firms.columns if "acq_date" in c or "date" in c)

    firms = firms.rename(columns={lat_col: "f_lat", lon_col: "f_lon", date_col: "f_date"})
    firms["f_date"] = pd.to_datetime(firms["f_date"])

    # Keep only nominal/high confidence detections to reduce false positives
    if "confidence" in firms.columns:
        firms = firms[firms["confidence"].astype(str).str.lower().isin(["nominal", "high", "h", "n"])]

    print(f"  {len(firms):,} fire pixels (high-confidence)")

    print("[3/4] Labelling master rows (vectorised event-driven) …")
    labels = pd.Series(0, index=master.index, dtype=int)

    # Sort FIRMS by date and spatial-index master by (lat, lon) for fast lookup
    firms = firms.sort_values("f_date").reset_index(drop=True)
    master_dates = master["date_dt"]

    # Process fire events in daily batches (much faster than iterating master rows)
    fire_dates = sorted(firms["f_date"].dt.normalize().unique())
    print(f"  Unique fire days: {len(fire_dates)}")

    for fdate in tqdm(fire_dates, desc="Fire events by day"):
        # All fire pixels on this day
        day_fires = firms[firms["f_date"].dt.normalize() == fdate]

        # Master rows whose date is 0-7 days BEFORE this fire (they should predict it)
        window_start = fdate - pd.Timedelta(days=HORIZON_DAYS)
        window_end   = fdate
        row_mask = (master_dates >= window_start) & (master_dates <= window_end)
        if not row_mask.any():
            continue

        candidates = master.loc[row_mask]

        # For each fire pixel, find all candidate rows within radius
        for _, fire in day_fires.iterrows():
            dists = haversine_km(
                candidates["lat"], candidates["lon"],
                fire["f_lat"], fire["f_lon"],
            )
            hit_idx = candidates.index[dists <= FIRE_RADIUS_KM]
            labels.iloc[labels.index.get_indexer(hit_idx)] = 1

    print("[4/4] Saving …")
    out = master[["lat", "lon", "date"]].copy()
    out["wildfire_label"] = labels

    out_path = args.output or (_LABEL_DIR / "wildfire_labels.parquet")
    out.to_parquet(str(out_path), index=False, compression="snappy")
    pos_rate = labels.mean() * 100
    print(f"\n  Saved → {out_path}")
    print(f"  Positive rate: {pos_rate:.2f}%")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path, default=_PROC_DIR / "master_features_uk_2000_2024.parquet")
    p.add_argument("--firms",  type=Path, default=None)
    p.add_argument("--output", type=Path, default=None)
    return p.parse_args()


if __name__ == "__main__":
    build_wildfire_labels(parse_args())
