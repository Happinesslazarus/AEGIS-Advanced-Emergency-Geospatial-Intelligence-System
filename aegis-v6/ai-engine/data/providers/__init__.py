from .base_provider import DataProvider, DownloadResult

# New real-data provider architecture
from data.providers.base import RegionalDataProvider
from data.providers.uk_scotland import UKScotlandProvider
from data.providers.open_meteo import OpenMeteoProvider

from typing import Type

# Maps region_id to provider class.
# Adding a new country = add one entry here + one provider file.
PROVIDER_REGISTRY: dict[str, Type[RegionalDataProvider]] = {
    "uk-default": UKScotlandProvider,
    "uk-scotland": UKScotlandProvider,
    "uk-england": UKScotlandProvider,
    # "ng-lagos": NigeriaLagosProvider,  # see example_template.py
    # "de-bavaria": GermanyBavariaProvider,
}

GLOBAL_FALLBACK_CLASS = OpenMeteoProvider

def get_provider(region_id: str, *, refresh: bool = False) -> RegionalDataProvider:
    """Resolve region_id -> provider. Exact match, then prefix, then global fallback."""
    if region_id in PROVIDER_REGISTRY:
        return PROVIDER_REGISTRY[region_id](refresh=refresh)
    prefix = region_id.split("-")[0] + "-"
    for key, cls in PROVIDER_REGISTRY.items():
        if key.startswith(prefix):
            return cls(refresh=refresh)
    return GLOBAL_FALLBACK_CLASS(
        region_id=region_id,
        country_code=region_id.split("-")[0].upper() if "-" in region_id else "XX",
        refresh=refresh,
    )

__all__ = [
    "DataProvider", "DownloadResult",
    "RegionalDataProvider", "UKScotlandProvider", "OpenMeteoProvider",
    "PROVIDER_REGISTRY", "get_provider",
]
