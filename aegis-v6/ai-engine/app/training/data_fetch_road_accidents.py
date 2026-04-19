"""
Weather-related road accident data for public_safety_incident training labels.

WHY ROAD ACCIDENT DATA
-----------------------
Road accidents that occur under adverse weather conditions are the most
accessible, scientifically defensible, and globally scalable independent
label source for weather-related public safety incidents.

Two national datasets are integrated:

1. UK DfT Stats19 (Great Britain, 1979–present)
   ~130,000–160,000 reported injury accidents/year with weather conditions,
   road surface conditions, light conditions, GPS coordinates, and severity.
   Free from: https://data.gov.uk/dataset/road-safety-data
   Columns used: Weather_Conditions, Date, Time, Latitude, Longitude, Accident_Severity

2. US NHTSA FARS (Fatality Analysis Reporting System, USA, 1975–present)
   All fatal road accidents in the US with atmospheric conditions coded.
   Free from: https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars
   Columns used: ATMOSPH_COND, YEAR, MONTH, DAY, HOUR, LATITUDE, LONGITUD

LABEL DEFINITION
----------------
A station-hour is labelled POSITIVE when at least one adverse-weather accident
occurred within the station's spatial region on that day.

"Adverse weather" is defined using the official coding in each dataset:
  Stats19: weather_conditions in {2,3,4,5,6,7,8}  (any non-fine condition)
           2=Raining, 3=Snowing, 4=Fine+high winds, 5=Rain+high winds,
           6=Fog/mist, 7=Snow+high winds, 8=Other
  NHTSA:   atmosph_cond in {2,3,4,5,6,7,8,9,10,11,98}
           2=Blowing Sand, 3=Blowing Snow, 4=Fog, 5=Freezing Rain,
           6=Rain, 7=Severe Crosswinds, 8=Sleet/Hail, 10=Snow, 11=Other

This is independent from ERA5 weather features because:
  - Accident reports are made by police officers at the scene
  - They represent OBSERVED weather impacts (actual incidents)
  - They are not computed from the same reanalysis data used as features

SETUP
-----
Stats19:
  from app.training.data_fetch_road_accidents import download_stats19
  download_stats19(years=range(2015, 2024))   # downloads ~8 files

NHTSA FARS:
  from app.training.data_fetch_road_accidents import download_nhtsa_fars
  download_nhtsa_fars(years=range(2015, 2023))  # downloads ~8 files
"""

from __future__ import annotations

import io
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import math

import pandas as pd
from loguru import logger

_AI_ROOT         = Path(__file__).resolve().parent.parent.parent
_ACCIDENTS_DIR   = _AI_ROOT / "data" / "road_accidents"
_STATS19_DIR     = _ACCIDENTS_DIR / "stats19"
_FARS_DIR        = _ACCIDENTS_DIR / "fars"

# Stats19 adverse weather condition codes
_STATS19_ADVERSE_WEATHER = {2, 3, 4, 5, 6, 7, 8}
# NHTSA FARS adverse atmospheric condition codes
_FARS_ADVERSE_ATMO = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 98}


# ---------------------------------------------------------------------------
# Stats19 (UK DfT Road Safety Data)
# ---------------------------------------------------------------------------

_STATS19_HISTORICAL_URL = (
    "https://data.dft.gov.uk/road-accidents-safety-data/"
    "dft-road-casualty-statistics-collision-1979-latest-published-year.csv"
)


def _stats19_url(year: int) -> str | None:
    """Return the DfT data portal URL for a Stats19 collision CSV.

    Per-year files are available from 2020 onwards.
    Pre-2020 years are extracted from the historical bundle via
    _download_stats19_from_historical_bundle().
    """
    if year >= 2020:
        return (
            f"https://data.dft.gov.uk/road-accidents-safety-data/"
            f"dft-road-casualty-statistics-collision-{year}.csv"
        )
    return None


