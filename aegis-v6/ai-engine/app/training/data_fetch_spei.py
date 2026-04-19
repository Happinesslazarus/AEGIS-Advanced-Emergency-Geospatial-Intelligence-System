"""
CSIC SPEI Global Database loader for drought training labels.

WHY SPEI OVER ERA5 SPI
-----------------------
The previous drought pipeline computed SPI from ERA5 reanalysis precipitation —
the same data source used to derive model features.  This created indirect
label-feature correlation (LeakageSeverity.LOW → PARTIAL status).

The CSIC SPEI Global Database computes SPEI from CRU TS4 OBSERVED station data
(Harris et al., 2020), which is entirely independent of ERA5.  Using SPEI as
labels while using ERA5 as features means there is zero shared data source
between labels and features → LeakageSeverity.NONE → TRAINABLE status.

WHAT IS SPEI
------------
The Standardized Precipitation-Evapotranspiration Index (SPEI) extends SPI by
incorporating potential evapotranspiration (Thornthwaite method).  A value of
SPEI < -1.0 indicates moderate drought, < -1.5 severe, < -2.0 extreme.

The global database provides SPEI at multiple time scales (1, 3, 6, 12, 24,
48 months), covering the entire global land surface at 0.5° resolution from
January 1901 to the present, updated regularly.

DATASET REFERENCE
-----------------
Vicente-Serrano, S.M., Beguería, S. & López-Moreno, J.I. (2010).
  "A Multiscalar Drought Index Sensitive to Global Warming: The Standardized
  Precipitation Evapotranspiration Index." Bull. Amer. Meteor. Soc., 91,
  1696–1711. https://doi.org/10.1175/2010BAMS2988.1

Download: https://spei.csic.es/database.html
Dataset DOI: https://doi.org/10.20350/digitalCSIC/8508

SETUP INSTRUCTIONS
------------------
The SPEI NetCDF files are ~150–200 MB each.  Download them once:

  from app.training.data_fetch_spei import download_spei_dataset
  download_spei_dataset(scale_months=3)   # ~150 MB, downloads spei03.nc
  download_spei_dataset(scale_months=12)  # ~150 MB, downloads spei12.nc

Or download manually from https://spei.csic.es/database.html and place at:
  {ai-engine}/data/spei/spei03.nc
  {ai-engine}/data/spei/spei12.nc

USAGE
-----
  from app.training.data_fetch_spei import build_spei_label_df, GLOBAL_DROUGHT_LOCATIONS
  labels = build_spei_label_df(
      station_locations=GLOBAL_DROUGHT_LOCATIONS,
      start_date="2015-01-01",
      end_date="2023-12-31",
      scale_months=3,
      threshold=-1.0,
  )
"""

from __future__ import annotations

import hashlib
import urllib.request
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

_AI_ROOT = Path(__file__).resolve().parent.parent.parent
_SPEI_DIR = _AI_ROOT / "data" / "spei"
_SPEI_CACHE_DIR = _AI_ROOT / "data" / "cache" / "spei_extractions"

# CSIC SPEIbase v2.9 download URLs
# Source: https://digital.csic.es/handle/10261/332007  (v2.9, covers 1901–2022)
# If these go stale, download manually from https://spei.csic.es/database.html
_SPEI_DOWNLOAD_URLS: dict[int, list[str]] = {
    1:  [
        "https://digital.csic.es/bitstream/10261/332007/2/spei01.nc",
    ],
    3:  [
        "https://digital.csic.es/bitstream/10261/332007/5/spei03.nc",
    ],
    6:  [
        "https://digital.csic.es/bitstream/10261/332007/8/spei06.nc",
    ],
    12: [
        "https://digital.csic.es/bitstream/10261/332007/14/spei12.nc",
    ],
    24: [
        "https://digital.csic.es/bitstream/10261/332007/20/spei24.nc",
    ],
}

# SPEI drought classification thresholds (WMO standard)
SPEI_MODERATE_DROUGHT  = -1.0   # ← default label threshold
SPEI_SEVERE_DROUGHT    = -1.5
SPEI_EXTREME_DROUGHT   = -2.0


# ---------------------------------------------------------------------------
# Download helper
# ---------------------------------------------------------------------------

