"""
Real river-gauge data provider backed by SEPA KiWIS + EA Flood Monitoring APIs.
Replaces the former SyntheticProvider — NO synthetic/random data is generated.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import aiohttp
import pandas as pd
from loguru import logger

from registry.region_registry import get_region

SEPA_BASE = "https://timeseries.sepa.org.uk/KiWIS/KiWIS"
EA_BASE = "https://environment.data.gov.uk/flood-monitoring"

async def _fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
) -> Any:
    try:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            if resp.status != 200:
                return None
            return await resp.json(content_type=None)
    except Exception:
        return None

@dataclass
class RealDataProvider:
    source_name: str

    def generate(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        """Fetch REAL river gauge data from SEPA + EA APIs for the given region/period."""
        return asyncio.get_event_loop().run_until_complete(
            self._fetch_real(region_id, start, end)
        )

    async def _fetch_real(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        region = get_region(region_id)
        lat_s, lon_w, lat_n, lon_e = region.bbox
        rows: List[Dict[str, object]] = []

        async with aiohttp.ClientSession() as session:
            # SEPA KiWIS
            try:
                ts_list = await _fetch_json(session, SEPA_BASE, params={
                    "service": "kisters",
                    "type": "queryServices",
                    "request": "getTimeseriesList",
                    "datasource": 0,
                    "format": "json",
                    "parametertype_name": "Water Level",
                    "ts_name": "15min.Cmd.O",
                    "returnfields": "ts_id,station_no,station_name,station_latitude,station_longitude",
                }, timeout=60)

                if ts_list and len(ts_list) > 1:
                    for row in ts_list[1:21]:
                        s_lat, s_lon = float(row[3]), float(row[4])
                        if not (lat_s <= s_lat <= lat_n and lon_w <= s_lon <= lon_e):
                            continue
                        ts_id = row[0]
                        readings = await _fetch_json(session, SEPA_BASE, params={
                            "service": "kisters",
                            "type": "queryServices",
                            "request": "getTimeseriesValues",
                            "datasource": 0,
                            "format": "json",
                            "ts_id": ts_id,
                            "from": start,
                            "to": end,
                            "returnfields": "Timestamp,Value",
                        }, timeout=90)
                        if readings and readings[0].get("data"):
                            for pt in readings[0]["data"]:
                                if pt[1] is None:
                                    continue
                                level = float(pt[1])
                                rows.append({
                                    "station_id": row[1],
                                    "station_name": row[2],
                                    "river_name": row[2],
                                    "latitude": s_lat,
                                    "longitude": s_lon,
                                    "timestamp": pd.to_datetime(pt[0]),
                                    "level_m": level,
                                    "flow_m3s": None,
                                    "typical_high_m": None,
                                    "bankfull_m": None,
                                    "trend": None,
                                    "region_id": region_id,
                                    "is_synthetic": False,
                                })
            except Exception as e:
                logger.warning(f"SEPA fetch failed: {e}")

            # EA Flood Monitoring
            try:
                ea_stations = await _fetch_json(session, f"{EA_BASE}/id/stations", params={
                    "parameter": "level",
                    "status": "Active",
                    "_limit": "30",
                })
                if ea_stations and ea_stations.get("items"):
                    for stn in ea_stations["items"]:
                        s_lat = stn.get("lat")
                        s_lon = stn.get("long")
                        if s_lat is None or not (lat_s <= s_lat <= lat_n and lon_w <= s_lon <= lon_e):
                            continue
                        ref = stn.get("stationReference")
                        readings = await _fetch_json(
                            session,
                            f"{EA_BASE}/id/stations/{ref}/readings",
                            params={"since": start, "_limit": "10000", "_sorted": ""},
                            timeout=90,
                        )
                        if readings and readings.get("items"):
                            for item in readings["items"]:
                                val = item.get("value")
                                if val is None:
                                    continue
                                rows.append({
                                    "station_id": ref,
                                    "station_name": stn.get("label", ref),
                                    "river_name": stn.get("riverName", ""),
                                    "latitude": s_lat,
                                    "longitude": s_lon,
                                    "timestamp": pd.to_datetime(item["dateTime"]),
                                    "level_m": float(val),
                                    "flow_m3s": None,
                                    "typical_high_m": None,
                                    "bankfull_m": None,
                                    "trend": None,
                                    "region_id": region_id,
                                    "is_synthetic": False,
                                })
            except Exception as e:
                logger.warning(f"EA fetch failed: {e}")

        if not rows:
            raise RuntimeError(
                f"TRAINING ABORTED: No real river data from SEPA/EA for region '{region_id}' "
                f"({start} to {end}). Check network connectivity. Cannot proceed with synthetic data."
            )

        df = pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)

        # Compute trend from sequential readings per station
        for sid in df["station_id"].unique():
            mask = df["station_id"] == sid
            levels = df.loc[mask, "level_m"]
            deltas = levels.diff().fillna(0)
            df.loc[mask, "trend"] = deltas.apply(
                lambda d: "rising" if d > 0.03 else ("falling" if d < -0.03 else "steady")
            )

        logger.info(
            f"RealDataProvider: {len(df)} readings from "
            f"{df['station_id'].nunique()} stations for region '{region_id}'"
        )
        return df

# Backward-compatible alias
SyntheticProvider = RealDataProvider
