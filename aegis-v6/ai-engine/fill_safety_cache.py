#!/usr/bin/env python3
"""
Extract ERA5 data for atlanta + minneapolis from NSF NCAR S3,
then assemble the complete public_safety weather cache.

Uses the same ERA5 extraction pipeline as extract_era5_ec2.py but
runs locally — fetches only the 2 missing safety locations.
"""
from __future__ import annotations
import sys, hashlib, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import boto3, s3fs, xarray as xr
import pandas as pd, numpy as np
import warnings
from botocore import UNSIGNED
from botocore.config import Config

warnings.filterwarnings("ignore")

from app.training.multi_location_weather import GLOBAL_SAFETY_LOCATIONS, EXTENDED_HOURLY_VARS

# ---------------------------------------------------------------------------
ERA5_BUCKET = "nsf-ncar-era5"
CACHE_DIR   = Path("data/cache/multi_location_weather")
TARGET_FILE = CACHE_DIR / "weather_edf9ce826bc8.csv"

MISSING_LOCS = [
    {"id": "atlanta",     "lat": 33.75, "lon": -84.39, "region": "se_usa"},
    {"id": "minneapolis", "lat": 44.98, "lon": -93.27, "region": "upper_midwest"},
]
YEARS = list(range(2016, 2024))

# ERA5 variable mapping (matches extract_era5_ec2.py)
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

fs_pub = s3fs.S3FileSystem(anon=True)
s3_anon = boto3.client("s3", region_name="us-east-1",
                       config=Config(signature_version=UNSIGNED))


def list_files(prefix: str, match: str) -> list[str]:
    paginator = s3_anon.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=ERA5_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            if match in obj["Key"]:
                keys.append(obj["Key"])
    return sorted(keys)


def stream_extract(key: str, nc_var: str,
                   lats: list[float], lons_360: list[float]):
    try:
        with fs_pub.open(f"{ERA5_BUCKET}/{key}", "rb") as f:
            ds = xr.open_dataset(f, engine="h5netcdf")
            la = xr.DataArray(lats, dims="points")
            lo = xr.DataArray(lons_360, dims="points")
            if "time" in ds.dims or "valid_time" in ds.dims:
                pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
                arr = pts.values.astype(np.float32)
                for tc in ("time", "valid_time"):
                    if tc in ds.coords:
                        ts = pd.DatetimeIndex(ds[tc].values)
                        break
                else:
                    raise ValueError("No time coord")
                ds.close()
                return arr, ts
            if "forecast_initial_time" in ds.dims and "forecast_hour" in ds.dims:
                pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
                arr3 = pts.values.astype(np.float32)
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
                ts_out = pd.DatetimeIndex(ts_list)
                order  = np.argsort(ts_out)
                ds.close()
                return arr_flat[order], ts_out[order]
            raise ValueError(f"Unknown layout: {list(ds.dims)}")
    except Exception as e:
        print(f"  WARN {key}: {e}", flush=True)
        return None


def deaccumulate(arr, timestamps):
    out = np.zeros_like(arr)
    hours = timestamps.hour
    for i in range(len(timestamps)):
        if i == 0 or hours[i] in (0, 6, 12, 18):
            out[i] = np.maximum(arr[i], 0)
        else:
            out[i] = np.maximum(arr[i] - arr[i - 1], 0)
    return out


def lon_to_360(lon: float) -> float:
    return lon % 360