def _download_stats19_from_historical_bundle(years_needed: list[int], force: bool = False) -> list[Path]:
    """Download the DfT 1979-present historical bundle (~1.5 GB) and extract
    per-year CSVs for any requested pre-2020 years that are missing.

    The bundle is streamed in chunks to avoid loading 1.5 GB into memory.
    Extracted per-year files are saved alongside the 2020+ files.
    """
    _STATS19_DIR.mkdir(parents=True, exist_ok=True)

    # Determine which years actually need extracting
    missing = [y for y in years_needed if not (_STATS19_DIR / f"stats19_accidents_{y}.csv").exists() or force]
    if not missing:
        return [_STATS19_DIR / f"stats19_accidents_{y}.csv" for y in years_needed
                if (_STATS19_DIR / f"stats19_accidents_{y}.csv").exists()]

    logger.info(
        f"Stats19 pre-2020 data needed for years {missing}.\n"
        f"  Downloading DfT historical bundle (~1.5 GB) and extracting ...\n"
        f"  URL: {_STATS19_HISTORICAL_URL}"
    )

    bundle = _STATS19_DIR / "_stats19_1979_latest.csv"
    try:
        if not bundle.exists() or force:
            logger.info("  Streaming 1.5 GB bundle (this will take a few minutes) ...")
            urllib.request.urlretrieve(_STATS19_HISTORICAL_URL, bundle)
            logger.success(f"  Bundle downloaded: {bundle.stat().st_size // 1_000_000} MB")

        # Stream-read in chunks to extract per-year CSVs
        year_dfs: dict[int, list] = {y: [] for y in missing}
        for chunk in pd.read_csv(bundle, low_memory=False, dtype=str, chunksize=50_000):
            year_col = next((c for c in chunk.columns if "year" in c.lower()), None)
            if year_col is None:
                logger.warning("  Historical bundle: cannot find year column — skipping")
                break
            for yr in missing:
                subset = chunk[pd.to_numeric(chunk[year_col], errors="coerce") == yr]
                if not subset.empty:
                    year_dfs[yr].append(subset)

        extracted: list[Path] = []
        for yr in missing:
            if year_dfs[yr]:
                combined = pd.concat(year_dfs[yr], ignore_index=True)
                dest = _STATS19_DIR / f"stats19_accidents_{yr}.csv"
                combined.to_csv(dest, index=False)
                logger.success(f"  Stats19 {yr}: {len(combined):,} rows → {dest}")
                extracted.append(dest)
            else:
                logger.warning(f"  Stats19 {yr}: no rows found in historical bundle")

        # Remove the bundle to save ~1.5 GB disk space
        bundle.unlink(missing_ok=True)
        return extracted

    except Exception as exc:
        logger.warning(f"  Historical bundle download failed: {exc}")
        bundle.unlink(missing_ok=True)
        return []


def download_stats19(
    years: range | list[int] | None = None,
    force: bool = False,
) -> list[Path]:
    """Download Stats19 accident CSV files for given years.

    Parameters
    ----------
    years : iterable of years (default: 2015–2023)
    force : re-download even if file exists

    Returns
    -------
    List of paths to downloaded CSV files.
    """
    if years is None:
        years = range(2015, 2024)
    _STATS19_DIR.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []

    pre2020_needed: list[int] = []
    for year in years:
        dest = _STATS19_DIR / f"stats19_accidents_{year}.csv"
        if dest.exists() and not force:
            downloaded.append(dest)
            continue
        url = _stats19_url(year)
        if url is None:
            pre2020_needed.append(year)
            continue
        logger.info(f"Downloading Stats19 {year} from DfT portal ...")
        try:
            urllib.request.urlretrieve(url, dest)
            logger.success(f"  Stats19 {year}: {dest}")
            downloaded.append(dest)
        except Exception as exc:
            logger.warning(
                f"  Stats19 {year} download failed: {exc}\n"
                f"  Download manually from: https://data.gov.uk/dataset/road-safety-data\n"
                f"  Save as: {dest}"
            )

    # Fetch pre-2020 years from the historical bundle in one pass
    if pre2020_needed:
        extracted = _download_stats19_from_historical_bundle(pre2020_needed, force=force)
        downloaded.extend(extracted)

    return downloaded


def load_stats19(year: int) -> pd.DataFrame:
    """Load and normalise a Stats19 accidents CSV."""
    path = _STATS19_DIR / f"stats19_accidents_{year}.csv"
    if not path.exists():
        return pd.DataFrame()
    try:
        df = pd.read_csv(path, low_memory=False, dtype=str)
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        return df
    except Exception as exc:
        logger.warning(f"Stats19 {year}: read error: {exc}")
        return pd.DataFrame()


