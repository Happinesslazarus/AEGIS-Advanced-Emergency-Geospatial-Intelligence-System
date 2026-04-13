"""
File: config.py

What this file does:
Pydantic BaseSettings class that loads all AI engine configuration from
environment variables (or a .env file). Provides typed, validated settings
for database connection, model paths, API keys, and server ports.

How it connects:
- Imported everywhere as: from app.core.config import settings
- Values sourced from ai-engine/.env (see .env.example in project root)
- MODEL_REGISTRY_PATH and FEATURE_STORE_PATH used by ModelRegistry/FeatureStore
- DATABASE_URL used by governance.py and model_monitor.py for asyncpg connections
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List
import os

class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    """
    
    # Server Configuration
    HOST: str = Field(default="0.0.0.0", env="HOST")
    PORT: int = Field(default=8000, env="PORT")
    ENV: str = Field(default="development", env="ENV")
    DEBUG: bool = Field(default=True, env="DEBUG")
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    
    # Database
    DATABASE_URL: str = Field(
        default="postgresql://postgres:password@localhost:5432/aegis",
        env="DATABASE_URL"
    )
    DB_POOL_SIZE: int = Field(default=10, env="DB_POOL_SIZE")
    DB_MAX_OVERFLOW: int = Field(default=20, env="DB_MAX_OVERFLOW")
    
    # Model Registry
    MODEL_REGISTRY_PATH: str = Field(default="./model_registry", env="MODEL_REGISTRY_PATH")
    MODEL_CACHE_DIR: str = Field(default="./model_cache", env="MODEL_CACHE_DIR")
    ENABLE_MODEL_CACHING: bool = Field(default=True, env="ENABLE_MODEL_CACHING")
    
    # Feature Store
    FEATURE_STORE_PATH: str = Field(default="./feature_store", env="FEATURE_STORE_PATH")
    ENABLE_FEATURE_CACHING: bool = Field(default=True, env="ENABLE_FEATURE_CACHING")
    
    # API Security
    API_SECRET_KEY: str = Field(
        default="",  # REQUIRED in production - no default
        env="API_SECRET_KEY"
    )
    ALLOWED_ORIGINS: List[str] = Field(
        default=["http://localhost:3001", "http://localhost:5173", "http://127.0.0.1:3001", "http://127.0.0.1:5173"],
        env="ALLOWED_ORIGINS"
    )
    ENABLE_CORS: bool = Field(default=True, env="ENABLE_CORS")
    
    # Model Configuration
    DEFAULT_MODEL_VERSION: str = Field(default="v1.0.0", env="DEFAULT_MODEL_VERSION")
    AUTO_SELECT_BEST_MODEL: bool = Field(default=True, env="AUTO_SELECT_BEST_MODEL")
    ENABLE_MODEL_ENSEMBLE: bool = Field(default=True, env="ENABLE_MODEL_ENSEMBLE")
    
    # Performance
    MAX_WORKERS: int = Field(default=4, env="MAX_WORKERS")
    REQUEST_TIMEOUT: int = Field(default=300, env="REQUEST_TIMEOUT")
    PREDICTION_BATCH_SIZE: int = Field(default=100, env="PREDICTION_BATCH_SIZE")
    
    # Monitoring
    ENABLE_PROMETHEUS: bool = Field(default=True, env="ENABLE_PROMETHEUS")
    ENABLE_SENTRY: bool = Field(default=False, env="ENABLE_SENTRY")
    SENTRY_DSN: str = Field(default="", env="SENTRY_DSN")
    LOG_FILE_PATH: str = Field(default="./logs/ai-engine.log", env="LOG_FILE_PATH")
    
    # Drift Detection
    ENABLE_DRIFT_DETECTION: bool = Field(default=True, env="ENABLE_DRIFT_DETECTION")
    DRIFT_CHECK_INTERVAL: int = Field(default=3600, env="DRIFT_CHECK_INTERVAL")
    DRIFT_THRESHOLD: float = Field(default=0.15, env="DRIFT_THRESHOLD")
    
    # External APIs
    SEPA_API_ENABLED: bool = Field(default=True, env="SEPA_API_ENABLED")
    SEPA_API_KEY: str = Field(default="", env="SEPA_API_KEY")
    WEATHER_API_ENABLED: bool = Field(default=True, env="WEATHER_API_ENABLED")
    WEATHER_API_KEY: str = Field(default="", env="WEATHER_API_KEY")
    SATELLITE_API_ENABLED: bool = Field(default=False, env="SATELLITE_API_ENABLED")
    SATELLITE_API_KEY: str = Field(default="", env="SATELLITE_API_KEY")

    # Training data API keys
    FIRMS_MAP_KEY: str = Field(default="", env="FIRMS_MAP_KEY")
    ECMWF_API_KEY: str = Field(default="", env="ECMWF_API_KEY")
    ECMWF_API_EMAIL: str = Field(default="", env="ECMWF_API_EMAIL")
    ECMWF_API_URL: str = Field(default="https://api.ecmwf.int/v1", env="ECMWF_API_URL")
    
    # Training
    ENABLE_AUTO_RETRAIN: bool = Field(default=False, env="ENABLE_AUTO_RETRAIN")
    MIN_TRAINING_SAMPLES: int = Field(default=1000, env="MIN_TRAINING_SAMPLES")
    
    # Region
    PRIMARY_REGION: str = Field(default="scotland", env="PRIMARY_REGION")
    SUPPORTED_REGIONS: List[str] = Field(
        default=["scotland", "uk", "global"],
        env="SUPPORTED_REGIONS"
    )
    
    # Feature Flags
    ENABLE_FLOOD_MODULE: bool = Field(default=True, env="ENABLE_FLOOD_MODULE")
    ENABLE_DROUGHT_MODULE: bool = Field(default=True, env="ENABLE_DROUGHT_MODULE")
    ENABLE_HEATWAVE_MODULE: bool = Field(default=True, env="ENABLE_HEATWAVE_MODULE")
    ENABLE_WILDFIRE_MODULE: bool = Field(default=True, env="ENABLE_WILDFIRE_MODULE")
    ENABLE_COMPOUND_RISK: bool = Field(default=False, env="ENABLE_COMPOUND_RISK")
    
    class Config:
        env_file = ".env"
        case_sensitive = True

    def get_allowed_origins_list(self) -> List[str]:
        """Parse ALLOWED_ORIGINS if it's a comma-separated string."""
        if isinstance(self.ALLOWED_ORIGINS, str):
            return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]
        return self.ALLOWED_ORIGINS

