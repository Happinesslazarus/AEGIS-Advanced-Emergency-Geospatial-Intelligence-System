"""
File: build_master_dataset.py

What this file does:
Merges all per-chunk Parquet files produced by gee_extractor.py into a single
gold-source Parquet file: data/processed/master_features_uk_2000_2024.parquet.
Also computes the two derived features that GEE cannot provide directly:
  - seasonal_anomaly: how far each day's value departs from the 30-year
    day-of-year climatology (the "normal" for that calendar day)
  - climate_zone_encoding: integer code from the Köppen-Geiger global
    climate classification (tropical/arid/temperate/continental/polar)

Glossary:
  Parquet       = columnar binary file format — far faster to read/write than
                  CSV for large numeric datasets; preserves dtypes exactly
  climatology   = the statistical "average" state of the climate for a given
                  calendar period (e.g. mean January temperature over 30 years)
  seasonal anomaly = (observed value) − (climatological mean for that day of
                  year) — tells you how unusual today's reading is historically
  day-of-year   = the Julian day number, 1–366; used to group observations
                  from the same calendar day across different years
  Köppen-Geiger = the most widely used global climate classification system;
                  divides the world into 5 main zones (A-E) by temperature and
                  precipitation pattern
  snappy        = fast, lossless compression codec commonly used for Parquet
  schema        = the agreed list of 28 AEGIS feature columns every row must
                  have (defined in the AEGIS spec)

How it connects:
  Input  ← data/raw/gee/chunk_NNNN.parquet  (from gee_extractor.py)
  Output → data/processed/master_features_uk_2000_2024.parquet  (gold source)
  Used by← ai-engine/training/train_flood_v2.py and all other hazard trains

Usage:
  python scripts/features/build_master_dataset.py
  python scripts/features/build_master_dataset.py --raw-dir data/raw/gee \
      --output data/processed/master_features_uk_2000_2024.parquet
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------
try:
    import numpy  as np
    import pandas as pd
    from tqdm import tqdm
except ImportError as exc:
    sys.exit(f"Missing dependency: {exc}\nRun: pip install pandas numpy tqdm pyarrow")

_AI_ROOT   = Path(__file__).resolve().parents[2]
_RAW_DIR   = _AI_ROOT / "data" / "raw" / "gee"
_PROC_DIR  = _AI_ROOT / "data" / "processed"

# ---------------------------------------------------------------------------
# The 28 AEGIS schema feature columns
# Any row missing one of these will be flagged or dropped before training.
# ---------------------------------------------------------------------------
SCHEMA_COLUMNS: list[str] = [
    # Static features (do not change over time)
    "lat", "lon", "elevation", "basin_slope", "catchment_area",
    "drainage_density", "land_use_encoded", "soil_type_encoded",
    "impervious_surface_ratio", "vegetation_class_encoded", "permeability_index",
    # Dynamic features (change daily)
    "temperature", "humidity", "wind_speed", "rainfall_1h", "rainfall_6h",
    "rainfall_24h", "rainfall_7d", "rainfall_30d", "soil_moisture",
    "vegetation_index_ndvi", "evapotranspiration", "river_level",
    # Climate macro features
    "seasonal_anomaly", "long_term_rainfall_anomaly",
    "climate_zone_encoding", "enso_index",
    # Identifier / time
    "date",
]

# ---------------------------------------------------------------------------
# Köppen-Geiger climate zone encodings for UK grid cells
# UK is predominantly Cfb (Temperate oceanic) = zone 3
# Northern Scotland/uplands: Cfc (subpolar oceanic) = zone 3 still
# We use a simple latitude-based lookup as a first approximation.
# For production, load a raster from:
#   https://figshare.com/articles/dataset/Present_and_future_K_ppen-Geiger_climate_classification_maps_at_1-km_resolution/6396959
# ---------------------------------------------------------------------------
KOPPEN_ENCODING = {
    "Af":  1,  # Tropical rainforest
    "Am":  2,  # Tropical monsoon
    "Aw":  3,  # Tropical savanna
    "BSh": 4,  # Hot semi-arid
    "BSk": 5,  # Cold semi-arid
    "BWh": 6,  # Hot desert
    "BWk": 7,  # Cold desert
    "Csa": 8,  # Hot Mediterranean
    "Csb": 9,  # Warm Mediterranean
    "Cwa": 10, # Subtropical monsoon
    "Cwb": 11, # Subtropical highland oceanic
    "Cfa": 12, # Humid subtropical
    "Cfb": 13, # Temperate oceanic   ← most of the UK
    "Cfc": 14, # Subpolar oceanic    ← Northern Scotland
    "Dsa": 15, # Hot continental Mediterranean
    "Dsb": 16, # Warm continental Mediterranean
    "Dsc": 17, # Subpolar Mediterranean
    "Dfa": 18, # Hot humid continental
    "Dfb": 19, # Warm humid continental
    "Dfc": 20, # Subarctic
    "Dfd": 21, # Extremely cold subarctic
    "ET":  22, # Tundra
    "EF":  23, # Ice cap
}


def assign_koppen_uk(lat: float, lon: float) -> int:
    """
    Approximate Köppen-Geiger zone for a UK point using latitude thresholds.
    This is a placeholder — replace with a proper raster lookup for pub-quality
    results (see dataset URL in module docstring above).

    Thresholds:
      lat > 58°N  → Cfc (subpolar oceanic — Northern Highlands)
      lat > 55°N  → Cfb (temperate oceanic — Scotland/Northern England)
      else        → Cfb (temperate oceanic — England/Wales)
    """
    if lat > 58.0:
        return KOPPEN_ENCODING["Cfc"]
    return KOPPEN_ENCODING["Cfb"]


# ---------------------------------------------------------------------------
# Step 1 — load and concatenate all Parquet chunks
# ---------------------------------------------------------------------------

def load_chunks(raw_dir: Path) -> pd.DataFrame:
    """
    Read every chunk_NNNN.parquet file from `raw_dir` and concatenate into one
    DataFrame.  Reads in sorted order so the merge is deterministic.
    """
    chunk_files = sorted(raw_dir.glob("chunk_*.parquet"))
    if not chunk_files:
        sys.exit(
            f"No chunk files found in {raw_dir}. "
            "Run gee_extractor.py first."
        )
    print(f"  Loading {len(chunk_files)} chunk files …")

    frames: list[pd.DataFrame] = []
    for f in tqdm(chunk_files, unit="chunk", desc="Reading chunks"):
        frames.append(pd.read_parquet(f))

    df = pd.concat(frames, ignore_index=True)
    print(f"  Total rows after concat: {len(df):,}")

    # Deduplicate: old GEE chunks (extracted at scale=30) may contain 7-8 rows
    # per (lat, lon, date) due to sampleRegions returning multiple 30m pixels.
    # Keep the first row per grid point per day.
    if df.duplicated(subset=["lat", "lon", "date"]).any():
        before = len(df)
        df = df.drop_duplicates(subset=["lat", "lon", "date"], keep="first")
        print(f"  Deduplicated {before - len(df):,} rows → {len(df):,} rows")

    return df


# ---------------------------------------------------------------------------
# Step 2 — compute seasonal anomaly
# ---------------------------------------------------------------------------

def compute_seasonal_anomaly(df: pd.DataFrame, feature: str = "temperature") -> pd.DataFrame:
    """
    Compute seasonal_anomaly for `feature` as:

      anomaly(point, date) = value(point, date) − mean(value for same day-of-year
                              over all years, for the same spatial cell)

    This captures how anomalous today's reading is relative to the multi-decade
    climatological average for that calendar day — the classic "anomaly" used
    in meteorology and climate science.

    For AEGIS we use temperature as the primary anomaly feature because it's
    the most predictive across hazards.  build_flood_labels.py additionally
    uses rainfall anomaly for the long_term_rainfall_anomaly column.
    """
    if "date" not in df.columns:
        df["date"] = pd.to_datetime(df["date"])

    df["_doy"]   = pd.to_datetime(df["date"]).dt.dayofyear  # day-of-year 1-366

    # Compute per-(lat, lon, doy) climatological mean using all available years
    climatology_mean = (
        df.groupby(["lat", "lon", "_doy"])[feature]
        .transform("mean")  # broadcast back to original index
    )
    df["seasonal_anomaly"] = df[feature] - climatology_mean
    df = df.drop(columns=["_doy"])
    return df


def compute_rainfall_anomaly(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute long_term_rainfall_anomaly as the 30-day rolling rainfall minus
    the climatological 30-day mean for that same day-of-year × location.
    """
    if "rainfall_30d" not in df.columns:
        df["long_term_rainfall_anomaly"] = np.nan
        return df

    df["_doy"] = pd.to_datetime(df["date"]).dt.dayofyear

    clim_30d = (
        df.groupby(["lat", "lon", "_doy"])["rainfall_30d"]
        .transform("mean")
    )
    df["long_term_rainfall_anomaly"] = df["rainfall_30d"] - clim_30d
    df = df.drop(columns=["_doy"])
    return df


