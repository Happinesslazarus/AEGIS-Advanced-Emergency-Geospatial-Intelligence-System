"""
AEGIS AI Engine — Flood Real-Data Training

Train flood prediction model using REAL data:
  - SEPA/EA recorded flood events (ground truth)
  - SEPA/EA river level gauge readings
  - SEPA/EA rainfall gauge data
  - Open-Meteo historical weather observations

Task type: FORECAST
  Features use only pre-event observations.
  Lead time: 6 hours before flood onset.

Label provenance: recorded_events
  Positive = actual flood event recorded at date/location
  Negative = same station/catchment, same season, no recorded flood

Usage:
    python -m app.training.train_flood_real --region uk-default --start-date 2010-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.feature_engineering import LeakagePrevention

class FloodRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="flood",
        task_type="forecast",
        lead_hours=6,
        label_provenance={
            "category": "recorded_events",
            "source": "SEPA Flood Data Archive (https://www2.sepa.org.uk/FloodData/) + EA Recorded Flood Outlines (https://environment.data.gov.uk/dataset/recorded-flood-outlines)",
            "description": "Labels derived from actual recorded flood incidents at or near gauging stations. Positive = flood event recorded within 10km of station during the timestamp window. Negative = same station, similar season, no recorded flood.",
            "limitations": "Minor/unreported floods may be underrepresented. Spatial matching (10km) may miss localised flash floods or include broad-area events that didn't affect the matched station.",
            "peer_reviewed_basis": "SEPA and EA official flood data publications",
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=5,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch flood-relevant raw data from provider."""
        stations_df = await self.provider.get_station_metadata()
        station_ids = stations_df["station_id"].tolist()[:50]  # Cap for API limits

        # Fetch in parallel where possible
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
        flood_events = await self.provider.get_flood_events(
            start_date=self.start_date, end_date=self.end_date,
        )

        return {
            "weather": weather,
            "river": river,
            "rainfall": rainfall,
            "flood_events": flood_events,
            "stations": stations_df,
        }

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build flood labels from recorded flood events."""
        flood_events = raw_data.get("flood_events", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())
        stations = raw_data.get("stations", pd.DataFrame())

        if river.empty:
            raise RuntimeError("No river level data — cannot build flood labels")

        # Get all unique hourly timestamps from river data
        river = river.copy()
        river["timestamp"] = pd.to_datetime(river["timestamp"])
        river["timestamp"] = river["timestamp"].dt.floor("h")

        all_records = river[["timestamp", "station_id"]].drop_duplicates()

        # Default: all negative
        all_records["label"] = 0

        if not flood_events.empty and not stations.empty:
            # Match flood events to stations by proximity
            flood_events = flood_events.copy()
            for col in ["start_date", "end_date"]:
                if col in flood_events.columns:
                    flood_events[col] = pd.to_datetime(flood_events[col])

            stations_with_coords = stations[
                stations["latitude"].notna() & stations["longitude"].notna()
            ]

            for _, event in flood_events.iterrows():
                if pd.isna(event.get("latitude")) or pd.isna(event.get("longitude")):
                    continue

                event_start = event.get("start_date", event.get("date"))
                event_end = event.get("end_date", event_start)
                if pd.isna(event_start):
                    continue

                # Find stations within ~10km
                dlat = abs(stations_with_coords["latitude"] - event["latitude"])
                dlon = abs(stations_with_coords["longitude"] - event["longitude"])
                nearby = stations_with_coords[
                    (dlat < 0.1) & (dlon < 0.15)  # ~10km
                ]["station_id"].tolist()

                if not nearby:
                    continue

                # Mark positive for the event window
                mask = (
                    all_records["station_id"].isin(nearby)
                    & (all_records["timestamp"] >= event_start)
                    & (all_records["timestamp"] <= event_end + pd.Timedelta(hours=24))
                )
                all_records.loc[mask, "label"] = 1

        # If no flood events data available, fall back to river level threshold
        if all_records["label"].sum() == 0:
            logger.warning(
                "No flood events matched to stations. "
                "Falling back to river level threshold labels (95th percentile exceedance)."
            )
            # Compute per-station 95th percentile
            station_p95 = river.groupby("station_id")["level_m"].quantile(0.95)
            river_merged = river.merge(
                station_p95.rename("p95"), on="station_id"
            )
            threshold_labels = (river_merged["level_m"] > river_merged["p95"]).astype(int)
            threshold_df = river[["timestamp", "station_id"]].copy()
            threshold_df["label"] = threshold_labels.values
            threshold_df = threshold_df.groupby(
                ["timestamp", "station_id"]
            )["label"].max().reset_index()

            all_records = threshold_df

            # Update label provenance to reflect threshold fallback
            self.HAZARD_CONFIG.label_provenance["category"] = "operational_threshold"
            self.HAZARD_CONFIG.label_provenance["description"] = (
                "FALLBACK: No recorded flood events matched gauge stations. "
                "Labels derived from river level exceeding station-specific 95th percentile. "
                "This is a hydrological high-flow indicator, not a confirmed flood record."
            )
            self.HAZARD_CONFIG.label_provenance["limitations"] = (
                "Threshold-derived labels — not actual flood events. "
                "High river levels don't always cause flooding, and some floods occur "
                "at levels below the 95th percentile."
            )

        logger.info(
            f"  Flood labels: {all_records['label'].sum()} positive, "
            f"{(1 - all_records['label']).sum()} negative"
        )
        return all_records

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for flood prediction."""
        return [
            # River features
            "level_current", "level_max_6h", "level_max_12h", "level_max_24h",
            "level_max_48h", "level_min_24h", "rate_of_rise_6h",
            "level_percentile", "level_anomaly", "is_above_typical_range",
            "flow_current", "flow_max_24h",
            # Rainfall features
            "rainfall_1h", "rainfall_3h", "rainfall_6h", "rainfall_12h",
            "rainfall_24h", "rainfall_48h", "rainfall_72h", "rainfall_7d",
            "antecedent_rainfall_7d", "antecedent_rainfall_14d", "antecedent_rainfall_30d",
            "days_since_significant_rain", "rainfall_intensity_max_1h",
            # Weather features
            "temperature_2m", "pressure_msl", "wind_speed_10m",
            "pressure_change_3h", "pressure_change_6h",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("flood")
    result = run_pipeline(FloodRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Flood training complete: {result['version']}")
    else:
        logger.error(f"Flood training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
