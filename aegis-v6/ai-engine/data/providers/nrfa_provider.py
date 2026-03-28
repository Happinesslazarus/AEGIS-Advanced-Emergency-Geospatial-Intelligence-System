from __future__ import annotations

import json
from datetime import datetime
from urllib.request import urlopen

import pandas as pd

from registry.region_registry import get_region
from .base_provider import DataProvider

class NRFAProvider(DataProvider):
    @property
    def name(self) -> str:
        return "nrfa_provider"

    @property
    def supported_regions(self) -> list[str]:
        return ["scotland", "england", "wales", "northern_ireland"]

    def get_output_schema(self) -> dict[str, type]:
        return {
            "station_id": str,
            "peak_flow_m3s": float,
            "bankfull_m3s": float,
            "return_period_years": float,
            "catchment_area_km2": float,
            "date": datetime,
            "region_id": str,
            "is_synthetic": bool,
        }

    def download(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        region = get_region(region_id)
        lat_s, lon_w, lat_n, lon_e = region.bbox

        stations_url = "https://nrfa.ceh.ac.uk/api/station?format=json"
        with urlopen(stations_url, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))

        station_items = payload.get("data", payload.get("items", []))
        rows: list[dict[str, object]] = []

        for station in station_items[:500]:
            station_id = station.get("id")
            lat_lon = station.get("lat-lon") or {}
            lat = lat_lon.get("lat")
            lon = lat_lon.get("lon")
            if station_id is None or lat is None or lon is None:
                continue
            if not (lat_s <= float(lat) <= lat_n and lon_w <= float(lon) <= lon_e):
                continue

            rows.append(
                {
                    "station_id": str(station_id),
                    "peak_flow_m3s": float(station.get("bankfull-flow") or 0.0),
                    "bankfull_m3s": float(station.get("bankfull-flow") or 0.0),
                    "return_period_years": 2.0,
                    "catchment_area_km2": float(station.get("catchment-area") or 0.0),
                    "date": datetime.utcnow(),
                    "region_id": region_id,
                    "is_synthetic": False,
                }
            )

        return pd.DataFrame(rows)
