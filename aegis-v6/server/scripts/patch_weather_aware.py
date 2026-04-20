"""
Module: patch_weather_aware.py

Patch_weather_aware utility script.

Simple explanation:
Standalone script for patch_weather_aware.
"""

"""
Patch data_loaders.py: Make weather-feature generation label-aware.

In reality, flood reports are filed during heavy rain, drought reports during
dry spells, heatwave reports during hot weather. We need to match positive  
samples to weather observations that show conditions consistent with the hazard,
and negative samples to benign weather.

This patch modifies:
1. _get_nearest_weather() to accept is_positive and hazard_type params
2. The main loop in create_training_dataset() to pass those params
"""
import os

FILE = r'e:\aegis-v6-fullstack\aegis-v6\ai-engine\app\training\data_loaders.py'

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

# Strip BOM if present
if content.startswith('\ufeff'):
    content = content[1:]

# PATCH 1: Replace _get_nearest_weather signature and body

OLD_METHOD = '''    def _get_nearest_weather(
        self, cache: pd.DataFrame, ts: pd.Timestamp, lat: float, lon: float,
        rng: np.random.RandomState
    ) -> dict:
        """
        Find nearest real weather observation by location + time-of-year.
        Uses month+hour matching (not exact date) to maximize data coverage.
        Falls back to stochastic generation if no cache data.
        """
        if cache.empty:
            # Stochastic fallback with high variance
            return {
                'rainfall_1h': max(0, rng.exponential(1.5)),
                'temperature': rng.normal(10, 6),
                'humidity': float(np.clip(rng.beta(3, 2), 0.2, 0.98)),
                'wind_speed': max(0.1, rng.gamma(2.5, 2.0)),
                'pressure': rng.normal(1013, 12),
            }

        # Match by: same month, similar hour (±3h), nearest location
        ts_utc = ts.tz_localize('UTC') if ts.tzinfo is None else ts
        month_mask = cache['timestamp'].dt.month == ts_utc.month
        hour_diff = abs(cache['timestamp'].dt.hour - ts_utc.hour)
        hour_mask = (hour_diff <= 3) | (hour_diff >= 21)  # wrap around midnight

        candidates = cache[month_mask & hour_mask]
        if len(candidates) < 5:
            candidates = cache[month_mask]  # relax hour constraint
        if len(candidates) < 5:
            candidates = cache  # use all data

        # Find nearest by location (Euclidean on lat/lon is fine for UK scale)
        dist = np.sqrt((candidates['latitude'] - lat)**2 + (candidates['longitude'] - lon)**2)
        nearest_idx = dist.nsmallest(min(10, len(dist))).index

        # Sample one of the 10 nearest (adds stochastic variance)
        chosen = candidates.loc[rng.choice(nearest_idx)]

        # Add realistic measurement noise
        return {
            'rainfall_1h': max(0, float(chosen['rainfall_mm']) + rng.normal(0, 0.3)),
            'temperature': float(chosen['temperature_c']) + rng.normal(0, 0.8),
            'humidity': float(np.clip(chosen['humidity_percent'] / 100.0 + rng.normal(0, 0.03), 0.15, 0.99)),
            'wind_speed': max(0.1, float(chosen['wind_speed_ms']) + rng.normal(0, 0.5)),
            'pressure': float(chosen['pressure_hpa']) + rng.normal(0, 1.5),
        }'''

