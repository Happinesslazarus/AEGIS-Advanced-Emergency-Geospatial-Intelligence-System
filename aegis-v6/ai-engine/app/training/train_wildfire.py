"""
train_wildfire.py — Wildfire Training Pipeline

Features: temperature, humidity, wind_speed, days_since_rain, fwi (Fire Weather Index)
Data:     Open-Meteo historical (global, free), optional NASA FIRMS
Labels:   FWI threshold (FWI > 25) as proxy → weakly_supervised (default)
          If real fire events loaded → supervised
Model:    XGBoost classifier

Usage:
    python -m app.training.train_wildfire --region=global
    python -m app.training.train_wildfire --region=australia
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

def _compute_fwi_proxy(temp: pd.Series, humidity: pd.Series,
                        wind: pd.Series, precip_7d: pd.Series) -> pd.Series:
    """
    Simplified Fire Weather Index (FWI) proxy.
    Based on the Canadian FWI system's core relationships:
      - Increases with temperature and wind
      - Decreases with humidity and recent precipitation
    """
    temp_factor = np.clip((temp - 10) / 25, 0, 1)
    hum_factor = np.clip(1.0 - humidity / 100, 0, 1)
    wind_factor = np.clip(wind / 20, 0, 1)
    rain_factor = np.clip(1.0 - precip_7d / 50, 0, 1)
    fwi = 50 * (0.30 * temp_factor + 0.25 * hum_factor +
                 0.20 * wind_factor + 0.25 * rain_factor)
    return fwi

class WildfirePipeline(BaseHazardPipeline):
    HAZARD_NAME = "wildfire"
    MODEL_TYPE_LABEL = "weakly_supervised"
    FEATURES = [
        "temperature",
        "humidity",
        "wind_speed",
        "days_since_rain",
        "fwi",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "Proxy labels from FWI threshold: fire_risk=1 when FWI > 25. "
        "If real fire events (NASA FIRMS) are available and loaded, "
        "switches to supervised labels. Currently WEAKLY SUPERVISED."
    )
    KNOWN_LIMITATIONS = (
        "FWI proxy is simplified (not a full Canadian FWI computation). "
        "Labels are derived from weather variables, creating circularity. "
        "No actual fire occurrence data used unless FIRMS data is provided."
    )

    def ingest_data(self) -> pd.DataFrame:
        return fetch_grid_sample(
            bbox=self.region.bbox,
            start_date=self.region.default_start,
            end_date=self.region.default_end,
            n_points=25,
            hourly_vars=[
                "temperature_2m",
                "relative_humidity_2m",
                "wind_speed_10m",
                "precipitation",
                "soil_moisture_0_to_7cm",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "temperature_2m": "temperature",
            "relative_humidity_2m": "humidity",
            "wind_speed_10m": "wind_speed",
            "soil_moisture_0_to_7cm": "soil_moisture",
        }, inplace=True)

        # 7-day rolling precipitation per location
        df["precip_7d"] = (
            df.groupby("location_id")["precipitation"]
            .transform(lambda s: s.rolling(7 * 24, min_periods=1).sum())
        )

        # Days since measurable rain (>= 1 mm)
        def _days_since_rain(precip: pd.Series) -> pd.Series:
            rain_mask = precip >= 1.0
            groups = rain_mask.cumsum()
            result = precip.groupby(groups).cumcount()
            result[rain_mask] = 0
            return result / 24.0  # convert hours to days
        df["days_since_rain"] = (
            df.groupby("location_id")["precipitation"]
            .transform(_days_since_rain)
        )

        # FWI proxy
        df["fwi"] = _compute_fwi_proxy(
            df["temperature"], df["humidity"], df["wind_speed"], df["precip_7d"]
        )

        # Season
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """FWI > 25 → fire risk = 1"""
        labels = (df["fwi"] > 25.0).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train wildfire hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = WildfirePipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