# ---------------------------------------------------------------------------
# Step 3 — compute basin_slope from elevation (cheap SRTM-based approximation)
# ---------------------------------------------------------------------------

def compute_basin_slope(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute basin_slope as the standard deviation of elevation within a spatial
    neighbourhood (proxy for terrain slope when actual slope raster is absent).

    True slope requires a DEM raster with gradient calculation — do that in
    GEE for high accuracy.  This function provides a working approximation
    so the schema isn't missing the column.
    """
    if "elevation" not in df.columns:
        df["basin_slope"] = np.nan
        return df

    # Bucket into 0.1° bins and compute elevation std per cell
    df["_lat_bin"] = (df["lat"] * 10).round().astype(int)
    df["_lon_bin"] = (df["lon"] * 10).round().astype(int)
    slope_proxy = df.groupby(["_lat_bin", "_lon_bin"])["elevation"].transform("std")
    df["basin_slope"] = slope_proxy.fillna(0.0)
    df = df.drop(columns=["_lat_bin", "_lon_bin"])
    return df


# ---------------------------------------------------------------------------
# Step 4 — assign Köppen-Geiger zone and ENSO index
# ---------------------------------------------------------------------------

def add_climate_zone(df: pd.DataFrame) -> pd.DataFrame:
    """Assign Köppen-Geiger zone integer code to every row."""
    df["climate_zone_encoding"] = df.apply(
        lambda r: assign_koppen_uk(r["lat"], r["lon"]), axis=1
    )
    return df


def add_enso_index(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add the monthly ENSO (El Niño-Southern Oscillation) index.

    Downloads the Oceanic Niño Index (ONI) — the operational ENSO indicator
    from NOAA CPC.  Positive ONI = El Niño (warmer, drier UK winters),
    negative = La Niña (cooler, wetter).  The index is a 3-month running
    mean of SST anomalies in the Niño-3.4 region.

    Falls back to 0.0 if the download fails or the file is cached locally.
    """
    if "enso_index" in df.columns and df["enso_index"].abs().max() > 0:
        return df  # already populated (e.g. from a prior run)

    # Try to download ONI from NOAA CPC (fixed-width text file)
    oni_cache = _PROC_DIR / "oni_monthly.csv"
    oni_url = (
        "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
    )

    oni_df: pd.DataFrame | None = None
    if oni_cache.exists():
        oni_df = pd.read_csv(str(oni_cache))
        # Normalise column name: download_enso_oni.py writes 'oni', fresh download writes 'enso_index'
        if "oni" in oni_df.columns and "enso_index" not in oni_df.columns:
            oni_df = oni_df.rename(columns={"oni": "enso_index"})
    else:
        try:
            import urllib.request
            print("    Downloading ONI from NOAA CPC …")
            raw_text, _ = urllib.request.urlretrieve(oni_url)
            oni_df = pd.read_csv(
                raw_text, sep=r"\s+",
                names=["season", "year", "total", "anom"],
                skiprows=1,
            )
            # 'season' is like "DJF", "JFM", … — map to centre month
            season_to_month = {
                "DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4,
                "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8,
                "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12,
            }
            oni_df["month"] = oni_df["season"].map(season_to_month)
            oni_df = oni_df.dropna(subset=["month"])
            oni_df["month"] = oni_df["month"].astype(int)
            oni_df = oni_df[["year", "month", "anom"]].rename(columns={"anom": "enso_index"})
            oni_cache.parent.mkdir(parents=True, exist_ok=True)
            oni_df.to_csv(str(oni_cache), index=False)
            print(f"    Cached ONI → {oni_cache} ({len(oni_df)} records)")
        except Exception as exc:
            print(f"    Could not download ONI: {exc}. Using neutral (0.0).")

    if oni_df is not None and not oni_df.empty:
        df["_year"]  = pd.to_datetime(df["date"]).dt.year
        df["_month"] = pd.to_datetime(df["date"]).dt.month
        oni_df["year"]  = oni_df["year"].astype(int)
        oni_df["month"] = oni_df["month"].astype(int)
        df = df.merge(
            oni_df[["year", "month", "enso_index"]],
            left_on=["_year", "_month"],
            right_on=["year", "month"],
            how="left",
            suffixes=("_old", ""),
        )
        # Clean up merge artifacts
        df = df.drop(columns=["_year", "_month", "year", "month"], errors="ignore")
        if "enso_index_old" in df.columns:
            df = df.drop(columns=["enso_index_old"])
        df["enso_index"] = df["enso_index"].fillna(0.0)
    else:
        df["enso_index"] = 0.0

    return df


# ---------------------------------------------------------------------------
# Step 5 — fill missing schema columns with sensible defaults
# ---------------------------------------------------------------------------

SCHEMA_DEFAULTS: dict[str, float | int] = {
    "catchment_area":          0.0,    # km² — filled from HydroSHEDS if available
    "drainage_density":        0.0,    # km/km² — filled from HydroSHEDS
    "impervious_surface_ratio": 0.0,   # 0-1 fraction — from ESA WorldCover
    "vegetation_class_encoded": 0,     # integer code — from ESA WorldCover
    "permeability_index":       0.5,   # 0-1 — from SoilGrids; 0.5 = neutral
    "river_level":              np.nan, # filled from SEPA/EA gauge joins later
}

def fill_missing_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure every schema column exists; fill with defaults if absent."""
    for col, default in SCHEMA_DEFAULTS.items():
        if col not in df.columns:
            df[col] = default
    return df


# ---------------------------------------------------------------------------
# Step 6 — validate row completeness
# ---------------------------------------------------------------------------

def validate_schema(df: pd.DataFrame) -> pd.DataFrame:
    """
    Drop rows where more than 5 of the 28 schema columns are NaN.
    Log how many rows were dropped and which columns have the most nulls.
    """
    required = [c for c in SCHEMA_COLUMNS if c != "date"]
    null_counts = df[required].isnull().sum()
    top_missing = null_counts[null_counts > 0].sort_values(ascending=False)

    if not top_missing.empty:
        print("\n  Columns with missing values:")
        for col, cnt in top_missing.items():
            pct = 100.0 * cnt / len(df)
            print(f"    {col:40s} {cnt:>10,}  ({pct:.1f}%)")

    # Drop rows with > 5 missing schema features
    threshold = 5
    row_null_count = df[required].isnull().sum(axis=1)
    before = len(df)
    df = df[row_null_count <= threshold].copy()
    dropped = before - len(df)
    print(f"\n  Rows dropped (> {threshold} missing features): {dropped:,}")
    print(f"  Rows retained: {len(df):,}")
    return df


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def build(raw_dir: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("[1/7] Loading GEE chunks …")
    df = load_chunks(raw_dir)

    print("[2/7] Computing seasonal anomaly …")
    df = compute_seasonal_anomaly(df)

    print("[3/7] Computing long-term rainfall anomaly …")
    df = compute_rainfall_anomaly(df)

    print("[4/7] Computing basin slope proxy …")
    df = compute_basin_slope(df)

    print("[5/7] Assigning climate zone and ENSO index …")
    df = add_climate_zone(df)
    df = add_enso_index(df)

    print("[6/7] Filling missing schema columns …")
    df = fill_missing_columns(df)

    print("[7/7] Validating schema and saving …")
    df = validate_schema(df)

    # Ensure date column is a proper string for consistent downstream joining
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

    df.to_parquet(str(output_path), index=False, compression="snappy")
    print(f"\n  Saved → {output_path}")
    print(f"  Shape: {df.shape[0]:,} rows × {df.shape[1]} columns")
    print(f"  Date range: {df['date'].min()} → {df['date'].max()}")
    print(f"  Unique locations: {df.groupby(['lat','lon']).ngroups:,}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build master AEGIS feature dataset from GEE chunks")
    p.add_argument("--raw-dir", type=Path, default=_RAW_DIR)
    p.add_argument(
        "--output", type=Path,
        default=_PROC_DIR / "master_features_uk_2000_2024.parquet"
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    build(args.raw_dir, args.output)


if __name__ == "__main__":
    main()
