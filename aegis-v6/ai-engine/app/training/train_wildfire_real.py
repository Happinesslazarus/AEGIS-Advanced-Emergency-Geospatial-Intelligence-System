"""
AEGIS AI Engine — Wildfire Real-Data Training

Train wildfire risk scoring model using REAL data:
  - Open-Meteo historical weather observations (temperature, humidity, wind, precipitation)
  - Canadian Fire Weather Index (FWI) system computed from observations

Task type: RISK_SCORING
  No lead time — assesses current fire danger conditions from today's weather.
  Lead time: 0 hours.

Label provenance: operational_threshold
  Positive = FWI > 30 (very high fire danger) AND days since measurable rain > 7.
  Negative = FWI <= 30 or recent rainfall within 7 days.

IMPORTANT — label honesty:
  Labels are computed from the Canadian FWI system applied to observed weather
  data, combined with a dry-spell requirement.  These represent fire DANGER
  conditions, NOT confirmed wildfire incidents.  Fire event frequency in
  Scotland is very low — expect highly imbalanced labels.

Usage:
    python -m app.training.train_wildfire_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.feature_engineering import FeatureEngineer

class WildfireRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="wildfire",
        task_type="risk_scoring",
        lead_hours=0,
        label_provenance={
            "category": "operational_threshold",
            "source": "Canadian FWI system applied to observed weather data (Open-Meteo reanalysis)",
            "description": (
                "Labels derived from the Canadian Fire Weather Index system "
                "applied to real weather observations. Positive = FWI > 30 "
                "(very high fire danger) AND days since measurable rain > 7. "
                "Negative = FWI <= 30 or recent rainfall within 7 days."
            ),
            "limitations": (
                "Low fire event frequency in Scotland. Labels are fire danger "
                "conditions, not confirmed fire incidents. The FWI system was "
                "developed for Canadian boreal forests and may not perfectly "
                "represent UK moorland/heathland fire risk."
            ),
            "peer_reviewed_basis": "Van Wagner (1987) Canadian Forest Fire Weather Index System; widely used by EFFIS and UK fire services",
        },
        min_total_samples=500,
        min_positive_samples=10,  # Very rare in Scotland
        min_stations=1,
        promotion_min_roc_auc=0.65,  # Lower bar — fire events are extremely rare
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch wildfire-relevant raw data from provider."""
        weather = await self.provider.get_historical_weather(
            lat=56.0, lon=-3.5,  # Central Scotland
            start_date=self.start_date, end_date=self.end_date,
        )

        return {
            "weather": weather,
        }

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Custom feature engineering — includes FWI components.

        Overrides base to add Canadian Fire Weather Index sub-indices
        via FeatureEngineer.compute_fwi().
        """
        # Start with standard weather features from base class
        features_df = super().build_features(raw_data)

        # Add FWI components if the method is available
        weather = raw_data.get("weather", pd.DataFrame())
        if not weather.empty and hasattr(FeatureEngineer, "compute_fwi"):
            try:
                fwi_df = FeatureEngineer.compute_fwi(weather)
                if fwi_df is not None and not fwi_df.empty:
                    features_df = features_df.join(fwi_df, how="left", rsuffix="_fwi_dup")
                    dup_cols = [c for c in features_df.columns if c.endswith("_fwi_dup")]
                    features_df.drop(columns=dup_cols, inplace=True)
                    features_df = features_df.ffill().fillna(0.0)
                    logger.info(f"  Added FWI components: {list(fwi_df.columns)}")
            except Exception as e:
                logger.warning(f"  FWI computation failed (will use weather features only): {e}")

        return features_df

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build wildfire risk labels from FWI and dry-spell criteria.

        Criteria: FWI > 30 AND days_since_rain > 7.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build wildfire labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["date"] = weather["timestamp"].dt.date

        # Resolve column names
        temp_col = next((c for c in ["temperature_2m", "temperature"] if c in weather.columns), None)
        humidity_col = next((c for c in ["relative_humidity_2m", "humidity", "relativehumidity_2m"] if c in weather.columns), None)
        wind_col = next((c for c in ["wind_speed_10m", "windspeed_10m"] if c in weather.columns), None)
        precip_col = next((c for c in ["precipitation", "rain", "rainfall"] if c in weather.columns), None)

        # Compute daily aggregates
        agg_dict = {}
        if temp_col:
            agg_dict["temp_noon"] = (temp_col, "max")  # Approximate noon temp
        if humidity_col:
            agg_dict["rh_noon"] = (humidity_col, lambda x: x.iloc[len(x)//2] if len(x) > 0 else 50.0)
        if wind_col:
            agg_dict["wind_noon"] = (wind_col, "mean")
        if precip_col:
            agg_dict["rain_24h"] = (precip_col, "sum")

        if not agg_dict:
            raise RuntimeError("Weather data missing required columns for FWI computation")

        daily = weather.groupby("date").agg(**agg_dict).reset_index()

        # Fill defaults for missing columns
        if "temp_noon" not in daily.columns:
            daily["temp_noon"] = 15.0
        if "rh_noon" not in daily.columns:
            daily["rh_noon"] = 50.0
        if "wind_noon" not in daily.columns:
            daily["wind_noon"] = 10.0
        if "rain_24h" not in daily.columns:
            daily["rain_24h"] = 0.0

        # Simplified FWI calculation
        # Full FWI has 6 sub-indices; we compute a simplified version here
        # for labelling.  The feature engineering pipeline adds proper FWI.
        daily = daily.sort_values("date")
        n = len(daily)

        # Fine Fuel Moisture Code (simplified)
        ffmc = np.full(n, 85.0)
        dmc = np.full(n, 6.0)
        dc = np.full(n, 15.0)

        for i in range(1, n):
            t = max(daily["temp_noon"].iloc[i], -1.1)
            rh = daily["rh_noon"].iloc[i]
            w = daily["wind_noon"].iloc[i]
            ro = daily["rain_24h"].iloc[i]

            # FFMC update (simplified Van Wagner)
            mo = 147.2 * (101.0 - ffmc[i-1]) / (59.5 + ffmc[i-1])
            if ro > 0.5:
                rf = ro - 0.5
                mo = mo + 42.5 * rf * np.exp(-100.0 / (251.0 - mo)) * (1.0 - np.exp(-6.93 / rf))
                mo = min(mo, 250.0)
            ed = 0.942 * (rh ** 0.679) + 11.0 * np.exp((rh - 100.0) / 10.0)
            if mo > ed:
                ko = 0.424 * (1.0 - (rh / 100.0) ** 1.7) + 0.0694 * (w ** 0.5) * (1.0 - (rh / 100.0) ** 8)
                ko = ko * 0.581 * np.exp(0.0365 * t)
                mo_new = ed + (mo - ed) * (10.0 ** (-ko))
            else:
                mo_new = mo
            ffmc[i] = 59.5 * (250.0 - mo_new) / (147.2 + mo_new)
            ffmc[i] = np.clip(ffmc[i], 0, 101)

            # DMC update (simplified)
            if t > -1.1:
                rk = 1.894 * (t + 1.1) * (100.0 - rh) * 0.0001
            else:
                rk = 0
            if ro > 1.5:
                dmc[i] = max(dmc[i-1] - (ro - 1.5) * 0.5, 0)
            else:
                dmc[i] = dmc[i-1] + rk

            # DC update (simplified)
            if t > -2.8:
                dc[i] = dc[i-1] + 0.36 * (t + 2.8)
            else:
                dc[i] = dc[i-1]
            if ro > 2.8:
                dc[i] = max(dc[i] - (ro - 2.8) * 0.5, 0)

        # ISI (Initial Spread Index)
        fw = np.exp(0.05039 * daily["wind_noon"].values)
        fm = 147.2 * (101.0 - ffmc) / (59.5 + ffmc)
        sf = 91.9 * np.exp(-0.1386 * fm) * (1.0 + (fm ** 5.31) / (4.93e7))
        isi = 0.208 * fw * sf

        # BUI (Buildup Index)
        bui = np.where(
            dmc <= 0.4 * dc,
            0.8 * dmc * dc / (dmc + 0.4 * dc + 1e-6),
            dmc - (1.0 - 0.8 * dc / (dmc + 0.4 * dc + 1e-6)) * (0.92 + (0.0114 * dmc) ** 1.7),
        )
        bui = np.clip(bui, 0, 300)

        # FWI
        fd = np.where(bui <= 80, 0.626 * (bui ** 0.809) + 2.0, 1000.0 / (25.0 + 108.64 * np.exp(-0.023 * bui)))
        fwi_raw = isi * fd / 10.0
        daily["fwi"] = np.clip(fwi_raw, 0, 150)

        # Days since rain
        days_since_rain = np.zeros(n, dtype=int)
        running = 0
        for i in range(n):
            if daily["rain_24h"].iloc[i] > 1.0:  # Measurable rain > 1mm
                running = 0
            else:
                running += 1
            days_since_rain[i] = running
        daily["days_since_rain"] = days_since_rain

        # Label: FWI > 30 AND days_since_rain > 7
        daily["label"] = ((daily["fwi"] > 30.0) & (daily["days_since_rain"] > 7)).astype(int)

        # Map back to hourly timestamps
        weather_hourly = weather[["timestamp"]].copy()
        weather_hourly["timestamp"] = weather_hourly["timestamp"].dt.floor("h")
        weather_hourly = weather_hourly.drop_duplicates()
        weather_hourly["date"] = weather_hourly["timestamp"].dt.date
        weather_hourly["station_id"] = "grid_56.0_-3.5"

        labels = weather_hourly.merge(
            daily[["date", "label"]],
            on="date",
            how="left",
        )
        labels["label"] = labels["label"].fillna(0).astype(int)
        labels = labels[["timestamp", "station_id", "label"]]

        n_pos = labels["label"].sum()
        n_neg = len(labels) - n_pos
        logger.info(f"  Wildfire risk labels: {n_pos} positive, {n_neg} negative")
        return labels

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for wildfire risk scoring."""
        return [
            # FWI sub-indices (from FeatureEngineer.compute_fwi or build_features)
            "ffmc", "dmc", "dc", "isi", "bui", "fwi",
            # Weather features
            "temperature_2m", "wind_speed_10m", "pressure_msl",
            # Derived
            "pressure_change_3h", "pressure_change_6h",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("wildfire")
    result = run_pipeline(WildfireRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Wildfire training complete: {result['version']}")
    else:
        logger.error(f"Wildfire training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
