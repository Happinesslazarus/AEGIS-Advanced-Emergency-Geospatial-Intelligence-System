"""
AEGIS AI Engine — Regional Data Provider Base

Abstract interface that every country/region data provider must implement.
Adding a new country = one class inheriting RegionalDataProvider.
Zero changes to training pipelines, predictors, registry, or API layer.

Includes shared caching, retry, and rate-limiting infrastructure.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from loguru import logger

# Cache / retry / throttle configuration

CACHE_ROOT = Path(__file__).resolve().parent.parent / "cache"

class RateLimiter:
    """Token-bucket rate limiter for API calls."""

    def __init__(self, max_requests: int, period_seconds: float):
        self.max_requests = max_requests
        self.period = period_seconds
        self._tokens = max_requests
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(
                self.max_requests,
                self._tokens + elapsed * (self.max_requests / self.period),
            )
            self._last_refill = now
            if self._tokens < 1:
                wait = (1 - self._tokens) * (self.period / self.max_requests)
                await asyncio.sleep(wait)
                self._tokens = 0
            else:
                self._tokens -= 1

class CacheManager:
    """Parquet-based response cache."""

    def __init__(self, provider_name: str):
        self.provider_name = provider_name

    def _cache_path(self, dataset: str, region_id: str, key: str) -> Path:
        safe_key = hashlib.sha256(key.encode()).hexdigest()[:16]
        return CACHE_ROOT / self.provider_name / dataset / region_id / f"{safe_key}.parquet"

    def get(self, dataset: str, region_id: str, key: str) -> Optional[pd.DataFrame]:
        path = self._cache_path(dataset, region_id, key)
        if path.exists():
            try:
                return pd.read_parquet(path)
            except Exception as e:
                logger.warning(f"Cache read failed for {path}: {e}")
        return None

    def put(self, dataset: str, region_id: str, key: str, df: pd.DataFrame) -> None:
        path = self._cache_path(dataset, region_id, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            df.to_parquet(path, index=False)
        except Exception as e:
            logger.warning(f"Cache write failed for {path}: {e}")

async def fetch_with_retry(
    fetch_fn,
    *args,
    max_retries: int = 3,
    delays: tuple[float, ...] = (1.0, 2.0, 4.0),
    rate_limiter: Optional[RateLimiter] = None,
    **kwargs,
) -> Any:
    """Call fetch_fn with exponential-backoff retries and optional rate limiting."""
    last_error = None
    for attempt in range(max_retries):
        try:
            if rate_limiter:
                await rate_limiter.acquire()
            return await fetch_fn(*args, **kwargs)
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                delay = delays[min(attempt, len(delays) - 1)]
                logger.warning(
                    f"Retry {attempt + 1}/{max_retries} after {delay}s: {e}"
                )
                await asyncio.sleep(delay)
    raise last_error  # type: ignore[misc]

# Abstract base

class RegionalDataProvider(ABC):
    """Country/region-specific observational data provider.

    New country = one class implementing this interface.
    No pipeline rewrite allowed.

    Attributes:
        region_id:    e.g. "uk-default", "ng-lagos", "de-bavaria"
        country_code: ISO 3166-1 alpha-2
    """

    region_id: str
    country_code: str

    def __init__(self, region_id: str, country_code: str, *, refresh: bool = False):
        self.region_id = region_id
        self.country_code = country_code
        self.refresh = refresh  # bypass cache when True
        self._cache = CacheManager(self.__class__.__name__.lower())

    # Weather

    @abstractmethod
    async def get_historical_weather(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Hourly weather observations.

        Required columns:
            timestamp, temperature_2m, relative_humidity_2m, pressure_msl,
            wind_speed_10m, wind_gusts_10m, precipitation, cloud_cover, visibility
        """

    # Hydrology

    @abstractmethod
    async def get_river_levels(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Observed river level / flow.

        Required columns:
            timestamp, station_id, level_m, flow_m3s
        """

    @abstractmethod
    async def get_flood_events(
        self, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Ground-truth flood events.

        Required columns:
            event_id, start_date, end_date, latitude, longitude,
            severity, source, affected_area_km2
        """

    @abstractmethod
    async def get_rainfall(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Observed rainfall.

        Required columns:
            timestamp, station_id, rainfall_mm
        """

    # Station metadata

    @abstractmethod
    async def get_station_metadata(self) -> pd.DataFrame:
        """Station catalogue.

        Required columns:
            station_id, station_name, latitude, longitude, river_name,
            catchment_area_km2, station_type, elevation_m
        """

    # Air quality

    @abstractmethod
    async def get_air_quality(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Observed air quality.

        Required columns:
            timestamp, pm2_5, pm10, no2, o3, so2, aqi
        """

    # Convenience helpers available to all providers

    def _cache_key(self, *parts: str) -> str:
        return "|".join(str(p) for p in parts)

    def _try_cache(self, dataset: str, key: str) -> Optional[pd.DataFrame]:
        if self.refresh:
            return None
        return self._cache.get(dataset, self.region_id, key)

    def _store_cache(self, dataset: str, key: str, df: pd.DataFrame) -> None:
        self._cache.put(dataset, self.region_id, key, df)

    async def _fetch_or_cache(
        self,
        dataset: str,
        key: str,
        fetch_fn,
        *args,
        rate_limiter: Optional[RateLimiter] = None,
        **kwargs,
    ) -> pd.DataFrame:
        """Try cache first, fall back to API with retries."""
        cached = self._try_cache(dataset, key)
        if cached is not None:
            logger.debug(f"Cache hit: {dataset}/{key[:40]}")
            return cached
        try:
            df = await fetch_with_retry(
                fetch_fn, *args, rate_limiter=rate_limiter, **kwargs
            )
            if df is not None and not df.empty:
                self._store_cache(dataset, key, df)
            return df
        except Exception as e:
            # Fall back to stale cache on API failure
            stale = self._cache.get(dataset, self.region_id, key)
            if stale is not None:
                logger.warning(
                    f"API failed for {dataset}, using stale cache: {e}"
                )
                return stale
            raise RuntimeError(
                f"API failed for {dataset} and no cache exists: {e}"
            ) from e
