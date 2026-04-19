#!/usr/bin/env python3
"""
ERA5 point-extraction script — runs on EC2 in us-east-1.

Downloads NSF NCAR ERA5 files from s3://nsf-ncar-era5 (same-region, fast),
extracts hourly values for all AEGIS training locations (2016–2023),
and uploads per-hazard CSV caches to s3://aegis-v6-era5-results-523231703601.

The CSV files are named to match the cache format expected by
multi_location_weather.fetch_multi_location_weather().

Usage (on EC2):
    python3 extract_era5_ec2.py
"""

from __future__ import annotations
import boto3, s3fs, xarray as xr
import pandas as pd, numpy as np
import tempfile, os, sys, time, json, hashlib, warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from botocore import UNSIGNED
from botocore.config import Config

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ERA5_BUCKET   = "nsf-ncar-era5"
RESULTS_BUCKET = "aegis-v6-era5-results-523231703601"
import os as _os
START_YEAR = int(_os.environ.get("AEGIS_START_YEAR", "2016"))
END_YEAR   = int(_os.environ.get("AEGIS_END_YEAR",   "2023"))

# ---------------------------------------------------------------------------
# All training location sets (mirrors multi_location_weather.py)
# ---------------------------------------------------------------------------
UK_GRID = [
    {"id": "london",      "lat": 51.51, "lon": -0.13, "region": "se_england"},
    {"id": "cambridge",   "lat": 52.21, "lon":  0.12, "region": "se_england"},
    {"id": "southampton", "lat": 50.91, "lon": -1.40, "region": "s_england"},
    {"id": "bristol",     "lat": 51.45, "lon": -2.58, "region": "sw_england"},
    {"id": "cardiff",     "lat": 51.48, "lon": -3.18, "region": "wales"},
    {"id": "birmingham",  "lat": 52.49, "lon": -1.90, "region": "midlands"},
    {"id": "manchester",  "lat": 53.48, "lon": -2.24, "region": "nw_england"},
    {"id": "york",        "lat": 53.96, "lon": -1.08, "region": "ne_england"},
    {"id": "newcastle",   "lat": 54.98, "lon": -1.62, "region": "ne_england"},
    {"id": "edinburgh",   "lat": 55.95, "lon": -3.19, "region": "scotland"},
    {"id": "glasgow",     "lat": 55.86, "lon": -4.25, "region": "scotland"},
    {"id": "aberdeen",    "lat": 57.15, "lon": -2.09, "region": "scotland"},
    {"id": "inverness",   "lat": 57.48, "lon": -4.22, "region": "scotland"},
]

HEATWAVE_EXTRA = [
    {"id": "paris",      "lat": 48.87, "lon":  2.35, "region": "france"},
    {"id": "marseille",  "lat": 43.30, "lon":  5.37, "region": "s_france"},
    {"id": "madrid",     "lat": 40.42, "lon": -3.70, "region": "spain"},
    {"id": "seville",    "lat": 37.39, "lon": -5.99, "region": "s_spain"},
    {"id": "barcelona",  "lat": 41.38, "lon":  2.18, "region": "ne_spain"},
    {"id": "lisbon",     "lat": 38.72, "lon": -9.14, "region": "portugal"},
    {"id": "rome",       "lat": 41.90, "lon": 12.50, "region": "c_italy"},
    {"id": "milan",      "lat": 45.47, "lon":  9.19, "region": "n_italy"},
    {"id": "athens",     "lat": 37.98, "lon": 23.73, "region": "greece"},
    {"id": "berlin",     "lat": 52.52, "lon": 13.40, "region": "germany"},
    {"id": "munich",     "lat": 48.14, "lon": 11.58, "region": "s_germany"},
    {"id": "amsterdam",  "lat": 52.37, "lon":  4.90, "region": "netherlands"},
    {"id": "ankara",     "lat": 39.93, "lon": 32.86, "region": "turkey"},
    {"id": "istanbul",   "lat": 41.01, "lon": 28.98, "region": "turkey_w"},
]