def extract_month_for_locs(year: int, month: int,
                            lats: list[float], lons: list[float]) -> dict | None:
    ym = f"{year}{month:02d}"
    lons_360 = [lon_to_360(l) for l in lons]
    result: dict[str, np.ndarray] = {}
    timestamps = None

    # Analysis variables
    anal_prefix = f"e5.oper.an.sfc/{ym}/"
    for var_key, (nc_name, col_name) in ANAL_VARS.items():
        keys = list_files(anal_prefix, var_key)
        if not keys:
            continue
        out = stream_extract(keys[0], nc_name, lats, lons_360)
        if out is None:
            continue
        arr, ts = out
        if timestamps is None:
            timestamps = ts
        result[col_name] = arr

    if timestamps is None:
        print(f"  No timestamps for {ym}", flush=True)
        return None

    # Accumulated variables
    accumu_prefix = f"e5.oper.fc.sfc.accumu/{ym}/"
    for var_key, (nc_name, col_name) in ACCUMU_VARS.items():
        keys = list_files(accumu_prefix, var_key)
        if not keys:
            continue
        try:
            parts, ts_parts = [], []
            for k in keys:
                out = stream_extract(k, nc_name, lats, lons_360)
                if out is not None:
                    parts.append(out[0])
                    ts_parts.append(out[1])
            if not parts:
                continue
            full_arr = np.concatenate(parts, axis=0)
            full_ts  = ts_parts[0].append(ts_parts[1]) if len(ts_parts) > 1 else ts_parts[0]
            deacc = np.stack(
                [deaccumulate(full_arr[:, i], full_ts) for i in range(full_arr.shape[1])],
                axis=1,
            )
            ts_series = pd.Series(range(len(full_ts)), index=full_ts)
            idxs = [ts_series.get(t) for t in timestamps]
            valid = [(i, j) for i, j in enumerate(idxs) if j is not None]
            if valid:
                aligned = np.full((len(timestamps), deacc.shape[1]), np.nan, dtype=np.float32)
                for ti, si in valid:
                    aligned[ti] = deacc[si]
                result[col_name] = aligned
        except Exception as e:
            print(f"  WARN accumu {col_name} {ym}: {e}", flush=True)

    # MinMax variables (wind gusts)
    mm_prefix = f"e5.oper.fc.sfc.minmax/{ym}/"
    for var_key, (nc_name, col_name) in MINMAX_VARS.items():
        keys = list_files(mm_prefix, var_key)
        if not keys:
            continue
        try:
            parts, ts_parts = [], []
            for k in keys:
                out = stream_extract(k, nc_name, lats, lons_360)
                if out is not None:
                    parts.append(out[0])
                    ts_parts.append(out[1])
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
            print(f"  WARN minmax {col_name} {ym}: {e}", flush=True)

    # Combine precip
    if "precip_ls" in result and "precip_conv" in result:
        result["precipitation"] = result.pop("precip_ls") + result.pop("precip_conv")
    elif "precip_ls" in result:
        result["precipitation"] = result.pop("precip_ls")
    elif "precip_conv" in result:
        result["precipitation"] = result.pop("precip_conv")

    # Combine wind u/v → speed + direction
    if "_wind_u" in result and "_wind_v" in result:
        u = result.pop("_wind_u")
        v = result.pop("_wind_v")
        result["wind_speed_10m"]     = np.sqrt(u**2 + v**2).astype(np.float32)
        result["wind_direction_10m"] = (np.degrees(np.arctan2(u, v)) % 360).astype(np.float32)

    # Convert units
    if "temperature_2m" in result:
        result["temperature_2m"] = result["temperature_2m"] - 273.15
    if "dewpoint_2m" in result:
        result["dewpoint_2m"] = result["dewpoint_2m"] - 273.15
    if "pressure_msl" in result:
        result["pressure_msl"] = result["pressure_msl"] / 100.0
    if "surface_pressure" in result:
        result["surface_pressure"] = result["surface_pressure"] / 100.0
    if "cloud_cover" in result:
        result["cloud_cover"] = result["cloud_cover"] * 100.0

    # Derived: relative_humidity and apparent_temperature
    if "temperature_2m" in result and "dewpoint_2m" in result:
        T  = result["temperature_2m"]
        Td = result["dewpoint_2m"]
        result["relative_humidity_2m"] = (100 * np.exp(
            17.625 * Td / (243.04 + Td) - 17.625 * T / (243.04 + T)
        )).clip(0, 100).astype(np.float32)
        WS = result.get("wind_speed_10m", np.zeros_like(T))
        RH = result["relative_humidity_2m"]
        result["apparent_temperature"] = (
            T + 0.33 * (RH / 100.0) * 6.105 * np.exp(17.27 * T / (237.7 + T))
            - 0.70 * WS - 4.00
        ).astype(np.float32)

    return {"timestamps": timestamps, **result}


def build_location_df(loc: dict, all_months: list[dict]) -> pd.DataFrame:
    """Build a DataFrame for one location from a list of monthly data dicts."""
    frames = []
    loc_idx = [l["id"] for l in MISSING_LOCS].index(loc["id"])
    for month_data in all_months:
        ts = month_data["timestamps"]
        n  = len(ts)
        row = {"timestamp": ts}
        for col, arr in month_data.items():
            if col == "timestamps":
                continue
            if isinstance(arr, np.ndarray) and arr.ndim == 2:
                row[col] = arr[:, loc_idx]
            elif isinstance(arr, np.ndarray) and arr.ndim == 1:
                row[col] = arr
        frames.append(pd.DataFrame(row))
    df = pd.concat(frames, ignore_index=True).sort_values("timestamp").reset_index(drop=True)
    df["station_id"] = loc["id"]
    df["region"]     = loc["region"]
    df["latitude"]   = loc["lat"]
    df["longitude"]  = loc["lon"]
    return df


def _extract_ym(args):
    """Worker function for parallel month extraction."""
    year, month, lats, lons, total, idx = args
    print(f"[{idx}/{total}] ERA5 {year}-{month:02d} starting...", flush=True)
    data = extract_month_for_locs(year, month, lats, lons)
    if data is not None:
        print(f"[{idx}/{total}] ERA5 {year}-{month:02d} done: {len(data['timestamps'])} rows", flush=True)
    else:
        print(f"[{idx}/{total}] ERA5 {year}-{month:02d} FAILED", flush=True)
    return (year, month, data)