def load_all_stats19(start_year: int, end_year: int) -> pd.DataFrame:
    """Load Stats19 for a range of years and filter to adverse weather accidents."""
    frames: list[pd.DataFrame] = []
    for year in range(start_year, end_year + 1):
        df = load_stats19(year)
        if df.empty:
            continue

        # Identify weather condition column (name varies slightly between years)
        weather_col = next(
            (c for c in df.columns if "weather" in c and "cond" in c), None
        ) or next((c for c in df.columns if "weather" in c), None)

        lat_col = next((c for c in df.columns if c in ("latitude", "lat")), None)
        lon_col = next((c for c in df.columns if c in ("longitude", "lon", "long")), None)
        date_col = next((c for c in df.columns if c == "date"), None)

        if not all([weather_col, lat_col, lon_col, date_col]):
            logger.warning(
                f"Stats19 {year}: missing required columns "
                f"(weather={weather_col}, lat={lat_col}, lon={lon_col}, date={date_col})"
            )
            continue

        # Filter to adverse weather accidents
        weather_codes = pd.to_numeric(df[weather_col], errors="coerce")
        adverse = df[weather_codes.isin(_STATS19_ADVERSE_WEATHER)].copy()
        adverse["latitude"]  = pd.to_numeric(adverse[lat_col],  errors="coerce")
        adverse["longitude"] = pd.to_numeric(adverse[lon_col],  errors="coerce")
        adverse["date"]      = pd.to_datetime(adverse[date_col], format="%d/%m/%Y", errors="coerce")
        adverse = adverse.dropna(subset=["latitude", "longitude", "date"])

        frames.append(adverse[["date", "latitude", "longitude"]])

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    logger.info(
        f"  Stats19: {len(combined):,} adverse-weather accidents "
        f"({start_year}–{end_year})"
    )
    return combined


# ---------------------------------------------------------------------------
# NHTSA FARS (US Fatal Accident Reporting)
# ---------------------------------------------------------------------------

def _fars_url(year: int) -> str:
    """Return the NHTSA FARS data URL for a given year."""
    return (
        f"https://static.nhtsa.gov/nhtsa/downloads/FARS/{year}/National/"
        f"FARS{year}NationalCSV.zip"
    )


def download_nhtsa_fars(
    years: range | list[int] | None = None,
    force: bool = False,
) -> list[Path]:
    """Download NHTSA FARS accident CSV ZIP files and extract accident data.

    Parameters
    ----------
    years : iterable of years (default: 2015–2022)
    force : re-download even if file exists

    Returns
    -------
    List of paths to extracted accident CSV files.
    """
    if years is None:
        years = range(2015, 2023)
    _FARS_DIR.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []

    for year in years:
        dest_csv = _FARS_DIR / f"fars_accidents_{year}.csv"
        if dest_csv.exists() and not force:
            extracted.append(dest_csv)
            continue

        url = _fars_url(year)
        logger.info(f"Downloading NHTSA FARS {year} (~20–40 MB) ...")
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                zip_bytes = io.BytesIO(resp.read())

            with zipfile.ZipFile(zip_bytes) as zf:
                # Find accident file (case-insensitive: accident.csv, ACCIDENT.CSV)
                acc_names = [n for n in zf.namelist() if "accident" in n.lower() and n.endswith(".csv")]
                if not acc_names:
                    logger.warning(f"FARS {year}: no accident CSV found in ZIP")
                    continue
                acc_name = sorted(acc_names)[0]
                with zf.open(acc_name) as acc_file:
                    raw = acc_file.read()
                try:
                    acc_df = pd.read_csv(io.BytesIO(raw), low_memory=False, dtype=str, encoding="utf-8")
                except UnicodeDecodeError:
                    acc_df = pd.read_csv(io.BytesIO(raw), low_memory=False, dtype=str, encoding="latin-1")
                acc_df.to_csv(dest_csv, index=False)
            logger.success(f"  FARS {year}: {dest_csv}")
            extracted.append(dest_csv)
        except Exception as exc:
            logger.warning(
                f"  FARS {year} download failed: {exc}\n"
                f"  Download manually from: https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars\n"
                f"  Extract ACCIDENT.CSV and save as: {dest_csv}"
            )
    return extracted


