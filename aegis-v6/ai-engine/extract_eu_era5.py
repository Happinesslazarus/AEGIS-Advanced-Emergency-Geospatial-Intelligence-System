#!/usr/bin/env python3
"""
EU-focused ERA5 extraction -- fast overnight job.

Extracts only UK + European locations (lat 28-60N, lon 15W-35E).
These all fall within 1-2 S3 HDF5 chunk bands -> ~3 min per month.
Total runtime for 96 months: ~5 hours.

Generates cache files for: flood, heatwave, wildfire, infrastructure (EU part),
environmental (EU part), power_outage (UK only), public_safety (UK only),
water_supply (EU only).

Global hazards (drought, severe_storm, landslide) require EC2 or Open-Meteo.
"""
from __future__ import annotations
import concurrent.futures, hashlib, sys, time, warnings
from pathlib import Path

import boto3, s3fs, xarray as xr
import pandas as pd, numpy as np
from botocore import UNSIGNED
from botocore.config import Config

warnings.filterwarnings("ignore")

HERE           = Path(__file__).resolve().parent
CACHE_DIR      = HERE / "data" / "cache" / "multi_location_weather"
CHECKPOINT_DIR = HERE / "data" / "cache" / "era5_eu_checkpoints"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

ERA5_BUCKET = "nsf-ncar-era5"
START_YEAR, END_YEAR = 2016, 2023
N_WORKERS = 4

# EU + UK locations only (fast extraction -- same S3 chunk band)
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

EUROPEAN_LOCS = UK_GRID + [
    # France
    {"id": "paris",         "lat": 48.87, "lon":  2.35, "region": "france"},
    {"id": "marseille",     "lat": 43.30, "lon":  5.37, "region": "s_france"},
    {"id": "montpellier",   "lat": 43.61, "lon":  3.88, "region": "s_france"},
    # Spain
    {"id": "madrid",        "lat": 40.42, "lon": -3.70, "region": "spain"},
    {"id": "seville",       "lat": 37.39, "lon": -5.99, "region": "s_spain"},
    {"id": "barcelona",     "lat": 41.38, "lon":  2.18, "region": "ne_spain"},
    # Portugal
    {"id": "lisbon",        "lat": 38.72, "lon": -9.14, "region": "portugal"},
    {"id": "porto",         "lat": 41.16, "lon": -8.63, "region": "n_portugal"},
    # Italy
    {"id": "rome",          "lat": 41.90, "lon": 12.50, "region": "c_italy"},
    {"id": "milan",         "lat": 45.47, "lon":  9.19, "region": "n_italy"},
    {"id": "naples",        "lat": 40.85, "lon": 14.27, "region": "s_italy"},
    {"id": "palermo",       "lat": 38.12, "lon": 13.36, "region": "sicily"},
    # Greece
    {"id": "athens",        "lat": 37.98, "lon": 23.73, "region": "greece"},
    {"id": "thessaloniki",  "lat": 40.64, "lon": 22.94, "region": "n_greece"},
    # Germany
    {"id": "berlin",        "lat": 52.52, "lon": 13.40, "region": "germany"},
    {"id": "munich",        "lat": 48.14, "lon": 11.58, "region": "s_germany"},
    # Netherlands
    {"id": "amsterdam",     "lat": 52.37, "lon":  4.90, "region": "netherlands"},
    # Turkey (western, same lon band)
    {"id": "ankara",        "lat": 39.93, "lon": 32.86, "region": "turkey"},
    {"id": "istanbul",      "lat": 41.01, "lon": 28.98, "region": "turkey_w"},
    # Ireland
    {"id": "dublin",        "lat": 53.33, "lon": -6.25, "region": "ireland"},
    # Northern Europe
    {"id": "bergen",        "lat": 60.39, "lon":  5.32, "region": "norway"},
    {"id": "trondheim",     "lat": 63.43, "lon": 10.39, "region": "norway"},
    {"id": "fort_william",  "lat": 56.82, "lon": -5.11, "region": "highland"},
    {"id": "belfast",       "lat": 54.60, "lon": -5.93, "region": "n_ireland"},
    # Morocco / N Africa (close enough to EU chunk)
    {"id": "casablanca",    "lat": 33.57, "lon": -7.59, "region": "morocco"},
    # Canary Islands
    {"id": "las_palmas",    "lat": 28.12, "lon":-15.43, "region": "canary_islands"},
    # Jordan/Iraq (Middle East but same lon band as Turkey)
    {"id": "amman",         "lat": 31.95, "lon": 35.93, "region": "jordan"},
    {"id": "baghdad",       "lat": 33.34, "lon": 44.40, "region": "iraq"},
]