def main():
    from concurrent.futures import ThreadPoolExecutor, as_completed

    lats = [l["lat"] for l in MISSING_LOCS]
    lons = [l["lon"] for l in MISSING_LOCS]

    work_items = []
    total = len(YEARS) * 12
    idx = 0
    for year in YEARS:
        for month in range(1, 13):
            idx += 1
            work_items.append((year, month, lats, lons, total, idx))

    t0 = time.time()
    print(f"Extracting {total} months for atlanta+minneapolis in parallel (8 workers)...", flush=True)

    results_map = {}
    # 8 parallel workers — S3 byte-range reads are I/O bound so threads work well
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_extract_ym, item): item for item in work_items}
        for fut in as_completed(futures):
            year, month, data = fut.result()
            if data is not None:
                results_map[(year, month)] = data
            elapsed = time.time() - t0
            done = len(results_map)
            if done > 0:
                eta = (total - done) * (elapsed / done)
                print(f"  Progress: {done}/{total} done, elapsed={elapsed/60:.1f}m eta={eta/60:.1f}m", flush=True)

    # Sort by (year, month) to preserve chronological order
    all_months = [results_map[k] for k in sorted(results_map.keys())]
    print(f"Extraction complete: {len(all_months)}/{total} months retrieved in {(time.time()-t0)/60:.1f}m", flush=True)

    if not all_months:
        print("ERROR: No data extracted!", flush=True)
        sys.exit(1)

    # Build DataFrames for each missing location
    missing_dfs = [build_location_df(loc, all_months) for loc in MISSING_LOCS]
    missing_combined = pd.concat(missing_dfs, ignore_index=True)
    print(f"Missing locs extracted: {len(missing_combined)} rows", flush=True)

    # Assemble full safety cache from existing caches
    safety_ids = {l["id"]: l for l in GLOBAL_SAFETY_LOCATIONS}
    sources = {
        "aberdeen":    ("weather_4f63222a9a0c.csv", "aberdeen"),
        "birmingham":  ("weather_4f63222a9a0c.csv", "birmingham"),
        "bristol":     ("weather_4f63222a9a0c.csv", "bristol"),
        "cambridge":   ("weather_4f63222a9a0c.csv", "cambridge"),
        "cardiff":     ("weather_4f63222a9a0c.csv", "cardiff"),
        "chicago":     ("weather_680dae0b834c.csv", "chicago"),
        "denver":      ("weather_b5ebdeceb3c2.csv", "denver"),
        "edinburgh":   ("weather_1b53b2721adb.csv", "edinburgh"),
        "glasgow":     ("weather_4f63222a9a0c.csv", "glasgow"),
        "houston":     ("weather_480eeb3c040d.csv", "houston"),
        "london":      ("weather_480eeb3c040d.csv", "london"),
        "los_angeles": ("weather_680dae0b834c.csv", "los_angeles"),
        "manchester":  ("weather_4f63222a9a0c.csv", "manchester"),
        "miami":       ("weather_480eeb3c040d.csv", "miami"),
        "new_york":    ("weather_680dae0b834c.csv", "new_york"),
        "newcastle":   ("weather_4f63222a9a0c.csv", "newcastle"),
        "phoenix":     ("weather_941a8c575b77.csv", "phoenix"),
        "seattle":     ("weather_680dae0b834c.csv", "seattle"),
        "york":        ("weather_4f63222a9a0c.csv", "york"),
        "boston":      ("weather_680dae0b834c.csv", "boston"),
    }

    dfs = [missing_combined]
    loaded_files = {}
    for station, (fname, sid) in sources.items():
        if fname not in loaded_files:
            loaded_files[fname] = pd.read_csv(f"{CACHE_DIR}/{fname}", parse_dates=["timestamp"])
        df_src = loaded_files[fname]
        rows = df_src[df_src["station_id"] == sid].copy()
        loc  = safety_ids[station]
        rows["station_id"] = station
        rows["region"]     = loc.get("region", "unknown")
        rows["latitude"]   = loc["lat"]
        rows["longitude"]  = loc["lon"]
        dfs.append(rows)

    combined = pd.concat(dfs, ignore_index=True)
    combined = combined.sort_values(["station_id", "timestamp"]).reset_index(drop=True)
    print(f"Combined: {len(combined)} rows, {combined['station_id'].nunique()} stations", flush=True)
    combined.to_csv(TARGET_FILE, index=False)
    print(f"Saved: {TARGET_FILE}", flush=True)


if __name__ == "__main__":
    main()
