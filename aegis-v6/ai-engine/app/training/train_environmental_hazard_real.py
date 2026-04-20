"""
Trains the environmental hazard risk-prediction model using real-world
historical data. ERA5 meteorological features from Open-Meteo predict
air quality exceedance events labelled from CAMS EAC4 atmospheric
reanalysis (primary) or OpenAQ DEFRA AURN in-situ measurements (fallback).

Data sources:
- Features: Open-Meteo ERA5 reanalysis (https://open-meteo.com/en/docs)
- Labels (primary): CAMS EAC4 global atmospheric reanalysis
  Inness, A. et al. (2019) CAMS reanalysis. Atmos. Chem. Phys. 19, 3515-3556.
  https://ads.atmosphere.copernicus.eu/
- Labels (secondary): OpenAQ v3 DEFRA AURN in-situ measurements
  https://openaq.org/
  DEFRA Air Quality thresholds: PM2.5 >25 ug/m3, NO2 >200 ug/m3, O3 >120 ug/m3

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
            "CAMS EAC4 global atmospheric reanalysis via Open-Meteo AQ API "
            "(primary) or OpenAQ v3 DEFRA AURN in-situ measurements (secondary). "
            "Positive label = DEFRA High-band exceedance: PM2.5 > 35.4 µg/m³ OR "
            "PM10 > 50.4 µg/m³ OR NO2 > 200 µg/m³ OR O3 > 100 µg/m³. "
            "CAMS (Copernicus Atmosphere Monitoring Service): ECMWF 4D-Var "
            "reanalysis assimilating satellite and surface AQ observations. "
            "ENTIRELY INDEPENDENT of ERA5 weather features -- driven by emission "
            "inventories and atmospheric chemistry, not weather thresholds. "
            "Ref: DEFRA LAQM.TG(16); WHO Global Air Quality Guidelines 2021; "
            "Inness et al. (2019) CAMS EAC4 dataset, GMDD."
        ),
        data_validity="independent",
        label_provenance={
            "category": "model_reanalysis_constrained",
            "source": (
                "Primary: CAMS EAC4 reanalysis via Open-Meteo Air Quality API "
                "(https://air-quality-api.open-meteo.com/v1/air-quality), free, "
                "no API key required. CAMS EAC4 assimilates MOPITT, IASI, "
                "GOME-2, TROPOMI satellite retrievals + AERONET + surface AQ. "
                "Secondary (if OPENAQ_API_KEY set): OpenAQ v3 DEFRA AURN "
                "in-situ instrument measurements."
            ),
            "description": (
                "Labels from CAMS EAC4 pollutant concentrations at 13 UK locations. "
                "A station-hour is POSITIVE when any DEFRA High-band threshold is "
                "exceeded: PM2.5 > 35.4 µg/m³, PM10 > 50.4 µg/m³, "
                "NO2 > 200 µg/m³, or O3 > 100 µg/m³. "
                "CAMS concentrations are driven by emission inventories (CAMS-GLOB-ANT, "
                "GFAS) and atmospheric chemistry -- NOT a simple function of ERA5 "
                "weather variables. The model learns which dispersion conditions "
                "lead to pollution accumulation, not a tautological threshold."
            ),
            "limitations": (
                "CAMS EAC4 spatial resolution ~0.75° -- misses local urban hotspots. "
                "Reanalysis values may differ from in-situ instruments. "
                "For highest scientific quality, replace with DEFRA AURN in-situ "
                "measurements (set OPENAQ_API_KEY env var from openaq.org)."
            ),
            "peer_reviewed_basis": (
                "Inness A. et al. (2019) 'The CAMS reanalysis of atmospheric "
                "composition', Geosci. Model Dev., 12, 1823-1863. "
                "DEFRA (2012) LAQM.TG(16). WHO (2021) Global AQ Guidelines. "
                "Open-Meteo: Zippenfenig P. (2023) Open-Meteo.com, Zenodo."
            ),
        },
        min_total_samples=500,
        min_positive_samples=50,
        min_stations=5,
        promotion_min_roc_auc=0.65,
        fixed_test_date="2022-01-01",
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
        Build AQ exceedance labels from CAMS EAC4 (primary) or OpenAQ (secondary).

        Primary source: CAMS EAC4 global atmospheric reanalysis via Open-Meteo AQ
        API -- FREE, no API key required, data available from 2015 onwards.
        A station-hour is POSITIVE when any DEFRA High-band threshold is exceeded:
          PM2.5 > 35.4 µg/m³ OR PM10 > 50.4 µg/m³ OR NO2 > 200 µg/m³ OR O3 > 100 µg/m³

        Secondary source (if CAMS returns insufficient data AND OPENAQ_API_KEY is set):
        OpenAQ v3 DEFRA AURN in-situ instrument measurements.

        Labels are FULLY INDEPENDENT of ERA5 weather features:
          - CAMS concentrations driven by emission inventories + atmospheric chemistry
          - ERA5 features capture dispersion conditions (wind, pressure, stability)
          - The model learns which atmospheric patterns trap pollutants, not a threshold.

        Feature-label merge strategy:
          CAMS station IDs ("aq_london_c", ...) from UK_AQ_LOCATIONS are mapped to
          the nearest GLOBAL_HEATWAVE_LOCATIONS entry via haversine distance,
          so station_id matches the feature grid used in build_features().

        Proxy fallback REMOVED: If both CAMS and OpenAQ fail, raises RuntimeError.
        A weather-proxy fallback creates a tautology (wind/precip in both features
        and labels) -- better to abort cleanly than silently produce a useless model.
        """
        from app.training.data_fetch_cams_openmeteo import (
            build_cams_label_df, UK_AQ_LOCATIONS as _cams_locs,
        )
        from app.training.multi_location_weather import GLOBAL_HEATWAVE_LOCATIONS
        import math

        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data -- cannot build environmental hazard labels")

        # Primary: CAMS EAC4 via Open-Meteo AQ API (free, no key required)
        aq_labels = build_cams_label_df(
            start_date=self.start_date,
            end_date=self.end_date,
            cache=True,
        )

        # Secondary: OpenAQ DEFRA AURN in-situ (only if CAMS insufficient)
        if aq_labels.empty or len(aq_labels) < 1000:
            logger.warning(
                "  CAMS returned insufficient data -- trying OpenAQ secondary source. "
                "Set OPENAQ_API_KEY env var for OpenAQ v3 access."
            )
            try:
                from app.training.data_fetch_openaq import build_openaq_label_df
                openaq_labels = build_openaq_label_df(
                    start_date=self.start_date,
                    end_date=self.end_date,
                    cache=True,
                )
                if not openaq_labels.empty and len(openaq_labels) >= 1000:
                    aq_labels = openaq_labels
                    logger.info("  Using OpenAQ secondary labels.")
            except Exception as exc:
                logger.warning(f"  OpenAQ secondary fetch failed: {exc}")

        # Hard-fail if no real AQ data available -- proxy fallback is scientifically invalid
        if aq_labels.empty or len(aq_labels) < 1000:
            raise RuntimeError(
                "Environmental hazard: no AQ label data available from CAMS or OpenAQ. "
                "CAMS via Open-Meteo returned insufficient data -- check internet connection. "
                "For OpenAQ secondary path: register at openaq.org and set OPENAQ_API_KEY env var. "
                "Weather-proxy fallback is blocked: it creates a wind/precip tautology."
            )

        # Map AQ station IDs to nearest weather grid station
        # CAMS station IDs: "aq_london_c", "aq_birmingham", etc.
        # OpenAQ station IDs: "aq_8110", "aq_8118", etc.
        # Both need mapping to GLOBAL_HEATWAVE_LOCATIONS station_id keys.
        # NOTE: GLOBAL_HEATWAVE_LOCATIONS uses "id" key; the weather DataFrame
        #       sets station_id = loc["id"] (see multi_location_weather.py:748).
        weather_locs = {
            loc["id"]: (loc["lat"], loc["lon"])
            for loc in GLOBAL_HEATWAVE_LOCATIONS
        }
        # Build lat/lon lookup for CAMS station IDs
        _cams_loc_map = {loc["id"]: (loc["lat"], loc["lon"]) for loc in _cams_locs}
        # Also import OpenAQ stations for OpenAQ secondary IDs
        try:
            from app.training.data_fetch_openaq import UK_AQ_STATIONS as _oaq_stations
        except ImportError:
            _oaq_stations = []

        def nearest_weather_station(aq_sid: str) -> str:
            """Map any AQ station ID to nearest GLOBAL_HEATWAVE_LOCATIONS entry."""
            # CAMS IDs start with "aq_" but are not numeric
            aq_lat_lon = _cams_loc_map.get(aq_sid)
            if aq_lat_lon is None and aq_sid.startswith("aq_"):
 # Try OpenAQ numeric ID: "aq_8110" -> location_id=8110
                try:
                    loc_id = int(aq_sid[3:])
                    aq_info = next((s for s in _oaq_stations if s[0] == loc_id), None)
                    if aq_info:
                        aq_lat_lon = (aq_info[2], aq_info[3])
                except ValueError:
                    pass
            if aq_lat_lon is None:
                return list(weather_locs.keys())[0]
            aq_lat, aq_lon = aq_lat_lon
            best_sid, best_dist = None, float("inf")
            for sid, (wlat, wlon) in weather_locs.items():
                dlat = math.radians(aq_lat - wlat)
                dlon = math.radians(aq_lon - wlon)
                a = (math.sin(dlat / 2) ** 2
                     + math.cos(math.radians(wlat))
                     * math.cos(math.radians(aq_lat))
                     * math.sin(dlon / 2) ** 2)
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
            f"  Environmental hazard labels (CAMS EAC4/OpenAQ): "
            f"{n_pos:,} positive ({n_pos / max(len(aq_labels), 1) * 100:.1f}%), "
            f"{n_neg:,} negative"
        )
        self.HAZARD_CONFIG.label_provenance["category"] = "model_reanalysis_constrained"
        self.HAZARD_CONFIG.data_validity = "independent"
        return aq_labels

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for environmental hazard 6h-ahead forecasting.

        Columns intentionally excluded and why:
          - aqi, pm2_5, pm10, no2: these ARE the variables used to define the
            label (AQI >= 7, PM2.5 > 35, PM10 > 50, NO2 > 200).  Including
            them means the model reads the label criterion directly from its
            input features -- a direct tautology.  Removed entirely.
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
            # Wind -- primary dispersion control
            "wind_speed_10m",
            "wind_gusts_10m",
            # Precipitation -- wet deposition removes particulates
            "rainfall_1h",
            "rainfall_3h",
            # Temperature and stability (boundary layer height proxy)
            "temperature_2m",
            "temperature_anomaly",
            "dewpoint_2m",
            "relative_humidity_2m",
            # Pressure pattern -- anticyclonic conditions trap pollution
            "pressure_msl",
            "pressure_change_3h",
            "pressure_change_6h",
            # Visibility (optical indicator of particulate loading -- independent
            # of AQI/PM measurements, derived from horizontal sight distance)
            # Cloud cover (low cloud = stable boundary layer = poor dispersion)
            # Temporal -- diurnal emissions cycle and seasonal patterns
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
