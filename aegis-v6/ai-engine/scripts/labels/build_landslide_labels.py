"""
Labels each master-dataset row as landslide-positive using two catalogues:
  1. NASA COOLR Global Landslide Catalogue (public CSV, ~11,000 global events)
  2. BGS National Landslide Database (UK-specific; request free academic access)

A row is labelled 1 if a landslide occurred within 2 km of the point
in the 14-day window following the row's date.

Glossary:
  NASA COOLR  = Cooperative Open Online Landslide Repository — the largest
                open landslide catalogue, maintained by NASA GSFC
  BGS NLD     = British Geological Survey National Landslide Database —
                over 17,000 UK events with precise lat/lon; the gold standard
                for UK landslide modelling
  2 km radius = conservative spatial tolerance; BGS events are location-precise
                so 2 km captures the near-field triggering zone
  14-day horizon = landslide risk builds over several days of rainfall before
                   failure; the 14-day window helps the model learn the
                   hydro-geotechnical lag between rainfall and slope failure

Download:
  NASA COOLR  : https://pmm.nasa.gov/data-access/downloads/global-landslide-catalog
                → "Global Landslide Catalog" CSV
                → save as data/raw/labels/nasa_coolr.csv
  BGS NLD     : email records@bgs.ac.uk with academic institution details;
                usually approved within 1-2 weeks
                → save as data/raw/labels/bgs_nld.csv

  Input  ← data/processed/master_features_uk_2000_2024.parquet
  Input  ← data/raw/labels/nasa_coolr.csv
  Input  ← data/raw/labels/bgs_nld.csv   (optional — more accurate)
  Output → data/labels/landslide_labels.parquet
  Used by← ai-engine/training/train_all_hazards_v2.py
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

RADIUS_KM    = 2
HORIZON_DAYS = 14


def haversine_km(lat1: float, lon1: float, lat2: pd.Series, lon2: pd.Series) -> pd.Series:
    R = 6371.0
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = (np.sin(dlat / 2) ** 2
         + np.cos(np.radians(lat1))
         * np.cos(np.radians(lat2))
         * np.sin(dlon / 2) ** 2)
    return R * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


def load_coolr(path: Path) -> pd.DataFrame:
    """Load NASA COOLR CSV, filter to UK, return (lat, lon, date) DataFrame."""
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(str(path))
    # COOLR columns: event_id, location_description, latitude, longitude,
    #                event_date, country_name, ...
    df.columns = df.columns.str.lower().str.replace(" ", "_")
    lat_c = next((c for c in df.columns if "latit" in c), None)
    lon_c = next((c for c in df.columns if "longit" in c), None)
    dt_c  = next((c for c in df.columns if "date" in c and "event" in c), "event_date")

    if lat_c is None or lon_c is None:
        print("  Could not identify lat/lon columns in COOLR CSV.")
        return pd.DataFrame()

    df = df.rename(columns={lat_c: "lat", lon_c: "lon", dt_c: "event_date"})
    df["event_date"] = pd.to_datetime(df["event_date"], errors="coerce")
    df = df.dropna(subset=["lat", "lon", "event_date"])

    # UK bounding box filter
    uk = df[(df["lat"].between(49.5, 61.0)) & (df["lon"].between(-8.5, 2.0))].copy()
    print(f"  COOLR UK events: {len(uk):,}")
    return uk[["lat", "lon", "event_date"]]


def load_bgs(path: Path) -> pd.DataFrame:
    """Load BGS NLD CSV.  Column names vary — we attempt to auto-detect."""
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(str(path))
    df.columns = df.columns.str.lower().str.replace(" ", "_")
    lat_c = next((c for c in df.columns if "lat" in c), None)
    lon_c = next((c for c in df.columns if "lon" in c or "long" in c), None)
    dt_c  = next((c for c in df.columns if "date" in c), None)
    if not all([lat_c, lon_c, dt_c]):
        print("  BGS columns not detected — skipping.")
        return pd.DataFrame()
    df = df.rename(columns={lat_c: "lat", lon_c: "lon", dt_c: "event_date"})
    df["event_date"] = pd.to_datetime(df["event_date"], errors="coerce")
    print(f"  BGS UK events: {len(df.dropna(subset=['event_date'])):,}")
    return df.dropna(subset=["lat", "lon", "event_date"])[["lat", "lon", "event_date"]]


def build_landslide_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/4] Loading master features …")
    master = pd.read_parquet(str(args.master))
    master["date_dt"] = pd.to_datetime(master["date"])
    print(f"  {len(master):,} rows")

    print("[2/4] Loading landslide catalogues …")
    coolr = load_coolr(_RAW_LDIR / "nasa_coolr.csv")
    bgs   = load_bgs(_RAW_LDIR / "bgs_nld.csv")
    events = pd.concat([coolr, bgs], ignore_index=True) if not bgs.empty else coolr

    if events.empty:
        print("  No event data found. Saving zero-label placeholder.")
        master["landslide_label"] = 0
        out = master[["lat", "lon", "date", "landslide_label"]]
        out_path = args.output or (_LABEL_DIR / "landslide_labels.parquet")
        out.to_parquet(str(out_path), index=False, compression="snappy")
        return

    print(f"  Combined events: {len(events):,}")

    print("[3/4] Labelling master rows (vectorised event-driven) …")
    labels = pd.Series(0, index=master.index, dtype=int)
    master_dates = master["date_dt"]

    # Process event-by-event (thousands) instead of row-by-row (millions)
    events = events.sort_values("event_date").reset_index(drop=True)
    print(f"  Labelling from {len(events)} events …")

    for _, ev in tqdm(events.iterrows(), total=len(events), desc="Landslide events"):
        # Master rows whose date is 0-14 days BEFORE event (model should predict)
        window_start = ev["event_date"] - pd.Timedelta(days=HORIZON_DAYS)
        window_end   = ev["event_date"]
        row_mask = (master_dates >= window_start) & (master_dates <= window_end)
        if not row_mask.any():
            continue

        candidates = master.loc[row_mask]
        dists = haversine_km(ev["lat"], ev["lon"], candidates["lat"], candidates["lon"])
        hit_idx = candidates.index[dists <= RADIUS_KM]
        labels.iloc[labels.index.get_indexer(hit_idx)] = 1

    print("[4/4] Saving …")
    out = master[["lat", "lon", "date"]].copy()
    out["landslide_label"] = labels
    out_path = args.output or (_LABEL_DIR / "landslide_labels.parquet")
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
    build_landslide_labels(parse_args())