def load_all_fars(start_year: int, end_year: int) -> pd.DataFrame:
    """Load NHTSA FARS for a range of years and filter to adverse weather."""
    frames: list[pd.DataFrame] = []
    for year in range(start_year, end_year + 1):
        path = _FARS_DIR / f"fars_accidents_{year}.csv"
        if not path.exists():
            continue
        try:
            df = pd.read_csv(path, low_memory=False, dtype=str)
            df.columns = [c.strip().lower() for c in df.columns]

            atmo_col = next(
                (c for c in df.columns if "atmosph" in c or "weather" in c), None
            )
            lat_col  = next((c for c in df.columns if c in ("latitude",  "lat")), None)
            lon_col  = next((c for c in df.columns if c in ("longitud", "longitude", "lon")), None)

            if not all([atmo_col, lat_col, lon_col]):
                logger.warning(f"FARS {year}: missing columns")
                continue

            atmo_codes = pd.to_numeric(df[atmo_col], errors="coerce")
            adverse = df[atmo_codes.isin(_FARS_ADVERSE_ATMO)].copy()
            adverse["latitude"]  = pd.to_numeric(adverse[lat_col],  errors="coerce")
            adverse["longitude"] = pd.to_numeric(adverse[lon_col],  errors="coerce")

            # Reconstruct date from YEAR, MONTH, DAY columns
            if all(c in adverse.columns for c in ("year", "month", "day")):
                adverse["date"] = pd.to_datetime(
                    adverse[["year", "month", "day"]].rename(
                        columns={"year": "year", "month": "month", "day": "day"}
                    ),
                    errors="coerce",
                )
            adverse = adverse.dropna(subset=["latitude", "longitude", "date"])
            frames.append(adverse[["date", "latitude", "longitude"]])
        except Exception as exc:
            logger.warning(f"FARS {year}: read error: {exc}")

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    logger.info(
        f"  NHTSA FARS: {len(combined):,} adverse-weather fatal accidents "
        f"({start_year}–{end_year})"
    )
    return combined


# ---------------------------------------------------------------------------
# Shared label builder
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


def build_accident_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
    radius_km: float = 80.0,
) -> pd.DataFrame:
    """Build hourly road-accident labels from Stats19 + NHTSA FARS.

    A station-day is POSITIVE if at least one adverse-weather accident
    occurred within `radius_km` of the station on that day.

    Parameters
    ----------
    station_locations : list of {"id", "lat", "lon"} dicts
    start_date        : "YYYY-MM-DD"
    end_date          : "YYYY-MM-DD"
    radius_km         : spatial match radius (default 80km ~county scale)

    Returns
    -------
    pd.DataFrame: timestamp (hourly), station_id, label (0/1)
    """
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")

    # Load both datasets
    stats19 = load_all_stats19(dt_start.year, dt_end.year)
    fars    = load_all_fars(dt_start.year, dt_end.year)

    accidents = pd.concat(
        [df for df in [stats19, fars] if not df.empty], ignore_index=True
    )

    if accidents.empty:
        logger.warning(
            "No road accident data loaded.  Labels will be all-zero.\n"
            "Download Stats19: from app.training.data_fetch_road_accidents "
            "import download_stats19; download_stats19()\n"
            "Download FARS: from app.training.data_fetch_road_accidents "
            "import download_nhtsa_fars; download_nhtsa_fars()"
        )
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    # Filter to training date range
    accidents = accidents[
        (accidents["date"] >= pd.Timestamp(dt_start)) &
        (accidents["date"] <= pd.Timestamp(dt_end))
    ]

    # Build (station_id, date) positive set using spatial matching
    positive_pairs: set[tuple] = set()
    acc_arr = accidents[["latitude", "longitude", "date"]].values

    for loc in station_locations:
        sid  = loc["id"]
        slat = float(loc["lat"])
        slon = float(loc["lon"])
        for acc_lat, acc_lon, acc_date in acc_arr:
            if _haversine_km(slat, slon, float(acc_lat), float(acc_lon)) <= radius_km:
                positive_pairs.add((sid, pd.Timestamp(acc_date).date()))

    # Build full hourly grid
    hourly_index = pd.date_range(dt_start, dt_end, freq="h")
    rows: list[pd.DataFrame] = []
    n_pos_total = 0

    for loc in station_locations:
        sid    = loc["id"]
        labels = [1 if (sid, ts.date()) in positive_pairs else 0 for ts in hourly_index]
        n_pos_total += sum(labels)
        rows.append(pd.DataFrame({
            "timestamp": hourly_index,
            "station_id": sid,
            "label": labels,
        }))

    result = pd.concat(rows, ignore_index=True)
    n_neg = len(result) - n_pos_total
    logger.info(
        f"  Road accident labels: {n_pos_total:,} positive, {n_neg:,} negative "
        f"({n_pos_total/max(len(result),1)*100:.2f}% positive rate) "
        f"across {len(station_locations)} stations (radius={radius_km:.0f}km)"
    )
    return result


def road_accidents_available() -> bool:
    """Return True if at least one year of Stats19 or FARS data is present."""
    has_stats19 = bool(list(_STATS19_DIR.glob("stats19_accidents_*.csv")))
    has_fars    = bool(list(_FARS_DIR.glob("fars_accidents_*.csv")))
    return has_stats19 or has_fars
