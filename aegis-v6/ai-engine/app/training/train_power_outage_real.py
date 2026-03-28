"""
AEGIS AI Engine — Power Outage Real-Data Training

Train power outage risk model using REAL data:
  - Open-Meteo historical weather observations (wind, temperature, humidity)
  - SEPA/EA river level gauge readings
  - SEPA/EA rainfall gauge data

Task type: RISK_SCORING
  Features use concurrent observations (lead_hours=0).
  Model scores weather conditions likely to cause infrastructure failure.

Label provenance: engineering_standard
  Positive = SSEN infrastructure failure weather conditions:
    - Wind gusts > 90 km/h, OR
    - Icing conditions (temp < -2°C AND humidity > 90%), OR
    - Flood-related disruption (river level > 95th pct AND rainfall_24h > 40mm)
  Negative = conditions outside these thresholds

Usage:
    python -m app.training.train_power_outage_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)

class PowerOutageRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="power_outage",
        task_type="risk_scoring",
        lead_hours=0,
        label_provenance={
            "category": "engineering_standard",
            "source": "SSEN resilience thresholds + Transport Scotland winter standards",
            "description": (
                "Labels derived from engineering failure-condition thresholds. "
                "Positive = wind gusts > 90 km/h (overhead line damage), OR "
                "icing conditions (temp < -2°C AND humidity > 90%), OR "
                "flood-related disruption (river level > 95th percentile AND "
                "rainfall_24h > 40mm). Negative = conditions outside all thresholds."
            ),
            "limitations": (
                "Not actual outage incident records. Engineering-threshold derived — "
                "represent likely-failure weather conditions. Real outages depend on "
                "local network topology, vegetation proximity, and maintenance state "
                "which are not captured."
            ),
            "peer_reviewed_basis": "SSEN network resilience reports, Transport Scotland winter operations standards",
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=5,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather, river level, and rainfall data."""
        stations_df = await self.provider.get_station_metadata()
        station_ids = stations_df["station_id"].tolist()[:50]

        weather = await self.provider.get_historical_weather(
            lat=56.0, lon=-3.5,  # Central Scotland
            start_date=self.start_date, end_date=self.end_date,
        )
        river = await self.provider.get_river_levels(
            station_ids=station_ids,
            start_date=self.start_date, end_date=self.end_date,
        )
        rainfall = await self.provider.get_rainfall(
            station_ids=station_ids,
            start_date=self.start_date, end_date=self.end_date,
        )

        return {
            "weather": weather,
            "river": river,
            "rainfall": rainfall,
            "stations": stations_df,
        }

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build power outage risk labels from engineering thresholds."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())
        rainfall = raw_data.get("rainfall", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build power outage labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["timestamp"] = weather["timestamp"].dt.floor("h")

        # Condition 1: Severe wind gusts > 90 km/h
        gust_col = None
        for col in ["wind_gusts_10m", "windgusts_10m_max", "wind_gusts"]:
            if col in weather.columns:
                gust_col = col
                break
        wind_label = pd.Series(False, index=weather.index)
        if gust_col:
            wind_label = weather[gust_col] > 90.0

        # Condition 2: Icing (temp < -2°C AND humidity > 90%)
        temp_col = None
        for col in ["temperature_2m", "temperature_2m_mean", "temperature"]:
            if col in weather.columns:
                temp_col = col
                break
        hum_col = None
        for col in ["relative_humidity_2m", "humidity", "relativehumidity_2m"]:
            if col in weather.columns:
                hum_col = col
                break
        icing_label = pd.Series(False, index=weather.index)
        if temp_col and hum_col:
            icing_label = (weather[temp_col] < -2.0) & (weather[hum_col] > 90.0)

        # Condition 3: Flood-related disruption
        # River level > 95th percentile AND rainfall_24h > 40mm
        flood_disruption = pd.Series(False, index=weather.index)
        if not river.empty and not rainfall.empty:
            river_c = river.copy()
            river_c["timestamp"] = pd.to_datetime(river_c["timestamp"]).dt.floor("h")

            # Compute per-station 95th percentile
            station_p95 = river_c.groupby("station_id")["level_m"].quantile(0.95)
            river_c = river_c.merge(station_p95.rename("p95"), on="station_id")
            river_c["above_p95"] = river_c["level_m"] > river_c["p95"]
            high_river_times = set(
                river_c.loc[river_c["above_p95"], "timestamp"].dt.strftime("%Y-%m-%d %H")
            )

            # Compute 24h rainfall
            rainfall_c = rainfall.copy()
            rainfall_c["timestamp"] = pd.to_datetime(rainfall_c["timestamp"]).dt.floor("h")
            if "value" in rainfall_c.columns:
                rain_hourly = rainfall_c.groupby("timestamp")["value"].sum().reset_index()
                rain_hourly["rainfall_24h_sum"] = (
                    rain_hourly["value"].rolling(24, min_periods=1).sum()
                )
                heavy_rain_times = set(
                    rain_hourly.loc[
                        rain_hourly["rainfall_24h_sum"] > 40.0, "timestamp"
                    ].dt.strftime("%Y-%m-%d %H")
                )
                weather_times = weather["timestamp"].dt.strftime("%Y-%m-%d %H")
                flood_disruption = (
                    weather_times.isin(high_river_times) & weather_times.isin(heavy_rain_times)
                )

        # Combine all conditions
        combined_label = (wind_label | icing_label | flood_disruption).astype(int)

        # Build output
        if "station_id" not in weather.columns:
            weather["station_id"] = "weather_grid"

        labels_df = weather[["timestamp", "station_id"]].copy()
        labels_df["label"] = combined_label.values

        # Deduplicate
        labels_df = labels_df.groupby(["timestamp", "station_id"])["label"].max().reset_index()

        n_pos = int(labels_df["label"].sum())
        n_neg = len(labels_df) - n_pos
        logger.info(f"  Power outage labels: {n_pos} positive, {n_neg} negative")
        logger.info(
            f"  Breakdown — wind: {int(wind_label.sum())}, "
            f"icing: {int(icing_label.sum())}, "
            f"flood-disruption: {int(flood_disruption.sum())}"
        )
        return labels_df

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for power outage risk scoring."""
        return [
            # Wind features
            "wind_speed_10m", "wind_gusts_10m",
            # Temperature / icing features
            "temperature_2m", "relative_humidity_2m",
            "pressure_msl", "pressure_change_3h", "pressure_change_6h",
            # Freeze-thaw proxy
            "freeze_thaw_cycles",
            # Rainfall features
            "rainfall_24h", "rainfall_48h",
            # River features
            "level_current", "level_percentile", "level_anomaly",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("power_outage")
    result = run_pipeline(PowerOutageRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Power outage training complete: {result['version']}")
    else:
        logger.error(f"Power outage training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
