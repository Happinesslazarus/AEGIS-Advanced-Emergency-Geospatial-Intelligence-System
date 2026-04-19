"""
Trains the infrastructure damage risk-prediction model on synthetic/augmented data.
Uses BaseHazardPipeline for the training loop. Useful as a quick
bootstrap when real-world labelled data is unavailable.

- Extends ai-engine/app/training/base_hazard_pipeline.py
- Synthetic feature generation via data_loaders.py and data_ingestion.py
- Saves to model_registry/infrastructure_damage/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/infrastructure_damage.py
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class InfrastructureDamagePipeline(BaseHazardPipeline):
    HAZARD_NAME = "infrastructure_damage"
    MODEL_TYPE_LABEL = "heuristic_model"
    FEATURES = [
        "weather_severity",
        "flood_depth_proxy",
        "wind_speed",
        "wind_gust",
        "rainfall_24h",
        "soil_moisture",
        "infrastructure_type_proxy",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "Synthetic heuristic: damage=1 when weather_severity > 0.7 "
        "(composite of wind, rain, flood proxy) OR flood_depth_proxy > 0.5 m. "
        "No real infrastructure damage reports used — HEURISTIC MODEL."
    )
    KNOWN_LIMITATIONS = (
        "No real damage event records. Infrastructure type is a random proxy. "
        "Building materials, age, and maintenance are not modelled. "
        "Flood depth is approximated from rainfall accumulation, not hydrological model."
    )

    def ingest_data(self) -> pd.DataFrame:
        return fetch_grid_sample(
            bbox=self.region.bbox,
            start_date=self.region.default_start,
            end_date=self.region.default_end,
            n_points=25,
            hourly_vars=[
                "temperature_2m",
                "wind_speed_10m",
                "wind_gusts_10m",
                "precipitation",
                "soil_moisture_0_to_7cm",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "wind_speed_10m": "wind_speed",
            "wind_gusts_10m": "wind_gust",
            "temperature_2m": "temperature",
            "soil_moisture_0_to_7cm": "soil_moisture",
        }, inplace=True)

        # 24-hour rainfall
        df["rainfall_24h"] = (
            df.groupby("location_id")["precipitation"]
            .transform(lambda s: s.rolling(24, min_periods=1).sum())
        )

        # Flood depth proxy from excessive rainfall + soil moisture
        df["flood_depth_proxy"] = np.clip(
            (df["rainfall_24h"] - 30) / 100 + df["soil_moisture"] / 2,
            0, 3.0
        )

        # Weather severity composite (0-1)
        wind_norm = np.clip(df["wind_speed"] / 35, 0, 1)
        rain_norm = np.clip(df["rainfall_24h"] / 80, 0, 1)
        flood_norm = np.clip(df["flood_depth_proxy"] / 2, 0, 1)
        df["weather_severity"] = 0.4 * wind_norm + 0.35 * rain_norm + 0.25 * flood_norm

        # Infrastructure type: derived from REAL elevation bands via Open-Elevation API
        # Low elevation (<50m) → 0 (residential/commercial, floodplain areas)
        # Medium (50-200m) → 1 (mixed suburban)
        # High (200-500m) → 2 (industrial/rural)
        # Very high (>500m) → 3 (critical/remote infrastructure)
        import aiohttp

        ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"

        async def _get_infra_types(locs):
            type_map = {}
            async with aiohttp.ClientSession() as session:
                for lid in locs:
                    loc_rows = df.loc[df["location_id"] == lid]
                    lat = loc_rows["latitude"].iloc[0]
                    lon = loc_rows["longitude"].iloc[0]
                    try:
                        async with session.get(
                            ELEVATION_URL,
                            params={"locations": f"{lat},{lon}"},
                            timeout=aiohttp.ClientTimeout(total=10),
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json(content_type=None)
                                elev = data["results"][0]["elevation"]
                                if elev < 50:
                                    type_map[lid] = 0.0
                                elif elev < 200:
                                    type_map[lid] = 1.0
                                elif elev < 500:
                                    type_map[lid] = 2.0
                                else:
                                    type_map[lid] = 3.0
                                continue
                    except Exception:
                        pass
                    type_map[lid] = None
            return type_map

        import asyncio as _aio
        try:
            loop = _aio.get_running_loop()
        except RuntimeError:
            loop = None

        loc_ids = df["location_id"].unique()
        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                type_map = pool.submit(lambda: _aio.run(_get_infra_types(loc_ids))).result()
        else:
            type_map = _aio.run(_get_infra_types(loc_ids))

        failed = [lid for lid, v in type_map.items() if v is None]
        if len(failed) == len(loc_ids):
            raise ValueError(
                "TRAINING ABORTED: Open-Elevation API unreachable for ALL locations. "
                "Cannot derive infrastructure type from elevation. Check network connectivity."
            )
        if failed:
            valid = [v for v in type_map.values() if v is not None]
            median_type = sorted(valid)[len(valid) // 2]
            for lid in failed:
                type_map[lid] = median_type
            logger.warning(f"Open-Elevation failed for {len(failed)}/{len(loc_ids)} locations, using median type={median_type}")

        df["infrastructure_type_proxy"] = df["location_id"].map(type_map).astype(float)

        # Season
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """Heuristic: damage=1 when severe weather or flooding."""
        labels = (
            (df["weather_severity"] > 0.7) | (df["flood_depth_proxy"] > 0.5)
        ).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train infrastructure-damage hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = InfrastructureDamagePipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
