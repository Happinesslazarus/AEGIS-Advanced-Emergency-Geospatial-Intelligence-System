"""
Downloads the NOAA Oceanic Niño Index (ONI) monthly time-series and saves it
as data/processed/oni_monthly.csv.  The ONI is a 3-month running mean of
sea-surface temperature anomaly in the Niño 3.4 region (5°N–5°S, 120°W–170°W)
and is the official US government metric for ENSO (El Niño / La Niña) strength.

The enso_index feature in the AEGIS 28-feature schema uses this value.

ONI thresholds:
  > +0.5 for 5 consecutive months  →  El Niño  (warmer than normal)
  < -0.5 for 5 consecutive months  →  La Niña  (cooler than normal)
  Between -0.5 and +0.5            →  Neutral

Output:
  data/processed/oni_monthly.csv   columns: year, month, oni

Usage:
  python scripts/data/download_enso_oni.py
  python scripts/data/download_enso_oni.py --output data/processed/oni_monthly.csv

Source:
  NOAA CPC ONI table (public domain):
  https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from io import StringIO

try:
    import pandas as pd
    import requests
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install pandas requests")

_AI_ROOT = Path(__file__).resolve().parents[2]
_PROC_DIR = _AI_ROOT / "data" / "processed"

# Primary NOAA URL
ONI_URL_PRIMARY = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
# Backup: ENSO historical CSV from KNMI Climate Explorer
ONI_URL_BACKUP  = "https://climexp.knmi.nl/data/iENSO.dat"

MONTH_MAP = {
    "DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4,
    "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8,
    "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12,
}


def fetch_oni_noaa(url: str) -> pd.DataFrame | None:
    """
    Parse the NOAA CPC fixed-width ONI table.

    Format example:
        SEAS  YR   TOTAL   CLIM  ANOM
        DJF  1950  24.73  26.64  -1.91
        JFM  1950  25.79  27.09  -1.30
    """
    try:
        headers = {"User-Agent": "Mozilla/5.0 (AEGIS-Research/1.0)"}
        resp = requests.get(url, timeout=30, headers=headers)
        resp.raise_for_status()
        text = resp.text
    except Exception as exc:
        print(f"  Warning: {url} → {exc}")
        return None

    rows: list[dict] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[0] not in MONTH_MAP:
            continue
        try:
            # Last column is always the anomaly value regardless of 4 or 5 col format
            rows.append({
                "year":  int(parts[1]),
                "month": MONTH_MAP[parts[0]],
                "oni":   float(parts[-1]),
            })
        except ValueError:
            continue

    if not rows:
        return None

    df = pd.DataFrame(rows)
    df = df.sort_values(["year", "month"]).drop_duplicates(["year", "month"])
    return df


def fill_gaps(df: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill any missing month rows within the time range."""
    if df.empty:
        return df
    date_range = pd.date_range(
        start=f"{df['year'].min()}-01-01",
        end=f"{df['year'].max()}-12-01",
        freq="MS",
    )
    full = pd.DataFrame({"year": date_range.year, "month": date_range.month})
    merged = full.merge(df, on=["year", "month"], how="left")
    merged["oni"] = merged["oni"].ffill().bfill()
    return merged.reset_index(drop=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download NOAA ONI monthly ENSO index")
    p.add_argument("--output", type=Path, default=_PROC_DIR / "oni_monthly.csv")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    print("[1/3] Downloading NOAA ONI table …")
    df = fetch_oni_noaa(ONI_URL_PRIMARY)

    if df is None or df.empty:
        print("  Primary source failed. Trying backup …")
        df = fetch_oni_noaa(ONI_URL_BACKUP)

    if df is None or df.empty:
        print("  Both sources failed. Writing synthetic neutral (ONI=0) placeholder.")
        years = range(2000, 2026)
        rows = [{"year": y, "month": m, "oni": 0.0} for y in years for m in range(1, 13)]
        df = pd.DataFrame(rows)

    print(f"[2/3] Filling gaps and sorting …")
    df = fill_gaps(df)

    print(f"[3/3] Saving to {args.output} ({len(df):,} rows) …")
    df.to_csv(str(args.output), index=False)
    print("Done.  This file is consumed by scripts/features/build_master_dataset.py")
    print(f"  Date range: {df['year'].min()}-{df['month'].min():02d} → "
          f"{df['year'].max()}-{df['month'].max():02d}")


if __name__ == "__main__":
    main()
