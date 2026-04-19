"""
Feature engineering transforms for the training pipeline: rolling
statistics (3h, 24h, 7d windows), cyclical time encoding (day-of-year,
hour), anomaly z-scores, and the LeakagePrevention utility that strips
future-looking columns from training data to prevent data leakage.

- Used by all training pipelines (base_hazard_pipeline, base_real_pipeline)
- FeatureStore calls overlapping logic for live prediction features
- LeakagePrevention used in train_*_real.py __init__ methods
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

# Constants

_MAGNUS_A = 17.27
_MAGNUS_B = 237.7  # —C

_HEAT_INDEX_C = [
    -42.379, 2.04901523, 10.14333127, -0.22475541,
    -6.83783e-03, -5.481717e-02, 1.22874e-03,
    8.5282e-04, -1.99e-06,
]

# Van Wagner (1987) FWI starting defaults
_FFMC_INIT = 85.0
_DMC_INIT = 6.0
_DC_INIT = 15.0

class FeatureEngineer:
    """Stateless feature-engineering routines shared across all 11 hazard pipelines."""

    # River features
    @staticmethod
    def compute_river_features(
        river_df: pd.DataFrame,
        window_hours: int = 24,
    ) -> pd.DataFrame:
        """Derive river-level and flow features from gauge readings.

        Parameters
        river_df : pd.DataFrame
            Required columns: ``[timestamp, station_id, level_m, flow_m3s]``.
        window_hours : int
            Base window size (default 24 h).  Other windows (6, 12, 48 h)
            are fixed multiples of this base.

        Returns
        pd.DataFrame
            Indexed by ``(timestamp, station_id)`` with features:
            level_current, level_max_6h/12h/24h/48h, level_min_24h,
            rate_of_rise_6h, level_percentile, level_anomaly,
            is_above_typical_range, flow_current, flow_max_24h.
        """
        df = river_df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values(["station_id", "timestamp"])

        results: list[pd.DataFrame] = []
        for station_id, grp in df.groupby("station_id"):
            g = grp.set_index("timestamp").sort_index()

            out = pd.DataFrame(index=g.index)
            out["station_id"] = station_id

            # Current values
            out["level_current"] = g["level_m"]
            out["flow_current"] = g["flow_m3s"]

            # Infer frequency for rolling window sizes
            freq_seconds = g.index.to_series().diff().median().total_seconds()
            if freq_seconds <= 0:
                freq_seconds = 3600  # fallback 1 h

            def _periods(hours: int) -> int:
                return max(1, int(hours * 3600 / freq_seconds))

            # Rolling max / min over various horizons (backward-looking)
            for hrs in (6, 12, 24, 48):
                p = _periods(hrs)
                out[f"level_max_{hrs}h"] = (
                    g["level_m"].rolling(p, min_periods=1).max()
                )
            out["level_min_24h"] = (
                g["level_m"].rolling(_periods(24), min_periods=1).min()
            )

            # Rate of rise over 6 h
            shift_6h = _periods(6)
            out["rate_of_rise_6h"] = g["level_m"] - g["level_m"].shift(shift_6h)

            # Percentile rank — causal expanding rank (never uses future data).
            # Using .rank(pct=True) on the full series would give the final
            # percentile at each point (leaks test distribution into training
            # features). Expanding rank at time T uses only observations [0, T].
            full_history = g["level_m"].dropna()
            if len(full_history) > 0:
                min_obs = max(2, int(len(full_history) * 0.01))
                out["level_percentile"] = (
                    g["level_m"]
                    .expanding(min_periods=min_obs)
                    .rank(pct=True) * 100
                )
                out["level_percentile"] = out["level_percentile"].fillna(50.0)
            else:
                out["level_percentile"] = np.nan

            # Anomaly from 30-day rolling mean
            p30d = _periods(30 * 24)
            rolling_mean_30d = g["level_m"].rolling(p30d, min_periods=1).mean()
            out["level_anomaly"] = g["level_m"] - rolling_mean_30d

            # Above typical range (> 90th percentile of seen history).
            # Causal: expanding quantile so training samples are never ranked
            # against test-period observations.
            if len(full_history) > 0:
                min_obs = max(10, int(len(full_history) * 0.01))
                expanding_pct90 = (
                    g["level_m"]
                    .expanding(min_periods=min_obs)
                    .quantile(0.90)
                    .shift(1)  # exclude current row from its own threshold
                )
                expanding_pct90 = expanding_pct90.fillna(
                    g["level_m"].expanding(min_periods=1).quantile(0.90)
                )
                out["is_above_typical_range"] = (g["level_m"] > expanding_pct90).astype(int)
            else:
                out["is_above_typical_range"] = 0

            # Flow max 24 h
            out["flow_max_24h"] = (
                g["flow_m3s"].rolling(_periods(24), min_periods=1).max()
            )

            results.append(out)

        if not results:
            logger.warning("compute_river_features: empty input — returning empty DataFrame")
            return pd.DataFrame()

        combined = pd.concat(results)
        combined = combined.reset_index().set_index(["timestamp", "station_id"])

        # NaN handling: forward-fill then zero-fill
        combined = combined.ffill().fillna(0)
        return combined

    # Rainfall features
    @staticmethod
    def compute_rainfall_features(rain_df: pd.DataFrame) -> pd.DataFrame:
        """Derive accumulated rainfall and intensity features.

        Parameters
        rain_df : pd.DataFrame
            Required columns: ``[timestamp, station_id, rainfall_mm]``.

        Returns
        pd.DataFrame
            Indexed by ``(timestamp, station_id)`` with features:
            rainfall_1h/3h/6h/12h/24h/48h/72h/7d,
            antecedent_rainfall_7d/14d/30d, days_since_significant_rain,
            rainfall_intensity_max_1h, rainfall_anomaly_monthly.
        """
        df = rain_df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values(["station_id", "timestamp"])

        results: list[pd.DataFrame] = []
        for station_id, grp in df.groupby("station_id"):
            g = grp.set_index("timestamp").sort_index()

            freq_seconds = g.index.to_series().diff().median().total_seconds()
            if freq_seconds <= 0:
                freq_seconds = 3600

            def _p(hours: int) -> int:
                return max(1, int(hours * 3600 / freq_seconds))

            out = pd.DataFrame(index=g.index)
            out["station_id"] = station_id

            # Cumulative rainfall over various horizons
            for hrs in (1, 3, 6, 12, 24, 48, 72):
                out[f"rainfall_{hrs}h"] = (
                    g["rainfall_mm"].rolling(_p(hrs), min_periods=1).sum()
                )

            # 7-day accumulation
            out["rainfall_7d"] = (
                g["rainfall_mm"].rolling(_p(7 * 24), min_periods=1).sum()
            )

            # Antecedent rainfall (previous N days, excluding current hour)
            for days in (7, 14, 30, 60, 90):
                p = _p(days * 24)
                out[f"antecedent_rainfall_{days}d"] = (
                    g["rainfall_mm"].shift(1).rolling(p, min_periods=1).sum()
                )

            # Days since significant rain (>= 1 mm in any single reading)
            significant = g["rainfall_mm"] >= 1.0
            # Cumulative-sum resets on each significant event
            sig_group = significant.cumsum()
            counts = g.groupby(sig_group).cumcount()
            out["days_since_significant_rain"] = (counts * freq_seconds) / 86400.0

            # Max hourly rainfall intensity in last 24 h
            hourly_rate = g["rainfall_mm"] * (3600 / freq_seconds)
            out["rainfall_intensity_max_1h"] = (
                hourly_rate.rolling(_p(24), min_periods=1).max()
            )

            # Monthly climatology anomaly — causal expanding mean to prevent leakage.
            # Using full-dataset .transform("mean") would include val/test months in the
            # monthly climatology, leaking future information into training features.
            # Causal fix: for each calendar month, compute the expanding mean of only the
            # observations that occurred BEFORE the current timestamp (shift(1) ensures
            # the current value is not included in its own climatology estimate).
            # fillna(x.mean()) seeds the first occurrence of each month with its own value
            # (unavoidable for month 1, but affects <1% of samples).
            out["rainfall_anomaly_monthly"] = g["rainfall_mm"] - (
                g["rainfall_mm"]
                .groupby(g.index.month)
                .transform(
                    lambda x: x.expanding().mean().shift(1).fillna(x.expanding().mean())
                )
            )

            results.append(out)

        if not results:
            logger.warning("compute_rainfall_features: empty input — returning empty DataFrame")
            return pd.DataFrame()

        combined = pd.concat(results)
        combined = combined.reset_index().set_index(["timestamp", "station_id"])
        combined = combined.ffill().fillna(0)
        return combined

    # Weather features
    @staticmethod
    def compute_weather_features(weather_df: pd.DataFrame) -> pd.DataFrame:
        """Derive weather-derived features from surface observations.

        Parameters
        weather_df : pd.DataFrame
            Required columns: ``[timestamp, temperature_2m, relative_humidity_2m,
            pressure_msl, wind_speed_10m, wind_gusts_10m, precipitation,
            cloud_cover, visibility]``.

        Returns
        pd.DataFrame
            Same index with additional columns:
            pressure_change_3h/6h/12h, temperature_anomaly,
            consecutive_hot_days, consecutive_frost_days,
            freeze_thaw_cycles_48h, wind_chill_index, heat_index,
            dewpoint.
        """
        df = weather_df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values("timestamp").set_index("timestamp")

        freq_seconds = df.index.to_series().diff().median().total_seconds()
        if freq_seconds <= 0:
            freq_seconds = 3600

        def _p(hours: int) -> int:
            return max(1, int(hours * 3600 / freq_seconds))

        # Pressure change rates
        for hrs in (3, 6, 12):
            shift = _p(hrs)
            df[f"pressure_change_{hrs}h"] = (
                df["pressure_msl"] - df["pressure_msl"].shift(shift)
            )

        # Temperature anomaly (deviation from 30-day rolling mean)
        p30d = _p(30 * 24)
        rolling_temp_mean = df["temperature_2m"].rolling(p30d, min_periods=1).mean()
        df["temperature_anomaly"] = df["temperature_2m"] - rolling_temp_mean

        # Consecutive hot days (daily max temp > 25 °C).
        # reindex().ffill() replaces deprecated reindex(method="ffill") (pandas 2.x).
        daily_max = df["temperature_2m"].resample("D").max()
        hot_days = (daily_max > 25).astype(int)
        hot_streak = hot_days.groupby(
            (hot_days != hot_days.shift()).cumsum()
        ).cumsum() * hot_days
        df["consecutive_hot_days"] = (
            hot_streak.reindex(df.index).ffill().fillna(0).astype(int)
        )

        # Consecutive frost days (daily min temp < 0 °C).
        daily_min = df["temperature_2m"].resample("D").min()
        frost_days = (daily_min < 0).astype(int)
        frost_streak = frost_days.groupby(
            (frost_days != frost_days.shift()).cumsum()
        ).cumsum() * frost_days
        df["consecutive_frost_days"] = (
            frost_streak.reindex(df.index).ffill().fillna(0).astype(int)
        )

        # Freeze-thaw cycles in last 48 h (zero-crossings)
        p48 = _p(48)
        temp = df["temperature_2m"]
        sign_changes = (np.sign(temp) != np.sign(temp.shift(1))).astype(int)
        df["freeze_thaw_cycles_48h"] = sign_changes.rolling(p48, min_periods=1).sum()

        # Wind chill index (JAG/TI formula)
        # Valid for T <= 10 —C and V > 4.8 km/h
        t = df["temperature_2m"]
        v_kmh = df["wind_speed_10m"] * 3.6  # m/s ? km/h
        wc = (
            13.12
            + 0.6215 * t
            - 11.37 * np.power(v_kmh.clip(lower=0.1), 0.16)
            + 0.3965 * t * np.power(v_kmh.clip(lower=0.1), 0.16)
        )
        mask_wc = (t <= 10) & (v_kmh > 4.8)
        df["wind_chill_index"] = np.where(mask_wc, wc, t)

        # Heat index (Rothfusz regression)
        t_f = t * 9.0 / 5.0 + 32.0  # —C ? —F
        rh = df["relative_humidity_2m"]
        c = _HEAT_INDEX_C
        hi_f = (
            c[0]
            + c[1] * t_f
            + c[2] * rh
            + c[3] * t_f * rh
            + c[4] * t_f ** 2
            + c[5] * rh ** 2
            + c[6] * t_f ** 2 * rh
            + c[7] * t_f * rh ** 2
            + c[8] * t_f ** 2 * rh ** 2
        )
        hi_c = (hi_f - 32.0) * 5.0 / 9.0  # back to —C
        # Only meaningful when T >= 27 —C and RH >= 40%
        heat_mask = (t >= 27) & (rh >= 40)
        df["heat_index"] = np.where(heat_mask, hi_c, t)

        # Dewpoint (Magnus formula)
        gamma = (_MAGNUS_A * t) / (_MAGNUS_B + t) + np.log(rh.clip(lower=1) / 100.0)
        df["dewpoint"] = (_MAGNUS_B * gamma) / (_MAGNUS_A - gamma)

        # NaN handling: forward-fill then zero-fill
        df = df.ffill().fillna(0)
        return df

    # Soil moisture proxy
    @staticmethod
    def compute_soil_moisture_proxy(
        rainfall_df: pd.DataFrame,
        weather_df: pd.DataFrame,
    ) -> pd.Series:
        """30-day cumulative rainfall minus Hargreaves ET estimate.

        Parameters
        rainfall_df : pd.DataFrame
            Must contain ``[timestamp, rainfall_mm]`` (station-aggregated or single).
        weather_df : pd.DataFrame
            Must contain ``[timestamp, temperature_2m]``.

        Returns
        pd.Series
            Soil moisture proxy values aligned to ``weather_df`` index.
        """
        rain = rainfall_df.copy()
        rain["timestamp"] = pd.to_datetime(rain["timestamp"])
        rain = rain.set_index("timestamp").sort_index()

        wx = weather_df.copy()
        wx["timestamp"] = pd.to_datetime(wx["timestamp"])
        wx = wx.set_index("timestamp").sort_index()

        freq_seconds = wx.index.to_series().diff().median().total_seconds()
        if freq_seconds <= 0:
            freq_seconds = 3600
        p30d = max(1, int(30 * 24 * 3600 / freq_seconds))

        # 30-day cumulative rainfall reindexed to weather timestamps
        rain_reindexed = (
            rain["rainfall_mm"]
            .reindex(wx.index, method="nearest", tolerance=pd.Timedelta("2h"))
            .fillna(0)
        )
        cum_rain_30d = rain_reindexed.rolling(p30d, min_periods=1).sum()

        # Hargreaves ET0 (simplified daily, mm/day)
        #   ET0 = 0.0023 * Ra * (T_mean + 17.8) * (T_max - T_min)^0.5
        #   Use constant extraterrestrial radiation — 15 MJ/m—/day (mid-latitude avg)
        ra_approx = 15.0
        t_mean = wx["temperature_2m"]
        daily_tmax = t_mean.resample("D").max().reindex(wx.index, method="ffill")
        daily_tmin = t_mean.resample("D").min().reindex(wx.index, method="ffill")
        t_range = (daily_tmax - daily_tmin).clip(lower=0)

        et0_daily = 0.0023 * ra_approx * (t_mean + 17.8) * np.sqrt(t_range)
        et0_daily = et0_daily.clip(lower=0)

        # Scale to per-timestep then accumulate over 30 days
        et0_per_step = et0_daily * (freq_seconds / 86400.0)
        cum_et_30d = et0_per_step.rolling(p30d, min_periods=1).sum()

        soil_moisture = cum_rain_30d - cum_et_30d
        soil_moisture.name = "soil_moisture_proxy"
        return soil_moisture.ffill().fillna(0)

    # Canadian Fire Weather Index (Van Wagner 1987)
    @staticmethod
    def compute_fwi(weather_df: pd.DataFrame) -> pd.DataFrame:
        """Compute the six components of the Canadian Fire Weather Index system.

        Implements the standard Van Wagner (1987) equations iteratively at
        daily resolution.  Sub-daily input is resampled internally.

        Parameters
        weather_df : pd.DataFrame
            Required columns: ``[timestamp, temperature_2m, relative_humidity_2m,
            wind_speed_10m, precipitation]``.

        Returns
        pd.DataFrame
            Columns: ``[ffmc, dmc, dc, isi, bui, fwi]``, indexed by date.
        """
        df = weather_df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.set_index("timestamp").sort_index()

        # Resample to daily values for the FWI system
        daily = df.resample("D").agg({
            "temperature_2m": "max",
            "relative_humidity_2m": "mean",
            "wind_speed_10m": "mean",
            "precipitation": "sum",
        }).dropna(how="all")

        temp = daily["temperature_2m"].values
        rh = daily["relative_humidity_2m"].values.clip(0, 100)
        wind = daily["wind_speed_10m"].values  # m/s, converted to km/h below
        rain = daily["precipitation"].values.clip(min=0)

        n = len(daily)
        ffmc_arr = np.zeros(n)
        dmc_arr = np.zeros(n)
        dc_arr = np.zeros(n)
        isi_arr = np.zeros(n)
        bui_arr = np.zeros(n)
        fwi_arr = np.zeros(n)

        ffmc_prev = _FFMC_INIT
        dmc_prev = _DMC_INIT
        dc_prev = _DC_INIT

        # Day-length adjustment factors by month (DMC)
        _dl_dmc = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9,
                    12.4, 10.9, 9.4, 8.0, 7.0, 6.0]
        # Day-length adjustment factors by month (DC)
        _dl_dc = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8,
                   6.4, 5.0, 2.4, 0.4, -1.6, -1.6]

        for i in range(n):
            t = temp[i]
            h = rh[i]
            w = wind[i] * 3.6  # m/s ? km/h
            ro = rain[i]
            month = daily.index[i].month

            # FFMC (Fine Fuel Moisture Code)
            mo = 147.2 * (101.0 - ffmc_prev) / (59.5 + ffmc_prev)

            if ro > 0.5:
                rf = ro - 0.5
                if mo <= 150.0:
                    mr = (
                        mo
                        + 42.5 * rf * math.exp(-100.0 / (251.0 - mo))
                        * (1.0 - math.exp(-6.93 / rf))
                    )
                else:
                    mr = (
                        mo
                        + 42.5 * rf * math.exp(-100.0 / (251.0 - mo))
                        * (1.0 - math.exp(-6.93 / rf))
                        + 0.0015 * (mo - 150.0) ** 2 * math.sqrt(rf)
                    )
                mr = min(mr, 250.0)
                mo = mr

            ed = (
                0.942 * h ** 0.679
                + 11.0 * math.exp((h - 100.0) / 10.0)
                + 0.18 * (21.1 - t) * (1.0 - math.exp(-0.115 * h))
            )

            if mo > ed:
                ko = (
                    0.424 * (1.0 - (h / 100.0) ** 1.7)
                    + 0.0694 * math.sqrt(w) * (1.0 - (h / 100.0) ** 8)
                )
                kd = ko * 0.581 * math.exp(0.0365 * t)
                m = ed + (mo - ed) * 10.0 ** (-kd)
            else:
                ew = (
                    0.618 * h ** 0.753
                    + 10.0 * math.exp((h - 100.0) / 10.0)
                    + 0.18 * (21.1 - t) * (1.0 - math.exp(-0.115 * h))
                )
                if mo < ew:
                    k1 = (
                        0.424 * (1.0 - ((100.0 - h) / 100.0) ** 1.7)
                        + 0.0694 * math.sqrt(w) * (1.0 - ((100.0 - h) / 100.0) ** 8)
                    )
                    kw = k1 * 0.581 * math.exp(0.0365 * t)
                    m = ew - (ew - mo) * 10.0 ** (-kw)
                else:
                    m = mo

            ffmc = 59.5 * (250.0 - m) / (147.2 + m)
            ffmc = float(np.clip(ffmc, 0.0, 101.0))
            ffmc_arr[i] = ffmc
            ffmc_prev = ffmc

            # DMC (Duff Moisture Code)
            t_dmc = max(t, -1.1)
            if ro > 1.5:
                re = 0.92 * ro - 1.27
                mo_dmc = 20.0 + math.exp(5.6348 - dmc_prev / 43.43)
                if dmc_prev <= 33.0:
                    b_dmc = 100.0 / (0.5 + 0.3 * dmc_prev)
                elif dmc_prev <= 65.0:
                    b_dmc = 14.0 - 1.3 * math.log(dmc_prev)
                else:
                    b_dmc = 6.2 * math.log(dmc_prev) - 17.2
                mr_dmc = mo_dmc + 1000.0 * re / (48.77 + b_dmc * re)
                pr = 244.72 - 43.43 * math.log(mr_dmc - 20.0) if mr_dmc > 20.0 else 0.0
                pr = max(pr, 0.0)
            else:
                pr = dmc_prev

            le = _dl_dmc[month - 1]
            if t_dmc > -1.1:
                dmc = pr + 1.894 * (t_dmc + 1.1) * (100.0 - h) * le * 1e-6
            else:
                dmc = pr
            dmc = max(dmc, 0.0)
            dmc_arr[i] = dmc
            dmc_prev = dmc

            # DC (Drought Code)
            t_dc = max(t, -2.8)
            if ro > 2.8:
                rd = 0.83 * ro - 1.27
                qo = 800.0 * math.exp(-dc_prev / 400.0)
                qr = qo + 3.937 * rd
                dr = 400.0 * math.log(800.0 / qr) if qr > 0 else dc_prev
                dr = max(dr, 0.0)
            else:
                dr = dc_prev

            if t_dc > -2.8:
                v_val = 0.36 * (t_dc + 2.8) + _dl_dc[month - 1]
                v_val = max(v_val, 0.0)
            else:
                v_val = 0.0

            dc = dr + 0.5 * v_val
            dc = max(dc, 0.0)
            dc_arr[i] = dc
            dc_prev = dc

            # ISI (Initial Spread Index)
            fm = 147.2 * (101.0 - ffmc) / (59.5 + ffmc)
            sf = 19.115 * math.exp(fm * (-0.1386)) * (
                1.0 + fm ** 5.31 / 4.93e7
            )
            sw = math.exp(0.05039 * w)
            isi = 0.208 * sf * sw
            isi_arr[i] = isi

            # BUI (Build Up Index)
            if dmc <= 0.4 * dc:
                bui = (
                    0.8 * dmc * dc / (dmc + 0.4 * dc)
                    if (dmc + 0.4 * dc) > 0
                    else 0.0
                )
            else:
                bui = dmc - (
                    1.0 - 0.8 * dc / (dmc + 0.4 * dc)
                ) * (0.92 + (0.0114 * dmc) ** 1.7)
            bui = max(bui, 0.0)
            bui_arr[i] = bui

            # FWI (Fire Weather Index)
            if bui <= 80.0:
                fd = 0.626 * bui ** 0.809 + 2.0
            else:
                fd = 1000.0 / (25.0 + 108.64 * math.exp(-0.023 * bui))

            b_fwi = 0.1 * isi * fd
            if b_fwi > 1.0:
                fwi_val = math.exp(2.72 * (0.434 * math.log(b_fwi)) ** 0.647)
            else:
                fwi_val = b_fwi
            fwi_arr[i] = fwi_val

        result = pd.DataFrame(
            {
                "ffmc": ffmc_arr,
                "dmc": dmc_arr,
                "dc": dc_arr,
                "isi": isi_arr,
                "bui": bui_arr,
                "fwi": fwi_arr,
            },
            index=daily.index,
        )
        logger.debug(
            "FWI computed for {} days, FWI range [{:.1f}, {:.1f}]",
            n,
            float(fwi_arr.min()) if n > 0 else 0.0,
            float(fwi_arr.max()) if n > 0 else 0.0,
        )
        return result

    # Unified feature engineering
    @staticmethod
    def engineer_all_features(
        df: pd.DataFrame,
        hazard_type: str = "flood",
        timestamp_col: str = "timestamp",
    ) -> pd.DataFrame:
        """Apply all applicable feature-engineering steps to a DataFrame.

        Inspects available columns and dispatches to the relevant static
        methods.  Returns a single consolidated DataFrame ready for ML.
        """
        result = df.copy()

        # Temporal features
        if timestamp_col in result.columns:
            temporal = FeatureEngineer.compute_temporal_features(result[timestamp_col])
            for c in temporal.columns:
                result[c] = temporal[c].values

        # Weather features
        weather_cols = {"temperature", "humidity", "wind_speed", "pressure"}
        if weather_cols.issubset(result.columns):
            weather_out = FeatureEngineer.compute_weather_features(result)
            for c in weather_out.columns:
                if c not in result.columns:
                    result[c] = weather_out[c].values

        # Rainfall features
        if "rainfall_mm" in result.columns or "precipitation" in result.columns:
            rain_col = "rainfall_mm" if "rainfall_mm" in result.columns else "precipitation"
            rain_df = result[[rain_col]].rename(columns={rain_col: "rainfall_mm"})
            if timestamp_col in result.columns:
                rain_df[timestamp_col] = result[timestamp_col]
            rain_out = FeatureEngineer.compute_rainfall_features(rain_df)
            for c in rain_out.columns:
                if c not in result.columns:
                    result[c] = rain_out[c].values

        # River features (flood-specific, requires station_id)
        if hazard_type == "flood" and "river_level" in result.columns and "station_id" in result.columns:
            river_out = FeatureEngineer.compute_river_features(result)
            for c in river_out.columns:
                if c not in result.columns:
                    result[c] = river_out[c].values

        # Soil moisture proxy
        if "rainfall_mm" in result.columns and "temperature" in result.columns:
            try:
                soil_out = FeatureEngineer.compute_soil_moisture_proxy(result)
                for c in soil_out.columns:
                    if c not in result.columns:
                        result[c] = soil_out[c].values
            except Exception:
                pass

        # Fire Weather Index (wildfire/heatwave)
        if hazard_type in ("wildfire", "heatwave"):
            fwi_cols = {"temperature", "humidity", "wind_speed", "rainfall_mm"}
            if fwi_cols.issubset(result.columns):
                try:
                    fwi_out = FeatureEngineer.compute_fwi(result)
                    for c in fwi_out.columns:
                        if c not in result.columns:
                            result[c] = fwi_out[c].values
                except Exception:
                    pass

        # Fill NaNs introduced by rolling windows
        result = result.ffill().fillna(0)

        logger.info(
            "Engineered features: {} cols from {} input rows (hazard={})",
            len(result.columns),
            len(df),
            hazard_type,
        )
        return result

    # Temporal features
    @staticmethod
    def compute_temporal_features(timestamps: pd.Series) -> pd.DataFrame:
        """Extract calendar and cyclical temporal features from datetime series.

        Parameters
        timestamps : pd.Series
            Datetime-like series.

        Returns
        pd.DataFrame
            Columns: ``season, month, day_of_week, hour, is_weekend,
            is_rush_hour, season_sin, season_cos, hour_sin, hour_cos``.
        """
        ts = pd.to_datetime(timestamps)

        month = ts.dt.month
        # Season: 0=winter (Dec-Feb), 1=spring (Mar-May),
        #         2=summer (Jun-Aug),  3=autumn (Sep-Nov)
        season = ((month % 12) // 3).astype(int)

        hour = ts.dt.hour
        dow = ts.dt.dayofweek

        out = pd.DataFrame(index=timestamps.index)
        out["season"] = season.values
        out["month"] = month.values
        out["day_of_week"] = dow.values
        out["hour"] = hour.values
        out["is_weekend"] = (dow >= 5).values
        out["is_rush_hour"] = (
            ((hour >= 7) & (hour <= 9)) | ((hour >= 16) & (hour <= 18))
        ).values

        # Cyclical encoding (sin/cos)
        out["season_sin"] = np.sin(2 * np.pi * season.values / 4)
        out["season_cos"] = np.cos(2 * np.pi * season.values / 4)
        out["hour_sin"] = np.sin(2 * np.pi * hour.values / 24)
        out["hour_cos"] = np.cos(2 * np.pi * hour.values / 24)

        return out

    # Station-relative normalisation
    @staticmethod
    def normalise_to_station(
        features: pd.DataFrame,
        station_stats: pd.DataFrame,
    ) -> pd.DataFrame:
        """Apply station-relative z-score normalization.

        For each feature column present in both *features* and *station_stats*,
        compute ``(value - station_mean) / station_std``.  This makes models
        station-agnostic.

        Parameters
        features : pd.DataFrame
            Must contain a ``station_id`` column (or index level).
        station_stats : pd.DataFrame
            Columns: ``[station_id, feature, mean, std]``.

        Returns
        pd.DataFrame
            Same shape as *features* with normalised numeric values.
        """
        df = features.copy()

        # Handle station_id in index
        restore_index = False
        if "station_id" not in df.columns and "station_id" in (df.index.names or []):
            df = df.reset_index(level="station_id")
            restore_index = True

        # Pivot station_stats for O(1) lookup per feature
        stat_mean = station_stats.pivot(
            index="station_id", columns="feature", values="mean"
        )
        stat_std = station_stats.pivot(
            index="station_id", columns="feature", values="std"
        )

        normalised_features = sorted(set(stat_mean.columns) & set(df.columns))

        for feat in normalised_features:
            s_mean = df["station_id"].map(stat_mean[feat])
            s_std = df["station_id"].map(stat_std[feat]).replace(0, 1)  # avoid div/0
            df[feat] = (df[feat] - s_mean) / s_std

        if restore_index:
            df = df.set_index("station_id", append=True)

        logger.debug(
            "Normalised {} features across {} stations",
            len(normalised_features),
            df["station_id"].nunique() if "station_id" in df.columns else "N/A",
        )
        return df

# Leakage Prevention

class LeakagePrevention:
    """Reusable safeguards to prevent temporal data leakage in training pipelines."""

    @staticmethod
    def build_prediction_timestamp(
        event_start: pd.Timestamp,
        lead_hours: int = 6,
    ) -> pd.Timestamp:
        """Return the latest allowable feature timestamp for a prediction
        that must be made *lead_hours* before *event_start*.

        Parameters
        event_start : pd.Timestamp
            When the event (label) begins.
        lead_hours : int
            Required lead time in hours (default 6).

        Returns
        pd.Timestamp
            ``event_start - lead_hours``.
        """
        return event_start - pd.Timedelta(hours=lead_hours)

    @staticmethod
    def clip_features_before(
        df: pd.DataFrame,
        cutoff: pd.Timestamp,
        time_col: str = "timestamp",
    ) -> pd.DataFrame:
        """Return only rows with ``time_col < cutoff`` (strictly before).

        Parameters
        df : pd.DataFrame
            Input features.
        cutoff : pd.Timestamp
            Exclusive upper bound.
        time_col : str
            Column name or index level containing timestamps.

        Returns
        pd.DataFrame
            Filtered copy with all rows at or after *cutoff* removed.
        """
        if time_col in df.columns:
            mask = pd.to_datetime(df[time_col]) < cutoff
        elif time_col in (df.index.names or []):
            mask = df.index.get_level_values(time_col) < cutoff
        elif df.index.name == time_col or (
            df.index.name is None and time_col == "timestamp"
        ):
            mask = df.index < cutoff
        else:
            raise KeyError(
                f"Column or index level '{time_col}' not found in DataFrame. "
                f"Available columns: {list(df.columns)}, index names: {df.index.names}"
            )
        return df.loc[mask].copy()

    @staticmethod
    def assert_no_future_leakage(
        features_df: pd.DataFrame,
        label_times: pd.Series,
        time_col: str = "timestamp",
    ) -> None:
        """Raise ``ValueError`` if any feature row has a timestamp at or after
        its corresponding label time.

        Parameters
        features_df : pd.DataFrame
            Feature matrix; must be length-aligned with *label_times*.
        label_times : pd.Series
            The event / label timestamps, one per row in *features_df*.
        time_col : str
            Column or index level holding feature timestamps.

        Raises
        ValueError
            If leakage is detected, with details of the offending rows.
        """
        if time_col in features_df.columns:
            feat_times = pd.to_datetime(features_df[time_col])
        elif time_col in (features_df.index.names or []):
            feat_times = features_df.index.get_level_values(time_col)
        else:
            feat_times = pd.to_datetime(features_df.index)

        label_times = pd.to_datetime(label_times)

        if len(feat_times) != len(label_times):
            raise ValueError(
                f"Length mismatch: features have {len(feat_times)} rows "
                f"but label_times has {len(label_times)} entries."
            )

        violations = feat_times.values >= label_times.values
        n_violations = int(np.sum(violations))

        if n_violations > 0:
            violation_idx = np.where(violations)[0][:5]
            examples = [
                f"  row {idx}: feature_time={feat_times.iloc[idx]}, "
                f"label_time={label_times.iloc[idx]}"
                for idx in violation_idx
            ]
            raise ValueError(
                f"Temporal leakage detected: {n_violations} feature row(s) "
                f"have timestamps >= their label times.\n"
                + "\n".join(examples)
            )
        logger.debug(
            "Leakage check passed: {} rows, all features precede labels",
            len(feat_times),
        )


class SPEIFeatures:
    """Load and join SPEI drought indices to a weather feature DataFrame.

    SPEI (Standardised Precipitation-Evapotranspiration Index) is the
    UN-endorsed gold-standard drought indicator (Vicente-Serrano et al., 2010,
    J. Climate 23:1696-1718).  It accounts for both precipitation deficit and
    evaporative demand — superior to SPI (precipitation-only) for predicting
    flash drought onset and water supply disruption.

    Data: SPEI-3 (3-month timescale, drought onset) and SPEI-12 (12-month,
    chronic drought) from the SPEI Global Drought Monitor .nc files stored in
    ai-engine/data/spei/.

    Usage:
        spei = SPEIFeatures("/path/to/data/spei")
        df = spei.join(weather_df, lat_col="lat", lon_col="lon")
    """

    _SPEI_DIR_DEFAULT = None  # set at runtime

    def __init__(self, spei_dir: str | None = None):
        import os
        if spei_dir is None:
            # Default: ai-engine/data/spei relative to this file
            here = os.path.dirname(os.path.abspath(__file__))
            spei_dir = os.path.normpath(os.path.join(here, "..", "..", "data", "spei"))
        self.spei_dir = spei_dir
        self._cache: dict = {}

    def _load_nc(self, scale: int) -> "tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]":
        """Load SPEI-{scale} NetCDF. Returns (times, lats, lons, spei_array)."""
        import os
        import numpy as np
        key = f"spei{scale:02d}"
        if key in self._cache:
            return self._cache[key]
        path = os.path.join(self.spei_dir, f"spei{scale:02d}.nc")
        if not os.path.exists(path):
            raise FileNotFoundError(f"SPEI-{scale} file not found: {path}")
        try:
            import netCDF4 as nc
            ds = nc.Dataset(path)
            # Variable name varies: 'spei', 'SPEI', or scale-named
            spei_var = next(
                (v for v in ds.variables if v.lower().startswith("spei")), None
            )
            if spei_var is None:
                raise KeyError(f"No SPEI variable in {path}. Variables: {list(ds.variables)}")
            spei_data = ds[spei_var][:]  # shape (time, lat, lon) or (time, lon, lat)
            time_var = ds["time"]
            import netCDF4 as _nc
            times = _nc.num2date(time_var[:], time_var.units)
            times = np.array([np.datetime64(str(t)[:10], "D") for t in times])
            lats = ds["lat"][:] if "lat" in ds.variables else ds["latitude"][:]
            lons = ds["lon"][:] if "lon" in ds.variables else ds["longitude"][:]
            ds.close()
        except ImportError:
            # Fallback: xarray
            import xarray as xr
            ds = xr.open_dataset(path)
            spei_var = next((v for v in ds.data_vars if "spei" in v.lower()), None)
            if spei_var is None:
                raise KeyError(f"No SPEI variable found in {path}")
            da = ds[spei_var]
            lat_dim = next((d for d in da.dims if "lat" in d.lower()), da.dims[-2])
            lon_dim = next((d for d in da.dims if "lon" in d.lower()), da.dims[-1])
            lats = da[lat_dim].values
            lons = da[lon_dim].values
            times = da["time"].values.astype("datetime64[D]")
            spei_data = da.values
            ds.close()

        result = (times, np.asarray(lats), np.asarray(lons), np.ma.filled(spei_data, np.nan))
        self._cache[key] = result
        return result

    def extract_point(
        self,
        scale: int,
        lat: float,
        lon: float,
        start: str,
        end: str,
    ) -> pd.Series:
        """Extract a monthly SPEI time series for a lat/lon point.

        Parameters
        scale : int   3 or 12
        lat, lon : float   Decimal degrees
        start, end : str   ISO date strings (e.g. '2016-01', '2023-12')

        Returns
        pd.Series indexed by month-start dates, values = SPEI index.
        """
        times, lats, lons, data = self._load_nc(scale)

        # Nearest-neighbour spatial lookup
        lat_idx = int(np.argmin(np.abs(lats - lat)))
        lon_idx = int(np.argmin(np.abs(lons - lon)))

        start_dt = np.datetime64(start[:7], "M").astype("datetime64[D]")
        end_dt   = np.datetime64(end[:7],   "M").astype("datetime64[D]") + np.timedelta64(31, "D")

        mask = (times >= start_dt) & (times <= end_dt)
        sel_times = times[mask]

        # data shape may be (time, lat, lon) or (time, lon, lat) — detect by comparing sizes
        if data.ndim == 3:
            if data.shape[1] == len(lats):
                vals = data[mask, lat_idx, lon_idx]
            else:
                vals = data[mask, lon_idx, lat_idx]
        else:
            vals = data[mask]

        idx = pd.to_datetime([str(t) for t in sel_times])
        return pd.Series(vals.astype(float), index=idx, name=f"spei_{scale:02d}")

    def join(
        self,
        df: pd.DataFrame,
        lat: float,
        lon: float,
        start: str,
        end: str,
        scales: tuple[int, ...] = (3, 12),
    ) -> pd.DataFrame:
        """Merge SPEI features into a feature DataFrame indexed by timestamp.

        SPEI is monthly — each month's value is forward-filled to hourly rows
        within that month (causal: no future data leaks in).

        Parameters
        df : pd.DataFrame   Feature DataFrame with DatetimeIndex or 'timestamp' column.
        lat, lon : float    Station coordinates.
        start, end : str    Date range (matches df coverage).
        scales : tuple      SPEI timescales to include (default: 3-month + 12-month).

        Returns
        pd.DataFrame   df with added spei_03, spei_12 columns (and derived features).
        """
        out = df.copy()
        has_ts_col = "timestamp" in out.columns and not isinstance(out.index, pd.DatetimeIndex)
        if has_ts_col:
            out = out.set_index("timestamp")
        if not isinstance(out.index, pd.DatetimeIndex):
            out.index = pd.to_datetime(out.index)

        for scale in scales:
            try:
                spei_monthly = self.extract_point(scale, lat, lon, start, end)
                # Reindex to hourly: forward-fill within month (no future leakage)
                spei_reindexed = spei_monthly.reindex(out.index, method="ffill")
                col = f"spei_{scale:02d}"
                out[col] = spei_reindexed.values

                # Derived features
                # Consecutive months below threshold — severity accumulation
                out[f"spei_{scale:02d}_drought_flag"] = (out[col] < -1.0).astype(float)
                # Running consecutive drought months (causal)
                streak = (out[f"spei_{scale:02d}_drought_flag"]
                          .groupby((out[f"spei_{scale:02d}_drought_flag"] == 0).cumsum())
                          .cumsum())
                out[f"spei_{scale:02d}_drought_streak"] = streak.values
                # Severity class: 0=normal, 1=moderate(<-1), 2=severe(<-1.5), 3=extreme(<-2)
                out[f"spei_{scale:02d}_severity"] = np.select(
                    [out[col] < -2.0, out[col] < -1.5, out[col] < -1.0],
                    [3.0, 2.0, 1.0], default=0.0,
                )
                logger.info(f"  SPEI-{scale:02d}: joined {(~spei_reindexed.isna()).sum()} non-null rows for lat={lat:.2f} lon={lon:.2f}")
            except Exception as e:
                logger.warning(f"  SPEI-{scale:02d} join failed (non-fatal): {e}")
                for col in [f"spei_{scale:02d}", f"spei_{scale:02d}_drought_flag",
                            f"spei_{scale:02d}_drought_streak", f"spei_{scale:02d}_severity"]:
                    out[col] = 0.0

        if has_ts_col:
            out = out.reset_index().rename(columns={"index": "timestamp"})
        return out.ffill().fillna(0.0)