def download_spei_dataset(
    scale_months: int = 3,
    dest_dir: Optional[Path] = None,
    force: bool = False,
) -> Optional[Path]:
    """Download the CSIC SPEI Global NetCDF file for a given time scale.

    Parameters
    ----------
    scale_months : int
        SPEI time scale in months.  Common choices: 3 (meteorological drought),
        12 (hydrological drought), 6 (agricultural drought).
    dest_dir : Path, optional
        Directory to save the file.  Defaults to {ai-engine}/data/spei/.
    force : bool
        Re-download even if the file already exists.

    Returns
    -------
    Path to the downloaded file, or None on failure.
    """
    if dest_dir is None:
        dest_dir = _SPEI_DIR
    dest_dir.mkdir(parents=True, exist_ok=True)

    filename = f"spei{scale_months:02d}.nc"
    dest_path = dest_dir / filename

    if dest_path.exists() and not force:
        logger.info(f"SPEI file already present: {dest_path} ({dest_path.stat().st_size // 1_000_000} MB)")
        return dest_path

    urls = _SPEI_DOWNLOAD_URLS.get(scale_months)
    if not urls:
        logger.error(
            f"No download URL for SPEI scale {scale_months}. "
            f"Available scales: {sorted(_SPEI_DOWNLOAD_URLS.keys())}"
        )
        return None

    for url in urls:
        logger.info(f"Downloading SPEI-{scale_months} from {url} (~150 MB) ...")
        try:
            def _reporthook(block, block_size, total):
                if total > 0:
                    pct = block * block_size * 100 / total
                    if block % 100 == 0:
                        logger.info(f"  ... {min(pct, 100):.0f}% downloaded")

            urllib.request.urlretrieve(url, dest_path, reporthook=_reporthook)
            size_mb = dest_path.stat().st_size // 1_000_000
            logger.success(f"Downloaded {filename} ({size_mb} MB) → {dest_path}")
            return dest_path
        except Exception as exc:
            logger.warning(f"Download from {url} failed: {exc} — trying next mirror")
            if dest_path.exists():
                dest_path.unlink()

    logger.error(
        f"All download attempts for SPEI-{scale_months} failed.\n"
        f"Please download manually from: https://spei.csic.es/database.html\n"
        f"Save the file to: {dest_dir / filename}"
    )
    return None


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def _load_spei_dataset(scale_months: int, spei_dir: Optional[Path] = None):
    """Load the SPEI NetCDF dataset using xarray.  Returns the xarray Dataset
    or raises ImportError / FileNotFoundError with clear messages.
    """
    try:
        import xarray as xr  # noqa: F401  (lazy import)
    except ImportError:
        raise ImportError(
            "xarray is required for SPEI loading.  "
            "Install it with: pip install xarray netcdf4"
        )

    if spei_dir is None:
        spei_dir = _SPEI_DIR

    nc_path = spei_dir / f"spei{scale_months:02d}.nc"
    if not nc_path.exists():
        raise FileNotFoundError(
            f"SPEI NetCDF not found: {nc_path}\n"
            f"Download it with: from app.training.data_fetch_spei import "
            f"download_spei_dataset; download_spei_dataset(scale_months={scale_months})\n"
            f"Or manually from: https://spei.csic.es/database.html"
        )

    import xarray as xr
    logger.info(f"Loading SPEI-{scale_months} dataset from {nc_path}")
    ds = xr.open_dataset(nc_path, mask_and_scale=True)
    return ds


def extract_spei_series(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    scale_months: int = 3,
    spei_dir: Optional[Path] = None,
) -> pd.Series:
    """Extract a monthly SPEI time series for the nearest 0.5° grid cell.

    Parameters
    ----------
    lat, lon      : station coordinates
    start_date    : "YYYY-MM-DD"
    end_date      : "YYYY-MM-DD"
    scale_months  : SPEI time scale (3 = standard meteorological drought)
    spei_dir      : directory containing the NetCDF file

    Returns
    -------
    pd.Series indexed by month-start date (YYYY-MM-01), values are SPEI floats.
    Empty series on failure.
    """
    # Check extraction cache first
    _SPEI_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.md5(
        f"{lat:.2f}_{lon:.2f}_{start_date}_{end_date}_{scale_months}".encode()
    ).hexdigest()[:10]
    cache_path = _SPEI_CACHE_DIR / f"spei{scale_months:02d}_{cache_key}.csv"

    if cache_path.exists():
        cached = pd.read_csv(cache_path, index_col=0, parse_dates=True)
        return cached["spei"].rename(f"spei_{scale_months}m")

    try:
        ds = _load_spei_dataset(scale_months, spei_dir)
    except (ImportError, FileNotFoundError) as exc:
        logger.warning(f"SPEI dataset unavailable: {exc}")
        return pd.Series(dtype=float, name=f"spei_{scale_months}m")

    # Nearest-neighbour grid cell selection
    # SPEI lat runs from 90 → -90; lon from -180 → 180 (check dataset)
    try:
        lat_name = next(c for c in ("lat", "latitude") if c in ds.coords)
        lon_name = next(c for c in ("lon", "longitude") if c in ds.coords)
        time_name = next(c for c in ("time", "T") if c in ds.coords)
    except StopIteration:
        logger.error("SPEI dataset has unexpected coordinate names")
        return pd.Series(dtype=float)

    spei_var = next(
        (v for v in ("spei", "SPEI", "spei_value") if v in ds.data_vars),
        None,
    )
    if spei_var is None:
        logger.error(f"SPEI variable not found.  Available: {list(ds.data_vars.keys())}")
        return pd.Series(dtype=float)

    # Select nearest grid point and time range
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")

    try:
        point = ds[spei_var].sel(
            {lat_name: lat, lon_name: lon},
            method="nearest",
        ).sel({time_name: slice(dt_start, dt_end)})

        series = point.to_series()
        series.index = pd.to_datetime(series.index).to_period("M").to_timestamp()
        series = series.dropna()

        # Write cache
        series.rename("spei").to_frame().to_csv(cache_path)
        return series.rename(f"spei_{scale_months}m")

    except Exception as exc:
        logger.warning(f"SPEI extraction failed for ({lat:.2f},{lon:.2f}): {exc}")
        return pd.Series(dtype=float, name=f"spei_{scale_months}m")


