#!/usr/bin/env python3
"""
download_grdc_multi_source.py
Downloads real daily river discharge (or water-level) data for
GRDC training stations using publicly accessible national APIs.

Sources:
  USGS NWIS     — US stations     (public REST, no auth)
  UK NRFA       — UK stations     (public REST, no auth)
  Pegelonline   — Germany Rhine/Elbe (public REST, no auth)
  GRDC REST     — other stations  (if API becomes available)

Run from: aegis-v6/ai-engine/
  python download_grdc_multi_source.py

Saves files to: data/grdc/grdc_{station_id}.csv
Format: date,discharge_m3s  (simple 2-col CSV; load_grdc_station() accepts this)
"""
import csv
import json
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

GRDC_DIR = Path(__file__).parent / "data" / "grdc"
GRDC_DIR.mkdir(parents=True, exist_ok=True)

START = "2015-01-01"
END   = "2025-12-31"

# ---------------------------------------------------------------------------
# Station routing: GRDC_ID → (source, source_id, description)
# ---------------------------------------------------------------------------
STATION_ROUTES = {
    # US stations — USGS NWIS daily values
    4127800: ("usgs",        "04216000", "Niagara River at Buffalo NY"),
    4148530: ("usgs",        "03294500", "Ohio River at Louisville KY"),
    4149900: ("usgs",        "07032000", "Mississippi River at Memphis TN"),
    4212600: ("usgs",        "11370500", "Sacramento River at Keswick CA"),
    4150000: ("usgs",        "07374000", "Mississippi at St Francisville LA"),

    # UK stations — NRFA gauged daily flows
    2279600: ("nrfa",        "96001",    "River Creed at Stornoway"),
    2399500: ("nrfa",        "54001",    "River Severn at Tewkesbury"),
    2904900: ("nrfa",        "76001",    "River Leven at Newby Bridge"),

    # Australia — BOM KISTERS daily mean discharge (m3/s = cumec)
    # Murray: station_id=1618355 (River Murray downstream Morgan), ts_id=217277010
    5300500: ("bom",  "217277010", "River Murray downstream Morgan SA"),
    # Darling: station_id=590813 (DARLING@U/S WEIR 32), ts_id=169977010
    # Closest BOM discharge gauge to GRDC 5304000 (Darling at Wentworth)
    5304000: ("bom",  "169977010", "Darling River upstream Weir 32 NSW"),

}

# Stations requiring manual download from GRDC portal
# IDs verified against GRDC_Stations.xlsx catalog (April 2026).
# portal.grdc.bafg.de -> Public User (auto-login) -> search by station ID -> Download Daily CSV
# Save as: data/grdc/grdc_{station_id}.csv  with header: date,discharge_m3s
MANUAL_STATIONS = {
    # --- stations with confirmed GRDC daily data ---
    6335060: ("Rhine at Cologne DE",        "GRDC portal — 1816-2024"),
    6340110: ("Elbe at Neu Darchau DE",     "GRDC portal — 1874-2023"),
    6142200: ("Danube at Bratislava SK",    "GRDC portal — 1900-2024"),
    6729403: ("Glomma at Solbergfoss NO",   "GRDC portal — 1901-2023"),
    1147010: ("Congo at Kinshasa CD",       "GRDC portal — 1903-2010"),
    2469260: ("Mekong at Pakse LA",         "GRDC portal — 1960-1993"),
    # --- stations with NO GRDC daily data (d_start=None in catalog) — skip ---
    # 1673600: White Nile / Malakal SS   — no daily data at GRDC
    # 2595600: Tigris / Mosul IQ         — no daily data at GRDC
    # 2335200: Indus / Attock PK         — no daily data at GRDC
    # 2646100: Ganges / Paksey BD        — no daily data at GRDC
}


def save(grdc_id: int, rows: list[tuple]) -> None:
    """rows: list of (date_str YYYY-MM-DD, value_float)"""
    path = GRDC_DIR / f"grdc_{grdc_id}.csv"
    rows = [(d, v) for d, v in rows if v is not None and v > -900]
    rows.sort()
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "discharge_m3s"])
        w.writerows(rows)
    print(f"  Saved {len(rows):,} rows -> {path.name}")


# ---------------------------------------------------------------------------
# USGS NWIS daily values
# ---------------------------------------------------------------------------
def fetch_usgs(grdc_id: int, usgs_id: str) -> None:
    url = (
        f"https://waterservices.usgs.gov/nwis/dv/?format=json"
        f"&sites={usgs_id}&startDT={START}&endDT={END}"
        f"&parameterCd=00060&siteStatus=all"
    )
    print(f"  Fetching USGS {usgs_id} ...", end=" ", flush=True)
    with urllib.request.urlopen(url, timeout=60) as r:
        d = json.loads(r.read())

    ts = d.get("value", {}).get("timeSeries", [])
    if not ts:
        print("no timeseries returned")
        return

    # Find discharge parameter (00060)
    series = None
    for t in ts:
        var = t.get("variable", {}).get("variableCode", [{}])[0].get("value", "")
        if var == "00060":
            series = t
            break
    if series is None:
        series = ts[0]

    values = series.get("values", [{}])[0].get("value", [])
    # USGS NWIS daily values for parameter 00060 are in cubic feet/second (cfs)
    # Convert to m3/s: 1 cfs = 0.028316846592 m3/s
    CFS_TO_M3S = 0.028316846592
    unit = series.get("variable", {}).get("unit", {}).get("unitCode", "")
    convert = CFS_TO_M3S if "ft3" in unit.lower() or "cfs" in unit.lower() or not unit else 1.0
    rows = []
    for v in values:
        try:
            rows.append((v["dateTime"][:10], float(v["value"]) * convert))
        except (KeyError, ValueError):
            pass
    print(f"{len(rows):,} records")
    save(grdc_id, rows)


