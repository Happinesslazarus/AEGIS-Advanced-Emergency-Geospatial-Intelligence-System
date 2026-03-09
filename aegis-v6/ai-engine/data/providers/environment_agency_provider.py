from __future__ import annotations

from datetime import UTC, datetime
import json
from urllib.request import urlopen
import pandas as pd

from registry.region_registry import get_region
from .base_provider import DataProvider


class EnvironmentAgencyProvider(DataProvider):
    @property
    def name(self) -> str:
        return "environment_agency_provider"

    @property
    def supported_regions(self) -> list[str]:
        return ["england", "wales"]

    def get_output_schema(self) -> dict[str, type]:
        return {
            "station_id": str,
            "station_name": str,
            "river_name": str,
            "latitude": float,
            "longitude": float,
            "timestamp": datetime,
            "level_m": float,
            "flow_m3s": float,
            "typical_high_m": float,
            "bankfull_m": float,
            "trend": str,
            "region_id": str,
            "is_synthetic": bool,
        }

    def download(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        region = get_region(region_id)
        with urlopen(region.gauge_api_url, timeout=30) as response:
            stations_payload = json.loads(response.read().decode("utf-8"))
        stations = stations_payload.get("items", [])
        rows: list[dict[str, object]] = []

        for station in stations[:100]:
            station_id = station.get("stationReference") or station.get("notation")
            if not station_id:
                continue

            lat = station.get("lat")
            lon = station.get("long")
            if lat is None or lon is None:
                continue

            readings_url = f"{region.flood_api_base}/id/stations/{station_id}/readings?latest"
            try:
                with urlopen(readings_url, timeout=30) as response:
                    reading_payload = json.loads(response.read().decode("utf-8"))
            except Exception:
                continue

            items = reading_payload.get("items", [])
            if not items:
                continue

            reading = items[0]
            dt = reading.get("dateTime")
            value = reading.get("value")
            if dt is None or value is None:
                continue

            timestamp = datetime.fromisoformat(str(dt).replace("Z", "+00:00")).astimezone(UTC)
            rows.append(
                {
                    "station_id": str(station_id),
                    "station_name": str(station.get("label") or station.get("name") or station_id),
                    "river_name": str(station.get("riverName") or ""),
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "timestamp": timestamp,
                    "level_m": float(value),
                    "flow_m3s": float(value) * 5.0,
                    "typical_high_m": None,
                    "bankfull_m": None,
                    "trend": "steady",
                    "region_id": region_id,
                    "is_synthetic": False,
                }
            )

        return pd.DataFrame(rows)