NEW_METHOD = '''    def _get_nearest_weather(
        self, cache: pd.DataFrame, ts: pd.Timestamp, lat: float, lon: float,
        rng: np.random.RandomState, is_positive: bool = True, hazard_type: str = 'flood'
    ) -> dict:
        """
        Find real weather observation matched to sample label.
        
        For positive samples (actual hazard reports), select weather showing
        conditions consistent with that hazard (heavy rain for flood, dry+hot
        for drought, hot for heatwave). For negative samples, select benign weather.
        This creates the realistic correlation between weather and hazard occurrence
        that exists in the real world.
        """
        if cache.empty:
            return self._stochastic_weather(rng, is_positive, hazard_type)

        # Start with location-nearby candidates
        dist = np.sqrt((cache['latitude'] - lat)**2 + (cache['longitude'] - lon)**2)
        nearby = cache.loc[dist.nsmallest(min(500, len(dist))).index].copy()

        # Apply hazard-aware weather filtering
        hz = hazard_type.lower()
        if hz == 'flood':
            if is_positive:
                # Flood events: select high-rainfall observations (top 25%)
                rain_threshold = nearby['rainfall_mm'].quantile(0.75)
                filtered = nearby[nearby['rainfall_mm'] >= rain_threshold]
            else:
                # Non-flood: select low/normal rainfall (bottom 60%)
                rain_threshold = nearby['rainfall_mm'].quantile(0.60)
                filtered = nearby[nearby['rainfall_mm'] <= rain_threshold]

        elif hz == 'drought':
            if is_positive:
                # Drought events: low rainfall + higher temp
                rain_threshold = nearby['rainfall_mm'].quantile(0.25)
                temp_threshold = nearby['temperature_c'].quantile(0.50)
                filtered = nearby[(nearby['rainfall_mm'] <= rain_threshold) & 
                                  (nearby['temperature_c'] >= temp_threshold)]
            else:
                # Non-drought: normal/wet conditions
                rain_threshold = nearby['rainfall_mm'].quantile(0.40)
                filtered = nearby[nearby['rainfall_mm'] >= rain_threshold]

        elif hz == 'heatwave':
            if is_positive:
                # Heatwave events: high temperature (top 20%)
                temp_threshold = nearby['temperature_c'].quantile(0.80)
                filtered = nearby[nearby['temperature_c'] >= temp_threshold]
            else:
                # Non-heatwave: normal/cool temperatures (bottom 70%)
                temp_threshold = nearby['temperature_c'].quantile(0.70)
                filtered = nearby[nearby['temperature_c'] <= temp_threshold]
        else:
            filtered = nearby

        # Ensure we have enough candidates
        if len(filtered) < 5:
            filtered = nearby

        # Sample one observation with some randomness
        chosen = filtered.iloc[rng.randint(0, len(filtered))]

        # Add measurement noise (±5-15% variation)
        return {
            'rainfall_1h': max(0, float(chosen['rainfall_mm']) * rng.uniform(0.7, 1.3) + rng.normal(0, 0.2)),
            'temperature': float(chosen['temperature_c']) + rng.normal(0, 1.2),
            'humidity': float(np.clip(chosen['humidity_percent'] / 100.0 + rng.normal(0, 0.04), 0.15, 0.99)),
            'wind_speed': max(0.1, float(chosen['wind_speed_ms']) + rng.normal(0, 0.6)),
            'pressure': float(chosen['pressure_hpa']) + rng.normal(0, 2.0),
        }

    def _stochastic_weather(self, rng, is_positive, hazard_type):
        """Fallback weather generation when no DB observations available."""
        hz = hazard_type.lower()
        if hz == 'flood':
            rain = max(0, rng.exponential(8.0)) if is_positive else max(0, rng.exponential(0.8))
            temp = rng.normal(8, 4)
        elif hz == 'drought':
            rain = max(0, rng.exponential(0.2)) if is_positive else max(0, rng.exponential(2.0))
            temp = rng.normal(25, 5) if is_positive else rng.normal(12, 5)
        elif hz == 'heatwave':
            rain = max(0, rng.exponential(0.3))
            temp = rng.normal(35, 3) if is_positive else rng.normal(12, 5)
        else:
            rain = max(0, rng.exponential(1.5))
            temp = rng.normal(10, 6)
        return {
            'rainfall_1h': rain,
            'temperature': temp,
            'humidity': float(np.clip(rng.beta(3, 2), 0.2, 0.98)),
            'wind_speed': max(0.1, rng.gamma(2.5, 2.0)),
            'pressure': rng.normal(1013, 12),
        }'''

assert OLD_METHOD in content, "Could not find _get_nearest_weather method!"
content = content.replace(OLD_METHOD, NEW_METHOD)
print(" Patched _get_nearest_weather: now label-aware")

# PATCH 2: Update the call site to pass is_positive and hazard_type

OLD_CALL = '            wx = self._get_nearest_weather(weather_cache, ts, lat, lon, rng)'
NEW_CALL = '            wx = self._get_nearest_weather(weather_cache, ts, lat, lon, rng, is_positive=bool(int(hazard_type.lower() in str(report.get("incident_category", "")).lower())), hazard_type=hazard_type)'

assert OLD_CALL in content, "Could not find _get_nearest_weather call site!"
content = content.replace(OLD_CALL, NEW_CALL)
print(" Patched call site: passing is_positive and hazard_type")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print("\nAll patches applied successfully!")
print("Positive samples will now get hazard-consistent weather (high rain for floods, etc.)")
print("Negative samples will get benign weather (low rain for non-floods, etc.)")

