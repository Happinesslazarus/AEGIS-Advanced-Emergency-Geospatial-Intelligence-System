"""
File: train_environmental_hazard_real.py

What this file does:
Trains the environmental hazard risk-prediction model using real-world historical
data from Open-Meteo. Subclasses BaseRealPipeline to handle data
fetching, feature engineering, cross-validated training, evaluation,
and model registration. Run directly or via train_all.py.

How it connects:
- Extends ai-engine/app/training/base_real_pipeline.py
- Fetches data via ai-engine/app/training/data_fetch_open_meteo.py
- Saves to model_registry/environmental_hazard/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/environmental_hazard.py
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)

class EnvironmentalHazardRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="environmental_hazard",
        task_type="forecast",
        lead_hours=6,           # Features at T predict exceedance at T+6h
        region_scope="MULTI-REGION",
        label_source=(
            "OpenAQ v3 API — real hourly pollutant measurements (PM2.5, PM10, NO2, O3) "
            "at 13 UK DEFRA AURN monitoring stations, 2015–2025. "
            "Positive label = DEFRA High-band exceedance: PM2.5 > 35.4 µg/m³ OR "
            "PM10 > 50.4 µg/m³ OR NO2 > 200 µg/m³ OR O3 > 100 µg/m³. "
            "Only measurements with OpenAQ qa_value >= 0.75 included. "
            "ENTIRELY INDEPENDENT of ERA5 weather features. "
            "Ref: DEFRA LAQM.TG(16); WHO Global Air Quality Guidelines 2021."
        ),
        data_validity="independent",
        label_provenance={
            "category": "measured_instrument_record",
            "source": (
                "OpenAQ v3 public API (https://api.openaq.org/v3) — "
                "DEFRA Automatic Urban and Rural Network (AURN) stations. "
                "Instruments: electrochemical NO2/O3, tapered element oscillating "
                "microbalance (TEOM) PM10, filter dynamics measurement system (FDMS) PM2.5. "
                "QA: qa_value >= 0.75 filter applied."
            ),
            "description": (
                "Labels come from REAL MEASURED pollutant concentrations at 13 UK "
                "DEFRA AURN stations, NOT from weather thresholds. "
                "A station-hour is POSITIVE when any measured pollutant exceeds the "
                "DEFRA 'High' band: PM2.5 > 35.4 µg/m³, PM10 > 50.4 µg/m³, "
                "NO2 > 200 µg/m³, or O3 > 100 µg/m³. "
                "Features are ERA5 atmospheric dispersion conditions (wind, pressure, "
                "stability). Label and feature sources are fully independent — "
                "the model learns which weather patterns cause pollution to accumulate, "
                "not a tautological wind-speed threshold."
            ),
            "limitations": (
                "AURN stations are urban/suburban — rural and industrial hotspot "
                "exceedances not captured. Station density lowest in rural Scotland "
                "and Northern Ireland. OpenAQ aggregates multiple sub-hourly readings "
                "per hour; data gaps exist during sensor maintenance. "
                "Labels require API access; if API is unavailable, training uses "
                "cached data or falls back to weather-proxy labels (flagged as proxy)."
            ),
            "peer_reviewed_basis": (
                "DEFRA (2012) Local Air Quality Management Technical Guidance LAQM.TG(16). "
                "WHO (2021) Global Air Quality Guidelines. "
                "OpenAQ: Feenstra et al. (2019) OpenAQ, CC BY 4.0."
            ),
        },
        min_total_samples=500,
        min_positive_samples=50,
        min_stations=5,
        promotion_min_roc_auc=0.65,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather (features) and OpenAQ measurements (labels) independently."""
        from app.training.multi_location_weather import (
            fetch_multi_location_weather, GLOBAL_HEATWAVE_LOCATIONS, EXTENDED_HOURLY_VARS,
        )
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_HEATWAVE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Per-station feature engineering using multi-location weather."""
        from app.training.multi_location_weather import build_per_station_features
        weather = raw_data.get("weather", pd.DataFrame())
        return build_per_station_features(weather, self.feature_engineer)

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """
        Build labels from REAL measured air quality exceedances (OpenAQ/DEFRA).

        Label source: OpenAQ v3 API → DEFRA AURN UK monitoring stations.
        A station-hour is POSITIVE when any measured pollutant exceeds its
        DEFRA High-band threshold:
          PM2.5 > 35.4 µg/m³ OR PM10 > 50.4 µg/m³ OR NO2 > 200 µg/m³ OR O3 > 100 µg/m³

        These labels are FULLY INDEPENDENT of ERA5 weather features.
        The model learns which atmospheric patterns cause pollutants to accumulate,
        not a trivial weather threshold — this is scientifically defensible.

        Feature-label merge strategy:
          OpenAQ stations are UK-based. The feature grid (GLOBAL_HEATWAVE_LOCATIONS)
          covers 27 global locations. We assign each AQ station to its nearest
          weather station (haversine distance) and inherit that station_id, so the
          merge in base_real_pipeline succeeds without needing AQ-specific weather.

        Fallback:
          If the OpenAQ API is unreachable AND no cached data exists, falls back
          to the weather-proxy labels (wind < 2 m/s AND precip < 0.1 mm/h) with
          data_validity downgraded to "proxy" and a clear audit trail in metadata.
        """
        from app.training.data_fetch_openaq import (
            build_openaq_label_df, openaq_data_available,
        )
        from app.training.multi_location_weather import GLOBAL_HEATWAVE_LOCATIONS
        import math

        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build environmental hazard labels")

        # --- Attempt real OpenAQ labels ---
        aq_labels = build_openaq_label_df(
            start_date=self.start_date,
            end_date=self.end_date,
            cache=True,
        )

        if not aq_labels.empty and len(aq_labels) >= 1000:
            # Nearest-weather-station assignment so station_id matches features.
            # Each OpenAQ station_id like "aq_8110" gets mapped to the nearest
            # GLOBAL_HEATWAVE_LOCATIONS entry.
            weather_locs = {
                loc["station_id"]: (loc["lat"], loc["lon"])
                for loc in GLOBAL_HEATWAVE_LOCATIONS
            }

            def nearest_weather_station(aq_sid: str) -> str:
                """Map OpenAQ station ID to nearest weather grid station."""
                from app.training.data_fetch_openaq import UK_AQ_STATIONS
                loc_id = int(aq_sid.replace("aq_", ""))
                aq_info = next((s for s in UK_AQ_STATIONS if s[0] == loc_id), None)
                if aq_info is None:
                    return list(weather_locs.keys())[0]
                aq_lat, aq_lon = aq_info[2], aq_info[3]
                best_sid, best_dist = None, float("inf")
                for sid, (wlat, wlon) in weather_locs.items():
                    # Fast haversine approximation
                    dlat = math.radians(aq_lat - wlat)
                    dlon = math.radians(aq_lon - wlon)
                    a = math.sin(dlat/2)**2 + math.cos(math.radians(wlat))*math.cos(math.radians(aq_lat))*math.sin(dlon/2)**2
                    dist = 6371 * 2 * math.asin(math.sqrt(a))
                    if dist < best_dist:
                        best_dist = dist
                        best_sid = sid
                return best_sid

            aq_labels["station_id"] = aq_labels["station_id"].apply(nearest_weather_station)
            aq_labels = aq_labels.groupby(["timestamp", "station_id"])["label"].max().reset_index()

            n_pos = int(aq_labels["label"].sum())
            n_neg = len(aq_labels) - n_pos
            logger.info(
                f"  Environmental hazard labels (OpenAQ REAL): "
                f"{n_pos:,} positive ({n_pos/max(len(aq_labels),1)*100:.1f}%), "
                f"{n_neg:,} negative"
            )
            # Update provenance to confirm real data was used
            self.HAZARD_CONFIG.label_provenance["category"] = "measured_instrument_record"
            self.HAZARD_CONFIG.data_validity = "independent"
            return aq_labels

        # --- Fallback: weather-proxy labels (audit trail preserved) ---
        logger.warning(
            "  OpenAQ returned insufficient data — using weather-proxy fallback. "
            "Label source downgraded to 'proxy'. "
            "Ensure internet access and retry to use real AQ measurements."
        )
        self.HAZARD_CONFIG.label_provenance["category"] = "weather_proxy_fallback"
        self.HAZARD_CONFIG.label_provenance["description"] = (
            "FALLBACK: Labels derived from weather-based atmospheric dispersion proxy "
            "(wind < 2 m/s AND precip < 0.1 mm/h). Real OpenAQ data unavailable. "
            "This introduces feature-label correlation and should NOT be used for "
            "production or academic reporting without real AQ data."
        )
        self.HAZARD_CONFIG.data_validity = "proxy"

        df = weather.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"]).dt.floor("h")
        wind_col = next(
            (c for c in ["wind_speed_10m", "windspeed_10m", "wind_speed"] if c in df.columns), None,
        )
        precip_col = next(
            (c for c in ["precipitation", "precipitation_sum", "rain"] if c in df.columns), None,
        )
        poor_dispersion = pd.Series(False, index=df.index)
        if wind_col:
            low_wind = df[wind_col] < 2.0
            no_rain = df[precip_col] < 0.1 if precip_col else pd.Series(True, index=df.index)
            poor_dispersion = low_wind & no_rain
        if "station_id" not in df.columns:
            df["station_id"] = "weather_grid"
        labels_df = df[["timestamp", "station_id"]].copy()
        labels_df["label"] = poor_dispersion.astype(int).values
        labels_df = labels_df.groupby(["timestamp", "station_id"])["label"].max().reset_index()
        n_pos = int(labels_df["label"].sum())
        n_neg = len(labels_df) - n_pos
        logger.warning(f"  Proxy labels: {n_pos:,} positive, {n_neg:,} negative")
        return labels_df

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for environmental hazard 6h-ahead forecasting.

        Columns intentionally excluded and why:
          - aqi, pm2_5, pm10, no2: these ARE the variables used to define the
            label (AQI >= 7, PM2.5 > 35, PM10 > 50, NO2 > 200).  Including
            them means the model reads the label criterion directly from its
            input features — a direct tautology.  Removed entirely.
          - o3 (ozone): closely correlated with NO2 and the broader AQI label.
            Removed to prevent indirect leakage.

        What remains are ATMOSPHERIC DISPERSION PROXIES:
          - Low wind speed + no rain = pollutants trapped near the surface.
          - Temperature inversion indicators (temperature lapse, stable layer).
          - Boundary layer dynamics (mixing height proxy from diurnal temperature
            range and stability indices).
          - Temporal features: diurnal traffic/emissions cycle and seasonal
            patterns are captured via hour/month encodings.

        These features influence whether pollutants disperse or accumulate, but
        do NOT directly measure pollutant concentrations.  The model must infer
        the probability of exceedance from atmospheric conditions alone.
        """
        return [
            # Wind — primary dispersion control
            "wind_speed_10m",
            "wind_gusts_10m",
            # Precipitation — wet deposition removes particulates
            "rainfall_1h",
            "rainfall_3h",
            # Temperature and stability (boundary layer height proxy)
            "temperature_2m",
            "temperature_anomaly",
            "dewpoint_2m",
            "relative_humidity_2m",
            # Pressure pattern — anticyclonic conditions trap pollution
            "pressure_msl",
            "pressure_change_3h",
            "pressure_change_6h",
            # Visibility (optical indicator of particulate loading — independent
            # of AQI/PM measurements, derived from horizontal sight distance)
            # Cloud cover (low cloud = stable boundary layer = poor dispersion)
            # Temporal — diurnal emissions cycle and seasonal patterns
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
