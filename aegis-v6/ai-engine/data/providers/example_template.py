"""
AEGIS AI Engine — Example Country Provider Template

This file demonstrates how to add a new country/region to the AEGIS
hazard prediction platform.  Copy this file, rename the class, and
implement every abstract method using real data sources for the target
country.

Adding a new country requires:
  1.  One new provider class (this file pattern)
  2.  Register it in data/providers/__init__.py
  3.  Run:  python -m app.training.train_all --region <your-region-id>

NO changes are needed to:
  - Training pipeline architecture
  - Predictor classes
  - Prediction API / FastAPI endpoints
  - Model registry
  - Frontend / governance display

Example region keys
    "ng-lagos"      Nigeria – Lagos metropolitan area
    "de-bavaria"    Germany – Bavaria / Bayern
    "in-kerala"     India – Kerala state
    "au-nsw"        Australia – New South Wales
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from data.providers.base import RegionalDataProvider, RateLimiter

class NigeriaLagosProvider(RegionalDataProvider):
    """Example provider for Lagos, Nigeria.

    Data sources (to be implemented):
        Weather    — Nigerian Meteorological Agency (NiMet) or Open-Meteo fallback
        River      — NIHSA (Nigeria Hydrological Services Agency) gauges
        Floods     — EM-DAT, IFRC, FloodList incident databases
        Rainfall   — NiMet gauge network or CHIRPS satellite rainfall
        Stations   — NiMet station catalogue
        Air quality— Lagos Environmental Protection Agency or OpenAQ
    """

    def __init__(self, *, refresh: bool = False):
        super().__init__(region_id="ng-lagos", country_code="NG", refresh=refresh)
        # Example: rate limiter for a hypothetical national API
        self._nimet_limiter = RateLimiter(max_requests=5, period_seconds=1.0)
        logger.info("NigeriaLagosProvider initialised (ng-lagos)")

    async def get_historical_weather(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: Replace with NiMet API or CHIRPS+ERA5 blend
        # For now, fall back to Open-Meteo via composition:
        #
        #   from data.providers.open_meteo import OpenMeteoProvider
        #   fallback = OpenMeteoProvider(region_id=self.region_id, country_code=self.country_code)
        #   return await fallback.get_historical_weather(lat, lon, start_date, end_date)
        raise NotImplementedError("Wire up NiMet or Open-Meteo fallback")

    async def get_river_levels(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: NIHSA gauge API or local CSV archive
        raise NotImplementedError("Wire up NIHSA river level data")

    async def get_flood_events(
        self, start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: EM-DAT + FloodList scrape for Lagos flood events
        raise NotImplementedError("Wire up flood event archive for Lagos")

    async def get_rainfall(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: NiMet rain gauge data or CHIRPS satellite estimates
        raise NotImplementedError("Wire up NiMet rainfall data")

    async def get_station_metadata(self) -> pd.DataFrame:
        # TODO: NiMet station catalogue
        raise NotImplementedError("Wire up NiMet station metadata")

    async def get_air_quality(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: Lagos EPA or OpenAQ fallback
        raise NotImplementedError("Wire up Lagos air quality data")

class GermanyBavariaProvider(RegionalDataProvider):
    """Example provider for Bavaria, Germany.

    Data sources (to be implemented):
        Weather    — DWD (Deutscher Wetterdienst) Climate Data Centre
        River      — BfG (Bundesanstalt für Gewässerkunde) WISKI gauges
        Floods     — DWD / LfU Bayern flood event archive
        Rainfall   — DWD RADOLAN / gauge network
        Stations   — DWD / BfG station catalogues
        Air quality— UBA (Umweltbundesamt) or OpenAQ
    """

    def __init__(self, *, refresh: bool = False):
        super().__init__(region_id="de-bavaria", country_code="DE", refresh=refresh)
        logger.info("GermanyBavariaProvider initialised (de-bavaria)")

    async def get_historical_weather(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: DWD CDC opendata https://opendata.dwd.de/climate_environment/
        raise NotImplementedError("Wire up DWD climate data")

    async def get_river_levels(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        # TODO: BfG WISKI / LfU Bayern Hochwassernachrichtendienst
        raise NotImplementedError("Wire up BfG/LfU river levels")

    async def get_flood_events(
        self, start_date: str, end_date: str
    ) -> pd.DataFrame:
        raise NotImplementedError("Wire up LfU Bayern flood archive")

    async def get_rainfall(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        raise NotImplementedError("Wire up DWD RADOLAN rainfall")

    async def get_station_metadata(self) -> pd.DataFrame:
        raise NotImplementedError("Wire up DWD station catalogue")

    async def get_air_quality(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        raise NotImplementedError("Wire up UBA air quality")
