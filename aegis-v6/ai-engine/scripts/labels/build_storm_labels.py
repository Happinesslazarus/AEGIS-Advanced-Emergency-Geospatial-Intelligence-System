"""
Labels each master-dataset row as severe-storm-positive using two methods:

  Method 1 -- ERA5 wind threshold:
    storm_label = 1 if daily maximum wind gust ≥ 17.5 m/s (Beaufort Force 8
    gale force) for the point's location on that date.

  Method 2 -- Named storm dates (UK storms from Met Office / Wikipedia records):
    A hard-coded table of UK named storms (2015-2024) with their active date
    ranges.  Any row whose date falls within a named storm's dates is labelled 1.
    This provides high-quality positive examples for the most extreme events.

Labels from both methods are OR-combined to form the final storm_label.

Glossary:
  Beaufort scale  = the 0-12 international scale of wind speed; Force 8 =
                    gale (17.5-20.7 m/s) -- causes structural damage and is
                    the Met Office threshold for "Severe Weather Warning"
  wind gust       = peak instantaneous wind speed in a 3-second window;
                    higher than the mean 10-min "sustained wind"
  named storm     = since 2015 the UK Met Office / Met Éireann / KNMI have
                    named significant Atlantic storms (Storm Arwen, Storm
                    Babet, etc.) as a public communication tool
  OR-combine      = the final label is 1 if EITHER method says 1; this
                    maximises recall, trading off some precision

  Input  <- data/processed/master_features_uk_2000_2024.parquet
  Input  <- data/raw/labels/era5_wind_max.parquet  (optional; see below)
  Output -> data/labels/storm_labels.parquet
  Used by<- ai-engine/training/train_all_hazards_v2.py

ERA5 wind data:
  The master dataset contains ERA5-Land wind_speed (daily mean, not gust).
  For daily max gust you need ERA5 hourly, resampled to daily maximum.
  If this is absent, the script falls back to using daily wind_speed ≥ 14 m/s
  as a proxy (slightly lower threshold to compensate for mean vs peak).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from datetime import date

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

GALE_THRESHOLD_GUST  = 17.5  # m/s -- Beaufort F8, used if daily max gust available
GALE_THRESHOLD_MEAN  = 14.0  # m/s -- fallback when only daily mean wind is available

# Named UK storm table (hard-coded for 2015-2024)
# Source: Met Office Storm Centre + Wikipedia "List of UK storms"
# Extend this table as new storms are named.
NAMED_STORMS: list[dict] = [
    {"name": "Abigail",  "start": "2015-11-12", "end": "2015-11-13"},
    {"name": "Barkhane", "start": "2016-01-07", "end": "2016-01-08"},
    {"name": "Desmond", "start": "2015-12-04", "end": "2015-12-06"},
    {"name": "Eva",      "start": "2015-12-24", "end": "2015-12-25"},
    {"name": "Frank",    "start": "2015-12-29", "end": "2015-12-30"},
    {"name": "Angus",    "start": "2016-11-20", "end": "2016-11-21"},
    {"name": "Barbara",  "start": "2016-12-23", "end": "2016-12-24"},
    {"name": "Doris",    "start": "2017-02-23", "end": "2017-02-23"},
    {"name": "Ophelia",  "start": "2017-10-16", "end": "2017-10-17"},
    {"name": "Hector",   "start": "2018-06-13", "end": "2018-06-14"},
    {"name": "Ali",      "start": "2018-09-19", "end": "2018-09-20"},
    {"name": "Callum",   "start": "2018-10-12", "end": "2018-10-13"},
    {"name": "Bronagh",  "start": "2018-09-25", "end": "2018-09-26"},
    {"name": "Brendan",  "start": "2020-01-13", "end": "2020-01-14"},
    {"name": "Ciara",    "start": "2020-02-09", "end": "2020-02-10"},
    {"name": "Dennis",   "start": "2020-02-15", "end": "2020-02-16"},
    {"name": "Ellen",    "start": "2020-08-21", "end": "2020-08-21"},
    {"name": "Francis",  "start": "2020-08-25", "end": "2020-08-26"},
    {"name": "Aiden",    "start": "2020-10-30", "end": "2020-10-31"},
    {"name": "Christoph","start": "2021-01-19", "end": "2021-01-21"},
    {"name": "Arwen",    "start": "2021-11-27", "end": "2021-11-27"},
    {"name": "Barra",    "start": "2021-12-07", "end": "2021-12-08"},
    {"name": "Dudley",   "start": "2022-02-16", "end": "2022-02-17"},
    {"name": "Eunice",   "start": "2022-02-18", "end": "2022-02-18"},
    {"name": "Franklin", "start": "2022-02-21", "end": "2022-02-21"},
    {"name": "Antoni",   "start": "2023-08-04", "end": "2023-08-04"},
    {"name": "Agnes",    "start": "2023-10-12", "end": "2023-10-12"},
    {"name": "Babet",    "start": "2023-10-18", "end": "2023-10-22"},
    {"name": "Ciaran",   "start": "2023-11-01", "end": "2023-11-03"},
    {"name": "Debi",     "start": "2023-11-12", "end": "2023-11-13"},
    {"name": "Elin",     "start": "2023-11-19", "end": "2023-11-20"},
    {"name": "Fergus",   "start": "2023-11-21", "end": "2023-11-22"},
    {"name": "Gerrit",   "start": "2023-12-27", "end": "2023-12-28"},
    {"name": "Henk",     "start": "2024-01-03", "end": "2024-01-04"},
    {"name": "Isha",     "start": "2024-01-21", "end": "2024-01-22"},
    {"name": "Jocelyn",  "start": "2024-01-23", "end": "2024-01-24"},
]


def get_named_storm_dates() -> set[str]:
    """Return a set of ISO date strings covered by any named storm."""
    storm_dates: set[str] = set()
    for storm in NAMED_STORMS:
        start = pd.to_datetime(storm["start"])
        end   = pd.to_datetime(storm["end"])
        for d in pd.date_range(start, end, freq="D"):
            storm_dates.add(d.strftime("%Y-%m-%d"))
    return storm_dates


def build_storm_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/3] Loading master features ...")
    master = pd.read_parquet(str(args.master))
    print(f"  {len(master):,} rows")

    # Method 1: Wind threshold
    wind_label = pd.Series(0, index=master.index, dtype=int)
    if "wind_speed" in master.columns:
        # Try to load external daily-max wind gust file if present
        gust_path = _RAW_LDIR / "era5_wind_max.parquet"
        if gust_path.exists():
            gust_df = pd.read_parquet(str(gust_path))
            master = master.merge(
                gust_df[["lat", "lon", "date", "wind_gust"]],
                on=["lat", "lon", "date"], how="left"
            )
            wind_label = (master["wind_gust"].fillna(0) >= GALE_THRESHOLD_GUST).astype(int)
            print(f"  Using ERA5 daily-max gust (≥ {GALE_THRESHOLD_GUST} m/s)")
        else:
            # Fall back to daily mean wind_speed
            wind_label = (master["wind_speed"].fillna(0) >= GALE_THRESHOLD_MEAN).astype(int)
            print(f"  Using mean wind_speed proxy (≥ {GALE_THRESHOLD_MEAN} m/s)")
    else:
        print("  No wind_speed column -- wind-based labels will be zero.")

    # Method 2: Named storm dates
    print("[2/3] Applying named storm labels ...")
    storm_dates         = get_named_storm_dates()
    named_storm_label   = master["date"].isin(storm_dates).astype(int)
    print(f"  Named storm dates covered: {len(storm_dates)}")

    # Combine
    storm_label = (wind_label | named_storm_label).astype(int)

    print("[3/3] Saving ...")
    out = master[["lat", "lon", "date"]].copy()
    out["storm_label"]        = storm_label
    out["label_wind"]         = wind_label
    out["label_named_storm"]  = named_storm_label

    out_path = args.output or (_LABEL_DIR / "storm_labels.parquet")
    out.to_parquet(str(out_path), index=False, compression="snappy")
    pos_rate = storm_label.mean() * 100
    print(f"\n  Saved -> {out_path}")
    print(f"  Positive rate: {pos_rate:.2f}%")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path, default=_PROC_DIR / "master_features_uk_2000_2024.parquet")
    p.add_argument("--output", type=Path, default=None)
    return p.parse_args()


if __name__ == "__main__":
    build_storm_labels(parse_args())