# ---------------------------------------------------------------------------
# Label builder
# ---------------------------------------------------------------------------

def build_spei_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
    scale_months: int = 3,
    threshold: float = SPEI_MODERATE_DROUGHT,
    consecutive_months: int = 1,
    spei_dir: Optional[Path] = None,
) -> pd.DataFrame:
    """Build hourly drought labels from SPEI at each training station.

    A station-month is labelled POSITIVE when:
      - SPEI at that grid cell < threshold for `consecutive_months` months in a row

    The monthly label is broadcast to all hours within that calendar month.
    The result has the same schema as all other label DataFrames produced by
    build_labels() methods: columns [timestamp, station_id, label].

    Parameters
    ----------
    station_locations : list of {"id", "lat", "lon"} dicts
    start_date        : "YYYY-MM-DD"
    end_date          : "YYYY-MM-DD"
    scale_months      : SPEI aggregation window (3 = meteorological, 12 = hydrological)
    threshold         : SPEI value below which drought is declared (default -1.0)
    consecutive_months: how many consecutive drought months to require (default 1)
    spei_dir          : override directory for NetCDF file

    Returns
    -------
    pd.DataFrame with columns: timestamp (hourly), station_id, label (0/1)
    Empty DataFrame if SPEI file is unavailable (caller should fall back).
    """
    all_labels: list[pd.DataFrame] = []
    n_positive_total = 0
    stations_with_data = 0

    for loc in station_locations:
        station_id = loc["id"]
        lat = float(loc["lat"])
        lon = float(loc["lon"])

        spei_series = extract_spei_series(
            lat=lat, lon=lon,
            start_date=start_date, end_date=end_date,
            scale_months=scale_months,
            spei_dir=spei_dir,
        )

        if spei_series.empty:
            continue

        stations_with_data += 1

        # Mark drought months
        below = (spei_series < threshold).astype(int)

        if consecutive_months > 1:
            # Require N consecutive months below threshold
            running = np.zeros(len(below), dtype=int)
            count = 0
            for i, v in enumerate(below.values):
                count = count + 1 if v == 1 else 0
                running[i] = count
            drought_flag = (running >= consecutive_months).astype(int)
            drought_months = pd.Series(drought_flag, index=below.index)
        else:
            drought_months = below

        # Expand monthly flags to hourly timestamps
        # Create full hourly index for the station's date range
        dt_start = datetime.strptime(start_date, "%Y-%m-%d")
        dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")
        hourly_index = pd.date_range(dt_start, dt_end, freq="h")

        hourly_df = pd.DataFrame({"timestamp": hourly_index})
        hourly_df["month_start"] = hourly_df["timestamp"].dt.to_period("M").dt.to_timestamp()
        hourly_df["station_id"] = station_id

        # Map monthly drought label to each hour
        drought_map = drought_months.to_dict()
        hourly_df["label"] = (
            hourly_df["month_start"].map(drought_map).fillna(0).astype(int)
        )

        n_pos = int(hourly_df["label"].sum())
        n_positive_total += n_pos
        all_labels.append(hourly_df[["timestamp", "station_id", "label"]])

    if not all_labels:
        logger.warning(
            "SPEI: no data extracted for any station — "
            "check that the NetCDF file is present and covers the date range.\n"
            "Download with: from app.training.data_fetch_spei import "
            "download_spei_dataset; download_spei_dataset(3)"
        )
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    labels = pd.concat(all_labels, ignore_index=True)
    n_neg = len(labels) - n_positive_total
    pos_rate = n_positive_total / max(len(labels), 1) * 100
    logger.info(
        f"  SPEI-{scale_months} drought labels: {n_positive_total:,} positive, "
        f"{n_neg:,} negative ({pos_rate:.2f}% positive rate) "
        f"across {stations_with_data}/{len(station_locations)} stations "
        f"(threshold={threshold}, consecutive={consecutive_months} months)"
    )
    return labels


def spei_is_available(scale_months: int = 3) -> bool:
    """Return True if the SPEI NetCDF file exists and xarray is importable."""
    nc_path = _SPEI_DIR / f"spei{scale_months:02d}.nc"
    if not nc_path.exists():
        return False
    try:
        import xarray  # noqa: F401
        return True
    except ImportError:
        return False
