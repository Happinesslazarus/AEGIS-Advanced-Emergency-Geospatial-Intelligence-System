"""
AEGIS AI Engine — Environmental Hazard (Air Quality) Real-Data Training

Train environmental hazard model using REAL data:
  - OpenAQ / DEFRA UK-AIR air quality measurements
  - Open-Meteo historical weather observations (dispersion factors)

Task type: NOWCAST
  Features use concurrent observations (lead_hours=0).
  Model detects current air quality exceedance conditions.

Label provenance: recorded_events
  Positive = real air quality exceedance:
    - AQI > DEFRA "High" threshold (band 7+), OR
    - PM2.5 > 35 µg/m³, OR
    - PM10 > 50 µg/m³, OR
    - NO2 > 200 µg/m³
  Labels from actual monitored exceedance records where available,
  DEFRA threshold applied to raw observations otherwise.

Usage:
    python -m app.training.train_environmental_hazard_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)

class EnvironmentalHazardRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="environmental_hazard",
        task_type="nowcast",
        lead_hours=0,
        label_provenance={
            "category": "recorded_events",
            "source": "OpenAQ measurements / DEFRA UK-AIR (https://uk-air.defra.gov.uk/), DEFRA air quality bands",
            "description": (
                "Labels derived from real air quality exceedance records. "
                "Positive = AQI > DEFRA 'High' band (7+), OR PM2.5 > 35 µg/m³, OR "
                "PM10 > 50 µg/m³, OR NO2 > 200 µg/m³. Where direct AQI band data is "
                "available, recorded exceedance is used. Otherwise, DEFRA thresholds "
                "are applied to raw pollutant concentration observations."
            ),
            "limitations": (
                "Air quality monitoring coverage is sparse in rural Scotland. "
                "Urban bias in observations. Labels from actual exceedance records "
                "where available, DEFRA threshold applied to observations otherwise. "
                "Spatial interpolation of point measurements may not represent local "
                "hotspots (e.g. road canyons, industrial sources)."
            ),
            "peer_reviewed_basis": "DEFRA UK Air Quality Index bands, WHO Air Quality Guidelines 2021",
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=5,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch air quality and weather data."""
        stations_df = await self.provider.get_station_metadata()

        weather = await self.provider.get_historical_weather(
            lat=56.0, lon=-3.5,  # Central Scotland
            start_date=self.start_date, end_date=self.end_date,
        )

        # Fetch air quality data — provider may support this directly
        air_quality = pd.DataFrame()
        try:
            air_quality = await self.provider.get_air_quality(
                start_date=self.start_date, end_date=self.end_date,
            )
        except (AttributeError, NotImplementedError):
            logger.warning(
                "Provider does not support get_air_quality(). "
                "Attempting Open-Meteo air quality API fallback."
            )
            try:
                air_quality = await self.provider.get_historical_air_quality(
                    lat=56.0, lon=-3.5,
                    start_date=self.start_date, end_date=self.end_date,
                )
            except Exception as e:
                logger.warning(f"Air quality fallback also failed: {e}")

        return {
            "weather": weather,
            "air_quality": air_quality,
            "stations": stations_df,
        }

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Custom feature engineering including air quality features."""
        frames = []

        # Weather features (dispersion factors)
        if "weather" in raw_data and not raw_data["weather"].empty:
            wf = self.feature_engineer.compute_weather_features(raw_data["weather"])
            tf = self.feature_engineer.compute_temporal_features(
                raw_data["weather"]["timestamp"]
            )
            wf = pd.concat([wf, tf], axis=1)
            frames.append(wf)

        # Air quality features — pass through as-is if columns exist
        if "air_quality" in raw_data and not raw_data["air_quality"].empty:
            aq = raw_data["air_quality"].copy()
            aq["timestamp"] = pd.to_datetime(aq["timestamp"])
            aq["timestamp"] = aq["timestamp"].dt.floor("h")

            # Standardise column names
            rename_map = {}
            for target, candidates in {
                "pm2_5": ["pm2_5", "pm25", "pm2.5", "pm2_5_ugm3"],
                "pm10": ["pm10", "pm10_ugm3"],
                "no2": ["no2", "no2_ugm3", "nitrogen_dioxide"],
                "o3": ["o3", "o3_ugm3", "ozone"],
                "aqi": ["aqi", "air_quality_index", "daqi"],
            }.items():
                for c in candidates:
                    if c in aq.columns and c != target:
                        rename_map[c] = target
                        break
            if rename_map:
                aq = aq.rename(columns=rename_map)

            if "station_id" in aq.columns:
                aq = aq.set_index(["timestamp", "station_id"])
            else:
                aq["station_id"] = "aq_grid"
                aq = aq.set_index(["timestamp", "station_id"])

            # Keep only numeric AQ columns
            aq_numeric = aq.select_dtypes(include=[np.number])
            frames.append(aq_numeric)

        if not frames:
            raise RuntimeError("No feature data available — cannot build features")

        combined = frames[0]
        for f in frames[1:]:
            combined = combined.join(f, how="outer", rsuffix="_dup")
            dup_cols = [c for c in combined.columns if c.endswith("_dup")]
            combined.drop(columns=dup_cols, inplace=True)

        combined = combined.ffill().fillna(0.0)
        return combined

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build environmental hazard labels from air quality exceedance."""
        air_quality = raw_data.get("air_quality", pd.DataFrame())
        weather = raw_data.get("weather", pd.DataFrame())

        # If we have air quality data, use it for labels
        if not air_quality.empty:
            aq = air_quality.copy()
            aq["timestamp"] = pd.to_datetime(aq["timestamp"])
            aq["timestamp"] = aq["timestamp"].dt.floor("h")

            # Standardise column names
            rename_map = {}
            for target, candidates in {
                "pm2_5": ["pm2_5", "pm25", "pm2.5", "pm2_5_ugm3"],
                "pm10": ["pm10", "pm10_ugm3"],
                "no2": ["no2", "no2_ugm3", "nitrogen_dioxide"],
                "aqi": ["aqi", "air_quality_index", "daqi"],
            }.items():
                for c in candidates:
                    if c in aq.columns and c != target:
                        rename_map[c] = target
                        break
            if rename_map:
                aq = aq.rename(columns=rename_map)

            # Apply DEFRA exceedance thresholds
            exceedance = pd.Series(False, index=aq.index)

            if "aqi" in aq.columns:
                exceedance = exceedance | (aq["aqi"] >= 7)
            if "pm2_5" in aq.columns:
                exceedance = exceedance | (aq["pm2_5"] > 35.0)
            if "pm10" in aq.columns:
                exceedance = exceedance | (aq["pm10"] > 50.0)
            if "no2" in aq.columns:
                exceedance = exceedance | (aq["no2"] > 200.0)

            if "station_id" not in aq.columns:
                aq["station_id"] = "aq_grid"

            labels_df = aq[["timestamp", "station_id"]].copy()
            labels_df["label"] = exceedance.astype(int).values
            labels_df = labels_df.groupby(
                ["timestamp", "station_id"]
            )["label"].max().reset_index()

        elif not weather.empty:
            # Fallback: no AQ data — use weather-based poor dispersion proxy
            logger.warning(
                "No air quality data available. "
                "Falling back to weather-based poor-dispersion-day labels."
            )
            weather = weather.copy()
            weather["timestamp"] = pd.to_datetime(weather["timestamp"])
            weather["timestamp"] = weather["timestamp"].dt.floor("h")

            # Poor dispersion: low wind + temperature inversion proxy + no rain
            wind_col = None
            for col in ["wind_speed_10m", "windspeed_10m", "wind_speed"]:
                if col in weather.columns:
                    wind_col = col
                    break
            precip_col = None
            for col in ["precipitation", "precipitation_sum", "rain"]:
                if col in weather.columns:
                    precip_col = col
                    break

            poor_dispersion = pd.Series(False, index=weather.index)
            if wind_col:
                low_wind = weather[wind_col] < 2.0
                no_rain = pd.Series(True, index=weather.index)
                if precip_col:
                    no_rain = weather[precip_col] < 0.1
                poor_dispersion = low_wind & no_rain

            if "station_id" not in weather.columns:
                weather["station_id"] = "weather_grid"

            labels_df = weather[["timestamp", "station_id"]].copy()
            labels_df["label"] = poor_dispersion.astype(int).values
            labels_df = labels_df.groupby(
                ["timestamp", "station_id"]
            )["label"].max().reset_index()

            # Update provenance to reflect fallback
            self.HAZARD_CONFIG.label_provenance["category"] = "operational_threshold"
            self.HAZARD_CONFIG.label_provenance["description"] = (
                "FALLBACK: No air quality monitoring data available. "
                "Labels derived from weather-based poor atmospheric dispersion "
                "conditions (low wind + dry — trapping pollutants). "
                "This is NOT an actual exceedance record."
            )
            self.HAZARD_CONFIG.label_provenance["limitations"] = (
                "Weather-proxy labels only. No actual pollutant measurements. "
                "Poor dispersion does not guarantee exceedance, and exceedance "
                "can occur during active weather from transported pollution."
            )
        else:
            raise RuntimeError(
                "No air quality or weather data — cannot build environmental hazard labels"
            )

        n_pos = int(labels_df["label"].sum())
        n_neg = len(labels_df) - n_pos
        logger.info(f"  Environmental hazard labels: {n_pos} positive, {n_neg} negative")
        return labels_df

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for environmental hazard nowcast."""
        return [
            # Air quality features
            "pm2_5", "pm10", "no2", "o3", "aqi",
            # Weather dispersion factors
            "temperature_2m", "relative_humidity_2m",
            "wind_speed_10m", "wind_gusts_10m",
            "pressure_msl", "pressure_change_3h", "pressure_change_6h",
            # Visibility (correlated with particulates)
            # (may not always be available — base pipeline handles missing cols)
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("environmental_hazard")
    result = run_pipeline(EnvironmentalHazardRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Environmental hazard training complete: {result['version']}")
    else:
        logger.error(f"Environmental hazard training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