# ---------------------------------------------------------------------------
# UK NRFA gauged daily flow
# ---------------------------------------------------------------------------
def fetch_nrfa(grdc_id: int, nrfa_id: str) -> None:
    url = (
        f"https://nrfaapps.ceh.ac.uk/nrfa/ws/time-series"
        f"?format=json-object&data-type=gdf&station={nrfa_id}"
        f"&start={START}&end={END}"
    )
    print(f"  Fetching NRFA {nrfa_id} ...", end=" ", flush=True)
    with urllib.request.urlopen(url, timeout=60) as r:
        d = json.loads(r.read())

    stream = d.get("data-stream", [])
    # NRFA data-stream alternates: date, value, date, value ...
    rows = []
    i = 0
    while i + 1 < len(stream):
        date_str = stream[i]
        val      = stream[i + 1]
        if val is not None:
            rows.append((date_str[:10], float(val)))
        i += 2
    print(f"{len(rows):,} records")
    save(grdc_id, rows)


# ---------------------------------------------------------------------------
# Germany Pegelonline (water level W in cm — stored as discharge proxy)
# ---------------------------------------------------------------------------
def fetch_pegelonline(grdc_id: int, station_id: str) -> None:
    # Pegelonline accepts ISO 8601 range; fetch year by year to avoid timeout
    station_enc = urllib.parse.quote(station_id)
    all_rows = []
    year = 2015
    while year <= 2025:
        y_start = f"{year}-01-01T00:00+01:00"
        y_end   = f"{year}-12-31T23:59+01:00"
        url = (
            f"https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/"
            f"{station_enc}/W/measurements.json?start={y_start}&end={y_end}"
        )
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                records = json.loads(r.read())
            for rec in records:
                ts = rec.get("timestamp", "")[:10]
                val = rec.get("value")
                if ts and val is not None:
                    all_rows.append((ts, float(val)))
            print(f"    year {year}: {len(records)} records", flush=True)
        except Exception as e:
            print(f"    year {year}: {e}")
        year += 1
        time.sleep(0.3)

    save(grdc_id, all_rows)


# ---------------------------------------------------------------------------
# Australia BOM KISTERS daily discharge
# ---------------------------------------------------------------------------
def fetch_bom(grdc_id: int, ts_id: str) -> None:
    """
    Fetch daily mean Water Course Discharge from BOM KISTERS API.
    ts_id: timeseries ID for DMQaQc.Merged.DailyMean.24HR or similar.
    Units: cumec (m3/s) — no conversion needed.
    BOM limits requests to ~1 year; fetch year-by-year.
    """
    all_rows: list[tuple] = []
    year = 2015
    while year <= 2025:
        url = (
            "http://www.bom.gov.au/waterdata/services"
            f"?service=kisters&type=queryServices&request=getTimeseriesValues"
            f"&ts_id={ts_id}"
            f"&from={year}-01-01&to={year}-12-31"
            f"&returnfields=Timestamp,Value"
            f"&format=json"
        )
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                payload = json.loads(r.read())
            records = payload[0].get("data", []) if payload else []
            for ts_val in records:
                date_str = ts_val[0][:10]  # "2015-01-01T00:30:00..." -> "2015-01-01"
                val = ts_val[1]
                if val is not None:
                    all_rows.append((date_str, float(val)))
            print(f"    year {year}: {len(records)} records", flush=True)
        except Exception as e:
            print(f"    year {year}: {e}")
        year += 1
        time.sleep(0.3)
    save(grdc_id, all_rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
import urllib.parse

def main():
    print(f"=== GRDC Multi-Source Downloader  ({START} to {END}) ===\n")
    print(f"Output directory: {GRDC_DIR}\n")

    ok = 0
    fail = 0

    for grdc_id, (source, src_id, desc) in STATION_ROUTES.items():
        path = GRDC_DIR / f"grdc_{grdc_id}.csv"
        if path.exists():
            import pandas as pd
            df = pd.read_csv(path)
            if len(df) > 100:
                # Re-download US stations to apply CFS->m3/s conversion
                if source != "usgs":
                    print(f"SKIP {grdc_id} ({desc}): already have {len(df):,} rows")
                    ok += 1
                    continue

        print(f"\n[{grdc_id}] {desc} via {source.upper()}")
        try:
            if source == "usgs":
                fetch_usgs(grdc_id, src_id)
            elif source == "nrfa":
                fetch_nrfa(grdc_id, src_id)
            elif source == "pegelonline":
                fetch_pegelonline(grdc_id, src_id)
            elif source == "bom":
                fetch_bom(grdc_id, src_id)
            ok += 1
            time.sleep(0.5)
        except Exception as e:
            print(f"  ERROR: {e}")
            fail += 1

    print(f"\n=== Done: {ok} downloaded, {fail} failed ===\n")

    print("Stations requiring manual download from GRDC portal")
    print("(portal.grdc.bafg.de -> Public User login -> Search by ID -> Download CSV):\n")
    for grdc_id, (desc, source) in MANUAL_STATIONS.items():
        path = GRDC_DIR / f"grdc_{grdc_id}.csv"
        status = "EXISTS" if path.exists() else "MISSING"
        print(f"  [{status}] {grdc_id:>8}  {desc:<40} ({source})")
    print(f"\nSave manual downloads to: {GRDC_DIR}/grdc_{{station_id}}.csv")
    print("Format: 2 columns with header 'date,discharge_m3s'")


if __name__ == "__main__":
    main()
