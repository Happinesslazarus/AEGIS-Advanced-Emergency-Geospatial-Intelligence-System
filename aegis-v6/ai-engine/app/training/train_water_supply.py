"""
Trains the water supply disruption risk-prediction model on synthetic/augmented data.
Uses BaseHazardPipeline for the training loop. Useful as a quick
bootstrap when real-world labelled data is unavailable.

- Extends ai-engine/app/training/base_hazard_pipeline.py
- Synthetic feature generation via data_loaders.py and data_ingestion.py
- Saves to model_registry/water_supply_disruption/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/water_supply_disruption.py
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class WaterSupplyPipeline(BaseHazardPipeline):
    HAZARD_NAME = "water_supply"
    MODEL_TYPE_LABEL = "experimental"
    FEATURES = [
        "rainfall_deficit_30d",
        "temperature",
        "soil_moisture",
        "demand_proxy",
        "freeze_risk",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "EXPERIMENTAL weak proxy: supply_stress=1 when 30-day rainfall deficit "
        "> 50 mm below regional average AND temp > 25°C (high demand), "
        "OR freeze risk (temp < 0°C for > 12 consecutive hours). "
        "No real water supply disruption data used."
    )
    KNOWN_LIMITATIONS = (
        "No actual water supply disruption records. Demand is a temperature-based "
        "proxy only. Reservoir levels, pipe infrastructure, and population density "
        "are not modelled. Results are experimental indicators."
    )

    def ingest_data(self) -> pd.DataFrame:
        return fetch_grid_sample(
            bbox=self.region.bbox,
            start_date=self.region.default_start,
            end_date=self.region.default_end,
            n_points=25,
            hourly_vars=[
                "temperature_2m",
                "precipitation",
                "soil_moisture_0_to_7cm",
                "et0_fao_evapotranspiration",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "temperature_2m": "temperature",
            "soil_moisture_0_to_7cm": "soil_moisture",
            "et0_fao_evapotranspiration": "evapotranspiration",
        }, inplace=True)

        # 30-day rolling rainfall
        df["rainfall_30d"] = (
            df.groupby("location_id")["precipitation"]
            .transform(lambda s: s.rolling(30 * 24, min_periods=1).sum())
        )

        # Estimate long-term average rainfall per location (entire series mean)
        loc_avg = df.groupby("location_id")["rainfall_30d"].transform("mean")
        df["rainfall_deficit_30d"] = loc_avg - df["rainfall_30d"]

 # Demand proxy: higher temperature -> higher water demand
        df["demand_proxy"] = np.clip((df["temperature"] - 15) / 20, 0, 1)

        # Freeze risk
        df["freeze_risk"] = (df["temperature"] < 0).astype(float)

        # Season
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """
        EXPERIMENTAL: supply_stress=1 when deficit + heat OR freeze.
        """
        deficit_heat = (df["rainfall_deficit_30d"] > 50) & (df["temperature"] > 25)
        freeze = df["temperature"] < 0
        labels = (deficit_heat | freeze).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train water-supply hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = WaterSupplyPipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