# Global settings instance
settings = Settings()

# Override ALLOWED_ORIGINS if it was a string
if isinstance(settings.ALLOWED_ORIGINS, str):
    settings.ALLOWED_ORIGINS = settings.get_allowed_origins_list()

# STRICT STARTUP VALIDATION — refuse to boot in production without API key
if settings.ENV == "production":
    _startup_errors = []
    if not settings.API_SECRET_KEY or len(settings.API_SECRET_KEY) < 16:
        _startup_errors.append(
            "API_SECRET_KEY must be set to a strong value (16+ chars) in production"
        )
    if settings.DATABASE_URL.startswith("postgresql://postgres:password@"):
        _startup_errors.append(
            "DATABASE_URL is using the default placeholder password — must change for production"
        )
    if settings.DEBUG:
        _startup_errors.append(
            "DEBUG=True in production — set DEBUG=False"
        )
    if _startup_errors:
        import sys
        print("\n  [ERR] FATAL AI ENGINE CONFIGURATION ERRORS:", file=sys.stderr)
        for e in _startup_errors:
            print(f"     • {e}", file=sys.stderr)
        print("", file=sys.stderr)
        sys.exit(1)
elif not settings.API_SECRET_KEY:
    import warnings
    warnings.warn(
        "[AI ENGINE] API_SECRET_KEY not set — endpoints are unprotected (dev only)",
        stacklevel=1,
    )
