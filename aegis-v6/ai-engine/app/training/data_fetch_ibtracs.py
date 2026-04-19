"""
IBTrACS (International Best Track Archive for Climate Stewardship) global
storm track data provider.

WHY IBTRACS
-----------
The previous severe_storm pipeline used a static list of 60+ UK named storms
(Met Office / Met Éireann, 2015–2025).  This is UK-centric and incomplete.

IBTrACS is the WMO authoritative global tropical and subtropical cyclone
track archive.  It contains every named storm globally since 1840 — including
Atlantic hurricanes, Pacific typhoons, Bay of Bengal cyclones, SW Indian Ocean
cyclones, and Southern Hemisphere storms.

As of IBTrACS v04r00: ~14,000+ named storms, 6-hourly track positions.

DATA SOURCE
-----------
Knapp, K.R., Kruk, M.C., Levinson, D.H., Diamond, H.J., & Neumann, C.J.
  (2010). "The International Best Track Archive for Climate Stewardship
  (IBTrACS): Unifying Tropical Cyclone Data." Bull. Amer. Meteor. Soc.,
  91, 363–376. https://doi.org/10.1175/2009BAMS2755.1

Data access: https://www.ncei.noaa.gov/products/international-best-track-archive

Two access methods are provided:
  1. Static CSV files (recommended — more reliable, no API quota)
     Downloads per-basin files (~5–30 MB each):
       ibtracs.NA.list.v04r00.csv  — North Atlantic + Gulf of Mexico
       ibtracs.WP.list.v04r00.csv  — Western North Pacific
       ibtracs.EP.list.v04r00.csv  — Eastern North Pacific
       ibtracs.NI.list.v04r00.csv  — North Indian (Bay of Bengal + Arabian Sea)
       ibtracs.SI.list.v04r00.csv  — South Indian
       ibtracs.SP.list.v04r00.csv  — South Pacific + Australia

  2. REST API (for targeted queries) — rate-limited, use sparingly.

SETUP
-----
  from app.training.data_fetch_ibtracs import download_ibtracs_basin
  download_ibtracs_basin("NA")   # North Atlantic (~15 MB)
  download_ibtracs_basin("WP")   # West Pacific (~30 MB, most storms)
  # etc.

Or set IBTRACS_ALL=True to download ALL basins at once.

USAGE
-----
  from app.training.data_fetch_ibtracs import build_ibtracs_label_df
  from app.training.multi_location_weather import GLOBAL_STORM_LOCATIONS

  labels = build_ibtracs_label_df(
      station_locations=GLOBAL_STORM_LOCATIONS,
      start_date="2015-01-01",
      end_date="2023-12-31",
      radius_km=500,
      min_wind_knots=34,   # tropical storm force and above
  )
"""

from __future__ import annotations

import hashlib
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import math

import pandas as pd
from loguru import logger

_AI_ROOT  = Path(__file__).resolve().parent.parent.parent
_IBTRACKS_DIR = _AI_ROOT / "data" / "ibtracs"
_CACHE_DIR    = _AI_ROOT / "data" / "cache" / "ibtracs"

# IBTrACS v04r00 per-basin CSV URLs
_BASIN_URLS: dict[str, str] = {
    "NA": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.NA.list.v04r00.csv",
    "WP": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.WP.list.v04r00.csv",
    "EP": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.EP.list.v04r00.csv",
    "NI": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.NI.list.v04r00.csv",
    "SI": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.SI.list.v04r00.csv",
    "SP": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.SP.list.v04r00.csv",
    "ALL": "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r00/access/csv/ibtracs.ALL.list.v04r00.csv",
}

# Basins for each geographic region — fetch only what's needed
_REGION_BASINS: dict[str, list[str]] = {
    "atlantic":       ["NA"],
    "pacific":        ["WP", "EP"],
    "indian":         ["NI", "SI"],
    "australia":      ["SP", "SI"],
    "global":         ["NA", "WP", "EP", "NI", "SI", "SP"],
}

# IBTrACS column names (v04r00)
_ISO_TIME_COL   = "ISO_TIME"
_LAT_COL        = "LAT"
_LON_COL        = "LON"
_WIND_COL       = "WMO_WIND"     # knots, WMO agency best-track
_NAME_COL       = "NAME"
_BASIN_COL      = "BASIN"
_STATUS_COL     = "NATURE"       # TS, TY, HU, TD, EX, SS, etc.


# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

def download_ibtracs_basin(
    basin: str = "NA",
    force: bool = False,
) -> Optional[Path]:
    """Download IBTrACS CSV for a specific basin.

    Parameters
    ----------
    basin : "NA" | "WP" | "EP" | "NI" | "SI" | "SP" | "ALL"
    force : re-download even if file already exists

    Returns
    -------
    Path to the downloaded CSV, or None on failure.
    """
    _IBTRACKS_DIR.mkdir(parents=True, exist_ok=True)
    url = _BASIN_URLS.get(basin.upper())
    if url is None:
        logger.error(f"Unknown IBTrACS basin '{basin}'. Available: {list(_BASIN_URLS.keys())}")
        return None

    filename = f"ibtracs.{basin.upper()}.list.v04r00.csv"
    dest = _IBTRACKS_DIR / filename

    if dest.exists() and not force:
        size_mb = dest.stat().st_size // 1_000_000
        logger.info(f"IBTrACS {basin} already present ({size_mb} MB): {dest}")
        return dest

    logger.info(f"Downloading IBTrACS {basin} from NCEI (~5–30 MB) ...")
    try:
        def _hook(b, bs, total):
            if total > 0 and b % 200 == 0:
                logger.info(f"  ... {min(b*bs*100//total, 100)}%")
        urllib.request.urlretrieve(url, dest, reporthook=_hook)
        logger.success(f"Downloaded IBTrACS {basin}: {dest}")
        return dest
    except Exception as exc:
        logger.error(f"IBTrACS {basin} download failed: {exc}")
        if dest.exists():
            dest.unlink()
        return None


def ensure_basins_for_locations(station_locations: list[dict]) -> list[str]:
    """Determine which IBTrACS basins are needed for the given locations and
    download any that are missing.  Returns list of available local CSV paths.
    """
    # Use ALL basins for global training — download individually to save space
    all_needed = ["NA", "WP", "EP", "NI", "SI", "SP"]
    available: list[str] = []
    for basin in all_needed:
        path = _IBTRACKS_DIR / f"ibtracs.{basin}.list.v04r00.csv"
        if not path.exists():
            result = download_ibtracs_basin(basin)
            if result:
                available.append(str(result))
        else:
            available.append(str(path))
    return available


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_ibtracs_csv(csv_path: Path) -> pd.DataFrame:
    """Load and normalise a single IBTrACS basin CSV file.

    IBTrACS CSVs have two header rows — row 0 is column names, row 1 is units.
    We skip row 1 (units) by reading with header=0 and skiprows=[1].
    """
    df = pd.read_csv(
        csv_path,
        header=0,
        skiprows=[1],
        low_memory=False,
        na_values=["", " ", "-9999", " -9999"],
    )
    df.columns = [c.strip() for c in df.columns]

    # Normalise key columns
    if _ISO_TIME_COL in df.columns:
        df[_ISO_TIME_COL] = pd.to_datetime(df[_ISO_TIME_COL], errors="coerce")
    if _LAT_COL in df.columns:
        df[_LAT_COL] = pd.to_numeric(df[_LAT_COL], errors="coerce")
    if _LON_COL in df.columns:
        df[_LON_COL] = pd.to_numeric(df[_LON_COL], errors="coerce")
    if _WIND_COL in df.columns:
        df[_WIND_COL] = pd.to_numeric(df[_WIND_COL], errors="coerce")

    return df.dropna(subset=[_ISO_TIME_COL, _LAT_COL, _LON_COL])


def load_all_ibtracs(
    start_date: str,
    end_date: str,
    min_wind_knots: float = 34.0,
) -> pd.DataFrame:
    """Load all available IBTrACS basin CSVs and filter by date + wind threshold.

    Parameters
    ----------
    start_date    : "YYYY-MM-DD"
    end_date      : "YYYY-MM-DD"
    min_wind_knots: minimum WMO sustained wind (34 kts = tropical storm force)

    Returns
    -------
    pd.DataFrame with columns: ISO_TIME, LAT, LON, WMO_WIND, NAME, BASIN
    """
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")

    available_files = list(_IBTRACKS_DIR.glob("ibtracs.*.list.v04r00.csv"))
    if not available_files:
        logger.warning(
            "No IBTrACS CSV files found.  "
            "Download with: from app.training.data_fetch_ibtracs import "
            "download_ibtracs_basin; download_ibtracs_basin('NA')"
        )
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    for csv_path in available_files:
        try:
            df = load_ibtracs_csv(csv_path)
            df = df[
                (df[_ISO_TIME_COL] >= dt_start) &
                (df[_ISO_TIME_COL] <= dt_end)
            ]
            if min_wind_knots > 0 and _WIND_COL in df.columns:
                df = df[df[_WIND_COL].fillna(0) >= min_wind_knots]
            frames.append(df[[_ISO_TIME_COL, _LAT_COL, _LON_COL, _WIND_COL, _NAME_COL]])
        except Exception as exc:
            logger.warning(f"Failed to load {csv_path.name}: {exc}")

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates()
    logger.info(
        f"  IBTrACS: {len(combined):,} track points loaded "
        f"({combined[_NAME_COL].nunique()} unique storms, "
        f"{start_date}–{end_date}, wind >= {min_wind_knots} kts)"
    )
    return combined


