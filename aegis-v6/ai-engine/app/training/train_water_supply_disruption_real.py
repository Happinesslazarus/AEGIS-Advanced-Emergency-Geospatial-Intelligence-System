"""
AEGIS AI Engine — Water Supply Disruption Real-Data Training

Train water supply disruption risk model using REAL data:
  - Open-Meteo historical weather observations
  - SEPA/EA river level gauge readings (flow proxy)
  - SEPA/EA rainfall gauge data

Task type: RISK_SCORING
  Features use concurrent observations (lead_hours=0).
  Model scores conditions likely to cause water supply disruption.

Label provenance: operational_threshold
  Positive = combined operational thresholds:
    - Severe low flow: Q95 exceedance > 14 days (drought stress on supply), OR
    - Freeze risk: temp < -5°C for 6+ consecutive hours (pipe burst risk), OR
    - Contamination risk: river flood + heavy rainfall (turbidity/overtopping)
  Negative = conditions outside all thresholds

Usage:
    python -m app.training.train_water_supply_disruption_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)

class WaterSupplyDisruptionRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="water_supply_disruption",
        task_type="risk_scoring",
        lead_hours=0,
        label_provenance={
            "category": "operational_threshold",
            "source": "Scottish Water operational resilience criteria",
            "description": (
                "Labels derived from combined operational thresholds. "
                "Positive = severe low flow (Q95 exceedance > 14 consecutive days), OR "
                "freeze risk (temp < -5°C for 6+ consecutive hours), OR "
                "contamination risk (river level > 90th percentile AND heavy rainfall "
                "> 30mm/24h — turbidity/overtopping risk). "
                "Negative = conditions outside all thresholds."
            ),
            "limitations": (
                "Mixed operational threshold label source. Not actual disruption "
                "incident records. Real disruptions depend on treatment capacity, "
                "pipe age/material, reservoir levels, and demand patterns which are "
                "not captured. Low-flow Q95 calculation uses river level as proxy for "
                "flow where direct flow measurements are unavailable."
            ),
            "peer_reviewed_basis": "Scottish Water resilience plans, UKWIR drought planning guidance",
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
        """Build water supply disruption labels from operational thresholds."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())
        rainfall = raw_data.get("rainfall", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build water supply labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["timestamp"] = weather["timestamp"].dt.floor("h")

        # Condition 1: Severe low flow (Q95 exceedance > 14 days)
        low_flow_times: set[str] = set()
        if not river.empty:
            river_c = river.copy()
            river_c["timestamp"] = pd.to_datetime(river_c["timestamp"]).dt.floor("h")

            # Q95 = 5th percentile of levels (low flow threshold)
            station_q95 = river_c.groupby("station_id")["level_m"].quantile(0.05)
            river_c = river_c.merge(station_q95.rename("q95"), on="station_id")
            river_c["below_q95"] = river_c["level_m"] <= river_c["q95"]

            # Check for 14+ consecutive days below Q95 per station
            for station_id, group in river_c.groupby("station_id"):
                group = group.sort_values("timestamp")
                group["date"] = group["timestamp"].dt.date
                daily = group.groupby("date")["below_q95"].mean()
                # Day counts as low-flow if majority of readings below Q95
                daily_low = (daily > 0.5).astype(int)
                # Find runs of consecutive low-flow days
                runs = daily_low.groupby(
                    (daily_low != daily_low.shift()).cumsum()
                )
                for _, run in runs:
                    if run.sum() >= 14 and run.iloc[0] == 1:
                        for d in run.index:
                            low_flow_times.add(str(d))

        # Condition 2: Freeze risk (temp < -5°C for 6+ hours)
        temp_col = None
        for col in ["temperature_2m", "temperature_2m_mean", "temperature"]:
            if col in weather.columns:
                temp_col = col
                break

        freeze_label = pd.Series(False, index=weather.index)
        if temp_col:
            severe_cold = (weather[temp_col] < -5.0).astype(int)
            # Rolling 6-hour window: if all 6 hours are below -5°C
            cold_streak = severe_cold.rolling(6, min_periods=6).sum()
            freeze_label = cold_streak >= 6

        # Condition 3: Contamination risk (flood + heavy rain)
        contamination_label = pd.Series(False, index=weather.index)
        if not river.empty and not rainfall.empty:
            river_c2 = river.copy()
            river_c2["timestamp"] = pd.to_datetime(river_c2["timestamp"]).dt.floor("h")
            station_p90 = river_c2.groupby("station_id")["level_m"].quantile(0.90)
            river_c2 = river_c2.merge(station_p90.rename("p90"), on="station_id")
            river_c2["above_p90"] = river_c2["level_m"] > river_c2["p90"]
            high_river_times = set(
                river_c2.loc[river_c2["above_p90"], "timestamp"].dt.strftime("%Y-%m-%d %H")
            )

            rainfall_c = rainfall.copy()
            rainfall_c["timestamp"] = pd.to_datetime(rainfall_c["timestamp"]).dt.floor("h")
            if "value" in rainfall_c.columns:
                rain_hourly = rainfall_c.groupby("timestamp")["value"].sum().reset_index()
                rain_hourly["rainfall_24h_sum"] = (
                    rain_hourly["value"].rolling(24, min_periods=1).sum()
                )
                heavy_rain_times = set(
                    rain_hourly.loc[
                        rain_hourly["rainfall_24h_sum"] > 30.0, "timestamp"
                    ].dt.strftime("%Y-%m-%d %H")
                )
                weather_times = weather["timestamp"].dt.strftime("%Y-%m-%d %H")
                contamination_label = (
                    weather_times.isin(high_river_times) & weather_times.isin(heavy_rain_times)
                )

        # Combine: low flow OR freeze OR contamination
        weather_dates = weather["timestamp"].dt.strftime("%Y-%m-%d")
        low_flow_label = weather_dates.isin(low_flow_times)

        combined_label = (low_flow_label | freeze_label | contamination_label).astype(int)

        if "station_id" not in weather.columns:
            weather["station_id"] = "weather_grid"

        labels_df = weather[["timestamp", "station_id"]].copy()
        labels_df["label"] = combined_label.values
        labels_df = labels_df.groupby(["timestamp", "station_id"])["label"].max().reset_index()

        n_pos = int(labels_df["label"].sum())
        n_neg = len(labels_df) - n_pos
        logger.info(f"  Water supply labels: {n_pos} positive, {n_neg} negative")
        logger.info(
            f"  Breakdown — low-flow: {int(low_flow_label.sum())}, "
            f"freeze: {int(freeze_label.sum())}, "
            f"contamination: {int(contamination_label.sum())}"
        )
        return labels_df

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for water supply disruption risk scoring."""
        return [
            # Flow / river features (proxy for supply source)
            "level_current", "level_percentile", "level_anomaly",
            "level_min_24h", "flow_current",
            # Temperature / freeze features
            "temperature_2m", "pressure_msl",
            # Frost / cold proxy
            "freeze_thaw_cycles",
            # Rainfall deficit / surplus features
            "rainfall_24h", "rainfall_48h", "rainfall_7d",
            "antecedent_rainfall_7d", "antecedent_rainfall_14d", "antecedent_rainfall_30d",
            "days_since_significant_rain",
            # Soil moisture proxy (antecedent conditions)
            "rainfall_intensity_max_1h",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("water_supply_disruption")
    result = run_pipeline(WaterSupplyDisruptionRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Water supply disruption training complete: {result['version']}")
    else:
        logger.error(f"Water supply disruption training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
