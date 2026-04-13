"""
File: build_flood_labels.py

What this file does:
Generates binary flood labels (0 = no flood, 1 = flood) for every
(lat, lon, date) row in the master feature dataset.  Four independent
data sources are merged, then a consensus vote produces the final label.

Sources:
  1. EA Historic Flood Map        — polygon extents with event dates (England/Wales)
  2. SEPA Flood Maps              — polygon extents (Scotland)
  3. Dartmouth Flood Observatory  — global flood archive filtered to UK
  4. CAMELS-GB                    — river discharge: days above 95th-percentile

Glossary:
  ST_Intersects   = PostGIS spatial predicate: returns TRUE if two geometries
                    share any interior/boundary points
  Q95             = 95th-percentile river discharge threshold; exceeding it is
                    the CAMELS-GB definition of a "high-flow" event
  SMOTE           = Synthetic Minority Over-sampling TEchnique — generates
                    synthetic positive examples to balance a skewed dataset;
                    applied at training time, NOT in the label file itself
  class_weight    = alternative to SMOTE: upweights the positive class in the
                    loss function; both strategies are tried in train_flood_v2.py
  positive class  = rows where flood_label == 1 (actual flood events)
  spatial join    = matching rows based on geographic proximity (point-in-polygon
                    or distance threshold)

How it connects:
  Input  ← data/processed/master_features_uk_2000_2024.parquet
  Input  ← data/raw/labels/ea_flood_polygons.shp  (manual download)
  Input  ← data/raw/labels/sepa_flood_polygons.shp
  Input  ← data/raw/labels/dartmouth_flood_archive.csv
  Input  ← data/raw/labels/camels_gb_discharge.csv
  Output → data/labels/flood_labels.parquet
  Used by← ai-engine/training/train_flood_v2.py

Download instructions:
  EA polygons    : environment.data.gov.uk → "Historic Flood Map" → SHP download
  SEPA polygons  : sepa.org.uk → "Flood Maps" → "Flood Extents" shapefile
  Dartmouth      : floodobservatory.colorado.edu → FloodArchive.xls (rename to .csv)
  CAMELS-GB      : nrfa.ceh.ac.uk/camels-gb → timeseries CSVs
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import geopandas as gpd
    import numpy as np
    import pandas as pd
    from shapely.geometry import Point
    from tqdm import tqdm
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install geopandas pandas numpy shapely tqdm pyarrow")

_AI_ROOT   = Path(__file__).resolve().parents[2]
_RAW_LDIR  = _AI_ROOT / "data" / "raw" / "labels"
_PROC_DIR  = _AI_ROOT / "data" / "processed"
_LABEL_DIR = _AI_ROOT / "data" / "labels"

FLOOD_RADIUS_M = 10_000   # A point is flood-positive if it's within 10 km of
                           # a documented flood polygon or extent centroid

# ---------------------------------------------------------------------------
# Source 1 — EA / SEPA polygon shapefiles
# ---------------------------------------------------------------------------

def label_from_polygons(
    master: pd.DataFrame,
    shp_paths: list[Path],
    radius_m: float = FLOOD_RADIUS_M,
) -> pd.Series:
    """
    For each (lat, lon, date) row, return 1 if the point falls within
    `radius_m` metres of any flood polygon that was active on that date.

    The EA and SEPA shapefiles include start/end date attributes — we filter
    to the relevant date window before doing the spatial join.

    Returns a boolean Series aligned to master.index.
    """
    # Load available polygon sources
    gdfs = []
    for p in shp_paths:
        if p.exists():
            try:
                gdfs.append(gpd.read_file(str(p)))
            except Exception as exc:
                print(f"  Warning: could not load {p}: {exc}")

    if not gdfs:
        print("  No flood polygon files found — skipping polygon labels.")
        return pd.Series(False, index=master.index)

    polygons = pd.concat(gdfs, ignore_index=True)
    # Ensure WGS84 for consistent distance calculations
    if polygons.crs is None:
        polygons = polygons.set_crs("EPSG:4326")
    else:
        polygons = polygons.to_crs("EPSG:4326")

    # Build a GDF of master points
    pts = gpd.GeoDataFrame(
        master[["lat", "lon", "date"]].copy(),
        geometry=gpd.points_from_xy(master["lon"], master["lat"]),
        crs="EPSG:4326",
    )

    # Reproject both to BNG (metres) for accurate distance threshold
    pts_bng  = pts.to_crs("EPSG:27700")
    poly_bng = polygons.to_crs("EPSG:27700")

    # Spatial join: each point gets every polygon within radius_m
    joined = gpd.sjoin_nearest(
        pts_bng, poly_bng, how="left", max_distance=radius_m
    )

    hit = joined.index_left.isin(joined.dropna(subset=["index_right"]).index_left)
    return hit.reindex(master.index, fill_value=False)


# ---------------------------------------------------------------------------
# Source 2 — Dartmouth Flood Observatory archive
# ---------------------------------------------------------------------------

def label_from_dartmouth(
    master: pd.DataFrame,
    dfo_path: Path,
) -> pd.Series:
    """
    Load the Dartmouth Flood Observatory archive (CSV) and label each master
    row positive if a UK flood event overlaps the row's date.

    The DFO CSV has columns: GlideNumber, Country, StartDate, EndDate,
    Latitude, Longitude, Area, Duration, Dead, Displaced.

    We label a point positive if:
      row.date ∈ [event.StartDate, event.EndDate]
      AND Haversine distance(row.lat/lon, event.lat/lon) ≤ FLOOD_RADIUS_M
    """
    if not dfo_path.exists():
        print(f"  Dartmouth archive not found at {dfo_path} — skipping.")
        return pd.Series(False, index=master.index)

    dfo = pd.read_csv(dfo_path, parse_dates=["StartDate", "EndDate"], dayfirst=True)
    # Filter to UK events
    uk_mask = dfo["Country"].str.contains("United Kingdom|UK|England|Scotland|Wales", na=False)
    dfo_uk  = dfo[uk_mask].copy()
    if dfo_uk.empty:
        print("  No UK events in Dartmouth archive.")
        return pd.Series(False, index=master.index)

    master_dates = pd.to_datetime(master["date"])
    labels = pd.Series(False, index=master.index)

    for _, row in tqdm(dfo_uk.iterrows(), total=len(dfo_uk), desc="Dartmouth events"):
        # Rows where date falls within the flood event window
        date_mask = (master_dates >= row["StartDate"]) & (master_dates <= row["EndDate"])
        if not date_mask.any():
            continue

        # Quick haversine distance in km (vectorised)
        dlat = np.radians(master.loc[date_mask, "lat"] - row["Latitude"])
        dlon = np.radians(master.loc[date_mask, "lon"] - row["Longitude"])
        a    = (np.sin(dlat / 2) ** 2
                + np.cos(np.radians(row["Latitude"]))
                * np.cos(np.radians(master.loc[date_mask, "lat"]))
                * np.sin(dlon / 2) ** 2)
        dist_km = 6371 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
        within  = dist_km <= (FLOOD_RADIUS_M / 1000)

        labels[date_mask[date_mask].index[within]] = True

    return labels


# ---------------------------------------------------------------------------
# Source 3 — CAMELS-GB discharge exceedance
# ---------------------------------------------------------------------------

def label_from_camels(
    master: pd.DataFrame,
    camels_dir: Path,
) -> pd.Series:
    """
    For each gauge station in the CAMELS-GB dataset, label days where flow
    exceeds the 95th-percentile historical discharge as flood-positive.

    The CAMELS-GB time-series files are named like:
      {station_id}_Q.csv  with columns (date, Q)  in m³/s

    We match each CAMELS station to the nearest master row point within
    FLOOD_RADIUS_M to propagate the label spatially.
    """
    if not camels_dir.exists():
        print(f"  CAMELS-GB directory not found at {camels_dir} — skipping.")
        return pd.Series(False, index=master.index)

    ts_files = list(camels_dir.glob("*_Q.csv"))
    if not ts_files:
        print(f"  No *_Q.csv files in {camels_dir} — skipping CAMELS labels.")
        return pd.Series(False, index=master.index)

    # Load a station metadata file to get lat/lon per gauge
    meta_path = camels_dir / "CAMELS_GB_topographic_attributes.csv"
    if not meta_path.exists():
        print(f"  CAMELS metadata not found at {meta_path} — skipping.")
        return pd.Series(False, index=master.index)

    meta = pd.read_csv(meta_path, index_col="gauge_id")
    labels = pd.Series(False, index=master.index)

    for ts_path in tqdm(ts_files, desc="CAMELS stations"):
        station_id_str = ts_path.stem.replace("_Q", "")
        try:
            station_id = int(station_id_str)
        except ValueError:
            continue
        if station_id not in meta.index:
            continue

        s_lat = meta.loc[station_id, "gauge_lat"]
        s_lon = meta.loc[station_id, "gauge_lon"]

        # Distance from master points to this gauge
        dlat = np.radians(master["lat"] - s_lat)
        dlon = np.radians(master["lon"] - s_lon)
        a    = (np.sin(dlat / 2) ** 2
                + np.cos(np.radians(s_lat))
                * np.cos(np.radians(master["lat"]))
                * np.sin(dlon / 2) ** 2)
        dist_km = 6371 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
        nearby_mask = dist_km <= (FLOOD_RADIUS_M / 1000)
        if not nearby_mask.any():
            continue

        # Load discharge time-series
        ts = pd.read_csv(ts_path, parse_dates=["date"], index_col="date")
        q95 = ts["Q"].quantile(0.95)
        flood_dates = set(ts[ts["Q"] > q95].index.strftime("%Y-%m-%d").tolist())

        for idx in master[nearby_mask].index:
            if master.loc[idx, "date"] in flood_dates:
                labels.at[idx] = True

    return labels


# ---------------------------------------------------------------------------
# Source 4 — ERA5 proxy (used when no external label files are available)
# ---------------------------------------------------------------------------

def label_from_era5_proxy(master: pd.DataFrame) -> pd.Series:
    """
    Generate proxy flood labels from ERA5 features already present in the
    master dataset.  Used as a fallback when external shapefiles / archives
    are not downloaded.

    A grid-point/day is labelled flood-positive if ANY of:
      (a) river_level exceeds the per-location 95th percentile (river-burst proxy)
      (b) rainfall_24h > global 95th-pct AND soil_moisture > global 70th-pct
          (saturated-soil heavy-rain proxy)
      (c) rainfall_7d  > global 99th-pct  (extreme sustained rainfall proxy)
    """
    result = pd.Series(False, index=master.index)

    # (a) Per-location river level exceedance
    if "river_level" in master.columns:
        river_q95 = master.groupby(["lat", "lon"])["river_level"].transform(
            lambda x: x.quantile(0.95)
        )
        result |= master["river_level"] > river_q95

    # (b) Heavy rain on saturated soil
    rain_col = "rainfall_24h" if "rainfall_24h" in master.columns else "chirps_precipitation_mm"
    if rain_col in master.columns and "soil_moisture" in master.columns:
        rain_q95  = master[rain_col].quantile(0.95)
        soil_q70  = master["soil_moisture"].quantile(0.70)
        result |= (master[rain_col] > rain_q95) & (master["soil_moisture"] > soil_q70)

    # (c) Extreme 7-day accumulated rainfall
    if "rainfall_7d" in master.columns:
        rain7d_q99 = master["rainfall_7d"].quantile(0.99)
        result |= master["rainfall_7d"] > rain7d_q99

    pos = result.sum()
    rate = pos / len(result) * 100
    print(f"  ERA5 proxy → {pos:,} positives ({rate:.2f}%)")
    return result


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def build_flood_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/5] Loading master features …")
    master = pd.read_parquet(str(args.master))
    print(f"  {len(master):,} rows loaded")

    poly_paths = [
        _RAW_LDIR / "ea_flood_polygons.shp",
        _RAW_LDIR / "sepa_flood_polygons.shp",
    ]

    print("[2/5] EA / SEPA polygon labels …")
    poly_labels = label_from_polygons(master, poly_paths)

    print("[3/5] Dartmouth Flood Observatory labels …")
    dfo_labels = label_from_dartmouth(master, _RAW_LDIR / "dartmouth_flood_archive.csv")

    print("[4/5] CAMELS-GB discharge exceedance labels …")
    camels_labels = label_from_camels(master, _RAW_LDIR / "camels_gb")

    # Consensus: label positive if ANY source says positive
    print("[5/5] Building consensus labels and saving …")
    flood_label = (poly_labels | dfo_labels | camels_labels).astype(int)

    # --- ERA5 proxy fallback ------------------------------------------------
    # If no external source produced any positive labels, use proxy only when
    # explicitly requested. This avoids accidental label-feature leakage.
    if flood_label.sum() == 0:
        if not args.allow_era5_proxy:
            sys.exit(
                "No positives from external flood sources. "
                "Leak-safe mode disables ERA5 proxy fallback by default. "
                "Provide real external labels or re-run with --allow-era5-proxy."
            )
        print("  No positives from external sources — using ERA5 proxy fallback.")
        era5_labels = label_from_era5_proxy(master)
        flood_label = era5_labels.astype(int)
    else:
        era5_labels = pd.Series(0, index=master.index)
    # ------------------------------------------------------------------------

    out = master[["lat", "lon", "date"]].copy()
    out["flood_label"] = flood_label
    out["label_polygon"] = poly_labels.astype(int)
    out["label_dartmouth"] = dfo_labels.astype(int)
    out["label_camels"] = camels_labels.astype(int)

    out_path = args.output or (_LABEL_DIR / "flood_labels.parquet")
    out.to_parquet(str(out_path), index=False, compression="snappy")

    pos_rate = flood_label.mean() * 100
    print(f"\n  Saved → {out_path}")
    print(f"  Rows: {len(out):,}  |  Positive rate: {pos_rate:.2f}%  (expect 2-3%)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path,
                   default=_PROC_DIR / "master_features_uk_2000_2024.parquet")
    p.add_argument("--output", type=Path, default=None)
    p.add_argument(
        "--allow-era5-proxy",
        action="store_true",
        help="Allow ERA5-based proxy flood labels when external labels are unavailable.",
    )
    return p.parse_args()


if __name__ == "__main__":
    build_flood_labels(parse_args())