# ---------------------------------------------------------------------------
# Spatial matching
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.asin(math.sqrt(min(a, 1.0)))


def build_ibtracs_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
    radius_km: float = 500.0,
    min_wind_knots: float = 34.0,
    lead_window_hours: int = 12,
) -> pd.DataFrame:
    """Build storm presence labels from IBTrACS track data.

    A station-hour is labelled POSITIVE when an IBTrACS track point with
    wind >= min_wind_knots is within `radius_km` of the station, OR was
    within radius within the past `lead_window_hours` hours (storm approach).

    Parameters
    ----------
    station_locations : list of {"id", "lat", "lon"} dicts
    start_date        : "YYYY-MM-DD"
    end_date          : "YYYY-MM-DD"
    radius_km         : match radius (default 500 km = tropical storm influence)
    min_wind_knots    : minimum sustained wind (34 = TS force, 64 = hurricane)
    lead_window_hours : extend label window ahead of closest approach (hours)

    Returns
    -------
    pd.DataFrame with columns: timestamp (hourly), station_id, label (0/1)
    Empty DataFrame if no IBTrACS data is available.
    """
    # Auto-download missing basins
    ensure_basins_for_locations(station_locations)

    tracks = load_all_ibtracs(start_date, end_date, min_wind_knots)
    if tracks.empty:
        logger.warning("IBTrACS: no tracks loaded — storm labels will be all-zero")
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    # Build a set of (station_id, date) pairs that are positive
    positive_station_hours: dict[str, set] = {loc["id"]: set() for loc in station_locations}

    for _, row in tracks.iterrows():
        track_time = pd.Timestamp(row[_ISO_TIME_COL])
        track_lat  = float(row[_LAT_COL])
        track_lon  = float(row[_LON_COL])

        for loc in station_locations:
            dist = _haversine_km(track_lat, track_lon, loc["lat"], loc["lon"])
            if dist <= radius_km:
                # Mark this hour and the lead window before it
                for h_offset in range(-lead_window_hours, 7):
                    hit_time = track_time + timedelta(hours=h_offset)
                    positive_station_hours[loc["id"]].add(hit_time.floor("h"))

    # Build full hourly grid and apply positive labels
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")
    hourly_index = pd.date_range(dt_start, dt_end, freq="h")

    rows: list[pd.DataFrame] = []
    n_positive_total = 0
    for loc in station_locations:
        station_id = loc["id"]
        pos_set = positive_station_hours[station_id]
        labels = pd.Series(
            [1 if ts in pos_set else 0 for ts in hourly_index],
            index=hourly_index,
            dtype=int,
        )
        df = pd.DataFrame({
            "timestamp": hourly_index,
            "station_id": station_id,
            "label": labels.values,
        })
        n_positive_total += int(labels.sum())
        rows.append(df)

    if not rows:
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    result = pd.concat(rows, ignore_index=True)
    n_neg = len(result) - n_positive_total
    pos_rate = n_positive_total / max(len(result), 1) * 100
    logger.info(
        f"  IBTrACS labels: {n_positive_total:,} positive, {n_neg:,} negative "
        f"({pos_rate:.2f}% positive rate) across {len(station_locations)} stations "
        f"(radius={radius_km:.0f}km, wind>={min_wind_knots}kts)"
    )
    return result


def ibtracs_is_available() -> bool:
    """Return True if at least one IBTrACS CSV is present."""
    return bool(list(_IBTRACKS_DIR.glob("ibtracs.*.list.v04r00.csv")))