def _dedup(locs):
    seen = {}
    for loc in locs:
        key = (round(loc["lat"], 2), round(loc["lon"], 2))
        if key not in seen:
            seen[key] = loc
    return list(seen.values())


ALL_EU_LOCS = _dedup(EUROPEAN_LOCS)

# Hazard sets (EU-compatible subsets)
GLOBAL_HEATWAVE = UK_GRID + [
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
INFRA_EU_LOCS = UK_GRID + [
    {"id": "paris",    "lat": 48.87, "lon":  2.35, "region": "france"},
    {"id": "berlin",   "lat": 52.52, "lon": 13.40, "region": "germany"},
]
ENV_EU_LOCS = UK_GRID + [
    {"id": "moscow",   "lat": 55.75, "lon": 37.62, "region": "russia"},
    {"id": "istanbul", "lat": 41.01, "lon": 28.98, "region": "turkey_w"},
]
OUTAGE_UK_LOCS = [
    {"id": "london",    "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cardiff",   "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "manchester","lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "newcastle", "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh", "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "inverness", "lat": 57.48, "lon":  -4.22, "region": "highland"},
    {"id": "belfast",   "lat": 54.60, "lon":  -5.93, "region": "n_ireland"},
    {"id": "dublin",    "lat": 53.33, "lon":  -6.25, "region": "ireland"},
]
SAFETY_UK_LOCS = [
    {"id": "london",    "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cambridge", "lat": 52.21, "lon":   0.12, "region": "se_england"},
    {"id": "bristol",   "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "cardiff",   "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "birmingham","lat": 52.49, "lon":  -1.90, "region": "midlands"},
    {"id": "manchester","lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "york",      "lat": 53.96, "lon":  -1.08, "region": "ne_england"},
    {"id": "newcastle", "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh", "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "glasgow",   "lat": 55.86, "lon":  -4.25, "region": "scotland"},
    {"id": "aberdeen",  "lat": 57.15, "lon":  -2.09, "region": "scotland"},
]
WATER_EU_LOCS = [
    {"id": "london",    "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "bristol",   "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "manchester","lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "edinburgh", "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "paris",     "lat": 48.87, "lon":   2.35, "region": "france"},
    {"id": "berlin",    "lat": 52.52, "lon":  13.40, "region": "germany"},
    {"id": "rome",      "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "madrid",    "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",    "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    {"id": "amman",     "lat": 31.95, "lon":  35.93, "region": "jordan"},
    {"id": "baghdad",   "lat": 33.34, "lon":  44.40, "region": "iraq"},
]

EXTENDED_HOURLY_VARS = (
    "temperature_2m,relative_humidity_2m,dewpoint_2m,"
    "apparent_temperature,pressure_msl,"
    "wind_speed_10m,wind_gusts_10m,precipitation,"
    "cloud_cover,visibility,"
    "et0_fao_evapotranspiration,"
    "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,"
    "soil_temperature_0_to_7cm,"
    "snowfall,snow_depth"
)

EU_HAZARD_SETS = {
    "flood":          UK_GRID,
    "heatwave":       GLOBAL_HEATWAVE,
    "wildfire":       WILDFIRE_LOCS,
    "infrastructure": INFRA_EU_LOCS,
    "environmental":  ENV_EU_LOCS,
    "power_outage":   OUTAGE_UK_LOCS,
    "public_safety":  SAFETY_UK_LOCS,
    "water_supply":   WATER_EU_LOCS,
}

# S3 clients
_fs = s3fs.S3FileSystem(anon=True)
_s3 = boto3.client("s3", region_name="us-east-1", config=Config(signature_version=UNSIGNED))

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
ACCUMU_VARS = {
    "128_142_lsp":  ("LSP",  "precip_ls"),
    "128_143_cp":   ("CP",   "precip_conv"),
    "128_144_sf":   ("SF",   "snowfall"),
    "128_169_ssrd": ("SSRD", "shortwave_radiation"),
}
MINMAX_VARS = {
    "128_049_10fg": ("VAR_10FG", "wind_gusts_10m"),
}


def list_var_files(month_prefix: str, var_key: str) -> list[str]:
    resp = _s3.list_objects_v2(Bucket=ERA5_BUCKET, Prefix=month_prefix)
    return sorted(o["Key"] for o in resp.get("Contents", []) if var_key in o["Key"])


def stream_extract(key, nc_var, lats, lons_360):
    """Extract (n_hours, n_locs) array from ERA5 NetCDF.

    Handles both coordinate layouts:
    - Analysis files:   dims = (time, latitude, longitude)
    - Accumu/minmax:    dims = (forecast_initial_time, forecast_hour, latitude, longitude)
    """
    try:
        with _fs.open(f"{ERA5_BUCKET}/{key}", "rb") as f:
            ds = xr.open_dataset(f, engine="h5netcdf")
            la = xr.DataArray(lats, dims="points")
            lo = xr.DataArray(lons_360, dims="points")

            # Layout 1: simple time dimension
            if "time" in ds.dims or "valid_time" in ds.dims:
                pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
                arr = pts.values.astype(np.float32)
                for tc in ("time", "valid_time"):
                    if tc in ds.coords:
                        ts = pd.DatetimeIndex(ds[tc].values)
                        break
                else:
                    raise ValueError("No time coord (layout 1)")
                ds.close()
                return arr, ts

            # Layout 2: forecast_initial_time × forecast_hour
            if "forecast_initial_time" in ds.dims and "forecast_hour" in ds.dims:
                pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
                # shape: (n_init, n_fh, n_locs)
                arr3 = pts.values.astype(np.float32)
                init_times  = pd.DatetimeIndex(ds["forecast_initial_time"].values)
                fhours      = ds["forecast_hour"].values          # e.g. [1,2,...,12]

                n_init, n_fh, n_locs = arr3.shape
                total_hours = n_init * n_fh

                # Build flat (actual_utc_time, loc_idx) arrays
                timestamps_flat = []
                arr_flat = np.empty((total_hours, n_locs), dtype=np.float32)
                idx = 0
                for i, it in enumerate(init_times):
                    for j, fh in enumerate(fhours):
                        actual_ts = it + pd.Timedelta(hours=int(fh))
                        timestamps_flat.append(actual_ts)
                        arr_flat[idx] = arr3[i, j]
                        idx += 1

                ts_out = pd.DatetimeIndex(timestamps_flat)
                # Sort by actual timestamp (init_times may not be in strict order
                # after adding forecast hours)
                order = np.argsort(ts_out)
                ts_out  = ts_out[order]
                arr_out = arr_flat[order]

                ds.close()
                return arr_out, ts_out

            raise ValueError(f"Unknown coordinate layout: {list(ds.dims)}")

    except Exception as e:
        print(f"  WARN {key}: {e}", flush=True)
        return None


def deaccumulate(arr, ts):
    out = np.zeros_like(arr)
    hours = ts.hour
    for i in range(len(ts)):
        if i == 0 or hours[i] in (0, 6, 12, 18):
            out[i] = np.maximum(arr[i], 0)
        else:
            out[i] = np.maximum(arr[i] - arr[i - 1], 0)
    return out


def _fetch_one_var(args):
    prefix, var_key, nc_name, col_name, is_accum = args
    keys = list_var_files(prefix, var_key)
    if not keys:
        return col_name, None, None, is_accum
    lats     = [loc["lat"]       for loc in ALL_EU_LOCS]
    lons_360 = [loc["lon"] % 360 for loc in ALL_EU_LOCS]
    all_arrs, all_ts = [], []
    for k in keys:
        result = stream_extract(k, nc_name, lats, lons_360)
        if result:
            all_arrs.append(result[0])
            all_ts.append(result[1])
    if not all_arrs:
        return col_name, None, None, is_accum
    arr = np.concatenate(all_arrs, axis=0) if len(all_arrs) > 1 else all_arrs[0]
    ts  = all_ts[0].append(all_ts[1]) if len(all_ts) > 1 else all_ts[0]
    if is_accum:
        arr = np.stack([deaccumulate(arr[:, i], ts) for i in range(arr.shape[1])], axis=1)
    return col_name, arr, ts, is_accum


def extract_month(year, month):
    ym = f"{year}{month:02d}"
    cp = CHECKPOINT_DIR / f"era5_eu_{ym}.csv"
    if cp.exists():
        print(f"  Checkpoint: {ym}", flush=True)
        return pd.read_csv(cp, parse_dates=["timestamp"])

    print(f"  Extracting {ym} ...", flush=True)
    t0 = time.time()

    ap = f"e5.oper.an.sfc/{ym}/"
    fp = f"e5.oper.fc.sfc.accumu/{ym}/"
    mp = f"e5.oper.fc.sfc.minmax/{ym}/"

    jobs = (
        [(ap, vk, nc, col, False) for vk, (nc, col) in ANAL_VARS.items()] +
        [(fp, vk, nc, col, True)  for vk, (nc, col) in ACCUMU_VARS.items()] +
        [(mp, vk, nc, col, False) for vk, (nc, col) in MINMAX_VARS.items()]
    )

    col_data, ref_ts = {}, None
    with concurrent.futures.ThreadPoolExecutor(max_workers=N_WORKERS) as pool:
        for col_name, arr, ts, is_accum in pool.map(_fetch_one_var, jobs):
            if arr is not None:
                col_data[col_name] = (arr, ts)
                if not is_accum and ref_ts is None:
                    ref_ts = ts

    if ref_ts is None:
        print(f"  ERROR: no data for {ym}", flush=True)
        return None

    n_hours = len(ref_ts)
    lats  = [loc["lat"]                                          for loc in ALL_EU_LOCS]
    lons  = [loc["lon"] if loc["lon"] <= 180 else loc["lon"]-360 for loc in ALL_EU_LOCS]
    ids   = [loc["id"]                                            for loc in ALL_EU_LOCS]
    regs  = [loc.get("region","")                                 for loc in ALL_EU_LOCS]

    frames = []
    for i in range(len(ALL_EU_LOCS)):
        row = {"timestamp": ref_ts, "station_id": ids[i], "region": regs[i],
               "latitude": lats[i], "longitude": lons[i]}
        for col, (arr, ts) in col_data.items():
            if arr.shape[1] > i:
                if len(ts) == n_hours:
                    row[col] = arr[:, i]
                else:
                    ts_idx = pd.Series(range(len(ts)), index=ts)
                    aligned = np.full(n_hours, np.nan, dtype=np.float32)
                    for ti, t in enumerate(ref_ts):
                        si = ts_idx.get(t)
                        if si is not None:
                            aligned[ti] = arr[si, i]
                    row[col] = aligned
        frames.append(pd.DataFrame(row))

    df = pd.concat(frames, ignore_index=True)
    df = _apply_conversions(df)
    df.to_csv(cp, index=False)
    print(f"  {ym} done in {time.time()-t0:.0f}s ({len(df):,} rows)", flush=True)
    return df


def _apply_conversions(df):
    for c in ("temperature_2m","dewpoint_2m","soil_temperature_0_to_7cm"):
        if c in df.columns: df[c] = df[c] - 273.15
    for c in ("pressure_msl","surface_pressure"):
        if c in df.columns: df[c] = df[c] / 100.0
    for c in ("precip_ls","precip_conv","snowfall"):
        if c in df.columns: df[c] = (df[c] * 1000.0).clip(lower=0.0)
    if "precip_ls" in df.columns and "precip_conv" in df.columns:
        df["precipitation"] = df["precip_ls"].fillna(0) + df["precip_conv"].fillna(0)
        df.drop(columns=["precip_ls","precip_conv"], inplace=True)
    elif "precip_ls" in df.columns:
        df.rename(columns={"precip_ls":"precipitation"}, inplace=True)
    elif "precip_conv" in df.columns:
        df.rename(columns={"precip_conv":"precipitation"}, inplace=True)
    if "cloud_cover" in df.columns:
        df["cloud_cover"] = (df["cloud_cover"] * 100.0).clip(0,100)
    if "shortwave_radiation" in df.columns:
        df["shortwave_radiation"] = (df["shortwave_radiation"]/3600.0).clip(lower=0.0)
    if "_wind_u" in df.columns and "_wind_v" in df.columns:
        df["wind_speed_10m"] = np.sqrt(df["_wind_u"]**2 + df["_wind_v"]**2)
        df.drop(columns=["_wind_u","_wind_v"], inplace=True)
    if "temperature_2m" in df.columns and "dewpoint_2m" in df.columns:
        T, Td = df["temperature_2m"], df["dewpoint_2m"]
        df["relative_humidity_2m"] = (
            100.0 * np.exp(17.625*Td/(243.04+Td)) / np.exp(17.625*T/(243.04+T))
        ).clip(0,100)
    if "temperature_2m" in df.columns and "relative_humidity_2m" in df.columns:
        T, RH = df["temperature_2m"], df["relative_humidity_2m"]
        e = (RH/100.0)*6.105*np.exp(17.27*T/(237.7+T))
        df["apparent_temperature"] = T + 0.33*e - 4.0
    return df


def generate_caches(all_months):
    print("\nGenerating hazard cache files ...", flush=True)
    df_all = pd.concat(all_months, ignore_index=True)
    df_all["timestamp"] = pd.to_datetime(df_all["timestamp"], errors="coerce")
    df_all = df_all.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

    for hazard, locs in EU_HAZARD_SETS.items():
        loc_ids = sorted(l["id"] for l in locs)
        ck = hashlib.md5(
            f"om|{loc_ids}|2016-01-01|2023-12-31|{EXTENDED_HOURLY_VARS}".encode()
        ).hexdigest()[:12]
        out = CACHE_DIR / f"weather_{ck}.csv"
        loc_id_set = {l["id"] for l in locs}
        df_h = df_all[df_all["station_id"].isin(loc_id_set)].copy()
        df_h.to_csv(out, index=False)
        print(f"  {hazard:25s} -> weather_{ck}.csv  ({len(df_h):,} rows)", flush=True)


def main():
    print(f"=== AEGIS EU ERA5 Extraction ===")
    print(f"EU locations     : {len(ALL_EU_LOCS)}")
    print(f"Years            : {START_YEAR}-{END_YEAR}")
    print(f"Parallel workers : {N_WORKERS}")
    print(f"Target hazards   : {', '.join(EU_HAZARD_SETS)}")
    print()

    total = (END_YEAR - START_YEAR + 1) * 12
    all_months, done = [], 0
    t_start = time.time()

    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            done += 1
            print(f"[{done}/{total}] {year}-{month:02d}", flush=True)
            df = extract_month(year, month)
            if df is not None:
                all_months.append(df)
            elapsed = time.time() - t_start
            eta = (elapsed/done)*(total-done) if done else 0
            print(f"  Elapsed={elapsed/3600:.2f}h  ETA={eta/3600:.2f}h", flush=True)

    generate_caches(all_months)
    print(f"\nDone in {(time.time()-t_start)/3600:.1f}h")


if __name__ == "__main__":
    main()