WILDFIRE_LOCS = [
    {"id": "madrid",        "lat": 40.42, "lon": -3.70, "region": "spain"},
    {"id": "seville",       "lat": 37.39, "lon": -5.99, "region": "s_spain"},
    {"id": "lisbon",        "lat": 38.72, "lon": -9.14, "region": "portugal"},
    {"id": "porto",         "lat": 41.16, "lon": -8.63, "region": "n_portugal"},
    {"id": "marseille",     "lat": 43.30, "lon":  5.37, "region": "s_france"},
    {"id": "montpellier",   "lat": 43.61, "lon":  3.88, "region": "s_france"},
    {"id": "rome",          "lat": 41.90, "lon": 12.50, "region": "c_italy"},
    {"id": "palermo",       "lat": 38.12, "lon": 13.36, "region": "sicily"},
    {"id": "athens",        "lat": 37.98, "lon": 23.73, "region": "greece"},
    {"id": "thessaloniki",  "lat": 40.64, "lon": 22.94, "region": "n_greece"},
    {"id": "las_palmas",    "lat": 28.12, "lon":-15.43, "region": "canary_islands"},
    {"id": "edinburgh",     "lat": 55.95, "lon": -3.19, "region": "scotland"},
    {"id": "inverness",     "lat": 57.48, "lon": -4.22, "region": "scotland"},
    {"id": "casablanca",    "lat": 33.57, "lon": -7.59, "region": "morocco"},
]

LANDSLIDE_LOCS = [
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "glasgow",      "lat": 55.86, "lon":  -4.25, "region": "scotland"},
    {"id": "fort_william", "lat": 56.82, "lon":  -5.11, "region": "highland"},
    {"id": "bergen",       "lat": 60.39, "lon":   5.32, "region": "norway"},
    {"id": "trondheim",    "lat": 63.43, "lon":  10.39, "region": "norway"},
    {"id": "kathmandu",    "lat": 27.71, "lon":  85.31, "region": "nepal"},
    {"id": "pokhara",      "lat": 28.21, "lon":  83.99, "region": "nepal"},
    {"id": "shimla",       "lat": 31.10, "lon":  77.17, "region": "n_india"},
    {"id": "medellin",     "lat":  6.24, "lon": -75.57, "region": "colombia"},
    {"id": "bogota",       "lat":  4.71, "lon": -74.07, "region": "colombia"},
    {"id": "manila",       "lat": 14.60, "lon": 120.98, "region": "philippines"},
    {"id": "osaka",        "lat": 34.69, "lon": 135.50, "region": "japan"},
    {"id": "hiroshima",    "lat": 34.39, "lon": 132.45, "region": "japan"},
    {"id": "naples",       "lat": 40.85, "lon":  14.27, "region": "s_italy"},
]

DROUGHT_LOCS = [
    {"id": "madrid",        "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",        "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    {"id": "rome",          "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "athens",        "lat": 37.98, "lon":  23.73, "region": "greece"},
    {"id": "tunis",         "lat": 36.82, "lon":  10.17, "region": "n_africa"},
    {"id": "niamey",        "lat": 13.51, "lon":   2.12, "region": "sahel"},
    {"id": "dakar",         "lat": 14.69, "lon": -17.44, "region": "w_sahel"},
    {"id": "nairobi",       "lat":  -1.29, "lon":  36.82, "region": "e_africa"},
    {"id": "addis_ababa",   "lat":   9.03, "lon":  38.74, "region": "ethiopia"},
    {"id": "mogadishu",     "lat":   2.05, "lon":  45.34, "region": "somalia"},
    {"id": "harare",        "lat": -17.83, "lon":  31.05, "region": "zimbabwe"},
    {"id": "cape_town",     "lat": -33.93, "lon":  18.42, "region": "s_africa"},
    {"id": "tehran",        "lat": 35.69, "lon":  51.39, "region": "iran"},
    {"id": "baghdad",       "lat": 33.34, "lon":  44.40, "region": "iraq"},
    {"id": "karachi",       "lat": 24.86, "lon":  67.01, "region": "pakistan"},
    {"id": "new_delhi",     "lat": 28.64, "lon":  77.22, "region": "india"},
    {"id": "adelaide",      "lat": -34.92, "lon": 138.60, "region": "s_australia"},
    {"id": "perth",         "lat": -31.95, "lon": 115.86, "region": "w_australia"},
    {"id": "alice_springs", "lat": -23.70, "lon": 133.88, "region": "c_australia"},
    {"id": "fortaleza",     "lat":  -3.72, "lon": -38.54, "region": "ne_brazil"},
    {"id": "lima",          "lat": -12.04, "lon": -77.04, "region": "peru"},
    {"id": "phoenix",       "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "denver",        "lat": 39.74, "lon": -104.98, "region": "great_plains"},
    {"id": "guatemala_city","lat": 14.64, "lon":  -90.51, "region": "c_america"},
]

STORM_LOCS = [
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "gulf_coast"},
    {"id": "new_orleans",  "lat": 29.95, "lon":  -90.07, "region": "gulf_coast"},
    {"id": "san_juan_pr",  "lat": 18.47, "lon":  -66.12, "region": "caribbean"},
    {"id": "havana",       "lat": 23.13, "lon":  -82.38, "region": "caribbean"},
    {"id": "manila",       "lat": 14.60, "lon":  120.98, "region": "philippines"},
    {"id": "taipei",       "lat": 25.05, "lon":  121.56, "region": "taiwan"},
    {"id": "tokyo",        "lat": 35.69, "lon":  139.69, "region": "japan"},
    {"id": "okinawa",      "lat": 26.21, "lon":  127.68, "region": "japan"},
    {"id": "hong_kong",    "lat": 22.32, "lon":  114.17, "region": "china_coast"},
    {"id": "shanghai",     "lat": 31.23, "lon":  121.47, "region": "china_coast"},
    {"id": "acapulco",     "lat": 16.85, "lon":  -99.92, "region": "mx_pacific"},
    {"id": "honolulu",     "lat": 21.31, "lon": -157.86, "region": "hawaii"},
    {"id": "dhaka",        "lat": 23.72, "lon":   90.41, "region": "bangladesh"},
    {"id": "kolkata",      "lat": 22.57, "lon":   88.36, "region": "bay_bengal"},
    {"id": "chennai",      "lat": 13.08, "lon":   80.27, "region": "se_india"},
    {"id": "mumbai",       "lat": 19.08, "lon":   72.88, "region": "arabian_sea"},
    {"id": "karachi_s",    "lat": 24.86, "lon":   67.01, "region": "arabian_sea"},
    {"id": "reunion",      "lat": -21.12, "lon":  55.54, "region": "sw_indian"},
    {"id": "madagascar",   "lat": -18.91, "lon":  47.54, "region": "sw_indian"},
    {"id": "mozambique",   "lat": -25.97, "lon":  32.57, "region": "sw_indian"},
    {"id": "brisbane",     "lat": -27.47, "lon": 153.02, "region": "australia"},
    {"id": "townsville",   "lat": -19.26, "lon": 146.82, "region": "ne_australia"},
    {"id": "suva",         "lat": -18.14, "lon": 178.44, "region": "fiji"},
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "dublin",       "lat": 53.33, "lon":  -6.25, "region": "ireland"},
    {"id": "amsterdam",    "lat": 52.37, "lon":   4.90, "region": "netherlands"},
]

