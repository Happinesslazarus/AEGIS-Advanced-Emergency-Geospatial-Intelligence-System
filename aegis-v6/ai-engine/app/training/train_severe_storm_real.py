"""
Trains the severe storm / tropical cyclone risk-prediction model using
IBTrACS global storm track data as the primary label source, with the
Met Office / Met Éireann Named Storm archive as a regional supplement.

Label sources (BOTH INDEPENDENT -- no leakage)
Primary -- IBTrACS v04r00 (WMO, 2010):
  Every tropical/subtropical cyclone globally since 1840.  6-hourly track
  positions with WMO best-track maximum sustained wind (knots).
  A station-hour is POSITIVE when a tropical cyclone track point with
  WMO_WIND >= 34 knots (tropical-storm force) lies within 500 km of the
  station, with a 12h lead window to capture storm approach.
  Source: NCEI -- https://www.ncei.noaa.gov/products/international-best-track-archive

Supplement -- Named Storm archive (Met Office/Met Éireann/KNMI, 2015-2025):
  60+ officially declared extratropical storms affecting UK, Ireland, NW Europe.
  These are NOT in IBTrACS (extratropical), so the two sources are complementary.
  Applied to UK/Ireland grid points only.

Combined label: POSITIVE if EITHER source fires.

Forecast horizon
task_type = "forecast", lead_hours = 6.

- Extends ai-engine/app/training/base_real_pipeline.py
- Weather features via multi_location_weather.py (GLOBAL_STORM_LOCATIONS, 28 sites)
- IBTrACS labels from data_fetch_ibtracs.py
- Named storm supplement from data_fetch_events.py
- Saves to model_registry/severe_storm/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/severe_storm.py
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_STORM_LOCATIONS, STANDARD_HOURLY_VARS,
)
from app.training.data_fetch_ibtracs import (
    build_ibtracs_label_df, ibtracs_is_available,
)
from app.training.data_fetch_events import build_storm_label_df
from app.training.data_fetch_emdat import build_emdat_label_df

# UK/Ireland stations that benefit from the Named Storm supplement
_UK_IRELAND_IDS = {"london", "edinburgh", "dublin", "amsterdam"}


class SevereStormRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="severe_storm",
        task_type="forecast",
        lead_hours=6,
        region_scope="GLOBAL",
        label_source=(
            "IBTrACS v04r00 (Knapp et al., 2010; WMO authoritative global tropical "
            "cyclone track archive): all named storms 2015-2023, WMO_WIND >= 34 knots, "
            "500 km spatial radius, 12 h lead window.  Supplements with Met Office / "
            "Met Éireann Named Storm archive for extratropical NW European storms. "
            "28 globally distributed locations across all 6 tropical cyclone basins. "
            "Source: NCEI -- https://www.ncei.noaa.gov/products/international-best-track-archive"
        ),
        data_validity="independent",
        label_provenance={
            "category": "authoritative_event_record",
            "source": (
                "IBTrACS v04r00 per-basin CSV files (NA, WP, EP, NI, SI, SP) "
                "from NCEI/WMO best-track archive.  "
                "Supplement: Met Office / Met Éireann Named Storm Archive (2015-2025)."
            ),
            "description": (
                "Primary IBTrACS labels: station-hour is POSITIVE when a WMO best-track "
                "point with sustained wind >= 34 knots is within 500 km of the station "
                "OR was within 500 km in the preceding 12 hours (lead window).  "
                "Supplement: for UK/Ireland grid points, Named Storm hours are also "
                "labelled POSITIVE (extratropical storms not in IBTrACS). "
                "Labels are entirely independent of any ERA5 meteorological variable."
            ),
            "limitations": (
                "IBTrACS captures tropical/subtropical cyclones only -- mid-latitude "
                "winter storms are covered only by the Named Storm supplement for "
                "UK/Ireland.  Track positions are 6-hourly; exact storm landfall timing "
                "within a 6-hour window is not resolved.  Stations far from any "
                "cyclone basin may have very low positive rates."
            ),
            "peer_reviewed_basis": (
                "Knapp K.R. et al. (2010). 'The International Best Track Archive for "
                "Climate Stewardship (IBTrACS).' Bull. Amer. Meteor. Soc., 91, 363-376. "
                "doi:10.1175/2009BAMS2755.1"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.70,
        fixed_test_date="2022-01-01",
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch storm weather features (global 28-site grid)."""
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_STORM_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=STANDARD_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build storm labels: IBTrACS (global primary) + Named Storms (UK/IE supplement)."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data -- cannot build storm labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"]).dt.floor("h")
        all_station_hours = weather[["timestamp", "station_id"]].drop_duplicates()

        # Primary: IBTrACS global tropical cyclone labels
        ibtracs_labels = build_ibtracs_label_df(
            station_locations=GLOBAL_STORM_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            radius_km=500.0,
            min_wind_knots=34.0,
            lead_window_hours=12,
        )

        # Supplement: Named Storm labels for UK/Ireland sites
        uk_locations = [
            loc for loc in GLOBAL_STORM_LOCATIONS
            if loc["id"] in _UK_IRELAND_IDS
        ]
        named_labels = pd.DataFrame(columns=["timestamp", "station_id", "label"])
        if uk_locations:
            named_labels = build_storm_label_df(
                station_locations=uk_locations,
                start_date=self.start_date,
                end_date=self.end_date,
            )

        # Supplement: EM-DAT global storm/cyclone disaster records
        emdat_labels = build_emdat_label_df(
            hazard_type="severe_storm",
            station_locations=GLOBAL_STORM_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            radius_km=500.0,
        )

        # Combine: union of all three sources
        all_label_frames = [
            df for df in [ibtracs_labels, named_labels, emdat_labels]
            if not df.empty
        ]

        if not all_label_frames:
 # No label data -> validator will block on min_positive_samples
            all_station_hours["label"] = 0
            logger.warning("No storm label data found -- labels are all-zero")
            return all_station_hours[["timestamp", "station_id", "label"]]

        combined_positives = (
            pd.concat(all_label_frames, ignore_index=True)
            .query("label == 1")
            [["timestamp", "station_id"]]
            .assign(timestamp=lambda d: pd.to_datetime(d["timestamp"]).dt.floor("h"))
            .drop_duplicates()
        )

        labels = all_station_hours.merge(
            combined_positives.assign(event_label=1),
            on=["timestamp", "station_id"],
            how="left",
        )
        labels["label"] = labels["event_label"].fillna(0).astype(int)
        result = labels[["timestamp", "station_id", "label"]]

        n_pos = int(result["label"].sum())
        n_neg = len(result) - n_pos
        logger.info(
            f"  Storm labels (IBTrACS + Named + EM-DAT): {n_pos:,} positive, {n_neg:,} negative "
            f"across {result['station_id'].nunique()} stations"
        )
        return result

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build per-station weather features from global ERA5."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data -- cannot build features")
        return build_per_station_features(weather, self.feature_engineer)

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for global severe storm 6h-ahead forecasting.

        Labels are from IBTrACS track archive / Named Storm records -- both
        entirely independent of ERA5.  All meteorological predictors including
        wind speed and gusts are legitimate features.
        """
        return [
            # Pressure tendency -- primary physical precursor of storm deepening
            "pressure_msl",
            "pressure_change_3h",
            "pressure_change_6h",
            # Wind -- legitimate predictor (not a label constructor)
            "wind_speed_10m",
            "wind_gusts_10m",
            # Temperature / moisture -- synoptic context
            "temperature_2m",
            "relative_humidity_2m",
            "dewpoint_2m",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]


def main():
    args = parse_training_args("severe_storm")
    result = run_pipeline(SevereStormRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Severe storm training complete: {result['version']}")
    else:
        logger.error(f"Severe storm training failed: {result.get('error', 'unknown')}")


if __name__ == "__main__":
    main()
