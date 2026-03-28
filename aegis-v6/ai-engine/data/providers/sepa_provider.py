from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any
import json
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

import pandas as pd

from registry.region_registry import get_region
from .base_provider import DataProvider

class SEPAProvider(DataProvider):
    @property
    def name(self) -> str:
        return "sepa_provider"

    @property
    def supported_regions(self) -> list[str]:
        return ["scotland"]

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

    def _request_with_retry(self, url: str, retries: int = 3) -> Any:
        backoff = 0.5
        for attempt in range(retries):
            try:
                with urlopen(url, timeout=30) as response:
                    payload = response.read().decode("utf-8")
                return json.loads(payload)
            except Exception:
                if attempt == retries - 1:
                    raise
                time.sleep(backoff)
                backoff *= 2
        raise RuntimeError("unreachable")

    def _compute_trend(self, levels: list[float]) -> str:
        if len(levels) < 2:
            return "steady"
        delta = levels[-1] - levels[0]
        if delta > 0.03:
            return "rising"
        if delta < -0.03:
            return "falling"
        return "steady"

    def download(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        region = get_region(region_id)
        stations_payload = self._request_with_retry(region.gauge_api_url)

        stations = stations_payload if isinstance(stations_payload, list) else stations_payload.get("items", [])
        rows: list[dict[str, object]] = []

        for station in stations[:500]:
            station_id = station.get("id") or station.get("stationId") or station.get("StationId")
            if not station_id:
                continue

            lat = station.get("lat") or station.get("latitude")
            lon = station.get("long") or station.get("longitude")
            if lat is None or lon is None:
                continue

            readings_url = f"https://www.sepa.org.uk/api/Readings?stationId={station_id}&all=true"
            readings_payload = self._request_with_retry(readings_url)
            readings = readings_payload if isinstance(readings_payload, list) else readings_payload.get("items", [])
            if not readings:
                continue

            recent = readings[-3:] if len(readings) >= 3 else readings
            levels: list[float] = []
            last_ts: datetime | None = None
            last_level = 0.0
            for reading in recent:
                level = reading.get("value") or reading.get("level")
                ts_raw = reading.get("dateTime") or reading.get("timestamp")
                if level is None or ts_raw is None:
                    continue
                levels.append(float(level))
                last_level = float(level)
                last_ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00")).astimezone(UTC)

            if last_ts is None:
                continue

            rows.append(
                {
                    "station_id": str(station_id),
                    "station_name": str(station.get("name") or station.get("label") or station_id),
                    "river_name": str(station.get("river") or station.get("riverName") or ""),
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "timestamp": last_ts,
                    "level_m": last_level,
                    "flow_m3s": float(last_level * 4.0),
                    "typical_high_m": None,
                    "bankfull_m": None,
                    "trend": self._compute_trend(levels),
                    "region_id": region_id,
                    "is_synthetic": False,
                }
            )

            # Rate limit: 2 req/s
            time.sleep(0.5)

        return pd.DataFrame(rows)
