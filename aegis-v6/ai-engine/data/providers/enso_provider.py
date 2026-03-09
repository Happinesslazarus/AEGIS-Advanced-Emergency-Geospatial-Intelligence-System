from __future__ import annotations

from datetime import datetime
from io import StringIO
from urllib.request import urlopen

import pandas as pd

from .base_provider import DataProvider


class ENSOProvider(DataProvider):
    @property
    def name(self) -> str:
        return "enso_provider"

    @property
    def supported_regions(self) -> list[str]:
        return ["scotland", "england", "wales", "northern_ireland"]

    def get_output_schema(self) -> dict[str, type]:
        return {
            "date": datetime,
            "enso_index": float,
            "enso_phase": str,
            "enso_strength": float,
            "region_id": str,
            "is_synthetic": bool,
        }

    def download(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        url = "https://www.cpc.ncep.noaa.gov/data/indices/meiv2.data"
        with urlopen(url, timeout=30) as response:
            content = response.read().decode("utf-8")

        rows: list[dict[str, object]] = []
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        for line in lines:
            if not line[:4].isdigit():
                continue
            parts = line.split()
            if len(parts) < 13:
                continue
            year = int(parts[0])
            for month_idx in range(1, 13):
                raw = parts[month_idx]
                try:
                    value = float(raw)
                except ValueError:
                    continue
                dt = datetime(year, month_idx, 1)
                phase = "warm" if value > 0.5 else "cold" if value < -0.5 else "neutral"
                strength = min(3.0, abs(value))
                rows.append(
                    {
                        "date": dt,
                        "enso_index": value,
                        "enso_phase": phase,
                        "enso_strength": strength,
                        "region_id": region_id,
                        "is_synthetic": False,
                    }
                )

        df = pd.DataFrame(rows)
        if df.empty:
            return df
        mask = (df["date"] >= pd.to_datetime(start)) & (df["date"] <= pd.to_datetime(end))
        return df.loc[mask].reset_index(drop=True)
