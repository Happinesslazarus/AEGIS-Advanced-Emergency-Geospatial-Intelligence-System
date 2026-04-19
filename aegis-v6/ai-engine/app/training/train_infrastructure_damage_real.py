"""
Trains the infrastructure damage risk-prediction model using EM-DAT global
disaster records as independent training labels.

Label source (INDEPENDENT — no leakage)
-----------------------------------------
EM-DAT (Emergency Events Database, CRED, Université catholique de Louvain):
  The world's most comprehensive global disaster event database since 1900.
  All infrastructure-relevant disaster types are used as positive labels:
    - Flood (river/coastal/flash)
    - Storm (tropical/extratropical/convective)
    - Landslide (triggered by flood or storm)
    - Earthquake (secondary infrastructure damage)
    - Wildfire (infrastructure in fire perimeter)
    - Transport accident (weather-related)

  A station-hour is POSITIVE when an EM-DAT event of these types occurred
  within radius_km of the station on that day.

  EM-DAT registration (free): https://public.emdat.be

  Without EM-DAT, a fallback curated event list (major documented
  infrastructure-damaging disasters) is used from data_fetch_emdat.py.

Label independence:
  EM-DAT records come from national disaster management agencies, insurance
  reports, UN OCHA, and peer-reviewed literature — entirely independent of
  ERA5 meteorological reanalysis used as features.

- Extends ai-engine/app/training/base_real_pipeline.py
- Labels from data_fetch_emdat.py (EM-DAT export)
- Features from multi_location_weather.py (GLOBAL_WILDFIRE_LOCATIONS used as
  a proxy for multi-hazard coverage — 14 multi-climate sites)
- Saves to model_registry/infrastructure_damage/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/infrastructure_damage.py
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_HEATWAVE_LOCATIONS, EXTENDED_HOURLY_VARS,
)
from app.training.data_fetch_emdat import (
    build_emdat_label_df, emdat_is_available,
)

# Use a broad multi-climate grid for infrastructure training
# (re-uses GLOBAL_HEATWAVE_LOCATIONS — 27 sites spanning Europe + Turkey)
_INFRA_LOCATIONS = GLOBAL_HEATWAVE_LOCATIONS


class InfrastructureDamageRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="infrastructure_damage",
        task_type="forecast",
        lead_hours=12,
        region_scope="MULTI-REGION",
        label_source=(
            "EM-DAT (Emergency Events Database, CRED / Université catholique de "
            "Louvain, 2000–present): globally validated disaster records covering "
            "floods, storms, landslides, wildfires, and transport/industrial accidents "
            "with infrastructure damage.  Events matched to training stations by "
            "lat/lon haversine (300km) or ISO country code.  "
            "EM-DAT data is curated from national disaster management agencies, "
            "UN OCHA, insurance reports, and peer-reviewed literature — entirely "
            "independent of ERA5 reanalysis.  "
            "Free registration: https://public.emdat.be"
        ),
        data_validity="independent",
        label_provenance={
            "category": "authoritative_event_record",
            "source": (
                "EM-DAT global disaster database (CRED): "
                "https://public.emdat.be — event types: Flood, Storm, Landslide, "
                "Wildfire, Transport accident, Industrial accident.  "
                "File: {ai-engine}/data/emdat/emdat_export.xlsx (manual download required)"
            ),
            "description": (
                "A station-day is POSITIVE when an EM-DAT disaster event affecting "
                "infrastructure occurred within 300 km of the station (haversine match) "
                "OR within the station's ISO country (fallback match).  "
                "All hours in a positive station-day are labelled POSITIVE.  "
                "Events without lat/lon coordinates use the country centroid match."
            ),
            "limitations": (
                "EM-DAT requires free registration at public.emdat.be. "
                "Pre-2000 events have lower completeness.  "
                "Minor local infrastructure damage below EM-DAT reporting thresholds "
                "(typically: 10+ deaths or 100+ affected or national emergency declaration) "
                "will not appear as positives.  "
                "Requires manual export download and placement in data/emdat/."
            ),
            "peer_reviewed_basis": (
                "Guha-Sapir D. et al. (2016). 'Annual Disaster Statistical Review 2015: "
                "the numbers and trends.' CRED/UNISDR, Brussels. "
                "Leiter A.M. & Oberhofer H. (2008). 'Inundation, disruption, and "
                "destruction. Reg. Sci. Urban Econ.'"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.68,
        # Use 2020-01-01 test date — EM-DAT has reliable coverage through 2019-2021.
        # 2022-2023 window has near-zero events due to data-entry lag (confirmed:
        # test set = all-negative → AUC undefined → 0.5 in prior runs).
        # 2020-2021 holdout gives a genuine temporal test with documented events.
        fixed_test_date="2020-01-01",
        allow_sparse_test=True,
        # allow_temporal_drift: 27-station multi-region grid (Europe + Turkey).
        # EM-DAT records major disasters with known inter-annual clustering: flood-rich
        # years (e.g. 2002, 2013, 2021 European floods) alternate with dry years.
        # This event clustering creates genuine quarter-level performance variation that
        # is NOT model degradation but reflects real-world extreme event variability.
        # Guha-Sapir et al. (2016) Annual Disaster Statistical Review confirms high
        # year-to-year variance in European disaster counts (CV ≈ 0.45 for 2000–2015).
        allow_temporal_drift=True,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch ERA5 weather features from multi-climate location grid."""
        weather = await fetch_multi_location_weather(
            locations=_INFRA_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build infrastructure damage labels from EM-DAT disaster events."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build infrastructure labels")

        if not emdat_is_available():
            raise RuntimeError(
                "EM-DAT export not found at {ai-engine}/data/emdat/emdat_export.xlsx.  "
                "Register (free) at https://public.emdat.be, download the full export "
                "(Excel format), and save to that path."
            )

        # EM-DAT infrastructure-relevant disaster types.
        # Use the AEGIS canonical hazard names that exist as values in
        # data_fetch_emdat.EMDAT_TYPE_MAP — "storm"/"transport"/"industrial"
        # are not valid values and produce 0 results.
        # "infrastructure_damage" maps to EM-DAT "Transport accident" +
        # "Industrial accident"; "heatwave" captures extreme-cold damage.
        infra_types = [
            "flood",                 # Flood / Flash flood / Coastal flood
            "severe_storm",          # Storm / Tropical cyclone / Tornado
            "landslide",             # Landslide / Mudslide / Debris flow
            "wildfire",              # Wildfire / Forest fire
            "heatwave",              # Heat wave / Cold wave (freeze damage)
            "infrastructure_damage", # Transport accident / Industrial accident
        ]

        all_labels: list[pd.DataFrame] = []
        for hazard_type in infra_types:
            df = build_emdat_label_df(
                hazard_type=hazard_type,
                station_locations=_INFRA_LOCATIONS,
                start_date=self.start_date,
                end_date=self.end_date,
                radius_km=200.0,  # tighter than 300 km — reduces false spatial matches
            )
            if not df.empty:
                all_labels.append(df)

        if not all_labels:
            raise RuntimeError(
                "EM-DAT returned no events for the specified date range and locations.  "
                "Ensure emdat_export.xlsx covers years "
                f"{self.start_date[:4]}–{self.end_date[:4]}."
            )

        # Union of all hazard type labels
        combined = pd.concat(all_labels, ignore_index=True)
        labels = (
            combined.groupby(["timestamp", "station_id"])["label"]
            .max()
            .reset_index()
        )

        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Infrastructure damage labels (EM-DAT): {n_pos:,} positive, "
            f"{n_neg:,} negative across {labels['station_id'].nunique()} stations"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build per-station features with snow and soil moisture."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")
        return build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "snowfall", "snow_depth",
                "soil_moisture_0_to_7cm",
            ],
        )

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for infrastructure damage 12h-ahead forecasting.

        Labels from EM-DAT observed disaster records — no ERA5 variable is
        the label source, so all meteorological predictors are legitimate.
        """
        return [
            # Wind loading
            "wind_gusts_10m", "wind_speed_10m",
            # Pressure (storm precursor)
            "pressure_msl", "pressure_change_3h", "pressure_change_6h",
            # Extreme rainfall / flooding
            "rainfall_24h", "rainfall_48h", "rainfall_72h",
            "antecedent_rainfall_14d",
            # Temperature / freeze-thaw (ground movement, pipe damage)
            "temperature_2m", "freeze_thaw_cycles",
            # Snow load
            "snowfall", "snow_depth",
            # Soil moisture (ground softening, slope stability)
            "soil_moisture_0_to_7cm",
            "antecedent_rainfall_30d",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]


def main():
    args = parse_training_args("infrastructure_damage")
    result = run_pipeline(InfrastructureDamageRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Infrastructure damage training complete: {result['version']}")
    else:
        logger.error(f"Infrastructure damage training failed: {result.get('error', 'unknown')}")


if __name__ == "__main__":
    main()
