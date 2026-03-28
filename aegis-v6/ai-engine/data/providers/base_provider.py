from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import ClassVar
import logging
import time

import pandas as pd

logger = logging.getLogger(__name__)

@dataclass
class DownloadResult:
    provider: str
    region_id: str
    rows: int
    is_synthetic: bool
    file_path: str
    sha256: str
    start: str
    end: str
    elapsed_s: float
    error: str | None = None

class DataProvider(ABC):
    """Abstract base for all external data providers."""

    provider_registry: ClassVar[dict[str, type["DataProvider"]]] = {}

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        if cls.__name__ != "DataProvider":
            try:
                instance = cls()
                DataProvider.provider_registry[instance.name] = cls
            except Exception:
                pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique provider identifier, e.g. 'sepa_river_levels'."""

    @property
    @abstractmethod
    def supported_regions(self) -> list[str]:
        """List of region_ids this provider supports."""

    @abstractmethod
    def download(self, region_id: str, start: str, end: str) -> pd.DataFrame:
        """Download and return cleaned DataFrame. Must be idempotent."""

    @abstractmethod
    def get_output_schema(self) -> dict[str, type]:
        """Column to dtype mapping for output validation."""

    def supports_region(self, region_id: str) -> bool:
        return region_id in self.supported_regions

    def validate_output(self, df: pd.DataFrame) -> None:
        schema = self.get_output_schema()
        missing = [col for col in schema if col not in df.columns]
        if missing:
            raise ValueError(f"[{self.name}] Missing columns: {missing}")

    def download_with_fallback(self, region_id: str, start: str, end: str) -> tuple[pd.DataFrame, bool]:
        t0 = time.time()
        if not self.supports_region(region_id):
            raise ValueError(
                f"[{self.name}] Region '{region_id}' is not supported. "
                f"Supported regions: {self.supported_regions}. "
                f"NO synthetic fallback — only real data allowed."
            )

        try:
            df = self.download(region_id, start, end)
            self.validate_output(df)
            if df.empty:
                raise ValueError("Empty dataframe returned — no real data available")
            logger.info(
                "[%s] Downloaded %,d rows for %s in %.1fs",
                self.name,
                len(df),
                region_id,
                time.time() - t0,
            )
            return df, False
        except Exception as exc:
            logger.error(
                "[%s] Real data fetch FAILED for region '%s': %s. "
                "NO synthetic fallback — raising error.",
                self.name,
                region_id,
                exc,
            )
            raise RuntimeError(
                f"[{self.name}] Real data unavailable for '{region_id}': {exc}. "
                f"Synthetic data generation is DISABLED. "
                f"Fix the data source or use a different provider."
            ) from exc

class ProviderDiscovery:
    @staticmethod
    def all_provider_classes() -> list[type[DataProvider]]:
        return list(DataProvider.provider_registry.values())

    @staticmethod
    def instantiate_all() -> list[DataProvider]:
        return [cls() for cls in ProviderDiscovery.all_provider_classes()]

    @staticmethod
    def instantiate_by_name(provider_name: str) -> DataProvider:
        cls = DataProvider.provider_registry.get(provider_name)
        if cls is None:
            raise KeyError(
                f"Unknown provider '{provider_name}'. Valid providers: {sorted(DataProvider.provider_registry.keys())}"
            )
        return cls()

def write_provider_output(df: pd.DataFrame, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False)

    digest = sha256()
    with output_path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()
