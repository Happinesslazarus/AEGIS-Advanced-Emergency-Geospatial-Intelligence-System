from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib

import numpy as np
import pandas as pd

from registry.region_registry import get_region


GLOBAL_SEED = 42


@dataclass
class SyntheticProvider:
    source_name: str

    def generate(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        region = get_region(region_id)
        ts = pd.date_range(start=start, end=end, freq="1h", tz="UTC")
        if len(ts) == 0:
            return pd.DataFrame(
                columns=[
                    "station_id",
                    "station_name",
                    "river_name",
                    "latitude",
                    "longitude",
                    "timestamp",
                    "level_m",
                    "flow_m3s",
                    "typical_high_m",
                    "bankfull_m",
                    "trend",
                    "region_id",
                    "is_synthetic",
                ]
            )

        seed_input = f"{self.source_name}:{region_id}:{start}:{end}:{GLOBAL_SEED}".encode()
        seed = int(hashlib.sha256(seed_input).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)

        lat_s, lon_w, lat_n, lon_e = region.bbox
        station_count = 8
        rows: list[dict[str, object]] = []

        for station_idx in range(station_count):
            station_id = f"SYN-{region_id[:3].upper()}-{station_idx:03d}"
            station_name = f"Synthetic Station {station_idx + 1}"
            river_name = f"River {station_idx + 1}"
            latitude = float(rng.uniform(lat_s, lat_n))
            longitude = float(rng.uniform(lon_w, lon_e))
            base_level = float(rng.uniform(0.7, 2.2))
            typical_high = float(base_level + rng.uniform(0.5, 1.0))
            bankfull = float(typical_high * region.bankfull_multiplier)

            noise = rng.normal(0, 0.15, size=len(ts))
            seasonal = 0.3 * np.sin(np.linspace(0, 6 * np.pi, len(ts)))
            series = np.clip(base_level + seasonal + noise, 0.1, None)

            for idx, timestamp in enumerate(ts):
                current_level = float(series[idx])
                prev_level = float(series[idx - 1]) if idx > 0 else current_level
                delta = current_level - prev_level
                trend = "rising" if delta > 0.03 else "falling" if delta < -0.03 else "steady"

                rows.append(
                    {
                        "station_id": station_id,
                        "station_name": station_name,
                        "river_name": river_name,
                        "latitude": latitude,
                        "longitude": longitude,
                        "timestamp": timestamp.to_pydatetime(),
                        "level_m": current_level,
                        "flow_m3s": float(max(0.0, current_level * rng.uniform(2.0, 15.0))),
                        "typical_high_m": typical_high,
                        "bankfull_m": bankfull,
                        "trend": trend,
                        "region_id": region_id,
                        "is_synthetic": True,
                    }
                )

        return pd.DataFrame(rows)
