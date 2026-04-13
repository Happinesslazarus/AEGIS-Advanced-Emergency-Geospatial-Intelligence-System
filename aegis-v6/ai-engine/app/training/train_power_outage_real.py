"""
File: train_power_outage_real.py

Trains the power outage risk-prediction model using independent outage
event records from two sources:

  1. UK Named Storm Outage Records (embedded, always available):
     ~27 major UK/Ireland storms 2015–2025 with affected customer counts,
     start/end datetimes, and region centroids.  Sourced from Ofgem
     disturbance notifications, SSEN/WPD/ENW/UKPN/NIE press releases.

  2. EIA Form OE-417 (US, optional):
     US Electric Emergency Incidents and Disturbances — all weather-caused
     outage events reported to FERC/NERC under federal reporting requirements.
     Free from: https://www.eia.gov/electricity/disturbances/

Label independence:
  Labels are OBSERVED outage records (utility telemetry + regulatory reports).
  Features are ERA5 meteorological variables from Open-Meteo.
  There is no shared data source → LeakageSeverity.NONE.

How it connects:
- Extends ai-engine/app/training/base_real_pipeline.py
- Labels from data_fetch_outages.py (UK storm records + EIA OE-417)
- Features from multi_location_weather.py (GLOBAL_OUTAGE_LOCATIONS, 20 sites)
- Saves to model_registry/power_outage/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/power_outage.py
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_OUTAGE_LOCATIONS, STANDARD_HOURLY_VARS,
)
from app.training.data_fetch_outages import build_outage_label_df, outages_available


class PowerOutageRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="power_outage",
        task_type="forecast",
        lead_hours=6,
        region_scope="UK+US",
        label_source=(
            "UK Named Storm Outage Records (Ofgem / SSEN / WPD / ENW / NIE Networks, "
            "2015–2025): 27 major storm events with customer counts, start/end times, "
            "and region centroids. "
            "EIA Form OE-417 (US federal NERC reporting, 2015–2024): all weather-caused "
            "electric disturbance events with state, cause, and customer counts. "
            "Both sources are independent OBSERVED utility records, not weather thresholds."
        ),
        data_validity="independent",
        label_provenance={
            "category": "authoritative_event_record",
            "source": (
                "UK: Ofgem Electricity Disturbance Notifications; SSEN/WPD/ENW/"
                "UKPN/Northern Powergrid/NIE Networks incident press releases. "
                "US: EIA Form OE-417 annual summary Excel files from "
                "https://www.eia.gov/electricity/disturbances/"
            ),
            "description": (
                "A station-hour is POSITIVE when a documented weather-caused outage "
                "event was ACTIVE (start <= hour <= restoration) within 150 km of the "
                "station.  UK outage records cover named storms from Abigail (Nov 2015) "
                "through Eowyn (Jan 2025), including Storm Arwen (100k customers), "
                "Eunice (255k), and Eowyn (770k). "
                "US EIA OE-417 events are filtered to weather cause codes "
                "(wind, ice, snow, thunderstorm, flood, hurricane, tornado)."
            ),
            "limitations": (
                "UK records are curated static events — minor storms not reaching "
                "named-storm threshold are absent.  EIA OE-417 coverage begins ~2015 "
                "for this module; earlier data available but not yet loaded.  "
                "Outage duration ('end time') is sometimes estimated when not reported."
            ),
            "peer_reviewed_basis": (
                "Ofgem statutory electricity distribution licence condition 25.7 "
                "(disturbance notification requirements); NERC FAC-002 event reporting "
                "mandated under 18 CFR Part 11"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.68,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch storm weather features from global outage coverage grid."""
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_OUTAGE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=STANDARD_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build outage labels from UK named storm records + EIA OE-417."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build power outage labels")

        # UK records are always present; EIA OE-417 adds US coverage if downloaded
        outages_available()  # logs availability status

        labels = build_outage_label_df(
            station_locations=GLOBAL_OUTAGE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            radius_km=150.0,
        )

        if labels.empty:
            raise RuntimeError(
                "Outage label builder returned empty result.  "
                "Check that start_date/end_date overlaps with UK storm records "
                "(2015–2025).  For US coverage, download EIA OE-417 data: "
                "from app.training.data_fetch_outages import download_eia_oe417; "
                "download_eia_oe417()"
            )

        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Power outage labels: {n_pos:,} positive, {n_neg:,} negative "
            f"across {labels['station_id'].nunique()} stations"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build per-station meteorological features."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")
        return build_per_station_features(weather, self.feature_engineer)

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for power outage 6h-ahead forecasting.

        Labels come from observed utility outage records — all ERA5 meteorological
        features are legitimate (none are label constructors).  Wind speed and gusts
        are the primary physical drivers of overhead line damage.  Icing (temp +
        humidity combination), flooding, and ice-storm conditions are secondary paths.
        """
        return [
            # Primary: wind damage to overhead lines
            "wind_speed_10m",
            "wind_gusts_10m",
            # Pressure tendency — precursor to high-wind events
            "pressure_msl",
            "pressure_change_3h",
            "pressure_change_6h",
            # Icing conditions (freezing + high humidity)
            "temperature_2m",
            "relative_humidity_2m",
            "dewpoint_2m",
            # Precipitation
            "rainfall_24h", "rainfall_48h",
            # Snow / freezing conditions
            "snowfall",
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