OUTAGE_LOCS = [
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cardiff",      "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "newcastle",    "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "inverness",    "lat": 57.48, "lon":  -4.22, "region": "highland"},
    {"id": "belfast",      "lat": 54.60, "lon":  -5.93, "region": "n_ireland"},
    {"id": "dublin",       "lat": 53.33, "lon":  -6.25, "region": "ireland"},
    {"id": "new_york",     "lat": 40.71, "lon":  -74.01, "region": "northeast_us"},
    {"id": "boston",       "lat": 42.36, "lon":  -71.06, "region": "northeast_us"},
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "texas"},
    {"id": "dallas",       "lat": 32.78, "lon":  -96.80, "region": "texas"},
    {"id": "chicago",      "lat": 41.88, "lon":  -87.63, "region": "midwest"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "seattle",      "lat": 47.61, "lon": -122.33, "region": "pacific_nw"},
    {"id": "sydney",       "lat": -33.87, "lon": 151.21, "region": "nsw"},
    {"id": "brisbane",     "lat": -27.47, "lon": 153.02, "region": "qld"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "wa"},
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "sa"},
]

WATER_LOCS = [
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "bristol",      "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "paris",        "lat": 48.87, "lon":   2.35, "region": "france"},
    {"id": "berlin",       "lat": 52.52, "lon":  13.40, "region": "germany"},
    {"id": "rome",         "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "madrid",       "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",       "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    {"id": "amman",        "lat": 31.95, "lon":  35.93, "region": "jordan"},
    {"id": "baghdad",      "lat": 33.34, "lon":  44.40, "region": "iraq"},
    {"id": "cape_town",    "lat": -33.93, "lon":  18.42, "region": "s_africa"},
    {"id": "nairobi",      "lat":  -1.29, "lon":  36.82, "region": "e_africa"},
    {"id": "harare",       "lat": -17.83, "lon":  31.05, "region": "zimbabwe"},
    {"id": "sao_paulo",    "lat": -23.55, "lon": -46.63, "region": "se_brazil"},
    {"id": "lima",         "lat": -12.04, "lon": -77.04, "region": "peru"},
    {"id": "phoenix",      "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "new_orleans",  "lat": 29.95, "lon":  -90.07, "region": "gulf_coast"},
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "s_australia"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "w_australia"},
    {"id": "sydney",       "lat": -33.87, "lon": 151.21, "region": "nsw"},
]

SAFETY_LOCS = [
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cambridge",    "lat": 52.21, "lon":   0.12, "region": "se_england"},
    {"id": "bristol",      "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "cardiff",      "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "birmingham",   "lat": 52.49, "lon":  -1.90, "region": "midlands"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "york",         "lat": 53.96, "lon":  -1.08, "region": "ne_england"},
    {"id": "newcastle",    "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "glasgow",      "lat": 55.86, "lon":  -4.25, "region": "scotland"},
    {"id": "aberdeen",     "lat": 57.15, "lon":  -2.09, "region": "scotland"},
    {"id": "new_york",     "lat": 40.71, "lon":  -74.01, "region": "northeast_us"},
    {"id": "chicago",      "lat": 41.88, "lon":  -87.63, "region": "midwest"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "texas"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "phoenix",      "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "seattle",      "lat": 47.61, "lon": -122.33, "region": "pacific_nw"},
    {"id": "denver",       "lat": 39.74, "lon": -104.98, "region": "mountain_west"},
    {"id": "minneapolis",  "lat": 44.98, "lon":  -93.27, "region": "upper_midwest"},
    {"id": "boston",       "lat": 42.36, "lon":  -71.06, "region": "new_england"},
    {"id": "atlanta",      "lat": 33.75, "lon":  -84.39, "region": "se_usa"},
]

INFRA_LOCS = UK_GRID + [
    {"id": "paris",        "lat": 48.87, "lon":  2.35, "region": "france"},
    {"id": "berlin",       "lat": 52.52, "lon": 13.40, "region": "germany"},
    {"id": "new_york",     "lat": 40.71, "lon":-74.01, "region": "northeast_us"},
    {"id": "chicago",      "lat": 41.88, "lon":-87.63, "region": "midwest"},
    {"id": "tokyo",        "lat": 35.69, "lon":139.69, "region": "japan"},
    {"id": "sydney",       "lat":-33.87, "lon":151.21, "region": "nsw"},
]

ENV_LOCS = UK_GRID + [
    {"id": "beijing",      "lat": 39.91, "lon": 116.39, "region": "n_china"},
    {"id": "delhi",        "lat": 28.64, "lon":  77.22, "region": "india"},
    {"id": "los_angeles",  "lat": 34.05, "lon":-118.24, "region": "california"},
    {"id": "cairo",        "lat": 30.05, "lon":  31.24, "region": "egypt"},
    {"id": "moscow",       "lat": 55.75, "lon":  37.62, "region": "russia"},
    {"id": "istanbul",     "lat": 41.01, "lon":  28.98, "region": "turkey_w"},
]

# Build ordered unique location list across all hazards
def _dedup(locs_list):
    seen = {}
    for locs in locs_list:
        for loc in locs:
            key = (round(loc["lat"], 2), round(loc["lon"], 2))
            if key not in seen:
                seen[key] = loc
    return list(seen.values())

GLOBAL_HEATWAVE = UK_GRID + HEATWAVE_EXTRA

ALL_UNIQUE_LOCS = _dedup([
    UK_GRID, GLOBAL_HEATWAVE, WILDFIRE_LOCS, LANDSLIDE_LOCS,
    DROUGHT_LOCS, STORM_LOCS, OUTAGE_LOCS, WATER_LOCS,
    SAFETY_LOCS, INFRA_LOCS, ENV_LOCS,
])

# ---------------------------------------------------------------------------
# ERA5 variable catalogue
# ---------------------------------------------------------------------------
# Analysis (instant) variables — one file per month
ANAL_VARS = {
    "128_167_2t":    ("VAR_2T",  "temperature_2m"),
    "128_168_2d":    ("VAR_2D",  "dewpoint_2m"),
    "128_165_10u":   ("VAR_10U", "_wind_u"),
    "128_166_10v":   ("VAR_10V", "_wind_v"),
    "128_151_msl":   ("MSL",     "pressure_msl"),
    "128_164_tcc":   ("TCC",     "cloud_cover"),
    "128_139_stl1":  ("STL1",    "soil_temperature_0_to_7cm"),
    "128_039_swvl1": ("SWVL1",   "soil_moisture_0_to_7cm"),
    "128_040_swvl2": ("SWVL2",   "soil_moisture_7_to_28cm"),
    "128_141_sd":    ("SD",      "snow_depth"),
    "128_134_sp":    ("SP",      "surface_pressure"),
}

# Accumulated forecast — two 15-day files per month, need deaccumulation
ACCUMU_VARS = {
    "128_142_lsp":  ("LSP",  "precip_ls"),        # large-scale precip (m)
    "128_143_cp":   ("CP",   "precip_conv"),       # convective precip (m)
    "128_144_sf":   ("SF",   "snowfall"),          # snowfall (m)
    "128_169_ssrd": ("SSRD", "shortwave_radiation"), # solar (J/m²)
}

# Minmax forecast — two 15-day files per month
MINMAX_VARS = {
    "128_049_10fg": ("VAR_10FG", "wind_gusts_10m"),
}


# ---------------------------------------------------------------------------
# S3 utilities
# ---------------------------------------------------------------------------
fs_pub = s3fs.S3FileSystem(anon=True)
s3_priv = boto3.client("s3", region_name="us-east-1")


def list_files(prefix: str, match: str) -> list[str]:
    """List S3 keys under prefix containing match string."""
    paginator = boto3.client("s3", region_name="us-east-1",
                             config=Config(signature_version=UNSIGNED)).get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=ERA5_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            if match in obj["Key"]:
                keys.append(obj["Key"])
    return sorted(keys)


def stream_extract(key: str, nc_var: str,
                   lats: list[float], lons_360: list[float]) -> tuple[np.ndarray, pd.DatetimeIndex] | None:
    """Extract (n_hours, n_locs) + timestamps from an ERA5 S3 file.

    Handles both coordinate layouts:
      Layout 1 (analysis):     dims = (time, latitude, longitude)
      Layout 2 (accumu/minmax): dims = (forecast_initial_time, forecast_hour, latitude, longitude)
    """
    try:
        with fs_pub.open(f"{ERA5_BUCKET}/{key}", "rb") as f:
            ds = xr.open_dataset(f, engine="h5netcdf")
            la = xr.DataArray(lats, dims="points")
            lo = xr.DataArray(lons_360, dims="points")

            # --- Layout 1: simple time dimension (analysis files) ---
            if "time" in ds.dims or "valid_time" in ds.dims:
                pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
                arr = pts.values.astype(np.float32)   # (n_hours, n_locs)
                for tc in ("time", "valid_time"):
                    if tc in ds.coords:
                        ts = pd.DatetimeIndex(ds[tc].values)
                        break
                else:
                    raise ValueError("No time coord (layout 1)")
                ds.close()
                return arr, ts

            # --- Layout 2: forecast_initial_time × forecast_hour ---
            if "forecast_initial_time" in ds.dims and "forecast_hour" in ds.dims:
                pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
                arr3 = pts.values.astype(np.float32)   # (n_init, n_fh, n_locs)
                init_times = pd.DatetimeIndex(ds["forecast_initial_time"].values)
                fhours     = ds["forecast_hour"].values

                n_init, n_fh, n_locs = arr3.shape
                total_hours = n_init * n_fh
                ts_list  = []
                arr_flat = np.empty((total_hours, n_locs), dtype=np.float32)
                idx = 0
                for i, it in enumerate(init_times):
                    for j, fh in enumerate(fhours):
                        ts_list.append(it + pd.Timedelta(hours=int(fh)))
                        arr_flat[idx] = arr3[i, j]
                        idx += 1

                ts_out  = pd.DatetimeIndex(ts_list)
                order   = np.argsort(ts_out)
                ds.close()
                return arr_flat[order], ts_out[order]

            raise ValueError(f"Unknown coordinate layout: {list(ds.dims)}")
    except Exception as e:
        print(f"  WARN {key}: {e}", flush=True)
        return None


# ---------------------------------------------------------------------------
# Deaccumulation helper
# ---------------------------------------------------------------------------
def deaccumulate(arr: np.ndarray, timestamps: pd.DatetimeIndex) -> np.ndarray:
    """Convert accumulated ERA5 forecast values to per-hour totals.

    ERA5 forecasts reset at 00 UTC and 12 UTC.  Within each 12-h window
    the cumulative value increases; the per-hour rate = diff, except at the
    first step of each window where the per-hour value equals the cumulative.
    """
    out = np.zeros_like(arr)
    hours = timestamps.hour
    for i in range(len(timestamps)):
        if i == 0 or hours[i] in (0, 6, 12, 18):
            # First step of a forecast window — value is the rate
            out[i] = np.maximum(arr[i], 0)
        else:
            out[i] = np.maximum(arr[i] - arr[i - 1], 0)
    return out


# ---------------------------------------------------------------------------
# Per-month extraction
# ---------------------------------------------------------------------------
def _ym_str(year: int, month: int) -> str:
    return f"{year}{month:02d}"


def extract_month(year: int, month: int,
                  lats: list[float], lons_360: list[float]) -> dict[str, np.ndarray] | None:
    """Extract all variables for one calendar month.

    Returns dict mapping column_name → np.ndarray of shape (n_hours, n_locs).
    Returns None if critical variables are missing.
    """
    ym = _ym_str(year, month)
    result: dict[str, np.ndarray] = {}
    timestamps: pd.DatetimeIndex | None = None

    # --- Analysis (instant) variables ---
    anal_prefix = f"e5.oper.an.sfc/{ym}/"
    for var_key, (nc_name, col_name) in ANAL_VARS.items():
        keys = list_files(anal_prefix, var_key)
        if not keys:
            print(f"  WARN: No file for {var_key} {ym}")
            continue
        out = stream_extract(keys[0], nc_name, lats, lons_360)
        if out is None:
            continue
        arr, ts = out
        if timestamps is None:
            timestamps = ts
        result[col_name] = arr

    if timestamps is None:
        print(f"  ERROR: No timestamps for {ym} — skipping month")
        return None

    # --- Accumulated forecast variables (two 15-day files) ---
    accumu_prefix = f"e5.oper.fc.sfc.accumu/{ym}/"
    for var_key, (nc_name, col_name) in ACCUMU_VARS.items():
        keys = list_files(accumu_prefix, var_key)
        if not keys:
            print(f"  WARN: No accumu file for {var_key} {ym}")
            continue
        try:
            parts, ts_parts = [], []
            for k in keys:
                out = stream_extract(k, nc_name, lats, lons_360)
                if out is None:
                    continue
                arr, ts = out
                parts.append(arr)
                ts_parts.append(ts)
            if not parts:
                continue
            full_arr = np.concatenate(parts, axis=0)
            full_ts  = ts_parts[0].append(ts_parts[1]) if len(ts_parts) > 1 else ts_parts[0]
            # Deaccumulate each location
            deacc = np.stack(
                [deaccumulate(full_arr[:, i], full_ts) for i in range(full_arr.shape[1])],
                axis=1,
            )
            # Align to analysis timestamps
            ts_series = pd.Series(range(len(full_ts)), index=full_ts)
            idxs = [ts_series.get(t) for t in timestamps]
            valid = [(i, j) for i, j in enumerate(idxs) if j is not None]
            if valid:
                aligned = np.full((len(timestamps), deacc.shape[1]), np.nan, dtype=np.float32)
                for ti, si in valid:
                    aligned[ti] = deacc[si]
                result[col_name] = aligned
        except Exception as e:
            print(f"  WARN: accumu {var_key} {ym} failed: {e}")

    # --- Minmax forecast variables ---
    minmax_prefix = f"e5.oper.fc.sfc.minmax/{ym}/"
    for var_key, (nc_name, col_name) in MINMAX_VARS.items():
        keys = list_files(minmax_prefix, var_key)
        if not keys:
            print(f"  WARN: No minmax file for {var_key} {ym}")
            continue
        try:
            parts, ts_parts = [], []
            for k in keys:
                out = stream_extract(k, nc_name, lats, lons_360)
                if out is None:
                    continue
                arr, ts = out
                parts.append(arr)
                ts_parts.append(ts)
            if not parts:
                continue
            full_arr = np.concatenate(parts, axis=0)
            full_ts  = ts_parts[0].append(ts_parts[1]) if len(ts_parts) > 1 else ts_parts[0]
            ts_series = pd.Series(range(len(full_ts)), index=full_ts)
            idxs = [ts_series.get(t) for t in timestamps]
            valid = [(i, j) for i, j in enumerate(idxs) if j is not None]
            if valid:
                aligned = np.full((len(timestamps), full_arr.shape[1]), np.nan, dtype=np.float32)
                for ti, si in valid:
                    aligned[ti] = full_arr[si]
                result[col_name] = aligned
        except Exception as e:
            print(f"  WARN: minmax {var_key} {ym} failed: {e}")

    result["_timestamps"] = timestamps
    return result


# ---------------------------------------------------------------------------
# Unit conversions + derived variables
# ---------------------------------------------------------------------------
def apply_conversions(df: pd.DataFrame) -> pd.DataFrame:
    # K → °C
    for c in ("temperature_2m", "dewpoint_2m", "soil_temperature_0_to_7cm"):
        if c in df.columns:
            df[c] = df[c] - 273.15

    # Pa → hPa
    for c in ("pressure_msl", "surface_pressure"):
        if c in df.columns:
            df[c] = df[c] / 100.0

    # m → mm
    for c in ("precip_ls", "precip_conv", "snowfall"):
        if c in df.columns:
            df[c] = (df[c] * 1000.0).clip(lower=0.0)
    if "precip_ls" in df.columns and "precip_conv" in df.columns:
        df["precipitation"] = df["precip_ls"] + df["precip_conv"]
        df.drop(columns=["precip_ls", "precip_conv"], inplace=True)
    elif "precip_ls" in df.columns:
        df["precipitation"] = df["precip_ls"]; df.drop(columns=["precip_ls"], inplace=True)
    elif "precip_conv" in df.columns:
        df["precipitation"] = df["precip_conv"]; df.drop(columns=["precip_conv"], inplace=True)

    # m → m (keep snow_depth as-is)

    # fraction → %
    if "cloud_cover" in df.columns:
        df["cloud_cover"] = (df["cloud_cover"] * 100.0).clip(0, 100)

    # J/m² → W/m² (deaccumulated J/m² per hour ÷ 3600)
    if "shortwave_radiation" in df.columns:
        df["shortwave_radiation"] = (df["shortwave_radiation"] / 3600.0).clip(lower=0.0)

    # Derived: wind_speed from u/v components
    if "_wind_u" in df.columns and "_wind_v" in df.columns:
        df["wind_speed_10m"] = np.sqrt(df["_wind_u"]**2 + df["_wind_v"]**2)
        df["wind_direction_10m"] = (
            np.degrees(np.arctan2(-df["_wind_u"], -df["_wind_v"])) % 360
        )
        df.drop(columns=["_wind_u", "_wind_v"], inplace=True)

    # Derived: relative humidity from T and Td
    if "temperature_2m" in df.columns and "dewpoint_2m" in df.columns:
        T  = df["temperature_2m"]
        Td = df["dewpoint_2m"]
        df["relative_humidity_2m"] = (
            100.0 * np.exp(17.625 * Td / (243.04 + Td))
                  / np.exp(17.625 * T  / (243.04 + T))
        ).clip(0, 100)

    # Derived: apparent temperature (Steadman simplified)
    if "temperature_2m" in df.columns and "relative_humidity_2m" in df.columns:
        T  = df["temperature_2m"]
        RH = df["relative_humidity_2m"]
        e  = (RH / 100.0) * 6.105 * np.exp(17.27 * T / (237.7 + T))
        df["apparent_temperature"] = T + 0.33 * e - 4.0

    return df


# ---------------------------------------------------------------------------
# Main extraction loop
# ---------------------------------------------------------------------------
def run_extraction():
    lats     = [loc["lat"]           for loc in ALL_UNIQUE_LOCS]
    lons_360 = [loc["lon"] % 360     for loc in ALL_UNIQUE_LOCS]
    ids      = [loc["id"]            for loc in ALL_UNIQUE_LOCS]
    regions  = [loc.get("region","") for loc in ALL_UNIQUE_LOCS]

    n_locs = len(ALL_UNIQUE_LOCS)
    print(f"Extracting {n_locs} unique locations × {END_YEAR - START_YEAR + 1} years")

    all_rows = []
    total_months = (END_YEAR - START_YEAR + 1) * 12
    done = 0

    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            t0 = time.time()
            print(f"\n[{done+1}/{total_months}] {year}-{month:02d} ...", flush=True)
            data = extract_month(year, month, lats, lons_360)
            if data is None:
                done += 1
                continue

            ts = data.pop("_timestamps")
            n_hours = len(ts)

            for i, (loc_id, region) in enumerate(zip(ids, regions)):
                row_data = {"timestamp": ts,
                            "station_id": loc_id,
                            "region": region,
                            "latitude": lats[i],
                            "longitude": lons_360[i] if lons_360[i] <= 180 else lons_360[i] - 360}
                for col, arr in data.items():
                    if arr.ndim == 2 and arr.shape[1] > i:
                        row_data[col] = arr[:, i]
                df_loc = pd.DataFrame(row_data)
                all_rows.append(df_loc)

            elapsed = time.time() - t0
            print(f"  done in {elapsed:.1f}s | {n_hours} hours × {n_locs} locs", flush=True)
            done += 1

            # Upload checkpoint every 12 months
            if done % 12 == 0:
                _upload_checkpoint(all_rows, done)

    print("\nFinalising...")
    _upload_final(all_rows)


def _build_df(all_rows):
    if not all_rows:
        return pd.DataFrame()
    df = pd.concat(all_rows, ignore_index=True)
    df = apply_conversions(df)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=False)
    return df.sort_values("timestamp").reset_index(drop=True)


def _upload_checkpoint(all_rows, done):
    try:
        df = _build_df(all_rows)
        key = f"checkpoints/era5_all_locs_done{done}.csv.gz"
        buf = df.to_csv(index=False, compression="gzip").encode()
        s3_priv.put_object(Bucket=RESULTS_BUCKET, Key=key, Body=buf)
        print(f"  Checkpoint uploaded: {key} ({len(df):,} rows)")
    except Exception as e:
        print(f"  Checkpoint failed: {e}")


def _upload_final(all_rows):
    """Save this instance's partial data to S3, then generate per-hazard CSVs if full range present."""
    df_part = _build_df(all_rows)

    # Always save partial file keyed by year range
    part_key = f"parts/era5_all_locs_{START_YEAR}_{END_YEAR}.csv.gz"
    s3_priv.put_object(
        Bucket=RESULTS_BUCKET,
        Key=part_key,
        Body=df_part.to_csv(index=False, compression="gzip").encode()
    )
    print(f"Partial data uploaded: {part_key} ({len(df_part):,} rows)")

    # Check if all 8 year parts exist so we can merge and build per-hazard CSVs
    s3c = boto3.client("s3", region_name="us-east-1")
    all_part_keys = [f"parts/era5_all_locs_{y}_{y}.csv.gz" for y in range(2016, 2024)]
    missing = []
    for k in all_part_keys:
        try:
            s3c.head_object(Bucket=RESULTS_BUCKET, Key=k)
        except Exception:
            missing.append(k)
    if missing:
        print(f"Still waiting for {len(missing)} parts: {missing}")
        print("Per-hazard CSV build will happen when the last instance finishes.")
        return
    print("All 8 year parts present — merging and building per-hazard CSVs...")

    # Merge all 8 year parts
    import io
    dfs = []
    for key in all_part_keys:
        obj = s3c.get_object(Bucket=RESULTS_BUCKET, Key=key)
        dfs.append(pd.read_csv(io.BytesIO(obj["Body"].read()), compression="gzip"))
    df_all = pd.concat(dfs, ignore_index=True).sort_values("timestamp")

    hazard_sets = {
        "flood":           UK_GRID,
        "heatwave":        GLOBAL_HEATWAVE,
        "wildfire":        WILDFIRE_LOCS,
        "landslide":       LANDSLIDE_LOCS,
        "drought":         DROUGHT_LOCS,
        "severe_storm":    STORM_LOCS,
        "power_outage":    OUTAGE_LOCS,
        "water_supply":    WATER_LOCS,
        "public_safety":   SAFETY_LOCS,
        "infrastructure":  INFRA_LOCS,
        "environmental":   ENV_LOCS,
    }

    EXTENDED_VARS = (
        "temperature_2m,relative_humidity_2m,dewpoint_2m,"
        "apparent_temperature,pressure_msl,"
        "wind_speed_10m,wind_gusts_10m,precipitation,"
        "cloud_cover,visibility,"
        "et0_fao_evapotranspiration,"
        "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,"
        "soil_temperature_0_to_7cm,"
        "snowfall,snow_depth"
    )

    for hazard, locs in hazard_sets.items():
        try:
            loc_ids = sorted(l["id"] for l in locs)
            cache_key = hashlib.md5(
                f"om|{loc_ids}|2016-01-01|2023-12-31|{EXTENDED_VARS}".encode()
            ).hexdigest()[:12]
            csv_name = f"weather_{cache_key}.csv"
            loc_id_set = {l["id"] for l in locs}
            df_h = df_all[df_all["station_id"].isin(loc_id_set)].copy()
            buf = df_h.to_csv(index=False)
            s3_priv.put_object(Bucket=RESULTS_BUCKET, Key=f"cache/{csv_name}", Body=buf.encode())
            s3_priv.put_object(Bucket=RESULTS_BUCKET, Key=f"cache/{hazard}_cache_key.txt", Body=cache_key.encode())
            print(f"  Uploaded: cache/{csv_name} ({len(df_h):,} rows) [{hazard}]")
        except Exception as e:
            print(f"  WARN: {hazard} failed: {e}")

    s3_priv.put_object(
        Bucket=RESULTS_BUCKET,
        Key="era5_all_locations_2016_2023.csv.gz",
        Body=df_all.to_csv(index=False, compression="gzip").encode()
    )
    print(f"\nAll done. {len(df_all):,} total rows uploaded.")


if __name__ == "__main__":
    print("=== AEGIS ERA5 Extraction Job ===")
    print(f"Unique locations: {len(ALL_UNIQUE_LOCS)}")
    print(f"Years: {START_YEAR}–{END_YEAR}")
    run_extraction()
