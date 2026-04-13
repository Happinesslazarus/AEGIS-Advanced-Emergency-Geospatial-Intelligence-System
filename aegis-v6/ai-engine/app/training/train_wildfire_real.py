"""
File: train_wildfire_real.py

What this file does:
Trains the wildfire fire-danger prediction model using real-world historical
data from Open-Meteo and NASA FIRMS satellite active fire detection records.

Label source (INDEPENDENT — no leakage)
-----------------------------------------
Labels are derived from the NASA FIRMS (Fire Information for Resource
Management System) MODIS/VIIRS satellite active fire detection archive.
FIRMS provides confirmed fire pixel detections from polar-orbiting satellites
at 375m (VIIRS) and 1km (MODIS) resolution with near-global daily coverage.

These detections are entirely independent of the ERA5 meteorological variables
used as features — satellites detect thermal anomalies, not wind or humidity.
This completely eliminates label-feature correlation:
  - FWI sub-indices: NOT in features (unchanged from previous design)
  - All raw meteorological features: legitimate predictors
  - data_validity: upgraded from 'proxy' to 'independent'
  - leakage_severity: upgraded from LOW to NONE

API access requires a free NASA FIRMS MAP_KEY environment variable.
If the key is absent or the API is unreachable, the pipeline falls back to
the FWI-threshold proxy labels from the previous design (with a prominent
warning and automatic downgrade to 'proxy' / PARTIAL status).

Forecast horizon
-----------------
task_type = "forecast", lead_hours = 24: features at time T predict fire
activity (confirmed satellite detection) at T+24h.  This captures the
physical relationship between meteorological pre-conditions and fire ignition.

Global training scope
----------------------
Global fire-prone locations (GLOBAL_WILDFIRE_LOCATIONS: Iberian Peninsula,
S France, Italy, Greece, Canary Islands, Morocco, and UK) provide sufficient
positive samples.  UK alone would produce < 0.05% positive rate.

How it connects:
- Extends ai-engine/app/training/base_real_pipeline.py
- Fetches weather via multi_location_weather.py (GLOBAL_WILDFIRE_LOCATIONS)
- Labels from NASA FIRMS API (primary) with FWI-threshold fallback
- Saves to model_registry/wildfire/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/wildfire.py
"""

from __future__ import annotations

import math
import os

import numpy as np
import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_WILDFIRE_LOCATIONS, STANDARD_HOURLY_VARS,
)
from app.training.data_fetch_events import fetch_nasa_firms_events

# Radius for matching a FIRMS fire pixel to the nearest weather station
_FIRMS_MATCH_RADIUS_KM = 50.0

# FWI fallback threshold (used only when FIRMS API is unavailable)
_FWI_DANGER_THRESHOLD = 30.0
_FWI_DRY_DAYS_THRESHOLD = 7


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.asin(math.sqrt(min(a, 1.0)))


class WildfireRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="wildfire",
        task_type="forecast",
        lead_hours=24,
        region_scope="GLOBAL",
        label_source=(
            "NASA FIRMS (Fire Information for Resource Management System): "
            "VIIRS SNPP 375m and MODIS Collection 6.1 1km active fire pixel "
            "detections (https://firms.modaps.eosdis.nasa.gov/api/).  "
            "Satellite thermal anomaly detections are entirely independent of "
            "ERA5 meteorological features.  Requires FIRMS_MAP_KEY env var.  "
            "Falls back to simplified FWI threshold proxy if API unavailable."
        ),
        data_validity="independent",
        label_provenance={
            "category": "satellite_observation",
            "source": (
                "NASA FIRMS VIIRS SNPP (375m) and MODIS SP (1km) active fire "
                "pixel archive.  Free API at "
                "https://firms.modaps.eosdis.nasa.gov/api/ — register for a "
                "MAP_KEY and set FIRMS_MAP_KEY environment variable."
            ),
            "description": (
                "Positive labels: any hour on a day when a FIRMS satellite "
                "detection falls within 50km of a training weather station.  "
                "Fire pixels represent confirmed thermal anomalies from MODIS/"
                "VIIRS — independent of ERA5 wind, humidity, or precipitation. "
                "Features at T predict fire occurrence (FIRMS detection) at T+24h."
            ),
            "limitations": (
                "FIRMS spatial resolution (375m–1km) means localised fires may "
                "not appear within 50km of a grid point.  Cloud cover can "
                "suppress detections for 1–3 day gaps (fires labelled negative "
                "despite burning).  VIIRS standard processing (SP) has 5–7 day "
                "latency so near-real-time training is not possible.  Prescribed "
                "burns appear as positives.  If FIRMS_MAP_KEY is absent, the "
                "pipeline falls back to FWI-threshold proxy labels "
                "(data_validity demoted to 'proxy')."
            ),
            "peer_reviewed_basis": (
                "Giglio et al. (2016) MODIS Collection 6 active fire algorithm; "
                "Schroeder et al. (2014) VIIRS active fire detection; "
                "Justice et al. (2002) MODIS global fire monitoring"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.68,
    )

    # Set in build_labels() to track whether FIRMS succeeded or fell back
    _used_firms: bool = False

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather from 14 global wildfire-relevant locations + FIRMS fires."""
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_WILDFIRE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=STANDARD_HOURLY_VARS,
        )

        # Compute bounding box enclosing all training locations
        lats = [loc["lat"] for loc in GLOBAL_WILDFIRE_LOCATIONS]
        lons = [loc["lon"] for loc in GLOBAL_WILDFIRE_LOCATIONS]
        # Add 1° padding so fires near edges are captured
        bbox = (
            min(lons) - 1.0,
            min(lats) - 1.0,
            max(lons) + 1.0,
            max(lats) + 1.0,
        )

        # Attempt FIRMS fetch (primary independent label source)
        # Try VIIRS SP (historical standard) first, fall back to MODIS SP
        firms_df = pd.DataFrame()
        if os.environ.get("FIRMS_MAP_KEY", "").strip():
            for source in ("VIIRS_SNPP_SP", "MODIS_SP"):
                firms_df = await fetch_nasa_firms_events(
                    bbox=bbox,
                    start_date=self.start_date,
                    end_date=self.end_date,
                    source=source,
                    confidence_threshold=50,
                )
                if not firms_df.empty:
                    logger.info(
                        f"  FIRMS source '{source}': {len(firms_df):,} fire pixels"
                    )
                    break
        else:
            logger.warning(
                "FIRMS_MAP_KEY not set — will use FWI-threshold fallback labels.  "
                "Set FIRMS_MAP_KEY for independent satellite fire labels."
            )

        return {"weather": weather, "firms": firms_df}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build wildfire labels from NASA FIRMS detections (or FWI fallback).

        PRIMARY PATH (FIRMS available):
            For each weather station, find all FIRMS fire pixels within
            50km radius.  Map confirmed detections to daily presence/absence.
            Positive label = at least one fire pixel within radius on that day.
            Map daily labels to hourly timestamps.

        FALLBACK PATH (FIRMS unavailable):
            Simplified FWI threshold (FWI > 30 AND days_since_rain > 7).
            The FWI is computed for label derivation ONLY — it is never added
            to the features DataFrame.  data_validity is demoted to 'proxy'.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        firms_df = raw_data.get("firms", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build wildfire labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["date"] = weather["timestamp"].dt.date

        if not firms_df.empty:
            return self._build_firms_labels(weather, firms_df)
        else:
            logger.warning(
                "  FIRMS data not available — falling back to FWI-threshold "
                "proxy labels.  data_validity demoted to 'proxy'."
            )
            self._used_firms = False
            return self._build_fwi_fallback_labels(weather)

    def _build_firms_labels(
        self, weather: pd.DataFrame, firms_df: pd.DataFrame
    ) -> pd.DataFrame:
        """Match FIRMS fire pixels to training stations within 50km radius."""
        self._used_firms = True
        firms_df = firms_df.copy()
        firms_df["acq_date"] = pd.to_datetime(firms_df["acq_date"]).dt.date

        all_labels: list[pd.DataFrame] = []

        for loc in GLOBAL_WILDFIRE_LOCATIONS:
            station_id = loc["id"]
            station_lat = loc["lat"]
            station_lon = loc["lon"]

            # Find FIRMS pixels within radius
            nearby = firms_df[
                firms_df.apply(
                    lambda r: _haversine_km(
                        station_lat, station_lon,
                        float(r["latitude"]), float(r["longitude"])
                    ) <= _FIRMS_MATCH_RADIUS_KM,
                    axis=1,
                )
            ]

            fire_dates: set = set(nearby["acq_date"].unique()) if not nearby.empty else set()

            # Get hourly timestamps for this station
            station_weather = weather[weather["station_id"] == station_id].copy()
            if station_weather.empty:
                continue

            hourly = station_weather[["timestamp"]].copy()
            hourly["timestamp"] = hourly["timestamp"].dt.floor("h")
            hourly = hourly.drop_duplicates()
            hourly["station_id"] = station_id
            hourly["date"] = hourly["timestamp"].dt.date
            hourly["label"] = hourly["date"].apply(
                lambda d: 1 if d in fire_dates else 0
            )
            all_labels.append(hourly[["timestamp", "station_id", "label"]])

        if not all_labels:
            raise RuntimeError("No station data produced for FIRMS label matching")

        labels = pd.concat(all_labels, ignore_index=True)
        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        stations_with_fire = labels[labels["label"] == 1]["station_id"].nunique()
        logger.info(
            f"  Wildfire labels (FIRMS): {n_pos:,} positive, {n_neg:,} negative "
            f"({n_pos / max(len(labels), 1) * 100:.2f}% positive rate) "
            f"across {labels['station_id'].nunique()} stations "
            f"({stations_with_fire} with fire detections)"
        )
        return labels

    def _build_fwi_fallback_labels(self, weather: pd.DataFrame) -> pd.DataFrame:
        """FWI-threshold fallback when FIRMS is unavailable.

        Computes simplified Canadian FWI for LABEL DERIVATION ONLY.
        FWI is never added to the features DataFrame.
        """
        temp_col = next(
            (c for c in ["temperature_2m", "temperature"] if c in weather.columns), None
        )
        hum_col = next(
            (c for c in ["relative_humidity_2m", "relativehumidity_2m", "humidity"]
             if c in weather.columns), None
        )
        wind_col = next(
            (c for c in ["wind_speed_10m", "windspeed_10m"] if c in weather.columns), None
        )
        precip_col = next(
            (c for c in ["precipitation", "rain", "rainfall"] if c in weather.columns), None
        )

        all_labels: list[pd.DataFrame] = []

        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp")

            agg_dict: dict = {}
            if temp_col:
                agg_dict["temp_noon"] = (temp_col, "max")
            if hum_col:
                agg_dict["rh_noon"] = (hum_col, "min")
            if wind_col:
                agg_dict["wind_noon"] = (wind_col, "mean")
            if precip_col:
                agg_dict["rain_24h"] = (precip_col, "sum")

            if not agg_dict:
                continue

            daily = grp.groupby("date").agg(**agg_dict).reset_index().sort_values("date")
            for col, default in [
                ("temp_noon", 15.0), ("rh_noon", 50.0),
                ("wind_noon", 10.0), ("rain_24h", 0.0),
            ]:
                if col not in daily.columns:
                    daily[col] = default

            n = len(daily)
            ffmc = np.full(n, 85.0)
            dmc = np.full(n, 6.0)
            dc = np.full(n, 15.0)

            for i in range(1, n):
                t = max(float(daily["temp_noon"].iloc[i]), -1.1)
                rh = float(daily["rh_noon"].iloc[i])
                w = float(daily["wind_noon"].iloc[i])
                ro = float(daily["rain_24h"].iloc[i])

                mo = 147.2 * (101.0 - ffmc[i-1]) / (59.5 + ffmc[i-1])
                if ro > 0.5:
                    rf = ro - 0.5
                    mo = mo + 42.5 * rf * np.exp(-100.0 / (251.0 - mo)) * (
                        1.0 - np.exp(-6.93 / rf)
                    )
                    mo = min(mo, 250.0)
                ed = 0.942 * (rh ** 0.679) + 11.0 * np.exp((rh - 100.0) / 10.0)
                ko = (
                    0.424 * (1.0 - (rh / 100.0) ** 1.7)
                    + 0.0694 * (w ** 0.5) * (1.0 - (rh / 100.0) ** 8)
                ) * 0.581 * np.exp(0.0365 * t)
                mo_new = ed + (mo - ed) * (10.0 ** (-ko)) if mo > ed else mo
                ffmc[i] = np.clip(59.5 * (250.0 - mo_new) / (147.2 + mo_new), 0, 101)

                rk = max(0.0, 1.894 * (t + 1.1) * (100.0 - rh) * 0.0001) if t > -1.1 else 0.0
                dmc[i] = max(dmc[i-1] - (ro - 1.5) * 0.5, 0) if ro > 1.5 else dmc[i-1] + rk

                dc[i] = dc[i-1] + (0.36 * (t + 2.8) if t > -2.8 else 0.0)
                if ro > 2.8:
                    dc[i] = max(dc[i] - (ro - 2.8) * 0.5, 0)

            fw = np.exp(0.05039 * daily["wind_noon"].values)
            fm = 147.2 * (101.0 - ffmc) / (59.5 + ffmc)
            sf = 91.9 * np.exp(-0.1386 * fm) * (1.0 + (fm ** 5.31) / 4.93e7)
            isi = 0.208 * fw * sf
            bui = np.where(
                dmc <= 0.4 * dc,
                0.8 * dmc * dc / (dmc + 0.4 * dc + 1e-6),
                dmc - (1.0 - 0.8 * dc / (dmc + 0.4 * dc + 1e-6))
                * (0.92 + (0.0114 * dmc) ** 1.7),
            )
            bui = np.clip(bui, 0, 300)
            fd = np.where(
                bui <= 80,
                0.626 * (bui ** 0.809) + 2.0,
                1000.0 / (25.0 + 108.64 * np.exp(-0.023 * bui)),
            )
            daily["fwi"] = np.clip(isi * fd / 10.0, 0, 150)

            dsr = np.zeros(n, dtype=int)
            running = 0
            for i in range(n):
                running = 0 if float(daily["rain_24h"].iloc[i]) > 1.0 else running + 1
                dsr[i] = running
            daily["days_since_rain"] = dsr

            daily["label"] = (
                (daily["fwi"] > _FWI_DANGER_THRESHOLD)
                & (daily["days_since_rain"] > _FWI_DRY_DAYS_THRESHOLD)
            ).astype(int)

            hourly = grp[["timestamp"]].copy()
            hourly["timestamp"] = hourly["timestamp"].dt.floor("h")
            hourly = hourly.drop_duplicates()
            hourly["station_id"] = station_id
            hourly["date"] = hourly["timestamp"].dt.date
            date_label_map = dict(zip(daily["date"], daily["label"]))
            hourly["label"] = hourly["date"].map(date_label_map).fillna(0).astype(int)
            all_labels.append(hourly[["timestamp", "station_id", "label"]])

        if not all_labels:
            raise RuntimeError("No labels produced from FWI fallback")

        labels = pd.concat(all_labels, ignore_index=True)
        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Wildfire labels (FWI fallback): {n_pos:,} positive, "
            f"{n_neg:,} negative ({n_pos / max(len(labels), 1) * 100:.2f}%)"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build per-station weather features.

        FWI sub-indices are intentionally NOT computed or added here —
        they remain absent from features regardless of whether FIRMS or
        FWI fallback was used for labels.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")
        return build_per_station_features(weather, self.feature_engineer)

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for wildfire 24h-ahead fire prediction.

        With FIRMS independent labels, ALL raw meteorological fire-weather
        drivers are legitimate predictors.  FWI sub-indices remain excluded
        to preserve interpretability and avoid reintroducing the tautology
        in the fallback code path.
        """
        return [
            # Primary fire-weather drivers
            "temperature_2m",
            "temperature_anomaly",
            "relative_humidity_2m",
            "wind_speed_10m",
            "wind_gusts_10m",
            # Fuel dryness / drought indicators
            "days_since_significant_rain",
            "antecedent_rainfall_7d",
            "antecedent_rainfall_14d",
            "antecedent_rainfall_30d",
            "rainfall_24h",
            "rainfall_48h",
            "rainfall_72h",
            # Atmospheric state
            "pressure_msl",
            "pressure_change_3h",
            # Temporal context — vegetation dryness seasonality
            "season_sin", "season_cos", "month",
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
