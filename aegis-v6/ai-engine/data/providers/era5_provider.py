from __future__ import annotations

import os
from datetime import datetime

import pandas as pd

from registry.region_registry import get_region
from .base_provider import DataProvider


class ERA5Provider(DataProvider):
    @property
    def name(self) -> str:
        return "era5_provider"

    @property
    def supported_regions(self) -> list[str]:
        return ["scotland", "england", "wales", "northern_ireland"]

    def get_output_schema(self) -> dict[str, type]:
        return {
            "timestamp": datetime,
            "latitude": float,
            "longitude": float,
            "precipitation_mm_h": float,
            "soil_moisture_vwc": float,
            "temperature_c": float,
            "wind_speed_ms": float,
            "wind_dir_deg": float,
            "dewpoint_c": float,
            "relative_humidity_pct": float,
            "evapotranspiration_mm_d": float,
            "runoff_mm_h": float,
            "region_id": str,
            "is_synthetic": bool,
        }

    def download(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        _ = get_region(region_id)
        if not os.getenv("CDS_API_KEY"):
            raise RuntimeError(
                "ERA5 credentials not set. Register free at: https://cds.climate.copernicus.eu; "
                "Create ~/.cdsapirc with url and key."
            )

        # Integration stub: CDS API implementation is intentionally explicit to avoid silent fake data.
        # Falling back is handled by DataProvider.download_with_fallback.
        raise NotImplementedError("ERA5 download integration pending full CDS API workflow implementation")
